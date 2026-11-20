-- Step 2: refresh-token revocation + race-proof reservation overlaps.

-- Refresh tokens embed the user's tokenVersion; bumping it revokes them all.
ALTER TABLE "users" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "reservations_userId_idx" ON "reservations"("userId");

-- No two reservations of the same room may overlap. Half-open ranges [start, end)
-- so back-to-back sessions (08:00–09:30, 09:30–11:00) are allowed. The API checks
-- first to return a helpful 409; this constraint closes the race between two requests.
CREATE EXTENSION IF NOT EXISTS "btree_gist";
ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_no_overlap"
  EXCLUDE USING gist ("roomId" WITH =, tsrange("startsAt", "endsAt", '[)') WITH &&);
