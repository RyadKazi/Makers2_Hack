# AccesU

AccesU is a hackathon prototype for helping university students find campus information and plan routes that reflect their accessibility preferences. The project combines a student mobile app, an application API, and a separate navigation and analytics service.

> **Project status:** AccesU is not finished and is not production-ready. It is being built for a hackathon. Maps and graphs need to be supplied and checked by each university; route results are only as reliable as that data. AccesU provides assistive directions, not a safety guarantee, and does not replace an on-site accessibility assessment or a student's usual mobility aids.

## The idea

University campuses can be hard to navigate, especially when buildings are unfamiliar or the shortest route includes stairs, a closed passage, or another barrier. AccesU aims to bring campus maps, room information, accessibility-aware directions, and communication tools together in one student-facing application.

Routes are calculated over an explicit graph. **Nodes** represent places such as entrances, junctions, doors, rooms, elevators, and ramps. **Edges** represent connections students can travel between those places and can carry properties such as distance, stairs, slope, width, surface, verification, and temporary availability. Dijkstra's algorithm finds the shortest route among the connections allowed by the selected constraints. It does not create the graph or determine whether a connection is safe.

## What is in the repository

| Part | Purpose | Current state |
| --- | --- | --- |
| `mobile/` | Expo and React Native student app for campus search, maps, route planning, access preferences, and communication prototypes. | Implemented prototype; some flows and device behavior still need validation. |
| `backend/` | FastAPI application API for student accounts, campus and room data, route planning, mobility consent, speech, and admin endpoints. | Current runtime is `backend/main.py`; it needs a configured PostgreSQL database and populated campus data. |
| `ai-service/` | Separate FastAPI service for graph-based navigation, consented contributions, and aggregate accessibility analysis. | Includes a synthetic graph for local demos; not a real university map. |
| `frontend/` | Reserved location for a future web app. | Placeholder only; a web app has not been built. |

The current API runtime is Python. Some TypeScript/Express code, tests, and documentation under `backend/` remain from an earlier implementation and are migration/reference material; they are not the API process started by the commands below.

## Architecture

```mermaid
flowchart LR
  Student[Student] --> Mobile[Expo mobile app]
  Mobile -->|HTTP JSON, /api/...| AppAPI[FastAPI application API]
  AppAPI --> DB[(PostgreSQL + PostGIS)]
  AppAPI -->|Optional private route relay| NavAPI[FastAPI navigation service]
  NavAPI --> Graph[(University graph or configured demo graph)]
  FutureWeb[Future web app] -. planned .-> AppAPI
```

The mobile client calls the application API, which owns accounts, profiles, campus data, and consent. Its `/api/routes/plan` endpoint calculates routes from the graph stored in the application database. The optional `/api/ai/route` endpoint relays requests to the separate navigation service and requires server-side API-key configuration. The mobile route planner does not need Gemini; Gemini-based graph extraction is not implemented.

## Main capabilities

- Student registration and login, short-lived bearer access tokens, and refresh-cookie sessions.
- Campus, building, floor, room, and point-of-interest search backed by the application API.
- Route planning with walking and wheelchair modes, accessibility-profile constraints, route alternatives, floor geometry, and turn instructions where the graph supports them.
- Accessibility preferences for step-free travel, ramp slope, passage width, verified ramps, audio guidance, captions, and display settings.
- Voluntary mobility sharing with consent, session controls, and difficulty reports. Sharing is not required for ordinary map or route use.
- An optional navigation/analytics service with its own graph API, consented contribution endpoints, and cohort-suppressed aggregate analysis.
- Communication prototypes: the mobile speech-to-text screen currently uses sample transcript data; text-to-speech uses the device speech engine. Optional server TTS requires a configured provider.

See the [mobile guide](mobile/README.md) and [navigation service guide](ai-service/README.md) for details and limitations.

## Technology

- Python 3.11+, FastAPI, Uvicorn, Pydantic, psycopg, and bcrypt for the current application API and the separate navigation service.
- PostgreSQL with PostGIS for campus, floor, and navigation data. The database structure is maintained by migrations in `backend/prisma/migrations/`.
- Python Dijkstra implementations for graph route calculation.
- React Native, Expo, Expo Router, and TypeScript for the mobile client.
- Optional external integrations such as Cartesia TTS; provider credentials stay on the server.

## Run locally

### Requirements

- Python 3.11 or newer.
- PostgreSQL with PostGIS available. The application API expects the migrated campus schema.
- Node.js and npm for the Expo mobile app; Expo Go or an Android/iOS simulator for interactive use.
- `psql` and the Prisma CLI for database setup.

### 1. Configure the application database and API

Create a PostgreSQL database with PostGIS support, then from the repository root set the environment for this PowerShell session. Replace the example URL and secrets with values for your local setup. Use separate random secrets of at least 32 characters.

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements.txt

$env:DATABASE_URL = "postgresql://USER:PASSWORD@127.0.0.1:5432/DATABASE"
$env:JWT_SECRET = "replace-with-a-random-secret-of-at-least-32-characters"
$env:JWT_REFRESH_SECRET = "replace-with-a-different-random-secret-of-at-least-32-characters"
$env:PSEUDONYM_SECRET = "replace-with-another-random-secret-of-at-least-32-characters"
$env:CORS_ORIGINS = "http://localhost:3000"

