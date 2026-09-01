-- An admin editing Pre D on a row that's already 'Pending Customer
-- Confirmation' used to leave dispatch_status and confirmation_token
-- completely untouched — the customer's already-sent link stayed "valid"
-- (get_dispatch_confirmation_details' validity check is purely
-- time-based, not tied to whether the underlying date has since changed),
-- but would now silently show whatever the *current* Pre D is, which
-- could be a different date than what the customer was actually notified
-- about. Confirmed and chosen fix: reset the row back to 'Draft' (so it
-- re-enters the admin approval queue and gets a fresh, correct
-- notification next time it's approved) and invalidate the stale token
-- outright, rather than leaving it silently pointing at a moved date.
--
-- Implemented as a trigger (not a check in each update call site) so it's
-- enforced "regardless of which edit path is used" by construction — the
-- full edit dialog, the Daily Report's inline Pre D cell, a future new
-- edit surface, or a bulk recurring-schedule reschedule cascade all just
-- run a plain UPDATE on these tables, and every one of them is covered
-- without needing to remember to add this check at each call site.
--
-- Only filter_change_plans, collections, and repair_plans have a `pre_d`
-- column at all — install_plans uses pre_installed_date/installed_date
-- instead (different naming, not part of this rule).
create or replace function public.reset_dispatch_status_on_pre_d_change()
returns trigger
language plpgsql
as $$
begin
  if new.pre_d is distinct from old.pre_d and old.dispatch_status = 'Pending Customer Confirmation' then
    new.dispatch_status := 'Draft';
    new.confirmation_token := null;
    new.confirmation_token_expires_at := null;
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['filter_change_plans', 'collections', 'repair_plans']
  loop
    execute format('drop trigger if exists reset_dispatch_on_pre_d_change on public.%I;', t);
    execute format($f$
      create trigger reset_dispatch_on_pre_d_change
        before update on public.%I
        for each row
        when (new.pre_d is distinct from old.pre_d)
        execute function public.reset_dispatch_status_on_pre_d_change();
    $f$, t);
  end loop;
end $$;
