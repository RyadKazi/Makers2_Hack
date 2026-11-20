"""Robust aggregate comparisons, heatmaps, and graph-copy simulations."""

from collections import defaultdict
from dataclasses import dataclass
from hashlib import sha256
from statistics import median
from typing import Iterable

from analytics.schemas import (
    ConditionContext,
    Disparity,
    GroupStatistics,
    HeatmapItem,
    ObstacleType,
    Recommendation,
    RecommendationStatus,
)
from analytics.store import AnalyticsStore, Contribution
from models import AccessibilityMetadata, ConnectionType, NavigationEdge, NavigationNode
from navigation.accessibility import NavigationProfile, RouteConstraints
from navigation.dijkstra import NoRouteFoundError, shortest_path
from navigation.graph import NavigationGraph, Neighbor
from navigation.registry import BuildingRegistry
from navigation.route_service import calculate_route


@dataclass(frozen=True)
class DetectionThresholds:
    minimum_sessions_per_group: int = 20
    minimum_contributors_per_group: int = 5
    duration_ratio: float = 1.5
    minimum_duration_difference_seconds: int = 180
    consistency_fraction: float = 0.7


def _group_stats(
    contributions: list[Contribution], profile: NavigationProfile
) -> GroupStatistics:
    rows = [row for row in contributions if row.profile == profile]
    complete = [row for row in rows if row.completed]
    return GroupStatistics(
        profile=profile,
        session_count=len(rows),
        distinct_contributors=len({row.contributor_digest for row in rows}),
        completed_journeys=len(complete),
        completion_rate=len(complete) / len(rows) if rows else 0.0,
        median_duration_seconds=(median(row.duration_seconds for row in complete) if complete else None),
        median_distance_m=(median(row.distance_m for row in complete) if complete else None),
        route_available=bool(complete),
    )


