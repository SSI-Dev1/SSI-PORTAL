-- 0009_application_duplicates.sql — run after 0008_import_oxford_direct_fy27.sql
-- (Supabase SQL Editor: Save this query as "0009_application_duplicates")
--
-- Prevents accidental duplicate applications. A student may apply to several universities,
-- courses or intakes, but not twice to the same university + course + intake while the earlier
-- application is still open (any status except "Visa Refused"). Reapplying after a refusal is
-- allowed. The check runs in the database for every insert/update, under a transaction-level
-- lock on that combination, so double clicks, retries, several tabs or concurrent requests
-- cannot create two. The app also sends its own id with each new application, so a retried
-- request hits the primary key instead of creating a second row. Safe to run more than once.

create or replace function public.guard_duplicate_application()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  existing record;
begin
  if tg_op = 'UPDATE'
     and (new.student_id, new.university_id, new.course_id, new.intake, new.status = 'Visa Refused')
         is not distinct from (old.student_id, old.university_id, old.course_id, old.intake, old.status = 'Visa Refused') then
    return new;
  end if;
  if new.status = 'Visa Refused' then return new; end if;

  -- Serialise checks for this exact combination (released at commit/rollback).
  perform pg_advisory_xact_lock(hashtext('app:' || new.student_id || '|' || new.university_id || '|' || new.course_id || '|' || lower(btrim(new.intake))));

  select a.id, a.ref, a.status into existing
  from public.applications a
  where a.student_id = new.student_id and a.university_id = new.university_id and a.course_id = new.course_id
    and lower(btrim(a.intake)) = lower(btrim(new.intake)) and a.status <> 'Visa Refused' and a.id <> new.id
  limit 1;
  if found then
    raise exception 'DUPLICATE_APPLICATION:%:%', existing.id, coalesce(existing.ref, '')
      using errcode = 'P0001',
            hint = 'This student already has an open application for this university, course and intake.';
  end if;
  return new;
end $$;

drop trigger if exists applications_no_duplicates on public.applications;
create trigger applications_no_duplicates before insert or update on public.applications
  for each row execute function public.guard_duplicate_application();

create index if not exists applications_combo_idx
  on public.applications (student_id, university_id, course_id, lower(btrim(intake)));
