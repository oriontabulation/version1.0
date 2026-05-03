-- ============================================================
-- Tournament-scoped admins + optional access password
-- ============================================================

-- ── 1. tournament_admins table ───────────────────────────────
create table if not exists public.tournament_admins (
    id            uuid primary key default gen_random_uuid(),
    tournament_id uuid not null references public.tournaments(id) on delete cascade,
    user_id       uuid not null references auth.users(id) on delete cascade,
    added_by      uuid references auth.users(id) on delete set null,
    created_at    timestamptz not null default now(),
    unique (tournament_id, user_id)
);

alter table public.tournament_admins enable row level security;

-- Owner and global admins can see/manage tournament_admins
create policy ta_select on public.tournament_admins
    for select
    using (public.can_manage_tournament(tournament_id));

create policy ta_write on public.tournament_admins
    for all to authenticated
    using  (public.can_manage_tournament(tournament_id))
    with check (public.can_manage_tournament(tournament_id));

-- ── 2. Access password on tournaments ────────────────────────
alter table public.tournaments
    add column if not exists access_password text default null;

-- ── 3. Update can_manage_tournament to include tournament_admins
create or replace function public.can_manage_tournament(p_tournament_id uuid)
returns boolean language sql security definer stable
set search_path = public, auth as $$
    select public.is_admin_jwt()
        or exists (
            select 1 from public.tournaments t
            where t.id = p_tournament_id
              and t.owner_id = auth.uid()
        )
        or exists (
            select 1 from public.tournament_admins ta
            where ta.tournament_id = p_tournament_id
              and ta.user_id = auth.uid()
        );
$$;
