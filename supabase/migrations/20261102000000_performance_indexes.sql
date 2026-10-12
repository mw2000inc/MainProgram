-- Indexes for the columns the app actually filters, sorts and joins on (from
-- an audit of src/lib/api/* queries and the foreign keys). Until now only
-- primary keys, a few unique keys and three foreign-key indexes existed, so
-- every per-record lookup (a member's sale list entries, a product's stock
-- movements, a record's activity history) and every date-ordered list read
-- the whole table.
--
-- Today's tables are small (the largest business table is ~4k rows), so the
-- gain is modest now; it's here so lookups stay fast as data grows —
-- activity_logs especially (~19k rows in its first two months).
--
-- Indexes only: no data changes. Every statement is "if not exists", so it is
-- safe to re-run. Plain CREATE INDEX (not CONCURRENTLY, which can't run inside
-- the migration's transaction) briefly blocks writes to each table while it
-- builds — a fraction of a second at these sizes.

-- activity_logs: Admin Activity's date range + newest-first order, a record's
-- history (entity_type + entity_id), and per-user lookups/cleanup.
create index if not exists activity_logs_created_at_idx on public.activity_logs (created_at desc);
create index if not exists activity_logs_entity_idx on public.activity_logs (entity_type, entity_id);
create index if not exists activity_logs_user_id_idx on public.activity_logs (user_id);

-- notifications: newest-first list.
create index if not exists notifications_created_at_idx on public.notifications (created_at desc);

-- schedule_jobs: the Schedule/Daily Report day views, a technician's jobs, a
-- member's jobs.
create index if not exists schedule_jobs_scheduled_date_idx on public.schedule_jobs (scheduled_date);
create index if not exists schedule_jobs_technician_user_id_idx on public.schedule_jobs (technician_user_id);
create index if not exists schedule_jobs_customer_id_idx on public.schedule_jobs (customer_id);

-- stock_movements: a product's ledger by date (Inventory running totals),
-- newest-first lists, and the repair part link (filter_change_plan_id and
-- install_plan_id already have their own indexes).
create index if not exists stock_movements_product_id_date_idx on public.stock_movements (product_id, date);
create index if not exists stock_movements_created_at_idx on public.stock_movements (created_at);
create index if not exists stock_movements_repair_plan_part_id_idx on public.stock_movements (repair_plan_part_id);

-- A member's records (the member detail page's related panels).
create index if not exists sale_list_entries_customer_id_idx on public.sale_list_entries (customer_id);
create index if not exists contracts_customer_id_idx on public.contracts (customer_id);
create index if not exists filter_change_plans_customer_id_idx on public.filter_change_plans (customer_id);
create index if not exists collections_customer_id_idx on public.collections (customer_id);

-- Date-ordered plan lists (sale_list_entry_id on filter_change_plans and
-- collections is already covered by their (sale_list_entry_id,
-- occurrence_index) unique keys).
create index if not exists filter_change_plans_plan_date_idx on public.filter_change_plans (plan_date);
create index if not exists collections_collection_date_idx on public.collections (collection_date);
create index if not exists repair_plans_issued_date_idx on public.repair_plans (issued_date);
create index if not exists install_plans_input_date_idx on public.install_plans (input_date);
create index if not exists schedule_draft_assignments_target_date_idx on public.schedule_draft_assignments (target_date);
