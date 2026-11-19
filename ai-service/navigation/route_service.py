"""Build complete route results from the graph and Dijkstra path output."""

from pydantic import BaseModel, ConfigDict

from models import NavigationEdge, NavigationNode
from navigation.accessibility import NavigationProfile, RouteConstraints
from navigation.dijkstra import shortest_path
from navigation.graph import NavigationGraph


class FloorTransition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    from_floor: int
    to_floor: int
    from_floor_id: str
    to_floor_id: str
    type: str


class RouteResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    building_id: str
    route: list[str]
    nodes: list[NavigationNode]
    edges: list[NavigationEdge]
    total_distance: float
    floor_transitions: list[FloorTransition]


def calculate_route(
    graph: NavigationGraph,
    start_node: str,
    destination_node: str,
    profile: NavigationProfile = NavigationProfile.GENERAL,
    constraints: RouteConstraints | None = None,
) -> RouteResult:
    """Calculate a valid route and retain verified node/edge context for clients."""
    route, edges, total_distance = shortest_path(
        graph=graph,
        start_node=start_node,
        destination_node=destination_node,
        profile=profile,
        constraints=constraints,
    )
    nodes = [graph.get_node(node_id) for node_id in route]
    # shortest_path validates route IDs against this graph.
    route_nodes = [node for node in nodes if node is not None]
    floor_levels = graph.floor_levels
    transitions: list[FloorTransition] = []
    for source, destination, edge in zip(route_nodes, route_nodes[1:], edges):
        if source.floor_id != destination.floor_id:
            transitions.append(
                FloorTransition(
                    from_floor=floor_levels[source.floor_id],
                    to_floor=floor_levels[destination.floor_id],
                    from_floor_id=source.floor_id,
                    to_floor_id=destination.floor_id,
                    type=edge.connection_type.value,
                )
            )

    return RouteResult(
        building_id=graph.building_id,
        route=route,
        nodes=route_nodes,
        edges=edges,
        total_distance=total_distance,
        floor_transitions=transitions,
    )
