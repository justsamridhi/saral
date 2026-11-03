-- =========================================================================
-- SARAL — Production Database Migration & RLS Security Audit
-- Milestone 2: Personal Workspace, 6 Mini-Apps, Trust Gate & PayPal Ledger
-- Execution: Run in Supabase SQL Editor (Safe & Idempotent)
-- =========================================================================

-- Enable necessary cryptographic extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- -------------------------------------------------------------------------
-- 1. PROFILES TABLE & SECURITY COLUMNS
-- -------------------------------------------------------------------------
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

alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists account_plan text default 'both' check (account_plan in ('personal', 'business', 'both'));
alter table public.profiles add column if not exists spending_limit numeric(10, 2) default 500.00 check (spending_limit >= 0 and spending_limit <= 10000);
alter table public.profiles add column if not exists daily_limit numeric(10, 2) default 2000.00 check (daily_limit >= 0 and daily_limit <= 50000);
alter table public.profiles add column if not exists notifications_enabled boolean default true;
alter table public.profiles add column if not exists voice_assistant_enabled boolean default true;
alter table public.profiles add column if not exists onboarding_completed boolean default false;
alter table public.profiles add column if not exists onboarding_profile_done boolean default false;
alter table public.profiles add column if not exists onboarding_prefs_done boolean default false;

create index if not exists idx_profiles_id on public.profiles(id);
create index if not exists idx_profiles_onboarding on public.profiles(id, onboarding_completed);

alter table public.profiles enable row level security;

-- Profiles RLS: Authenticated users can view and update their own record only
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile" on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles
  for insert to authenticated with check (auth.uid() = id);

-- -------------------------------------------------------------------------
-- 2. MINI-APPS & CATALOG REGISTRY
-- -------------------------------------------------------------------------
create table if not exists public.miniapps (
  id text primary key,
  title text not null,
  slug text unique not null,
  icon text not null,
  category text not null,
  description text not null,
  workspace text default 'personal' check (workspace in ('personal', 'business', 'both')),
  environment text default 'demo' check (environment in ('demo', 'sandbox', 'live')),
  is_active boolean default true,
  display_order integer default 0,
  created_at timestamptz default timezone('utc', now()) not null
);

create table if not exists public.merchants (
  id uuid primary key default gen_random_uuid(),
  miniapp_id text references public.miniapps(id) on delete cascade not null,
  name text not null,
  logo_url text,
  rating numeric(3, 2) default 4.90,
  workspace text default 'personal' check (workspace in ('personal', 'business', 'both')),
  environment text default 'demo' check (environment in ('demo', 'sandbox', 'live')),
  is_verified boolean default true,
  created_at timestamptz default timezone('utc', now()) not null
);

create index if not exists idx_merchants_miniapp on public.merchants(miniapp_id);

create table if not exists public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  miniapp_id text references public.miniapps(id) on delete cascade not null,
  merchant_id uuid references public.merchants(id) on delete set null,
  title text not null,
  category text not null,
  price_minor integer not null check (price_minor >= 0),
  currency text default 'USD' not null,
  stock_qty integer default 999,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default timezone('utc', now()) not null
);

create index if not exists idx_catalog_miniapp on public.catalog_items(miniapp_id);
create index if not exists idx_catalog_merchant on public.catalog_items(merchant_id);

alter table public.miniapps enable row level security;
alter table public.merchants enable row level security;
alter table public.catalog_items enable row level security;

drop policy if exists "Anyone can read miniapps" on public.miniapps;
create policy "Anyone can read miniapps" on public.miniapps for select using (true);

drop policy if exists "Anyone can read merchants" on public.merchants;
create policy "Anyone can read merchants" on public.merchants for select using (true);

drop policy if exists "Anyone can read catalog items" on public.catalog_items;
create policy "Anyone can read catalog items" on public.catalog_items for select using (true);

-- -------------------------------------------------------------------------
-- 3. USER MINI-APP USAGE
-- -------------------------------------------------------------------------
create table if not exists public.user_miniapps (
  user_id uuid references auth.users(id) on delete cascade not null,
  miniapp_id text references public.miniapps(id) on delete cascade not null,
  usage_count integer default 1,
  last_used_at timestamptz default timezone('utc', now()) not null,
  primary key (user_id, miniapp_id)
);

create index if not exists idx_user_miniapps_user on public.user_miniapps(user_id);
alter table public.user_miniapps enable row level security;

