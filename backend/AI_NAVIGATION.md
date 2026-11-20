# Express and FastAPI navigation integration

This guide documents the Python Dijkstra gateway exposed to the UI by the
Express backend.

## Request flow

```text
UI
 │ POST /api/ai/route
 ▼
Express: validates input, applies the route rate limit,
         adds its private FastAPI API key, adapts the response
 │ POST /api/v1/navigation/route
 ▼
FastAPI: checks navigation:route permission, loads the graph,
         applies accessibility rules, runs Dijkstra
 │
 ▼
Python service PostgreSQL graph
```

The existing `POST /api/routes/plan` is a separate Node routing API. Use
`/api/ai/route` when the route must be calculated by the Python service. The
Python service's legacy `/navigation/route` endpoint is not used by this
gateway.

## Code map

| Area | Responsibility |
|---|---|
| [Express AI router](./src/modules/ai/ai.router.ts) | Publishes `/api/ai/health` and `/api/ai/route`; route requests are public and have a dedicated rate limit. |
| [Express AI service](./src/modules/ai/ai.service.ts) | Adds the private key, calls FastAPI v1, handles timeouts/upstream errors, and adapts the response to the client contract. |
| [Express AI schemas](./src/modules/ai/ai.schemas.ts) | Validates browser input and both upstream and client response shapes. |
| [FastAPI app](../ai-service/main.py) | Initializes graph, database, API-key rate limiter, exception handlers, and routers. |
| [Navigation models](../ai-service/models/) | Validates buildings, floors, nodes, connections, and accessibility metadata. |
| [Navigation package](../ai-service/navigation/) | Builds a graph from explicit edges, filters edges by profile/constraints, runs Dijkstra, and assembles route details. |
| [Versioned API router](../ai-service/routers/api_v1.py) | Authenticated server-to-server endpoints. Express calls its route endpoint. |
| [Legacy navigation router](../ai-service/routers/navigation.py) | Public building/node/route endpoints; the network guard keeps these routes local by default. |
| [PostgreSQL adapter](../ai-service/data/postgres.py) | Loads versioned graph data and validates API keys; also persists minimized session analytics. |
| [Analytics modules](../ai-service/analytics/) | Consent-gated session contribution validation and aggregate accessibility analysis. These endpoints are not currently exposed through Express. |

The Python service's route calculation is separate from its analytics. It
searches only declared graph connections: it does not infer edges from map
coordinates. Wheelchair constraints filter blocked, inaccessible, or stair
connections before Dijkstra searches the graph. The route response then includes
ordered node IDs, traversed edge metadata, coordinates, and floor transitions.

## Prerequisites and configuration

The Python service needs PostgreSQL for API-key authentication. The route graph
must either be present in the Python service's PostgreSQL tables or loaded into
its JSON registry. The Express campus graph is not synchronized to the Python
service automatically; there is no public graph-edit endpoint.

1. Apply the AI-service schema and create a route-only API key from the
   `ai-service` directory:

   ```bash
   export DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE"
   psql "$DATABASE_URL" -f migrations/001_initial.sql
   python scripts/api_keys.py create campusway-express --permissions navigation:route
   ```

   The command prints the key once. Store it as a server-side secret; never put
   it in browser code or commit it.

2. Set these variables in the Express backend's environment:

   ```dotenv
   ACCESU_NAVIGATION_URL=http://127.0.0.1:8000
   ACCESU_NAVIGATION_API_KEY=accu_<prefix>.<secret>
   ```

   `ACCESU_NAVIGATION_URL` defaults to `http://127.0.0.1:8000`. In a
   multi-container deployment, use the Python service's private network
   address instead of loopback.

3. Start FastAPI from `ai-service` with the same `DATABASE_URL`:

   ```bash
   export DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE"
   python -m uvicorn main:app --host 127.0.0.1 --port 8000
   ```

   In a container, bind to the container interface and restrict access through
   the deployment network. For a local-only smoke test, set
   `ACCESU_BUILDINGS_FILE=examples/demo_building.json` before starting FastAPI.
   The demo graph is synthetic. Even when using it, PostgreSQL is still needed
   to authenticate the v1 API key.

