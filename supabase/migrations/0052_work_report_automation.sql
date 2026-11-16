-- Daily Work Report: HR automation, HR report, activity timeline, manual work (16 Nov 2026).
--
-- The central engine already exists: every qualifying CRM action writes one work_activities row
-- (record_work_activity, unique dedupe_key, so retries / double clicks / realtime never add a second
-- one), report figures are computed on the server from those rows (compute_report_metrics), and a
-- submitted report is a frozen snapshot with its source activity ids. Gaps closed here:
--
-- 1. HR work was never recorded and HR designations had no report template, so HR could not file a
--    report at all. Leave decisions, attendance-correction decisions, employee-document reviews and
--    new employee records now record an activity for the person who actually decided / created it.
-- 2. HR report (designations hr_manager, hr_staff): completed HR work plus the HR queues (pending
--    leave, attendance corrections, documents) — pending counts never add to completed work.
-- 3. my_work_timeline(): the day's activities in time order for the report timeline, read with the
--    caller's own row-level security (own work, or a team the caller may view; nothing more).
-- 4. manual_work: "Work outside the CRM", logged by the employee, shown as Manual in the timeline and
--    never mapped to any report figure, so it cannot inflate automated totals.

-- ================================================================ activity types
insert into public.work_activity_types (id, label, source, description, sort) values
  ('hr_employee_created',    'Employee record created',        'crm',    'You created an employee record', 70),
  ('hr_leave_processed',     'Leave request processed',        'crm',    'You approved or rejected a leave request', 71),
  ('hr_attendance_reviewed', 'Attendance correction reviewed', 'crm',    'You approved or rejected an attendance correction', 72),
  ('hr_document_processed',  'Employee document processed',    'crm',    'You verified or rejected an employee document', 73),
  ('hr_onboarding',          'Employee onboarding activity',   'logged', 'Onboarding work done outside the CRM (induction, setup)', 74),
  ('hr_request_completed',   'HR request completed',           'logged', 'An authorised HR request completed outside the CRM', 75),
  ('manual_work',            'Work outside the CRM',           'logged', 'Work done outside SSI GLOBAL — shown as manual, never added to report figures', 99)
on conflict (id) do update set label = excluded.label, source = excluded.source, description = excluded.description, sort = excluded.sort;

-- ================================================================ HR triggers
-- The actor is whoever made the decision (decided_by / reviewed_by, set by the HR functions from the
-- signed-in user). One activity per record and outcome; re-saving the same decision adds nothing.
create or replace function public.track_hr_work()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'leave_requests' then
    if new.decided_by is not null and new.status in ('Approved', 'Rejected')
       and (tg_op = 'INSERT' or old.status is distinct from new.status or old.decided_by is distinct from new.decided_by) then
      perform public.record_work_activity(new.decided_by, 'hr_leave_processed', 'hr-leave:' || new.id || ':' || new.status,
        'leave', new.id::text, null, null, null, case when tg_op = 'UPDATE' then old.status end, new.status);
    end if;
  elsif tg_table_name = 'attendance_corrections' then
    if new.decided_by is not null and new.status in ('Approved', 'Rejected')
       and (tg_op = 'INSERT' or old.status is distinct from new.status or old.decided_by is distinct from new.decided_by) then
      perform public.record_work_activity(new.decided_by, 'hr_attendance_reviewed', 'hr-att:' || new.id || ':' || new.status,
        'attendance_correction', new.id::text, null, null, null, case when tg_op = 'UPDATE' then old.status end, new.status);
    end if;
  elsif tg_table_name = 'employee_documents' then
    if new.reviewed_by is not null and new.review_status in ('Verified', 'Rejected')
       and (tg_op = 'INSERT' or old.review_status is distinct from new.review_status or old.reviewed_by is distinct from new.reviewed_by) then
      perform public.record_work_activity(new.reviewed_by, 'hr_document_processed', 'hr-doc:' || new.id || ':' || new.review_status,
        'employee_document', new.id::text, null, null, null, case when tg_op = 'UPDATE' then old.review_status end, new.review_status);
    end if;
  elsif tg_table_name = 'employees' then
    -- Created by a signed-in employee (HR); service jobs and imports are not anyone's work.
    if public.my_employee_id() is not null and public.my_employee_id() <> new.id then
      perform public.record_work_activity(public.my_employee_id(), 'hr_employee_created', 'hr-emp:' || new.id, 'employee', new.id::text);
    end if;
  end if;
  return new;
