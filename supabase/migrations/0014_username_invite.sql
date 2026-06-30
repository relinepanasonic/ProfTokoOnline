-- 0014_username_invite.sql
-- 1. Add username + phone columns to profiles
-- 2. Create invites table (admin creates invite → generates link for user to self-register)
-- 3. get_email_by_username() RPC for username-based login

-- ── profiles additions ────────────────────────────────────────────────────────
alter table profiles add column if not exists username text;
alter table profiles add column if not exists phone    text;

-- unique index (case-insensitive)
create unique index if not exists profiles_username_lower
  on profiles (lower(username))
  where username is not null;

-- ── invites table ─────────────────────────────────────────────────────────────
create table if not exists invites (
  id         uuid      primary key default gen_random_uuid(),
  token      text      unique not null default encode(gen_random_bytes(24), 'hex'),
  owner_name text      not null,
  store_name text,
  role       text      not null default 'branch_manager'
             check (role in ('branch_manager', 'client_admin', 'store_user')),
  client_id  uuid      references clients(id) on delete set null,
  created_by uuid      references profiles(id) on delete set null,
  created_at timestamptz default now(),
  expires_at timestamptz default now() + interval '7 days',
  used_at    timestamptz,
  used_by    uuid      references profiles(id) on delete set null
);

alter table invites enable row level security;

-- superadmin can manage all invites
create policy "invites_superadmin_all" on invites
  for all
  using  ((select role from profiles where id = auth.uid()) = 'superadmin')
  with check ((select role from profiles where id = auth.uid()) = 'superadmin');

-- anyone (even anon) can read a valid (unused, not-expired) invite by token
-- used by the /join/[token] page to show pre-filled fields
create policy "invites_public_read_valid" on invites
  for select
  using (used_at is null and expires_at > now());

-- ── get_email_by_username RPC ─────────────────────────────────────────────────
-- Used on the login page: if input is a username (no @), look up the email first,
-- then sign in with email + password via standard Supabase Auth.
create or replace function get_email_by_username(p_username text)
returns text
language sql security definer set search_path = public
as $$
  select u.email
  from auth.users u
  join profiles p on p.id = u.id
  where lower(p.username) = lower(trim(p_username))
  limit 1;
$$;

grant execute on function get_email_by_username(text) to anon, authenticated;
