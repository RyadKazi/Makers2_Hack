# accesU

Accessible indoor navigation and communication platform for an Algerian university campus: live classroom status, accessibility-aware routing, audio guidance with shoreline hints, captions / text-to-speech, and privacy-preserving crowdsourced mobility data.

The full product spec and the 10-step build plan are in [PROJECT_SPEC.md](PROJECT_SPEC.md).

## Repository layout

| Path | What |
|---|---|
| [server/](server/) | Node 20 + Express 5 + TypeScript API, Prisma + PostGIS, Socket.io ([README](server/README.md)) |
| [client/](client/) | React 18 + Vite web app, a placeholder until step 2 ([README](client/README.md)) |
| [docker-compose.yml](docker-compose.yml) | PostgreSQL 16 + PostGIS, server, client |
| [PROJECT_SPEC.md](PROJECT_SPEC.md) | Specification, design tokens, rules, step log |

## Quick start (Docker)

```bash
cp .env.example .env                 # set POSTGRES_PASSWORD
cp server/.env.example server/.env   # set JWT_SECRET and SEED_PASSWORD
cp client/.env.example client/.env
docker compose up --build            # db + API (:4000) + client (:5173)
docker compose exec server npm run db:seed
```

- API health: http://localhost:4000/health
- API docs (Swagger): http://localhost:4000/docs, plus the raw OpenAPI document at http://localhost:4000/openapi.json
- Client: http://localhost:5173

## Quick start (without Docker)

If you don't have Docker or native PostgreSQL installed, you can use the built-in PGlite dev database with PostGIS:

```bash
# 1. Start the in-process PostgreSQL + PostGIS database (auto-migrated and seeded)
cd server
npm run dev:db

# 2. In a second terminal, start the API server
cd server
npm run dev

# 3. In a third terminal, start the web client
cd client
npm run dev
```

- Web Client: http://localhost:5174 (or http://localhost:5173)
- API health: http://localhost:4001/health
- API docs (Swagger): http://localhost:4001/docs
- Raw OpenAPI: http://localhost:4001/openapi.json

## Demo accounts

The seed creates these accounts, all using the `SEED_PASSWORD` from `server/.env`:

| Email | Role | Profile |
|---|---|---|
| admin@campusway.local | Admin | — |
| benali@campusway.local | Teacher (Dr. Benali) | — |
| haddad@campusway.local | Teacher (Mme. Haddad) | — |
| yacine@campusway.local | Student | Wheelchair: step-free, verified ramps, slope ≤ 6 %, width ≥ 85 cm |
| amina@campusway.local | Student | Blind / low vision: audio guidance, shoreline hints, high contrast, Arabic |
| karim@campusway.local | Student | Deaf / hard of hearing: captions |
| sara@campusway.local | Student | Speech disability: text-to-speech, Arabic |
| lina@campusway.local | Student | No specific needs, English |
| riad@campusway.local | Student | President of the Robotics Club |
