"""FastAPI application entry point for the AccesU Navigation API."""

import os
import logging
from pathlib import Path
from typing import Sequence

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from navigation.registry import BuildingRegistry
from analytics.analysis import DetectionThresholds
from analytics.security import AnalyticsSettings
from analytics.store import AnalyticsStore
from data.postgres import PostgresDataAccess
from security.api_keys import SlidingWindowLimiter
from routers.navigation import ErrorResponse, router as navigation_router
from routers.sessions import router as sessions_router
from routers.analytics import router as analytics_router
from routers.api_v1 import router as api_v1_router


DEFAULT_ALLOWED_ORIGINS = ("http://localhost:3000", "http://127.0.0.1:3000")


def configured_origins() -> tuple[str, ...]:
    """Read comma-separated frontend origins, defaulting to local Next.js."""
    raw = os.getenv("ACCESU_ALLOWED_ORIGINS")
    if raw is None:
        return DEFAULT_ALLOWED_ORIGINS
    return tuple(origin.strip() for origin in raw.split(",") if origin.strip())


def configured_registry() -> BuildingRegistry:
    """Load an optional static graph file once at application startup."""
    data_file = os.getenv("ACCESU_BUILDINGS_FILE")
    if not data_file:
        return BuildingRegistry()
    return BuildingRegistry.from_json_file(Path(data_file))


def create_app(
    registry: BuildingRegistry | None = None,
    allowed_origins: Sequence[str] | None = None,
    analytics_store: AnalyticsStore | None = None,
    analytics_settings: AnalyticsSettings | None = None,
    data_access: PostgresDataAccess | None = None,
) -> FastAPI:
    """Create an app instance, with injection points used by API tests."""
    app = FastAPI(
        title="AccesU Navigation API",
        description=(
            "REST API for university-defined building graphs and accessible "
            "multi-floor route calculation."
        ),
        version="0.1.0",
    )
    app.state.building_registry = registry if registry is not None else configured_registry()
    settings = analytics_settings or AnalyticsSettings.from_env()
    app.state.analytics_settings = settings
    app.state.analytics_store = analytics_store or AnalyticsStore(
        retention_hours=settings.retention_hours
    )
    app.state.data_access = data_access or PostgresDataAccess()
    app.state.api_limiter = SlidingWindowLimiter(
        limit=int(os.getenv("AI_RATE_LIMIT_PER_MINUTE", "120"))
    )

    origins = tuple(allowed_origins) if allowed_origins is not None else configured_origins()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
    )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        response = ErrorResponse(
            message="Request validation failed",
            errors=[
                {key: value for key, value in error.items() if key != "input"}
                for error in exc.errors()
            ],
        )
        content = response.model_dump(exclude_none=True)
        if request.url.path.startswith("/api/v1/"):
            content["data"] = None
        return JSONResponse(
            status_code=422,
            content=jsonable_encoder(content),
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_error_handler(
        request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        response = ErrorResponse(message=str(exc.detail))
        content = response.model_dump(exclude_none=True)
        if request.url.path.startswith("/api/v1/"):
            content["data"] = None
        return JSONResponse(
            status_code=exc.status_code,
            content=content,
            headers=exc.headers,
        )

    @app.exception_handler(Exception)
    async def unexpected_error_handler(request: Request, exc: Exception) -> JSONResponse:
        # Avoid logging request payloads, credentials, node sequences, or SQL values.
        logging.getLogger("accesu.api").error(
            "unhandled_request_error path=%s error_type=%s",
            request.url.path,
            type(exc).__name__,
        )
        content = {"success": False, "message": "Internal server error"}
        if request.url.path.startswith("/api/v1/"):
            content["data"] = None
        return JSONResponse(status_code=500, content=content)

    @app.get("/", tags=["service"])
    def home() -> dict[str, str | bool]:
        return {"success": True, "message": "AccesU Navigation API is running", "status": "ok", "version": "0.2.0"}

    @app.get("/health", tags=["service"])
    def health() -> dict[str, str | bool | int]:
        return {
            "success": True,
            "status": "healthy",
            "version": "0.2.0",
            "available_buildings": len(app.state.building_registry.all()),
        }

    app.include_router(navigation_router)
    app.include_router(sessions_router)
    app.include_router(analytics_router)
    app.include_router(api_v1_router)
    return app


app = create_app()
