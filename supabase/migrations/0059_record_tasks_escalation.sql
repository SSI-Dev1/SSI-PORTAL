-- Assign Task / Escalate from a Student or an Application (20 Nov 2026). Safe to run more than once.
--
-- No new task system: a record task is a row of the existing task system (tasks, kind = 'assignment',
-- history in task_events, read through can_see_assignment, progress through update_assignment_progress),
-- linked to the student and/or application it was raised from.
--
--   category 'task'        delegated work — to the employee's own team (reporting hierarchy, as
--                          can_assign_to), or to an eligible Application Team member when the employee is a
--                          Partner Success Officer or a manager (operational delegation). Super Admin and HR:
--                          any active employee (unchanged rule of can_assign_to).
--   category 'escalation'  an issue sent up the reporting line: the employee's managers (direct manager
--                          first) or a Super Admin (the configured higher authority). The recipient answers
--                          it from My Assigned Tasks (In Progress / Completed with the outcome).
--
-- Neither touches the record: application status, Assigned staff, Main / Sub Officer and partner stay as
-- they are. The employee must have access to the record (Partner Success Officers: their own clients,
-- leads and applications, as 0058). Notifications carry the task title and the application reference,
-- never the student's personal details. Creating a task is logged as an assignment activity (shown in
-- Time / Action done, not counted as completed work); completion is credited to the employee it was
-- assigned to — never to the manager — and a resolved escalation counts as "Escalation resolved".

