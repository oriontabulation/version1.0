-- ============================================================
-- Publish-gated visibility RLS
--
-- Rules:
--   - Authenticated owners/admins: full read+write always.
--   - Anon / public: read-only, only after the relevant
--     publish flag is set in tournament_publish.
--   - No public write access on anything.
-- ============================================================

-- ── Helper: is the current JWT an admin? ─────────────────────
create or replace function public.is_admin_jwt()
returns boolean language sql security definer stable
set search_path = public, auth as $$
    select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
$$;

-- ── Helper: does the current user own or admin this tournament?
create or replace function public.can_manage_tournament(p_tournament_id uuid)
returns boolean language sql security definer stable
set search_path = public, auth as $$
    select public.is_admin_jwt()
        or exists (
            select 1 from public.tournaments t
            where t.id = p_tournament_id
              and t.owner_id = auth.uid()
        );
$$;

-- ── Drop all existing policies & enable RLS ──────────────────
do $$
declare
    tbl text;
    pol record;
begin
    foreach tbl in array array[
        'tournaments', 'tournament_publish',
        'teams', 'speakers', 'judges',
        'rounds', 'debates', 'debate_judges',
        'judge_conflicts', 'ballots', 'ballot_speaker_scores',
        'feedback', 'judge_tokens', 'team_tokens'
    ]
    loop
        if to_regclass(format('public.%I', tbl)) is not null then
            for pol in
                select policyname from pg_policies
                where schemaname = 'public' and tablename = tbl
            loop
                execute format('drop policy if exists %I on public.%I', pol.policyname, tbl);
            end loop;
            execute format('alter table public.%I enable row level security', tbl);
        end if;
    end loop;
end $$;

-- ── tournament_publish: always public-readable (it IS the flag)
create policy tp_select on public.tournament_publish
    for select using (true);

create policy tp_write on public.tournament_publish
    for all to authenticated
    using  (public.can_manage_tournament(tournament_id))
    with check (public.can_manage_tournament(tournament_id));

-- ── tournaments ───────────────────────────────────────────────
create policy tournaments_select on public.tournaments
    for select using (
        public.can_manage_tournament(id)
        or exists (
            select 1 from public.tournament_publish tp
            where tp.tournament_id = tournaments.id
              and (
                  coalesce(tp.draw,      false) or coalesce(tp.standings, false) or
                  coalesce(tp.speakers,  false) or coalesce(tp.break,     false) or
                  coalesce(tp.knockout,  false) or coalesce(tp.motions,   false) or
                  coalesce(tp.results,   false)
              )
        )
    );

create policy tournaments_write on public.tournaments
    for all to authenticated
    using  (public.can_manage_tournament(id))
    with check (public.is_admin_jwt() or owner_id = auth.uid());

-- ── Macro: tables published via draw OR results ───────────────
-- teams, speakers, rounds, debates, debate_judges
create policy teams_select on public.teams
    for select using (
        public.can_manage_tournament(tournament_id)
        or exists (
            select 1 from public.tournament_publish tp
            where tp.tournament_id = teams.tournament_id
              and (coalesce(tp.draw,false) or coalesce(tp.standings,false) or
                   coalesce(tp.speakers,false) or coalesce(tp.break,false) or
                   coalesce(tp.knockout,false) or coalesce(tp.results,false))
        )
    );
create policy teams_write on public.teams
    for all to authenticated
    using  (public.can_manage_tournament(tournament_id))
    with check (public.can_manage_tournament(tournament_id));

create policy speakers_select on public.speakers
    for select using (
        public.can_manage_tournament(tournament_id)
        or exists (
            select 1 from public.tournament_publish tp
            where tp.tournament_id = speakers.tournament_id
              and (coalesce(tp.draw,false) or coalesce(tp.standings,false) or
                   coalesce(tp.speakers,false) or coalesce(tp.break,false) or
                   coalesce(tp.knockout,false) or coalesce(tp.results,false))
        )
    );
create policy speakers_write on public.speakers
    for all to authenticated
    using  (public.can_manage_tournament(tournament_id))
    with check (public.can_manage_tournament(tournament_id));

create policy judges_select on public.judges
    for select using (
        public.can_manage_tournament(tournament_id)
        or user_id = auth.uid()
        or exists (
            select 1 from public.tournament_publish tp
            where tp.tournament_id = judges.tournament_id
              and (coalesce(tp.draw,false) or coalesce(tp.results,false))
        )
    );
create policy judges_write on public.judges
    for all to authenticated
    using  (public.can_manage_tournament(tournament_id))
    with check (public.can_manage_tournament(tournament_id));

create policy rounds_select on public.rounds
    for select using (
        public.can_manage_tournament(tournament_id)
        or exists (
            select 1 from public.tournament_publish tp
            where tp.tournament_id = rounds.tournament_id
              and (coalesce(tp.draw,false) or coalesce(tp.standings,false) or
                   coalesce(tp.speakers,false) or coalesce(tp.break,false) or
                   coalesce(tp.knockout,false) or coalesce(tp.results,false))
        )
    );
