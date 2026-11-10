-- 0028_employee_self_service.sql — run after 0027_hr_work_assets_documents.sql
-- (Supabase SQL Editor: Save this query as "0028_employee_self_service")
--
-- Employee self-service:
-- * Profile photos: private "employee-photos" bucket, readable by SSI GLOBAL staff only (never
--   partners, never public). Employees change their own photo; HR can change anyone's.
-- * Personal details (personal email, address, emergency contact; phone stays on the account):
--   the employee and HR can see and change them through update_personal_details(). Managers and
--   colleagues cannot see them. Employment fields stay HR-only (unchanged).
-- * My Documents: employees may upload their own documents (ID, address proof, qualifications,
--   experience letters, medical certificates, other). They go to HR as "Pending Review"; HR
--   verifies or rejects them with a note. Employees see the history of their own documents.
-- * my_team_members(): colleagues in the same department, the reporting manager, peers with the
--   same manager and the employee's own team — name, photo, designation, department, work email,
--   manager and today's availability (full / morning / afternoon leave, never the leave type or
--   reason). Managers additionally get today's attendance state of people in their team.
-- Safe to run more than once.

-- =============================================================== profile photos
alter table public.profiles add column if not exists photo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-photos', 'employee-photos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Object names are "<user_id>/<uuid>.<ext>".
drop policy if exists "employee photos: staff read" on storage.objects;
drop policy if exists "employee photos: upload" on storage.objects;
drop policy if exists "employee photos: delete" on storage.objects;
create policy "employee photos: staff read" on storage.objects for select to authenticated using (
  bucket_id = 'employee-photos' and public.is_staff());
create policy "employee photos: upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'employee-photos' and public.is_staff() and position('..' in name) = 0
  and ((storage.foldername(name))[1] = auth.uid()::text
       or ((public.is_super_admin() or public.is_hr())
           and exists (select 1 from public.employees e where e.id::text = (storage.foldername(name))[1]))));
create policy "employee photos: delete" on storage.objects for delete to authenticated using (
  bucket_id = 'employee-photos' and public.is_staff()
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_super_admin() or public.is_hr()));

