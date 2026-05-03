-- ============================================================
-- RLS policy hardening for ballots, teams, and judge tokens
-- ============================================================

alter table ballots enable row level security;
alter table teams enable row level security;
alter table judge_tokens enable row level security;

drop policy if exists "Assigned judges can insert ballots" on ballots;
create policy "Assigned judges can insert ballots"
    on ballots
    as restrictive
    for insert
    to authenticated
    with check (
        submitted_by = auth.uid()
        and exists (
            select 1
            from debate_judges dj
            join judges j on j.id = dj.judge_id
            where dj.debate_id = ballots.debate_id
              and j.user_id = auth.uid()
        )
    );

drop policy if exists "Teams visible only after draw publication" on teams;
create policy "Teams visible only after draw publication"
    on teams
    as restrictive
    for select
    using (
        coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
        or exists (
            select 1
            from tournament_publish tp
            where tp.tournament_id = teams.tournament_id
              and tp.draw = true
        )
    );

drop policy if exists "Judges can read only their own tokens" on judge_tokens;
create policy "Judges can read only their own tokens"
    on judge_tokens
    as restrictive
    for select
    to authenticated
    using (
        coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
        or exists (
            select 1
            from judges j
            where j.id = judge_tokens.judge_id
              and j.user_id = auth.uid()
        )
    );