drop policy if exists "Users can manage own user_miniapps" on public.user_miniapps;
create policy "Users can manage own user_miniapps" on public.user_miniapps
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- -------------------------------------------------------------------------
-- 4. QUOTES & PROPOSALS (Trust Gate Core)
-- -------------------------------------------------------------------------
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  workspace text default 'personal' check (workspace in ('personal', 'business')),
  environment text default 'demo' check (environment in ('demo', 'sandbox', 'live')),
  miniapp_id text references public.miniapps(id) on delete set null not null,
  merchant_id uuid references public.merchants(id) on delete set null,
  items jsonb not null default '[]'::jsonb,
  amount_minor integer not null check (amount_minor > 0),
  currency text default 'USD' not null,
  quote_hash text not null,
  status text default 'active' check (status in ('active', 'converted', 'expired')),
  expires_at timestamptz default (timezone('utc', now()) + interval '15 minutes') not null,
  created_at timestamptz default timezone('utc', now()) not null
);

create index if not exists idx_quotes_user on public.quotes(user_id);
create index if not exists idx_quotes_status on public.quotes(status);
alter table public.quotes enable row level security;

drop policy if exists "Users can view own quotes" on public.quotes;
create policy "Users can view own quotes" on public.quotes
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users can insert own quotes" on public.quotes;
create policy "Users can insert own quotes" on public.quotes
  for insert to authenticated with check (auth.uid() = user_id);

-- Proposals Table
create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  service_type text not null,
  title text not null,
  merchant text not null,
  items_breakdown jsonb not null default '[]'::jsonb,
  amount_minor integer not null check (amount_minor > 0),
  currency text default 'USD' not null,
  status text default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'expired', 'completed')),
  payload_hash text,
  metadata jsonb default '{}'::jsonb,
  expires_at timestamptz default (timezone('utc', now()) + interval '15 minutes'),
  created_at timestamptz default timezone('utc', now()) not null,
  updated_at timestamptz default timezone('utc', now()) not null
);

create index if not exists idx_proposals_user_id on public.proposals(user_id);
create index if not exists idx_proposals_status on public.proposals(status);
alter table public.proposals enable row level security;

drop policy if exists "Users can view own proposals" on public.proposals;
create policy "Users can view own proposals" on public.proposals
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users can insert own proposals" on public.proposals;
create policy "Users can insert own proposals" on public.proposals
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users can update own proposals status" on public.proposals;
create policy "Users can update own proposals status" on public.proposals
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- -------------------------------------------------------------------------
-- 5. PAYMENTS & AUDIT LEDGER (Zero Client Manipulation)
-- -------------------------------------------------------------------------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid references public.proposals(id) on delete set null,
  user_id uuid references auth.users(id) on delete cascade not null,
  order_id text unique not null,
  authorization_id text unique,
  capture_id text unique,
  amount_minor integer not null check (amount_minor > 0),
  currency text default 'USD' not null,
  status text default 'pending' check (status in ('pending', 'authorized', 'captured', 'voided', 'failed', 'refunded')),
  hold_expires_at timestamptz,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default timezone('utc', now()) not null,
  updated_at timestamptz default timezone('utc', now()) not null
);

create index if not exists idx_payments_user_id on public.payments(user_id);
create index if not exists idx_payments_order_id on public.payments(order_id);
create index if not exists idx_payments_status on public.payments(status);
create index if not exists idx_payments_created_at on public.payments(created_at);
alter table public.payments enable row level security;

-- STRICT: Users can ONLY SELECT their payments. They CANNOT insert, update or delete payment records.
-- Payment mutations must strictly be performed by the backend server via service_role.
drop policy if exists "Users can view own payments" on public.payments;
create policy "Users can view own payments" on public.payments
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users cannot insert payments" on public.payments;
drop policy if exists "Users cannot update payments" on public.payments;
drop policy if exists "Users cannot delete payments" on public.payments;

-- Webhook Events (Service Role only)
create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text unique not null,
  event_type text not null,
  resource_type text,
  summary text,
  payload jsonb not null,
  status text default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  error_message text,
  processed_at timestamptz,
  created_at timestamptz default timezone('utc', now()) not null
);

create index if not exists idx_webhooks_event_id on public.webhook_events(event_id);
create index if not exists idx_webhooks_status on public.webhook_events(status);
alter table public.webhook_events enable row level security;
-- Default deny applies to all authenticated and anonymous users for webhook_events

-- Audit Events
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  details jsonb default '{}'::jsonb,
  ip_address text,
  created_at timestamptz default timezone('utc', now()) not null
);

create index if not exists idx_audit_user_id on public.audit_events(user_id);
create index if not exists idx_audit_entity on public.audit_events(entity_type, entity_id);
alter table public.audit_events enable row level security;

drop policy if exists "Users can view own audit events" on public.audit_events;
create policy "Users can view own audit events" on public.audit_events
  for select to authenticated using (auth.uid() = user_id);

