-- Tracking column for the new 2-day-ahead schedule reminder cron
-- (/api/cron/send-schedule-reminders, "sendScheduleReminders" in the
-- Automation Hub) — a timestamp rather than a plain boolean so "when did
-- we actually remind them" is answerable later without a second lookup,
-- same reasoning customer_notified_at/customer_responded_at already use
-- on these same two tables. Null means "not yet reminded" (or reminder
-- eligibility no longer applies, e.g. rescheduled to a new date) — the
-- cron's own query filters on this being null to avoid a duplicate send,
-- and never reads it any other way, so no default/backfill is needed for
-- existing rows.
alter table public.filter_change_plans
  add column if not exists two_day_reminder_sent_at timestamptz;

alter table public.collections
  add column if not exists two_day_reminder_sent_at timestamptz;

-- Whenever pre_d actually changes (an admin edit, or the reschedule-accept
-- flow moving it to a customer-requested date), a stale reminder sent for
-- the OLD date must not suppress a real one for the NEW date — otherwise a
-- rescheduled visit would silently never get its own 2-day-ahead reminder.
-- Deliberately its own trigger rather than folded into
-- reset_dispatch_status_on_pre_d_change(): that one only resets fields when
-- the OLD status was 'Pending Customer Confirmation'/'Reschedule Requested'
-- (its own dispatch-status-bounce concern) — a plain schedule-date edit on
-- an already-Confirmed row still needs the reminder flag cleared even
-- though dispatch_status itself has nothing to bounce.
create or replace function public.reset_two_day_reminder_on_date_change()
returns trigger
language plpgsql
as $$
begin
  if new.pre_d is distinct from old.pre_d then
    new.two_day_reminder_sent_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists reset_two_day_reminder_on_pre_d_change on public.filter_change_plans;
create trigger reset_two_day_reminder_on_pre_d_change
  before update on public.filter_change_plans
  for each row execute function public.reset_two_day_reminder_on_date_change();

drop trigger if exists reset_two_day_reminder_on_pre_d_change on public.collections;
create trigger reset_two_day_reminder_on_pre_d_change
  before update on public.collections
  for each row execute function public.reset_two_day_reminder_on_date_change();
