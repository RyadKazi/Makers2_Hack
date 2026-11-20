"""Network exposure guard for the legacy (pre-v1) navigation endpoints.

The Node gateway only calls ``/api/v1``, which requires an API key. The older
``/buildings`` and ``/navigation`` routes have no authentication, so by default
they are reachable from loopback only (local development, same host, or a
sidecar). Set ``ACCESU_ALLOW_REMOTE_LEGACY=true`` only when a trusted network
or gateway authenticates remote clients in front of this service.
"""

import ipaddress
import os
from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp

LEGACY_PATH_PREFIXES = ("/buildings", "/navigation/")


def allow_remote_legacy() -> bool:
    """Read the opt-in flag. Anything other than an explicit truthy value stays closed."""
    return os.getenv("ACCESU_ALLOW_REMOTE_LEGACY", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def is_loopback(host: str | None) -> bool:
    """True for IPv4/IPv6 loopback addresses, including IPv4-mapped IPv6."""
    if not host:
        return False
    if host == "localhost":
        return True
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    return address.is_loopback


class LegacyEndpointGuard(BaseHTTPMiddleware):
    """Return 404 (not 403) for legacy endpoints reached from non-loopback clients.

    Hiding the routes avoids advertising their existence while keeping local
    development and the loopback-only deployment working unchanged.
    """

    def __init__(self, app: ASGIApp, allow_remote: bool | None = None) -> None:
        super().__init__(app)
        self.allow_remote = allow_remote_legacy() if allow_remote is None else allow_remote

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        if not self.allow_remote and request.url.path.startswith(LEGACY_PATH_PREFIXES):
            client = request.client
            if client is None or not is_loopback(client.host):
                return JSONResponse(
                    status_code=404,
                    content={"success": False, "message": "Not Found"},
                )
        return await call_next(request)
