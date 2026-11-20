"""In-memory building graph registry with optional startup JSON loading."""

import json
from pathlib import Path
from typing import Iterable

from pydantic import ValidationError

from models import Building, NavigationNode
from navigation.graph import GraphValidationError, NavigationGraph


class DuplicateBuildingError(ValueError):
    """A building ID is already present in the registry."""


class BuildingRegistry:
    """Validated graphs retained in memory for the lifetime of the API process."""

    def __init__(self, buildings: Iterable[Building] = ()) -> None:
        self._graphs: dict[str, NavigationGraph] = {}
        for building in buildings:
            self.register(building)

    def register(self, building: Building) -> NavigationGraph:
        if building.building_id in self._graphs:
            raise DuplicateBuildingError(f"duplicate building ID: {building.building_id}")
        try:
            graph = NavigationGraph(building)
        except (GraphValidationError, ValidationError) as exc:
            raise ValueError(f"invalid graph for building {building.building_id!r}: {exc}") from exc
        self._graphs[building.building_id] = graph
        return graph

    def get(self, building_id: str) -> NavigationGraph | None:
        return self._graphs.get(building_id)

    def all(self) -> tuple[NavigationGraph, ...]:
        return tuple(self._graphs.values())

    def find_nodes(self, node_id: str) -> list[tuple[NavigationGraph, NavigationNode]]:
        """Find a node across graphs; IDs are only guaranteed unique per building."""
        matches = []
        for graph in self._graphs.values():
            node = graph.get_node(node_id)
            if node is not None:
                matches.append((graph, node))
        return matches

    @classmethod
    def from_json_file(cls, path: str | Path) -> "BuildingRegistry":
        """Load one building, a list of buildings, or ``{"buildings": [...]}``."""
        source = Path(path)
        try:
            payload = json.loads(source.read_text(encoding="utf-8"))
        except OSError as exc:
            raise ValueError(f"cannot read building data file {source}: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid JSON in building data file {source}: {exc}") from exc

        if isinstance(payload, dict) and "buildings" in payload:
            payload = payload["buildings"]
        if isinstance(payload, dict):
            payload = [payload]
        if not isinstance(payload, list):
            raise ValueError("building data must be a building object, list, or {buildings: [...]} object")

        try:
            buildings = [Building.model_validate(item) for item in payload]
        except ValidationError as exc:
            raise ValueError(f"building data failed validation: {exc}") from exc
        return cls(buildings)
