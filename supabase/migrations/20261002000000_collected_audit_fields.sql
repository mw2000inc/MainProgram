-- Who marked a record Collected, and when — separate from the generic
-- created_by/updated_by audit columns (see audit_logging migration), which
-- would get silently overwritten by any *later*, unrelated edit to the same
-- row (e.g. correcting the amount) and so can't be trusted as "who actually
-- approved the collection." Same uuid-references-profiles convention those
-- columns already use. Nullable/no default: cleared back to null whenever
-- collected is un-set, set fresh on every (re-)approval — see
-- all-collection-dialog.tsx's own toggle handler.
alter table public.collections
  add column if not exists collected_by uuid references public.profiles(id) on delete set null,
  add column if not exists collected_at timestamptz;

alter table public.install_plans
  add column if not exists collected_by uuid references public.profiles(id) on delete set null,
  add column if not exists collected_at timestamptz;

alter table public.repair_plans
  add column if not exists collected_by uuid references public.profiles(id) on delete set null,
  add column if not exists collected_at timestamptz;
