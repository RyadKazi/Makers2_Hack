"""Consent-gated, internal navigation contribution endpoints."""

from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from analytics.events import build_contribution
from analytics.schemas import (
    JourneyEventRequest,
    JourneyEventResponse,
    ConsentDisclosure,
    SessionActionResponse,
    SessionDeleteResponse,
    SessionStatus,
    SessionStatusResponse,
    StartSessionRequest,
    StartSessionResponse,
)
from analytics.security import AnalyticsSettings, require_service
from analytics.store import (
    AnalyticsStore,
    DuplicateEventError,
    SessionExpiredError,
    SessionNotFoundError,
    SessionStateError,
    SessionTokenError,
)


router = APIRouter(prefix="/navigation/sessions", tags=["voluntary navigation contributions"])


def _store(request: Request) -> AnalyticsStore:
    return request.app.state.analytics_store


def _settings(request: Request) -> AnalyticsSettings:
    return request.app.state.analytics_settings


def _session(request: Request, session_id: UUID, token: str):
    try:
        return _store(request).get_authorized_session(session_id, token)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except SessionTokenError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


def _require_active(record) -> None:
    if record.status == SessionStatus.EXPIRED:
        raise HTTPException(status_code=410, detail="Contribution session has expired")
    if record.status == SessionStatus.PAUSED:
        raise HTTPException(status_code=409, detail="Contribution session is paused")
    if record.status != SessionStatus.ACTIVE:
        raise HTTPException(status_code=409, detail="Contribution session is no longer active")


@router.get("/consent", response_model=ConsentDisclosure)
def consent_disclosure(request: Request) -> ConsentDisclosure:
    settings = _settings(request)
    return ConsentDisclosure(
        consent_version=settings.consent_version,
        purpose=(
            "AccesU uses voluntarily shared route outcomes and obstacle reports to compare "
            "aggregate journeys and identify places for an accessibility inspection."
        ),
        collected=[
            "Building, origin and destination node IDs",
            "Your selected navigation profile",
            "Approximate journey duration and graph distance",
            "Unordered graph-edge use and optional structured obstacle reports",
            "A pseudonymous contributor reference so repeat sessions count as one contributor",
            "The ordered graph-node sequence only long enough to validate and measure a submitted journey",
        ],
        not_collected=[
            "Names or student IDs",
            "Continuous GPS coordinates",
            "The ordered route sequence after validation has completed",
        ],
        access=(
            "Individual sessions are not available in administrator endpoints. Authorized "
            "university administrators receive aggregate results only after cohort suppression."
        ),
        retention_hours=settings.retention_hours,
        controls=[
            "Sharing is off until you explicitly opt in.",
            "You can pause, resume, finish, or request deletion of this session's contribution.",
            "Sharing expires automatically at the time shown for this session.",
        ],
    )


