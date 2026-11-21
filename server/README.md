# accesU — server

Express 5 + TypeScript (strict, ESM) API backed by PostgreSQL 16 + PostGIS through Prisma (with raw SQL for spatial work), plus Socket.io.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API with hot reload (tsx watch) on `PORT` (default 4000) |
| `npm run build` / `npm start` | Compile to `dist/` / run the compiled build |
| `npm run typecheck` | `tsc --noEmit` over src, prisma, scripts and tests |
| `npm test` | Vitest + Supertest: unit tests and API/socket integration tests against an in-process PostGIS (see [Tests](#tests)) |
| `npm run openapi:export` | Write the OpenAPI document to `../client/src/api/openapi.json` |
| `npm run db:migrate` | `prisma migrate deploy` |
| `npm run db:seed` | Reset and seed the demo campus (**truncates every table**) |
| `npm run db:reset` | Drop, re-migrate and re-seed |

Configuration is validated with Zod at startup ([src/config/env.ts](src/config/env.ts)); see [.env.example](.env.example).

## Layout

```
src/
  app.ts               createApp(deps): helmet, CORS, JSON, cookies, pino-http, /health, /docs, /openapi.json, /api/*
  index.ts             HTTP + Socket.io + cron bootstrap, graceful shutdown
  config/env.ts        Zod-validated environment
  http/route.ts        defineRouter(): one spec per endpoint → auth, validation, response DTO, OpenAPI
  openapi/             route registry, document builder, shared schemas
  lib/                 logger, prisma, HttpError, events (domain bus), i18n (ar/fr/en), time (Africa/Algiers)
  middleware/          auth (Bearer + role guard), validate (Zod), errorHandler, rateLimit
  jobs/                roomStatusTicker: cron, every minute
  sockets/             Socket.io server; live.ts = namespace /live
  modules/
    auth/              register/login/refresh/logout, /me, accessibility profile, JWT helpers
    campus/            buildings, floors, GeoJSON layers (raw PostGIS SQL in campus.repository.ts)
    rooms/             status.ts (pure status + freeAt), search, room details
    reservations/      overlap.ts (pure rules), CRUD with race-safe overlap checks
    admin/             open/close a passage (feeds edge:status)
    routing/           graph.ts (constraint-aware Dijkstra), graph.repository.ts (cached graph)
    mobility/          heatmap.ts (k-anonymous aggregation)
    ai/                (step 6)
prisma/
  schema.prisma
  migrations/          0001_init (PostGIS), 0002_auth_reservations (tokenVersion, EXCLUDE constraint)
  seed/                campus.ts (model), mobility.ts, people.ts, steps.ts (reusable), index.ts (CLI)
scripts/export-openapi.ts
tests/                 unit (*.test.ts), integration (*.api.test.ts, live.socket.test.ts), setup/global-db.ts
```

## API

Interactive docs: **http://localhost:4000/docs** (Swagger UI). Machine-readable: **/openapi.json** (OpenAPI 3.1), also exported to the client with `npm run openapi:export`.

Every endpoint is declared once with `defineRouter(basePath, tag).route(spec, handler)` ([src/http/route.ts](src/http/route.ts)). Its Zod schemas validate the request, type the handler, **parse the response** (unknown fields such as `passwordHash` are stripped; a DTO mismatch is a logged 500) and generate the OpenAPI document. The docs cannot drift from the code.

| Area | Endpoints | Access |
|---|---|---|
| Auth | `POST /api/auth/register · login · refresh · logout · logout-all` | public (logout-all: signed in) |
| Me | `GET/PUT /api/me`, `GET/PUT /api/me/accessibility-profile` | signed in |
| Campus | `GET /api/campus`, `/buildings`, `/buildings/:id/floors`, `/floors/:id`, `/floors/:id/layers?types=` | public |
| Rooms | `GET /api/rooms?search=&status=&buildingId=&floor=&minCapacity=&stepFree=`, `GET /api/rooms/:idOrCode` | public |
| Reservations | `GET /api/reservations`, `GET /:id` (signed in); `POST`, `PATCH /:id`, `DELETE /:id` | teacher / admin |
| Routes | `POST /api/routes/plan`, `POST /api/routes/:id/recheck` | public (profile applied when signed in) |
| Mobility | `GET/POST/DELETE /api/mobility/consent`, `DELETE /api/mobility/data`, `POST /api/mobility/sessions`, `GET /sessions/current`, `POST /sessions/:id/stop`, `POST /api/mobility/points`, `POST /api/mobility/events` | signed in (+ consent) |
| Admin | `PATCH /api/admin/edges/:id/status` (open/close a passage); `GET /api/admin/heatmap · hotspots · corrections · recommendations · stats`; `POST /corrections/:id/approve · reject`; `PATCH /recommendations/:id` | admin |

Labels follow `?lang=ar|fr|en` or `Accept-Language` (default fr). Times are ISO-8601 UTC.

### Auth

- **Access token**: JWT (HS256, 15 min) in `Authorization: Bearer …`, carrying the user id and role.
- **Refresh token**: JWT with a separate secret (7 days) in the httpOnly, `SameSite=Strict`, `Path=/api/auth` cookie `cw_rt` (`Secure` in production). It is rotated on every refresh and never appears in a response body. It embeds the user's `tokenVersion`: `/logout-all` bumps it and revokes every session.
- Registration always creates a **STUDENT**; teacher and admin roles are granted by an administrator. Login and register are rate-limited (20 per 15 min per IP), and an unknown email costs the same bcrypt time as a wrong password.
- The accessibility profile is visible only to its owner. Until it is saved, defaults are returned with `updatedAt: null`.

### Room status

`RoomStatus = { status: AVAILABLE | TEACHER | ADMIN | CLUB, label, occupantName, title, reservationId, until, freeAt }` ([src/modules/rooms/status.ts](src/modules/rooms/status.ts), a pure function):

- **Occupied**: `until` is the end of the current reservation, and `freeAt` follows back-to-back reservations to when the room is really free.
- **Available**: `until` is the start of the next reservation within 24 h (`null` if none), and `freeAt` is now.
- Intervals are half-open `[start, end)`. If bad data overlaps, ADMIN takes priority over TEACHER, which takes priority over CLUB.

Room details add today's schedule (Africa/Algiers), `stepFreeAccess` (reachable from the campus gate without steps through open passages), `wheelchairAccessible` (step-free, slope ≤ 8 %, passages and door ≥ 80 cm), the door clearance, and the **nearest elevator and accessible toilet by step-free walking distance** (crossing floors through elevators when needed).

### Reservations

- Durations are 15 min to 12 h, and a reservation cannot start in the past (5 min tolerance). Back-to-back is allowed. Any overlap returns **409 `RESERVATION_CONFLICT`**, with the conflicting reservations in `error.details.conflicts`.
- Race safety: the room row is locked (`SELECT … FOR UPDATE`) while the overlap check and the write run. A PostgreSQL `EXCLUDE USING gist (roomId WITH =, tsrange(startsAt, endsAt) WITH &&)` constraint is the backstop: two simultaneous identical requests get one 201 and one 409.
- Teachers create TEACHER reservations (always under their own name) or CLUB ones (with the club as organizer), and change or cancel only their own. Admins can do everything, including ADMIN reservations. Ended reservations are read-only.

## Routing

### Who owns what

| Part | Owner | Where |
|---|---|---|
| **Routing algorithm** | **Routing teammate** | [src/modules/routing/core/](src/modules/routing/core/). **Not delivered yet.** API code never edits it. |
| Temporary stand-in engine | API (step 1 Dijkstra) | [engine/standInDijkstra.ts](src/modules/routing/engine/standInDijkstra.ts) wrapping [graph.ts](src/modules/routing/graph.ts) |
| Everything around the algorithm | API | the rest of [src/modules/routing/](src/modules/routing/) |

### How the algorithm is plugged in (adapter pattern)

```
nav_nodes / nav_edges ──▶ graph.repository.ts   in-memory graph: loaded at startup, reloaded on edge.changed / graph.changed
                               │
profile + request ──▶ constraints.ts   effective constraints; split into native engine options vs pre-filtered edges
                               │
                 costs.ts ──▶ pathfinder.ts ──▶ engine adapter (RoutingEngine) ──▶ algorithm
                               │   validates the returned path hop by hop (connectivity + constraints)
                               ▼
planner.ts (options, ETA, counts, GeoJSON per floor, "why no route") · instructions.ts (AR/FR/EN steps)
routing.service.ts (plan, recheck, reroute, live invalidation) · routeStore.ts (planned routes, 3 h TTL)
```

- **Interface**: [engine/types.ts](src/modules/routing/engine/types.ts). An adapter has `buildGraph(nodes, edges)` to convert our graph into the algorithm's format, `findPath(graph, { fromNodeId, toNodeId, constraints, edgeCost })` returning `{ nodeIds, edgeIds }` or `null`, and `capabilities`. The active engine is chosen in [engine/index.ts](src/modules/routing/engine/index.ts). Drop-in steps are in [core/README.md](src/modules/routing/core/README.md).
- **Constraints the engine doesn't support** are removed from the edge list *before* calling it, so the algorithm is never modified. Example: `verifiedOnly` is pre-filtered for the stand-in. Responses list them in `prefilteredConstraints`.
- **Cost hook** (only when `capabilities.customEdgeCost` is true): the cost is the length × a surface factor (gravel ×1.6 in a wheelchair, pavers ×1.1), plus 15 m per elevator, plus 25 m per unverified ramp, plus a crowd penalty. `setCrowdPenaltyProvider()` is the HeatmapCell hook and returns 0 until step 4. Reported distances are always real metres.
- **Trust but verify**: every path returned by an engine is checked. A broken one is a logged 500 `ROUTING_ENGINE_ERROR`, never a wrong instruction to a user.

### POST /api/routes/plan

`{ from, to, constraints?, mode?, options?, shorelineHints?, lang? }`. A location is `{ type: 'room', id: 'B-212' }`, `{ type: 'poi' | 'node', id }`, or `{ type: 'point', x, y, level }`. Points are snapped to the nearest walkable node with a PostGIS KNN query, up to 40 m away.

- **Constraints**: when signed in, the user's accessibility profile is the starting point. Request values override it: `avoidStairs`, `maxSlopePercent`, `minDoorWidthCm`, `verifiedRampsOnly`, `verifiedOnly`, `avoidEdgeIds`, and `useProfile: false` to ignore the profile. Closed passages are always excluded.
- **Options**: `fastest` (the user's constraints) and `step-free` (the same plus no stairs or steps). Only one is returned when they are the same route, or when the user already requires step-free.
- **Each option**: `distanceM`, `etaSec` (wheelchair 0.9 m/s; walking 1.3 m/s, slower for blind or reduced-mobility profiles; +30 s elevator wait; steps counted individually), `elevatorCount`, `rampCount`, `stairsCount`, `levels`, `warnings` (unverified ramp, gravel, slope > 8 %, steps), `geojson` per floor (outdoors = `floorId: null`), and `steps[]`.
- **No route**: `unavailable[]` says which constraint blocks the route and where. The planner relaxes the constraints one at a time, for example *"Passage trop étroit : 75 cm pour 85 cm minimum (Porte A-102)."* It reports `COMBINATION` when several constraints must be relaxed together, and `DISCONNECTED` when no path exists at all.

### Instructions

[instructions.ts](src/modules/routing/instructions.ts) turns the path into steps of type START, WALK, RAMP, STEPS, ELEVATOR, STAIRS, ENTER, EXIT and ARRIVE.

- Straight runs are merged, and turns (> 25°) are computed from the geometry.
- Consecutive elevator legs become one ride.
- Each step names the landmark to aim for.
- **Shoreline hints** use `wallSide` (flipped when an edge is walked backwards) and `wallDistanceM`, for example *"Gardez le mur à votre gauche sur 15 m"*. The structured `shoreline` object is always included. The sentence is added when `shorelineHints` is set in the request or the profile.

### POST /api/routes/:id/recheck

`{ position: { x, y, level, accuracyM? }, option? }` returns one of these statuses:

- `ON_ROUTE`, with progress (completed and remaining metres, next step).
- `ARRIVED`, within 5 m of the destination.
- `REROUTED`, with a `reason` (`OFF_ROUTE` when more than max(8 m, 2 × accuracy) from the route, `WRONG_FLOOR`, or `EDGE_CLOSED` when a passage ahead closed or no longer meets the constraints) and the new route.
- `NO_ROUTE`, with the explanation.

Each reroute bumps the route `version` and emits `route:invalidated`. Closing a passage also emits `route:invalidated` immediately (`rerouted: false`) to every route that uses it, so the client knows to recheck.

## Crowdsourced mobility (privacy by design, Law 18-07)

Code: [src/modules/mobility/](src/modules/mobility/). Every privacy limit is in [privacy.ts](src/modules/mobility/privacy.ts).

| Rule | How |
|---|---|
| **Opt-in** | `POST /mobility/consent { policyVersion }` stores the accepted version (`MOBILITY_POLICY_VERSION`). Without an active, up-to-date consent, starting a session or sending points returns `403 CONSENT_REQUIRED` (or `CONSENT_OUTDATED` after a policy change). `GET /mobility/consent` returns the policy summary in AR/FR/EN. |
| **Opt-out and deletion** | `DELETE /mobility/consent` ends the running session (`CONSENT_WITHDRAWN`) and **offers** deletion (`deletionOffer`). `?deleteData=true` or `DELETE /mobility/data` deletes every session, point and report still linkable to the user. |
| **Pseudonyms, no names** | `pseudoId = HMAC-SHA256(PSEUDONYM_SECRET, userId · day · daily random salt)` ([pseudonym.ts](src/modules/mobility/pseudonym.ts)). It rotates every Africa/Algiers day. Sessions store only the pseudonym, the day, a **coarse needs category**, timestamps and counts. No mobility table has a user id. Ownership of a session is checked by recomputing the caller's pseudonym. |
| **Unlinkable after 30 days** | Daily salts are kept for 30 days, only so that deletion requests work, then purged together with the raw data. After that, nothing can link the aggregates back to a person, not even the server. |
| **Geofence** | Each point is tested with PostGIS `ST_Covers(campus.geofence, point)`. The first point outside **ends the session (`GEOFENCE_EXIT`)** and is dropped, along with the rest of the batch. Reports from outside campus get a 422. |
| **Auto-stop** | After **3 h (`TIME_LIMIT`)** or at **midnight (`DAILY_RESET`)**, whichever comes first. Points after the stop are dropped. A job closes abandoned sessions every minute. `GET /mobility/sessions/current` (polled) returns `autoStopAt`, a `reminder` during the last 15 minutes, and why a session ended. |
| **Point quality** | Up to 100 points per batch. Points with accuracy above 10 m, outside the session window, or implying more than 3 m/s (positioning jumps) are dropped. The rest is smoothed with accuracy-weighted exponential smoothing ([smoothing.ts](src/modules/mobility/smoothing.ts)). |
| **Retention** | An hourly job deletes points, events and sessions older than 30 days, plus their salts. |
| **Aggregates only, k-anonymity** | Admin endpoints return aggregates, never sessions, tracks or notes. A heatmap cell or hotspot seen by **fewer than 5 distinct daily pseudonyms is never stored** (enforced by a DB `CHECK`) and never returned. In hotspots and stats, categories under 5 are merged into OTHER or suppressed (`null`). |

**Route tags**: each point (`points[].routeId`) and each report (`routeId`) can carry the id of the route being followed (from `/routes/plan`). Route ids are random UUIDs, and the in-memory route store keeps **no user id**, so a tag cannot link a track to an account.

**Reports**: `POST /mobility/events` accepts BLOCKED, TOO_STEEP and HARD_TO_NAVIGATE with an optional note. Contact details in notes are redacted, and notes are never shown individually to admins. Each report is attached to the nearest passage within 6 m (PostGIS).

**Detectors** (job, every minute, [detectors.ts](src/modules/mobility/detectors.ts) + [analysis.ts](src/modules/mobility/analysis.ts)). Inferred events carry a `detector` and are never confused with what students reported.

- **STUCK**: a stay of more than 90 s within 3 m, ignored inside rooms and within 4 m of a door or POI.
- **REROUTED**: a U-turn (> 150° between legs of ≥ 5 m) within 6 m of an obstacle (steps, ramp > 8 %, closed or narrow passage).
- **Repeated U-turns**: two or more within 60 s and 20 m are recorded as HARD_TO_NAVIGATE.

**Aggregation** (job, every 5 minutes, [pipeline.ts](src/modules/mobility/pipeline.ts)):

1. **Heatmap**: a 2 m grid for each period (TODAY, 7D, 30D) and segment (ALL, DISABILITY, each category). It records visits (distinct trips), contributors, difficulties and stuck events.
2. **Hotspots**: PostGIS `ST_ClusterDBSCAN` (eps 4 m, ≥ 5 events) over 30 days of events, kept when there are 5 or more contributors. Each hotspot gets its passage, and its **shoreline**: the nearest wall, curb or railing segment, which side of the passage it is on, and its distance.
3. **Map-correction proposals** (PENDING, **never auto-applied**). A steep ramp gives SLOPE, a blocked passage EDGE_CLOSED, a narrow one WIDTH, steps MISSING_FEATURE, and disorientation SHORELINE (wall side, distance and a hint for the passage). Proposals the admin rejected or accepted in the last 30 days are not re-proposed. **Approve** (`apply` can adjust the values) writes the changes to the `NavEdge`, reloads the routing graph, and sends `route:invalidated` to routes that no longer meet their constraints. An approved SHORELINE is then used by the routing instructions.
4. **Recommendations** (RAMP, ELEVATOR, WIDEN_DOOR, ACCESSIBLE_ENTRANCE, SIGNAGE):
   - Impact = disabled-student passes per week × stuck-or-blocked rate × detour (m). The **detour** is the step-free way around the obstacle, computed by the routing engine through its adapter, or 300 m when none exists.
   - Score = 100 × (1 − e^(−impact / 1500)).
   - Each comes with a plain AR/FR/EN rationale, e.g. *"19 wheelchair trips/week take a 136 m detour because Entrée principale Bloc B has 3 steps (43 % get stuck or blocked there)."*
   - Wayfinding problems lead to SIGNAGE, not construction; their "detour" is a fixed 20 m estimate.
   - Statuses set by admins (PLANNED, DONE, DISMISSED) survive engine refreshes.

## Speech (text-to-speech)

Code: [src/modules/speech/](src/modules/speech/).

- **`GET /api/speech/status`**: whether the server can speak, and in which languages (each language needs a voice).
- **`POST /api/speech/tts`** (signed in): `{ text ≤ 600, lang, speed? 0.6–1.5 }` returns MP3 audio from Cartesia Sonic (`CARTESIA_TTS_MODEL`, default `sonic-3.6`, through `POST https://api.cartesia.ai/tts/bytes` with `Cartesia-Version: 2026-08-14`).
  - The API key stays on the server.
  - Voices: `CARTESIA_VOICE_ID_AR` / `_FR` / `_EN`, or the shared `CARTESIA_VOICE_ID`.
  - Audio is cached in memory (LRU, 300 entries / 30 MB), since navigation repeats the same sentences.
  - Limit: 60 requests per minute.
  - Errors: `503 TTS_UNAVAILABLE` (no key or no voice for that language) and `502 TTS_UPSTREAM_ERROR`. In both cases the client uses the device voice (`speechSynthesis`).

## Live updates (Socket.io)

Namespace **`/live`**, one room per floor. The client sends its language in the handshake: `io('/live', { auth: { lang: 'ar' } })`.

| Direction | Event | Payload |
|---|---|---|
| client → server | `floor:join` | `{ floorId }` (or `"outdoor"`). Ack: `{ ok: true, statuses: RoomStatusEvent[] }` or `{ ok: false, error }` |
| client → server | `floor:leave` | `{ floorId }` |
| server → client | `room:status` | `{ roomId, code, floorId, status: RoomStatus, at }` |
| server → client | `edge:status` | `{ edgeId, floorId, isOpen, closedReason, at }` |
| client → server | `route:watch` / `route:unwatch` | `{ routeId }` |
| server → client | `route:invalidated` | `{ routeId, option, reason, edgeId, version, rerouted, at }` |

Namespace **`/admin`** (handshake `auth: { token }` with an ADMIN access token, otherwise `connect_error: FORBIDDEN`): `stats` (on connect, after each aggregation, throttled on session start/stop), `mobility:aggregated` (refetch the heatmap, hotspots and recommendations), `correction:updated`, `recommendation:updated`.

`room:status` fires when a reservation is created, changed or deleted, and when one starts or ends: a cron job runs every minute at :01 s ([src/jobs/roomStatusTicker.ts](src/jobs/roomStatusTicker.ts)). `edge:status` fires when an admin opens or closes a passage, which also invalidates the routing graph cache. Services publish domain events on an in-process bus ([src/lib/events.ts](src/lib/events.ts)), and the socket layer subscribes to it.

## Tests

`npm test` runs everything (about 90 s, 207 tests), with **no Docker needed**. Mobility tests ([tests/mobility.unit.test.ts](tests/mobility.unit.test.ts), [tests/mobility.api.test.ts](tests/mobility.api.test.ts)) cover pseudonymisation (stored rows, daily rotation, no user id), consent, geofence exit, 3 h and midnight auto-stop, the reminder, accuracy and jitter filters, k-anonymity (API and DB constraint), detectors, the full pipeline, correction approval with rerouting, retention, and the `/admin` socket.

- **Unit tests**: room status and freeAt ([tests/status.test.ts](tests/status.test.ts)), overlap rules ([tests/overlap.test.ts](tests/overlap.test.ts)), instructions and progress tracking ([tests/routing.instructions.test.ts](tests/routing.instructions.test.ts)), the routing graph, the seed model, middleware and OpenAPI.
- **Routing engine contract** ([tests/routing.engine.contract.test.ts](tests/routing.engine.contract.test.ts)): runs the *active* engine on the seed graph. It checks that step-free routes avoid every stair, that closed passages are never used, that a closed elevator forces a reroute, that slope and ramp rules hold, that "no route" returns null, and that custom costs are applied. It also checks that pre-filtering gives the same routes as native support. When the teammate's algorithm is plugged in, this suite runs on it; failures caused by the algorithm are reported to its owner, not patched in `core/`.
- **Integration tests** (Supertest + socket.io-client): auth, campus GeoJSON, room search and status, reservations (every overlap shape, roles, simultaneous requests, the DB constraint), route planning and recheck (profiles, explanations, PostGIS snapping, closed-elevator reroute, `route:invalidated`) and the `/live` events.

[tests/setup/global-db.ts](tests/setup/global-db.ts) starts **PGlite** (PostgreSQL compiled to WASM) with PostGIS and btree_gist, applies the real migration files, and serves it on `127.0.0.1:55439` over the Postgres protocol, so Prisma and raw SQL run unchanged. Each test file reseeds the campus, users and timetable. Files run one after another because they share one database.

## Error format

Every error is returned as `{ "error": { "code", "message", "details?" } }`. Validation errors use `VALIDATION_ERROR` and list every issue with its `location` (params, query or body). Unexpected errors return a generic 500 and are logged, never exposed to the client.

## Spatial model

- **Coordinates** are local campus metres (x → east, y → north, origin at the south-west corner, campus 220 × 150 m). They map 1:1 onto Leaflet `CRS.Simple` as `[y, x]`. PostGIS uses **SRID 0** (planar).
- **Points** (`rooms`, `pois`, `nav_nodes`, `track_points`, `difficulty_events`, `map_corrections`, `heatmap_cells`, `recommendations`) store `x`/`y` as plain columns, and `geom` is a `GENERATED ALWAYS … STORED` PostGIS point. Prisma writes numbers, and PostGIS keeps an indexed geometry in sync.
- **Lines and polygons** (edge lines, walls, room shapes, floor outlines, building footprints, campus geofence) are written with raw SQL (`ST_GeomFromText`).
- Every geometry column has a **GIST index**. CHECK constraints guard edge length, self-loops and reservation time order.
- The schema declares the GIST indexes (`@@index(..., type: Gist)`) and the generated columns (as `dbgenerated` defaults), so `prisma migrate diff` between the migrations and the schema is empty. Still create new migrations with `prisma migrate dev --create-only` and review them: Prisma cannot express the generated columns themselves, the CHECK constraints or the reservation `EXCLUDE` constraint.

## Navigation graph

`NavEdge` attributes are what routing filters on: `hasStairs`/`stepCount`, `isRamp`, `slopePercent`, `widthCm`, `doorClearanceCm`, `surface`, `isElevator`, `isOpen`/`closedReason`, `verified`. Shoreline data for audio guidance comes from `wallSide` (relative to the from → to direction, so it flips when the edge is walked backwards), `wallDistanceM` and `shorelineHint`. Nodes carry spoken `landmark`s.

## Seed data

`npm run db:seed` builds:

- **Bloc A** and **Bloc B**, 3 floors each, **44 rooms**, including Bibliothèque centrale (A, ground floor), Amphi 1 (B, ground floor), A-104, B-212, the offices of Dr. Benali and Mme. Haddad, and the Laboratoire de robotique.
- **35 POIs**: entrances, accessible side entrance, elevators, stairs, ramps, toilets and accessible toilets, cafeteria, infirmary, prayer room, accessible parking.
- **Navigation graph**: 133 nodes and 142 edges spanning floors (stairs and an elevator per block) and the outdoor paths.
- **Built-in accessibility problems**:
  - Bloc B main entrance has 3 steps; a step-free side entrance is next to the B elevator.
  - The library ramp is about 12 % and unverified.
  - The level-1 footbridge between the blocks is **closed**.
  - Door widths: A-102 is 75 cm and B-104 is 80 cm.
  - A gravel shortcut has a 9 % slope.
- **116 walls, railings and curbs** for shoreline guidance.
- **Today's timetable** (Africa/Algiers, sessions of 1 h 30). A few reservations are anchored on *now*, so the live demo always shows A-104 occupied by Dr. Benali (red), B-212 by the Robotics Club (orange) and A-103 free (green).
- **300 synthetic mobility sessions** (~34 k points, 120 simulated students, daily-rotating pseudonyms, Sunday–Thursday over the last 14 university days). Hotspots emerge from simulated behaviour: wheelchair users get stuck at the Bloc B steps and on the library ramp, then reroute; blind students struggle on the Bloc B stairs; some walkers hit the closed footbridge. The seed then runs the **real aggregation pipeline**. The result is 4 hotspots, with proposals for missing step-free access at Bloc B, the ramp slope and two shoreline cues on the Bloc B stairs. There are 4 recommendations: a ramp at Bloc B (score ≈ 79), the library ramp (≈ 38), and signage on the Bloc B stairs. Synthetic pseudonyms are SHA-256 test values, not HMACs.
