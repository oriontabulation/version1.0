-- ============================================================
-- Realtime + public visibility for published tournament pages
-- ============================================================

drop policy if exists "Teams visible only after draw publication" on teams;
drop policy if exists "Teams visible when relevant tab is published" on teams;

drop policy if exists "Publish flags are publicly readable" on tournament_publish;
create policy "Publish flags are publicly readable"
    on tournament_publish
    as permissive
    for select
    using (true);

create policy "Teams visible when relevant tab is published"
    on teams
    as permissive
    for select
    using (
        coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
        or exists (
            select 1
            from tournament_publish tp
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

drop policy if exists "Speakers visible when relevant tab is published" on speakers;
create policy "Speakers visible when relevant tab is published"
    on speakers
    as permissive
    for select
    using (
        coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
        or exists (
            select 1
            from tournament_publish tp
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

drop policy if exists "Rounds visible when relevant tab is published" on rounds;
create policy "Rounds visible when relevant tab is published"
    on rounds
    as permissive
    for select
    using (
        coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
        or exists (
            select 1
            from tournament_publish tp
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

drop policy if exists "Debates visible when relevant tab is published" on debates;
create policy "Debates visible when relevant tab is published"
    on debates
    as permissive
    for select
    using (
        coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
        or exists (
            select 1
            from tournament_publish tp
            where tp.tournament_id = debates.tournament_id
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

drop policy if exists "Debate judges visible when relevant tab is published" on debate_judges;
create policy "Debate judges visible when relevant tab is published"
    on debate_judges
    as permissive
    for select
    using (
        coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
        or exists (
            select 1
            from debates d
            join tournament_publish tp on tp.tournament_id = d.tournament_id
            where d.id = debate_judges.debate_id
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

drop policy if exists "Judges visible when draw or results are published" on judges;
create policy "Judges visible when draw or results are published"
    on judges
    as permissive
    for select
    using (
        coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
        or exists (
            select 1
            from tournament_publish tp
            where tp.tournament_id = judges.tournament_id
              and (
                  coalesce(tp.draw, false)
                  or coalesce(tp.results, false)
              )
        )
    );

alter table if exists public.tournament_publish replica identity full;
alter table if exists public.teams replica identity full;
alter table if exists public.speakers replica identity full;
alter table if exists public.rounds replica identity full;
alter table if exists public.debates replica identity full;
alter table if exists public.debate_judges replica identity full;
alter table if exists public.ballots replica identity full;
alter table if exists public.judges replica identity full;
alter table if exists public.judge_conflicts replica identity full;

do $$
declare
    table_name text;
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        foreach table_name in array array[
            'tournament_publish',
            'teams',
            'speakers',
            'rounds',
            'debates',
            'debate_judges',
            'ballots',
            'judges',
            'judge_conflicts'
        ]
        loop
            if not exists (
                select 1
                from pg_publication_tables
                where pubname = 'supabase_realtime'
                  and schemaname = 'public'
                  and tablename = table_name
            ) then
                execute format('alter publication supabase_realtime add table public.%I', table_name);
            end if;
        end loop;
    end if;
end $$;
