-- Admin Schedule Approval workflow — extends the EXISTING dispatch_status
-- lifecycle (Draft -> Pending Customer Confirmation -> Confirmed /
-- Reschedule Requested, see dispatch_confirmation_workflow +
-- reschedule_request_with_date) rather than building a second, parallel
-- approval system on schedule_jobs. Reasoning, so this isn't re-litigated
-- later: schedule_jobs can only ever be written by an admin or by
-- find_or_create_schedule_job() on a genuine customer confirm (see
-- schedule_jobs_write_admin) — there is no "unapproved request" concept on
-- that table at all today, and schedule_jobs.status ('pending'/'completed'/
-- 'cancelled') already means "has the technician finished this job yet",
-- not "has an admin approved it". The real "needs admin attention" queue
-- this app already has is dispatch_status on the four plan tables, surfaced
-- today via DispatchApprovalQueue on the Dashboard. This migration adds
-- exactly the one thing that queue can't do yet — an outright admin Reject,
-- and an admin-initiated (not just customer-initiated) request for a
-- different date — and nothing else.
--
-- Vocabulary mapping onto the new "Pending Approvals" tab (Schedule page):
--   PENDING_APPROVAL   -> dispatch_status in ('Draft', 'Reschedule Requested')
--                         (anything sitting in this admin queue at all)
--   SCHEDULED           -> dispatch_status = 'Confirmed' (already the exact
--                         trigger for find_or_create_schedule_job — no
--                         rename, this already means "in the real Schedule")
--   REJECTED            -> dispatch_status = 'Rejected' (new)
--   RESCHEDULE_REQUESTED -> dispatch_status = 'Reschedule Requested'
--                         (existing value, unchanged; now settable by an
--                         admin as well as a customer)
-- COMPLETED/CANCELLED already exist as schedule_jobs.status values once a
-- job is actually Scheduled — not duplicated here.

-- =========================================================================
-- 1. New columns, all four dispatch tables, same do-loop pattern already
--    used by dispatch_dual_channel_notifications for notify_phone/
--    notify_email. rejected_by/rejected_at match the exact naming already
--    established by stock_movements' own pending/approved/rejected
--    workflow (approved_by/approved_at/rejected_by/rejected_at) — reused
--    here rather than inventing new naming. rejection_reason and
--    reschedule_reason are genuinely new (stock_movements' own rejection
--    has no reason field, but a customer being told their service request
--    was declined or needs a new date needs one).
-- =========================================================================
do $$
declare
  t text;
begin
  foreach t in array array['filter_change_plans', 'install_plans', 'collections', 'repair_plans']
  loop
    execute format($f$
      alter table public.%I
        add column if not exists rejected_by uuid references public.profiles(id) on delete set null,
        add column if not exists rejected_at timestamptz,
        add column if not exists rejection_reason text,
        add column if not exists reschedule_reason text;
    $f$, t);
  end loop;
end $$;

-- =========================================================================
-- 2. 'Rejected' joins the existing dispatch_status check constraint on all
--    four tables (same constraint dispatch_confirmation_workflow created).
-- =========================================================================
do $$
declare
  t text;
begin
  foreach t in array array['filter_change_plans', 'install_plans', 'collections', 'repair_plans']
  loop
    execute format('alter table public.%I drop constraint if exists %I;', t, t || '_dispatch_status_check');
    execute format($f$
      alter table public.%I
        add constraint %I
        check (dispatch_status in ('Draft', 'Pending Customer Confirmation', 'Confirmed', 'Reschedule Requested', 'Rejected'));
    $f$, t, t || '_dispatch_status_check');
  end loop;
end $$;

