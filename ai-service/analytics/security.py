"""Fail-closed authentication settings for internal and administrator APIs."""

from dataclasses import dataclass
import hmac
import os

from fastapi import Header, HTTPException, Request, status


def _positive_int(name: str, default: int, minimum: int = 1) -> int:
    raw = os.getenv(name)
    try:
        value = int(raw) if raw is not None else default
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if value < minimum:
        raise ValueError(f"{name} must be at least {minimum}")
    return value


def _positive_float(name: str, default: float, minimum: float = 0.0) -> float:
    raw = os.getenv(name)
    try:
        value = float(raw) if raw is not None else default
    except ValueError as exc:
        raise ValueError(f"{name} must be numeric") from exc
    if value <= minimum:
        raise ValueError(f"{name} must be greater than {minimum}")
    return value


@dataclass(frozen=True)
class AnalyticsSettings:
    service_token: str | None
    admin_token: str | None
    contributor_hash_secret: str | None
    retention_hours: int = 24
    navigation_session_max_hours: int = 2
    explicit_expiry_max_hours: int = 24
    minimum_sessions_per_group: int = 20
    minimum_contributors_per_group: int = 5
    disparity_ratio: float = 1.5
    minimum_duration_difference_seconds: int = 180
    consistency_fraction: float = 0.7
    consent_version: str = "consent-v1"

    @classmethod
    def from_env(cls) -> "AnalyticsSettings":
        return cls(
            service_token=os.getenv("ACCESU_SERVICE_TOKEN") or None,
            admin_token=os.getenv("ACCESU_ADMIN_TOKEN") or None,
            contributor_hash_secret=os.getenv("ACCESU_CONTRIBUTOR_HASH_SECRET") or None,
            retention_hours=_positive_int("ACCESU_ANALYTICS_RETENTION_HOURS", 24),
            navigation_session_max_hours=_positive_int("ACCESU_SESSION_MAX_HOURS", 2),
            explicit_expiry_max_hours=_positive_int("ACCESU_MAX_SHARING_HOURS", 24),
            minimum_sessions_per_group=_positive_int("ACCESU_MIN_SESSIONS_PER_GROUP", 20),
            minimum_contributors_per_group=_positive_int("ACCESU_MIN_CONTRIBUTORS_PER_GROUP", 5),
            disparity_ratio=_positive_float("ACCESU_DISPARITY_RATIO", 1.5, 1.0),
            minimum_duration_difference_seconds=_positive_int(
                "ACCESU_MIN_DURATION_DIFFERENCE_SECONDS", 180, 0
            ),
            consistency_fraction=_positive_float("ACCESU_CONSISTENCY_FRACTION", 0.7, 0.0),
            consent_version=os.getenv("ACCESU_CONSENT_VERSION", "consent-v1"),
        )


def require_service(
    request: Request,
    x_accesu_service_key: str | None = Header(default=None, alias="X-Accesu-Service-Key"),
) -> str:
    settings: AnalyticsSettings = request.app.state.analytics_settings
    if not settings.service_token or not settings.contributor_hash_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Voluntary collection is disabled until service authentication is configured",
        )
    if not x_accesu_service_key or not hmac.compare_digest(
        x_accesu_service_key, settings.service_token
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid service credentials")
    return x_accesu_service_key


def require_admin(
    request: Request,
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> str:
    settings: AnalyticsSettings = request.app.state.analytics_settings
    if not settings.admin_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Administrator analytics are disabled until an admin token is configured",
        )
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Administrator bearer token required")
    token = authorization.removeprefix("Bearer ")
    if not token or not hmac.compare_digest(token, settings.admin_token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access denied")
    return token
