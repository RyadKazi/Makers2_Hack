"""Verified, university-authored connections between navigation nodes."""

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .node import AccessibilityMetadata


class ConnectionType(str, Enum):
    CORRIDOR = "corridor"
    DOORWAY = "doorway"
    STAIRS = "stairs"
    ELEVATOR = "elevator"
    RAMP = "ramp"
    ENTRANCE = "entrance"
    OTHER = "other"


class NavigationEdge(BaseModel):
    """A declared walkable connection. Reverse traversal is enabled by default."""

    model_config = ConfigDict(extra="forbid")

    source_node: str = Field(min_length=1)
    destination_node: str = Field(min_length=1)
    distance: float = Field(ge=0)
    connection_type: ConnectionType
    accessibility: AccessibilityMetadata = Field(default_factory=AccessibilityMetadata)
    bidirectional: bool = True

    @field_validator("distance")
    @classmethod
    def require_finite_distance(cls, value: float) -> float:
        if value != value or value in (float("inf"), float("-inf")):
            raise ValueError("edge distance must be finite")
        return value

    def reversed(self) -> "NavigationEdge":
        """Return an oriented copy for a route that traverses this edge backwards."""
        return self.model_copy(
            update={"source_node": self.destination_node, "destination_node": self.source_node}
        )
