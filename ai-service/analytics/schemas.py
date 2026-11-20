"""Validated schemas for consent, journey contributions, and admin analytics."""

from datetime import datetime
from enum import Enum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from navigation.accessibility import NavigationProfile, RouteConstraints


class SessionDurationChoice(str, Enum):
    THIS_NAVIGATION = "this_navigation"
    UNTIL_EXPIRY = "until_expiry"


class SessionStatus(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    FINISHED = "finished"
    EXPIRED = "expired"


class ConditionContext(str, Enum):
    TYPICAL = "typical"
    TEMPORARY_DISRUPTION = "temporary_disruption"
    ELEVATOR_UNAVAILABLE = "elevator_unavailable"
    UNKNOWN = "unknown"


class ObstacleType(str, Enum):
    BLOCKED_PATH = "blocked_path"
    NARROW_PASSAGE = "narrow_passage"
    RAMP_TOO_STEEP = "ramp_too_steep"
    ELEVATOR_UNAVAILABLE = "elevator_unavailable"
    UNEVEN_SURFACE = "uneven_surface"
    OTHER_DIFFICULTY = "other_difficulty"


class RecommendationStatus(str, Enum):
    PENDING_REVIEW = "pending_review"
    UNDER_INSPECTION = "under_inspection"
    APPROVED = "approved"
    REJECTED = "rejected"
    IMPLEMENTED = "implemented"


class ObstacleReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    report_type: ObstacleType
    node_id: str = Field(min_length=1)


class StartSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    building_id: str = Field(min_length=1)
    consent_given: Literal[True]
    consent_version: str = Field(min_length=1, max_length=64)
    duration_choice: SessionDurationChoice
    expires_at: datetime | None = None

    @field_validator("expires_at")
    @classmethod
    def expiry_must_have_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("expires_at must include a timezone")
        return value


class StartSessionResponse(BaseModel):
    success: bool = True
    message: str = "Voluntary contribution session started"
    session_id: UUID
    session_token: str
    status: SessionStatus
    expires_at: datetime


class ConsentDisclosure(BaseModel):
    success: bool = True
    consent_version: str
    purpose: str
    collected: list[str]
    not_collected: list[str]
    access: str
    retention_hours: int
    controls: list[str]


class SessionStatusResponse(BaseModel):
    success: bool = True
    session_id: UUID
    status: SessionStatus
    expires_at: datetime
    consent_version: str


class JourneyEventRequest(BaseModel):
    """One finished or attempted trip; node order is validated then discarded."""

    model_config = ConfigDict(extra="forbid")

    event_id: UUID
    origin_node: str = Field(min_length=1)
    destination_node: str = Field(min_length=1)
    profile: NavigationProfile
    completed: bool
    duration_seconds: float = Field(ge=0, le=43_200)
    node_sequence: list[str] = Field(default_factory=list, max_length=256)
    constraints: RouteConstraints = Field(default_factory=RouteConstraints)
    context: ConditionContext = ConditionContext.UNKNOWN
    obstacle_reports: list[ObstacleReport] = Field(default_factory=list, max_length=32)


class JourneyEventResponse(BaseModel):
    success: bool = True
    message: str = "Contribution recorded"
    event_id: UUID
    distance_m: float
    route_nodes_retained: Literal[False] = False


class SessionActionResponse(BaseModel):
    success: bool = True
    session_id: UUID
    status: SessionStatus
    expires_at: datetime


class SessionDeleteResponse(BaseModel):
    success: bool = True
    deleted_contributions: int


class GroupStatistics(BaseModel):
    profile: NavigationProfile
    session_count: int
    distinct_contributors: int
    completed_journeys: int
    completion_rate: float
    median_duration_seconds: float | None
    median_distance_m: float | None
    route_available: bool


class Disparity(BaseModel):
    building_id: str
    origin_node: str
    destination_node: str
    context: ConditionContext
    general: GroupStatistics
    accessibility: GroupStatistics
    duration_difference_seconds: float | None
    duration_ratio: float | None
    distance_difference_m: float | None
    consistency: float | None
    status: Literal["detected", "unreachable", "inconclusive"]
    evidence: list[str]


class OverviewResponse(BaseModel):
    success: bool = True
    eligible_pairs: int
    disparities: int
    unreachable_accessible_pairs: int
    recommendations: int
    analysis_window_hours: int
    thresholds: dict[str, float | int]


class DisparitiesResponse(BaseModel):
    success: bool = True
    disparities: list[Disparity]


class HeatmapItem(BaseModel):
    node_id: str
    floor_id: str
    x: float
    y: float
    general_sessions: int
    accessibility_sessions: int
    profile_sessions: dict[str, int]
    disparity: bool
    obstacle_reports: dict[ObstacleType, int]


class HeatmapResponse(BaseModel):
    success: bool = True
    building_id: str
    minimum_cohort_met: bool
    items: list[HeatmapItem]


class CandidateLocation(BaseModel):
    floor_id: str
    x: float
    y: float
    near_node_id: str
    staircase_node_id: str


class Recommendation(BaseModel):
    recommendation_id: str
    building_id: str
    recommendation_type: Literal["accessible_vertical_connection", "accessibility_inspection"]
    title: str
    status: RecommendationStatus
    related_staircase_id: str | None
    candidate_locations: list[CandidateLocation]
    nearby_node_ids: list[str]
    affected_origin_destination_pairs: list[dict[str, str]]
    supporting_sessions: int
    supporting_contributors: int
    current_accessible_distance_m: float | None
    simulated_distance_m: float | None
    estimated_distance_saved_m: float | None
    estimated_time_saved_seconds: float | None
    confidence: Literal["low", "moderate", "high"]
    evidence: list[str]
    limitations: list[str]
    requires_physical_inspection: Literal[True] = True


class RecommendationsResponse(BaseModel):
    success: bool = True
    recommendations: list[Recommendation]


class RecommendationResponse(BaseModel):
    success: bool = True
    recommendation: Recommendation


class RecommendationStatusRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: RecommendationStatus


class StatusUpdateResponse(BaseModel):
    success: bool = True
    recommendation_id: str
    status: RecommendationStatus
