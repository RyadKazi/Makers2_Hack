"""Shortest-path and core graph validation tests."""

import unittest

from pydantic import ValidationError

from models import Building, ConnectionType, Floor, NavigationEdge, NavigationNode, NodeType
from navigation.accessibility import NavigationProfile
from navigation.dijkstra import NodeNotFoundError, NoRouteFoundError
from navigation.graph import GraphValidationError, NavigationGraph
from navigation.route_service import calculate_route


def node(node_id: str, floor_id: str = "G", **kwargs: object) -> NavigationNode:
    kwargs.setdefault("node_type", NodeType.WAYPOINT)
    return NavigationNode(
        node_id=node_id,
        building_id="B1",
        floor_id=floor_id,
        x=0,
        y=0,
        **kwargs,
    )


def edge(
    source: str,
    destination: str,
    distance: float,
    connection_type: ConnectionType = ConnectionType.CORRIDOR,
    **kwargs: object,
) -> NavigationEdge:
    return NavigationEdge(
        source_node=source,
        destination_node=destination,
        distance=distance,
        connection_type=connection_type,
        **kwargs,
    )


def building(nodes: list[NavigationNode], edges: list[NavigationEdge]) -> Building:
    return Building(
        building_id="B1",
        floors=[Floor(floor_id="G", level=0)],
        nodes=nodes,
        edges=edges,
    )


class DijkstraTests(unittest.TestCase):
    def test_shortest_path_on_one_floor(self) -> None:
        graph = NavigationGraph(
            building(
                [node("A"), node("B"), node("C"), node("D")],
                [edge("A", "B", 3), edge("B", "D", 3), edge("A", "C", 1), edge("C", "D", 2)],
            )
        )

        result = calculate_route(graph, "A", "D")

        self.assertEqual(result.route, ["A", "C", "D"])
        self.assertEqual(result.total_distance, 3)
        self.assertEqual(len(result.edges), 2)
        self.assertEqual(result.floor_transitions, [])

    def test_missing_start_or_destination_is_clear(self) -> None:
        graph = NavigationGraph(building([node("A")], []))
        with self.assertRaisesRegex(NodeNotFoundError, "start node not found"):
            calculate_route(graph, "missing", "A")
        with self.assertRaisesRegex(NodeNotFoundError, "destination node not found"):
            calculate_route(graph, "A", "missing")

    def test_no_route_is_clear(self) -> None:
        graph = NavigationGraph(building([node("A"), node("B")], []))
        with self.assertRaisesRegex(NoRouteFoundError, "no valid route"):
            calculate_route(graph, "A", "B")

    def test_same_start_and_destination_has_zero_distance(self) -> None:
        graph = NavigationGraph(building([node("A")], []))
        result = calculate_route(graph, "A", "A")
        self.assertEqual(result.route, ["A"])
        self.assertEqual(result.total_distance, 0)
        self.assertEqual(result.edges, [])

    def test_empty_graph_rejects_route_endpoint(self) -> None:
        graph = NavigationGraph(building([], []))
        with self.assertRaises(NodeNotFoundError):
            calculate_route(graph, "A", "B")

    def test_negative_edge_distance_is_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            edge("A", "B", -1)

    def test_door_destination_is_preserved_in_result(self) -> None:
        door = node(
            "ROOM_105_DOOR",
            node_type=NodeType.DOOR,
            is_destination=True,
            label="Room 105",
        )
        graph = NavigationGraph(
            building(
                [node("CORRIDOR"), door],
                [edge("CORRIDOR", "ROOM_105_DOOR", 2, ConnectionType.DOORWAY)],
            )
        )

        result = calculate_route(graph, "CORRIDOR", "ROOM_105_DOOR")

        self.assertEqual(result.route, ["CORRIDOR", "ROOM_105_DOOR"])
        self.assertTrue(result.nodes[-1].is_destination)
        self.assertEqual(result.nodes[-1].node_type, NodeType.DOOR)

    def test_duplicate_node_ids_are_rejected(self) -> None:
        with self.assertRaisesRegex(ValidationError, "node IDs must be unique"):
            building([node("A"), node("A")], [])

    def test_incremental_duplicate_node_is_rejected(self) -> None:
        graph = NavigationGraph(building([node("A")], []))
        with self.assertRaisesRegex(GraphValidationError, "duplicate node ID"):
            graph.add_node(node("A"))

    def test_only_declared_connections_are_traversable(self) -> None:
        graph = NavigationGraph(building([node("A"), node("B")], []))
        with self.assertRaises(NoRouteFoundError):
            calculate_route(graph, "A", "B")

    def test_one_way_edge_is_not_traversable_in_reverse(self) -> None:
        graph = NavigationGraph(
            building([node("A"), node("B")], [edge("A", "B", 1, bidirectional=False)])
        )
        self.assertEqual(calculate_route(graph, "A", "B").route, ["A", "B"])
        with self.assertRaises(NoRouteFoundError):
            calculate_route(graph, "B", "A")


if __name__ == "__main__":
    unittest.main()