end $$;
revoke all on function public.track_hr_work() from public, anon, authenticated;

drop trigger if exists leave_requests_track_work on public.leave_requests;
create trigger leave_requests_track_work after insert or update of status, decided_by on public.leave_requests
  for each row execute function public.track_hr_work();
drop trigger if exists attendance_corrections_track_work on public.attendance_corrections;
create trigger attendance_corrections_track_work after insert or update of status, decided_by on public.attendance_corrections
  for each row execute function public.track_hr_work();
drop trigger if exists employee_documents_track_work on public.employee_documents;
create trigger employee_documents_track_work after insert or update of review_status, reviewed_by on public.employee_documents
  for each row execute function public.track_hr_work();
drop trigger if exists employees_track_work on public.employees;
create trigger employees_track_work after insert on public.employees
  for each row execute function public.track_hr_work();

-- ================================================================ HR queues (pending, not completed work)
create or replace function public.report_pending_hr(p_emp uuid, p_key text, p_date date)
returns jsonb language sql stable security definer set search_path = '' as $$
  -- Organisation-wide HR queues, shown only to HR (counts only; no employee details).
  select jsonb_build_object('kind', 'pending', 'value',
    case when not exists (select 1 from public.employees e where e.id = p_emp
                          and ('hr_manager' = any (array[e.designation_id] || e.additional_designations)
                            or 'hr_staff' = any (array[e.designation_id] || e.additional_designations))) then 0
         when p_key = 'hr_leave_pending' then (select count(*) from public.leave_requests where status = 'Pending')
         when p_key = 'hr_attendance_pending' then (select count(*) from public.attendance_corrections where status = 'Pending')
         when p_key = 'hr_documents_pending' then (select count(*) from public.employee_documents where status = 'Active' and review_status = 'Pending Review')
         else 0 end);
$$;
revoke all on function public.report_pending_hr(uuid, text, date) from public, anon, authenticated;

create or replace function public.compute_report_metrics(p_emp uuid, p_template text, p_date date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(s.field_key,
    case when s.kind = 'activity' then (
      select jsonb_build_object('value', coalesce(sum(a.quantity), 0), 'kind', 'activity', 'activity_ids', coalesce(jsonb_agg(a.id order by a.id), '[]'))
      from public.work_activities a
      where a.employee_id = p_emp and a.report_date = p_date and a.voided_at is null and a.activity_type = any (s.activity_types))
    when s.kind = 'pending' and s.pending like 'hr\_%' then public.report_pending_hr(p_emp, s.pending, p_date)
    when s.kind = 'pending' then public.report_pending(p_emp, s.pending, p_date)
    else (
      select jsonb_build_object('value', count(*), 'kind', 'workload', 'application_ids', coalesce(jsonb_agg(ap.id order by ap.id), '[]'))
      from public.applications ap
      where ap.assigned_to = p_emp and ap.status = any (public.workload_statuses(s.workload)))
    end), '{}')
  from public.report_metric_sources s
  where s.template_id = p_template;
$$;

-- ================================================================ HR report template
insert into public.report_templates (id, version, name, sections) values
('hr', 1, 'HR — Daily Work Report', $j$[
 {"id":"hr_work","title":"HR Work Completed","fields":[
   {"key":"hr_employees_created","type":"count","label":"Employee records created"},
   {"key":"hr_leave_processed","type":"count","label":"Leave requests processed"},
   {"key":"hr_attendance_reviewed","type":"count","label":"Attendance corrections reviewed"},
   {"key":"hr_documents_processed","type":"count","label":"Employee documents processed"},
   {"key":"hr_onboarding","type":"count","label":"Onboarding activities"},
   {"key":"hr_requests_completed","type":"count","label":"HR requests completed"}]},
 {"id":"hr_queue","title":"HR Queue (pending)","fields":[
   {"key":"hr_leave_pending","type":"count","label":"Leave requests waiting"},
   {"key":"hr_attendance_pending","type":"count","label":"Attendance corrections waiting"},
   {"key":"hr_documents_pending","type":"count","label":"Documents waiting for review"}]},
 {"id":"summary","title":"Daily Summary","fields":[
   {"key":"achievements","type":"text","label":"Today's Achievements"},
   {"key":"pending_followups","type":"text","label":"Pending Follow-ups"},
   {"key":"tomorrow_plan","type":"text","label":"Tomorrow's Plan"},
   {"key":"support_required","type":"text","label":"Support Required"},
   {"key":"additional_notes","type":"text","label":"Additional Notes"}]}
]$j$)
on conflict (id, version) do update set sections = excluded.sections, name = excluded.name;

