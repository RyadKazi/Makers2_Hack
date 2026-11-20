"""Versioned service-to-service API for routing and analytics."""

from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field

from analytics.analysis import (
    DetectionThresholds,
    build_heatmap,
    build_recommendations,
    detect_disparities,
)
from analytics.events import build_contribution
from analytics.schemas import (
    ConditionContext,
    Disparity,
    JourneyEventRequest,
    Recommendation,
    RecommendationStatus,
    SessionDurationChoice,
    SessionStatus,
    StartSessionRequest,
)
from analytics.security import AnalyticsSettings
from analytics.store import AnalyticsStore, DuplicateEventError, SessionNotFoundError, SessionTokenError
from data.postgres import DatabaseUnavailable, PostgresDataAccess
from navigation.accessibility import NavigationProfile, RouteConstraints
from navigation.dijkstra import NodeNotFoundError, NoRouteFoundError
from navigation.graph import NavigationGraph
from navigation.route_service import calculate_route
from security.api_keys import require_permission


router = APIRouter(prefix="/api/v1", tags=["API v1"])


class ApiRouteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    building_id: str = Field(min_length=1)
    start_node: str = Field(min_length=1)
    destination_node: str = Field(min_length=1)
    profile: NavigationProfile = NavigationProfile.GENERAL
    constraints: RouteConstraints = Field(default_factory=RouteConstraints)


class AnalysisContribution(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: UUID
    session_id: UUID
    contributor_digest: str = Field(min_length=32, max_length=128)
    building_id: str
    origin_node: str
    destination_node: str
    profile: NavigationProfile
    context: ConditionContext = ConditionContext.TYPICAL
    completed: bool = True
    duration_seconds: float = Field(ge=0, le=43200)
    distance_m: float = Field(ge=0)
    edge_keys: list[tuple[str, str]] = Field(default_factory=list)
    staircase_ids: list[str] = Field(default_factory=list)
    obstacle_reports: list[tuple[str, str]] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contributions: list[AnalysisContribution] | None = Field(default=None, max_length=100_000)


class V1SessionStartRequest(StartSessionRequest):
    start_node: str = Field(min_length=1)
    destination_node: str = Field(min_length=1)
    profile: NavigationProfile


def _envelope(data, message: str = "Operation completed successfully") -> dict:
    return {"success": True, "data": data, "message": message}


def _graph(request: Request, building_id: str) -> NavigationGraph:
    repository: PostgresDataAccess = request.app.state.data_access
    try:
        building = repository.load_building(building_id)
    except DatabaseUnavailable as exc:
        # A configured JSON registry remains a supported local/development source.
        building = None
        if not request.app.state.building_registry.get(building_id):
            raise HTTPException(status_code=503, detail=str(exc)) from exc
    if building is not None:
        return NavigationGraph(building)
    graph = request.app.state.building_registry.get(building_id)
    if graph is None:
        raise HTTPException(status_code=404, detail="Building not found")
    return graph


def _thresholds(request: Request) -> DetectionThresholds:
    settings: AnalyticsSettings = request.app.state.analytics_settings
    return DetectionThresholds(
        minimum_sessions_per_group=settings.minimum_sessions_per_group,
        minimum_contributors_per_group=settings.minimum_contributors_per_group,
        duration_ratio=settings.disparity_ratio,
        minimum_duration_difference_seconds=settings.minimum_duration_difference_seconds,
        consistency_fraction=settings.consistency_fraction,
    )


def _to_contribution(row: AnalysisContribution):
    from analytics.schemas import ObstacleType
    from analytics.store import Contribution

    reports = []
    for node_id, kind in row.obstacle_reports:
        try:
            reports.append((node_id, ObstacleType(kind)))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"Unknown obstacle type: {kind}") from exc
    return Contribution(
        event_id=row.event_id,
        session_id=row.session_id,
        contributor_digest=row.contributor_digest,
        building_id=row.building_id,
        origin_node=row.origin_node,
        destination_node=row.destination_node,
        profile=row.profile,
        context=row.context,
        completed=row.completed,
        duration_seconds=row.duration_seconds,
        distance_m=row.distance_m,
        edge_keys=tuple(tuple(pair) for pair in row.edge_keys),
        staircase_ids=tuple(row.staircase_ids),
        obstacle_reports=tuple(reports),
        created_at=row.created_at,
    )


