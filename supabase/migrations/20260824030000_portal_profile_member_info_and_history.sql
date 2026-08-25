-- Extends the public scan-page RPC (see 20260713090000_public_portal_rpc.sql)
-- with the member-account fields shown on the admin Member detail panel
-- (member_account_number, contact_number2) and this customer's own
-- filter-change/collection/repair history, matched by order_number the same
-- way the admin Member page's OrderRelatedSection panels do (these plan
-- tables key on order_number/order_no text, not a customer_id FK).
create or replace function public.get_portal_profile(p_customer_id uuid)
returns json
language plpgsql
security definer set search_path = public
stable
as $$
declare
  result json;
  v_order_number text;
begin
  select order_number into v_order_number from public.customers where id = p_customer_id;

  select json_build_object(
    'customer', (
      select row_to_json(c) from (
        select id, order_number, member_account_number, full_name, company_name, contract_number,
               contract_start, contract_end, address, contact_number2, email, contact_number,
               dispenser_type, filter_installed, installed_date, assigned_technician
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
    'filterChanges', (
      select coalesce(json_agg(row_to_json(f)), '[]'::json) from (
        select id, order_number, member_account, filter_type, plan_date, status, contact_number,
               address, s_c, product_no, pre_d, acc_d, serviceman, note, created_at
        from public.filter_change_plans where order_number = v_order_number
      ) f
    ),
    'collections', (
      select coalesce(json_agg(row_to_json(col)), '[]'::json) from (
        select id, order_no, account_name, collection_date, amount, status, c_t, pre_d, acc_d, note, created_at
        from public.collections where order_no = v_order_number
      ) col
    ),
    'repairs', (
      select coalesce(json_agg(row_to_json(r)), '[]'::json) from (
        select id, issued_date, account_name, order_no, status, problem, solution_status, pre_d,
               acc_d, th, part_no, amt, unit_in_out, created_at
        from public.repair_plans where order_no = v_order_number
      ) r
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
