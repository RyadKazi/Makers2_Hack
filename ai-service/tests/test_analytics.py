"""Statistical analysis, suppression, and simulation tests."""

from datetime import datetime, timezone
from uuid import UUID

from analytics.analysis import (
    DetectionThresholds,
    build_heatmap,
    build_recommendations,
    detect_disparities,
)
from analytics.schemas import ConditionContext, GroupStatistics, RecommendationStatus
from analytics.store import AnalyticsStore, Contribution
from models import Building, ConnectionType, Floor, NavigationEdge, NavigationNode, NodeType
from navigation.accessibility import NavigationProfile
from navigation.graph import NavigationGraph
from navigation.registry import BuildingRegistry


NOW = datetime(2026, 11, 20, tzinfo=timezone.utc)


def contribution(
    index: int,
    contributor: str,
    profile: NavigationProfile,
    *,
    duration: float = 120,
    distance: float = 50,
    completed: bool = True,
    context: ConditionContext = ConditionContext.TYPICAL,
    origin: str = "A",
    destination: str = "B",
    staircase_ids: tuple[str, ...] = (),
    edge_keys: tuple[tuple[str, str], ...] = (),
    reports: tuple[tuple[str, object], ...] = (),
) -> Contribution:
    return Contribution(
        event_id=UUID(int=index + 1),
        session_id=UUID(int=1000 + index),
        contributor_digest=contributor,
        building_id="BUILDING_A",
        origin_node=origin,
        destination_node=destination,
        profile=profile,
        context=context,
        completed=completed,
        duration_seconds=duration,
        distance_m=distance,
        edge_keys=edge_keys,
        staircase_ids=staircase_ids,
        obstacle_reports=reports,
        created_at=NOW,
    )


def disparity_fixture(
    *,
    normal_duration: float = 120,
    access_duration: float = 420,
    context: ConditionContext = ConditionContext.TYPICAL,
    access_completed: bool = True,
) -> list[Contribution]:
    rows: list[Contribution] = []
    # Four trips per contributor, so median statistics are not dominated by
    # one student's repeated sessions.
    for person in range(5):
        for trip in range(4):
            index = person * 8 + trip
            rows.append(
                contribution(
                    index,
                    f"general-{person}",
                    NavigationProfile.GENERAL,
                    duration=normal_duration + (10_000 if person == 0 and trip == 0 else 0),
                    distance=50 + (10_000 if person == 0 and trip == 0 else 0),
                    context=context,
                    staircase_ids=("S1",),
                    edge_keys=(("A", "S1_G"), ("S1_G", "S1_F1"), ("S1_F1", "B")),
                )
            )
            rows.append(
                contribution(
                    index + 4,
                    f"access-{person}",
                    NavigationProfile.WHEELCHAIR,
                    duration=access_duration + (20_000 if person == 0 and trip == 0 else 0),
                    distance=180 + (20_000 if person == 0 and trip == 0 else 0),
                    completed=access_completed,
                    context=context,
                )
            )
    return rows


def thresholds(**changes) -> DetectionThresholds:
    values = {
        "minimum_sessions_per_group": 20,
        "minimum_contributors_per_group": 5,
        "duration_ratio": 1.5,
        "minimum_duration_difference_seconds": 180,
        "consistency_fraction": 0.7,
    }
    values.update(changes)
    return DetectionThresholds(**values)


def test_medians_and_disparity_thresholds_are_robust_to_outliers() -> None:
    result = detect_disparities(disparity_fixture(), thresholds())
    assert len(result) == 1
    disparity = result[0]
    assert disparity.status == "detected"
    assert disparity.general.median_duration_seconds == 120
    assert disparity.accessibility.median_duration_seconds == 420
    assert disparity.general.median_distance_m == 50
    assert disparity.accessibility.median_distance_m == 180
    assert disparity.duration_difference_seconds == 300
    assert disparity.duration_ratio == 3.5
    assert disparity.consistency == 1.0


def test_insufficient_sessions_or_contributors_are_suppressed() -> None:
    rows = disparity_fixture()[:10]
    assert detect_disparities(rows, thresholds()) == []

    repeated_by_one_person = [
        contribution(i, "same-person", NavigationProfile.GENERAL)
        for i in range(20)
    ] + [
        contribution(i + 30, "same-person", NavigationProfile.WHEELCHAIR, duration=500)
        for i in range(20)
    ]
    assert detect_disparities(repeated_by_one_person, thresholds()) == []


def test_unreachable_accessibility_route_is_reported_after_cohort_threshold() -> None:
    result = detect_disparities(
        disparity_fixture(access_completed=False), thresholds()
    )
    assert len(result) == 1
    assert result[0].status == "unreachable"
    assert result[0].accessibility.median_duration_seconds is None
    assert result[0].accessibility.route_available is False


def test_inconsistent_user_experience_does_not_trigger_disparity() -> None:
    rows = disparity_fixture()
    # Two wheelchair contributors have personal medians similar to the general
    # group, leaving only three of five contributors above the baseline (60%).
    for row_index, row in enumerate(rows):
        if row.profile == NavigationProfile.WHEELCHAIR and row.contributor_digest in {
            "access-0",
            "access-1",
        }:
            rows[row_index] = Contribution(
                **{**row.__dict__, "duration_seconds": 100}
            )
    result = detect_disparities(rows, thresholds())
    assert result[0].status == "inconclusive"
    assert result[0].consistency == 0.6


