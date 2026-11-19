"""Pydantic models for university-authored navigation data."""

from .building import Building, Floor
from .edge import ConnectionType, NavigationEdge
from .node import AccessibilityMetadata, NodeType, NavigationNode

__all__ = [
    "AccessibilityMetadata",
    "Building",
    "ConnectionType",
    "Floor",
    "NavigationEdge",
    "NavigationNode",
    "NodeType",
]
