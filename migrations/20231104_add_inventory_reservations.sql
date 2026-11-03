-- Migration: Add inventory_reservations table and reservation RPC
-- Ensure directory exists; this file will be used with Supabase db push.

create table if not exists public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  expires_at timestamptz not null,
  created_at timestamptz default timezone('utc', now()) not null,
  updated_at timestamptz default timezone('utc', now()) not null
);

create index if not exists idx_inventory_reservations_order on public.inventory_reservations(order_id);
create index if not exists idx_inventory_reservations_item on public.inventory_reservations(inventory_item_id);

alter table public.inventory_reservations enable row level security;

create policy "Business can view own reservations"
  on public.inventory_reservations for select to authenticated
  using (auth.uid() = (select business_id from public.orders where id = order_id));

create policy "Business can insert own reservations"
  on public.inventory_reservations for insert to authenticated
  with check (auth.uid() = (select business_id from public.orders where id = order_id));

create policy "Business can update own reservations"
  on public.inventory_reservations for update to authenticated
  using (auth.uid() = (select business_id from public.orders where id = order_id))
  with check (auth.uid() = (select business_id from public.orders where id = order_id));

create policy "Business can delete own reservations"
  on public.inventory_reservations for delete to authenticated
  using (auth.uid() = (select business_id from public.orders where id = order_id));

-- Trigger to keep updated_at in sync (reusing existing function)
create trigger set_inventory_reservations_updated_at
  before update on public.inventory_reservations
  for each row execute function public.handle_updated_at();

-- RPC function to reserve stock atomically
create or replace function public.reserve_stock_atomic(p_order_id uuid, p_items jsonb)
returns jsonb language plpgsql security definer as $$
declare
  v_item jsonb;
  v_inventory_id uuid;
  v_quantity int;
  v_current_qty int;
  v_reservation_id uuid;
  v_expires timestamptz := timezone('utc', now()) + interval '15 minutes';
begin
  -- Verify order belongs to the caller
  if (select business_id from public.orders where id = p_order_id) <> auth.uid() then
    raise exception 'Order does not belong to authenticated business';
  end if;

  -- Process each reservation item
  foreach v_item in select * from jsonb_array_elements(p_items) loop
    v_inventory_id := (v_item->>'inventory_item_id')::uuid;
    v_quantity := (v_item->>'quantity')::int;

    if v_quantity <= 0 then
      raise exception 'Quantity must be positive';
    end if;

    -- Lock inventory row
    select quantity into v_current_qty from public.inventory_items
      where id = v_inventory_id
      for update;

    if not found then
      raise exception 'Inventory item % not found', v_inventory_id;
    end if;

    if v_current_qty < v_quantity then
      raise exception 'Insufficient stock for inventory item %: available %, requested %',
        v_inventory_id, v_current_qty, v_quantity;
    end if;

    -- Decrement stock (reservation holds the stock)
    update public.inventory_items set quantity = quantity - v_quantity where id = v_inventory_id;

    -- Insert reservation record
    insert into public.inventory_reservations (
      order_id, inventory_item_id, quantity, expires_at
    ) values (
      p_order_id, v_inventory_id, v_quantity, v_expires
    ) returning id into v_reservation_id;
  end loop;

  return jsonb_build_object('status','reserved','order_id',p_order_id);
exception
  when others then
    raise; -- transaction will rollback automatically
end;
$$;

-- Grant execute to authenticated role
grant execute on function public.reserve_stock_atomic(uuid, jsonb) to authenticated;

