-- Extends the public scan-page RPC (see 20260713090000_public_portal_rpc.sql,
-- 20260824030000_portal_profile_member_info_and_history.sql) with this
-- customer's own sale_list_entries — the admin Member page's "Related
-- Sales_Lists" table, which a member can have several of (each its own
-- order_number), distinct from the customer's single order_number field.
-- Also broadens filterChanges/collections/repairs to cover every one of the
-- customer's own order numbers (their own order_number plus any sale-list
-- order numbers), not just their single order_number, so a per-sale-list-
-- order detail drill-down on the scan page has its own history to show —
-- mirrors the admin's MemberOrderDetail client-side filtering exactly.
--
-- Scoping mirrors the admin's own fallback logic (customers/page.tsx):
-- prefer the customer_id FK; for legacy rows with no customer_id, fall back
-- to matching the customer's own order_number. Both branches are scoped to
-- p_customer_id (directly, or via v_order_number which is looked up from
-- that same customer id) — this RPC can never surface another customer's
-- sale_list_entries, filter changes, collections, or repairs.
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
    'saleList', (
      select coalesce(json_agg(row_to_json(sl)), '[]'::json) from (
        select id, order_number, installed_date, product_no, s_c, c_f, c_t, cp_y1_y2, cp_start, cp_end,
               note, status, created_at
        from public.sale_list_entries
        where customer_id = p_customer_id
           or (customer_id is null and order_number = v_order_number)
      ) sl
    ),
    'filterChanges', (
      select coalesce(json_agg(row_to_json(f)), '[]'::json) from (
        select id, order_number, member_account, filter_type, plan_date, status, contact_number,
               address, s_c, product_no, pre_d, acc_d, serviceman, note, created_at
        from public.filter_change_plans
        where order_number = v_order_number
           or order_number in (
             select order_number from public.sale_list_entries
             where customer_id = p_customer_id or (customer_id is null and order_number = v_order_number)
           )
      ) f
    ),
    'collections', (
      select coalesce(json_agg(row_to_json(col)), '[]'::json) from (
        select id, order_no, account_name, collection_date, amount, status, c_t, pre_d, acc_d, note, created_at
        from public.collections
        where order_no = v_order_number
           or order_no in (
             select order_number from public.sale_list_entries
             where customer_id = p_customer_id or (customer_id is null and order_number = v_order_number)
           )
      ) col
    ),
    'repairs', (
      select coalesce(json_agg(row_to_json(r)), '[]'::json) from (
        select id, issued_date, account_name, order_no, status, problem, solution_status, pre_d,
               acc_d, th, part_no, amt, unit_in_out, created_at
        from public.repair_plans
        where order_no = v_order_number
           or order_no in (
             select order_number from public.sale_list_entries
             where customer_id = p_customer_id or (customer_id is null and order_number = v_order_number)
           )
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