def detect_disparities(
    contributions: Iterable[Contribution], thresholds: DetectionThresholds
) -> list[Disparity]:
    rows = list(contributions)
    grouped: dict[tuple[str, str, str, ConditionContext], list[Contribution]] = defaultdict(list)
    by_pair: dict[tuple[str, str, str], list[Contribution]] = defaultdict(list)
    for row in rows:
        grouped[(row.building_id, row.origin_node, row.destination_node, row.context)].append(row)
        by_pair[(row.building_id, row.origin_node, row.destination_node)].append(row)

    results: list[Disparity] = []
    comparable_pairs: set[tuple[str, str, str, NavigationProfile]] = set()
    accessibility_profiles = (
        NavigationProfile.WHEELCHAIR,
        NavigationProfile.VISUAL_IMPAIRMENT,
        NavigationProfile.BLIND_NAVIGATION,
    )
    for (building_id, origin, destination, context), pair_rows in grouped.items():
        general_rows = [row for row in pair_rows if row.profile == NavigationProfile.GENERAL]
        general_stats = _group_stats(pair_rows, NavigationProfile.GENERAL)
        for access_profile in accessibility_profiles:
            access_rows = [row for row in pair_rows if row.profile == access_profile]
            access_stats = _group_stats(pair_rows, access_profile)
            if not general_rows or not access_rows:
                continue
            if (
                general_stats.session_count < thresholds.minimum_sessions_per_group
                or access_stats.session_count < thresholds.minimum_sessions_per_group
                or general_stats.distinct_contributors < thresholds.minimum_contributors_per_group
                or access_stats.distinct_contributors < thresholds.minimum_contributors_per_group
            ):
                # Suppression by omission: low-count groups are not disclosed.
                continue

            comparable_pairs.add((building_id, origin, destination, access_profile))

            evidence: list[str] = [
                f"Compared {general_stats.session_count} general and {access_stats.session_count} {access_profile.value} sessions.",
                "Only aggregate journey metrics are retained; ordered node paths are discarded after validation.",
            ]
            duration_difference: float | None = None
            duration_ratio: float | None = None
            distance_difference: float | None = None
            consistency: float | None = None

            if context != ConditionContext.TYPICAL:
                status = "inconclusive"
                evidence.append(
                    f"Journey conditions were {context.value}; temporary or unknown conditions are not treated as a typical infrastructure disparity."
                )
            elif general_stats.completed_journeys == 0:
                status = "inconclusive"
                evidence.append("No completed general journeys provide a comparison baseline.")
            elif access_stats.completed_journeys == 0:
                status = "unreachable"
                evidence.append("No accessibility-profile journey in this sufficiently observed group completed.")
            elif (
                general_stats.completed_journeys < thresholds.minimum_sessions_per_group
                or access_stats.completed_journeys < thresholds.minimum_sessions_per_group
            ):
                status = "inconclusive"
                evidence.append(
                    "There are not enough completed journeys in both groups to compare typical travel times and distances."
                )
            else:
                normal_median_duration = general_stats.median_duration_seconds or 0.0
                access_median_duration = access_stats.median_duration_seconds or 0.0
                duration_difference = access_median_duration - normal_median_duration
                duration_ratio = (
                    access_median_duration / normal_median_duration
                    if normal_median_duration > 0
                    else None
                )
                normal_distance = general_stats.median_distance_m or 0.0
                access_distance = access_stats.median_distance_m or 0.0
                distance_difference = access_distance - normal_distance

                by_contributor: dict[str, list[float]] = defaultdict(list)
                for row in access_rows:
                    if row.completed:
                        by_contributor[row.contributor_digest].append(row.duration_seconds)
                consistency = (
                    sum(median(times) > normal_median_duration for times in by_contributor.values())
                    / len(by_contributor)
                    if by_contributor
                    else 0.0
                )
                detected = (
                    duration_ratio is not None
                    and duration_ratio >= thresholds.duration_ratio
                    and duration_difference >= thresholds.minimum_duration_difference_seconds
                    and consistency >= thresholds.consistency_fraction
                )
                status = "detected" if detected else "inconclusive"
                evidence.extend(
                    [
                        f"Median duration difference: {duration_difference:.1f} seconds.",
                        f"Median duration ratio: {duration_ratio:.2f}x." if duration_ratio is not None else "General median duration is zero; ratio is undefined.",
                        f"{consistency:.0%} of distinct accessibility contributors had a personal median above the general median.",
                    ]
                )
                if not detected:
                    evidence.append("Configured ratio, absolute difference, and consistency thresholds were not all met.")

            results.append(
                Disparity(
                    building_id=building_id,
                    origin_node=origin,
                    destination_node=destination,
                    context=context,
                    general=general_stats,
                    accessibility=access_stats,
                    duration_difference_seconds=duration_difference,
                    duration_ratio=duration_ratio,
                    distance_difference_m=distance_difference,
                    consistency=consistency,
                    status=status,
                    evidence=evidence,
                )
            )

    # When each side has enough observations but their conditions never match,
    # report an inconclusive comparison without computing a misleading ratio.
    for (building_id, origin, destination), pair_rows in by_pair.items():
        for access_profile in accessibility_profiles:
            comparison_key = (building_id, origin, destination, access_profile)
            if comparison_key in comparable_pairs:
                continue
            general_rows = [row for row in pair_rows if row.profile == NavigationProfile.GENERAL]
            access_rows = [row for row in pair_rows if row.profile == access_profile]
            general_stats = _group_stats(pair_rows, NavigationProfile.GENERAL)
            access_stats = _group_stats(pair_rows, access_profile)
            if (
                general_stats.session_count < thresholds.minimum_sessions_per_group
                or access_stats.session_count < thresholds.minimum_sessions_per_group
                or general_stats.distinct_contributors < thresholds.minimum_contributors_per_group
                or access_stats.distinct_contributors < thresholds.minimum_contributors_per_group
            ):
                continue
            results.append(
                Disparity(
                    building_id=building_id,
                    origin_node=origin,
                    destination_node=destination,
                    context=ConditionContext.UNKNOWN,
                    general=general_stats,
                    accessibility=access_stats,
                    duration_difference_seconds=None,
                    duration_ratio=None,
                    distance_difference_m=None,
                    consistency=None,
                    status="inconclusive",
                    evidence=[
                        "Both groups meet minimum cohort counts, but no individual condition context has a sufficient comparable cohort on both sides.",
                        "No travel-time or distance comparison is made until comparable conditions are available.",
                    ],
                )
            )
    return results


