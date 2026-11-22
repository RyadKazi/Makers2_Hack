# AccesU / CampusWay

The monorepo contains a FastAPI application API in [`backend/`](backend/), a separate FastAPI navigation and accessibility analytics service in [`ai-service/`](ai-service/), and the mobile client in [`mobile/`](mobile/).

## Run the application API

Install Python dependencies and apply the existing PostgreSQL/Prisma migrations to the configured database:

```powershell
python -m pip install -r backend/requirements.txt
$env:DATABASE_URL = "postgresql://USER:PASSWORD@HOST:5432/DATABASE"
$env:JWT_SECRET = "a-random-secret-at-least-32-characters"
$env:JWT_REFRESH_SECRET = "a-different-random-secret-at-least-32-characters"
$env:PSEUDONYM_SECRET = "another-random-secret-at-least-32-characters"
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 4000
```

The API serves `/health`, `/docs`, `/openapi.json`, and the existing `/api/...` routes. `npm run dev:backend` runs the same FastAPI application after its Python dependencies are installed. `backend/Dockerfile` builds the Python service.

Set `CORS_ORIGINS` to a comma-separated list of frontend origins in production. Account endpoints use the existing `users` and `refresh_sessions` tables and bcrypt password hashes. The refresh cookie remains `cw_rt`. Optional integrations use `ACCESU_NAVIGATION_URL`, `ACCESU_NAVIGATION_API_KEY`, and Cartesia `CARTESIA_*` settings. Mobility sharing requires an explicit current consent, `PSEUDONYM_SECRET`, and a configured campus geofence.

## Service boundaries

The application API owns user authentication, authorization, campus and room reads, reservations, account preferences, and orchestration. The separate `ai-service/` exposes its versioned Dijkstra and aggregate analytics API. Admin mobility views expose stored aggregate rows with the minimum contributor threshold applied. Navigation is assistive; it does not replace physical accessibility inspection or a mobility aid.

The PostgreSQL structure remains defined by the existing migrations in `backend/prisma/migrations/`. Apply them with the project's existing migration tooling before starting the Python API. The API no longer starts Prisma or the previous Node server at runtime.

## Migration notes

The FastAPI application is the runtime entry point. The prior TypeScript source and tests remain in `backend/src/` and `backend/tests/` as migration reference material; they are not started by the Python app. FastAPI now handles account/auth flows, profiles, campus/room/reservation access, route planning, AI routing, speech, consented mobility sessions and points, SVG floor plans, and core admin review/read APIs.

This is not yet behaviorally identical across every edge case: `/api/routes/{id}/recheck` currently returns progress without the former stored-route deviation/rerouting logic; nearest accessibility POIs and live Socket.IO notifications are not implemented; the five-minute mobility aggregation/recommendation scoring job has no Python replacement, so aggregate tables must still be populated by the existing job/tooling. The route planner keeps the same graph constraints and Dijkstra choice, but its instruction/GeoJSON details are simpler than the former planner. Review these differences before production cutover.

Run the Python navigation service separately as described in [`ai-service/README.md`](ai-service/README.md).