npx --yes prisma@6.19.3 migrate deploy --schema backend/prisma/schema.prisma
npm run dev:backend
```

The API listens on port `4000`. Open [Swagger UI](http://localhost:4000/docs), the [OpenAPI document](http://localhost:4000/openapi.json), or check [health](http://localhost:4000/health).

**Database data is not created automatically by the FastAPI startup.** Applying migrations creates the schema, but campus buildings, rooms, navigation nodes, and edges must also be loaded. The sample graph in `ai-service/examples/demo_building.json` belongs to the separate navigation-service demo; it does not populate the application database used by `/api/routes/plan`. Do not present synthetic data as a surveyed university map.

For Linux or macOS, use `python3 -m venv .venv`, `source .venv/bin/activate`, and export the same environment variables before running the migration and API commands.

### 2. Run the mobile app

In a second terminal:

```powershell
cd mobile
npm install
Copy-Item .env.example .env
npm start
```

Set `EXPO_PUBLIC_API_BASE_URL` in `mobile/.env` to the application API root, including `/api`:

- Android emulator: `http://10.0.2.2:4000/api`
- iOS simulator: `http://127.0.0.1:4000/api`
- Physical phone: `http://<COMPUTER_LAN_IP>:4000/api` (phone and computer must share a reachable network)

Scan the Expo QR code with Expo Go, or start the Android/iOS simulator. Do not place private API keys in `EXPO_PUBLIC_*` variables.

### 3. Optional: run the standalone navigation-service demo

This uses the explicitly synthetic graph in `ai-service/examples/demo_building.json` and is separate from the application API database route planner.

```powershell
cd ai-service
py -3.11 -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
$env:ACCESU_BUILDINGS_FILE = "examples/demo_building.json"
python -m uvicorn main:app --reload --port 8000
```

Open [the service docs](http://127.0.0.1:8000/docs). If the graph file is not configured, the standalone legacy registry starts empty. PostgreSQL-backed `/api/v1` endpoints require the service migration and API keys described in the [navigation service guide](ai-service/README.md).

## API overview

The application API is rooted at `/api`:

| Area | Example endpoints |
| --- | --- |
| Accounts and profiles | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/me`, `GET/PUT /api/me/accessibility-profile` |
| Campus and search | `GET /api/campus/`, `GET /api/campus/buildings`, `GET /api/campus/search-index`, `GET /api/campus/floors/{id}` |
| Rooms and reservations | `GET /api/rooms`, `GET /api/rooms/{id}`, `/api/reservations` |
| Application route planner | `POST /api/routes/plan`, `POST /api/routes/{id}/recheck` |
| Optional service relay | `GET /api/ai/health`, `POST /api/ai/route` |
| Speech and mobility | `/api/speech/*`, `/api/mobility/*` |
| Administration | `/api/admin/*` |

Use `/docs` for request schemas, authentication requirements, and current response formats. Authenticated endpoints use `Authorization: Bearer <access-token>`; session refresh uses an HTTP-only cookie.

## Checks

Mobile checks, from the repository root:

```powershell
npm --prefix mobile install
npm --prefix mobile run typecheck
npm --prefix mobile test -- --runInBand
npm --prefix mobile run lint
```

Navigation-service tests, from the repository root:

```powershell
cd ai-service
python -m pip install -r requirements.txt
python -m pip install pytest httpx
python -m pytest -v
```

The root `npm test` script currently runs the mobile tests. The TypeScript backend tests are retained migration/reference material; they do not test the current Python application API runtime. The Python application API does not yet have a complete dedicated test suite.

## Known limitations and next steps

This is active hackathon work and some parts are incomplete:

- A finished student web app does not exist yet; `frontend/` is only a placeholder.
- There is no university-facing graph editor or automatic graph creation. Campus graph data must be supplied and checked by the university.
- A fresh application database is not automatically seeded, so routes cannot work until real or clearly labelled demo campus data is loaded.
- The current route recheck endpoint does not provide all of the former deviation detection and rerouting behavior.
- The AI service's demo graph is synthetic. Its analytics are deterministic and rule-based, not trained machine learning.
- Live location-to-floor-plan positioning, background tracking, and real microphone transcription are not complete in the mobile app.
- Device-specific behavior, including refresh-cookie persistence and accessibility with assistive technologies, still needs broader Android and iOS review.
- Route geometry and accessibility facts are only as accurate as the graph and map data. No route should be described as verified unless the underlying campus data has been verified.

Likely next steps are to obtain a verified graph for a pilot building, make the application database seeding/import process repeatable, finish API and device integration checks, and then build the web client in `frontend/`.

## Safety and privacy

Campus directions are assistive and may be incomplete or outdated. Students should check for current closures and use their normal mobility aids and support. Mobility contribution must remain voluntary, explicit, and off unless the student starts it. Keep secrets out of source control and client-side environment variables; expose aggregate analytics only and follow the consent and retention rules documented in the service code.
