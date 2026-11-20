"""HTTP contract tests for the FastAPI navigation service."""

import asyncio
from typing import Any

import httpx

from main import create_app
from models import Building, ConnectionType, Floor, NavigationEdge, NavigationNode, NodeType
from navigation.registry import BuildingRegistry


def make_building(building_id: str = "BUILDING_A", shared_node_id: str = "ENTRANCE") -> Building:
    floors = [Floor(floor_id="G", level=0), Floor(floor_id="F1", level=1)]
    nodes = [
        NavigationNode(
            node_id=shared_node_id,
            building_id=building_id,
            floor_id="G",
            x=0,
            y=0,
            node_type=NodeType.ENTRANCE,
        ),
        NavigationNode(
            node_id="JUNCTION",
            building_id=building_id,
            floor_id="G",
            x=4,
            y=0,
            node_type=NodeType.CORRIDOR_INTERSECTION,
            accessibility={"landmarks": ["North corridor junction"]},
        ),
        NavigationNode(
            node_id="ROOM_105",
            building_id=building_id,
            floor_id="G",
            x=8,
            y=0,
            node_type=NodeType.DOOR,
            is_destination=True,
            label="Room 105",
        ),
        NavigationNode(
            node_id="ISOLATED",
            building_id=building_id,
            floor_id="F1",
            x=2,
            y=2,
            node_type=NodeType.DOOR,
            is_destination=True,
        ),
    ]
    edges = [
        NavigationEdge(
            source_node=shared_node_id,
            destination_node="JUNCTION",
            distance=4,
            connection_type=ConnectionType.CORRIDOR,
        ),
        NavigationEdge(
            source_node="JUNCTION",
            destination_node="ROOM_105",
            distance=3,
            connection_type=ConnectionType.DOORWAY,
        ),
    ]
    return Building(building_id=building_id, floors=floors, nodes=nodes, edges=edges)


class ApiTestClient:
    """Synchronous test helper over HTTPX's ASGI transport."""

    def __init__(self, app: Any) -> None:
        self.app = app

    def __enter__(self) -> "ApiTestClient":
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        return None

    def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        async def send() -> httpx.Response:
            transport = httpx.ASGITransport(app=self.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                return await client.request(method, path, **kwargs)

        return asyncio.run(send())

    def get(self, path: str, **kwargs: Any) -> httpx.Response:
        return self._request("GET", path, **kwargs)

    def post(self, path: str, **kwargs: Any) -> httpx.Response:
        return self._request("POST", path, **kwargs)

    def options(self, path: str, **kwargs: Any) -> httpx.Response:
        return self._request("OPTIONS", path, **kwargs)


def make_client(*buildings: Building) -> ApiTestClient:
    registry = BuildingRegistry(buildings)
    return ApiTestClient(create_app(registry=registry, allowed_origins=["http://localhost:3000"]))


def test_service_health_and_swagger_are_available() -> None:
    with make_client(make_building()) as client:
        assert client.get("/").json()["status"] == "ok"
        assert client.get("/health").json()["available_buildings"] == 1
        assert client.get("/docs").status_code == 200
        assert client.get("/openapi.json").status_code == 200


def test_building_list_and_detail() -> None:
    with make_client(make_building()) as client:
        listing = client.get("/buildings")
        assert listing.status_code == 200
        assert listing.json()["buildings"][0] == {
            "building_id": "BUILDING_A",
            "name": None,
            "floors": 2,
            "nodes": 4,
            "edges": 2,
        }

        detail = client.get("/buildings/BUILDING_A")
        assert detail.status_code == 200
        assert [floor["floor_id"] for floor in detail.json()["building"]["floors"]] == ["G", "F1"]


def test_route_endpoint_returns_calculated_path_and_metadata() -> None:
    with make_client(make_building()) as client:
        response = client.post(
            "/navigation/route",
            json={
                "building_id": "BUILDING_A",
                "start_node": "ENTRANCE",
                "destination_node": "ROOM_105",
                "profile": "visual_impairment",
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert body["route"]["nodes"] == ["ENTRANCE", "JUNCTION", "ROOM_105"]
        assert body["route"]["total_distance"] == 7
        assert body["route"]["profile"] == "visual_impairment"
        assert body["route"]["floor_transitions"] == []
        assert body["route"]["node_details"][1]["accessibility"]["landmarks"] == [
            "North corridor junction"
        ]
        assert [edge["source_node"] for edge in body["route"]["edges"]] == [
            "ENTRANCE",
            "JUNCTION",
        ]


def test_unknown_building_node_and_profile_errors() -> None:
    with make_client(make_building()) as client:
        missing_building = client.post(
            "/navigation/route",
            json={
                "building_id": "UNKNOWN",
                "start_node": "ENTRANCE",
                "destination_node": "ROOM_105",
            },
        )
        assert missing_building.status_code == 404
        assert missing_building.json() == {"success": False, "message": "Building not found"}

        missing_node = client.post(
            "/navigation/route",
            json={
                "building_id": "BUILDING_A",
                "start_node": "UNKNOWN_NODE",
                "destination_node": "ROOM_105",
            },
        )
        assert missing_node.status_code == 404
        assert "start node not found" in missing_node.json()["message"]

        bad_profile = client.post(
            "/navigation/route",
            json={
                "building_id": "BUILDING_A",
                "start_node": "ENTRANCE",
                "destination_node": "ROOM_105",
                "profile": "teleport",
            },
        )
        assert bad_profile.status_code == 422
        assert bad_profile.json()["success"] is False
        assert bad_profile.json()["message"] == "Request validation failed"


def test_no_valid_route_is_422() -> None:
    with make_client(make_building()) as client:
        response = client.post(
            "/navigation/route",
            json={
                "building_id": "BUILDING_A",
                "start_node": "ENTRANCE",
                "destination_node": "ISOLATED",
                "profile": "general",
            },
        )
        assert response.status_code == 422
        assert "no valid route" in response.json()["message"]


def test_node_lookup_and_ambiguous_ids() -> None:
    with make_client(
        make_building("BUILDING_A", "ENTRANCE"),
        make_building("BUILDING_B", "ENTRANCE"),
    ) as client:
        ambiguous = client.get("/navigation/nodes/ENTRANCE")
        assert ambiguous.status_code == 409
        assert "building_id" in ambiguous.json()["message"]

        specific = client.get("/navigation/nodes/ENTRANCE?building_id=BUILDING_B")
        assert specific.status_code == 200
        assert specific.json()["node"]["building_id"] == "BUILDING_B"


def test_cors_allows_configured_frontend_origin() -> None:
    with make_client(make_building()) as client:
        response = client.options(
            "/navigation/route",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
