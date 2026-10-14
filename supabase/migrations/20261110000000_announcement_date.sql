-- The day an announcement is for.
--
-- The Daily Report's Announcement panel shows only the announcements for the
-- date being viewed (?date=…) — admins asked (2026-10-14). announcement_date
-- is that day: the Daily Report date an admin was on when they posted it (the
-- form defaults to it and can be changed), so an announcement can be posted
-- ahead for a later day.
--
-- Existing announcements get the day they were posted (Asia/Manila, the
-- business day everything else uses); a new row without a date gets today.

alter table public.announcements
  add column if not exists announcement_date date;

update public.announcements
  set announcement_date = (created_at at time zone 'Asia/Manila')::date
  where announcement_date is null;

alter table public.announcements
  alter column announcement_date set default ((now() at time zone 'Asia/Manila')::date),
  alter column announcement_date set not null;

create index if not exists announcements_announcement_date_idx
  on public.announcements (announcement_date);