def test_temporary_or_unknown_conditions_are_inconclusive() -> None:
    rows = disparity_fixture(context=ConditionContext.TEMPORARY_DISRUPTION)
    result = detect_disparities(rows, thresholds())
    assert result[0].status == "inconclusive"
    assert result[0].duration_ratio is None


def test_non_comparable_contexts_are_reported_as_inconclusive() -> None:
    rows = disparity_fixture(context=ConditionContext.TYPICAL)
    rows = [
        Contribution(**{**row.__dict__, "context": ConditionContext.TEMPORARY_DISRUPTION})
        if row.profile == NavigationProfile.WHEELCHAIR
        else row
        for row in rows
    ]
    result = detect_disparities(rows, thresholds())
    assert len(result) == 1
    assert result[0].status == "inconclusive"
    assert result[0].context == ConditionContext.UNKNOWN
    assert result[0].duration_ratio is None


def test_heatmap_suppresses_small_contributor_cohorts() -> None:
    node_a = NavigationNode(
        node_id="A", building_id="BUILDING_A", floor_id="G", x=0, y=0, node_type=NodeType.ENTRANCE
    )
    node_b = NavigationNode(
        node_id="B", building_id="BUILDING_A", floor_id="G", x=4, y=0, node_type=NodeType.DOOR
    )
    graph = NavigationGraph(
        Building(
            building_id="BUILDING_A",
            floors=[Floor(floor_id="G", level=0)],
            nodes=[node_a, node_b],
            edges=[
                NavigationEdge(
                    source_node="A",
                    destination_node="B",
                    distance=4,
                    connection_type=ConnectionType.DOORWAY,
                )
            ],
        )
    )
    rows = [
        contribution(i, f"person-{i}", NavigationProfile.GENERAL, edge_keys=(("A", "B"),))
        for i in range(4)
    ]
    assert build_heatmap("BUILDING_A", graph, rows, [], minimum_contributors=5) == []


def recommendation_graph() -> NavigationGraph:
    floors = [Floor(floor_id="G", level=0), Floor(floor_id="F1", level=1)]
    nodes = [
        NavigationNode(node_id="A", building_id="BUILDING_A", floor_id="G", x=0, y=0, node_type="entrance"),
        NavigationNode(node_id="S1_G", building_id="BUILDING_A", floor_id="G", x=1, y=1, node_type="staircase", staircase_connection_id="S1"),
        NavigationNode(node_id="S1_F1", building_id="BUILDING_A", floor_id="F1", x=1, y=1, node_type="staircase", staircase_connection_id="S1"),
        NavigationNode(node_id="LIFT_G", building_id="BUILDING_A", floor_id="G", x=10, y=1, node_type="elevator"),
        NavigationNode(node_id="LIFT_F1", building_id="BUILDING_A", floor_id="F1", x=10, y=1, node_type="elevator"),
        NavigationNode(node_id="B", building_id="BUILDING_A", floor_id="F1", x=2, y=1, node_type="door", is_destination=True),
    ]
    edges = [
        NavigationEdge(source_node="A", destination_node="S1_G", distance=2, connection_type="corridor"),
        NavigationEdge(source_node="S1_G", destination_node="S1_F1", distance=4, connection_type="stairs"),
        NavigationEdge(source_node="S1_F1", destination_node="B", distance=2, connection_type="doorway"),
        NavigationEdge(source_node="A", destination_node="LIFT_G", distance=30, connection_type="corridor"),
        NavigationEdge(source_node="LIFT_G", destination_node="LIFT_F1", distance=4, connection_type="elevator"),
        NavigationEdge(source_node="LIFT_F1", destination_node="B", distance=30, connection_type="corridor"),
    ]
    return NavigationGraph(
        Building(building_id="BUILDING_A", floors=floors, nodes=nodes, edges=edges)
    )


def test_recommendation_simulates_a_copy_and_does_not_mutate_official_graph() -> None:
    graph = recommendation_graph()
    registry = BuildingRegistry([graph.building])
    initial_edges = len(graph.edges)
    result = detect_disparities(disparity_fixture(), thresholds())
    store = AnalyticsStore()

    recs = build_recommendations(registry, disparity_fixture(), result, thresholds(), store)

    assert len(recs) == 1
    assert recs[0].recommendation_type == "accessible_vertical_connection"
    assert recs[0].related_staircase_id == "S1"
    assert recs[0].simulated_distance_m == 8
    assert recs[0].estimated_distance_saved_m == 56
    assert recs[0].estimated_time_saved_seconds is None
    assert recs[0].requires_physical_inspection is True
    assert len(graph.edges) == initial_edges


def test_recommendation_status_is_separate_from_graph_data() -> None:
    store = AnalyticsStore()
    store.set_recommendation_status("rec_test", RecommendationStatus.APPROVED)
    assert store.recommendation_status("rec_test") == RecommendationStatus.APPROVED
