"""Consent, authentication, expiry, and raw contribution access tests."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from analytics.schemas import ConditionContext, ObstacleType
from analytics.security import AnalyticsSettings
from analytics.store import AnalyticsStore, Contribution
from main import create_app
from models import Building, ConnectionType, Floor, NavigationEdge, NavigationNode, NodeType
from navigation.accessibility import NavigationProfile
from navigation.registry import BuildingRegistry
from tests.test_api import ApiTestClient


def graph_building() -> Building:
    nodes = [
        NavigationNode(
            node_id="A", building_id="B1", floor_id="G", x=0, y=0, node_type=NodeType.ENTRANCE
        ),
        NavigationNode(
            node_id="B", building_id="B1", floor_id="G", x=5, y=0, node_type=NodeType.DOOR
        ),
    ]
    edges = [
        NavigationEdge(
            source_node="A",
            destination_node="B",
            distance=5,
            connection_type=ConnectionType.DOORWAY,
        )
    ]
    return Building(
        building_id="B1",
        floors=[Floor(floor_id="G", level=0)],
        nodes=nodes,
        edges=edges,
    )


def make_client(*, admin_token: str | None = "admin-secret"):
    settings = AnalyticsSettings(
        service_token="service-secret",
        admin_token=admin_token,
        contributor_hash_secret="pseudonymization-secret",
        retention_hours=24,
        navigation_session_max_hours=2,
        explicit_expiry_max_hours=24,
        minimum_sessions_per_group=2,
        minimum_contributors_per_group=2,
    )
    store = AnalyticsStore(retention_hours=24)
    app = create_app(
        registry=BuildingRegistry([graph_building()]),
        analytics_settings=settings,
        analytics_store=store,
        allowed_origins=[],
    )
    return ApiTestClient(app), store


def start(client: ApiTestClient, **overrides):
    headers = {
        "X-Accesu-Service-Key": "service-secret",
        "X-Accesu-Contributor-Ref": "a" * 64,
    }
    body = {
        "building_id": "B1",
        "consent_given": True,
        "consent_version": "consent-v1",
        "duration_choice": "this_navigation",
    }
    body.update(overrides)
    response = client.post("/navigation/sessions/start", json=body, headers=headers)
    return response, headers


def event_payload(**overrides):
    payload = {
        "event_id": str(uuid4()),
        "origin_node": "A",
        "destination_node": "B",
        "profile": "general",
        "completed": True,
        "duration_seconds": 60,
        "node_sequence": ["A", "B"],
        "context": "typical",
        "obstacle_reports": [],
    }
    payload.update(overrides)
    return payload


def session_headers(headers: dict[str, str], session_token: str) -> dict[str, str]:
    return {**headers, "X-Accesu-Session-Token": session_token}


def test_collection_requires_service_auth_and_explicit_consent() -> None:
    client, _ = make_client()
    with client:
        no_service_key = client.post(
            "/navigation/sessions/start",
            json={
                "building_id": "B1",
                "consent_given": True,
                "consent_version": "v1",
                "duration_choice": "this_navigation",
            },
            headers={"X-Accesu-Contributor-Ref": "a" * 64},
        )
        assert no_service_key.status_code == 401

        no_consent, headers = start(client, consent_given=False)
        assert no_consent.status_code == 422
        assert no_consent.json()["success"] is False

        started, _ = start(client)
        assert started.status_code == 201
        assert started.json()["status"] == "active"
        assert started.json()["expires_at"]


def test_sessions_pause_resume_finish_and_delete_contribution() -> None:
    client, store = make_client()
    with client:
        started, headers = start(client)
        session_id = started.json()["session_id"]
        token_headers = session_headers(headers, started.json()["session_token"])

        paused = client.post(f"/navigation/sessions/{session_id}/pause", headers=token_headers)
        assert paused.status_code == 200
        assert paused.json()["status"] == "paused"

        blocked = client.post(
            f"/navigation/sessions/{session_id}/events",
            json=event_payload(),
            headers=token_headers,
        )
        assert blocked.status_code == 409

        resumed = client.post(f"/navigation/sessions/{session_id}/resume", headers=token_headers)
        assert resumed.status_code == 200
        recorded = client.post(
            f"/navigation/sessions/{session_id}/events",
            json=event_payload(),
            headers=token_headers,
        )
        assert recorded.status_code == 201
        assert recorded.json()["distance_m"] == 5
        assert recorded.json()["route_nodes_retained"] is False
        assert len(store.contributions()) == 1

        finished = client.post(f"/navigation/sessions/{session_id}/finish", headers=token_headers)
        assert finished.status_code == 200
        assert finished.json()["status"] == "finished"
        after_finish = client.post(
            f"/navigation/sessions/{session_id}/events",
            json=event_payload(event_id=str(uuid4())),
            headers=token_headers,
        )
        assert after_finish.status_code == 409

        deleted = client.delete(
            f"/navigation/sessions/{session_id}/contributions", headers=token_headers
        )
        assert deleted.status_code == 200
        assert deleted.json()["deleted_contributions"] == 1
        assert store.contributions() == ()


def test_expired_session_rejects_events_server_side() -> None:
    client, store = make_client()
    with client:
        started, headers = start(client)
        session_id = started.json()["session_id"]
        token_headers = session_headers(headers, started.json()["session_token"])
        store._sessions[next(key for key in store._sessions if str(key) == session_id)].expires_at = (
            datetime.now(timezone.utc) - timedelta(seconds=1)
        )

        response = client.post(
            f"/navigation/sessions/{session_id}/events",
            json=event_payload(),
            headers=token_headers,
        )
        assert response.status_code == 410
        assert "expired" in response.json()["message"]
        assert store.contributions() == ()


def test_until_expiry_requires_a_bounded_explicit_expiration() -> None:
    client, _ = make_client()
    with client:
        missing = start(client, duration_choice="until_expiry")[0]
        assert missing.status_code == 422

        too_far = start(
            client,
            duration_choice="until_expiry",
            expires_at=(datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
        )[0]
        assert too_far.status_code == 422

        valid = start(
            client,
            duration_choice="until_expiry",
            expires_at=(datetime.now(timezone.utc) + timedelta(hours=4)).isoformat(),
        )[0]
        assert valid.status_code == 201


def test_invalid_or_profile_inaccessible_node_sequence_is_rejected() -> None:
    client, store = make_client()
    with client:
        started, headers = start(client)
        session_id = started.json()["session_id"]
        token_headers = session_headers(headers, started.json()["session_token"])
        bad_path = client.post(
            f"/navigation/sessions/{session_id}/events",
            json=event_payload(node_sequence=["A", "MISSING", "B"]),
            headers=token_headers,
        )
        assert bad_path.status_code == 422
        assert store.contributions() == ()


def test_admin_analytics_requires_admin_token_and_never_returns_sessions() -> None:
    client, _ = make_client()
    with client:
        unauthenticated = client.get("/analytics/accessibility/overview")
        assert unauthenticated.status_code == 401

        authorized = client.get(
            "/analytics/accessibility/overview",
            headers={"Authorization": "Bearer admin-secret"},
        )
        assert authorized.status_code == 200
        body = authorized.json()
        assert body["success"] is True
        assert "session_id" not in body


def test_admin_analytics_fail_closed_when_secret_not_configured() -> None:
    client, _ = make_client(admin_token=None)
    with client:
        response = client.get("/analytics/accessibility/overview")
        assert response.status_code == 503


def test_admin_heatmap_and_recommendations_are_aggregate_only() -> None:
    client, store = make_client()
    for index in range(2):
        store.add_contribution(
            Contribution(
                event_id=uuid4(),
                session_id=uuid4(),
                contributor_digest=f"opaque-contributor-{index}",
                building_id="B1",
                origin_node="A",
                destination_node="B",
                profile=NavigationProfile.GENERAL,
                context=ConditionContext.TYPICAL,
                completed=True,
                duration_seconds=60 + index,
                distance_m=5,
                edge_keys=(("A", "B"),),
                staircase_ids=(),
                obstacle_reports=(("B", ObstacleType.NARROW_PASSAGE),),
                created_at=datetime.now(timezone.utc),
            )
        )

    headers = {"Authorization": "Bearer admin-secret"}
    with client:
        bad_role = client.get(
            "/analytics/accessibility/overview",
            headers={"Authorization": "Bearer student-token"},
        )
        assert bad_role.status_code == 403

        overview = client.get("/analytics/accessibility/overview", headers=headers)
        assert overview.status_code == 200
        assert overview.json()["eligible_pairs"] == 0

        heatmap = client.get("/analytics/accessibility/heatmap/B1", headers=headers)
        assert heatmap.status_code == 200
        items = heatmap.json()["items"]
        assert len(items) == 2
        assert all(item["profile_sessions"]["general"] == 2 for item in items)
        assert "contributor_digest" not in heatmap.text
        assert "session_id" not in heatmap.text

        recs = client.get("/analytics/accessibility/recommendations", headers=headers)
        assert recs.status_code == 200
        rec = recs.json()["recommendations"][0]
        assert rec["recommendation_type"] == "accessibility_inspection"
        assert rec["supporting_contributors"] == 2
        assert rec["requires_physical_inspection"] is True

        updated = client.post(
            f"/analytics/accessibility/recommendations/{rec['recommendation_id']}/status",
            json={"status": "under_inspection"},
            headers=headers,
        )
        assert updated.status_code == 200
        assert updated.json()["status"] == "under_inspection"

        detail = client.get(
            f"/analytics/accessibility/recommendations/{rec['recommendation_id']}",
            headers=headers,
        )
        assert detail.status_code == 200
        assert detail.json()["recommendation"]["status"] == "under_inspection"
