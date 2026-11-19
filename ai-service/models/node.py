"""University-defined navigation nodes and their map metadata."""

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class NodeType(str, Enum):
    DOOR = "door"
    STAIRCASE = "staircase"
    CORRIDOR_INTERSECTION = "corridor_intersection"
    ENTRANCE = "entrance"
    ELEVATOR = "elevator"
    RAMP = "ramp"
    ROOM_ACCESS = "room_access"
    WAYPOINT = "waypoint"


class AccessibilityMetadata(BaseModel):
    """Known properties; ``None`` means that a property has not been verified."""

    model_config = ConfigDict(extra="forbid")

    accessible: bool | None = None
    blocked: bool = False
    verified: bool = False
    door_width_m: float | None = Field(default=None, gt=0)
    ramp_slope: float | None = Field(default=None, ge=0)
    surface_condition: str | None = None
    landmarks: list[str] = Field(default_factory=list)
    additional: dict[str, Any] = Field(default_factory=dict)

    @field_validator("door_width_m", "ramp_slope")
    @classmethod
    def require_finite_measurements(cls, value: float | None) -> float | None:
        if value is not None and (value != value or value in (float("inf"), float("-inf"))):
            raise ValueError("accessibility measurements must be finite")
        return value


class NavigationNode(BaseModel):
    """A map point placed and identified by the university; never generated."""

    model_config = ConfigDict(extra="forbid")

    node_id: str = Field(min_length=1)
    building_id: str = Field(min_length=1)
    floor_id: str = Field(min_length=1)
    x: float
    y: float
    node_type: NodeType
    accessibility: AccessibilityMetadata = Field(default_factory=AccessibilityMetadata)
    staircase_connection_id: str | None = None
    is_destination: bool = False
    label: str | None = None

    @field_validator("x", "y")
    @classmethod
    def require_finite_coordinates(cls, value: float) -> float:
        if value != value or value in (float("inf"), float("-inf")):
            raise ValueError("node coordinates must be finite")
        return value

    @model_validator(mode="after")
    def validate_staircase_identity(self) -> "NavigationNode":
        if self.node_type == NodeType.STAIRCASE and not self.staircase_connection_id:
            raise ValueError("staircase nodes require a staircase_connection_id")
        if self.node_type != NodeType.STAIRCASE and self.staircase_connection_id is not None:
            raise ValueError("staircase_connection_id is only valid for staircase nodes")
        return self
