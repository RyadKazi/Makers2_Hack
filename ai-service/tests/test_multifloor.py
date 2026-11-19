"""Three-floor graph and vertical-connection tests."""

import unittest

from pydantic import ValidationError

from models import Building, ConnectionType, Floor, NavigationEdge, NavigationNode, NodeType
from navigation.accessibility import NavigationProfile
from navigation.dijkstra import NoRouteFoundError
from navigation.graph import NavigationGraph
from navigation.route_service import calculate_route


def stair(node_id: str, floor_id: str, x: float) -> NavigationNode:
    return NavigationNode(
        node_id=node_id,
        building_id="LIBRARY",
        floor_id=floor_id,
        x=x,
        y=8,
        node_type=NodeType.STAIRCASE,
        staircase_connection_id="NORTH_STAIR",
    )


def three_floor_stair_building() -> Building:
    floors = [
        Floor(floor_id="G", level=0, name="Ground"),
        Floor(floor_id="F1", level=1, name="First"),
        Floor(floor_id="F2", level=2, name="Second"),
    ]
    nodes = [
        NavigationNode(
            node_id="ENTRANCE",
            building_id="LIBRARY",
            floor_id="G",
            x=1,
            y=1,
            node_type=NodeType.ENTRANCE,
        ),
        stair("STAIR_G", "G", 5),
        stair("STAIR_F1", "F1", 5),
        stair("STAIR_F2", "F2", 5),
        NavigationNode(
            node_id="ROOM_F2",
            building_id="LIBRARY",
            floor_id="F2",
            x=9,
            y=9,
            node_type=NodeType.DOOR,
            is_destination=True,
            label="Room 205",
        ),
    ]
    edges = [
        NavigationEdge(
            source_node="ENTRANCE",
            destination_node="STAIR_G",
            distance=4,
            connection_type=ConnectionType.CORRIDOR,
        ),
        NavigationEdge(
            source_node="STAIR_G",
            destination_node="STAIR_F1",
            distance=6,
            connection_type=ConnectionType.STAIRS,
        ),
        NavigationEdge(
            source_node="STAIR_F1",
            destination_node="STAIR_F2",
            distance=6,
            connection_type=ConnectionType.STAIRS,
        ),
        NavigationEdge(
            source_node="STAIR_F2",
            destination_node="ROOM_F2",
            distance=3,
            connection_type=ConnectionType.DOORWAY,
        ),
    ]
    return Building(building_id="LIBRARY", floors=floors, nodes=nodes, edges=edges)


class MultiFloorTests(unittest.TestCase):
    def test_stair_nodes_link_the_same_staircase_across_three_floors(self) -> None:
        graph = NavigationGraph(three_floor_stair_building())

        result = calculate_route(
            graph,
            "ENTRANCE",
            "ROOM_F2",
            profile=NavigationProfile.GENERAL,
        )

        self.assertEqual(
            result.route,
            ["ENTRANCE", "STAIR_G", "STAIR_F1", "STAIR_F2", "ROOM_F2"],
        )
        self.assertEqual(result.total_distance, 19)
        self.assertEqual(
            [(step.from_floor, step.to_floor, step.type) for step in result.floor_transitions],
            [(0, 1, "stairs"), (1, 2, "stairs")],
        )
        self.assertEqual(result.floor_transitions[0].from_floor_id, "G")
        self.assertEqual(result.floor_transitions[1].to_floor_id, "F2")

    def test_wheelchair_profile_excludes_stairs(self) -> None:
        graph = NavigationGraph(three_floor_stair_building())

        with self.assertRaises(NoRouteFoundError):
            calculate_route(
                graph,
                "ENTRANCE",
                "ROOM_F2",
                profile=NavigationProfile.WHEELCHAIR,
            )

    def test_cross_floor_corridor_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValidationError, "only stairs, elevators, and ramps"):
            Building(
                building_id="B1",
                floors=[Floor(floor_id="G", level=0), Floor(floor_id="F1", level=1)],
                nodes=[
                    NavigationNode(
                        node_id="A",
                        building_id="B1",
                        floor_id="G",
                        x=0,
                        y=0,
                        node_type=NodeType.WAYPOINT,
                    ),
                    NavigationNode(
                        node_id="B",
                        building_id="B1",
                        floor_id="F1",
                        x=0,
                        y=0,
                        node_type=NodeType.WAYPOINT,
                    ),
                ],
                edges=[
                    NavigationEdge(
                        source_node="A",
                        destination_node="B",
                        distance=1,
                        connection_type=ConnectionType.CORRIDOR,
                    )
                ],
            )

    def test_stair_edge_requires_matching_physical_staircase_id(self) -> None:
        first = stair("S0", "G", 0)
        second = stair("S1", "F1", 0).model_copy(
            update={"staircase_connection_id": "SOUTH_STAIR"}
        )
        with self.assertRaisesRegex(ValidationError, "same physical staircase"):
            Building(
                building_id="LIBRARY",
                floors=[Floor(floor_id="G", level=0), Floor(floor_id="F1", level=1)],
                nodes=[first, second],
                edges=[
                    NavigationEdge(
                        source_node="S0",
                        destination_node="S1",
                        distance=5,
                        connection_type=ConnectionType.STAIRS,
                    )
                ],
            )


if __name__ == "__main__":
    unittest.main()
