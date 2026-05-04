-- Add soft-delete support to tournaments table.
-- "Deleting" a tournament now sets deleted_at; restoring clears it.
-- All related data (teams, judges, rounds, etc.) is preserved.

ALTER TABLE tournaments
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_tournaments_deleted_at
    ON tournaments (deleted_at)
    WHERE deleted_at IS NULL;
