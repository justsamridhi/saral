-- =========================================================================
-- SARAL — Production Payment, Proposals & Trust Gate Database Schema
-- Milestone 2: PayPal Authorization, Audit Ledger & Spending Guardrails
-- =========================================================================

-- Enable uuid-ossp if needed
create extension if not exists "uuid-ossp";

-- 1. Proposals Table
-- Stores AI/Service transaction proposals requiring explicit user approval
create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  service_type text not null check (service_type in ('cinema', 'powerbank', 'recharge', 'ev', 'utilities', 'food', 'reseller', 'custom')),
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

-- 2. Payments Table
-- Tracks PayPal Orders, Authorizations, Captures and Voids with Integer Minor Units
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

-- 3. Webhook Events Table
-- Guaranteed Idempotency for PayPal Webhook Events
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

-- 4. Audit Events Table
-- Tamper-resistant append-only ledger for all Trust Gate and AI assistant decisions
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

-- 5. Daily Spending Calculation Function (UTC Boundaries & Integer Minor Units)
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

-- 6. Updated_at Triggers
drop trigger if exists set_proposals_updated_at on public.proposals;
create trigger set_proposals_updated_at
  before update on public.proposals
  for each row execute function public.handle_updated_at();

drop trigger if exists set_payments_updated_at on public.payments;
create trigger set_payments_updated_at
  before update on public.payments
  for each row execute function public.handle_updated_at();

-- 7. Row Level Security (RLS) Configuration

alter table public.proposals enable row level security;
alter table public.payments enable row level security;
alter table public.webhook_events enable row level security;
alter table public.audit_events enable row level security;

-- Proposals RLS Policies: Authenticated users can view, create, and update their own proposals
drop policy if exists "Users can view own proposals" on public.proposals;
create policy "Users can view own proposals"
  on public.proposals for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own proposals" on public.proposals;
create policy "Users can insert own proposals"
  on public.proposals for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own proposals" on public.proposals;
create policy "Users can update own proposals"
  on public.proposals for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Payments RLS Policies: Authenticated users can view own payments. Writes handled by backend/service_role
drop policy if exists "Users can view own payments" on public.payments;
create policy "Users can view own payments"
  on public.payments for select
  to authenticated
  using (auth.uid() = user_id);

-- Webhook Events RLS: No public or authenticated user access (service_role only)
-- Default deny applies.

-- Audit Events RLS: Authenticated users can view own audit entries
drop policy if exists "Users can view own audit events" on public.audit_events;
create policy "Users can view own audit events"
  on public.audit_events for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Authenticated users can insert audit events" on public.audit_events;
create policy "Authenticated users can insert audit events"
  on public.audit_events for insert
  to authenticated
  with check (auth.uid() = user_id);

