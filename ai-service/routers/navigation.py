"""Public read-only navigation API routes."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field

from models import Building, NavigationEdge, NavigationNode
from navigation.accessibility import NavigationProfile, RouteConstraints
from navigation.dijkstra import NodeNotFoundError, NoRouteFoundError
from navigation.registry import BuildingRegistry
from navigation.route_service import FloorTransition, calculate_route


class RouteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    building_id: str = Field(min_length=1)
    start_node: str = Field(min_length=1)
    destination_node: str = Field(min_length=1)
    profile: NavigationProfile = NavigationProfile.GENERAL
    constraints: RouteConstraints = Field(default_factory=RouteConstraints)


class RouteData(BaseModel):
    nodes: list[str]
    total_distance: float
    floor_transitions: list[FloorTransition]
    profile: NavigationProfile
    node_details: list[NavigationNode]
    edges: list[NavigationEdge]


class RouteResponse(BaseModel):
    success: bool = True
    message: str = "Route successfully calculated"
    route: RouteData


class ErrorResponse(BaseModel):
    success: bool = False
    message: str
    errors: list[dict[str, object]] | None = None


class BuildingSummary(BaseModel):
    building_id: str
    name: str | None
    floors: int
    nodes: int
    edges: int


class BuildingListResponse(BaseModel):
    success: bool = True
    buildings: list[BuildingSummary]


class BuildingResponse(BaseModel):
    success: bool = True
    building: Building


class NodeResponse(BaseModel):
    success: bool = True
    node: NavigationNode


router = APIRouter(tags=["navigation"])


def _registry(request: Request) -> BuildingRegistry:
    return request.app.state.building_registry


@router.get("/buildings", response_model=BuildingListResponse)
def list_buildings(request: Request) -> BuildingListResponse:
    graphs = _registry(request).all()
    return BuildingListResponse(
        buildings=[
            BuildingSummary(
                building_id=graph.building_id,
                name=graph.building.name,
                floors=len(graph.building.floors),
                nodes=len(graph.nodes),
                edges=len(graph.edges),
            )
            for graph in graphs
        ]
    )


@router.get("/buildings/{building_id}", response_model=BuildingResponse)
def get_building(building_id: str, request: Request) -> BuildingResponse:
    graph = _registry(request).get(building_id)
    if graph is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Building not found")
    return BuildingResponse(building=graph.building)


@router.post(
    "/navigation/route",
    response_model=RouteResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Building or node was not found"},
        422: {"model": ErrorResponse, "description": "Invalid request or no valid route"},
    },
)
def request_route(payload: RouteRequest, request: Request) -> RouteResponse:
    graph = _registry(request).get(payload.building_id)
    if graph is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Building not found")

    try:
        result = calculate_route(
            graph=graph,
            start_node=payload.start_node,
            destination_node=payload.destination_node,
            profile=payload.profile,
            constraints=payload.constraints,
        )
    except NodeNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except NoRouteFoundError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return RouteResponse(
        route=RouteData(
            nodes=result.route,
            total_distance=result.total_distance,
            floor_transitions=result.floor_transitions,
            profile=payload.profile,
            node_details=result.nodes,
            edges=result.edges,
        )
    )


@router.get(
    "/navigation/nodes/{node_id}",
    response_model=NodeResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Node was not found"},
        409: {"model": ErrorResponse, "description": "Node ID is ambiguous across buildings"},
    },
)
def get_node(
    node_id: str,
    request: Request,
    building_id: Annotated[str | None, Query()] = None,
) -> NodeResponse:
    registry = _registry(request)
    if building_id is not None:
        graph = registry.get(building_id)
        if graph is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Building not found")
        node = graph.get_node(node_id)
        if node is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
        return NodeResponse(node=node)

    matches = registry.find_nodes(node_id)
    if not matches:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
    if len(matches) > 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Node ID exists in multiple buildings; supply the building_id query parameter",
        )
    return NodeResponse(node=matches[0][1])
