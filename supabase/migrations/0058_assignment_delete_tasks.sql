-- Application assignment by Partner Success Officers, Super Admin-only permanent deletion, and manual
-- Pending Work / Tomorrow's Plan tasks (20 Nov 2026). Safe to run more than once.
--
-- 1. Assigned staff
--    * assign_application(): the one way a non-admin employee changes applications.assigned_to.
--      Partner Success Officers (Partner Success + Applications) may assign only applications in their own
--      scope — created by them, attributed to them as Sub Officer, of a client where they are the Sub
--      Officer, or of a student from one of their leads — and only to an eligible Application Team member
--      (active account, not resigned, Application Team designation, Applications access).
--      Admin Portal users (Super Admin; Admin Staff with Applications) keep full control.
--    * Every change of assigned_to (any path) is written to application_assignment_history: reference,
--      previous and new staff, who assigned, when and the reason. History is never deleted with the
--      application (no foreign key).
--    * The assigned employee is notified by the existing notify_on_change trigger.
-- 2. Permanent deletion
--    * Applications, students, documents (and their files), assessments, payments, catalogue records
--      (universities, courses, intakes, blacklist) and tasks can be deleted only by a Super Admin.
--      Every other path stays (create, edit, cancel, close, archive) under the existing permissions.
--      Partner logins lose the delete right too. Enforced by RLS — the browser has no say.
--    * A student with applications cannot be deleted (no silent cascade): delete the applications first.
--    * A file whose document record still exists can only be removed by a Super Admin; an orphaned upload
--      (insert failed) can still be cleaned up by whoever uploaded it.
-- 3. Manual tasks
--    * save_my_task(): employees add their own Pending Work and Tomorrow's Plan tasks as rows of the
--      existing task system (tasks, kind = 'assignment', assigned to and by themselves), with history in
--      task_events. A task planned for a day (start_date) appears in My Assigned Tasks from that day —
--      the same row, no copies, decided by the date, not by a browser timer.
--    * Completing it uses update_assignment_progress (one task_completed activity, as before);
--      cancel_my_task() cancels it (kept, shown as cancelled). Creating a task records nothing as done.
--    * my_pending_work() now works for every employee and lists open tasks (manual ones flagged) in
--      Pending Work and tasks planned for the next working day in Tomorrow's Plan; the submitted-report
--      snapshot (0055) therefore carries them into the PDF as well.

-- =============================================================== 1. assigned staff
create or replace function public.is_application_team(p_emp uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p join public.employees e on e.id = p.id
    where p.id = p_emp and p.status = 'active' and p.role = any (public.staff_roles()) and e.employment_status <> 'Resigned'
      and (e.designation_id = 'application_team' or 'application_team' = any (coalesce(e.additional_designations, '{}')))
      and 'applications' = any (coalesce(p.permissions, public.role_default_permissions(p.role))));
$$;

-- Admin Portal users with Applications: full assignment control (as before).
create or replace function public.application_assign_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.my_profile_ok() and (public.is_super_admin() or (public.my_role() = 'admin_staff' and public.staff_can('applications')));
$$;

