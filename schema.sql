-- =========================================================================
-- SARAL — Production Database Schema & Row Level Security (RLS)
-- Milestone 1: Profiles, Preferences & Onboarding Persistence (Hardened)
-- =========================================================================

-- 1. Create Public Profiles Table with Complete Columns & Constraints
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  full_name text,
  display_name text,
  avatar_url text,
  account_plan text default 'both' check (account_plan in ('personal', 'business', 'both')),
  spending_limit numeric(10, 2) default 500.00 check (spending_limit >= 0 and spending_limit <= 10000),
  daily_limit numeric(10, 2) default 2000.00 check (daily_limit >= 0 and daily_limit <= 50000),
  notifications_enabled boolean default true,
  voice_assistant_enabled boolean default true,
  onboarding_completed boolean default false,
  onboarding_profile_done boolean default false,
  onboarding_prefs_done boolean default false,
  created_at timestamptz default timezone('utc', now()) not null,
  updated_at timestamptz default timezone('utc', now()) not null
);

-- Safe idempotent column additions for existing installations
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists account_plan text default 'both' check (account_plan in ('personal', 'business', 'both'));
alter table public.profiles add column if not exists spending_limit numeric(10, 2) default 500.00 check (spending_limit >= 0 and spending_limit <= 10000);
alter table public.profiles add column if not exists daily_limit numeric(10, 2) default 2000.00 check (daily_limit >= 0 and daily_limit <= 50000);
alter table public.profiles add column if not exists notifications_enabled boolean default true;
alter table public.profiles add column if not exists voice_assistant_enabled boolean default true;
alter table public.profiles add column if not exists onboarding_completed boolean default false;
alter table public.profiles add column if not exists onboarding_profile_done boolean default false;
alter table public.profiles add column if not exists onboarding_prefs_done boolean default false;

-- Indexes for high-frequency queries
create index if not exists idx_profiles_id on public.profiles(id);
create index if not exists idx_profiles_onboarding on public.profiles(id, onboarding_completed);

-- 2. Enable Row Level Security (RLS)
alter table public.profiles enable row level security;

-- 3. RLS Security Policies (Strictly bound to auth.uid())

-- Policy 1: Authenticated users can SELECT only their own profile
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

-- Policy 2: Authenticated users can INSERT only their own profile
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

-- Policy 3: Authenticated users can UPDATE only their own profile
-- Both USING and WITH CHECK prevent changing the profile ID to another user's ID
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Anonymous users have NO permissions (RLS default deny on public.profiles)

-- 4. Automatic updated_at Timestamp Trigger
create or replace function public.handle_updated_at()
returns trigger 
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

-- 5. Automatic Profile Provisioning on User Signup (Hardened Security Definer)
create or replace function public.handle_new_user()
returns trigger 
language plpgsql 
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (
    id,
    full_name,
    display_name,
    account_plan,
    onboarding_completed,
    onboarding_profile_done,
    onboarding_prefs_done,
    created_at,
    updated_at
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    'both',
    false,
    false,
    false,
    timezone('utc', now()),
    timezone('utc', now())
  )
  on conflict (id) do nothing;
  return new;
exception
  when others then
    -- Log warning but never abort user creation in auth.users
    raise warning 'handle_new_user trigger encountered error for user %: %', new.id, SQLERRM;
    return new;
end;
$$;

-- Restrict function execution: revoke from public, grant strictly to system roles
revoke execute on function public.handle_new_user() from public;
grant execute on function public.handle_new_user() to postgres, service_role;

-- Trigger to execute automatically upon row creation in auth.users
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================================