alter table public.tasks add column if not exists category text;
alter table public.tasks add column if not exists student_id text references public.students (id) on delete set null;
alter table public.tasks add column if not exists application_id text references public.applications (id) on delete set null;
alter table public.tasks add column if not exists escalation_reason text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_category_check') then
    alter table public.tasks add constraint tasks_category_check check (category is null or category in ('task', 'escalation'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_escalation_reason_length') then
    alter table public.tasks add constraint tasks_escalation_reason_length check (char_length(coalesce(escalation_reason, '')) <= 2000);
  end if;
end $$;
create index if not exists tasks_student_idx on public.tasks (student_id) where student_id is not null;
create index if not exists tasks_application_idx on public.tasks (application_id) where application_id is not null;

insert into public.work_activity_types (id, label, source, description, sort) values
  ('task_assigned', 'Task assigned to a colleague', 'crm', 'You delegated a follow-up task (not completed work)', 101),
  ('task_escalated', 'Issue escalated', 'crm', 'You escalated an issue to a manager (not completed work)', 102)
on conflict (id) do nothing;

-- =============================================================== access to the record
create or replace function public.record_task_access(p_student text, p_app text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid(); st text; limited boolean;
begin
  if me is null or not (public.my_profile_ok() and public.is_staff()) then return false; end if;
  if p_app is not null then
    select student_id into st from public.applications where id = p_app;
    if st is null then return false; end if;
    if p_student is not null and p_student <> st then return false; end if;
  else
    st := p_student;
    if st is null or not exists (select 1 from public.students where id = st) then return false; end if;
  end if;
  if public.is_super_admin() or public.application_assign_admin() then return true; end if;
  -- Partner Success Officers: only their own clients, leads and applications (My Clients / Sub Officer rules).
  limited := public.staff_can('partner_success');
  if p_app is not null then
    if not public.staff_can('applications') then return false; end if;
    return not limited or public.can_assign_application(p_app);
  end if;
  if not public.staff_can('students') then return false; end if;
  return not limited or exists (
    select 1 from public.students s where s.id = st and (
         s.created_by = me
      or exists (select 1 from public.onboarded_client_directory() d where d.mine and d.partner_id = s.partner_id)
      or exists (select 1 from public.leads l where l.student_id = s.id and l.assigned_to = me)
      or exists (select 1 from public.applications a where a.student_id = s.id and public.can_assign_application(a.id))));
end $$;

-- =============================================================== who can receive it
create or replace function public.can_delegate_to(p_emp uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_emp is not null and p_emp <> auth.uid() and public.my_profile_ok() and (
    public.can_assign_to(p_emp)                                   -- Super Admin, HR, own reporting line
    or (public.is_application_team(p_emp)                         -- operational delegation to Application Team
        and (public.staff_can('partner_success') or exists (select 1 from public.employees e where e.reporting_manager_id = auth.uid()))));
$$;

-- The employee's managers up the reporting line (1 = direct manager), then the Super Admins.
create or replace function public.escalation_chain()
returns table (id uuid, level integer)
language sql stable security definer set search_path = '' as $$
  with recursive up(id, level) as (
    select e.reporting_manager_id, 1 from public.employees e where e.id = auth.uid() and e.reporting_manager_id is not null
    union
    select e.reporting_manager_id, up.level + 1 from public.employees e join up on e.id = up.id where e.reporting_manager_id is not null and up.level < 20
  ), c as (
    select up.id, min(up.level) as level from up group by up.id
    union all
    select p.id, 99 from public.profiles p where p.role = 'super_admin'
  )
  select c.id, min(c.level)::int from c
  join public.profiles p on p.id = c.id and p.status = 'active' and p.role = any (public.staff_roles())
  left join public.employees e on e.id = c.id
  where c.id <> auth.uid() and coalesce(e.employment_status, 'Active') <> 'Resigned'
  group by c.id;
$$;

create or replace function public.can_escalate_to(p_emp uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.escalation_chain() c where c.id = p_emp);
$$;

-- Choices for the Assign Task / Escalate form of one record (empty when the record is not accessible).
create or replace function public.record_task_people(p_student text, p_app text)
returns table (id uuid, full_name text, designation text, role text, kind text, level integer, open_tasks bigint)
language sql stable security definer set search_path = '' as $$
  with ok as (select public.record_task_access(p_student, p_app) as v),
  people as (
    select p.id, 'assign'::text as kind, null::int as level from public.profiles p, ok
    where ok.v and p.status = 'active' and public.can_delegate_to(p.id)
    union all
    select c.id, 'escalate', c.level from public.escalation_chain() c, ok where ok.v
  )
  select x.id, p.full_name, coalesce(d.name, e.designation_id), p.role, x.kind, x.level,
         (select count(*) from public.tasks t where t.kind = 'assignment' and t.assigned_to = x.id and t.status not in ('Completed', 'Cancelled'))
  from people x join public.profiles p on p.id = x.id
  left join public.employees e on e.id = x.id
  left join public.designations d on d.id = e.designation_id
  order by x.kind, x.level nulls first, p.full_name;
$$;

-- =============================================================== create
create or replace function public.create_record_task(p_category text, p_student text, p_app text, p_title text, p_description text,
                                                     p_assignee uuid, p_priority text, p_due date, p_notes text default null,
                                                     p_reason text default null, p_request uuid default null)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); st text := p_student; ref text; nm text; rid text; rel text; today date := public.company_today(); act text;
begin
  if me is null or not (public.my_profile_ok() and public.is_staff()) then raise exception 'Not permitted'; end if;
  if coalesce(p_category, '') not in ('task', 'escalation') then raise exception 'Choose Assign Task or Escalate'; end if;
  if p_student is null and p_app is null then raise exception 'Open a student or an application first'; end if;
  if p_request is not null then
    select id into rid from public.tasks where request_id = p_request and assigned_by = me;
    if rid is not null then return rid; end if;                 -- double click / retry: the same task
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 300 then raise exception 'Enter a title of 3 to 300 characters'; end if;
  if char_length(coalesce(p_description, '')) > 4000 then raise exception 'The description is too long'; end if;
  if char_length(coalesce(p_notes, '')) > 2000 then raise exception 'The notes are too long'; end if;
  if coalesce(p_priority, '') not in ('High', 'Medium', 'Normal') then raise exception 'Unknown priority'; end if;
  if p_due is null then raise exception 'Choose a due date'; end if;
  if p_due < today then raise exception 'The due date cannot be in the past'; end if;
  if p_category = 'escalation' and length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'Give the reason for the escalation (at least 10 characters)'; end if;
  if char_length(coalesce(p_reason, '')) > 2000 then raise exception 'The reason is too long'; end if;
  if not public.record_task_access(p_student, p_app) then raise exception 'You do not have access to this record'; end if;
  if p_category = 'task' and not public.can_delegate_to(p_assignee) then
    raise exception 'You can assign tasks only to your team or to eligible Application Team members';
  end if;
  if p_category = 'escalation' and not public.can_escalate_to(p_assignee) then
    raise exception 'Escalate only to your reporting manager or a higher authority';
  end if;
  if p_app is not null then
    select a.student_id, a.ref into st, ref from public.applications a where a.id = p_app;
    rel := 'Application ' || ref;
  else
    select 'Student · ' || s.first_name || ' ' || left(s.last_name, 1) || '.' into rel from public.students s where s.id = st;
  end if;
  select full_name into nm from public.profiles where id = p_assignee;
  insert into public.tasks (kind, category, title, description, assigned_to, assignee, assigned_by, priority, due, status, progress, done, created_by,
                            student_id, application_id, related, notes, escalation_reason, request_id)
  values ('assignment', p_category, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_assignee, nm, me, p_priority,
          (p_due + time '18:00') at time zone 'Asia/Kolkata', 'Not Started', 0, false, me,
          st, p_app, rel, nullif(btrim(coalesce(p_notes, '')), ''), nullif(btrim(coalesce(p_reason, '')), ''), p_request)
  returning id into rid;
  insert into public.task_events (task_id, actor, action, detail)
  values (rid, me, 'created', jsonb_build_object('category', p_category, 'assignee', p_assignee, 'due', p_due, 'priority', p_priority,
                                                 'student', st, 'application', p_app, 'reason', nullif(btrim(coalesce(p_reason, '')), '')));
  -- Notification: title and application reference only — no student personal data.
  perform public.notify(array[p_assignee], 'task',
    case when p_category = 'escalation' then 'Escalated to you: ' else 'New task: ' end || btrim(p_title),
    concat_ws(' · ', ref, 'Due ' || to_char(p_due, 'DD Mon YYYY'), p_priority || ' priority',
              'from ' || coalesce((select full_name from public.profiles where id = me), 'a colleague')),
    'work/assigned');
  -- The assigner's own activity: shown in Time / Action done, not counted as completed work.
  act := case when p_category = 'escalation' then 'task_escalated' else 'task_assigned' end;
  perform public.record_work_activity(me, act, act || ':' || rid, 'task', rid, p_app, st, null, null, null, 1, btrim(p_title));
  return rid;
end $$;

revoke all on function public.record_task_access(text, text) from public, anon;
revoke all on function public.can_delegate_to(uuid) from public, anon;
revoke all on function public.escalation_chain() from public, anon;
revoke all on function public.can_escalate_to(uuid) from public, anon;
revoke all on function public.record_task_people(text, text) from public, anon;
revoke all on function public.create_record_task(text, text, text, text, text, uuid, text, date, text, text, uuid) from public, anon;
grant execute on function public.record_task_access(text, text) to authenticated;
grant execute on function public.can_delegate_to(uuid) to authenticated;
grant execute on function public.escalation_chain() to authenticated;
grant execute on function public.can_escalate_to(uuid) to authenticated;
grant execute on function public.record_task_people(text, text) to authenticated;
grant execute on function public.create_record_task(text, text, text, text, text, uuid, text, date, text, text, uuid) to authenticated;

-- =============================================================== completion credit
-- Work completed is credited to the employee who did it: for assigned work, only when that employee
-- closes it themself (a manager closing a subordinate's task is not credited with the work).
-- A resolved escalation counts as "Escalation resolved" for the manager who handled it.
create or replace function public.track_other_work()
returns trigger language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_employee_id(); d text := public.company_today()::text;
begin
  if me is null then return new; end if;
  -- One branch per table: a record only has its own table's columns.
  if tg_table_name = 'documents' then
    if new.status = 'Verified' and old.status is distinct from 'Verified' then
      perform public.record_work_activity(me, 'document_verified', 'doc-ok:' || new.id || ':' || me || ':' || d, 'document', new.id, null, new.student_id, new.partner_id, old.status, new.status);
    end if;
  elsif tg_table_name = 'assessments' then
    if new.status in ('Eligible', 'Not Eligible') and old.status not in ('Eligible', 'Not Eligible') then
      perform public.record_work_activity(me, 'assessment_completed', 'assess:' || new.id || ':' || me || ':' || d, 'assessment', new.id, null, new.student_id, new.partner_id, old.status, new.status);
    end if;
  elsif tg_table_name = 'tasks' then
    if new.done and not old.done and (new.kind <> 'assignment' or new.assigned_to is not distinct from me) then
      if new.category = 'escalation' then
        perform public.record_work_activity(me, 'escalation_resolved', 'esc:' || new.id || ':' || me, 'task', new.id, new.application_id, new.student_id, null, 'open', 'done', 1, new.title);
      else
        perform public.record_work_activity(me, 'task_completed', 'task:' || new.id || ':' || me || ':' || d, 'task', new.id, new.application_id, new.student_id, null, 'open', 'done', 1, new.title);
      end if;
    end if;
  end if;
  return new;
end $$;

-- One notification per assignment: assigned work (kind = 'assignment') is notified by the function that
-- creates it (save_assignment, create_record_task); the generic trigger keeps plain tasks only. Without
-- this, assignments were notified twice and own planned tasks (0058) notified their own author.
drop trigger if exists tasks_notify on public.tasks;
create trigger tasks_notify after insert or update on public.tasks
  for each row when (new.kind = 'task') execute function public.notify_on_change();
