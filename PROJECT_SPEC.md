# accesU — Project Specification

> Hackathon build, 10 steps from zero to a working demo. **Re-read this file at the start of every step.**

## Product
An accessible indoor navigation and communication web platform (responsive: desktop, tablet, mobile) for an Algerian university. Goal: make students more independent, give them access to information and make it easier to move around campus.

Users: students (blind / low vision, deaf / hard of hearing, speech disability, wheelchair users, everyone else), teachers, administration.

## Features
1. **Interactive 2D campus and floor maps** with layers: classrooms, entrances, elevators, stairs, ramps, toilets, accessible toilets, facilities.
2. **Live classroom status**: Available (green) / Occupied by teacher or admin (red) / Occupied by club (orange). Color is never the only signal: always icon + label + pattern.
3. **Accessibility-aware routing**: the shortest route AMONG routes that satisfy the user's constraints (step-free, verified ramps, door/corridor width, slope, closed passages), with rerouting.
4. **Audio turn-by-turn navigation** for blind users with landmarks and "shoreline" hints (the nearest wall/edge to follow).
5. **Speech-to-text** live transcription and lecture captions (translation is a separate optional step); **text-to-speech** for students with speech disabilities.
6. **AI assistant**: Google Gemini Flash (understands requests, explains results via tool calls; never invents data). TTS: Cartesia Sonic-3.6. STT: Cartesia Ink-2.
7. **Crowdsourced mobility data**: students voluntarily turn location sharing on or off. While it is on, the app anonymously logs their paths inside campus plus difficulty events (blocked, too steep, hard to navigate, stuck, rerouted). This feeds a live accessibility heatmap for the administration (where students with disabilities walk most and where they get stuck), a manual map-correction queue, data-driven recommendations (where to build ramps, elevators, accessible entrances), and shoreline suggestions at hard spots.

   **Privacy by design**: opt-in only, collection only inside the campus geofence, auto-stop when leaving campus / after 3 hours / at midnight (with a reminder notification), daily-rotating pseudonymous IDs, no names, raw points deleted after 30 days, admins see aggregates only, k-anonymity (hide cells with fewer than 5 contributors). Compliant with Algerian Law 18-07.

## Stack
- **/server**: Node.js 20, TypeScript, Express, PostgreSQL 16 + PostGIS, Prisma (+ raw SQL for spatial queries), Socket.io, Zod, JWT, Vitest + Supertest.
- **/client**: React 18, Vite, TypeScript, Tailwind, React Router, TanStack Query, Zustand, react-i18next (AR/FR/EN + full RTL), Leaflet with CRS.Simple, leaflet.heat, Recharts, Socket.io client, Playwright.
- Docker Compose for db + server + client.

## Design tokens
| Token | Value |
|---|---|
| primary | #2547D0 |
| primary-800 | #1A2F8A |
| primary-50 | #EAEFFD |
| route | #0891B2 |
| route-100 | #CFFAFE |
| ink | #0F172A |
| slate | #475569 |
| border | #CBD5E1 |
| surface | #F8FAFC |
| white | #FFFFFF |

Status:
- **available** #15803D / #DCFCE7 — check icon, solid fill
- **teacher/admin** #B91C1C / #FEE2E2 — lock icon, diagonal stripes
- **club** #C2410C / #FFEDD5 — group icon, dots

Warning #B45309 / #FEF3C7.
Dark: bg #0B1120, card #151E32, text #F1F5F9, primary #7C9BFF, route #22D3EE.
High contrast: black/white + yellow #FFD60A focus/route.
Fonts: Atkinson Hyperlegible + IBM Plex Sans Arabic. WCAG 2.2 AA, 48px targets, body ≥16px, visible 3px focus rings.

## Rules
- Strict TypeScript, modular folders, no secrets in code (.env + .env.example), a README per project.
- Realistic Algerian seed data (Bloc A, Bloc B, Bibliothèque centrale, Amphi 1, rooms A-104/B-212, Dr. Benali, Mme. Haddad, Robotics Club).
- At the end of every step: summarize what was built, how to run it, and any open issues.

