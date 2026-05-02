-- Allow the public app shell to discover tournaments and their publish rows.
-- Tab-specific data remains protected by the per-table publication policies.

alter table if exists tournaments enable row level security;

drop policy if exists "Published tournaments are publicly readable" on tournaments;
create policy "Published tournaments are publicly readable"
    on tournaments
    as permissive
    for select
    using (
        coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
        or exists (
            select 1
            from tournament_publish tp
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