4. Start Express from `backend` with `npm run dev`. Load real, surveyed graph
   data into the Python service before using real routes.

The Python graph tables are created by `ai-service/migrations/001_initial.sql`.
Populate its `buildings`, `floors`, `nodes`, and `edges` with university-
verified data. A building or node ID in a request must match that graph.

## Route endpoint

`POST /api/ai/route` accepts JSON. The profile defaults to `general`.

```json
{
  "building_id": "BUILDING_A",
  "start_node": "ENTRANCE",
  "destination_node": "ROOM_1",
  "profile": "wheelchair"
}
```

Accepted profiles are `general`, `wheelchair`, `visual_impairment`, and
`blind_navigation`. `constraints` may contain `minimum_door_width_m` and
`maximum_ramp_slope`; only measurements verified in graph metadata are used.
The door-width value is in metres. Express a ramp-slope threshold in the same
scale as the graph's verified `ramp_slope` metadata. Unknown fields are
rejected.

Example browser call (the browser calls Express, not FastAPI):

```javascript
const response = await fetch("/api/ai/route", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    building_id: "BUILDING_A",
    start_node: "ENTRANCE",
    destination_node: "ROOM_1",
    profile: "general"
  })
});

const body = await response.json();
if (!response.ok) throw new Error(body.error?.message ?? "Route request failed");
const route = body.route;
```

Success responses have the stable Express shape:

```json
{
  "success": true,
  "message": "Route successfully calculated",
  "route": {
    "nodes": ["ENTRANCE"],
    "total_distance": 0,
    "floor_transitions": [],
    "profile": "general",
    "node_details": [
      {
        "node_id": "ENTRANCE",
        "building_id": "BUILDING_A",
        "floor_id": "G",
        "x": 1,
        "y": 2,
        "node_type": "waypoint",
        "accessibility": {
          "accessible": null,
          "blocked": false,
          "verified": false,
          "door_width_m": null,
          "ramp_slope": null,
          "surface_condition": null,
          "landmarks": [],
          "additional": {}
        },
        "staircase_connection_id": null,
        "is_destination": false,
        "label": null
      }
    ],
    "edges": []
  }
}
```

This is the valid same-node route shape; a multi-node route includes its
traversed edges and one node detail per route node. Use each node's `floor_id`, `x`, and
`y` when drawing the route. Use `floor_transitions` to change floor-plan layers
instead of drawing a corridor between floors.

## Errors and limits

Express errors use `{ "error": { "code": "...", "message": "..." } }`.

| Status | Meaning |
|---|---|
| `400` | Express request validation failed |
| `404` | Building or endpoint node is missing |
| `422` | Invalid request or no route meets the selected profile |
| `429` | Express AI-route rate limit exceeded |
| `502` | Python unavailable, API key rejected, or invalid upstream response |
| `503` | Express API key is not configured or Python reports unavailable |

Express applies a separate per-IP limit to the public route endpoint
(`AI_RATE_LIMIT_PER_MINUTE`, default 30/minute). FastAPI applies a
per-process, per-key limit (`AI_RATE_LIMIT_PER_MINUTE`, default 120/minute).
Route requests time out after 10 seconds. `GET /api/ai/health` checks that the
FastAPI v1 health endpoint responds; it does not verify the API key or that a
building graph is loaded.

The route endpoint allows anonymous callers, so keep its rate limit and
network-facing configuration appropriate for deployment. The API key remains
server-side. Route results are assistive information, not a safety guarantee;
graph quality depends on university survey and verification.

## Integration boundary

The Express AI module currently proxies route calculation and health only.
Python session-collection, analytics, and recommendation APIs are not exposed
through `/api/ai`.

For Python API details, graph validation, PostgreSQL schema, consent, and
analytics behavior, see [`../ai-service/README.md`](../ai-service/README.md).
