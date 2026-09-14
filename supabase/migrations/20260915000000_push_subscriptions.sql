-- Stores a customer's Web Push subscription (registered from the read-only
-- QR portal's own opt-in banner, customer-scan-view.tsx) so the server can
-- later send them a real push notification -- e.g. when a filter-change
-- schedule is approved and sent for confirmation (see
-- src/app/api/dispatch/approve/route.ts).
--
-- Write path is a security-definer RPC, not a direct table insert + RLS
-- policy -- same reasoning as get_portal_profile() (20260713090000): the
-- portal has no login at all, so the only thing scoping a write to "this
-- customer's own subscription" is the customer_id already embedded in the
-- QR code's URL, exactly like every other portal read/write in this app.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  -- One subscription per (customer, browser/device) -- pushManager.subscribe()
  -- returns the same endpoint for an already-subscribed browser, so this
  -- makes re-registering (e.g. after clearing the "Maybe Later" dismissal
  -- and opting in again) an upsert rather than a growing pile of duplicates.
  unique (customer_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

-- Admin-only read -- nothing customer-facing ever needs to read this back;
-- it's a write-then-forget registration. No insert/update/delete policy at
-- all: every write goes through save_push_subscription() below instead.
create policy "push_subscriptions_select_admin" on public.push_subscriptions
  for select to authenticated using (public.is_admin());

create or replace function public.save_push_subscription(
  p_customer_id uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'Unknown customer';
  end if;

  insert into public.push_subscriptions (customer_id, endpoint, p256dh, auth)
  values (p_customer_id, p_endpoint, p_p256dh, p_auth)
  on conflict (customer_id, endpoint) do update set
    p256dh = excluded.p256dh,
    auth = excluded.auth;
end;
$$;

grant execute on function public.save_push_subscription(uuid, text, text, text) to anon, authenticated;