create or replace function public.can_assign_application(p_app text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.my_profile_ok() and public.is_staff() and (
    public.application_assign_admin()
    or (public.staff_can('applications') and public.staff_can('partner_success') and exists (
          select 1 from public.applications a where a.id = p_app and (
               a.created_by = auth.uid()
            or exists (select 1 from public.application_attribution x where x.application_id = a.id and x.sub_officer_id = auth.uid())
            or exists (select 1 from public.onboarded_client_directory() d where d.mine and d.partner_id = a.partner_id)
            or exists (select 1 from public.leads l where l.student_id = a.student_id and l.assigned_to = auth.uid())))));
$$;

create table if not exists public.application_assignment_history (
  id               bigint generated always as identity primary key,
  application_id   text not null,
  application_ref  text,
  previous_staff   uuid,
  previous_name    text,
  new_staff        uuid,
  new_name         text,
  assigned_by      uuid,
  assigned_by_name text,
  reason           text check (char_length(reason) <= 500),
  at               timestamptz not null default now()
);
create index if not exists application_assignment_history_app_idx on public.application_assignment_history (application_id, at);
alter table public.application_assignment_history enable row level security;
revoke all on public.application_assignment_history from anon, authenticated;
grant select on public.application_assignment_history to authenticated;
drop policy if exists "assignment history: read" on public.application_assignment_history;
create policy "assignment history: read" on public.application_assignment_history for select to authenticated
  using ((select public.my_profile_ok()) and (select public.is_staff()) and (select public.staff_can('applications')));

-- Only Admin Portal users change assigned_to directly; everyone else goes through assign_application().
create or replace function public.guard_application_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.assigned_to is distinct from old.assigned_to and public.is_end_user_request()
     and coalesce(current_setting('ssi.assign_via_rpc', true), '') <> 'on' and not public.application_assign_admin() then
    raise exception 'Use “Assigned staff” in the application to assign it';
  end if;
  return new;
end $$;
drop trigger if exists applications_assignment_guard on public.applications;
create trigger applications_assignment_guard before update of assigned_to on public.applications
  for each row execute function public.guard_application_assignment();

create or replace function public.log_application_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.assigned_to is not null) or (tg_op = 'UPDATE' and new.assigned_to is distinct from old.assigned_to) then
    insert into public.application_assignment_history (application_id, application_ref, previous_staff, previous_name, new_staff, new_name, assigned_by, assigned_by_name, reason)
    values (new.id, new.ref,
            case when tg_op = 'UPDATE' then old.assigned_to end,
            (select full_name from public.profiles where id = case when tg_op = 'UPDATE' then old.assigned_to end),
            new.assigned_to, (select full_name from public.profiles where id = new.assigned_to),
            auth.uid(), (select full_name from public.profiles where id = auth.uid()),
            nullif(btrim(coalesce(current_setting('ssi.assign_reason', true), '')), ''));
  end if;
  return null;
end $$;
drop trigger if exists applications_assignment_history on public.applications;
create trigger applications_assignment_history after insert or update of assigned_to on public.applications
  for each row execute function public.log_application_assignment();