def build_heatmap(
    building_id: str,
    graph: NavigationGraph,
    contributions: Iterable[Contribution],
    disparities: Iterable[Disparity],
    minimum_contributors: int,
) -> list[HeatmapItem]:
    rows = [row for row in contributions if row.building_id == building_id]
    by_node: dict[str, list[Contribution]] = defaultdict(list)
    by_report: dict[str, list[Contribution]] = defaultdict(list)
    reports_by_node: dict[str, dict[ObstacleType, set[str]]] = defaultdict(lambda: defaultdict(set))
    for row in rows:
        touched: set[str] = set()
        for source, destination in row.edge_keys:
            touched.update((source, destination))
        for node_id, _ in row.obstacle_reports:
            touched.add(node_id)
            by_report[node_id].append(row)
        for node_id in touched:
            by_node[node_id].append(row)
        for node_id, obstacle_type in row.obstacle_reports:
            reports_by_node[node_id][obstacle_type].add(row.contributor_digest)

    disparity_nodes = {
        node_id
        for item in disparities
        if item.building_id == building_id and item.status == "detected"
        for node_id in (item.origin_node, item.destination_node)
    }
    detected_pairs = [
        item for item in disparities if item.building_id == building_id and item.status == "detected"
    ]
    for disparity in detected_pairs:
        relevant_profiles = {disparity.general.profile, disparity.accessibility.profile}
        for row in rows:
            if (
                row.origin_node == disparity.origin_node
                and row.destination_node == disparity.destination_node
                and row.context == disparity.context
                and row.profile in relevant_profiles
            ):
                for source, destination in row.edge_keys:
                    disparity_nodes.update((source, destination))
    items: list[HeatmapItem] = []
    for node_id, node_rows in by_node.items():
        node = graph.get_node(node_id)
        if node is None:
            continue
        contributors = {row.contributor_digest for row in node_rows}
        if len(contributors) < minimum_contributors:
            continue
        profile_counts: dict[str, int] = {}
        for profile in NavigationProfile:
            profile_rows = [row for row in node_rows if row.profile == profile]
            profile_contributors = {row.contributor_digest for row in profile_rows}
            if len(profile_contributors) >= minimum_contributors:
                profile_counts[profile.value] = len(profile_rows)
        general_count = profile_counts.get(NavigationProfile.GENERAL.value, 0)
        accessibility_counts = [
            profile_counts.get(profile.value, 0)
            for profile in (
                NavigationProfile.WHEELCHAIR,
                NavigationProfile.VISUAL_IMPAIRMENT,
                NavigationProfile.BLIND_NAVIGATION,
            )
        ]
        accessible_people = {
            row.contributor_digest
            for row in node_rows
            if row.profile != NavigationProfile.GENERAL
        }
        accessible_count = (
            sum(accessibility_counts)
            if len(accessible_people) >= minimum_contributors
            else 0
        )
        report_counts = {
            obstacle_type: sum(
                1
                for row in node_rows
                for reported_node, reported_type in row.obstacle_reports
                if reported_node == node_id and reported_type == obstacle_type
            )
            for obstacle_type, people in reports_by_node[node_id].items()
            if len(people) >= minimum_contributors
        }
        items.append(
            HeatmapItem(
                node_id=node_id,
                floor_id=node.floor_id,
                x=node.x,
                y=node.y,
                general_sessions=general_count,
                accessibility_sessions=accessible_count,
                profile_sessions=profile_counts,
                disparity=node_id in disparity_nodes,
                obstacle_reports=report_counts,
            )
        )
    return sorted(items, key=lambda item: (item.floor_id, item.node_id))


class OverlayGraph:
    """Read-only graph view with explicitly simulated, non-persistent edges."""

    def __init__(self, base: NavigationGraph, edges: list[NavigationEdge]) -> None:
        self.base = base
        self.extra: dict[str, list[Neighbor]] = defaultdict(list)
        for edge in edges:
            source = base.get_node(edge.source_node)
            destination = base.get_node(edge.destination_node)
            if source is None or destination is None:
                continue
            self.extra[source.node_id].append(Neighbor(destination, edge))
            if edge.bidirectional:
                self.extra[destination.node_id].append(Neighbor(source, edge.reversed()))

    @property
    def nodes(self) -> dict[str, NavigationNode]:
        return self.base.nodes

    def get_node(self, node_id: str) -> NavigationNode | None:
        return self.base.get_node(node_id)

    def neighbors(self, node_id: str) -> tuple[Neighbor, ...]:
        return (*self.base.neighbors(node_id), *self.extra.get(node_id, ()))


