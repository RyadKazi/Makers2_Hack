"""Authenticated, aggregate-only university accessibility analytics endpoints."""

import hashlib
import logging
from fastapi import APIRouter, Depends, HTTPException, Request

from analytics.analysis import (
    DetectionThresholds,
    build_heatmap,
    build_recommendations,
    detect_disparities,
)
from analytics.schemas import (
    DisparitiesResponse,
    HeatmapResponse,
    OverviewResponse,
    Recommendation,
    RecommendationResponse,
    RecommendationStatusRequest,
    RecommendationsResponse,
    StatusUpdateResponse,
)
from analytics.security import AnalyticsSettings, require_admin
from analytics.store import AnalyticsStore


logger = logging.getLogger("accesu.analytics.audit")
if not logger.handlers:
    logger.addHandler(logging.StreamHandler())
logger.setLevel(logging.INFO)
logger.propagate = False
router = APIRouter(prefix="/analytics/accessibility", tags=["administrator accessibility analytics"])


def _thresholds(request: Request) -> DetectionThresholds:
    settings: AnalyticsSettings = request.app.state.analytics_settings
    return DetectionThresholds(
        minimum_sessions_per_group=settings.minimum_sessions_per_group,
        minimum_contributors_per_group=settings.minimum_contributors_per_group,
        duration_ratio=settings.disparity_ratio,
        minimum_duration_difference_seconds=settings.minimum_duration_difference_seconds,
        consistency_fraction=settings.consistency_fraction,
    )


def _store(request: Request) -> AnalyticsStore:
    return request.app.state.analytics_store


def _audit(action: str, token: str, resource_id: str | None = None) -> None:
    actor_fingerprint = hashlib.sha256(token.encode()).hexdigest()[:12]
    resource_fingerprint = hashlib.sha256(resource_id.encode()).hexdigest()[:12] if resource_id else "none"
    logger.info(
        "admin_action=%s actor_fingerprint=%s resource_fingerprint=%s",
        action,
        actor_fingerprint,
        resource_fingerprint,
    )


def _analysis(request: Request):
    contributions = _store(request).contributions()
    return contributions, detect_disparities(contributions, _thresholds(request))


def _recommendations(request: Request, contributions, disparities) -> list[Recommendation]:
    return build_recommendations(
        registry=request.app.state.building_registry,
        contributions=contributions,
        disparities=disparities,
        thresholds=_thresholds(request),
        store=_store(request),
    )


@router.get("/overview", response_model=OverviewResponse)
def overview(request: Request, admin_token: str = Depends(require_admin)) -> OverviewResponse:
    _audit("overview_read", admin_token)
    contributions, disparities = _analysis(request)
    recommendations = _recommendations(request, contributions, disparities)
    settings: AnalyticsSettings = request.app.state.analytics_settings
    return OverviewResponse(
        eligible_pairs=len(disparities),
        disparities=sum(item.status == "detected" for item in disparities),
        unreachable_accessible_pairs=sum(item.status == "unreachable" for item in disparities),
        recommendations=len(recommendations),
        analysis_window_hours=settings.retention_hours,
        thresholds={
            "minimum_sessions_per_group": settings.minimum_sessions_per_group,
            "minimum_contributors_per_group": settings.minimum_contributors_per_group,
            "duration_ratio": settings.disparity_ratio,
            "minimum_duration_difference_seconds": settings.minimum_duration_difference_seconds,
            "consistency_fraction": settings.consistency_fraction,
        },
    )


@router.get("/disparities", response_model=DisparitiesResponse)
def disparities(request: Request, admin_token: str = Depends(require_admin)) -> DisparitiesResponse:
    _audit("disparities_read", admin_token)
    _, detected = _analysis(request)
    return DisparitiesResponse(disparities=detected)


@router.get("/heatmap/{building_id}", response_model=HeatmapResponse)
def heatmap(
    building_id: str,
    request: Request,
    admin_token: str = Depends(require_admin),
) -> HeatmapResponse:
    _audit("heatmap_read", admin_token, building_id)
    graph = request.app.state.building_registry.get(building_id)
    if graph is None:
        raise HTTPException(status_code=404, detail="Building not found")
    contributions, disparities = _analysis(request)
    items = build_heatmap(
        building_id=building_id,
        graph=graph,
        contributions=contributions,
        disparities=disparities,
        minimum_contributors=_thresholds(request).minimum_contributors_per_group,
    )
    return HeatmapResponse(
        building_id=building_id,
        minimum_cohort_met=bool(items),
        items=items,
    )


@router.get("/recommendations", response_model=RecommendationsResponse)
def recommendations(
    request: Request,
    admin_token: str = Depends(require_admin),
) -> RecommendationsResponse:
    _audit("recommendations_read", admin_token)
    contributions, disparities = _analysis(request)
    return RecommendationsResponse(
        recommendations=_recommendations(request, contributions, disparities)
    )


@router.get("/recommendations/{recommendation_id}", response_model=RecommendationResponse)
def recommendation_detail(
    recommendation_id: str,
    request: Request,
    admin_token: str = Depends(require_admin),
) -> RecommendationResponse:
    _audit("recommendation_detail_read", admin_token, recommendation_id)
    contributions, disparities = _analysis(request)
    match = next(
        (
            item
            for item in _recommendations(request, contributions, disparities)
            if item.recommendation_id == recommendation_id
        ),
        None,
    )
    if match is None:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    return RecommendationResponse(recommendation=match)


@router.post(
    "/recommendations/{recommendation_id}/status",
    response_model=StatusUpdateResponse,
)
def update_recommendation_status(
    recommendation_id: str,
    payload: RecommendationStatusRequest,
    request: Request,
    admin_token: str = Depends(require_admin),
) -> StatusUpdateResponse:
    contributions, disparities = _analysis(request)
    recommendations = _recommendations(request, contributions, disparities)
    if not any(item.recommendation_id == recommendation_id for item in recommendations):
        raise HTTPException(status_code=404, detail="Recommendation not found")
    _store(request).set_recommendation_status(recommendation_id, payload.status)
    _audit("recommendation_status_update", admin_token, recommendation_id)
    return StatusUpdateResponse(
        recommendation_id=recommendation_id,
        status=payload.status,
    )
