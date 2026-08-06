-- Quarterly-monitoring interval configuration + expose installed date on the public portal.
--
-- Feature: the customer-facing scan page (/scan/[customerId], and the existing
-- /portal/[id]) shows an "End Date" = installed date + a monitoring interval. The
-- interval must be configurable per Water Purification Type (dispenser_type) rather
-- than hardcoded, so admins can set e.g. 6 months for one product line and 12 for
-- another. `monitoring_intervals` maps a dispenser_type string -> months; any type
-- not present falls back to `monitoring_default_months`.
alter table public.company_settings
  add column if not exists monitoring_default_months integer not null default 6,
  add column if not exists monitoring_intervals jsonb not null default '{}'::jsonb;

-- The public portal RPC previously omitted installed_date (the page had no use for
-- it) and the new interval settings. The scan page needs both to compute End Date
-- and Status without ever exposing another customer's data — so extend the same
-- security-definer, single-customer function rather than opening table RLS.
create or replace function public.get_portal_profile(p_customer_id uuid)
returns json
language plpgsql
security definer set search_path = public
stable
as $$
declare
  result json;
begin
  select json_build_object(
    'customer', (
      select row_to_json(c) from (
        select id, order_number, full_name, company_name, contract_number, contract_start,
               contract_end, address, email, contact_number, dispenser_type, filter_installed,
               installed_date, assigned_technician
        from public.customers where id = p_customer_id
      ) c
    ),
    'sales', (
      select coalesce(json_agg(row_to_json(s)), '[]'::json) from (
        select s.id, s.invoice_number, s.date, s.payment_method, s.payment_status, s.total_amount,
               (select coalesce(json_agg(json_build_object('productId', si.product_id, 'quantity', si.quantity)), '[]'::json)
                from public.sale_items si where si.sale_id = s.id) as items
        from public.sales s where s.customer_id = p_customer_id
      ) s
    ),
    'products', (
      select coalesce(json_agg(json_build_object('id', p.id, 'name', p.name)), '[]'::json)
      from public.products p
      where p.id in (
        select si.product_id from public.sale_items si
        join public.sales s on s.id = si.sale_id
        where s.customer_id = p_customer_id
      )
    ),
    'settings', (
      select row_to_json(cs) from (
        select company_name, address, contact_numbers, contact_emails,
               monitoring_default_months, monitoring_intervals
        from public.company_settings where id = 1
      ) cs
    )
  ) into result;
  return result;
end;
$$;

grant execute on function public.get_portal_profile(uuid) to anon, authenticated;
