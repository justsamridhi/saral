-- =============================================================
-- SARAL Business Workspace Additional Schema
-- =============================================================

-- -------------------------------------------------------------
-- Inventory Management
-- -------------------------------------------------------------
create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.profiles(id) on delete cascade,
  name text not null,
  description text,
  sku text unique,
  category text,
  brand text,
  model text,
  condition text,
  image_url text,
  quantity integer not null default 0 check (quantity >= 0),
  cost_price numeric(12,2) not null check (cost_price >= 0),
  target_price numeric(12,2) not null check (target_price >= 0),
  minimum_price numeric(12,2) check (minimum_price >= 0),
  currency text default 'USD',
  storage_location text,
  listing_status text default 'draft' check (listing_status in ('draft','listed','archived')),
  created_at timestamptz default timezone('utc', now()) not null,
  updated_at timestamptz default timezone('utc', now()) not null
);

create index if not exists idx_inventory_items_business on public.inventory_items(business_id);
create index if not exists idx_inventory_items_sku on public.inventory_items(sku);

-- Row Level Security for inventory
alter table public.inventory_items enable row level security;

create policy "Business can view own inventory"
  on public.inventory_items for select to authenticated
  using (auth.uid() = business_id);

create policy "Business can insert own inventory"
  on public.inventory_items for insert to authenticated
  with check (auth.uid() = business_id);

create policy "Business can update own inventory"
  on public.inventory_items for update to authenticated
  using (auth.uid() = business_id)
  with check (auth.uid() = business_id);

create policy "Business can delete own inventory"
  on public.inventory_items for delete to authenticated
  using (auth.uid() = business_id);

-- -------------------------------------------------------------
-- Buyers Management
-- -------------------------------------------------------------
create table if not exists public.buyers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.profiles(id) on delete cascade,
  name text not null,
  email text,
  preferred_category text,
  budget_range text,
  notes text,
  created_at timestamptz default timezone('utc', now()) not null,
  updated_at timestamptz default timezone('utc', now()) not null
);

create index if not exists idx_buyers_business on public.buyers(business_id);
create index if not exists idx_buyers_email on public.buyers(email);

alter table public.buyers enable row level security;

create policy "Business can view own buyers" on public.buyers for select to authenticated using (auth.uid() = business_id);
create policy "Business can insert own buyers" on public.buyers for insert to authenticated with check (auth.uid() = business_id);
create policy "Business can update own buyers" on public.buyers for update to authenticated using (auth.uid() = business_id) with check (auth.uid() = business_id);
create policy "Business can delete own buyers" on public.buyers for delete to authenticated using (auth.uid() = business_id);

-- -------------------------------------------------------------
-- Orders and Payments (extend existing tables if any)
-- -------------------------------------------------------------
-- Assuming existing tables: orders, order_items, payments exist. If not, create minimal versions.

-- Orders
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.profiles(id) on delete cascade,
  buyer_id uuid references public.buyers(id),
  status text default 'draft' check (status in ('draft','awaiting_payment','authorized','paid','partially_refunded','refunded','cancelled','failed','fulfilled')),
  total_amount_minor integer not null check (total_amount_minor >= 0),
  currency text default 'USD',
  created_at timestamptz default timezone('utc', now()) not null,
  updated_at timestamptz default timezone('utc', now()) not null
);
create index if not exists idx_orders_business on public.orders(business_id);
alter table public.orders enable row level security;
create policy "Business can view own orders" on public.orders for select to authenticated using (auth.uid() = business_id);
create policy "Business can insert own orders" on public.orders for insert to authenticated with check (auth.uid() = business_id);
create policy "Business can update own orders" on public.orders for update to authenticated using (auth.uid() = business_id) with check (auth.uid() = business_id);
create policy "Business can delete own orders" on public.orders for delete to authenticated using (auth.uid() = business_id);

-- Order Items
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id),
  quantity integer not null check (quantity > 0),
  unit_price_minor integer not null check (unit_price_minor >= 0),
  created_at timestamptz default timezone('utc', now()) not null,
  updated_at timestamptz default timezone('utc', now()) not null
);
create index if not exists idx_order_items_order on public.order_items(order_id);
alter table public.order_items enable row level security;
create policy "Business can view own order items" on public.order_items for select to authenticated using (auth.uid() = (select business_id from public.orders where id = order_id));
create policy "Business can insert own order items" on public.order_items for insert to authenticated with check (auth.uid() = (select business_id from public.orders where id = order_id));
create policy "Business can update own order items" on public.order_items for update to authenticated using (auth.uid() = (select business_id from public.orders where id = order_id)) with check (auth.uid() = (select business_id from public.orders where id = order_id));
create policy "Business can delete own order items" on public.order_items for delete to authenticated using (auth.uid() = (select business_id from public.orders where id = order_id));

-- Payments (extend existing if needed)
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.profiles(id) on delete cascade,
  order_id uuid references public.orders(id),
  authorization_id text,
  capture_id text,
  refund_id text,
  amount_minor integer not null check (amount_minor >= 0),
  currency text default 'USD',
  status text default 'pending' check (status in ('pending','authorized','captured','refunded','voided','failed')),
  created_at timestamptz default timezone('utc', now()) not null,
  updated_at timestamptz default timezone('utc', now()) not null
);
create index if not exists idx_payments_business on public.payments(business_id);
alter table public.payments enable row level security;
create policy "Business can view own payments" on public.payments for select to authenticated using (auth.uid() = business_id);
create policy "Business can insert own payments" on public.payments for insert to authenticated with check (auth.uid() = business_id);
create policy "Business can update own payments" on public.payments for update to authenticated using (auth.uid() = business_id) with check (auth.uid() = business_id);
create policy "Business can delete own payments" on public.payments for delete to authenticated using (auth.uid() = business_id);

-- -------------------------------------------------------------
-- Triggers to keep updated_at in sync
-- -------------------------------------------------------------
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create trigger set_inventory_updated_at before update on public.inventory_items for each row execute function public.handle_updated_at();
create trigger set_buyers_updated_at before update on public.buyers for each row execute function public.handle_updated_at();
create trigger set_orders_updated_at before update on public.orders for each row execute function public.handle_updated_at();
create trigger set_order_items_updated_at before update on public.order_items for each row execute function public.handle_updated_at();
create trigger set_payments_updated_at before update on public.payments for each row execute function public.handle_updated_at();

-- =============================================================
-- End of Business Schema
-- =============================================================