-- -------------------------------------------------------------------------
-- 6. MINI-APP SPECIFIC SERVICE LEDGER TABLES
-- -------------------------------------------------------------------------
create table if not exists public.cinema_bookings (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid references public.proposals(id) on delete set null,
  user_id uuid references auth.users(id) on delete cascade not null,
  movie_title text not null,
  theater_name text not null,
  showtime timestamptz not null,
  seats text[] not null,
  price_minor integer not null,
  status text default 'confirmed' check (status in ('reserved', 'confirmed', 'cancelled')),
  created_at timestamptz default timezone('utc', now()) not null
);
create index if not exists idx_cinema_user on public.cinema_bookings(user_id);
alter table public.cinema_bookings enable row level security;
drop policy if exists "Users view own cinema bookings" on public.cinema_bookings;
create policy "Users view own cinema bookings" on public.cinema_bookings
  for select to authenticated using (auth.uid() = user_id);

create table if not exists public.power_bank_rentals (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid references public.proposals(id) on delete set null,
  user_id uuid references auth.users(id) on delete cascade not null,
  station_name text not null,
  deposit_minor integer not null default 1800,
  rate_per_hour_minor integer not null default 150,
  started_at timestamptz default timezone('utc', now()) not null,
  returned_at timestamptz,
  captured_minor integer default 0,
  status text default 'active' check (status in ('active', 'returned', 'overdue', 'cancelled')),
  created_at timestamptz default timezone('utc', now()) not null
);
create index if not exists idx_powerbank_user on public.power_bank_rentals(user_id);
alter table public.power_bank_rentals enable row level security;
drop policy if exists "Users view own power bank rentals" on public.power_bank_rentals;
create policy "Users view own power bank rentals" on public.power_bank_rentals
  for select to authenticated using (auth.uid() = user_id);

create table if not exists public.recharge_requests (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid references public.proposals(id) on delete set null,
  user_id uuid references auth.users(id) on delete cascade not null,
  operator text not null,
  phone_number text not null,
  plan_title text not null,
  amount_minor integer not null,
  operator_reference text,
  status text default 'completed' check (status in ('pending', 'completed', 'failed')),
  created_at timestamptz default timezone('utc', now()) not null
);
create index if not exists idx_recharge_user on public.recharge_requests(user_id);
alter table public.recharge_requests enable row level security;
drop policy if exists "Users view own recharge requests" on public.recharge_requests;
create policy "Users view own recharge requests" on public.recharge_requests
  for select to authenticated using (auth.uid() = user_id);

create table if not exists public.ev_charging_sessions (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid references public.proposals(id) on delete set null,
  user_id uuid references auth.users(id) on delete cascade not null,
  station_name text not null,
  connector_type text not null,
  max_authorized_minor integer not null default 4000,
  kwh_metered numeric(6, 2) default 0.00,
  captured_minor integer default 0,
  status text default 'active' check (status in ('active', 'completed', 'interrupted', 'cancelled')),
  started_at timestamptz default timezone('utc', now()) not null,
  completed_at timestamptz,
  created_at timestamptz default timezone('utc', now()) not null
);
create index if not exists idx_ev_user on public.ev_charging_sessions(user_id);
alter table public.ev_charging_sessions enable row level security;
drop policy if exists "Users view own ev sessions" on public.ev_charging_sessions;
create policy "Users view own ev sessions" on public.ev_charging_sessions
  for select to authenticated using (auth.uid() = user_id);

create table if not exists public.utility_payments (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid references public.proposals(id) on delete set null,
  user_id uuid references auth.users(id) on delete cascade not null,
  provider_name text not null,
  account_number text not null,
  bill_type text not null,
  amount_minor integer not null,
  receipt_number text,
  status text default 'paid' check (status in ('pending', 'paid', 'failed')),
  created_at timestamptz default timezone('utc', now()) not null
);
create index if not exists idx_utilities_user on public.utility_payments(user_id);
alter table public.utility_payments enable row level security;
drop policy if exists "Users view own utility payments" on public.utility_payments;
create policy "Users view own utility payments" on public.utility_payments
  for select to authenticated using (auth.uid() = user_id);

create table if not exists public.food_orders (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid references public.proposals(id) on delete set null,
  user_id uuid references auth.users(id) on delete cascade not null,
  restaurant_name text not null,
  items jsonb not null default '[]'::jsonb,
  subtotal_minor integer not null,
  tax_minor integer not null default 0,
  delivery_minor integer not null default 0,
  total_minor integer not null,
  delivery_address text,
  status text default 'confirmed' check (status in ('pending', 'confirmed', 'preparing', 'delivered', 'cancelled')),
  created_at timestamptz default timezone('utc', now()) not null
);
create index if not exists idx_food_user on public.food_orders(user_id);
alter table public.food_orders enable row level security;
drop policy if exists "Users view own food orders" on public.food_orders;
create policy "Users view own food orders" on public.food_orders
  for select to authenticated using (auth.uid() = user_id);

