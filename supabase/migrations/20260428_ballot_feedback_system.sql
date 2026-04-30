-- ============================================================
-- Ballot & Feedback System — schema enhancements
-- ============================================================

-- Judges: check-in flag
ALTER TABLE judges
    ADD COLUMN IF NOT EXISTS checked_in boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS rating      numeric(3,1);

-- Feedback: extend for half-star ratings, agree-with-call, team source
ALTER TABLE feedback
    ADD COLUMN IF NOT EXISTS agree_with_call text,        -- yes|mostly|partially|no|na
    ADD COLUMN IF NOT EXISTS source_type     text NOT NULL DEFAULT 'judge_peer',  -- judge_peer|team
    ADD COLUMN IF NOT EXISTS from_team_id    uuid REFERENCES teams(id) ON DELETE SET NULL;

-- Allow half-star (numeric) ratings — safe cast from integer
DO $$
BEGIN
    BEGIN
        ALTER TABLE feedback ALTER COLUMN rating TYPE numeric(3,1) USING rating::numeric(3,1);
    EXCEPTION WHEN others THEN NULL; END;
END $$;

-- Enforce: either from_judge_id or from_team_id must be set
ALTER TABLE feedback
    DROP CONSTRAINT IF EXISTS feedback_from_check;
ALTER TABLE feedback
    ADD CONSTRAINT feedback_from_check CHECK (
        (from_judge_id IS NOT NULL AND from_team_id IS NULL)
     OR (from_team_id IS NOT NULL AND from_judge_id IS NULL)
    );

-- Unique: one judge-peer review per (from_judge, to_judge, debate)
CREATE UNIQUE INDEX IF NOT EXISTS feedback_judge_peer_uniq
    ON feedback (from_judge_id, to_judge_id, debate_id)
    WHERE from_judge_id IS NOT NULL;

-- Unique: one team review per (team, to_judge, debate)
CREATE UNIQUE INDEX IF NOT EXISTS feedback_team_uniq
    ON feedback (from_team_id, to_judge_id, debate_id)
    WHERE from_team_id IS NOT NULL;

-- View: judge ratings aggregate
CREATE OR REPLACE VIEW judge_ratings AS
SELECT
    to_judge_id                          AS judge_id,
    COUNT(*)                             AS review_count,
    ROUND(AVG(rating), 2)                AS avg_rating,
    ROUND(AVG(CASE WHEN source_type = 'judge_peer' THEN rating END), 2) AS peer_avg,
    ROUND(AVG(CASE WHEN source_type = 'team'       THEN rating END), 2) AS team_avg,
    COUNT(CASE WHEN agree_with_call = 'yes'         THEN 1 END) AS agree_count,
    COUNT(CASE WHEN agree_with_call IN ('partially','no') THEN 1 END) AS disagree_count
FROM feedback
GROUP BY to_judge_id;

-- ============================================================
-- Team tokens (mirrors judge_tokens — private URL access)
-- ============================================================
CREATE TABLE IF NOT EXISTS team_tokens (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    token         text        UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
    team_id       uuid        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    tournament_id uuid        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    revoked       boolean     NOT NULL DEFAULT false,
    expires_at    timestamptz,
    last_used_at  timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS team_tokens_team_id_idx        ON team_tokens(team_id);
CREATE INDEX IF NOT EXISTS team_tokens_tournament_id_idx  ON team_tokens(tournament_id);
