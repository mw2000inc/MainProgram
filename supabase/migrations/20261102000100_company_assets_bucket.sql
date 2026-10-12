-- A Supabase Storage bucket for company files (the company logo, for now), so
-- the file lives in Storage and company_settings.company_logo_url holds only
-- its URL — instead of the whole image as base64 text (~800 KB), which was
-- downloaded with every company_settings read (Customers, member detail,
-- Settings).
--
-- Public bucket: anyone with a file's URL can view it (a logo is meant to be
-- shown, e.g. on printouts). Only admins (public.is_admin(), the same check
-- company_settings' own update policy uses) can add, replace or remove files.
-- Images only, 2 MB max.
--
-- No data changes: an existing base64 logo keeps working as-is until an admin
-- uploads a logo again from Settings, which then saves it here.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-assets',
  'company-assets',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
)
on conflict (id) do nothing;

-- Listing/removal needs select as well as delete; the files are public anyway.
drop policy if exists "company_assets_select" on storage.objects;
create policy "company_assets_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'company-assets');

drop policy if exists "company_assets_insert_admin" on storage.objects;
create policy "company_assets_insert_admin" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'company-assets' and public.is_admin());

drop policy if exists "company_assets_update_admin" on storage.objects;
create policy "company_assets_update_admin" on storage.objects
  for update to authenticated
  using (bucket_id = 'company-assets' and public.is_admin())
  with check (bucket_id = 'company-assets' and public.is_admin());

drop policy if exists "company_assets_delete_admin" on storage.objects;
create policy "company_assets_delete_admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'company-assets' and public.is_admin());