create policy rounds_write on public.rounds
    for all to authenticated
    using  (public.can_manage_tournament(tournament_id))
    with check (public.can_manage_tournament(tournament_id));

create policy debates_select on public.debates
    for select using (
        public.can_manage_tournament(tournament_id)
        or exists (
            select 1 from public.tournament_publish tp
            where tp.tournament_id = debates.tournament_id
              and (coalesce(tp.draw,false) or coalesce(tp.results,false))
        )
    );
create policy debates_write on public.debates
    for all to authenticated
    using  (public.can_manage_tournament(tournament_id))
    with check (public.can_manage_tournament(tournament_id));

create policy debate_judges_select on public.debate_judges
    for select using (
        exists (
            select 1 from public.debates d
            join public.tournament_publish tp on tp.tournament_id = d.tournament_id
            where d.id = debate_judges.debate_id
              and (
                  public.can_manage_tournament(d.tournament_id)
                  or coalesce(tp.draw,false) or coalesce(tp.results,false)
              )
        )
    );
create policy debate_judges_write on public.debate_judges
    for all to authenticated
    using (
        exists (
            select 1 from public.debates d
            where d.id = debate_judges.debate_id
              and public.can_manage_tournament(d.tournament_id)
        )
    )
    with check (
        exists (
            select 1 from public.debates d
            where d.id = debate_judges.debate_id
              and public.can_manage_tournament(d.tournament_id)
        )
    );

-- ── judge_conflicts: owner-only ───────────────────────────────
create policy judge_conflicts_select on public.judge_conflicts
    for select using (
        exists (
            select 1 from public.judges j
            where j.id = judge_conflicts.judge_id
              and public.can_manage_tournament(j.tournament_id)
        )
    );
create policy judge_conflicts_write on public.judge_conflicts
    for all to authenticated
    using (
        exists (
            select 1 from public.judges j
            where j.id = judge_conflicts.judge_id
              and public.can_manage_tournament(j.tournament_id)
        )
    )
    with check (
        exists (
            select 1 from public.judges j
            where j.id = judge_conflicts.judge_id
              and public.can_manage_tournament(j.tournament_id)
        )
    );

-- ── ballots ───────────────────────────────────────────────────
create policy ballots_select on public.ballots
    for select using (
        public.can_manage_tournament(tournament_id)
        or submitted_by = auth.uid()
        or exists (
            select 1 from public.tournament_publish tp
            where tp.tournament_id = ballots.tournament_id
              and coalesce(tp.results,false)
        )
    );
create policy ballots_write on public.ballots
    for all to authenticated
    using  (public.can_manage_tournament(tournament_id) or submitted_by = auth.uid())
    with check (public.can_manage_tournament(tournament_id) or submitted_by = auth.uid());

create policy bss_select on public.ballot_speaker_scores
    for select using (
        exists (
            select 1 from public.ballots b
            where b.id = ballot_speaker_scores.ballot_id
              and (
                  public.can_manage_tournament(b.tournament_id)
                  or b.submitted_by = auth.uid()
                  or exists (
                      select 1 from public.tournament_publish tp
                      where tp.tournament_id = b.tournament_id
                        and coalesce(tp.results,false)
                  )
              )
        )
    );
create policy bss_write on public.ballot_speaker_scores
    for all to authenticated
    using (
        exists (
            select 1 from public.ballots b
            where b.id = ballot_speaker_scores.ballot_id
              and (public.can_manage_tournament(b.tournament_id) or b.submitted_by = auth.uid())
        )
    )
    with check (
        exists (
            select 1 from public.ballots b
            where b.id = ballot_speaker_scores.ballot_id
              and (public.can_manage_tournament(b.tournament_id) or b.submitted_by = auth.uid())
        )
    );

-- ── feedback: owner sees all; judge sees their own ────────────
create policy feedback_select on public.feedback
    for select using (
        public.can_manage_tournament(tournament_id)
        or exists (select 1 from public.judges j where j.id = feedback.to_judge_id   and j.user_id = auth.uid())
        or exists (select 1 from public.judges j where j.id = feedback.from_judge_id and j.user_id = auth.uid())
    );
create policy feedback_write on public.feedback
    for all to authenticated
    using  (public.can_manage_tournament(tournament_id))
    with check (public.can_manage_tournament(tournament_id));

-- ── tokens: owner-only ────────────────────────────────────────
create policy judge_tokens_select on public.judge_tokens
    for select using (public.can_manage_tournament(tournament_id));
create policy judge_tokens_write on public.judge_tokens
    for all to authenticated
    using  (public.can_manage_tournament(tournament_id))
    with check (public.can_manage_tournament(tournament_id));

create policy team_tokens_select on public.team_tokens
    for select using (public.can_manage_tournament(tournament_id));
create policy team_tokens_write on public.team_tokens
    for all to authenticated
    using  (public.can_manage_tournament(tournament_id))
    with check (public.can_manage_tournament(tournament_id));

