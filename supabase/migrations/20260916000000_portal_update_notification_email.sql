-- Lets the anonymous QR portal (customer-scan-view.tsx / push-opt-in-banner.tsx)
-- update a customer's own email address -- the same security-definer,
-- customer_id-scoped write pattern save_push_subscription() already
-- established (20260915000000_push_subscriptions.sql), since customers has
-- no anon write policy at all (its own update policy is admin-authenticated
-- only, see 20260908050000_lock_down_remaining_writable_tables.sql) and
-- this portal has no login to attach a real RLS-checkable identity to.
--
-- This becomes the address customers.email that every future admin
-- approval email already falls back to whenever a specific plan's own
-- notify_email isn't set (see PendingApprovalRow's own customerEmail
-- field, pending-approvals-panel.tsx: `p.notifyEmail ?? customer?.email`)
-- -- no other code changes needed for "future approval emails route here."
--
-- A minimal non-empty/contains-"@" sanity check, not full RFC 5322
-- validation -- the browser's own <input type="email"> already does
-- reasonable client-side validation before this is ever called; this is
-- just a floor against obviously-garbage data reaching the column directly
-- (e.g. a client bypassing the browser's own validation).
create or replace function public.update_customer_notification_email(
  p_customer_id uuid,
  p_email text
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'Unknown customer';
  end if;
  if p_email is null or trim(p_email) = '' or position('@' in p_email) = 0 then
    raise exception 'A valid email address is required';
  end if;

  update public.customers set email = trim(p_email) where id = p_customer_id;
end;
$$;

grant execute on function public.update_customer_notification_email(uuid, text) to anon, authenticated;
