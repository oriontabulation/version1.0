-- ============================================================
-- Fix RLS recursion and restore app write paths.
--
-- Root cause:
--   Older policies on judges, rounds, teams, debate_judges,
--   judge_tokens, and ballots looked through each other. Postgres
--   evaluates RLS on every referenced table, so those joins formed
--   policy cycles such as judges -> debate_judges -> judges and
--   rounds -> debates -> rounds.
--
-- Strategy:
--   1. Drop all policies on the app-owned tournament tables.
--   2. Rebuild helpers as SECURITY DEFINER functions so policy checks
--      can inspect ownership/assignments without triggering RLS again.
--   3. Recreate read/write policies around those helpers.
-- ============================================================

create or replace function public.is_admin_jwt()
returns boolean
language sql
security definer
stable
set search_path = public, auth
as $$
    select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
$$;

create or replace function public.can_manage_tournament(p_tournament_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, auth
as $$
    select public.is_admin_jwt()
        or exists (
            select 1
            from public.tournaments t
            where t.id = p_tournament_id
              and t.owner_id = auth.uid()
        );
$$;

create or replace function public.can_manage_debate(p_debate_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, auth
as $$
    select public.is_admin_jwt()
        or exists (
            select 1
            from public.debates d
            where d.id = p_debate_id
              and public.can_manage_tournament(d.tournament_id)
        );
$$;

create or replace function public.can_manage_judge(p_judge_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, auth
as $$
    select public.is_admin_jwt()
        or exists (
            select 1
            from public.judges j
            where j.id = p_judge_id
              and public.can_manage_tournament(j.tournament_id)
        );
$$;

create or replace function public.can_manage_team(p_team_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, auth
as $$
    select public.is_admin_jwt()
        or exists (
            select 1
            from public.teams t
            where t.id = p_team_id
              and public.can_manage_tournament(t.tournament_id)
        );
$$;

create or replace function public.is_assigned_judge_for_debate(p_debate_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, auth
as $$
    select exists (
        select 1
        from public.debate_judges dj
        join public.judges j on j.id = dj.judge_id
        where dj.debate_id = p_debate_id
          and j.user_id = auth.uid()
    );
$$;

create or replace function public.is_judge_in_debate(p_judge_id uuid, p_debate_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
    select exists (
        select 1
        from public.debate_judges dj
        where dj.debate_id = p_debate_id
          and dj.judge_id = p_judge_id
    );
$$;

create or replace function public.is_team_in_debate(p_team_id uuid, p_debate_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
    select exists (
        select 1
        from public.debates d
        where d.id = p_debate_id
          and (d.gov_team_id = p_team_id or d.opp_team_id = p_team_id)
    );
$$;

create or replace function public.can_read_ballot(p_ballot_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, auth
as $$
    select exists (
        select 1
        from public.ballots b
        left join public.tournament_publish tp on tp.tournament_id = b.tournament_id
        where b.id = p_ballot_id
          and (
              public.can_manage_tournament(b.tournament_id)
              or b.submitted_by = auth.uid()
              or coalesce(tp.results, false)
          )
    );
$$;

create or replace function public.can_insert_ballot_score(p_ballot_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, auth
as $$
    select exists (
        select 1
        from public.ballots b
        where b.id = p_ballot_id
          and (
              b.submitted_by = auth.uid()
              or public.can_manage_tournament(b.tournament_id)
          )
    );
$$;

do $$
declare
    tbl text;
    pol record;
begin
    foreach tbl in array array[
        'tournaments',
        'tournament_publish',
        'teams',
        'speakers',
        'judges',
        'rounds',
        'debates',
        'debate_judges',
        'judge_conflicts',
        'ballots',
        'ballot_speaker_scores',
        'feedback',
        'judge_tokens',
        'team_tokens'
    ]
    loop
        if to_regclass(format('public.%I', tbl)) is not null then
            execute format('alter table public.%I enable row level security', tbl);

            for pol in
                select policyname
                from pg_policies
                where schemaname = 'public'
                  and tablename = tbl
            loop
                execute format('drop policy if exists %I on public.%I', pol.policyname, tbl);
            end loop;
        end if;
    end loop;
end $$;

-- Tournaments and publish flags.
create policy tournaments_select on public.tournaments
    for select
    using (
        public.is_admin_jwt()
        or owner_id = auth.uid()
        or exists (
            select 1
            from public.tournament_publish tp
            where tp.tournament_id = tournaments.id
              and (
                  coalesce(tp.draw, false)
                  or coalesce(tp.standings, false)
                  or coalesce(tp.speakers, false)
                  or coalesce(tp.break, false)
                  or coalesce(tp.knockout, false)
                  or coalesce(tp.motions, false)
                  or coalesce(tp.results, false)
              )
        )
    );

create policy tournaments_insert on public.tournaments
    for insert
    to authenticated
    with check (public.is_admin_jwt() or owner_id = auth.uid());

create policy tournaments_update on public.tournaments
    for update
    to authenticated
    using (public.is_admin_jwt() or owner_id = auth.uid())
    with check (public.is_admin_jwt() or owner_id = auth.uid());

create policy tournaments_delete on public.tournaments
    for delete
    to authenticated
    using (public.is_admin_jwt() or owner_id = auth.uid());

create policy tournament_publish_select on public.tournament_publish
    for select
    using (true);

create policy tournament_publish_write on public.tournament_publish
    for all
    to authenticated
    using (public.can_manage_tournament(tournament_id))
    with check (public.can_manage_tournament(tournament_id));

-- Tournament-owned tables with direct tournament_id.
create policy teams_select on public.teams
    for select
    using (
        public.can_manage_tournament(tournament_id)
        or exists (
            select 1 from public.tournament_publish tp
            where tp.tournament_id = teams.tournament_id
              and (
                  coalesce(tp.draw, false)
                  or coalesce(tp.standings, false)
                  or coalesce(tp.speakers, false)
                  or coalesce(tp.break, false)
                  or coalesce(tp.knockout, false)
                  or coalesce(tp.results, false)
              )
        )
    );

create policy teams_write on public.teams
    for all
    to authenticated
    using (public.can_manage_tournament(tournament_id))
    with check (public.can_manage_tournament(tournament_id));

create policy speakers_select on public.speakers
    for select
    using (
        public.can_manage_tournament(tournament_id)
        or exists (
            select 1 from public.tournament_publish tp
            where tp.tournament_id = speakers.tournament_id
              and (
                  coalesce(tp.draw, false)
                  or coalesce(tp.standings, false)
                  or coalesce(tp.speakers, false)
                  or coalesce(tp.break, false)
                  or coalesce(tp.knockout, false)
                  or coalesce(tp.results, false)
              )
        )
    );

create policy speakers_write on public.speakers
    for all
    to authenticated
    using (public.can_manage_tournament(tournament_id))
    with check (public.can_manage_tournament(tournament_id));

create policy judges_select on public.judges
    for select
    using (
        public.can_manage_tournament(tournament_id)
        or user_id = auth.uid()
        or exists (
            select 1 from public.tournament_publish tp
            where tp.tournament_id = judges.tournament_id
              and (coalesce(tp.draw, false) or coalesce(tp.results, false))
        )
    );

create policy judges_write on public.judges
    for all
    to authenticated
    using (public.can_manage_tournament(tournament_id))
    with check (public.can_manage_tournament(tournament_id));

create policy rounds_select on public.rounds
    for select
    using (
        public.can_manage_tournament(tournament_id)
        or exists (
            select 1 from public.tournament_publish tp
            where tp.tournament_id = rounds.tournament_id
              and (
                  coalesce(tp.draw, false)
                  or coalesce(tp.standings, false)
                  or coalesce(tp.speakers, false)
                  or coalesce(tp.break, false)
                  or coalesce(tp.knockout, false)
                  or coalesce(tp.results, false)
              )
        )
    );

create policy rounds_write on public.rounds
    for all
    to authenticated
    using (public.can_manage_tournament(tournament_id))
    with check (public.can_manage_tournament(tournament_id));

create policy debates_select on public.debates
    for select
    using (
        public.can_manage_tournament(tournament_id)
        or exists (
            select 1 from public.tournament_publish tp
            where tp.tournament_id = debates.tournament_id
              and (coalesce(tp.draw, false) or coalesce(tp.results, false))
        )
    );

create policy debates_write on public.debates
    for all
    to authenticated
    using (public.can_manage_tournament(tournament_id))
    with check (public.can_manage_tournament(tournament_id));

-- Debate allocations.
create policy debate_judges_select on public.debate_judges
    for select
    using (
        public.can_manage_debate(debate_id)
        or exists (
            select 1
            from public.debates d
            join public.tournament_publish tp on tp.tournament_id = d.tournament_id
            where d.id = debate_judges.debate_id
              and (coalesce(tp.draw, false) or coalesce(tp.results, false))
        )
    );

create policy debate_judges_write on public.debate_judges
    for all
    to authenticated
    using (public.can_manage_debate(debate_id))
    with check (public.can_manage_debate(debate_id));

create policy judge_conflicts_select on public.judge_conflicts
    for select
    using (public.can_manage_judge(judge_id));

create policy judge_conflicts_write on public.judge_conflicts
    for all
    to authenticated
    using (public.can_manage_judge(judge_id))
    with check (public.can_manage_judge(judge_id));

-- Ballots and speaker scores.
create policy ballots_select on public.ballots
    for select
    using (
        public.can_manage_tournament(tournament_id)
        or submitted_by = auth.uid()
        or exists (
            select 1 from public.tournament_publish tp
            where tp.tournament_id = ballots.tournament_id
              and coalesce(tp.results, false)
        )
    );

create policy ballots_insert on public.ballots
    for insert
    to authenticated
    with check (
        submitted_by = auth.uid()
        and public.is_assigned_judge_for_debate(debate_id)
        and exists (
            select 1
            from public.debates d
            where d.id = debate_id
              and d.tournament_id = ballots.tournament_id
        )
    );

create policy ballots_admin_update on public.ballots
    for update
    to authenticated
    using (public.can_manage_tournament(tournament_id))
    with check (public.can_manage_tournament(tournament_id));

create policy ballots_admin_delete on public.ballots
    for delete
    to authenticated
    using (public.can_manage_tournament(tournament_id));

create policy ballot_speaker_scores_select on public.ballot_speaker_scores
    for select
    using (public.can_read_ballot(ballot_id));

create policy ballot_speaker_scores_insert on public.ballot_speaker_scores
    for insert
    to authenticated
    with check (public.can_insert_ballot_score(ballot_id));

create policy ballot_speaker_scores_admin_write on public.ballot_speaker_scores
    for update
    to authenticated
    using (public.can_insert_ballot_score(ballot_id))
    with check (public.can_insert_ballot_score(ballot_id));

create policy ballot_speaker_scores_admin_delete on public.ballot_speaker_scores
    for delete
    to authenticated
    using (public.can_insert_ballot_score(ballot_id));

-- Feedback. Token portals are not Supabase-authenticated, so insert checks are
-- room-based: the reviewer and reviewed judge/team must belong to that debate.
create policy feedback_select on public.feedback
    for select
    using (
        public.can_manage_tournament(tournament_id)
        or exists (
            select 1
            from public.judges j
            where j.id = feedback.to_judge_id
              and j.user_id = auth.uid()
        )
        or exists (
            select 1
            from public.judges j
            where j.id = feedback.from_judge_id
              and j.user_id = auth.uid()
        )
    );

create policy feedback_insert on public.feedback
    for insert
    with check (
        public.can_manage_tournament(tournament_id)
        or (
            source_type = 'judge_peer'
            and from_judge_id is not null
            and to_judge_id is not null
            and debate_id is not null
            and public.is_judge_in_debate(from_judge_id, debate_id)
            and public.is_judge_in_debate(to_judge_id, debate_id)
            and from_judge_id <> to_judge_id
        )
        or (
            source_type = 'team'
            and from_team_id is not null
            and to_judge_id is not null
            and debate_id is not null
            and public.is_team_in_debate(from_team_id, debate_id)
            and public.is_judge_in_debate(to_judge_id, debate_id)
        )
    );

create policy feedback_admin_write on public.feedback
    for update
    to authenticated
    using (public.can_manage_tournament(tournament_id))
    with check (public.can_manage_tournament(tournament_id));

create policy feedback_admin_delete on public.feedback
    for delete
    to authenticated
    using (public.can_manage_tournament(tournament_id));

-- Private links.
create policy judge_tokens_select on public.judge_tokens
    for select
    using (public.can_manage_tournament(tournament_id) or public.can_manage_judge(judge_id));

create policy judge_tokens_write on public.judge_tokens
    for all
    to authenticated
    using (public.can_manage_tournament(tournament_id))
    with check (public.can_manage_tournament(tournament_id));

create policy team_tokens_select on public.team_tokens
    for select
    using (public.can_manage_tournament(tournament_id) or public.can_manage_team(team_id));

create policy team_tokens_write on public.team_tokens
    for all
    to authenticated
    using (public.can_manage_tournament(tournament_id))
    with check (public.can_manage_tournament(tournament_id));