@router.get("/health")
def api_health():
    return _envelope({"status": "healthy", "version": "v1"})


@router.get("/sessions/consent")
def session_consent(request: Request):
    settings: AnalyticsSettings = request.app.state.analytics_settings
    return _envelope({
        "consent_version": settings.consent_version,
        "purpose": "Voluntarily shared route outcomes support aggregate accessibility analysis and inspection recommendations.",
        "collected": ["Building and graph node IDs", "Selected accessibility profile", "Approximate duration and graph distance", "Optional structured difficulty reports"],
        "not_collected": ["Names", "Student IDs", "Continuous GPS", "Ordered route after validation"],
        "retention_hours": settings.retention_hours,
        "duration_choices": ["this_navigation", "until_expiry"],
        "individual_journeys_visible_to_admins": False,
    })


@router.post("/navigation/route")
def calculate_navigation_route(
    payload: ApiRouteRequest,
    request: Request,
    _: str = Depends(require_permission("navigation:route")),
):
    graph = _graph(request, payload.building_id)
    try:
        result = calculate_route(
            graph,
            payload.start_node,
            payload.destination_node,
            payload.profile,
            payload.constraints,
        )
    except NodeNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except NoRouteFoundError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _envelope(result.model_dump(mode="json"))


@router.post("/sessions/start", status_code=status.HTTP_201_CREATED)
def start_v1_session(
    payload: V1SessionStartRequest,
    request: Request,
    contributor_ref: Annotated[
        str,
        Header(alias="X-Accesu-Contributor-Ref", min_length=64, max_length=64, pattern=r"^[a-fA-F0-9]{64}$"),
    ],
    _: str = Depends(require_permission("sessions:write")),
):
    graph = _graph(request, payload.building_id)
    if graph.get_node(payload.start_node) is None:
        raise HTTPException(status_code=404, detail="Start node not found")
    if graph.get_node(payload.destination_node) is None:
        raise HTTPException(status_code=404, detail="Destination node not found")
    settings: AnalyticsSettings = request.app.state.analytics_settings
    if payload.consent_version != settings.consent_version:
        raise HTTPException(status_code=409, detail="Consent version is outdated")
    secret = settings.contributor_hash_secret
    if not secret:
        raise HTTPException(status_code=503, detail="Contributor pseudonymization is not configured")
    contributor_digest = AnalyticsStore.pseudonymize(contributor_ref, secret)
    try:
        record, token = request.app.state.analytics_store.create_session(
            building_id=payload.building_id,
            contributor_digest=contributor_digest,
            consent_version=payload.consent_version,
            duration_choice=payload.duration_choice,
            requested_expiry=payload.expires_at,
            max_navigation_hours=settings.navigation_session_max_hours,
            max_until_expiry_hours=settings.explicit_expiry_max_hours,
            start_node=payload.start_node,
            destination_node=payload.destination_node,
            profile=payload.profile,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    repository: PostgresDataAccess = request.app.state.data_access
    if repository.configured:
        try:
            repository.persist_session(record)
        except DatabaseUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
    return _envelope(
        {
            "session_id": str(record.session_id),
            "session_token": token,
            "status": record.status.value,
            "expires_at": record.expires_at.isoformat(),
        },
        "Consent recorded and session started",
    )


@router.post("/sessions/{session_id}/events", status_code=status.HTTP_201_CREATED)
def record_v1_session_event(
    session_id: UUID,
    payload: JourneyEventRequest,
    request: Request,
    session_token: Annotated[str, Header(alias="X-Accesu-Session-Token", min_length=32)],
    _: str = Depends(require_permission("sessions:write")),
):
    store: AnalyticsStore = request.app.state.analytics_store
    repository: PostgresDataAccess = request.app.state.data_access
    try:
        session = repository.authorized_session(session_id, session_token) if repository.configured else store.get_authorized_session(session_id, session_token)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except SessionTokenError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if session.status != SessionStatus.ACTIVE:
        code = 410 if session.status == SessionStatus.EXPIRED else 409
        raise HTTPException(status_code=code, detail=f"Session is {session.status.value}")
    if (
        payload.origin_node != session.start_node
        or payload.destination_node != session.destination_node
        or payload.profile != session.profile
    ):
        raise HTTPException(status_code=422, detail="Journey event does not match the consented session route")
    graph = _graph(request, session.building_id)
    contribution = build_contribution(
        event=payload, session=session, graph=graph, now=datetime.now(timezone.utc)
    )
    try:
        if repository.configured:
            repository.persist_contribution(contribution)
        store.add_contribution(contribution)
    except DuplicateEventError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return _envelope(
        {"event_id": str(payload.event_id), "distance_m": contribution.distance_m},
        "Contribution validated",
    )


@router.post("/sessions/{session_id}/finish")
def finish_v1_session(
    session_id: UUID,
    request: Request,
    session_token: Annotated[str, Header(alias="X-Accesu-Session-Token", min_length=32)],
    _: str = Depends(require_permission("sessions:write")),
):
    try:
        repository: PostgresDataAccess = request.app.state.data_access
        record = repository.authorized_session(session_id, session_token) if repository.configured else request.app.state.analytics_store.get_authorized_session(session_id, session_token)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except SessionTokenError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if record.status in {SessionStatus.ACTIVE, SessionStatus.PAUSED}:
        if request.app.state.data_access.configured:
            request.app.state.data_access.update_session_status(session_id, SessionStatus.FINISHED)
            record.status=SessionStatus.FINISHED
        else:
            request.app.state.analytics_store.finish(record)
    return _envelope({"session_id": str(session_id), "status": record.status.value})


def _set_v1_session_state(session_id: UUID, request: Request, token: str, target: SessionStatus):
    repository: PostgresDataAccess=request.app.state.data_access
    try:
        record=repository.authorized_session(session_id,token) if repository.configured else request.app.state.analytics_store.get_authorized_session(session_id,token)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404,detail=str(exc)) from exc
    except SessionTokenError as exc:
        raise HTTPException(status_code=403,detail=str(exc)) from exc
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503,detail=str(exc)) from exc
    if record.status in {SessionStatus.EXPIRED,SessionStatus.FINISHED}:
        raise HTTPException(status_code=410,detail=f"Session is {record.status.value}")
    if target==SessionStatus.PAUSED and record.status!=SessionStatus.ACTIVE:
        raise HTTPException(status_code=409,detail="Only an active session can be paused")
    if target==SessionStatus.ACTIVE and record.status!=SessionStatus.PAUSED:
        raise HTTPException(status_code=409,detail="Only a paused session can be resumed")
    if repository.configured:
        repository.update_session_status(session_id,target)
    else:
        if target==SessionStatus.PAUSED:
            request.app.state.analytics_store.pause(record)
        else:
            request.app.state.analytics_store.resume(record)
    return _envelope({"session_id":str(session_id),"status":target.value,"expires_at":record.expires_at.isoformat()})