alter table public.report_metric_sources drop constraint if exists report_metric_sources_pending_check;
alter table public.report_metric_sources add constraint report_metric_sources_pending_check check (pending = any (array[
  'agency_attempts', 'agency_not_connected', 'agency_followups', 'linkedin_pending', 'linkedin_followups', 'linkedin_not_responded',
  'hr_leave_pending', 'hr_attendance_pending', 'hr_documents_pending']));

insert into public.report_metric_sources (template_id, field_key, kind, activity_types, workload, pending) values
  ('hr', 'hr_employees_created',   'activity', '{hr_employee_created}', null, null),
  ('hr', 'hr_leave_processed',     'activity', '{hr_leave_processed}', null, null),
  ('hr', 'hr_attendance_reviewed', 'activity', '{hr_attendance_reviewed}', null, null),
  ('hr', 'hr_documents_processed', 'activity', '{hr_document_processed}', null, null),
  ('hr', 'hr_onboarding',          'activity', '{hr_onboarding}', null, null),
  ('hr', 'hr_requests_completed',  'activity', '{hr_request_completed}', null, null),
  ('hr', 'hr_leave_pending',       'pending', '{}', null, 'hr_leave_pending'),
  ('hr', 'hr_attendance_pending',  'pending', '{}', null, 'hr_attendance_pending'),
  ('hr', 'hr_documents_pending',   'pending', '{}', null, 'hr_documents_pending')
on conflict (template_id, field_key) do update set kind = excluded.kind, activity_types = excluded.activity_types, workload = excluded.workload, pending = excluded.pending;

update public.designations set report_template = 'hr' where id in ('hr_manager', 'hr_staff') and report_template is null;

-- ================================================================ activity timeline
-- Runs with the caller's permissions (security invoker): work_activities RLS limits it to the
-- caller's own work or a team they may view; names come only from records the caller can read.
create or replace function public.my_work_timeline(p_date date, p_emp uuid default null, p_limit integer default 200)
returns table (id bigint, occurred_at timestamptz, activity_type text, label text, manual boolean, entity_type text, entity_id text,
               entity_name text, application_id text, from_status text, to_status text, quantity integer, note text, voided boolean)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.occurred_at, a.activity_type, coalesce(t.label, a.activity_type), coalesce(t.source, 'crm') = 'logged',
         a.entity_type, a.entity_id,
         coalesce(ag.company_name, ag.contact_name, ag.reference, li.name, pa.name, up.institution_name),
         a.application_id, a.from_status, a.to_status, a.quantity, a.note, a.voided_at is not null
  from public.work_activities a
  left join public.work_activity_types t on t.id = a.activity_type
  left join public.agency_prospects ag on a.entity_type = 'agency' and ag.id::text = a.entity_id
  left join public.linkedin_prospects li on a.entity_type = 'linkedin' and li.id::text = a.entity_id
  left join public.partners pa on pa.id = coalesce(case when a.entity_type = 'partner' then a.entity_id end, a.partner_id)
  left join public.university_partnerships up on a.entity_type = 'university' and up.id::text = a.entity_id
  where a.employee_id = coalesce(p_emp, auth.uid()) and a.report_date = p_date
  order by a.occurred_at, a.id
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;
revoke all on function public.my_work_timeline(date, uuid, integer) from public, anon;
grant execute on function public.my_work_timeline(date, uuid, integer) to authenticated;
