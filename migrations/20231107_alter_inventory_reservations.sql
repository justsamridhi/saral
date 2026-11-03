-- Migration: Add status and timestamps to inventory_reservations

alter table public.inventory_reservations
  add column status text default 'active' check (status in ('active','released','expired')),
  add column released_at timestamptz,
  add column expired_at timestamptz;

-- Update existing rows to have status 'active' if null (safety)
update public.inventory_reservations set status = 'active' where status is null;

-- Create index on status for efficient queries
create index if not exists idx_inventory_reservations_status on public.inventory_reservations(status);

