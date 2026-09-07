-- Fixes two real bugs in accept_requested_reschedule(), both found and
-- verified live during a full automation audit of this app (create a test
-- customer -> confirm -> customer requests reschedule -> admin accepts;
-- checked the actual resulting rows rather than assuming from the code).
--
-- =========================================================================
-- BUG #1 -- a duplicate schedule_jobs row on accept, instead of moving the
-- existing one.
--
-- find_or_create_schedule_job() looks for an existing *pending* job at the
-- NEW scheduled_date + order_no. The job actually linked to this record
-- (if one exists at all -- see the note below on when it doesn't) is still
-- sitting at the OLD date, so that lookup never matches, and a second,
-- unrelated schedule_jobs row gets inserted at the new date with no
-- technician assigned -- while the original, correctly-staffed row is
-- silently orphaned at the old date. Verified live: 1 schedule_jobs row
-- before accept, 2 after, technicians only on the stale one.
--
-- Fix: read the schedule_job_id already linked to this record (each of the
-- four dispatch tables has had this column since the
-- ct_filter_change_collection_inventory_link /
-- auto_create_schedule_job_on_confirm migrations) as part of the same
-- UPDATE...RETURNING that already reads everything else this function
-- needs. If one exists, UPDATE its scheduled_date/scheduled_time in place
-- -- deliberately touching only those two columns, so technician/
-- technician_2/technician_user_id/technician_2_user_id/status/notes are
-- left completely alone (a plain partial-column UPDATE never touches
-- columns outside its own SET list). Only when no job is linked yet
-- (the normal case for a record that went Pending Customer Confirmation
-- -> Reschedule Requested without ever having been plainly confirmed
-- first, since only a genuine 'confirm' ever creates the link) does this
-- fall through to the original find_or_create_schedule_job() call,
-- unchanged from before.
--
-- =========================================================================
-- BUG #2 -- dispatch_status silently reverts to 'Draft' instead of landing
-- on 'Confirmed'.
--
-- The single UPDATE statement set pre_d and dispatch_status together, but
-- reset_dispatch_status_on_pre_d_change (a BEFORE UPDATE trigger, see the
-- reschedule_request_with_date migration) fires whenever pre_d changes and
-- unconditionally forces dispatch_status back to 'Draft' whenever the
-- row's prior status was 'Pending Customer Confirmation' or
-- 'Reschedule Requested' -- overwriting this function's own
-- dispatch_status = 'Confirmed' in the very same statement, every time,
-- for every caller (the trigger has no notion of "which RPC is calling
-- me," by design -- see that migration's own comment on why it's
-- implemented as a blanket trigger rather than a per-call-site check).
-- Verified live via an isolated repro: starting from 'Reschedule
-- Requested' and updating pre_d + dispatch_status='Confirmed' in one
-- statement lands on dispatch_status='Draft'.
--
-- Fix chosen: Option A (split into two statements) over Option B (teach
-- the trigger to recognize this one caller). Checked the trigger
-- definition first, as asked, before picking: its WHEN clause is
-- `new.pre_d is distinct from old.pre_d` -- it only fires at all when
-- pre_d actually changes value in that specific statement. So a first
-- statement that changes only pre_d lets the trigger do exactly what it's
-- for (reset to Draft, clear the now-stale confirmation_token/expiry --
-- see that migration's own stated intent: "invalidate the stale token
-- outright, rather than leaving it silently pointing at a moved date"),
-- and a second statement that changes only dispatch_status (pre_d
-- unchanged in that statement) never fires the trigger at all, so its
-- 'Confirmed' sticks. This needs no change to the trigger itself, no
-- session-variable signaling between the two, and doesn't require the
-- trigger to ever learn which function is calling it -- strictly lower
-- risk than Option B, which would need to keep working correctly for
-- every other current and future caller of an UPDATE on these tables, not
-- just this one RPC.
--
-- Side effect worth noting, not a regression from this fix: because the
-- trigger clears confirmation_token/confirmation_token_expires_at during
-- the first statement (same as it always has, whether the caller notices
-- or not), out_confirmation_token from this function now genuinely comes
-- back null after an accept -- it already did before this fix too, since
-- the trigger runs regardless of what the caller's own second statement
-- (or lack of one) does. src/app/api/dispatch/accept-reschedule/route.ts's
-- own comment ("[the token] was never invalidated by the reschedule
-- request") predates this trigger's extension to cover 'Reschedule
-- Requested' and is no longer accurate -- the "you're confirmed" email
-- it sends will omit the confirmation-link button when this happens
-- (buildEmailContent already handles a missing confirmUrl gracefully,
-- see its own `if (confirmUrl)` guard). Not fixed here -- out of scope
-- for these two specific bugs, flagged for a separate decision on whether
-- to mint a fresh token in that route when accepting a reschedule.
create or replace function public.accept_requested_reschedule(
  p_entity_type text,
  p_entity_id uuid
)
returns table (
  out_ok boolean,
  out_label text,
  out_scheduled_date text,
  out_requested_time text,
  out_notify_phone text,
  out_notify_email text,
  out_confirmation_token uuid
)
language plpgsql
security definer set search_path = public
as $$
declare
  v_label text;
  v_scheduled_date text;
  v_requested_time text;
  v_notify_phone text;
  v_notify_email text;
  v_confirmation_token uuid;
  v_order_no text;
  v_customer_id uuid;
  v_existing_schedule_job_id uuid;
  v_job_type public.schedule_job_type;
  v_schedule_job_id uuid;
  v_updated integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only admins can accept a requested reschedule';
  end if;
  if p_entity_type not in ('filter_change_plans', 'install_plans', 'collections', 'repair_plans') then
    raise exception 'Unknown entity_type: %', p_entity_type;
  end if;

  -- Statement 1 of Bug #2's fix: only pre_d changes here (plus whatever
  -- the reset trigger itself does to dispatch_status/confirmation_token as
  -- a side effect) -- dispatch_status is deliberately NOT set in this
  -- statement.
  if p_entity_type = 'filter_change_plans' then
    update public.filter_change_plans
      set pre_d = requested_date
      where id = p_entity_id and dispatch_status = 'Reschedule Requested' and requested_date is not null
      returning coalesce(member_account, order_number), pre_d::text, requested_time, notify_phone, notify_email, confirmation_token, order_number, customer_id, schedule_job_id
      into v_label, v_scheduled_date, v_requested_time, v_notify_phone, v_notify_email, v_confirmation_token, v_order_no, v_customer_id, v_existing_schedule_job_id;
    v_job_type := 'filter_change';
  elsif p_entity_type = 'install_plans' then
    update public.install_plans
      set pre_installed_date = requested_date
      where id = p_entity_id and dispatch_status = 'Reschedule Requested' and requested_date is not null
      returning coalesce(name, order_no), pre_installed_date::text, requested_time, notify_phone, notify_email, confirmation_token, order_no, schedule_job_id
      into v_label, v_scheduled_date, v_requested_time, v_notify_phone, v_notify_email, v_confirmation_token, v_order_no, v_existing_schedule_job_id;
    v_job_type := 'installation';
  elsif p_entity_type = 'collections' then
    update public.collections
      set pre_d = requested_date
      where id = p_entity_id and dispatch_status = 'Reschedule Requested' and requested_date is not null
      returning coalesce(account_name, order_no), pre_d::text, requested_time, notify_phone, notify_email, confirmation_token, order_no, customer_id, schedule_job_id
      into v_label, v_scheduled_date, v_requested_time, v_notify_phone, v_notify_email, v_confirmation_token, v_order_no, v_customer_id, v_existing_schedule_job_id;
    v_job_type := 'collection';
  elsif p_entity_type = 'repair_plans' then
    update public.repair_plans
      set pre_d = requested_date
      where id = p_entity_id and dispatch_status = 'Reschedule Requested' and requested_date is not null
      returning coalesce(account_name, order_no), pre_d::text, requested_time, notify_phone, notify_email, confirmation_token, order_no, schedule_job_id
      into v_label, v_scheduled_date, v_requested_time, v_notify_phone, v_notify_email, v_confirmation_token, v_order_no, v_existing_schedule_job_id;
    v_job_type := 'repair';
  end if;
  get diagnostics v_updated = row_count;

  if v_updated > 0 then
    -- Bug #1's fix: reuse and relocate the already-linked job in place
    -- (preserving technician/technician_2/status/notes untouched) when one
    -- exists; only fall through to find-or-create for the normal case of
    -- a record that never reached a plain 'Confirmed' before the customer
    -- asked for a different date, so it has no linked job yet at all.
    if v_existing_schedule_job_id is not null then
      update public.schedule_jobs
        set scheduled_date = v_scheduled_date::date,
          scheduled_time = nullif(v_requested_time, '')
        where id = v_existing_schedule_job_id;
      v_schedule_job_id := v_existing_schedule_job_id;
    else
      v_schedule_job_id := public.find_or_create_schedule_job(v_job_type, v_customer_id, v_order_no, v_scheduled_date::date, v_requested_time);
    end if;

    -- Statement 2 of Bug #2's fix: dispatch_status only, pre_d untouched
    -- (same value as after statement 1) -- reset_dispatch_status_on_pre_d_change's
    -- own WHEN clause (`new.pre_d is distinct from old.pre_d`) is false
    -- for this statement, so it doesn't fire, and 'Confirmed' sticks.
    -- schedule_job_id is linked here too, in the same statement, for every
    -- entity type.
    if p_entity_type = 'filter_change_plans' then
      update public.filter_change_plans set dispatch_status = 'Confirmed', schedule_job_id = v_schedule_job_id where id = p_entity_id;
    elsif p_entity_type = 'install_plans' then
      update public.install_plans set dispatch_status = 'Confirmed', schedule_job_id = v_schedule_job_id where id = p_entity_id;
    elsif p_entity_type = 'collections' then
      update public.collections set dispatch_status = 'Confirmed', schedule_job_id = v_schedule_job_id where id = p_entity_id;
    elsif p_entity_type = 'repair_plans' then
      update public.repair_plans set dispatch_status = 'Confirmed', schedule_job_id = v_schedule_job_id where id = p_entity_id;
    end if;
  end if;

  out_ok := v_updated > 0;
  out_label := v_label;
  out_scheduled_date := v_scheduled_date;
  out_requested_time := v_requested_time;
  out_notify_phone := v_notify_phone;
  out_notify_email := v_notify_email;
  out_confirmation_token := v_confirmation_token;
  return next;
end;
$$;
