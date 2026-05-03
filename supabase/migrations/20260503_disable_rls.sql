-- Disable RLS and drop all policies on all app tables.

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
        'team_tokens',
        'categories',
        'team_categories'
    ]
    loop
        if to_regclass(format('public.%I', tbl)) is not null then
            for pol in
                select policyname
                from pg_policies
                where schemaname = 'public'
                  and tablename = tbl
            loop
                execute format('drop policy if exists %I on public.%I', pol.policyname, tbl);
            end loop;
            execute format('alter table public.%I disable row level security', tbl);
        end if;
    end loop;
end $$;