@router.post("/sessions/{session_id}/pause")
def pause_v1_session(
    session_id: UUID,request:Request,
    session_token:Annotated[str,Header(alias="X-Accesu-Session-Token",min_length=32)],
    _:str=Depends(require_permission("sessions:write")),
):
    return _set_v1_session_state(session_id,request,session_token,SessionStatus.PAUSED)


@router.post("/sessions/{session_id}/resume")
def resume_v1_session(
    session_id: UUID,request:Request,
    session_token:Annotated[str,Header(alias="X-Accesu-Session-Token",min_length=32)],
    _:str=Depends(require_permission("sessions:write")),
):
    return _set_v1_session_state(session_id,request,session_token,SessionStatus.ACTIVE)


@router.get("/sessions/{session_id}/status")
def status_v1_session(
    session_id: UUID,
    request: Request,
    session_token: Annotated[str, Header(alias="X-Accesu-Session-Token", min_length=32)],
    _: str = Depends(require_permission("sessions:write")),
):
    try:
        repository: PostgresDataAccess = request.app.state.data_access
        record = repository.authorized_session(session_id, session_token) if repository.configured else request.app.state.analytics_store.get_authorized_session(session_id, session_token)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except SessionTokenError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return _envelope({"session_id": str(session_id), "status": record.status.value, "expires_at": record.expires_at.isoformat()})