-- Who can be chosen for this application: Application Team members (with their open workload);
-- Admin Portal users also see every other active employee (as before). Empty when not allowed.
create or replace function public.application_assignees(p_app text)
returns table (id uuid, full_name text, designation text, role text, open_applications bigint, application_team boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, coalesce(d.name, e.designation_id), p.role,
         (select count(*) from public.applications a where a.assigned_to = p.id
            and a.status not in ('Visa Granted', 'Visa Refused', 'Withdrawn', 'Closed', 'Rejected')),
         public.is_application_team(p.id)
  from public.profiles p
  left join public.employees e on e.id = p.id
  left join public.designations d on d.id = e.designation_id
  where public.can_assign_application(p_app)
    and p.status = 'active' and p.role = any (public.staff_roles()) and coalesce(e.employment_status, 'Active') <> 'Resigned'
    and (public.is_application_team(p.id) or public.application_assign_admin())
  order by public.is_application_team(p.id) desc, p.full_name;
$$;

create or replace function public.assign_application(p_app text, p_assignee uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; nm text;
begin
  if not (public.my_profile_ok() and public.is_staff()) then raise exception 'Not allowed'; end if;
  select id, ref, assigned_to into a from public.applications where id = p_app for update;
  if a.id is null then raise exception 'Application not found'; end if;
  if not public.can_assign_application(p_app) then
    raise exception 'You can only assign applications of your own clients and leads';
  end if;
  if char_length(coalesce(p_reason, '')) > 500 then raise exception 'Keep the reason under 500 characters'; end if;
  if p_assignee is null then
    if not public.application_assign_admin() then raise exception 'Only Admin can remove the assigned staff'; end if;
  elsif not public.is_application_team(p_assignee) then
    if not (public.application_assign_admin() and exists (
          select 1 from public.profiles p left join public.employees e on e.id = p.id
          where p.id = p_assignee and p.status = 'active' and p.role = any (public.staff_roles()) and coalesce(e.employment_status, 'Active') <> 'Resigned')) then
      raise exception 'Choose an active Application Team member';
    end if;
  end if;
  select full_name into nm from public.profiles where id = p_assignee;
  if a.assigned_to is not distinct from p_assignee then
    return jsonb_build_object('id', a.id, 'assigned_to', p_assignee, 'assigned_name', nm, 'changed', false);
  end if;
  perform set_config('ssi.assign_via_rpc', 'on', true);
  perform set_config('ssi.assign_reason', coalesce(btrim(p_reason), ''), true);
  update public.applications set assigned_to = p_assignee where id = p_app;
  perform set_config('ssi.assign_via_rpc', '', true);
  perform set_config('ssi.assign_reason', '', true);
  return jsonb_build_object('id', a.id, 'assigned_to', p_assignee, 'assigned_name', nm, 'changed', true);
end $$;

revoke all on function public.is_application_team(uuid) from public, anon;
revoke all on function public.application_assign_admin() from public, anon;
revoke all on function public.can_assign_application(text) from public, anon;
revoke all on function public.application_assignees(text) from public, anon;
revoke all on function public.assign_application(text, uuid, text) from public, anon;
grant execute on function public.is_application_team(uuid) to authenticated;
grant execute on function public.application_assign_admin() to authenticated;
grant execute on function public.can_assign_application(text) to authenticated;
grant execute on function public.application_assignees(text) to authenticated;
grant execute on function public.assign_application(text, uuid, text) to authenticated;

-- =============================================================== 2. permanent deletion: Super Admin only
-- Plain DELETE policies are replaced; "for all" policies are split so create / read / edit stay exactly
-- as they were and only delete changes.
do $$
declare r record; t text; ins text; upd text;
begin
  foreach t in array array['applications', 'students', 'documents', 'tasks'] loop
    for r in select policyname from pg_policies where schemaname = 'public' and tablename = t and cmd = 'DELETE' loop
      execute format('drop policy %I on public.%I', r.policyname, t);
    end loop;
  end loop;
  for r in select tablename, policyname, qual, with_check, roles from pg_policies
           where schemaname = 'public' and cmd = 'ALL'
             and tablename in ('assessments', 'payments', 'universities', 'courses', 'course_intakes', 'blacklisted_institutions') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    ins := coalesce(r.with_check, r.qual);
    execute format('create policy %I on public.%I for select to %s using (%s)', r.policyname || ' (read)', r.tablename, array_to_string(r.roles, ','), r.qual);
    execute format('create policy %I on public.%I for insert to %s with check (%s)', r.policyname || ' (add)', r.tablename, array_to_string(r.roles, ','), ins);
    execute format('create policy %I on public.%I for update to %s using (%s) with check (%s)', r.policyname || ' (edit)', r.tablename, array_to_string(r.roles, ','), r.qual, ins);
  end loop;
  foreach t in array array['applications', 'students', 'documents', 'tasks', 'assessments', 'payments', 'universities', 'courses', 'course_intakes', 'blacklisted_institutions'] loop
    execute format('drop policy if exists %I on public.%I', t || ': super admin delete', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.is_super_admin()))', t || ': super admin delete', t);
  end loop;
end $$;

drop policy if exists "student docs: delete" on storage.objects;
create policy "student docs: delete" on storage.objects for delete to authenticated using (
  bucket_id = 'student-documents' and (
    public.is_super_admin()
    or (not exists (select 1 from public.documents d where d.storage_path = objects.name)
        and (public.staff_can('documents') or ((storage.foldername(name))[1] = public.my_partner_id() and public.partner_can('documents'))))));

-- No silent cascade: a student's applications must be deleted on purpose first.
create or replace function public.guard_student_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_end_user_request() and exists (select 1 from public.applications a where a.student_id = old.id) then
    raise exception 'This student has applications. Delete the applications first.';
  end if;
  return old;
end $$;
drop trigger if exists students_delete_guard on public.students;
create trigger students_delete_guard before delete on public.students for each row execute function public.guard_student_delete();

-- =============================================================== 3. manual Pending Work / Tomorrow's Plan tasks
alter table public.tasks add column if not exists origin text;
alter table public.tasks add column if not exists notes text;
alter table public.tasks add column if not exists request_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_origin_check') then
    alter table public.tasks add constraint tasks_origin_check check (origin is null or origin in ('pending_work', 'tomorrows_plan'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_notes_length') then
    alter table public.tasks add constraint tasks_notes_length check (char_length(coalesce(notes, '')) <= 2000 and char_length(coalesce(related, '')) <= 300);
  end if;
end $$;
create unique index if not exists tasks_request_id_key on public.tasks (request_id) where request_id is not null;
create index if not exists tasks_mine_open_idx on public.tasks (assigned_to, start_date) where kind = 'assignment' and status not in ('Completed', 'Cancelled');

-- Creates (p_id null) or edits one of the employee's own tasks. Due and planned dates are company dates
-- (Asia/Kolkata). The default planned day for Tomorrow's Plan is the employee's next working day.
create or replace function public.save_my_task(p_id text, p_title text, p_description text, p_priority text, p_due date,
                                               p_planned date, p_related text, p_notes text, p_origin text, p_request uuid default null)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); t record; rid text; today date := public.company_today(); pl date; du date; nm text;
begin
  if me is null or not (public.my_profile_ok() and public.is_staff()) then raise exception 'Not permitted'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 300 then raise exception 'Enter a title of 3 to 300 characters'; end if;
  if char_length(coalesce(p_description, '')) > 4000 then raise exception 'The description is too long'; end if;
  if char_length(coalesce(p_notes, '')) > 2000 then raise exception 'The notes are too long'; end if;
  if char_length(coalesce(p_related, '')) > 300 then raise exception 'The related record is too long'; end if;
  if coalesce(p_priority, '') not in ('High', 'Medium', 'Normal') then raise exception 'Unknown priority'; end if;
  if coalesce(p_origin, '') not in ('pending_work', 'tomorrows_plan') then raise exception 'Unknown task list'; end if;
  pl := case when p_origin = 'tomorrows_plan' then coalesce(p_planned, public.next_working_day(me, today)) else p_planned end;
  du := coalesce(p_due, pl, today);
  if pl is not null and du < pl then raise exception 'The due date is before the planned date'; end if;
  select full_name into nm from public.profiles where id = me;
  if p_id is null then
    if p_request is not null then
      select id into rid from public.tasks where request_id = p_request and assigned_to = me;
      if rid is not null then return rid; end if;
    end if;
    if pl is not null and pl < today then raise exception 'The planned date cannot be in the past'; end if;
    if du < today then raise exception 'The due date cannot be in the past'; end if;
    insert into public.tasks (kind, title, description, assigned_to, assignee, assigned_by, priority, due, start_date, status, progress, done,
                              created_by, origin, related, notes, request_id)
    values ('assignment', btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), me, nm, me, p_priority,
            (du + time '18:00') at time zone 'Asia/Kolkata', pl, 'Not Started', 0, false, me, p_origin,
            nullif(btrim(coalesce(p_related, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''), p_request)
    returning id into rid;
    insert into public.task_events (task_id, actor, action, detail)
    values (rid, me, 'created', jsonb_build_object('assignee', me, 'due', du, 'planned', pl, 'priority', p_priority, 'origin', p_origin));
    return rid;
  end if;
  select * into t from public.tasks where id = p_id and kind = 'assignment' for update;
  if t.id is null then raise exception 'Task not found'; end if;
  if t.assigned_to is distinct from me or t.assigned_by is distinct from me then raise exception 'You can only edit tasks you added yourself'; end if;
  if t.status in ('Completed', 'Cancelled') then raise exception 'This task is already closed'; end if;
  if pl is not null and pl < today and pl is distinct from t.start_date then raise exception 'The planned date cannot be in the past'; end if;
  update public.tasks set title = btrim(p_title), description = nullif(btrim(coalesce(p_description, '')), ''), priority = p_priority,
    due = (du + time '18:00') at time zone 'Asia/Kolkata', start_date = pl, related = nullif(btrim(coalesce(p_related, '')), ''),
    notes = nullif(btrim(coalesce(p_notes, '')), '')
  where id = p_id;
  insert into public.task_events (task_id, actor, action, detail)
  values (p_id, me, 'edited', jsonb_build_object('due', du, 'planned', pl, 'priority', p_priority));
  return p_id;
end $$;

create or replace function public.cancel_my_task(p_id text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  select * into t from public.tasks where id = p_id and kind = 'assignment' for update;
  if t.id is null then raise exception 'Task not found'; end if;
  if t.assigned_to is distinct from auth.uid() or t.assigned_by is distinct from auth.uid() then raise exception 'You can only cancel tasks you added yourself'; end if;
  if t.status in ('Completed', 'Cancelled') then raise exception 'This task is already closed'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Enter a reason'; end if;
  update public.tasks set status = 'Cancelled', done = false, last_note = btrim(p_reason) where id = p_id;
  insert into public.task_events (task_id, actor, action, detail) values (p_id, auth.uid(), 'cancelled', jsonb_build_object('reason', btrim(p_reason)));
end $$;

-- As 0027, without notifying people about their own tasks.
create or replace function public.update_assignment_progress(p_id text, p_status text, p_progress integer, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t record; prog int;
begin
  select * into t from public.tasks where id = p_id and kind = 'assignment' for update;
  if t.id is null then raise exception 'Assignment not found'; end if;
  if not (t.assigned_to = auth.uid() or t.assigned_by = auth.uid() or public.is_super_admin() or public.is_hr() or public.in_my_team(t.assigned_to)) then
    raise exception 'You cannot update this assignment';
  end if;
  if t.status = 'Cancelled' then raise exception 'This assignment was cancelled'; end if;
  if p_status not in ('Not Started', 'In Progress', 'On Hold', 'Completed') then raise exception 'Unknown status'; end if;
  if char_length(coalesce(p_note, '')) > 1000 then raise exception 'The note is too long'; end if;
  prog := case when p_status = 'Completed' then 100 when p_status = 'Not Started' then 0 else least(greatest(coalesce(p_progress, t.progress), 0), 99) end;
  if p_status = 'On Hold' and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Say why the work is on hold'; end if;
  update public.tasks set status = p_status, progress = prog, done = (p_status = 'Completed'),
    completed_at = case when p_status = 'Completed' then coalesce(t.completed_at, now()) else null end,
    last_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), last_note) where id = p_id;
  insert into public.task_events (task_id, actor, action, detail) values (p_id, auth.uid(),
    case when p_status = 'Completed' and t.status <> 'Completed' then 'completed' when t.status = 'Completed' and p_status <> 'Completed' then 'reopened' else 'progress' end,
    jsonb_build_object('status', p_status, 'progress', prog, 'note', nullif(btrim(coalesce(p_note, '')), '')));
  if t.assigned_by is not null and t.assigned_by is distinct from auth.uid() then
    if p_status = 'Completed' and t.status <> 'Completed' then
      perform public.notify(array[t.assigned_by], 'task', 'Work completed: ' || t.title, (select full_name from public.profiles where id = t.assigned_to), 'hr/work');
    elsif p_status = 'On Hold' then
      perform public.notify(array[t.assigned_by], 'task', 'Work on hold: ' || t.title, btrim(p_note), 'hr/work');
    end if;
  end if;
end $$;

revoke all on function public.save_my_task(text, text, text, text, date, date, text, text, text, uuid) from public, anon;
revoke all on function public.cancel_my_task(text, text) from public, anon;
grant execute on function public.save_my_task(text, text, text, text, date, date, text, text, text, uuid) to authenticated;
grant execute on function public.cancel_my_task(text, text) to authenticated;

-- Pending work for every employee: agency and lead work as before (when the employee has that access),
-- plus their open tasks, and Tomorrow's Plan including tasks planned for the next working day.
create or replace function public.my_pending_work(p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid(); d date := coalesce(p_date, public.company_today()); res jsonb := '{}'; nd date; ag boolean := public.agency_access(); ld boolean := public.lead_access();
begin
  if me is null or not public.is_staff() then return null; end if;
  nd := public.next_working_day(me, d);
  if ag then
    select jsonb_build_object(
      'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'prospect_id', t.prospect_id, 'agency', coalesce(a.company_name, a.contact_name, a.reference),
                   'reference', a.reference, 'due_date', t.due_date, 'due_time', t.due_time, 'attendee', t.attendee, 'note', t.note, 'overdue', t.due_date < d,
                   'carry_count', t.carry_count, 'created_at', t.created_at) order by t.due_date, t.due_time nulls last)
                 from public.agency_tasks t join public.agency_prospects a on a.id = t.prospect_id
                 where t.status = 'open' and coalesce(t.assigned_to, t.created_by) = me and t.due_date <= d + 7), '[]'),
      'linkedin', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'reference', l.reference, 'due_date', l.next_follow_up, 'overdue', l.next_follow_up < d,
                   'contact_status', l.contact_status, 'auto', l.next_follow_up_auto) order by l.next_follow_up)
                 from public.linkedin_prospects l where l.assigned_to = me and l.status not in ('converted', 'not_interested')
                   and l.next_follow_up is not null and l.next_follow_up <= d), '[]'),
      'linkedin_pending_contacts', (select count(*) from public.linkedin_prospects l where l.assigned_to = me and l.status not in ('converted', 'not_interested') and l.contact_status <> 'connected'),
      'not_connected', (select count(*) from public.agency_prospects p where p.assigned_officer = me and p.contact_status <> 'connected'
                          and p.stage not in ('onboarded', 'closed', 'inactive')),
      'open_attempts', (select count(*) from public.agency_activities x where x.kind = 'contact_attempt' and x.resolved_at is null and x.actor = me))
    into res;
  end if;
  if ld then
    res := res || jsonb_build_object(
      'leads', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'lead_id', t.lead_id, 'name', l.name, 'reference', l.reference, 'due_date', t.due_date,
                   'due_time', t.due_time, 'note', t.note, 'overdue', t.due_date < d, 'carry_count', t.carry_count) order by t.due_date, t.due_time nulls last)
                 from public.lead_tasks t join public.leads l on l.id = t.lead_id
                 where t.status = 'open' and coalesce(t.assigned_to, t.created_by) = me and t.due_date <= d), '[]'),
      'lead_pending', (select count(*) from public.leads l where l.assigned_to = me and public.lead_queue(l.stage, l.contact_status, l.no_response) = 'pending'),
      'lead_no_response', (select count(*) from public.leads l where l.assigned_to = me and public.lead_queue(l.stage, l.contact_status, l.no_response) = 'no_response'));
  end if;
  res := res || jsonb_build_object('date', d, 'next_day', nd,
    -- Open tasks actionable on this day (planned day reached, created by then): the same rows as My Assigned Tasks.
    'my_tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'description', t.description, 'priority', t.priority,
                   'due_date', (t.due at time zone 'Asia/Kolkata')::date, 'planned_date', t.start_date, 'related', t.related, 'notes', t.notes,
                   'status', t.status, 'manual', t.assigned_by = me, 'origin', t.origin, 'overdue', (t.due at time zone 'Asia/Kolkata')::date < d,
                   'created_at', t.created_at) order by t.due, t.created_at)
                 from public.tasks t
                 where t.kind = 'assignment' and t.assigned_to = me and t.status not in ('Completed', 'Cancelled')
                   and coalesce(t.start_date, d) <= d and (t.created_at at time zone 'Asia/Kolkata')::date <= d), '[]'),
    'tomorrow', coalesce((select jsonb_agg(x.item order by x.due_time nulls last, x.title) from (
        select jsonb_build_object('title', 'Lead follow-up · ' || l.name, 'reference', l.reference, 'due_date', t.due_date, 'due_time', t.due_time, 'note', t.note) item, t.due_time, l.name title
        from public.lead_tasks t join public.leads l on l.id = t.lead_id
        where ld and t.status = 'open' and coalesce(t.assigned_to, t.created_by) = me and t.due_date > d and t.due_date <= nd
        union all
        select jsonb_build_object('title', initcap(replace(t.kind, '_', '-')) || ' · ' || coalesce(a.company_name, a.contact_name, a.reference), 'reference', a.reference,
               'due_date', t.due_date, 'due_time', t.due_time, 'note', t.note), t.due_time, coalesce(a.company_name, a.reference)
        from public.agency_tasks t join public.agency_prospects a on a.id = t.prospect_id
        where ag and t.status = 'open' and coalesce(t.assigned_to, t.created_by) = me and t.due_date > d and t.due_date <= nd
        union all
        select jsonb_build_object('title', 'LinkedIn follow-up · ' || l.name, 'reference', l.reference, 'due_date', l.next_follow_up, 'due_time', null, 'note', null), null::time, l.name
        from public.linkedin_prospects l
        where ag and l.assigned_to = me and l.status not in ('converted', 'not_interested') and l.next_follow_up > d and l.next_follow_up <= nd
        union all
        -- tasks planned for the next working day (manual or assigned with a start date)
        select jsonb_build_object('title', t.title, 'reference', t.related, 'due_date', t.start_date, 'due_time', null, 'note', t.description,
               'task_id', t.id, 'manual', t.assigned_by = me, 'priority', t.priority), null::time, t.title
        from public.tasks t
        where t.kind = 'assignment' and t.assigned_to = me and t.status not in ('Completed', 'Cancelled')
          and t.start_date > d and t.start_date <= nd) x), '[]'),
    'support', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'created_at', r.created_at, 'escalated', r.escalated_at is not null) order by r.created_at)
                 from public.support_requests r where r.employee_id = me and r.status = 'open'), '[]'));
  return res;
end $$;