def build_recommendations(
    registry: BuildingRegistry,
    contributions: Iterable[Contribution],
    disparities: Iterable[Disparity],
    thresholds: DetectionThresholds,
    store: AnalyticsStore,
) -> list[Recommendation]:
    rows = list(contributions)
    results: list[Recommendation] = []
    for disparity in disparities:
        if disparity.status not in {"detected", "unreachable"} or disparity.context != ConditionContext.TYPICAL:
            continue
        graph = registry.get(disparity.building_id)
        if graph is None:
            continue
        pair_rows = [
            row
            for row in rows
            if row.building_id == disparity.building_id
            and row.origin_node == disparity.origin_node
            and row.destination_node == disparity.destination_node
            and row.context == disparity.context
        ]
        general_rows = [row for row in pair_rows if row.profile == NavigationProfile.GENERAL and row.completed]
        used_stairs: dict[str, int] = defaultdict(int)
        for row in general_rows:
            for staircase_id in row.staircase_ids:
                used_stairs[staircase_id] += 1

        access_profile = disparity.accessibility.profile
        if used_stairs:
            for staircase_id, usage_count in used_stairs.items():
                stair_nodes = [
                    node
                    for node in graph.nodes.values()
                    if node.node_type.value == "staircase"
                    and node.staircase_connection_id == staircase_id
                ]
                vertical_edges = [
                    edge
                    for edge in graph.edges
                    if edge.connection_type == ConnectionType.STAIRS
                    and edge.source_node in {node.node_id for node in stair_nodes}
                    and edge.destination_node in {node.node_id for node in stair_nodes}
                ]
                for stair_edge in vertical_edges:
                    source = graph.get_node(stair_edge.source_node)
                    destination = graph.get_node(stair_edge.destination_node)
                    if source is None or destination is None:
                        continue
                    overlay_edge = NavigationEdge(
                        source_node=source.node_id,
                        destination_node=destination.node_id,
                        distance=stair_edge.distance,
                        connection_type=ConnectionType.ELEVATOR,
                        accessibility=AccessibilityMetadata(
                            additional={"hypothetical": True, "verified": False}
                        ),
                    )
                    overlay = OverlayGraph(graph, [overlay_edge])
                    simulated_distance: float | None
                    try:
                        simulated_distance = shortest_path(
                            overlay,
                            disparity.origin_node,
                            disparity.destination_node,
                            NavigationProfile.WHEELCHAIR,
                        )[2]
                    except NoRouteFoundError:
                        simulated_distance = None
                    try:
                        current_distance = calculate_route(
                            graph,
                            disparity.origin_node,
                            disparity.destination_node,
                            NavigationProfile.WHEELCHAIR,
                        ).total_distance
                    except NoRouteFoundError:
                        current_distance = None

                    if current_distance is not None and (
                        simulated_distance is None or simulated_distance >= current_distance
                    ):
                        continue
                    nearby_nodes: set[str] = set()
                    locations = []
                    for stair_node in (source, destination):
                        locations.append(
                            {
                                "floor_id": stair_node.floor_id,
                                "x": stair_node.x,
                                "y": stair_node.y,
                                "near_node_id": stair_node.node_id,
                                "staircase_node_id": stair_node.node_id,
                            }
                        )
                        nearby_nodes.update(
                            neighbor.node.node_id
                            for neighbor in graph.neighbors(stair_node.node_id)
                            if neighbor.node.floor_id == stair_node.floor_id
                        )
                    distance_saved = (
                        current_distance - simulated_distance
                        if current_distance is not None and simulated_distance is not None
                        else None
                    )
                    recommendation_id = "rec_" + sha256(
                        f"{disparity.building_id}|{disparity.origin_node}|{disparity.destination_node}|{staircase_id}|{access_profile.value}".encode()
                    ).hexdigest()[:20]
                    results.append(
                        Recommendation(
                            recommendation_id=recommendation_id,
                            building_id=disparity.building_id,
                            recommendation_type="accessible_vertical_connection",
                            title=f"Inspect an accessible vertical connection near staircase {staircase_id}",
                            status=store.recommendation_status(recommendation_id),
                            related_staircase_id=staircase_id,
                            candidate_locations=locations,
                            nearby_node_ids=sorted(nearby_nodes),
                            affected_origin_destination_pairs=[
                                {"origin_node": disparity.origin_node, "destination_node": disparity.destination_node}
                            ],
                            supporting_sessions=disparity.general.session_count + disparity.accessibility.session_count,
                            supporting_contributors=len(
                                {
                                    row.contributor_digest
                                    for row in pair_rows
                                    if row.profile in {NavigationProfile.GENERAL, access_profile}
                                }
                            ),
                            current_accessible_distance_m=current_distance,
                            simulated_distance_m=simulated_distance,
                            estimated_distance_saved_m=distance_saved,
                            estimated_time_saved_seconds=None,
                            confidence="moderate" if usage_count >= thresholds.minimum_sessions_per_group else "low",
                            evidence=[
                                f"The general-profile sample used this staircase in {usage_count} observed completed journeys for the affected pair.",
                                *disparity.evidence,
                                "The temporary graph simulation found a shorter or newly available wheelchair route.",
                            ],
                            limitations=[
                                "The proposal location is the mapped staircase node coordinate, not an engineered installation point.",
                                "The simulation reuses the stair edge distance as a placeholder for the hypothetical vertical connection.",
                                "Floor geometry, structure, clearances, slope, fire egress, and building code were not available; an on-site inspection is required.",
                                "No travel-time model is available, so estimated_time_saved_seconds is omitted.",
                            ],
                        )
                    )

    # Repeated, typical-condition barrier reports can warrant an inspection
    # independently of a route-time disparity.
    reports_by_location: dict[tuple[str, str, ObstacleType], list[Contribution]] = defaultdict(list)
    for row in rows:
        if row.context != ConditionContext.TYPICAL:
            continue
        for node_id, report_type in row.obstacle_reports:
            reports_by_location[(row.building_id, node_id, report_type)].append(row)
    for (building_id, node_id, report_type), report_rows in reports_by_location.items():
        contributors = {row.contributor_digest for row in report_rows}
        if (
            len(report_rows) < thresholds.minimum_sessions_per_group
            or len(contributors) < thresholds.minimum_contributors_per_group
        ):
            continue
        graph = registry.get(building_id)
        node = graph.get_node(node_id) if graph else None
        if node is None:
            continue
        recommendation_id = "rec_" + sha256(
            f"{building_id}|{node_id}|{report_type.value}".encode()
        ).hexdigest()[:20]
        results.append(
            Recommendation(
                recommendation_id=recommendation_id,
                building_id=building_id,
                recommendation_type="accessibility_inspection",
                title=f"Inspect reported {report_type.value.replace('_', ' ')} near {node_id}",
                status=store.recommendation_status(recommendation_id),
                related_staircase_id=None,
                candidate_locations=[
                    {
                        "floor_id": node.floor_id,
                        "x": node.x,
                        "y": node.y,
                        "near_node_id": node_id,
                        "staircase_node_id": node_id,
                    }
                ],
                nearby_node_ids=[node_id],
                affected_origin_destination_pairs=[],
                supporting_sessions=len(report_rows),
                supporting_contributors=len(contributors),
                current_accessible_distance_m=None,
                simulated_distance_m=None,
                estimated_distance_saved_m=None,
                estimated_time_saved_seconds=None,
                confidence="low",
                evidence=[
                    f"{len(report_rows)} voluntary reports from {len(contributors)} distinct contributors flagged this map node."
                ],
                limitations=[
                    "Reports are observations, not verified infrastructure facts.",
                    "The graph has no floor geometry or structural data; an on-site accessibility inspection is required.",
                ],
            )
        )

    unique = {item.recommendation_id: item for item in results}
    return sorted(unique.values(), key=lambda item: (item.building_id, item.recommendation_id))
