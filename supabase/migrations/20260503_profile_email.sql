-- Add email to user_profiles for admin lookup by email.
alter table public.user_profiles
    add column if not exists email text;

create index if not exists user_profiles_email_idx
    on public.user_profiles (lower(email));
