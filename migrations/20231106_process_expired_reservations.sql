-- Migration: Process expired reservations atomically

create or replace function public.process_expired_reservations()
returns jsonb language plpgsql security definer as $$
declare
  rec record;
  batch_size int := 100;
  processed int := 0;
  failed int := 0;
begin
  loop
    -- Select a batch of active expired reservations and lock them
    for rec in
      select * from public.inventory_reservations
      where status = 'active' and expires_at < timezone('utc', now())
      order by expires_at
      limit batch_size
      for update skip locked
    loop
      begin
        -- Restore inventory
        update public.inventory_items
          set quantity = quantity + rec.quantity
          where id = rec.inventory_item_id;
        -- Mark reservation as expired
        update public.inventory_reservations
          set status = 'expired', expired_at = timezone('utc', now())
          where id = rec.id;
        processed := processed + 1;
      exception
        when others then
          failed := failed + 1;
          -- continue with next reservation
      end;
    end loop;
    exit when not found;
  end loop;
  return jsonb_build_object('processed', processed, 'failed', failed);
exception
  when others then
    raise;
end;
$$;

grant execute on function public.process_expired_reservations() to authenticated;

