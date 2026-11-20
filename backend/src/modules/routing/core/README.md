# Routing core — owned by the routing teammate

This folder is reserved for the team's routing algorithm. **API code never edits files here.**

Status: **not delivered yet.** Until it lands, the API runs on a temporary stand-in
(`../engine/standInDijkstra.ts`, the step-1 Dijkstra), behind the same interface.

## How it gets plugged in

1. Drop the algorithm here, unchanged.
2. Write one adapter in `../engine/` that implements `RoutingEngine` (`../engine/types.ts`):
   - `buildGraph(nodes, edges)`: convert our graph to the algorithm's input format.
   - `findPath(graph, { fromNodeId, toNodeId, constraints, edgeCost })`: call the algorithm and return `{ nodeIds, edgeIds }`, or `null` when there is no path.
   - `capabilities`: list the constraints it handles natively (`excludeClosed`, `avoidStairs`, `maxSlopePercent`, `minWidthCm`, `verifiedRampsOnly`, `verifiedOnly`, `avoidEdges`), whether it accepts a per-edge cost, and whether it handles multiple floors. The API filters edges for anything it doesn't support **before** calling it.
3. Switch `activeEngine` in `../engine/index.ts`.
4. Run `npm test`. `tests/routing.engine.contract.test.ts` checks the active engine on the seed graph. Failures caused by the algorithm are reported to its owner, not patched here.

Any change needed inside this folder (types, exports) is proposed to the owner first.
