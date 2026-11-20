"""Process-local, retention-bounded session and aggregate contribution storage."""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
import hashlib
import hmac
import secrets
from threading import RLock
from uuid import UUID, uuid4

from analytics.schemas import (
    ConditionContext,
    ObstacleType,
    RecommendationStatus,
    SessionDurationChoice,
    SessionStatus,
)
from navigation.accessibility import NavigationProfile


class SessionNotFoundError(LookupError):
    pass


class SessionTokenError(PermissionError):
    pass


class SessionStateError(ValueError):
    pass


class SessionExpiredError(SessionStateError):
    pass


class DuplicateEventError(ValueError):
    pass


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class SessionRecord:
    session_id: UUID
    building_id: str
    contributor_digest: str
    consent_version: str
    duration_choice: SessionDurationChoice
    created_at: datetime
    expires_at: datetime
    status: SessionStatus
    token_digest: str
    start_node: str | None = None
    destination_node: str | None = None
    profile: NavigationProfile | None = None


@dataclass(frozen=True)
class Contribution:
    event_id: UUID
    session_id: UUID
    contributor_digest: str
    building_id: str
    origin_node: str
    destination_node: str
    profile: NavigationProfile
    context: ConditionContext
    completed: bool
    duration_seconds: float
    distance_m: float
    edge_keys: tuple[tuple[str, str], ...]
    staircase_ids: tuple[str, ...]
    obstacle_reports: tuple[tuple[str, ObstacleType], ...]
    created_at: datetime