@router.delete("/sessions/{session_id}")
def delete_v1_session(
    session_id: UUID,
    request: Request,
    session_token: Annotated[str, Header(alias="X-Accesu-Session-Token", min_length=32)],
    _: str = Depends(require_permission("sessions:write")),
):
    repository: PostgresDataAccess=request.app.state.data_access
    try:
        if repository.configured:
            repository.authorized_session(session_id,session_token)
            repository.delete_session(session_id)
        else:
            request.app.state.analytics_store.get_authorized_session(session_id,session_token)
            request.app.state.analytics_store.delete_session(session_id)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404,detail=str(exc)) from exc
    except SessionTokenError as exc:
        raise HTTPException(status_code=403,detail=str(exc)) from exc
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503,detail=str(exc)) from exc
    # Recalculate snapshots after deletion so subsequent aggregate reads no
    # longer include the withdrawn contribution.
    analyze_v1(AnalyzeRequest(),request,"internal")
    return _envelope({"deleted":True},"Session contribution deleted")


@router.post("/analytics/analyze")
def analyze_v1(
    payload: AnalyzeRequest,
    request: Request,
    _: str = Depends(require_permission("analytics:write")),
):
    repository: PostgresDataAccess = request.app.state.data_access
    try:
        contributions = (
            [_to_contribution(row) for row in payload.contributions]
            if payload.contributions is not None
            else list(repository.load_contributions(request.app.state.analytics_settings.retention_hours))
            if repository.configured
            else list(request.app.state.analytics_store.contributions())
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    disparities = detect_disparities(contributions, _thresholds(request))
    graphs: dict[str, NavigationGraph] = {}
    for building_id in {row.building_id for row in contributions}:
        try:
            graphs[building_id] = _graph(request, building_id)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
    # Recommendations accept a registry; preserve its existing object and add
    # only graphs supplied by the university database for this calculation.
    from navigation.registry import BuildingRegistry

    registry = BuildingRegistry()
    for graph in graphs.values():
        registry.register(graph.building)
    recommendations = build_recommendations(
        registry=registry,
        contributions=contributions,
        disparities=disparities,
        thresholds=_thresholds(request),
        store=request.app.state.analytics_store,
    )
    settings: AnalyticsSettings = request.app.state.analytics_settings
    overview = {
        "eligible_pairs": len(disparities),
        "disparities": sum(item.status == "detected" for item in disparities),
        "unreachable_accessible_pairs": sum(item.status == "unreachable" for item in disparities),
        "recommendations": len(recommendations),
        "analysis_window_hours": settings.retention_hours,
        "thresholds": {
            "minimum_sessions_per_group": settings.minimum_sessions_per_group,
            "minimum_contributors_per_group": settings.minimum_contributors_per_group,
            "duration_ratio": settings.disparity_ratio,
            "minimum_duration_difference_seconds": settings.minimum_duration_difference_seconds,
            "consistency_fraction": settings.consistency_fraction,
        },
    }
    request.app.state.api_v1_analysis = {
        "contributions": contributions,
        "disparities": disparities,
        "recommendations": recommendations,
        "overview": overview,
        "graphs": graphs,
    }
    if repository.configured:
        try:
            repository.persist_analysis(request.app.state.api_v1_analysis | {
                "disparities": [item.model_dump(mode="json") for item in disparities],
                "recommendations": [item.model_dump(mode="json") for item in recommendations],
            })
        except DatabaseUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
    return _envelope(
        {
            "overview": overview,
            "disparities": [item.model_dump(mode="json") for item in disparities],
            "recommendations": [item.model_dump(mode="json") for item in recommendations],
        },
        "Analysis completed",
    )


def _analysis_cache(request: Request) -> dict:
    cache=getattr(request.app.state,"api_v1_analysis",None)
    if cache is not None:
        return cache
    empty={"contributions":[],"disparities":[],"recommendations":[],"overview":{"eligible_pairs":0,"disparities":0,"unreachable_accessible_pairs":0,"recommendations":0},"graphs":{}}
    repository: PostgresDataAccess=request.app.state.data_access
    if not repository.configured:
        return empty
    try:
        snapshot=repository.latest_analysis()
        if snapshot is None:
            return empty
        contributions=list(repository.load_contributions(request.app.state.analytics_settings.retention_hours))
        graphs={}
        for building_id in {row.building_id for row in contributions}:
            try:
                graphs[building_id]=_graph(request,building_id)
            except HTTPException:
                continue
        cache={
            "contributions":contributions,
            "disparities":[Disparity.model_validate(item) for item in snapshot["disparities"]],
            "recommendations":[Recommendation.model_validate(item) for item in snapshot["recommendations"]],
            "overview":snapshot["overview"],"graphs":graphs,
        }
        request.app.state.api_v1_analysis=cache
        return cache
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503,detail=str(exc)) from exc


