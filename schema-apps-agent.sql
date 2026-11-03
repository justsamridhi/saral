-- =========================================================================
-- SARAL — Personal Mini-App Ecosystem & AI Agent Schema
-- Milestone 2: Catalog, Quotes, 6 Mini-App Services & Ask SARAL Agent Engine
-- =========================================================================

-- Enable uuid-ossp if not already enabled
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- 1. Mini-Apps Registry Table
create table if not exists public.miniapps (
  id text primary key, -- 'cinema', 'powerbank', 'recharge', 'ev', 'utilities', 'food'
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

-- 2. Merchants Table
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

-- 3. Catalog Items Table (All prices in integer minor units / cents)
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

-- 4. User Mini-App Usage (Tracks connected apps & last used time)
create table if not exists public.user_miniapps (
  user_id uuid references auth.users(id) on delete cascade not null,
  miniapp_id text references public.miniapps(id) on delete cascade not null,
  usage_count integer default 1,
  last_used_at timestamptz default timezone('utc', now()) not null,
  primary key (user_id, miniapp_id)
);

create index if not exists idx_user_miniapps_user on public.user_miniapps(user_id);

-- 5. Quotes Table (Server-generated, tamper-resistant HMAC payload_hash)
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

-- 6. Mini-App Specific Service Ledger Tables

-- 6a. Cinema Bookings
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

-- 6b. Power Bank Rentals (Pre-Auth Deposit Protocol)
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

-- 6c. Mobile Recharge Requests
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

-- 6d. EV Charging Sessions (Pre-Auth Hold Protocol)
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

-- 6e. Utility Bill Payments
create table if not exists public.utility_payments (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid references public.proposals(id) on delete set null,
  user_id uuid references auth.users(id) on delete cascade not null,
  provider_name text not null,
  account_number text not null,
  bill_type text not null, -- 'electricity', 'water', 'gas', 'broadband'
  amount_minor integer not null,
  receipt_number text,
  status text default 'paid' check (status in ('pending', 'paid', 'failed')),
  created_at timestamptz default timezone('utc', now()) not null
);

create index if not exists idx_utilities_user on public.utility_payments(user_id);

-- 6f. Food Delivery Orders
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

-- 7. Ask SARAL Agent Engine Tables

-- 7a. Agent Sessions
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

-- 7b. Agent Messages
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

-- 7c. Tool Calls
create table if not exists public.tool_calls (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.agent_sessions(id) on delete cascade not null,
  message_id uuid references public.agent_messages(id) on delete cascade,
  tool_name text not null check (tool_name in ('search_catalog', 'get_availability', 'get_quote', 'create_proposal')),
  parameters jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz default timezone('utc', now()) not null
);

create index if not exists idx_tool_calls_session on public.tool_calls(session_id);

-- =========================================================================
-- 8. ROW LEVEL SECURITY (RLS) POLICIES
-- =========================================================================

alter table public.miniapps enable row level security;
alter table public.merchants enable row level security;
alter table public.catalog_items enable row level security;
alter table public.user_miniapps enable row level security;
alter table public.quotes enable row level security;
alter table public.cinema_bookings enable row level security;
alter table public.power_bank_rentals enable row level security;
alter table public.recharge_requests enable row level security;
alter table public.ev_charging_sessions enable row level security;
alter table public.utility_payments enable row level security;
alter table public.food_orders enable row level security;
alter table public.agent_sessions enable row level security;
alter table public.agent_messages enable row level security;
alter table public.tool_calls enable row level security;

-- Public read for catalog, mini-apps and merchants
drop policy if exists "Anyone can read miniapps" on public.miniapps;
create policy "Anyone can read miniapps" on public.miniapps for select using (true);

drop policy if exists "Anyone can read merchants" on public.merchants;
create policy "Anyone can read merchants" on public.merchants for select using (true);

drop policy if exists "Anyone can read catalog items" on public.catalog_items;
create policy "Anyone can read catalog items" on public.catalog_items for select using (true);

-- User-scoped policies
drop policy if exists "Users can manage own user_miniapps" on public.user_miniapps;
create policy "Users can manage own user_miniapps" on public.user_miniapps
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own quotes" on public.quotes;
create policy "Users can manage own quotes" on public.quotes
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can view own cinema bookings" on public.cinema_bookings;
create policy "Users can view own cinema bookings" on public.cinema_bookings
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users can view own power bank rentals" on public.power_bank_rentals;
create policy "Users can view own power bank rentals" on public.power_bank_rentals
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users can view own recharge requests" on public.recharge_requests;
create policy "Users can view own recharge requests" on public.recharge_requests
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users can view own ev charging sessions" on public.ev_charging_sessions;
create policy "Users can view own ev charging sessions" on public.ev_charging_sessions
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users can view own utility payments" on public.utility_payments;
create policy "Users can view own utility payments" on public.utility_payments
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users can view own food orders" on public.food_orders;
create policy "Users can view own food orders" on public.food_orders
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users can manage own agent sessions" on public.agent_sessions;
create policy "Users can manage own agent sessions" on public.agent_sessions
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own agent messages" on public.agent_messages;
create policy "Users can manage own agent messages" on public.agent_messages
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can view own tool calls" on public.tool_calls;
create policy "Users can view own tool calls" on public.tool_calls
  for select to authenticated
  using (exists (select 1 from public.agent_sessions s where s.id = tool_calls.session_id and s.user_id = auth.uid()));

-- =========================================================================
-- 9. DETERMINISTIC SEED DATA (Idempotent upsert for all 6 Mini-Apps)
-- =========================================================================

-- Mini-Apps
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

-- Merchants
insert into public.merchants (id, miniapp_id, name, rating, is_verified)
values
  ('a0000000-0000-0000-0000-000000000001', 'cinema', 'Grand Cineplex IMAX', 4.95, true),
  ('a0000000-0000-0000-0000-000000000002', 'powerbank', 'VoltCharge Networks Inc', 4.88, true),
  ('a0000000-0000-0000-0000-000000000003', 'recharge', 'Airtel Telecom Global', 4.90, true),
  ('a0000000-0000-0000-0000-000000000004', 'ev', 'ElectraDrive Supercharger', 4.92, true),
  ('a0000000-0000-0000-0000-000000000005', 'utilities', 'CleanPower Regional Municipal', 4.80, true),
  ('a0000000-0000-0000-0000-000000000006', 'food', 'Artisan Trattoria & Cafe', 4.94, true)
on conflict (id) do nothing;

-- Catalog Items
insert into public.catalog_items (id, miniapp_id, merchant_id, title, category, price_minor, currency, stock_qty, metadata)
values
  -- Cinema
  ('c0000000-0000-0000-0000-000000000001', 'cinema', 'a0000000-0000-0000-0000-000000000001', 'Dune: Part Two (IMAX Laser)', 'Standard Ticket', 1825, 'USD', 36, '{"duration": "2h 46m", "screen": "Screen 4 IMAX", "showtime": "20:00"}'::jsonb),
  ('c0000000-0000-0000-0000-000000000002', 'cinema', 'a0000000-0000-0000-0000-000000000001', 'Interstellar 10th Anniversary (70mm IMAX)', 'Standard Ticket', 2150, 'USD', 36, '{"duration": "2h 49m", "screen": "Screen 1 IMAX", "showtime": "21:30"}'::jsonb),
  
  -- Power Bank
  ('c0000000-0000-0000-0000-000000000003', 'powerbank', 'a0000000-0000-0000-0000-000000000002', 'VoltCharge Portable Unit (Station #14)', 'Rental Deposit Hold', 1800, 'USD', 12, '{"rate_per_hour_minor": 150, "location": "Central Metro Station, Hall B"}'::jsonb),
  
  -- Mobile Recharge
  ('c0000000-0000-0000-0000-000000000004', 'recharge', 'a0000000-0000-0000-0000-000000000003', 'Airtel Unlimited 5G Data Pack (84 Days)', 'Prepaid Plan', 2499, 'USD', 9999, '{"data": "2.5GB/day", "validity_days": 84, "voice": "Unlimited"}'::jsonb),
  ('c0000000-0000-0000-0000-000000000005', 'recharge', 'a0000000-0000-0000-0000-000000000003', 'Airtel Super Saver 5G (28 Days)', 'Prepaid Plan', 999, 'USD', 9999, '{"data": "1.5GB/day", "validity_days": 28, "voice": "Unlimited"}'::jsonb),
  
  -- EV Charging
  ('c0000000-0000-0000-0000-000000000006', 'ev', 'a0000000-0000-0000-0000-000000000004', 'ElectraDrive DC Fast 150kW (Pre-Auth)', 'Charging Session Hold', 4000, 'USD', 8, '{"rate_per_kwh_minor": 42, "connector": "CCS2", "location": "West Downtown Hub"}'::jsonb),
  
  -- Utility Bills
  ('c0000000-0000-0000-0000-000000000007', 'utilities', 'a0000000-0000-0000-0000-000000000005', 'CleanPower Municipal Electricity Invoice', 'Electricity Bill', 8420, 'USD', 1, '{"account": "8819-2041", "due_date": "2026-11-10", "kwh": 340}'::jsonb),
  ('c0000000-0000-0000-0000-000000000008', 'utilities', 'a0000000-0000-0000-0000-000000000005', 'Metropolitan Fiber Broadband 1Gbps', 'Broadband Bill', 5999, 'USD', 1, '{"account": "FIBER-9921", "due_date": "2026-11-15", "speed": "1 Gbps"}'::jsonb),

  -- Food Ordering
  ('c0000000-0000-0000-0000-000000000009', 'food', 'a0000000-0000-0000-0000-000000000006', 'Wood-Fired Truffle Margherita Pizza', 'Main', 1850, 'USD', 50, '{"prep_time": "20 mins", "dietary": "Vegetarian"}'::jsonb),
  ('c0000000-0000-0000-0000-000000000010', 'food', 'a0000000-0000-0000-0000-000000000006', 'Handmade Burrata & Heirloom Tomato Salad', 'Appetizer', 1200, 'USD', 30, '{"prep_time": "10 mins", "dietary": "Vegetarian"}'::jsonb),
  ('c0000000-0000-0000-0000-000000000011', 'food', 'a0000000-0000-0000-0000-000000000006', 'Classic Tiramisu al Mascarpone', 'Dessert', 850, 'USD', 25, '{"prep_time": "5 mins", "dietary": "Contains Dairy"}'::jsonb)
on conflict (id) do nothing;

