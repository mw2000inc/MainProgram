-- Stop creating Filter Change and Collection visits automatically (the
-- owner's decision, Oct 27 2026): visits exist only when someone enters
-- them — on the Daily Report, the Filter Change / Collection pages, the
-- Release Slip — like AppSheet. The recurring plan the system wrote ahead
-- (every 3 / 6 / 12 months, up to 2 years) is removed separately, after this
-- runs (backed up first).
--
-- 1. The Sale List no longer writes an order's recurring visits when it's
--    saved (trg_sync_filter_change_schedule, trg_sync_collection_schedule).
-- 2. The nightly "keep 2 years filled" step adds nothing any more
--    (extend_filter_change_schedule_window / extend_collection_schedule_
--    window now return no rows). Same names and results shape, so the cron
--    and Automations page keep working and just report 0.
--
-- The functions that built the plan (sync_filter_change_schedule,
-- sync_collection_schedule) are left in place but unused, so this is easy to
-- reverse by re-creating the two triggers.
--
-- Running this changes no rows.

drop trigger if exists trg_sync_filter_change_schedule on public.sale_list_entries;
drop trigger if exists trg_sync_collection_schedule on public.sale_list_entries;

create or replace function public.extend_filter_change_schedule_window()
returns table (out_sale_list_entry_id uuid, out_occurrences_added integer)
language plpgsql
security definer set search_path = public
as $$
begin
  -- Automatic Filter Change visits are switched off (20261128000000).
  return;
end;
$$;

create or replace function public.extend_collection_schedule_window()
returns table (out_sale_list_entry_id uuid, out_occurrences_added integer)
language plpgsql
security definer set search_path = public
as $$
begin
  -- Automatic Collection visits are switched off (20261128000000).
  return;
end;
$$;