-- -------------------------------------------------------------------------
-- 7. ASK SARAL AGENT SESSIONS & CONVERSATIONS
-- -------------------------------------------------------------------------
create table if not exists public.agent_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  workspace text default 'personal' check (workspace in ('personal', 'business')),
  environment text default 'demo' check (environment in ('demo', 'sandbox', 'live')),
  title text default 'New Conversation',
  created_at timestamptz default timezone('utc', now()) not null,
  updated_at timestamptz default timezone('utc', now()) not null
);
create index if not exists idx_agent_sessions_user on public.agent_sessions(user_id);
alter table public.agent_sessions enable row level security;
drop policy if exists "Users manage own agent sessions" on public.agent_sessions;
create policy "Users manage own agent sessions" on public.agent_sessions
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.agent_sessions(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  sender text not null check (sender in ('user', 'saral', 'system')),
  role text default 'user' check (role in ('user', 'assistant', 'system')),
  content text not null,
  proposal_id uuid references public.proposals(id) on delete set null,
  created_at timestamptz default timezone('utc', now()) not null
);
create index if not exists idx_agent_messages_session on public.agent_messages(session_id);
alter table public.agent_messages enable row level security;
drop policy if exists "Users manage own agent messages" on public.agent_messages;
create policy "Users manage own agent messages" on public.agent_messages
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.tool_calls (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.agent_sessions(id) on delete cascade not null,
  message_id uuid references public.agent_messages(id) on delete cascade,
  tool_name text not null,
  parameters jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz default timezone('utc', now()) not null
);
create index if not exists idx_tool_calls_session on public.tool_calls(session_id);
alter table public.tool_calls enable row level security;
drop policy if exists "Users view own tool calls" on public.tool_calls;
create policy "Users view own tool calls" on public.tool_calls
  for select to authenticated
  using (exists (select 1 from public.agent_sessions s where s.id = tool_calls.session_id and s.user_id = auth.uid()));

-- -------------------------------------------------------------------------
-- 8. FUNCTIONS: COMMITTED SPENDING CALCULATION (Security Definer)
-- -------------------------------------------------------------------------
create or replace function public.committed_today_minor(user_uuid uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  total_committed integer;
begin
  select coalesce(sum(amount_minor), 0)
  into total_committed
  from public.payments
  where user_id = user_uuid
    and status in ('authorized', 'captured')
    and created_at >= date_trunc('day', timezone('utc', now()));

  return total_committed;
end;
$$;

revoke execute on function public.committed_today_minor(uuid) from public;
grant execute on function public.committed_today_minor(uuid) to authenticated, service_role;

-- -------------------------------------------------------------------------
-- 9. SEED CANONICAL MINI-APPS & MERCHANTS (Idempotent)
-- -------------------------------------------------------------------------
insert into public.miniapps (id, title, slug, icon, category, description, display_order)
values
  ('cinema', 'Cinema & IMAX', 'cinema', 'cards', 'Entertainment', 'Book cinema tickets with real-time 6x6 curved seating matrix selection.', 1),
  ('powerbank', 'Portable Power Bank', 'powerbank', 'power-bank', 'Mobility & Hardware', 'Pre-authorization deposit hold protocol with automatic duration settlement.', 2),
  ('recharge', 'Mobile Recharge', 'recharge', 'apps', 'Telecommunications', 'Prepaid top-ups, high-speed 5G data packs, and international roaming.', 3),
  ('ev', 'EV Rapid Charging', 'ev', 'power-bank', 'Energy & Mobility', 'Pre-authorized kWh charging sessions with automatic metered capture.', 4),
  ('utilities', 'Utility Bills', 'utilities', 'shop', 'Municipal Services', 'Electricity, water, gas, and broadband bill consolidation.', 5),
  ('food', 'Food Ordering', 'food', 'cards', 'Dining & Delivery', 'Artisanal local eateries, real-time cart breakdown, and contactless delivery.', 6)
on conflict (id) do update set
  title = excluded.title,
  description = excluded.description,
  category = excluded.category,
  display_order = excluded.display_order;

insert into public.merchants (id, miniapp_id, name, rating, is_verified)
values
  ('a0000000-0000-0000-0000-000000000001', 'cinema', 'Grand Cineplex IMAX', 4.95, true),
  ('a0000000-0000-0000-0000-000000000002', 'powerbank', 'VoltCharge Networks Inc', 4.88, true),
  ('a0000000-0000-0000-0000-000000000003', 'recharge', 'Airtel Telecom Global', 4.90, true),
  ('a0000000-0000-0000-0000-000000000004', 'ev', 'ElectraDrive Supercharger', 4.92, true),
  ('a0000000-0000-0000-0000-000000000005', 'utilities', 'CleanPower Regional Municipal', 4.80, true),
  ('a0000000-0000-0000-0000-000000000006', 'food', 'Artisan Trattoria & Cafe', 4.94, true)
on conflict (id) do nothing;

