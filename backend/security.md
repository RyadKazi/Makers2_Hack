CampusWay — Phase 1 Read-Only Audit Report
Status: Phase 1 complete. No files were created, modified, deleted, formatted, or migrated. No packages installed. No destructive commands run. The teammate-owned server/src/modules/routing/core/ was not touched.
Evidence labels used below
- VERIFIED — reproduced by tracing the exact code path, or logically forced by the code/schema.
- SUSPECTED — plausible, but needs a runtime check, dataset, or product decision to confirm.
Important working-tree note: git status shows two pre-existing deletions, not made by me:
D client/.env.example
D server/.env.example
Both files are still in HEAD. I left them exactly as found. Please confirm whether that is intentional.
1. Scope, sources, and method
Reviewed:
- PROJECT_SPEC.md and client/DESIGN_REFERENCE.md
- All server routers, schemas, services, mappers, middleware, config, sockets, jobs, Prisma schema/migrations/seed, and tests
- Client routing, auth/session handling, sharing/consent UI, map/SVG rendering, navigation, and admin page
Not done in Phase 1:
- No test suite execution, server boot, database query, or exploit attempt.
- No line-by-line review of the teammate’s algorithm inside routing/core/ (only its boundary/README).
- No secret values were printed; .env was only observed to exist and to be git-ignored.
Stack (VERIFIED): Express 5.3.0, Prisma 6.19.3 + PostgreSQL/PostGIS, Zod 4.6.7, JWT HS256, Socket.io 4.8.4, node-cron, React 18 + Vite + TanStack Query 5 + Zustand 5 + React Router 6, Vitest.
2. Runtime architecture
Browser SPA (React/Vite)
  │  JSON + Bearer access token
  │  httpOnly refresh cookie cw_rt (Path=/api/auth)
  ▼
Express app (src/app.ts:47)
  helmet → cors(allowlist) → express.json(1 MB) → cookieParser → pino-http
  ├─ GET /health, /openapi.json, /docs
  └─ /api  → apiRateLimit (300/min default)
       ├─ /auth   /me
       ├─ /campus /rooms /reservations /routes
       ├─ /mobility /speech
       ├─ /ai     (empty router)
       └─ /admin
            │
            ▼
     defineRouter().route(spec, handler)  (src/http/route.ts:69)
       authenticate → requireRole → validate → handler → response DTO parse
            │
            ▼
     service layer → Prisma → PostgreSQL + PostGIS
            │
            ├─ Socket.io /live  (public)
            ├─ Socket.io /admin (ADMIN JWT)
            ├─ node-cron: room ticker, mobility minute/5-min/hour jobs
            └─ in-memory: campus graph, routeStore, salt cache, rate-limit counters
