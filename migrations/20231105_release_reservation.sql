-- Migration: Release reservation atomically

create or replace function public.release_reservation_atomic(p_reservation_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_reservation record;
begin
  -- Lock reservation row
  select * into v_reservation from public.inventory_reservations
    where id = p_reservation_id and status = 'active'
    for update;

  if not found then
    raise exception 'Active reservation % not found', p_reservation_id;
  end if;

  -- Restore inventory stock only once
  update public.inventory_items
    set quantity = quantity + v_reservation.quantity
    where id = v_reservation.inventory_item_id;

  -- Mark reservation as released with timestamp
  update public.inventory_reservations
    set status = 'released', released_at = timezone('utc', now())
    where id = p_reservation_id;

  return jsonb_build_object('status','released','reservation_id',p_reservation_id);
exception
  when others then
    raise;
end;
$$;

grant execute on function public.release_reservation_atomic(uuid) to authenticated;


create or replace function public.release_reservation_atomic(p_reservation_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_reservation record;
  v_updated boolean := false;
begin
  -- Lock reservation row
  select * into v_reservation from public.inventory_reservations
    where id = p_reservation_id
    for update;

  if not found then
    raise exception 'Reservation % not found', p_reservation_id;
  end if;

  -- Restore inventory stock
  update public.inventory_items
    set quantity = quantity + v_reservation.quantity
    where id = v_reservation.inventory_item_id;

  -- Delete reservation
  delete from public.inventory_reservations where id = p_reservation_id;

  return jsonb_build_object('status','released','reservation_id',p_reservation_id);
exception
  when others then
    raise;
end;
$$;

grant execute on function public.release_reservation_atomic(uuid) to authenticated;