class AnalyticsStore:
    """In-memory store; raw ordered node sequences are never retained.

    Contributions contain per-journey aggregate metrics and unordered edge
    references for a configurable short window. Admin APIs must apply cohort
    thresholds before returning any results. This adapter is process-local and
    intentionally replaceable by durable storage after privacy review.
    """

    def __init__(self, retention_hours: int = 24) -> None:
        if retention_hours < 1:
            raise ValueError("retention_hours must be at least one hour")
        self.retention = timedelta(hours=retention_hours)
        self._sessions: dict[UUID, SessionRecord] = {}
        self._contributions: list[Contribution] = []
        self._event_ids: set[UUID] = set()
        self._recommendation_statuses: dict[str, RecommendationStatus] = {}
        self._lock = RLock()

    @staticmethod
    def pseudonymize(contributor_ref: str, secret: str) -> str:
        return hmac.new(secret.encode(), contributor_ref.encode(), hashlib.sha256).hexdigest()

    def create_session(
        self,
        *,
        building_id: str,
        contributor_digest: str,
        consent_version: str,
        duration_choice: SessionDurationChoice,
        requested_expiry: datetime | None,
        max_navigation_hours: int,
        max_until_expiry_hours: int,
        start_node: str | None = None,
        destination_node: str | None = None,
        profile: NavigationProfile | None = None,
        now: datetime | None = None,
    ) -> tuple[SessionRecord, str]:
        now = now or utc_now()
        if duration_choice == SessionDurationChoice.THIS_NAVIGATION:
            if requested_expiry is not None:
                raise ValueError("expires_at must not be supplied for this_navigation sharing")
            expiry = now + timedelta(hours=max_navigation_hours)
        else:
            if requested_expiry is None:
                raise ValueError("expires_at is required for until_expiry sharing")
            expiry = requested_expiry.astimezone(timezone.utc)
            if expiry <= now:
                raise ValueError("expires_at must be in the future")
            if expiry > now + timedelta(hours=max_until_expiry_hours):
                raise ValueError("expires_at exceeds the configured maximum sharing duration")

        token = secrets.token_urlsafe(32)
        record = SessionRecord(
            session_id=uuid4(),
            building_id=building_id,
            contributor_digest=contributor_digest,
            consent_version=consent_version,
            duration_choice=duration_choice,
            created_at=now,
            expires_at=expiry,
            status=SessionStatus.ACTIVE,
            token_digest=hashlib.sha256(token.encode()).hexdigest(),
            start_node=start_node,
            destination_node=destination_node,
            profile=profile,
        )
        with self._lock:
            self._prune_locked(now)
            self._sessions[record.session_id] = record
        return record, token

    def get_authorized_session(
        self,
        session_id: UUID,
        token: str,
        *,
        now: datetime | None = None,
    ) -> SessionRecord:
        now = now or utc_now()
        with self._lock:
            self._prune_locked(now)
            record = self._sessions.get(session_id)
            if record is None:
                raise SessionNotFoundError("session not found")
            presented = hashlib.sha256(token.encode()).hexdigest()
            if not hmac.compare_digest(record.token_digest, presented):
                raise SessionTokenError("invalid session token")
            if record.status in {SessionStatus.ACTIVE, SessionStatus.PAUSED} and now >= record.expires_at:
                record.status = SessionStatus.EXPIRED
            return record

    def pause(self, record: SessionRecord) -> None:
        with self._lock:
            if record.status != SessionStatus.ACTIVE:
                raise SessionStateError("only an active session can be paused")
            record.status = SessionStatus.PAUSED

    def resume(self, record: SessionRecord) -> None:
        with self._lock:
            if record.status != SessionStatus.PAUSED:
                raise SessionStateError("only a paused session can be resumed")
            record.status = SessionStatus.ACTIVE

    def finish(self, record: SessionRecord) -> None:
        with self._lock:
            if record.status not in {SessionStatus.ACTIVE, SessionStatus.PAUSED}:
                raise SessionStateError("session is no longer active")
            record.status = SessionStatus.FINISHED

    def add_contribution(self, contribution: Contribution) -> None:
        with self._lock:
            self._prune_locked(contribution.created_at)
            if contribution.event_id in self._event_ids:
                raise DuplicateEventError("event_id has already been submitted")
            self._contributions.append(contribution)
            self._event_ids.add(contribution.event_id)

    def contributions(self, *, now: datetime | None = None) -> tuple[Contribution, ...]:
        now = now or utc_now()
        with self._lock:
            self._prune_locked(now)
            return tuple(self._contributions)

    def delete_session_contributions(self, session_id: UUID) -> int:
        with self._lock:
            deleted = [item for item in self._contributions if item.session_id == session_id]
            self._contributions = [item for item in self._contributions if item.session_id != session_id]
            for item in deleted:
                self._event_ids.discard(item.event_id)
            return len(deleted)

    def delete_session(self, session_id: UUID) -> int:
        with self._lock:
            removed = [item for item in self._contributions if item.session_id == session_id]
            self._contributions = [item for item in self._contributions if item.session_id != session_id]
            for item in removed:
                self._event_ids.discard(item.event_id)
            self._sessions.pop(session_id, None)
            return len(removed)

    def recommendation_status(self, recommendation_id: str) -> RecommendationStatus:
        with self._lock:
            return self._recommendation_statuses.get(
                recommendation_id, RecommendationStatus.PENDING_REVIEW
            )

    def set_recommendation_status(
        self, recommendation_id: str, status: RecommendationStatus
    ) -> None:
        with self._lock:
            self._recommendation_statuses[recommendation_id] = status

    def _prune_locked(self, now: datetime) -> None:
        cutoff = now - self.retention
        expired_events = [item.event_id for item in self._contributions if item.created_at < cutoff]
        if expired_events:
            expired_ids = set(expired_events)
            self._contributions = [
                item for item in self._contributions if item.event_id not in expired_ids
            ]
            self._event_ids.difference_update(expired_ids)
        session_cutoff = cutoff
        stale_sessions = [
            session_id
            for session_id, record in self._sessions.items()
            if record.created_at < session_cutoff
        ]
        for session_id in stale_sessions:
            self._sessions.pop(session_id, None)


def profile_cohort(profile: NavigationProfile) -> str:
    if profile == NavigationProfile.GENERAL:
        return "general"
    return profile.value