create or replace function public.set_profile_photo(p_emp uuid, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Not permitted'; end if;
  if not (p_emp = auth.uid() or public.is_super_admin() or public.is_hr()) then raise exception 'You can only change your own photo'; end if;
  if not exists (select 1 from public.employees where id = p_emp) then raise exception 'Employee not found'; end if;
  if p_path is not null and (p_path not like p_emp::text || '/%' or position('..' in p_path) > 0 or char_length(p_path) > 200) then
    raise exception 'Invalid photo';
  end if;
  update public.profiles set photo_path = p_path where id = p_emp;
end $$;
revoke all on function public.set_profile_photo(uuid, text) from public, anon;
grant execute on function public.set_profile_photo(uuid, text) to authenticated;

-- =============================================================== personal details
create table if not exists public.employee_personal_details (
  employee_id        uuid primary key references public.employees (id) on delete cascade,
  personal_email     text check (personal_email is null or (char_length(personal_email) <= 200 and personal_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  address            text check (char_length(address) <= 500),
  emergency_name     text check (char_length(emergency_name) <= 120),
  emergency_relation text check (char_length(emergency_relation) <= 60),
  emergency_phone    text check (emergency_phone is null or emergency_phone ~ '^[+0-9 ()-]{6,20}$'),
  updated_at         timestamptz not null default now(),
  updated_by         uuid
);
alter table public.employee_personal_details enable row level security;
revoke all on public.employee_personal_details from anon, authenticated;
grant select on public.employee_personal_details to authenticated;
drop policy if exists "personal details: self or hr" on public.employee_personal_details;
create policy "personal details: self or hr" on public.employee_personal_details for select to authenticated using (
  public.is_staff() and (employee_id = auth.uid() or public.is_super_admin() or public.is_hr()));

create or replace function public.update_personal_details(p_emp uuid, p_phone text, p_personal_email text, p_address text,
                                                          p_emergency_name text, p_emergency_relation text, p_emergency_phone text)
returns void language plpgsql security definer set search_path = '' as $$
declare ph text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if not public.is_staff() then raise exception 'Not permitted'; end if;
  if not (p_emp = auth.uid() or public.is_super_admin() or public.is_hr()) then raise exception 'You can only change your own details'; end if;
  if not exists (select 1 from public.employees where id = p_emp) then raise exception 'Employee not found'; end if;
  if ph is not null and ph !~ '^[+0-9 ()-]{6,20}$' then raise exception 'Enter a valid phone number'; end if;
  update public.profiles set phone = ph where id = p_emp;
  insert into public.employee_personal_details as d (employee_id, personal_email, address, emergency_name, emergency_relation, emergency_phone, updated_by)
  values (p_emp, nullif(btrim(coalesce(p_personal_email, '')), ''), nullif(btrim(coalesce(p_address, '')), ''), nullif(btrim(coalesce(p_emergency_name, '')), ''),
          nullif(btrim(coalesce(p_emergency_relation, '')), ''), nullif(btrim(coalesce(p_emergency_phone, '')), ''), auth.uid())
  on conflict (employee_id) do update set personal_email = excluded.personal_email, address = excluded.address,
    emergency_name = excluded.emergency_name, emergency_relation = excluded.emergency_relation, emergency_phone = excluded.emergency_phone,
    updated_at = now(), updated_by = auth.uid();
  if p_emp <> auth.uid() then
    perform public.notify(array[p_emp], 'hr', 'HR updated your personal details', null, 'work/profile');
  end if;
end $$;
revoke all on function public.update_personal_details(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.update_personal_details(uuid, text, text, text, text, text, text) to authenticated;

-- =============================================================== documents uploaded by employees
alter table public.employee_documents add column if not exists source text not null default 'hr';
alter table public.employee_documents add column if not exists review_status text;
alter table public.employee_documents add column if not exists review_note text;
alter table public.employee_documents add column if not exists reviewed_by uuid;
alter table public.employee_documents add column if not exists reviewed_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'employee_documents_source_check') then
    alter table public.employee_documents add constraint employee_documents_source_check check (source in ('hr', 'employee'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employee_documents_review_check') then
    alter table public.employee_documents add constraint employee_documents_review_check
      check (review_status is null or review_status in ('Pending Review', 'Verified', 'Rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employee_documents_review_note_len') then
    alter table public.employee_documents add constraint employee_documents_review_note_len check (char_length(review_note) <= 300);
  end if;
end $$;
alter table public.employee_document_events drop constraint if exists employee_document_events_action_check;
alter table public.employee_document_events add constraint employee_document_events_action_check
  check (action in ('uploaded', 'downloaded', 'shared', 'unshared', 'archived', 'restored', 'edited', 'verified', 'rejected'));

create or replace function public.employee_upload_categories()
returns text[] language sql immutable set search_path = '' as $$
  select array['Identity', 'Address Proof', 'Qualification', 'Experience Letter', 'Medical', 'Other'];
$$;

drop policy if exists "hr documents: employee upload" on public.employee_documents;
create policy "hr documents: employee upload" on public.employee_documents for insert to authenticated with check (
  public.is_staff() and employee_id = auth.uid() and public.my_employee_id() = auth.uid()
  and source = 'employee' and category = any (public.employee_upload_categories())
  and storage_path like auth.uid()::text || '/%' and position('..' in storage_path) = 0);

drop policy if exists "hr docs storage: employee upload" on storage.objects;
create policy "hr docs storage: employee upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'hr-documents' and public.is_staff() and position('..' in name) = 0
  and public.my_employee_id() = auth.uid() and (storage.foldername(name))[1] = auth.uid()::text);
-- An employee may remove their own upload straight away if saving its record failed.
drop policy if exists "hr docs storage: employee cleanup" on storage.objects;
create policy "hr docs storage: employee cleanup" on storage.objects for delete to authenticated using (
  bucket_id = 'hr-documents' and public.is_staff() and (storage.foldername(name))[1] = auth.uid()::text
  and not exists (select 1 from public.employee_documents d where d.storage_path = objects.name));

-- Employees see the history of their own documents (HR-only documents stay hidden).
drop policy if exists "hr document events: own" on public.employee_document_events;
create policy "hr document events: own" on public.employee_document_events for select to authenticated using (
  public.is_staff() and employee_id = auth.uid()
  and exists (select 1 from public.employee_documents d where d.id = document_id and d.visible_to_employee and d.status = 'Active'));

create or replace function public.guard_employee_document()
returns trigger language plpgsql security definer set search_path = '' as $$
declare hr boolean := public.can_manage_hr_documents();
begin
  if tg_op = 'INSERT' then
    new.status := 'Active'; new.archived_by := null; new.archived_at := null; new.archive_reason := null;
    new.uploaded_at := now(); new.reviewed_by := null; new.reviewed_at := null; new.review_note := null;
    if public.is_end_user_request() then new.uploaded_by := auth.uid(); end if;
    if public.is_end_user_request() and not hr then
      -- Uploaded by the employee: always visible to them and waiting for HR.
      new.source := 'employee'; new.visible_to_employee := true; new.review_status := 'Pending Review';
    elsif new.source = 'employee' then
      new.review_status := coalesce(new.review_status, 'Pending Review');
    else
      new.source := 'hr'; new.review_status := null;
    end if;
    return new;
  end if;
  if new.employee_id is distinct from old.employee_id or new.storage_path is distinct from old.storage_path
     or new.file_name is distinct from old.file_name or new.size is distinct from old.size or new.mime is distinct from old.mime
     or new.uploaded_by is distinct from old.uploaded_by or new.uploaded_at is distinct from old.uploaded_at
     or new.source is distinct from old.source then
    raise exception 'A stored document cannot be replaced — upload a new one';
  end if;
  if (new.review_status is distinct from old.review_status or new.review_note is distinct from old.review_note)
     and coalesce(current_setting('ssi.doc_review', true), '') <> 'on' then
    raise exception 'Use Verify / Reject to review a document';
  end if;
  -- An employee's own upload stays visible to them.
  if new.source = 'employee' and new.status = 'Active' then new.visible_to_employee := true; end if;
  if new.status = 'Archived' and old.status = 'Active' then
    if length(btrim(coalesce(new.archive_reason, ''))) < 3 then raise exception 'Enter a reason to archive this document'; end if;
    new.archived_by := auth.uid(); new.archived_at := now(); new.visible_to_employee := false;
  elsif new.status = 'Active' and old.status = 'Archived' then
    new.archived_by := null; new.archived_at := null; new.archive_reason := null;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.log_employee_document()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.employee_document_events (document_id, employee_id, actor, action) values (new.id, new.employee_id, auth.uid(), 'uploaded');
    if new.source = 'employee' then
      perform public.notify(array(select public.staff_recipients('hr')), 'hr', 'Document uploaded for review',
        (select full_name from public.profiles where id = new.employee_id) || ' · ' || new.category || ' · ' || new.title, 'hr/documents');
    elsif new.visible_to_employee then
      perform public.notify(array[new.employee_id], 'hr', 'New HR document shared with you', new.title, 'work/documents');
    end if;
    return new;
  end if;
  if new.status <> old.status then
    insert into public.employee_document_events (document_id, employee_id, actor, action)
    values (new.id, new.employee_id, auth.uid(), case when new.status = 'Archived' then 'archived' else 'restored' end);
  end if;
  if new.visible_to_employee <> old.visible_to_employee and not (new.status = 'Archived' and old.status = 'Active') and new.source = 'hr' then
    insert into public.employee_document_events (document_id, employee_id, actor, action)
    values (new.id, new.employee_id, auth.uid(), case when new.visible_to_employee then 'shared' else 'unshared' end);
    if new.visible_to_employee then
      perform public.notify(array[new.employee_id], 'hr', 'New HR document shared with you', new.title, 'work/documents');
    end if;
  end if;
  if new.review_status is distinct from old.review_status and new.review_status in ('Verified', 'Rejected') then
    insert into public.employee_document_events (document_id, employee_id, actor, action)
    values (new.id, new.employee_id, auth.uid(), lower(new.review_status));
    perform public.notify(array[new.employee_id], 'hr', 'Document ' || lower(new.review_status) || ': ' || new.title, new.review_note, 'work/documents');
  end if;
  if new.title is distinct from old.title or new.category is distinct from old.category or new.expires_on is distinct from old.expires_on then
    insert into public.employee_document_events (document_id, employee_id, actor, action) values (new.id, new.employee_id, auth.uid(), 'edited');
  end if;
  return new;
end $$;

create or replace function public.review_employee_document(p_id text, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare d record;
begin
  if not public.can_manage_hr_documents() then raise exception 'Only HR can review documents'; end if;
  if p_status not in ('Verified', 'Rejected') then raise exception 'Choose Verified or Rejected'; end if;
  if p_status = 'Rejected' and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Say why the document is rejected'; end if;
  if char_length(coalesce(p_note, '')) > 300 then raise exception 'The note is too long'; end if;
  select * into d from public.employee_documents where id = p_id for update;
  if d.id is null then raise exception 'Document not found'; end if;
  if d.employee_id = auth.uid() then raise exception 'You cannot review your own document'; end if;
  perform set_config('ssi.doc_review', 'on', true);
  update public.employee_documents set review_status = p_status, review_note = nullif(btrim(coalesce(p_note, '')), ''),
    reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  perform set_config('ssi.doc_review', '', true);
end $$;
revoke all on function public.review_employee_document(text, text, text) from public, anon;
grant execute on function public.review_employee_document(text, text, text) to authenticated;

-- =============================================================== team members
create or replace function public.my_team_members()
returns table (id uuid, full_name text, employee_code text, designation_id text, department_id text, reporting_manager_id uuid,
               manager_name text, work_email text, photo_path text, relation text, availability text, attendance_state text)
language sql stable security definer set search_path = '' as $$
  with me as (select e.* from public.employees e where e.id = auth.uid() and public.is_staff()),
  mine as (select public.team_of(auth.uid()) as id)
  select e.id, p.full_name, e.employee_code, e.designation_id, e.department_id, e.reporting_manager_id,
         mp.full_name, p.email, p.photo_path,
         case when e.id = me.id then 'you'
              when e.id = me.reporting_manager_id then 'manager'
              when e.id in (select id from mine) then 'my team'
              when e.reporting_manager_id is not null and e.reporting_manager_id = me.reporting_manager_id then 'peer'
              else 'department' end,
         -- Today's availability from approved leave: never the leave type or reason.
         coalesce((select case when bool_or(r.half_day_session is null) or count(distinct r.half_day_session) > 1 then 'full_leave'
                               when bool_or(r.half_day_session = 'morning') then 'morning_leave' else 'afternoon_leave' end
                   from public.leave_requests r
                   where r.employee_id = e.id and r.status = 'Approved' and public.company_today() between r.start_date and r.end_date
                   having count(*) > 0), 'available'),
         -- Attendance state only for the caller's own team (managers) and themselves.
         case when e.id = me.id or e.id in (select id from mine) then
           (select case when s.punch_out_at is not null or s.closed_reason is not null then 'Checked Out'
                        when exists (select 1 from public.break_sessions b where b.session_id = s.id and b.end_at is null) then 'On Break'
                        else 'Checked In' end
            from public.attendance_sessions s where s.employee_id = e.id and s.work_date = public.company_today() limit 1)
         end
  from me
  join public.employees e on (e.id = me.id
                              or (me.department_id is not null and e.department_id = me.department_id)
                              or e.id = me.reporting_manager_id
                              or (me.reporting_manager_id is not null and e.reporting_manager_id = me.reporting_manager_id)
                              or e.id in (select id from mine))
  join public.profiles p on p.id = e.id and p.status = 'active'
  left join public.profiles mp on mp.id = e.reporting_manager_id
  where e.employment_status <> 'Resigned'
  order by (e.id = me.id) desc, p.full_name;
$$;
revoke all on function public.my_team_members() from public, anon;
grant execute on function public.my_team_members() to authenticated;

-- =============================================================== audit, realtime
do $$
declare t text;
begin
  execute 'drop trigger if exists employee_personal_details_audit on public.employee_personal_details';
  execute 'create trigger employee_personal_details_audit after insert or update or delete on public.employee_personal_details
           for each row execute function public.audit_row()';
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['employee_personal_details', 'employee_document_events', 'profiles'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