## Step log
- **Step 1** — Repo structure, server skeleton (Express + TS, modules, middleware, /health), Prisma schema + PostGIS migration, seed (2 buildings × 3 floors, ~40 rooms, POIs, multi-floor nav graph, walls, reservations, 300 synthetic mobility sessions).
- **Step 2** — Server API:
  - **Auth**: JWT access token (15 min, Bearer), rotating httpOnly refresh cookie, `tokenVersion` revocation, role guard. `/me` and `/me/accessibility-profile`.
  - **Campus**: buildings, floors, PostGIS GeoJSON layers.
  - **Rooms**: search with live status (status, label, occupantName, until, freeAt), plus room details (today's schedule, accessibility, nearest elevator and accessible toilet by step-free distance).
  - **Reservations**: CRUD for teachers and admins, with half-open overlap rules, a 409 that lists the conflicts, room lock + DB `EXCLUDE` constraint.
  - **Admin**: open or close a passage.
  - **Socket.io** `/live`: `room:status` (from writes plus a per-minute cron) and `edge:status`.
  - **Docs**: Swagger at `/docs` and `/openapi.json`, both generated from the Zod route specs.
  - **Tests**: 122 Vitest tests, including integration tests against an in-process PGlite + PostGIS.
  - **Conventions**: every endpoint goes through `defineRouter().route(spec, handler)`, and DTOs are parsed on output.
- **Step 3** — Routing API built around a `RoutingEngine` interface (adapter pattern):
  - **Ownership**: the teammate's algorithm goes in `server/src/modules/routing/core/` (**not delivered yet**). Until then a stand-in wraps the step-1 Dijkstra, and swapping engines is a one-line change in `engine/index.ts`.
  - **Graph adapter**: in-memory graph loaded at startup and refreshed on edge or graph changes.
  - **Constraints layer**: profile + request overrides; anything the engine doesn't support natively is filtered out of the edges beforehand.
  - **Cost hook**: surface, unverified ramps, and crowd (0 until step 4).
  - **Endpoints**: `POST /api/routes/plan` returns fastest and step-free options (distance, ETA by travel mode, counts, GeoJSON per floor, AR/FR/EN steps with landmarks and shoreline hints) and explains which constraint blocks a missing route. `POST /api/routes/:id/recheck` handles deviation, wrong floor, closed passages, rerouting and the `route:invalidated` socket event.
  - **Tests**: an engine contract suite on the seed graph; 162 tests in total.
- **Step 4** — Crowdsourced mobility with privacy by design:
  - **Consent**: policy version stored; opt-out offers deletion; no consent means ingestion is rejected.
  - **Sessions**: HMAC daily pseudonyms with a random daily salt (kept 30 days, so deletion works, then purged); coarse needs category only; no user id stored; auto-stop on geofence exit, after 3 h or at midnight, with a reminder in the status endpoint.
  - **Ingestion**: batches of 100 points; accuracy ≤ 10 m; PostGIS geofence; jitter speed gate plus smoothing.
  - **Detectors**: STUCK (dwell, not in rooms or at POIs), REROUTED (U-turn at an obstacle), repeated U-turns.
  - **Aggregation every 5 min**: 2 m heatmap (TODAY / 7D / 30D × category), k ≥ 5 enforced by a DB CHECK and at read time; PostGIS DBSCAN hotspots with nearest edge and wall (shoreline); PENDING correction proposals; recommendations scored on passes × stuck rate × step-free detour (via the routing adapter), with AR/FR/EN rationales.
  - **Admin**: API and `/admin` socket; approving a correction updates the NavEdge and sends `route:invalidated`.
  - **Retention**: hourly purge after 30 days.
  - **Tests**: 201 in total.
- **Step 5** — Client foundation:
  - **Design reference**: `client/DESIGN_REFERENCE.md` covers 6 reference images (look and feel only), the visual language, component anatomy and the resolved conflicts.
  - **Tokens and themes**: tokens as CSS variables with light / dark / high-contrast themes; the spec route colour is kept for lines, and `route-text` `#0E7490` is added for text (contrast).
  - **Text, motion, languages**: text scale up to 200 % (layout tiers follow the effective width); reduced motion; AR/FR/EN with full RTL.
  - **Shell**: sidebar or rail + drawer or bottom tabs; Ctrl K palette; right panel shown as a side panel, drawer or bottom sheet.
  - **Components**: an accessible library of 17+ components.
  - **API layer**: axios with JWT refresh, TanStack Query, generated OpenAPI types, Socket.io provider.
  - **Pages**: Landing, Login, Onboarding / Profile, Settings, Design system.
  - **Tests**: 105 client tests (axe, contrast, keyboard, RTL); ESLint jsx-a11y strict.
- **Step 6** — Map and rooms:
  - **Map**: Leaflet CRS.Simple floor and campus plans, with status as fill + pattern + icon labels, live `room:status` patching in place with a flash, a layers popover or sheet, a legend, and a List view equivalent. Every map item is a keyboard button with spatial arrow navigation.
  - **Find a room**: filters in the URL, sortable table or cards, a Free at / until column, pagination.
  - **Room detail**: timeline, accessibility, nearest step-free facilities, nearby rooms, directions, save.
  - **Search**: Ctrl K fuzzy search in AR/FR/EN over rooms, buildings, POIs and clubs (`GET /api/campus/search-index`); localised floor names.
  - **Tests**: 140 client and 202 server tests.
- **Step 7** — Navigation:
  - **Planner**: From (my location / QR checkpoint / pick on the plan / search) and To; route needs pre-filled from the profile; Fastest vs Step-free cards; a no-route explanation with relax buttons.
  - **Position**: providers (QR, manual, demo simulator, satellite placeholder for future BLE / Wi-Fi) with accuracy shown.
  - **Visual guidance**: route line, automatic floor switching, instruction bar, step list, progress, "Report a problem here" (DifficultyEvent).
  - **Audio guidance**: high-contrast screen; Repeat / Where am I / Pause (Space, W, P); server voice (`/api/speech/tts`, Cartesia Sonic-3.6) with a `speechSynthesis` fallback; pre-announcements, shoreline hints, vibration, live-region mirroring.
  - **Live rerouting**: recheck on movement and `route:invalidated` → spoken alert → accept; arrival screen.
  - **Mobility tags**: points and reports carry `routeId` (migration 0004); the route store no longer keeps a user id.
  - **Tests**: 162 client and 207 server tests.
