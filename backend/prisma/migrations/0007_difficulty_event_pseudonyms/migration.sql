ALTER TABLE "difficulty_events" ADD COLUMN "pseudoId" TEXT;

UPDATE "difficulty_events" e
SET "pseudoId" = s."pseudoId"
FROM "tracking_sessions" s
WHERE e."sessionId" = s."id";

ALTER TABLE "difficulty_events"
  DROP CONSTRAINT IF EXISTS "difficulty_events_sessionId_fkey";
ALTER TABLE "difficulty_events"
  ADD CONSTRAINT "difficulty_events_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "tracking_sessions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "difficulty_events_pseudoId_recordedAt_idx"
  ON "difficulty_events"("pseudoId", "recordedAt");