-- =========================================================================
-- 3. reject_dispatch_item() — admin-only outright decline. Valid from any
--    state that hasn't already resolved one way or the other (Draft,
--    Pending Customer Confirmation, or Reschedule Requested) — never from
--    Confirmed (that's a real schedule already; cancelling one is what
--    schedule_jobs.status = 'cancelled' is for, unrelated to this workflow)
--    and never from an already-Rejected row (the WHERE guard below makes a
--    second reject a no-op, out_ok = false, rather than clobbering the
--    first rejection's reason/timestamp — same race-safety shape as
--    approve_dispatch_item's own `where dispatch_status = 'Draft'`).
-- =========================================================================
create or replace function public.reject_dispatch_item(
  p_entity_type text,
  p_entity_id uuid,
  p_reason text default null
)
returns table (
  out_ok boolean,
  out_label text,
  out_notify_email text
)
language plpgsql
security definer set search_path = public
as $$
declare
  v_label text;
  v_notify_email text;
  v_updated integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only admins can reject a dispatch item';
  end if;
  if p_entity_type not in ('filter_change_plans', 'install_plans', 'collections', 'repair_plans') then
    raise exception 'Unknown entity_type: %', p_entity_type;
  end if;

  if p_entity_type = 'filter_change_plans' then
    update public.filter_change_plans
      set dispatch_status = 'Rejected', rejected_by = auth.uid(), rejected_at = now(), rejection_reason = p_reason
      where id = p_entity_id and dispatch_status in ('Draft', 'Pending Customer Confirmation', 'Reschedule Requested')
      returning coalesce(member_account, order_number), notify_email into v_label, v_notify_email;
  elsif p_entity_type = 'install_plans' then
    update public.install_plans
      set dispatch_status = 'Rejected', rejected_by = auth.uid(), rejected_at = now(), rejection_reason = p_reason
      where id = p_entity_id and dispatch_status in ('Draft', 'Pending Customer Confirmation', 'Reschedule Requested')
      returning coalesce(name, order_no), notify_email into v_label, v_notify_email;
  elsif p_entity_type = 'collections' then
    update public.collections
      set dispatch_status = 'Rejected', rejected_by = auth.uid(), rejected_at = now(), rejection_reason = p_reason
      where id = p_entity_id and dispatch_status in ('Draft', 'Pending Customer Confirmation', 'Reschedule Requested')
      returning coalesce(account_name, order_no), notify_email into v_label, v_notify_email;
  elsif p_entity_type = 'repair_plans' then
    update public.repair_plans
      set dispatch_status = 'Rejected', rejected_by = auth.uid(), rejected_at = now(), rejection_reason = p_reason
      where id = p_entity_id and dispatch_status in ('Draft', 'Pending Customer Confirmation', 'Reschedule Requested')
      returning coalesce(account_name, order_no), notify_email into v_label, v_notify_email;
  end if;
  get diagnostics v_updated = row_count;

  out_ok := v_updated > 0;
  out_label := v_label;
  out_notify_email := v_notify_email;
  return next;
end;
$$;

grant execute on function public.reject_dispatch_item(text, uuid, text) to authenticated;

-- =========================================================================
-- 4. request_reschedule_by_admin() — the admin-initiated mirror of the
--    customer's own "request a different date" (respond_to_dispatch_
--    confirmation, action='reschedule'). Only valid from Draft or Pending
--    Customer Confirmation — not from an already Reschedule Requested row
--    (the customer already proposed something; accept or reject it instead
--    of asking again), not from Confirmed (already a real schedule) or
--    Rejected. Clears any live confirmation_token/expiry the same way
--    reset_dispatch_status_on_pre_d_change already does when a pending
--    confirmation link is about to go stale — this admin action means "hold
--    on, that link no longer applies", not something that trigger's own
--    pre_d-change condition would otherwise catch.
-- =========================================================================
create or replace function public.request_reschedule_by_admin(
  p_entity_type text,
  p_entity_id uuid,
  p_reason text
)
returns table (
  out_ok boolean,
  out_label text,
  out_notify_email text
)
language plpgsql
security definer set search_path = public
as $$
declare
  v_label text;
  v_notify_email text;
  v_updated integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only admins can request a reschedule';
  end if;
  if p_entity_type not in ('filter_change_plans', 'install_plans', 'collections', 'repair_plans') then
    raise exception 'Unknown entity_type: %', p_entity_type;
  end if;

  if p_entity_type = 'filter_change_plans' then
    update public.filter_change_plans
      set dispatch_status = 'Reschedule Requested', reschedule_reason = p_reason,
        confirmation_token = null, confirmation_token_expires_at = null
      where id = p_entity_id and dispatch_status in ('Draft', 'Pending Customer Confirmation')
      returning coalesce(member_account, order_number), notify_email into v_label, v_notify_email;
  elsif p_entity_type = 'install_plans' then
    update public.install_plans
      set dispatch_status = 'Reschedule Requested', reschedule_reason = p_reason,
        confirmation_token = null, confirmation_token_expires_at = null
      where id = p_entity_id and dispatch_status in ('Draft', 'Pending Customer Confirmation')
      returning coalesce(name, order_no), notify_email into v_label, v_notify_email;
  elsif p_entity_type = 'collections' then
    update public.collections
      set dispatch_status = 'Reschedule Requested', reschedule_reason = p_reason,
        confirmation_token = null, confirmation_token_expires_at = null
      where id = p_entity_id and dispatch_status in ('Draft', 'Pending Customer Confirmation')
      returning coalesce(account_name, order_no), notify_email into v_label, v_notify_email;
  elsif p_entity_type = 'repair_plans' then
    update public.repair_plans
      set dispatch_status = 'Reschedule Requested', reschedule_reason = p_reason,
        confirmation_token = null, confirmation_token_expires_at = null
      where id = p_entity_id and dispatch_status in ('Draft', 'Pending Customer Confirmation')
      returning coalesce(account_name, order_no), notify_email into v_label, v_notify_email;
  end if;
  get diagnostics v_updated = row_count;

  out_ok := v_updated > 0;
  out_label := v_label;
  out_notify_email := v_notify_email;
  return next;
end;
$$;

grant execute on function public.request_reschedule_by_admin(text, uuid, text) to authenticated;
