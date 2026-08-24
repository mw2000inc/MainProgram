-- Filter-change inventory deduction: links a "filter_change" schedule job to
-- the specific inventory item + quantity it should deduct once marked
-- completed, and records that link on the resulting stock movement so the
-- deduction is traceable back to the job that triggered it (never a silent
-- decrement). inventory_deducted_at is the idempotency guard — the cron only
-- ever deducts a given job once.
alter table public.schedule_jobs
  add column if not exists product_id uuid references public.products(id) on delete set null,
  add column if not exists quantity integer,
  add column if not exists inventory_deducted_at timestamptz;

alter table public.stock_movements
  add column if not exists schedule_job_id uuid references public.schedule_jobs(id) on delete set null;

-- Automated deductions have no human actor behind them (the cron runs
-- unattended), so user_id — previously always a manual admin action — must
-- become optional to represent a system-triggered movement.
alter table public.stock_movements
  alter column user_id drop not null;
