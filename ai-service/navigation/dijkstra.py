"""Dijkstra's shortest valid path implementation, independent of FastAPI."""

from heapq import heappop, heappush
from itertools import count
from math import inf

from navigation.accessibility import (
    NavigationProfile,
    RouteConstraints,
    edge_is_allowed,
    route_preference_penalty,
)
from navigation.graph import NavigationGraph
from models import NavigationEdge


class NodeNotFoundError(LookupError):
    """A route endpoint does not exist in the selected building graph."""


class NoRouteFoundError(LookupError):
    """No path satisfies the selected profile and graph connections."""


def shortest_path(
    graph: NavigationGraph,
    start_node: str,
    destination_node: str,
    profile: NavigationProfile = NavigationProfile.GENERAL,
    constraints: RouteConstraints | None = None,
) -> tuple[list[str], list[NavigationEdge], float]:
    """Return ordered node IDs, oriented route edges, and total distance.

    Edge distance is the primary route cost. Accessibility requirements are
    hard filters; equal-distance wheelchair paths prefer verified accessible
    entrances, ramps, and elevators.
    """
    if graph.get_node(start_node) is None:
        raise NodeNotFoundError(f"start node not found: {start_node}")
    if graph.get_node(destination_node) is None:
        raise NodeNotFoundError(f"destination node not found: {destination_node}")
    if start_node == destination_node:
        return [start_node], [], 0.0

    constraints = constraints or RouteConstraints()
    distances = {node_id: inf for node_id in graph.nodes}
    preference_costs = {node_id: inf for node_id in graph.nodes}
    distances[start_node] = 0.0
    preference_costs[start_node] = 0
    previous: dict[str, tuple[str, NavigationEdge]] = {}
    visited: set[str] = set()
    sequence = count()
    queue: list[tuple[float, int, int, str]] = [(0.0, 0, next(sequence), start_node)]

    while queue:
        distance_so_far, _, _, node_id = heappop(queue)
        if node_id in visited:
            continue
        visited.add(node_id)
        if node_id == destination_node:
            break

        source = graph.get_node(node_id)
        assert source is not None
        for neighbor in graph.neighbors(node_id):
            if neighbor.node.node_id in visited:
                continue
            if not edge_is_allowed(neighbor.edge, source, neighbor.node, profile, constraints):
                continue
            candidate_distance = distance_so_far + neighbor.edge.distance
            current_distance = distances[neighbor.node.node_id]
            candidate_preference = preference_costs[node_id] + route_preference_penalty(
                neighbor.edge, profile
            )
            current_preference = preference_costs[neighbor.node.node_id]
            if candidate_distance < current_distance or (
                candidate_distance == current_distance and candidate_preference < current_preference
            ):
                distances[neighbor.node.node_id] = candidate_distance
                preference_costs[neighbor.node.node_id] = candidate_preference
                previous[neighbor.node.node_id] = (node_id, neighbor.edge)
                heappush(
                    queue,
                    (candidate_distance, candidate_preference, next(sequence), neighbor.node.node_id),
                )

    if distances[destination_node] == inf:
        raise NoRouteFoundError(
            f"no valid route from {start_node!r} to {destination_node!r} for {profile.value} profile"
        )

    route_nodes = [destination_node]
    route_edges: list[NavigationEdge] = []
    current = destination_node
    while current != start_node:
        parent, edge = previous[current]
        route_edges.append(edge)
        route_nodes.append(parent)
        current = parent
    route_nodes.reverse()
    route_edges.reverse()
    return route_nodes, route_edges, distances[destination_node]