@router.get("/analytics/overview")
def analytics_overview(request: Request, _: str = Depends(require_permission("analytics:read"))):
    return _envelope(_analysis_cache(request)["overview"])


@router.get("/analytics/disparities")
def analytics_disparities(request: Request, _: str = Depends(require_permission("analytics:read"))):
    return _envelope([item.model_dump(mode="json") for item in _analysis_cache(request)["disparities"]])


@router.get("/analytics/heatmap/{building_id}")
def analytics_heatmap(
    building_id: str,
    request: Request,
    _: str = Depends(require_permission("analytics:read")),
):
    cache = _analysis_cache(request)
    graph = cache["graphs"].get(building_id)
    if graph is None:
        graph = _graph(request, building_id)
    items = build_heatmap(
        building_id,
        graph,
        cache["contributions"],
        cache["disparities"],
        _thresholds(request).minimum_contributors_per_group,
    )
    return _envelope({"building_id": building_id, "items": [item.model_dump(mode="json") for item in items]})


@router.get("/recommendations")
def list_v1_recommendations(request: Request, _: str = Depends(require_permission("recommendations:read"))):
    return _envelope([item.model_dump(mode="json") for item in _analysis_cache(request)["recommendations"]])


@router.get("/recommendations/{recommendation_id}")
def get_v1_recommendation(
    recommendation_id: str,
    request: Request,
    _: str = Depends(require_permission("recommendations:read")),
):
    recommendation = next(
        (item for item in _analysis_cache(request)["recommendations"] if item.recommendation_id == recommendation_id),
        None,
    )
    if recommendation is None:
        raise HTTPException(status_code=404, detail="Recommendation not found; run analysis first")
    return _envelope(recommendation.model_dump(mode="json"))


@router.post("/recommendations/{recommendation_id}/simulate")
def simulate_v1_recommendation(
    recommendation_id: str,
    request: Request,
    _: str = Depends(require_permission("recommendations:write")),
):
    cache=_analysis_cache(request)
    from navigation.registry import BuildingRegistry
    registry=BuildingRegistry()
    for graph in cache["graphs"].values():
        registry.register(graph.building)
    for disparity in cache["disparities"]:
        if disparity.building_id not in cache["graphs"]:
            try:
                graph=_graph(request,disparity.building_id)
                registry.register(graph.building)
                cache["graphs"][disparity.building_id]=graph
            except HTTPException:
                continue
    recommendations=build_recommendations(
        registry=registry,
        contributions=cache["contributions"],
        disparities=cache["disparities"],
        thresholds=_thresholds(request),
        store=request.app.state.analytics_store,
    )
    recommendation = next(
        (item for item in recommendations if item.recommendation_id == recommendation_id),
        None,
    )
    if recommendation is None:
        raise HTTPException(status_code=404, detail="Recommendation not found; run analysis first")
    cache["recommendations"]=recommendations
    return _envelope(
        {
            "recommendation_id": recommendation_id,
            "simulated": True,
            "production_graph_modified": False,
            "current_accessible_distance_m": recommendation.current_accessible_distance_m,
            "hypothetical_distance_m": recommendation.simulated_distance_m,
            "estimated_distance_saved_m": recommendation.estimated_distance_saved_m,
            "estimated_time_saved_seconds": recommendation.estimated_time_saved_seconds,
            "limitations": recommendation.limitations,
        },
        "Hypothetical graph simulation completed",
    )