@router.post("/start", response_model=StartSessionResponse, status_code=status.HTTP_201_CREATED)
def start_session(
    payload: StartSessionRequest,
    request: Request,
    contributor_ref: Annotated[
        str,
        Header(
            alias="X-Accesu-Contributor-Ref",
            min_length=32,
            max_length=128,
            pattern=r"^[a-fA-F0-9]{64}$",
        ),
    ],
    _: str = Depends(require_service),
) -> StartSessionResponse:
    graph = request.app.state.building_registry.get(payload.building_id)
    if graph is None:
        raise HTTPException(status_code=404, detail="Building not found")
    settings = _settings(request)
    if payload.consent_version != settings.consent_version:
        raise HTTPException(
            status_code=409,
            detail="Consent text version is outdated; fetch the current disclosure before asking again",
        )
    if not settings.contributor_hash_secret:
        raise HTTPException(status_code=503, detail="Contributor pseudonymization is not configured")
    contributor_digest = _store(request).pseudonymize(
        contributor_ref, settings.contributor_hash_secret
    )
    try:
        record, session_token = _store(request).create_session(
            building_id=payload.building_id,
            contributor_digest=contributor_digest,
            consent_version=payload.consent_version,
            duration_choice=payload.duration_choice,
            requested_expiry=payload.expires_at,
            max_navigation_hours=settings.navigation_session_max_hours,
            max_until_expiry_hours=settings.explicit_expiry_max_hours,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return StartSessionResponse(
        session_id=record.session_id,
        session_token=session_token,
        status=record.status,
        expires_at=record.expires_at,
    )


@router.get("/{session_id}/status", response_model=SessionStatusResponse)
def session_status(
    session_id: UUID,
    request: Request,
    _: str = Depends(require_service),
    session_token: Annotated[str, Header(alias="X-Accesu-Session-Token", min_length=32)] = "",
) -> SessionStatusResponse:
    record = _session(request, session_id, session_token)
    return SessionStatusResponse(
        session_id=record.session_id,
        status=record.status,
        expires_at=record.expires_at,
        consent_version=record.consent_version,
    )


@router.post("/{session_id}/pause", response_model=SessionActionResponse)
def pause_session(
    session_id: UUID,
    request: Request,
    _: str = Depends(require_service),
    session_token: Annotated[str, Header(alias="X-Accesu-Session-Token", min_length=32)] = "",
) -> SessionActionResponse:
    record = _session(request, session_id, session_token)
    _require_active(record)
    try:
        _store(request).pause(record)
    except SessionStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return SessionActionResponse(session_id=record.session_id, status=record.status, expires_at=record.expires_at)


@router.post("/{session_id}/resume", response_model=SessionActionResponse)
def resume_session(
    session_id: UUID,
    request: Request,
    _: str = Depends(require_service),
    session_token: Annotated[str, Header(alias="X-Accesu-Session-Token", min_length=32)] = "",
) -> SessionActionResponse:
    record = _session(request, session_id, session_token)
    if record.status == SessionStatus.EXPIRED:
        raise HTTPException(status_code=410, detail="Contribution session has expired")
    try:
        _store(request).resume(record)
    except SessionStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return SessionActionResponse(session_id=record.session_id, status=record.status, expires_at=record.expires_at)


@router.post("/{session_id}/events", response_model=JourneyEventResponse, status_code=status.HTTP_201_CREATED)
def record_event(
    session_id: UUID,
    payload: JourneyEventRequest,
    request: Request,
    _: str = Depends(require_service),
    session_token: Annotated[str, Header(alias="X-Accesu-Session-Token", min_length=32)] = "",
) -> JourneyEventResponse:
    record = _session(request, session_id, session_token)
    _require_active(record)
    graph = request.app.state.building_registry.get(record.building_id)
    if graph is None:
        raise HTTPException(status_code=404, detail="Building graph is no longer available")
    now = datetime.now(timezone.utc)
    contribution = build_contribution(event=payload, session=record, graph=graph, now=now)
    try:
        _store(request).add_contribution(contribution)
    except DuplicateEventError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return JourneyEventResponse(event_id=payload.event_id, distance_m=contribution.distance_m)


@router.post("/{session_id}/finish", response_model=SessionActionResponse)
def finish_session(
    session_id: UUID,
    request: Request,
    _: str = Depends(require_service),
    session_token: Annotated[str, Header(alias="X-Accesu-Session-Token", min_length=32)] = "",
) -> SessionActionResponse:
    record = _session(request, session_id, session_token)
    if record.status == SessionStatus.EXPIRED:
        raise HTTPException(status_code=410, detail="Contribution session has expired")
    try:
        _store(request).finish(record)
    except SessionStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return SessionActionResponse(session_id=record.session_id, status=record.status, expires_at=record.expires_at)


@router.delete("/{session_id}/contributions", response_model=SessionDeleteResponse)
def delete_contributions(
    session_id: UUID,
    request: Request,
    _: str = Depends(require_service),
    session_token: Annotated[str, Header(alias="X-Accesu-Session-Token", min_length=32)] = "",
) -> SessionDeleteResponse:
    _session(request, session_id, session_token)
    deleted = _store(request).delete_session_contributions(session_id)
    return SessionDeleteResponse(deleted_contributions=deleted)
