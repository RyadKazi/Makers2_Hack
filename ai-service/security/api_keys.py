"""Permission-checked API key auth and a bounded per-key request limiter."""

from collections import defaultdict, deque
from threading import Lock
import os
import time
from typing import Callable

from fastapi import Depends, Header, HTTPException, Request

from data.postgres import DatabaseUnavailable, PostgresDataAccess


class SlidingWindowLimiter:
    def __init__(self, limit: int = 120, window_seconds: int = 60) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key_id: str) -> bool:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key_id]
            while hits and hits[0] <= now - self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            return True


def require_permission(permission: str) -> Callable:
    def dependency(
        request: Request,
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> str:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Bearer API key required")
        raw_key = authorization.removeprefix("Bearer ")
        repository: PostgresDataAccess = request.app.state.data_access
        try:
            authenticated = repository.authenticate_api_key(raw_key)
        except DatabaseUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        if authenticated is None:
            raise HTTPException(status_code=401, detail="Invalid, expired, or revoked API key")
        key_id, permissions = authenticated
        if permission not in permissions and "*" not in permissions:
            raise HTTPException(status_code=403, detail="API key lacks required permission")
        limiter: SlidingWindowLimiter = request.app.state.api_limiter
        if not limiter.allow(key_id):
            raise HTTPException(status_code=429, detail="API key rate limit exceeded")
        return key_id

    return dependency