Strengths (VERIFIED):
- One declarative route spec drives auth, role guard, Zod validation, response DTO validation, and OpenAPI (route.ts:69-106; app.ts:84-89).
- Response DTOs are parsed before sending, so accidental field leakage usually becomes a 500 rather than a silent leak (route.ts:100-105). This is a genuinely good control.
- Reservation writes lock the room row and rely on a DB exclusion constraint as backstop (reservations.service.ts:47-77; migrations/0002_auth_reservations/migration.sql:14).
- Privacy design is deliberate: no user id on mobility rows, daily HMAC pseudonyms, recomputable ownership, k-anonymity checks (pseudonym.ts:1-18; sessions.service.ts:50-56; migration 0003).
- Secrets are separated and validated (env.ts:19-25,58-60); refresh cookie is httpOnly, SameSite=Strict, Secure in production, scoped to /api/auth (auth.service.ts:55-61).
Architectural constraints (VERIFIED, not necessarily bugs):
- routeStore is process-local (routeStore.ts:32-39); rate limits are process-local; salt cache is process-local. Horizontal scaling would break recheck/invalidation consistency and rate limiting unless sticky sessions or shared storage are added.
- /api/ai is mounted but empty (ai.router.ts:1-7). This is dead surface, not a spec gap: the spec does not require an AI feature.
3. Data model
Entities (VERIFIED, prisma/schema.prisma):
Group	Models	Notes
People/auth	User, AccessibilityProfile, MobilityConsent, PseudonymSalt	passwordHash, tokenVersion, role, locale; consent policy version + revoke timestamp
Campus	Campus, Building, Floor, Room, Poi, NavNode, NavEdge, Wall	PostGIS generated geom columns; SRID 0 planar metres
Reservations	Reservation	half-open [startsAt, endsAt), kind, organizer, userId
Mobility	TrackingSession, TrackPoint, DifficultyEvent, HeatmapCell, Hotspot	daily pseudoId; no userId; free-text report note; routeId tag
Admin/analytics	MapCorrection, Recommendation	correction review queue, investment scoring
Sensitive fields:
- User.passwordHash, User.email, User.tokenVersion
- MobilityConsent rows and PseudonymSalt
- TrackingSession.pseudoId, TrackPoint coordinates, DifficultyEvent.note
- Reservation.ownerId (a user cuid) and organizer (often a real name)
Database invariants (VERIFIED):
- reservations_no_overlap exclusion constraint (migrations/0002/...:14)
- heatmap_cells_k_anonymity CHECK contributorCount >= 5 (migrations/0003/...:41)
- hotspots_k_anonymity CHECK contributorCount >= 5 (migrations/0003/...:64)
- positive edge length, no self-loop, reservation time order (migrations/0001/...:502-504)
Deletion caveat (VERIFIED code, impact SUSPECTED): DifficultyEvent.sessionId is nullable with onDelete: SetNull (schema.prisma:474-497). deleteMobilityData deletes events by session id, then deletes sessions (consent.service.ts:65-75). Any event that was already orphaned (sessionId = null) before deletion cannot be found by that query and survives. This is likely rare, but it is a real gap between “delete everything linkable to you” and the implementation.
4. HTTP API surface
46 API endpoints, plus 3 system/documentation endpoints. Auth legend: P public, O optional token, U authenticated user, R role-gated.
Module	Endpoint	Auth	Notes
System	GET /health	P	DB liveness
System	GET /openapi.json, /docs	P	Swagger exposed
Auth	POST /api/auth/register	P	always creates STUDENT
Auth	POST /api/auth/login	P	rate-limited 20/15 min
Auth	POST /api/auth/refresh	cookie	sets new refresh cookie
Auth	POST /api/auth/logout	P	clears cookie only
Auth	POST /api/auth/logout-all	U	bumps tokenVersion
Me	GET/PUT /api/me	U	profile display name/locale
Me	GET/PUT /api/me/accessibility-profile	U	owner-only
Campus	GET /api/campus, /buildings, /buildings/:id/floors, /floors/:id, /floors/:id/layers, /search-index	P	public map data
Rooms	GET /api/rooms, /api/rooms/:id	P	live status, schedule, nearest step-free facilities
Reservations	GET /api/reservations	U	any signed-in user; mine optional
Reservations	GET /api/reservations/:id	U	any signed-in user
Reservations	POST /api/reservations	R TEACHER/ADMIN/CLUB	overlap rules
Reservations	PATCH/DELETE /api/reservations/:id	R TEACHER/ADMIN/CLUB	ownership enforced in service
Routes	POST /api/routes/plan	O	public planning, profile applied if signed in
Routes	POST /api/routes/:id/recheck	P	unguessable UUID
Mobility	GET/POST/DELETE /api/mobility/consent	U	opt-in / opt-out
Mobility	DELETE /api/mobility/data	U	deletion
Mobility	POST /api/mobility/sessions	U	requires consent
Mobility	GET /api/mobility/sessions/current	U	status
Mobility	POST /api/mobility/sessions/:id/stop	U	ownership recomputed
Mobility	POST /api/mobility/points, /events	U	consent-gated ingestion
Speech	GET /api/speech/status	O	provider availability
Speech	POST /api/speech/tts	U	60/min, Cartesia
AI	—	—	empty router
Admin	PATCH /api/admin/edges/:id/status	R ADMIN	open/close passage
Admin	GET /api/admin/heatmap, /hotspots	R ADMIN	k-anonymous aggregates
Admin	GET /api/admin/corrections; `POST .../:id/approve	reject`	R ADMIN
Admin	GET /api/admin/recommendations; PATCH .../:id	R ADMIN	investment plan
Admin	GET /api/admin/stats	R ADMIN	dashboard counts
Admin	GET /api/admin/floors/svgs, /floors/:id/svg	O	public floor plans
Admin	PUT /api/admin/floors/:id/svg	R ADMIN	upload SVG
Routing-core boundary: /api/routes/plan calls planRoute in routing.service.ts; the engine adapter is behind engine/index.ts. The teammate’s core/ is not referenced by name in the router. I did not modify or judge the algorithm itself.
5. Realtime layer
/live — public read-only (VERIFIED, sockets/live.ts):
- Client events: floor:join, floor:leave, route:watch, route:unwatch.
- Server events: room:status, edge:status, route:invalidated.
- Rooms are floor:<floorId>:<lang>; language from handshake auth.lang or ?lang=.
- One socket may join at most 12 floors (live.ts:30).
- floor:join performs a DB existence check and returns current statuses.
- No authentication and no per-socket rate limit. route:watch accepts any UUID, but route IDs are random UUIDs and the route store keeps no user id (routeStore.ts:1-7).
/admin — ADMIN only (VERIFIED, sockets/admin.ts:23-29):
- Handshake token verified with verifyAccessToken; role must be ADMIN.
- Pushes stats on connect, mobility:aggregated, correction:updated, recommendation:updated.
- Stats pushes are throttled to 10 s.
Broadcast triggers (VERIFIED):
- Reservation create/update/delete → rooms.changed → room:status (reservations.service.ts:142,176,186; live.ts:127-137).
- Admin edge status → edge.changed → edge:status (admin.router.ts:67; live.ts:139-150).
- Route recheck/edge closure → route:invalidated to route:<id> (live.ts:152-155).
6. Background jobs
Schedule	Job	Source
Every minute at :01	Detect reservation start/end transitions, emit rooms.changed	jobs/roomStatusTicker.ts:21-40
Every minute at :05	Auto-stop sessions (3 h / midnight), then run detectors (STUCK, U-turns)	jobs/mobilityJobs.ts:24-32
Every 5 minutes at :20	Heatmap, hotspots, correction proposals, recommendations	mobilityJobs.ts:33
Hourly at :40	Retention purge of raw data and salts older than 30 days	mobilityJobs.ts:34
5 s after boot	Retention + first aggregation	mobilityJobs.ts:36-40
All jobs are wrapped so a failure logs and does not crash the process (mobilityJobs.ts:14-20). Jobs are noOverlap: true.
7. Configuration, secrets, deployment
Required/validated (VERIFIED, env.ts:14-41):
- DATABASE_URL
- JWT_SECRET ≥ 32 chars
- JWT_REFRESH_SECRET ≥ 32 chars
- PSEUDONYM_SECRET ≥ 32 chars
- All three secrets must be distinct (env.ts:58-60)
- Defaults: access 15 min, refresh 7 days, bcrypt rounds 11, rate limit 300/min, policy 2026-11-v1, retention 30 days
Deployment observations:
- server/.env exists locally and is git-ignored (server/.gitignore:3). No .env is tracked. VERIFIED.
- server/.env.example and client/.env.example are tracked in HEAD but currently deleted in the working tree. docker-compose.yml:2 instructs users to copy server/.env.example, so a fresh checkout of the current working tree would lack that file. VERIFIED. This appears to be an uncommitted local change; please confirm intent.
- trust proxy is set to 1 (app.ts:51). If the API is ever exposed directly without a trusted proxy, X-Forwarded-For handling and rate-limit keying need review. SUSPECTED deployment risk, not confirmed locally.
- Helmet is enabled. The client’s index.html contains no CSP meta tag and no client nginx CSP was found in the files inspected. Helmet’s CSP applies to API responses, not to the separately served SPA. VERIFIED absence; impact on XSS below is SUSPECTED.
Rate limits (VERIFIED):
- Global API: 300/min (middleware/rateLimit.ts:5-12)
- Login/register: 20 per 15 min (auth.router.ts:11-22)
- TTS: 60/min (speech.router.ts:31-41)
- All skipped when NODE_ENV=test.
8. Spec vs reality
The spec’s step log ends at Step 7 (PROJECT_SPEC.md:98-105). There is no AI assistant requirement in the spec; the empty /api/ai router is simply unused surface. VERIFIED.
Spec area	Reality	Status
Auth: JWT access, rotating refresh cookie, tokenVersion, role guard	Implemented, but refresh “rotation” does not invalidate the old token, and CLUB is rejected by the verifier	Implemented with gaps
Campus/rooms/reservations	Implemented, including conflict details, room lock, DB exclusion constraint	Matches
Routing: plan, fastest/step-free, constraints, recheck, invalidation	Implemented; core adapter boundary present	Matches (algorithm ownership external)
Mobility: consent, pseudonyms, geofence, auto-stop, detectors, aggregation, k-anonymity, retention	Substantially implemented	Matches, with deletion-edge caveat
Admin: corrections, recommendations, live dashboard, floor SVG	Implemented	Matches
Client: map, rooms, navigation, audio, sharing	Implemented; TalkPage exists, MorePage/NotFound are the only “placeholder” pages	Matches
Consent withdrawal/deletion UI	Server supports DELETE /api/mobility/consent?deleteData=true and DELETE /api/mobility/data; client exposes only “stop sharing”	Gap
Role administration	Auth comment says teacher/admin roles are “granted by an administrator” (auth.service.ts:89), but no endpoint manages users/roles; seed creates them directly	Gap
Admin floor plans	Read endpoints are public (auth: 'optional'), mounted under /admin	Design mismatch to confirm
Client route map (VERIFIED, client/src/App.tsx:25-45): /, /login, /onboarding, /map, /rooms, /navigate, /talk, /admin, /more, /settings, /profile, /design-system, fallback 404. There is no separate analytics page, but the spec does not require one.
9. Test coverage and open questions
Server (VERIFIED file inventory): 16 Vitest files, ~187 explicit it(/test( blocks by grep. README claims 207 executed tests (server/README.md:219); parameterized cases and it.each can explain the difference, but I did not run the suite. SUSPECTED minor documentation drift.
Files cover: app/OpenAPI, auth, campus, graph, live sockets, mobility API/unit, overlap, reservations, rooms, routing API, routing engine contract, routing instructions, seed model, speech, room status.
Client (VERIFIED file inventory): 7 test files, ~63 explicit blocks, plus Playwright dependency. README/spec claim 162 client tests; parameterized cases likely expand this. Not run.
Coverage strengths: integration tests use in-process PGlite + PostGIS; socket and privacy paths are tested; reservation concurrency and k-anonymity have dedicated tests.
Coverage gaps visible from code (SUSPECTED until run):
- No test that replays an old refresh cookie after a successful refresh (the existing test only proves logout-all revokes it — tests/auth.api.test.ts:92-108).
- No test that a seeded CLUB user can call an authenticated endpoint (seed has riad with role CLUB — prisma/seed/people.ts:50).
- No test for SVG upload sanitization/XSS payloads.
- No test that reservation list/get are scoped by role/ownership.
- No test for orphan DifficultyEvent rows after session deletion.
Preliminary observation register — Phase 2 candidates (not the full audit)
No Critical issue was confirmed in Phase 1. The following are ordered by likely impact. Severity is preliminary and may change after runtime confirmation.
ID	Severity	Status	Location	Summary
P1	High (functional)	VERIFIED	auth/tokens.ts:46-53	ROLES omits CLUB, so a seeded CLUB user’s access token is rejected with 401 on every authenticated request. The reservation router explicitly allows CLUB, making the role unreachable.
P2	High (conditional)	VERIFIED sink / SUSPECTED exploit	admin.service.ts:604-610; client dangerouslySetInnerHTML at IsometricCampusMap.tsx:673,1257, MapPage.tsx:534, AdminPage.tsx:942	SVG upload only checks for <svg/</svg>; client injects raw SVG. A malicious/compromised admin can store script-bearing SVG that runs in every student’s browser. No client CSP was found.
P3	Medium	VERIFIED	reservations.router.ts:18-41; reservations.service.ts:88-113; reservations.mapper.ts:17	Any signed-in student can list all reservations and read ownerId; GET /:id has no ownership check. Public GET /api/rooms/:id also exposes today’s schedule with ownerId (rooms.service.ts:161-163).
P4	Medium	VERIFIED	auth.service.ts:68-112; tokens.ts:36-43	Refresh tokens are re-signed but not truly rotated: there is no jti/store, so the old cookie remains valid until expiry. Within the same second the “new” JWT can even be byte-identical. README claims rotation (README.md:72).
P5	Medium	VERIFIED code / SUSPECTED exploit	auth.service.ts:16,97-101	DUMMY_HASH uses bcrypt rounds 4 while real hashes use BCRYPT_ROUNDS (default 11), so unknown-email logins are much faster. Remote timing-based account enumeration needs measurement to confirm.
P6	Medium	VERIFIED behavior / SUSPECTED compliance	ReportProblem.tsx:47-49	“Share and send” auto-POSTs consent when missing/outdated, bundling opt-in with the report action. Policy text is shown, but there is no separate explicit accept step.
P7	Medium	VERIFIED	SharingControl.tsx (whole file); server mobility.router.ts:50-72	No client UI for consent withdrawal or data deletion, despite server support and spec privacy promises.
P8	Medium (data integrity)	SUSPECTED	routing/constraints.ts:75-78	Step-free enforcement checks edge.hasStairs only, not stepCount > 0. A mis-tagged edge with steps but hasStairs=false would pass. Needs seed/editor data confirmation.
P9	Low	VERIFIED	admin.router.ts:147-169	Floor-plan list/get are auth: 'optional' under /admin, exposing plans and custom-upload status without login. May be intentional for the public map.
P10	Low	VERIFIED	sockets/live.ts:76-125	/live has no auth or per-socket rate limiting; floor:join triggers DB queries, so a client can spam joins. Capped at 12 floors per socket.
P11	Low	VERIFIED	consent.service.ts:65-75; schema DifficultyEvent.sessionId SetNull	Deletion cannot find already-orphaned difficulty events.
P12	Low / policy	SUSPECTED	admin.service.ts:205-256	Exact session counts (active, today, last7d) are shown while contributor counts are suppressed. Decide whether session counts need the same k-threshold.
P13	Info	VERIFIED	routing/routing.router.ts:25-38; routeStore.ts	/recheck is unauthenticated and route IDs are UUIDs. This matches the documented unguessable-ID design, but ownership is not enforced.
P14	Info / product	VERIFIED	routing/constraints.ts:50-70	Request overrides may relax a user’s profile (e.g. avoidStairs:false). Documented as intentional; confirm the UI never does this silently for accessibility profiles.
P15	Info	VERIFIED	git status; docker-compose.yml:2	server/.env.example and client/.env.example are deleted in the working tree but still tracked in HEAD.
P16	Info	SUSPECTED	heatmap.ts:37-54	Difficulty counts reuse point-contributor-gated cells; there is no separate event-contributor gate. A cell still has ≥5 point contributors, but event-only locations never appear. Confirm the intended k-unit.
Questions before Phase 2
1. Are the two deleted .env.example files intentional, or should they be restored (by you, not me) before further work?
2. Should CLUB access tokens be fully valid (P1)? I read the intent as yes, since reservations allow CLUB.
3. Is the public /admin/floors/* read access intentional for the map, or should it move out of /admin and/or require auth?
4. For reservations (P3): should ownerId ever be public, or is organizer enough? Should GET /:id be owner/admin-scoped?
5. Is “Share and send” considered valid explicit consent for a one-off report (P6), or should it require a separate acceptance action?
6. Is k-anonymity defined per heatmap cell only, or should session counts and difficulty-event counts have independent thresholds (P12/P16)?
7. Should /routes/:id/recheck remain anonymous by design (P13), or require the same session/owner that planned it?
8. For Phase 2 prioritization: security first (P1–P5), privacy/compliance first (P6/P7/P12), or functional correctness first?
Stopping here for your review. No fixes will be made until you approve a specific item. When approved, I will implement the smallest safe change, add a focused test, and report the diff for review.
Build · DeepSeek V4.1 Flash Free · 6m 40s · 91.4 tok/s
we will work on the first seven vulnrabilities , but first explain to me the P1 
+Thought · 9.1s
→Explored: 1 read, 1 search
+Thought · 21.3s
P1 — CLUB access tokens are rejected by the verifier
One-sentence version
The database and the reservation API both support four roles (STUDENT, TEACHER, ADMIN, CLUB), but the JWT verifier only accepts three, so a logged-in CLUB user gets a valid-looking access token that every authenticated endpoint rejects with 401 INVALID_TOKEN. It is a role-allowlist drift bug, not a privilege-escalation vulnerability: it fails closed. I would call it a high-impact functional/authorization bug rather than an exploitable security hole.
Where the mismatch is
The schema defines four roles — server/prisma/schema.prisma:25-30:
enum Role {
  STUDENT
  TEACHER
  ADMIN
  CLUB
}
The token verifier only allows three — server/src/modules/auth/tokens.ts:46-57:
const ROLES: readonly Role[] = ['STUDENT', 'TEACHER', 'ADMIN'];

export function verifyAccessToken(token: string): AccessPayload | null {
  try {
    const decoded = jwt.verify(...);
    if (typeof decoded !== 'object' || decoded.typ !== 'access' || typeof decoded.sub !== 'string') return null;
    if (!ROLES.includes(decoded.role as Role)) return null;   // ← CLUB dies here
    return { userId: decoded.sub, role: decoded.role as Role };
  } catch {
    return null;
  }
}
The seed actually creates a CLUB user — server/prisma/seed/people.ts:50:
{ key: 'riad', email: `riad@${DOMAIN}`, displayName: 'Riad S. (président, Robotics Club)', role: 'CLUB', ... }
And the reservations router explicitly grants CLUB permission to create/change/cancel — server/src/modules/reservations/reservations.router.ts:50,66,81. That permission is effectively unreachable.
Exact failure path
1. Login succeeds. login() loads the user and calls startSession() (auth.service.ts:97-102). startSession() signs an access token with role: user.role (auth.service.ts:70-73). signAccessToken does not validate the role — it just puts CLUB into the JWT (tokens.ts:26-34). So POST /api/auth/login returns 200 with a token and a user.role: "CLUB" body.
2. First authenticated request fails. authenticate(true) reads the Bearer token and calls verifyAccessToken (middleware/auth.ts:15-27). Verification succeeds cryptographically, but ROLES.includes('CLUB') is false, so it returns null. The middleware throws 401 INVALID_TOKEN.
3. Refresh does not help. The refresh verifier does not check roles at all (tokens.ts:60-69); it checks signature, type, subject, and tokenVersion. So /api/auth/refresh succeeds and issues another CLUB access token. The client retries once and gets 401 again.
4. Client behaviour. In client/src/api/client.ts:42-51, a 401 INVALID_TOKEN triggers one refresh and one replay (_retried prevents a loop). For a CLUB user, that replay fails too. The result is: login appears to work, then /api/me, sharing, reservations, and every other authenticated feature fail. Public map/rooms still work because those routes are unauthenticated.
What still works: public campus/rooms/routes, login, refresh, logout.  
What breaks: /api/me, accessibility profile, consent/session/ingestion, reservations, /admin socket (a CLUB user is not an admin anyway), and any future authenticated feature.
Why the existing tests miss it
- No test logs in as the seeded CLUB user and calls an authenticated endpoint.
- readonly Role[] is a subset type. TypeScript happily accepts three of four enum members, so this drift is not a compile error.
- The only role checks in tests are reservation/status tests that use CLUB as reservation data, not as an authenticated principal.
How to confirm (read-only)
Against a running local server, using the seeded club account without printing the password:
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"riad@campusway.local\",\"password\":\"$SEED_PASSWORD\"}" \
  | jq -r .accessToken)

curl -i http://localhost:4000/api/me -H "Authorization: Bearer $TOKEN"
Expected today: 401 with "code":"INVALID_TOKEN".  
After a correct fix: 200 with the user object and "role":"CLUB".
A unit-level confirmation is even simpler:
const token = signAccessToken({ userId: 'u1', role: 'CLUB' });
expect(verifyAccessToken(token)).toEqual({ userId: 'u1', role: 'CLUB' }); // currently null
Why it matters
- Availability / correctness: a legitimate, seeded role is locked out of the product. The club president can browse but cannot reserve a room, which is one of the spec’s core flows.
- Workaround risk: users who cannot use their own account may share a teacher account or ask an admin to change their role. Both weaken accountability and auditability — security-adjacent, even though this bug itself grants nothing.
- It hides a second problem: because CLUB never reaches requireRole, the reservation authorization path for clubs has never been exercised end-to-end with a real club token. Fixing P1 should include a test that a CLUB user can create a CLUB reservation but cannot create an ADMIN one.
Fix shape (not applied yet)
Smallest safe fix: add 'CLUB' to the allowlist.
const ROLES: readonly Role[] = ['STUDENT', 'TEACHER', 'ADMIN', 'CLUB'];
Better fix for a hackathon codebase that will keep evolving: make the allowlist exhaustively checked at compile time, so adding a Prisma role without updating the verifier becomes a type error:
const ROLE_FLAGS = {
  STUDENT: true,
  TEACHER: true,
  ADMIN: true,
  CLUB: true,
} satisfies Record<Role, true>;

const ROLES = Object.keys(ROLE_FLAGS) as Role[];
This keeps the runtime check and prevents the same drift next time. No migration, no schema change, no client change.
Tests I would add with the fix:
1. Unit: verifyAccessToken(signAccessToken({ role: 'CLUB' })) returns the payload; an unknown role still returns null.
2. API: log in as the seeded CLUB user, GET /api/me → 200, and POST /api/reservations with kind: 'CLUB' → 201.
3. Negative: the same CLUB token cannot create an ADMIN reservation (403).
Note on scope: this fix does not change how role changes propagate. The access token carries the role until it expires (15 min), so a demoted user keeps the old role for up to 15 minutes. That is a separate design question, not part of P1.
Ready to implement P1 when you approve; I’ll keep it to tokens.ts plus the focused tests unless you prefer the exhaustive-map version.