-- Step 7: tag crowdsourced positions and difficulty reports with the planned route
-- being followed (random route id, never linked to an account).
ALTER TABLE "track_points" ADD COLUMN "routeId" TEXT;
ALTER TABLE "difficulty_events" ADD COLUMN "routeId" TEXT;
CREATE INDEX "track_points_routeId_idx" ON "track_points"("routeId");
