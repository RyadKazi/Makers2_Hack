-- Step 4: crowdsourced mobility with privacy by design (Law 18-07).
-- Hand-written: enum renames keep existing rows, hotspots.geom is generated from x/y.

-- ───────── Session end reasons: names used by the API ─────────
ALTER TYPE "SessionEndReason" RENAME VALUE 'LEFT_GEOFENCE' TO 'GEOFENCE_EXIT';
ALTER TYPE "SessionEndReason" RENAME VALUE 'MAX_DURATION' TO 'TIME_LIMIT';
ALTER TYPE "SessionEndReason" RENAME VALUE 'MIDNIGHT' TO 'DAILY_RESET';
ALTER TYPE "SessionEndReason" ADD VALUE 'CONSENT_WITHDRAWN';

-- ───────── Recommendation kinds: RAMP / ELEVATOR / WIDEN_DOOR / ACCESSIBLE_ENTRANCE / SIGNAGE ─────────
CREATE TYPE "RecommendationKind_new" AS ENUM ('RAMP', 'ELEVATOR', 'WIDEN_DOOR', 'ACCESSIBLE_ENTRANCE', 'SIGNAGE');
ALTER TABLE "recommendations" ALTER COLUMN "kind" TYPE "RecommendationKind_new" USING (
  CASE "kind"::text
    WHEN 'BUILD_RAMP' THEN 'RAMP'
    WHEN 'REGRADE_RAMP' THEN 'RAMP'
    WHEN 'REPAIR_SURFACE' THEN 'RAMP'
    WHEN 'BUILD_ELEVATOR' THEN 'ELEVATOR'
    WHEN 'ADD_SHORELINE' THEN 'SIGNAGE'
    ELSE "kind"::text
  END
)::"RecommendationKind_new";
DROP TYPE "RecommendationKind";
ALTER TYPE "RecommendationKind_new" RENAME TO "RecommendationKind";

ALTER TABLE "recommendations" ADD COLUMN "key" TEXT;
CREATE UNIQUE INDEX "recommendations_key_key" ON "recommendations"("key");

-- ───────── Sessions & events ─────────
ALTER TABLE "tracking_sessions" ADD COLUMN "lastPointAt" TIMESTAMP(3), ADD COLUMN "analyzedUntil" TIMESTAMP(3);
CREATE INDEX "tracking_sessions_endedAt_idx" ON "tracking_sessions"("endedAt");
ALTER TABLE "difficulty_events" ADD COLUMN "detector" TEXT;

-- ───────── Heatmap: one set of cells per period (TODAY / 7D / 30D) ─────────
DROP INDEX "heatmap_cells_level_cellSizeM_cellX_cellY_segment_windowSta_key";
DROP INDEX "heatmap_cells_level_segment_windowStart_idx";
DELETE FROM "heatmap_cells"; -- recomputed by the aggregation job
ALTER TABLE "heatmap_cells" ADD COLUMN "period" TEXT NOT NULL;
CREATE UNIQUE INDEX "heatmap_cells_period_level_cellSizeM_cellX_cellY_segment_key" ON "heatmap_cells"("period", "level", "cellSizeM", "cellX", "cellY", "segment");
CREATE INDEX "heatmap_cells_period_segment_level_idx" ON "heatmap_cells"("period", "segment", "level");
-- k-anonymity, enforced by the database too: no cell below 5 distinct contributors is ever stored.
ALTER TABLE "heatmap_cells" ADD CONSTRAINT "heatmap_cells_k_anonymity" CHECK ("contributorCount" >= 5);

-- ───────── Hotspots (DBSCAN clusters) ─────────
CREATE TABLE "hotspots" (
    "id" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "floorId" TEXT,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "geom" geometry(Point, 0) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint("x", "y"), 0)) STORED,
    "radiusM" DOUBLE PRECISION NOT NULL,
    "eventCount" INTEGER NOT NULL,
    "contributorCount" INTEGER NOT NULL,
    "byType" JSONB NOT NULL,
    "byCategory" JSONB NOT NULL,
    "dominantType" "DifficultyType" NOT NULL,
    "edgeId" TEXT,
    "wallId" TEXT,
    "wallKind" "WallKind",
    "wallSide" "WallSide",
    "wallDistanceM" DOUBLE PRECISION,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hotspots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hotspots_k_anonymity" CHECK ("contributorCount" >= 5)
);
CREATE INDEX "hotspots_level_idx" ON "hotspots"("level");
CREATE INDEX "hotspots_geom_gist" ON "hotspots" USING GIST ("geom");
ALTER TABLE "hotspots" ADD CONSTRAINT "hotspots_edgeId_fkey" FOREIGN KEY ("edgeId") REFERENCES "nav_edges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ───────── Consent & daily pseudonym salts ─────────
CREATE TABLE "mobility_consents" (
    "userId" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mobility_consents_pkey" PRIMARY KEY ("userId")
);
ALTER TABLE "mobility_consents" ADD CONSTRAINT "mobility_consents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "pseudonym_salts" (
    "dayKey" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pseudonym_salts_pkey" PRIMARY KEY ("dayKey")
);
