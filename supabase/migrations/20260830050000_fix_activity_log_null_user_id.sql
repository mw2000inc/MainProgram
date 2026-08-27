-- Fixes a second signup-breaking bug, found via the actual Postgres log
-- (not guesswork this time): 'null value in column "user_id" of relation
-- "activity_logs" violates not-null constraint', thrown from inside
-- log_audit_event()'s own insert, during the trg_audit_log trigger that
-- fires when handle_new_user() inserts the new profiles row.
--
-- During a public self-signup there is no authenticated session yet
-- (auth.uid() is null) and a fresh signup never sets updated_by either, so
-- user_id's existing fallback chain — coalesce(auth.uid(), updated_by) —
-- resolves to NULL. The audit_logging migration already anticipated
-- exactly this ("an audit entry that ends up with no attributable user in
-- some edge case not yet anticipated must never be able to fail its
-- INSERT") and included `alter table activity_logs alter column user_id
-- drop not null` for it — but the live database still has it NOT NULL, so
-- that statement evidently never took effect. Two independent fixes below,
-- neither relying on the other:
--
-- 1. Re-assert the nullable column. Safe to run again even if it somehow
--    did already apply elsewhere (dropping an already-dropped NOT NULL is
--    a no-op, not an error).
-- 2. Give user_id one more fallback — the affected row's own id — so a
--    profiles insert with no other attributable actor (self-signup being
--    the one real case) gets a real value instead of NULL at all, rather
--    than depending on the column being nullable. Uses the jsonb value
--    already computed above (v_full_new/v_full_old), not NEW.id directly,
--    for the same reason the rest of this function does: it has to work
--    generically across instrumented tables that don't have an `id` column
--    at all (daily_report_sections uses section_key).
-- Also wraps just the insert itself in its own exception block — a second,
-- more narrowly-scoped safety net directly around the one statement that
-- actually failed, independent of the existing outer one, in case there
-- was ever any doubt about it catching this specific failure.

alter table public.activity_logs alter column user_id drop not null;

create or replace function public.log_audit_event()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_full_old jsonb;
  v_full_new jsonb;
  v_diff_old jsonb := '{}'::jsonb;
  v_diff_new jsonb := '{}'::jsonb;
  v_entity_id text;
  v_description text;
  v_user_id uuid;
begin
  -- Everything below is best-effort: an audit-logging bug must never be able
  -- to block or roll back the real data write that triggered it (an AFTER
  -- trigger's exception fails the whole original statement otherwise). Any
  -- unexpected error here is swallowed and the write proceeds unaudited
  -- rather than failing.
  begin

  if TG_OP in ('UPDATE', 'DELETE') then
    v_full_old := to_jsonb(OLD);
  end if;
  if TG_OP in ('INSERT', 'UPDATE') then
    v_full_new := to_jsonb(NEW);
  end if;

  if TG_OP = 'UPDATE' then
    select coalesce(jsonb_object_agg(o.key, o.value), '{}'::jsonb) into v_diff_old
      from jsonb_each(v_full_old) o join jsonb_each(v_full_new) n on o.key = n.key
      where o.value is distinct from n.value;
    select coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb) into v_diff_new
      from jsonb_each(v_full_new) n join jsonb_each(v_full_old) o on o.key = n.key
      where o.value is distinct from n.value;
    -- Nothing actually changed (e.g. a form saved with no real edits) —
    -- skip logging noise rather than writing an empty-diff entry.
    if v_diff_new = '{}'::jsonb then
      return NEW;
    end if;
  elsif TG_OP = 'INSERT' then
    v_diff_new := v_full_new;
  elsif TG_OP = 'DELETE' then
    v_diff_old := v_full_old;
  end if;

  v_entity_id := coalesce(v_full_new ->> 'id', v_full_old ->> 'id', v_full_new ->> 'section_key', v_full_old ->> 'section_key');

  -- A short, human-readable label for the "Record" column of the Admin
  -- Activity page — pulled from the FULL row (not the diff above), since an
  -- update to an unrelated field shouldn't make the record unidentifiable.
  v_description := case TG_TABLE_NAME
    when 'customers' then coalesce(nullif(coalesce(v_full_new, v_full_old) ->> 'company_name', ''), coalesce(v_full_new, v_full_old) ->> 'full_name')
    when 'sales' then coalesce(v_full_new, v_full_old) ->> 'invoice_number'
    when 'schedule_jobs' then coalesce(nullif(coalesce(v_full_new, v_full_old) ->> 'order_no', ''), 'Schedule Job')
    when 'install_plans' then coalesce(nullif(coalesce(v_full_new, v_full_old) ->> 'order_no', ''), coalesce(v_full_new, v_full_old) ->> 'name')
    when 'filter_change_plans' then coalesce(v_full_new, v_full_old) ->> 'order_number'
    when 'collections' then coalesce(v_full_new, v_full_old) ->> 'order_no'
    when 'repair_plans' then coalesce(v_full_new, v_full_old) ->> 'order_no'
    when 'products' then coalesce(nullif(coalesce(v_full_new, v_full_old) ->> 'name', ''), coalesce(v_full_new, v_full_old) ->> 'sku')
    when 'suppliers' then coalesce(v_full_new, v_full_old) ->> 'name'
    when 'stock_movements' then 'Stock Movement'
    when 'company_settings' then 'Company Settings'
    when 'announcements' then coalesce(v_full_new, v_full_old) ->> 'title'
    when 'profiles' then coalesce(v_full_new, v_full_old) ->> 'name'
    when 'daily_report_sections' then coalesce(v_full_new, v_full_old) ->> 'label'
    when 'sale_list_entries' then coalesce(v_full_new, v_full_old) ->> 'order_number'
    when 'cp_systems' then coalesce(v_full_new, v_full_old) ->> 'system_code'
    else TG_TABLE_NAME
  end;

  -- Same coalesce fallback as set_audit_columns(), and for the same reason
  -- (the admin-users route's service-role follow-up update) — by the time
  -- this AFTER trigger runs, NEW.updated_by has already been set correctly
  -- by that BEFORE trigger, so falling back to it here keeps the audit
  -- entry attributed to the right admin instead of showing user_id null.
  -- One further fallback beyond that: the row's own id, so a row with no
  -- other attributable actor at all (a public self-signup inserting its own
  -- profiles row, before any session exists) still gets a real value
  -- instead of relying solely on the column being nullable.
  v_user_id := coalesce(
    auth.uid(),
    (coalesce(v_full_new, v_full_old) ->> 'updated_by')::uuid,
    (coalesce(v_full_new, v_full_old) ->> 'id')::uuid
  );

  begin
    insert into public.activity_logs (user_id, action, entity_type, entity_id, description, old_values, new_values, date, time)
    values (
      v_user_id,
      lower(TG_OP),
      TG_TABLE_NAME,
      v_entity_id,
      v_description,
      v_diff_old,
      v_diff_new,
      (now() at time zone 'utc')::date,
      to_char(now() at time zone 'utc', 'HH24:MI')
    );
  exception when others then
    null; -- narrower safety net directly around the insert itself
  end;

  exception when others then
    null; -- swallow — see the comment above this nested block
  end;

  return coalesce(NEW, OLD);
end;
$$;
