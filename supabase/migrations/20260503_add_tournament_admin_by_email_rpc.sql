-- Add a registered user to a tournament by auth email.
-- This avoids relying on user_profiles.email being backfilled.

create table if not exists public.tournament_admins (
    id uuid primary key default gen_random_uuid(),
    tournament_id uuid not null references public.tournaments(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    added_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    unique (tournament_id, user_id)
);

alter table public.tournament_admins enable row level security;

alter table public.user_profiles
    add column if not exists email text;

create index if not exists user_profiles_email_idx
    on public.user_profiles (lower(email));

create or replace function public.is_admin_jwt()
returns boolean language sql stable
as $$
    select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
$$;

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

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'tournament_admins'
          and policyname = 'ta_select'
    ) then
        create policy ta_select on public.tournament_admins
            for select
            using (public.can_manage_tournament(tournament_id));
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'tournament_admins'
          and policyname = 'ta_write'
    ) then
        create policy ta_write on public.tournament_admins
            for all to authenticated
            using (public.can_manage_tournament(tournament_id))
            with check (public.can_manage_tournament(tournament_id));
    end if;
end $$;

drop function if exists public.add_tournament_admin_by_email(uuid, text);

create or replace function public.add_tournament_admin_by_email(
    p_tournament_id uuid,
    p_email text
)
returns table (
    admin_id uuid,
    admin_user_id uuid,
    admin_added_by uuid,
    admin_created_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
    v_email text := lower(trim(coalesce(p_email, '')));
    v_user auth.users%rowtype;
    v_entry public.tournament_admins%rowtype;
    v_username text;
    v_name text;
begin
    if p_tournament_id is null or v_email = '' then
        raise exception 'tournament_id and email required';
    end if;

    if not public.can_manage_tournament(p_tournament_id) then
        raise exception 'Forbidden';
    end if;

    select au.*
      into v_user
      from auth.users au
     where lower(au.email) = v_email
     limit 1;

    if v_user.id is null then
        raise exception 'No registered account found for "%". The user must sign up first.', p_email;
    end if;

    v_username := regexp_replace(split_part(v_email, '@', 1), '[^a-z0-9_]', '_', 'g');
    v_name := coalesce(
        v_user.raw_user_meta_data ->> 'full_name',
        v_user.raw_user_meta_data ->> 'name',
        split_part(v_email, '@', 1),
        'User'
    );

    insert into public.user_profiles (id, username, name, email, status)
    values (v_user.id, v_username, v_name, v_email, 'active')
    on conflict (id) do update
       set email = coalesce(public.user_profiles.email, excluded.email);

    insert into public.tournament_admins (tournament_id, user_id, added_by)
    values (p_tournament_id, v_user.id, auth.uid())
    on conflict (tournament_id, user_id) do update
       set added_by = coalesce(public.tournament_admins.added_by, excluded.added_by)
    returning
        tournament_admins.id,
        tournament_admins.tournament_id,
        tournament_admins.user_id,
        tournament_admins.added_by,
        tournament_admins.created_at
    into v_entry;

    return query
    select v_entry.id, v_entry.user_id, v_entry.added_by, v_entry.created_at;
end;
$$;

grant execute on function public.add_tournament_admin_by_email(uuid, text) to authenticated;

create or replace function public.set_tournament_admin_status(
    p_tournament_id uuid,
    p_user_id uuid,
    p_status text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
    v_status text := lower(trim(coalesce(p_status, '')));
begin
    if v_status not in ('active', 'suspended') then
        raise exception 'Invalid status';
    end if;

    if not public.can_manage_tournament(p_tournament_id) then
        raise exception 'Forbidden';
    end if;

    if p_user_id = auth.uid() and v_status = 'suspended' then
        raise exception 'You cannot suspend yourself';
    end if;

    if not exists (
        select 1 from public.tournament_admins ta
        where ta.tournament_id = p_tournament_id
          and ta.user_id = p_user_id
    ) then
        raise exception 'Admin is not assigned to this tournament';
    end if;

    update public.user_profiles up
       set status = v_status
     where up.id = p_user_id;
end;
$$;

grant execute on function public.set_tournament_admin_status(uuid, uuid, text) to authenticated;

create or replace function public.delete_tournament_admin_account(
    p_tournament_id uuid,
    p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
    if not public.can_manage_tournament(p_tournament_id) then
        raise exception 'Forbidden';
    end if;

    if p_user_id = auth.uid() then
        raise exception 'You cannot delete yourself';
    end if;

    if not exists (
        select 1 from public.tournament_admins ta
        where ta.tournament_id = p_tournament_id
          and ta.user_id = p_user_id
    ) then
        raise exception 'Admin is not assigned to this tournament';
    end if;

    delete from auth.users au
     where au.id = p_user_id;
end;
$$;

grant execute on function public.delete_tournament_admin_account(uuid, uuid) to authenticated;
