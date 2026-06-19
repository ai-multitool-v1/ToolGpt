-- ============================================================================
-- AI Chat SaaS — Supabase Schema
-- ----------------------------------------------------------------------------
-- Run this in the Supabase SQL Editor (Dashboard → SQL → New query).
-- It is idempotent: re-running won't break existing data.
--
-- Tables created:
--   profiles          -> user plan, quota, ban, expiry
--   chat_history      -> per-user chat messages
--   token_usage       -> per-request token accounting
--   payment_requests  -> bKash/Nagad manual-payment queue
--
-- RLS is ENABLED on every table. Anonymous access is denied by default.
-- Service-role key (server-only) bypasses RLS — that key is used by the
-- Cloudflare Functions, never by the browser.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Extensions
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. ENUM types
-- ----------------------------------------------------------------------------
do $$ begin
  create type plan_type as enum ('free', 'pro', 'ultra');
exception when duplicate_object then null; end $$;

do $$ begin
  create type chat_role as enum ('user', 'assistant', 'system');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_method as enum ('bkash', 'nagad');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. profiles
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  username      text,
  avatar_url    text,
  plan          plan_type not null default 'free',
  daily_limit   integer  not null default 200,
  used_tokens   integer  not null default 0,
  expires_at    timestamptz,
  is_banned     boolean  not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists profiles_plan_idx        on public.profiles(plan);
create index if not exists profiles_expires_at_idx  on public.profiles(expires_at) where expires_at is not null;

-- ----------------------------------------------------------------------------
-- 3. chat_history
-- ----------------------------------------------------------------------------
create table if not exists public.chat_history (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  role          chat_role not null,
  message       text not null,
  model         text,
  tokens_used   integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists chat_history_user_created_idx on public.chat_history(user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 4. token_usage
-- ----------------------------------------------------------------------------
create table if not exists public.token_usage (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  total_tokens   integer not null default 0,
  model          text,
  created_at     timestamptz not null default now()
);

create index if not exists token_usage_user_created_idx on public.token_usage(user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 5. payment_requests
-- ----------------------------------------------------------------------------
create table if not exists public.payment_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  email         text not null,
  method        payment_method not null,
  amount        numeric(10,2) not null,
  trx_id        text not null,
  status        payment_status not null default 'pending',
  requested_at  timestamptz not null default now(),
  approved_at   timestamptz,
  notes         text
);

create index if not exists payment_requests_status_idx on public.payment_requests(status, requested_at desc);
create index if not exists payment_requests_user_idx   on public.payment_requests(user_id, requested_at desc);

-- ----------------------------------------------------------------------------
-- 6. updated_at triggers
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 7. Auto-create profile on signup
-- ----------------------------------------------------------------------------
-- When a new auth.users row appears (signup or OAuth), seed a profiles row
-- with the FREE plan defaults. Google OAuth users are auto-verified by
-- Supabase, so their profile is created here and immediately usable.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, username, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 8. Row Level Security
-- ----------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.chat_history      enable row level security;
alter table public.token_usage       enable row level security;
alter table public.payment_requests  enable row level security;

-- profiles: a user can read & update ONLY their own row.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Users CANNOT change their own plan / daily_limit / used_tokens / is_banned /
-- expires_at from the client. Lock those columns at the DB layer too.
revoke update (plan, daily_limit, used_tokens, is_banned, expires_at) on public.profiles from anon, authenticated;

-- chat_history: own rows only.
drop policy if exists "chat_history_select_own" on public.chat_history;
create policy "chat_history_select_own"
  on public.chat_history for select
  using (auth.uid() = user_id);

drop policy if exists "chat_history_insert_own" on public.chat_history;
create policy "chat_history_insert_own"
  on public.chat_history for insert
  with check (auth.uid() = user_id);

drop policy if exists "chat_history_delete_own" on public.chat_history;
create policy "chat_history_delete_own"
  on public.chat_history for delete
  using (auth.uid() = user_id);

-- token_usage: own rows only, insert + select. No update/delete from client.
drop policy if exists "token_usage_select_own" on public.token_usage;
create policy "token_usage_select_own"
  on public.token_usage for select
  using (auth.uid() = user_id);

drop policy if exists "token_usage_insert_own" on public.token_usage;
create policy "token_usage_insert_own"
  on public.token_usage for insert
  with check (auth.uid() = user_id);

-- payment_requests: own rows only, insert + select. Updates are server-only.
drop policy if exists "payment_requests_select_own" on public.payment_requests;
create policy "payment_requests_select_own"
  on public.payment_requests for select
  using (auth.uid() = user_id);

drop policy if exists "payment_requests_insert_own" on public.payment_requests;
create policy "payment_requests_insert_own"
  on public.payment_requests for insert
  with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 9. Server-side helpers (security definer) — used by Cloudflare Functions
--    via the SERVICE_ROLE key. The functions should NOT rely on these; they
--    use parameterised queries with the service role. These are optional
--    convenience views for admin dashboards.
-- ----------------------------------------------------------------------------
create or replace view public.admin_payment_queue as
  select id, user_id, email, method, amount, trx_id, status, requested_at, approved_at
  from public.payment_requests
  order by requested_at desc;

-- ----------------------------------------------------------------------------
-- 10. Done.
-- ----------------------------------------------------------------------------
-- After running this, in Supabase Dashboard → Auth → Providers:
--   * Enable Email provider — require email confirmation = ON
--   * Enable Google OAuth — set redirect URL to your Cloudflare Pages domain
-- ----------------------------------------------------------------------------
