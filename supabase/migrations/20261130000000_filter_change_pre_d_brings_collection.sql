-- A Filter Change given a Pre D brings the order's due Collection to the same
-- day, so both show on that day's Daily Report (and the technician collects
-- on that visit).
--
-- When a Pending Filter Change's Pre D is set or changed (any page — Filter
-- Change, Daily Report, Sale List…), the order's EARLIEST unpaid, not
-- cancelled Collection dated on or before Pre D + 31 days (overdue, or due
-- within a month) gets that Pre D too. A payment planned further ahead is
-- left alone, as is a Collection already on that day. Its schedule job, if
-- any, moves with it (sync_module_date_to_schedule_job, 20261025000000).
--
-- Running this changes no rows by itself: it adds one function and trigger
-- (it acts on the next Pre D set).

create or replace function public.filter_change_pre_d_brings_collection()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_order text := nullif(trim(coalesce(NEW.order_number, '')), '');
  v_collection uuid;
begin
  if NEW.pre_d is null or v_order is null or NEW.status <> 'Pending' then
    return null;
  end if;
  if TG_OP = 'UPDATE' and OLD.pre_d is not distinct from NEW.pre_d then
    return null;
  end if;

  select c.id into v_collection
  from public.collections c
  where trim(c.order_no) = v_order
    and c.status = 'Pending'
    and not coalesce(c.collected, false)
    and coalesce(c.pre_d, c.collection_date) <= NEW.pre_d + 31
  order by coalesce(c.pre_d, c.collection_date), c.created_at
  limit 1;

  if v_collection is not null then
    update public.collections
      set pre_d = NEW.pre_d
      where id = v_collection and pre_d is distinct from NEW.pre_d;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_filter_change_pre_d_brings_collection on public.filter_change_plans;
create trigger trg_filter_change_pre_d_brings_collection
  after insert or update of pre_d on public.filter_change_plans
  for each row execute function public.filter_change_pre_d_brings_collection();
