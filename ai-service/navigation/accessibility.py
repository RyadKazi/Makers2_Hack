"""Hard accessibility constraints applied before Dijkstra explores an edge."""

from enum import Enum
from math import isfinite

from pydantic import BaseModel, ConfigDict, Field, field_validator

from models import ConnectionType, NavigationEdge, NavigationNode


class NavigationProfile(str, Enum):
    WHEELCHAIR = "wheelchair"
    GENERAL = "general"
    BLIND_NAVIGATION = "blind_navigation"


class RouteConstraints(BaseModel):
    """Optional, explicit thresholds; unknown map facts are not invented."""

    model_config = ConfigDict(extra="forbid")

    minimum_door_width_m: float | None = Field(default=None, gt=0)
    maximum_ramp_slope: float | None = Field(default=None, ge=0)

    @field_validator("minimum_door_width_m", "maximum_ramp_slope")
    @classmethod
    def require_finite_thresholds(cls, value: float | None) -> float | None:
        if value is not None and not isfinite(value):
            raise ValueError("accessibility thresholds must be finite")
        return value


def edge_is_allowed(
    edge: NavigationEdge,
    source: NavigationNode,
    destination: NavigationNode,
    profile: NavigationProfile,
    constraints: RouteConstraints,
) -> bool:
    """Return whether a declared connection satisfies the requested profile."""
    if edge.accessibility.blocked:
        return False
    if source.accessibility.blocked or destination.accessibility.blocked:
        return False

    if profile == NavigationProfile.WHEELCHAIR:
        if edge.connection_type == ConnectionType.STAIRS:
            return False
        if edge.accessibility.accessible is False:
            return False
        if source.accessibility.accessible is False or destination.accessibility.accessible is False:
            return False

        if constraints.minimum_door_width_m is not None:
            if edge.connection_type == ConnectionType.DOORWAY:
                widths = [
                    edge.accessibility.door_width_m
                    if edge.accessibility.verified
                    else None
                ]
                widths.extend(
                    node.accessibility.door_width_m
                    if node.accessibility.verified
                    else None
                    for node in (source, destination)
                    if node.node_type.value == "door"
                )
                known_widths = [width for width in widths if width is not None]
                if known_widths and min(known_widths) < constraints.minimum_door_width_m:
                    return False

        if constraints.maximum_ramp_slope is not None:
            if edge.connection_type == ConnectionType.RAMP:
                slope = edge.accessibility.ramp_slope if edge.accessibility.verified else None
                if slope is None:
                    for node in (source, destination):
                        if (
                            node.node_type.value == "ramp"
                            and node.accessibility.ramp_slope is not None
                            and node.accessibility.verified
                        ):
                            slope = node.accessibility.ramp_slope
                            break
                if slope is not None and slope > constraints.maximum_ramp_slope:
                    return False

    return True


def route_preference_penalty(
    edge: NavigationEdge, profile: NavigationProfile
) -> int:
    """Secondary cost used only after distance, favoring verified accessibility."""
    if profile != NavigationProfile.WHEELCHAIR:
        return 0
    preferred_types = {ConnectionType.ENTRANCE, ConnectionType.RAMP, ConnectionType.ELEVATOR}
    if edge.connection_type not in preferred_types:
        return 0
    return 0 if edge.accessibility.accessible is True and edge.accessibility.verified else 1
