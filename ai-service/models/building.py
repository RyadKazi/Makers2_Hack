"""Building and floor containers for the administrator-authored graph."""

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .edge import NavigationEdge
from .node import NavigationNode


class Floor(BaseModel):
    model_config = ConfigDict(extra="forbid")

    floor_id: str = Field(min_length=1)
    level: int
    name: str | None = None


class Building(BaseModel):
    model_config = ConfigDict(extra="forbid")

    building_id: str = Field(min_length=1)
    name: str | None = None
    floors: list[Floor] = Field(min_length=1)
    nodes: list[NavigationNode] = Field(default_factory=list)
    edges: list[NavigationEdge] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_identifiers_and_ownership(self) -> "Building":
        floor_ids = [floor.floor_id for floor in self.floors]
        if len(floor_ids) != len(set(floor_ids)):
            raise ValueError("floor IDs must be unique within a building")

        node_ids = [node.node_id for node in self.nodes]
        if len(node_ids) != len(set(node_ids)):
            raise ValueError("node IDs must be unique within a building")

        known_floors = set(floor_ids)
        for node in self.nodes:
            if node.building_id != self.building_id:
                raise ValueError(f"node {node.node_id!r} belongs to another building")
            if node.floor_id not in known_floors:
                raise ValueError(f"node {node.node_id!r} references unknown floor {node.floor_id!r}")

        by_id = {node.node_id: node for node in self.nodes}
        seen_edges: set[tuple[str, str, str]] = set()
        for edge in self.edges:
            source = by_id.get(edge.source_node)
            destination = by_id.get(edge.destination_node)
            if source is None or destination is None:
                raise ValueError(
                    f"edge {edge.source_node!r}->{edge.destination_node!r} references an unknown node"
                )
            if source.building_id != destination.building_id:
                raise ValueError("edges cannot connect nodes from different buildings")

            is_vertical = edge.connection_type.value in {"stairs", "elevator", "ramp"}
            crosses_floors = source.floor_id != destination.floor_id
            if crosses_floors != is_vertical:
                raise ValueError("only stairs, elevators, and ramps may connect different floors")

            if edge.connection_type.value == "stairs":
                if source.node_type.value != "staircase" or destination.node_type.value != "staircase":
                    raise ValueError("stair edges must connect staircase nodes")
                if source.staircase_connection_id != destination.staircase_connection_id:
                    raise ValueError("stair edges must connect nodes for the same physical staircase")
            elif edge.connection_type.value == "elevator":
                if source.node_type.value != "elevator" or destination.node_type.value != "elevator":
                    raise ValueError("elevator edges must connect elevator nodes")
            elif edge.connection_type.value == "ramp":
                if source.node_type.value != "ramp" or destination.node_type.value != "ramp":
                    raise ValueError("ramp edges must connect ramp nodes")

            endpoints = (edge.source_node, edge.destination_node)
            if edge.bidirectional:
                endpoints = tuple(sorted(endpoints))
            key = (endpoints[0], endpoints[1], edge.connection_type.value)
            if key in seen_edges:
                raise ValueError("duplicate edge connection")
            seen_edges.add(key)
        return self
