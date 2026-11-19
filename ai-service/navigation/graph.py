"""Graph construction from explicit university-defined nodes and edges."""

from dataclasses import dataclass

from pydantic import ValidationError

from models import Building, NavigationEdge, NavigationNode


class GraphValidationError(ValueError):
    """Raised when graph data has missing, duplicate, or invalid connections."""


@dataclass(frozen=True)
class Neighbor:
    node: NavigationNode
    edge: NavigationEdge


class NavigationGraph:
    """A building graph with only administrator-declared connections.

    The graph never infers edges from coordinates. Cross-floor connections are
    validated against the floor and node metadata in the building model.
    """

    def __init__(self, building: Building) -> None:
        self._building = building
        self._nodes: dict[str, NavigationNode] = {}
        self._edges: list[NavigationEdge] = []
        self._adjacency: dict[str, list[Neighbor]] = {}
        for node in building.nodes:
            self._add_node_unchecked(node)
        for edge in building.edges:
            self._add_edge_unchecked(edge)

    @property
    def building(self) -> Building:
        return self._building

    @property
    def building_id(self) -> str:
        return self._building.building_id

    @property
    def nodes(self) -> dict[str, NavigationNode]:
        return dict(self._nodes)

    @property
    def edges(self) -> tuple[NavigationEdge, ...]:
        return tuple(self._edges)

    @property
    def floor_levels(self) -> dict[str, int]:
        return {floor.floor_id: floor.level for floor in self._building.floors}

    def get_node(self, node_id: str) -> NavigationNode | None:
        return self._nodes.get(node_id)

    def neighbors(self, node_id: str) -> tuple[Neighbor, ...]:
        return tuple(self._adjacency.get(node_id, ()))

    def add_node(self, node: NavigationNode) -> None:
        """Register an explicit node, rejecting duplicate IDs and unknown floors."""
        if node.node_id in self._nodes:
            raise GraphValidationError(f"duplicate node ID: {node.node_id}")
        if node.building_id != self.building_id:
            raise GraphValidationError("node belongs to a different building")
        if node.floor_id not in self.floor_levels:
            raise GraphValidationError(f"unknown floor ID: {node.floor_id}")
        self._add_node_unchecked(node)
        self._building = self._building.model_copy(update={"nodes": [*self._building.nodes, node]})

    def add_edge(self, edge: NavigationEdge) -> None:
        """Register a verified connection between existing nodes."""
        candidate = self._building.model_dump()
        candidate["edges"] = [*candidate["edges"], edge.model_dump()]
        try:
            validated = Building.model_validate(candidate)
        except ValidationError as exc:
            raise GraphValidationError(str(exc)) from exc
        self._add_edge_unchecked(edge)
        self._building = validated

    def _add_node_unchecked(self, node: NavigationNode) -> None:
        self._nodes[node.node_id] = node
        self._adjacency[node.node_id] = []

    def _add_edge_unchecked(self, edge: NavigationEdge) -> None:
        source = self._nodes.get(edge.source_node)
        destination = self._nodes.get(edge.destination_node)
        if source is None or destination is None:
            raise GraphValidationError(
                f"edge references unknown node: {edge.source_node!r}->{edge.destination_node!r}"
            )
        # Validate the full building so edge type, floor transition, and stair
        # connection identity remain consistent for both bulk and incremental data.
        candidate = self._building.model_dump()
        candidate["nodes"] = [node.model_dump() for node in self._nodes.values()]
        candidate["edges"] = [item.model_dump() for item in self._edges] + [edge.model_dump()]
        try:
            Building.model_validate(candidate)
        except ValidationError as exc:
            raise GraphValidationError(str(exc)) from exc

        self._edges.append(edge)
        self._adjacency[edge.source_node].append(Neighbor(destination, edge))
        if edge.bidirectional:
            self._adjacency[edge.destination_node].append(Neighbor(source, edge.reversed()))
