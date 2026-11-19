"""Accessibility profile behavior and conservative metadata handling."""

import unittest

from models import AccessibilityMetadata, ConnectionType, NavigationEdge, NavigationNode, NodeType
from navigation.accessibility import NavigationProfile, RouteConstraints
from navigation.dijkstra import NoRouteFoundError
from navigation.graph import NavigationGraph
from navigation.route_service import calculate_route
from tests.test_dijkstra import building, edge, node


class AccessibilityTests(unittest.TestCase):
    def test_equal_distance_wheelchair_route_prefers_verified_accessible_entrance(self) -> None:
        graph = NavigationGraph(
            building(
                [node("A"), node("VERIFIED"), node("UNKNOWN"), node("DEST")],
                [
                    edge(
                        "A",
                        "VERIFIED",
                        1,
                        ConnectionType.ENTRANCE,
                        accessibility=AccessibilityMetadata(accessible=True, verified=True),
                    ),
                    edge("VERIFIED", "DEST", 1),
                    edge("A", "UNKNOWN", 1, ConnectionType.ENTRANCE),
                    edge("UNKNOWN", "DEST", 1),
                ],
            )
        )

        result = calculate_route(graph, "A", "DEST", profile=NavigationProfile.WHEELCHAIR)
        self.assertEqual(result.route, ["A", "VERIFIED", "DEST"])

    def test_wheelchair_selects_alternative_to_inaccessible_connection(self) -> None:
        graph = NavigationGraph(
            building(
                [node("A"), node("B"), node("C"), node("D")],
                [
                    edge("A", "D", 2, accessibility=AccessibilityMetadata(accessible=False)),
                    edge("A", "B", 1),
                    edge("B", "C", 1),
                    edge("C", "D", 1),
                ],
            )
        )

        result = calculate_route(graph, "A", "D", profile=NavigationProfile.WHEELCHAIR)

        self.assertEqual(result.route, ["A", "B", "C", "D"])
        self.assertEqual(result.total_distance, 3)

    def test_blocked_connection_is_excluded_for_general_profile(self) -> None:
        graph = NavigationGraph(
            building(
                [node("A"), node("B"), node("C")],
                [
                    edge("A", "B", 1, accessibility=AccessibilityMetadata(blocked=True)),
                    edge("A", "C", 2),
                    edge("C", "B", 2),
                ],
            )
        )

        result = calculate_route(graph, "A", "B", profile=NavigationProfile.GENERAL)
        self.assertEqual(result.route, ["A", "C", "B"])

    def test_known_narrow_door_is_filtered_when_user_threshold_is_set(self) -> None:
        door = node(
            "DOOR",
            node_type=NodeType.DOOR,
            accessibility=AccessibilityMetadata(door_width_m=0.7, verified=True),
        )
        graph = NavigationGraph(
            building(
                [node("A"), door, node("B")],
                [
                    edge("A", "DOOR", 1, ConnectionType.DOORWAY),
                    edge("DOOR", "B", 1),
                ],
            )
        )

        with self.assertRaises(NoRouteFoundError):
            calculate_route(
                graph,
                "A",
                "B",
                profile=NavigationProfile.WHEELCHAIR,
                constraints=RouteConstraints(minimum_door_width_m=0.8),
            )

    def test_unknown_door_width_is_not_fabricated_or_rejected_by_default(self) -> None:
        door = node("DOOR", node_type=NodeType.DOOR)
        graph = NavigationGraph(
            building(
                [node("A"), door],
                [edge("A", "DOOR", 1, ConnectionType.DOORWAY)],
            )
        )

        result = calculate_route(graph, "A", "DOOR", profile=NavigationProfile.WHEELCHAIR)
        self.assertEqual(result.route, ["A", "DOOR"])
        self.assertIsNone(result.nodes[-1].accessibility.door_width_m)


if __name__ == "__main__":
    unittest.main()
