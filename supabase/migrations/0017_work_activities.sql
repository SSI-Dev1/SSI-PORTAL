-- 0017_work_activities.sql — run after 0016_attendance_parity.sql
-- (Supabase SQL Editor: Save this query as "0017_work_activities")
--
-- Activity-driven daily work reports:
-- * work_activities: one row per meaningful piece of work by an employee (who, designation,
--   type, related application / student / partner / task, time, IST reporting date, previous and
--   new status, quantity, outcome, metadata). Written only by the database:
--     - CRM triggers record what the signed-in employee actually did (application created,
--       submitted, returned to draft, offer received, visa lodged / granted / refused, application
--       assigned to them, document verified, assessment completed, task completed, student added,
--       partner added). Page views and opening a record are never counted.
--     - log_work_activity() records work done outside the CRM (calls, meetings, LinkedIn,
--       training, counselling, deposits, CAS…) from Quick Log, with a per-tap request id.
--   A dedupe key stops retries, double clicks and repeated events from counting twice.
--   Wrong entries are voided (never deleted) with a reason: the employee can void their own
--   logged entries on a day whose report is not submitted; managers / HR can void any.
-- * report_metric_sources maps every count field of every report template to either activity
--   types (work done that day) or a workload query (current assigned applications by status).
-- * report_metrics() computes a report's figures on the server; save_daily_report() now always
--   uses those figures (client numbers are ignored), stores the activity ids behind them, and no
--   longer refuses a report just because nothing was recorded. A submitted report is a frozen
--   snapshot; a correction request lets the employee resubmit (recomputed), with every version
--   kept in daily_report_events. Submits carry a request id, so a double click submits once.
-- Safe to run more than once.

-- =============================================================== activity types
create table if not exists public.work_activity_types (
  id          text primary key,
  label       text not null,
  source      text not null check (source in ('crm', 'logged')),
  description text,
  sort        integer not null default 100
);
insert into public.work_activity_types (id, label, source, description, sort) values
  ('application_created',   'Application created',            'crm', 'You created an application in the CRM', 10),
  ('application_received',  'Application assigned to you',     'crm', 'An application was assigned to you', 11),
  ('application_submitted', 'Application submitted',           'crm', 'You moved an application to Submitted', 12),
  ('application_returned',  'Application returned for corrections', 'crm', 'You moved an application back to Draft', 13),
  ('offer_received',        'Offer received',                  'crm', 'You moved an application to Conditional / Unconditional Offer', 14),
  ('visa_lodged',           'Visa lodged',                     'crm', 'You moved an application to Visa Lodged', 15),
  ('visa_approved',         'Visa approved',                   'crm', 'You moved an application to Visa Granted', 16),
  ('application_completed', 'Application completed',           'crm', 'You moved an application to its final outcome (Visa Granted / Visa Refused)', 17),
  ('application_status',    'Application status updated',      'crm', 'Any status change you made on an application', 18),
  ('document_verified',     'Document verified',               'crm', 'You verified a student document', 20),
  ('assessment_completed',  'Student profile assessed',        'crm', 'You completed an eligibility assessment', 21),
  ('task_completed',        'Assigned task completed',         'crm', 'You marked a task as done', 22),
  ('student_created',       'Student / lead added',            'crm', 'You added a student record', 23),
  ('partner_onboarded',     'Partner added to the CRM',        'crm', 'You added a partner organisation', 24),
  ('partner_contact',       'New partner contacted',           'logged', null, 40),
  ('partner_call',          'Partner follow-up call',          'logged', null, 41),
  ('partner_meeting',       'Partner meeting / office visit',  'logged', null, 42),
  ('proposal',              'Proposal sent / requested',       'logged', null, 43),
  ('mou_signed',            'MOU signed',                      'logged', null, 44),
  ('partner_closed',        'Partner lead closed',             'logged', null, 45),
  ('partner_pending',       'Partner lead pending',            'logged', null, 46),
  ('university_contact',    'University contacted',            'logged', null, 50),
  ('university_followup',   'University follow-up',            'logged', null, 51),
  ('university_meeting',    'University meeting fixed',        'logged', null, 52),
  ('university_onboarded',  'University partnership onboarded', 'logged', null, 53),
  ('university_training',   'University training session fixed', 'logged', null, 54),
  ('university_closed',     'University lead closed',          'logged', null, 55),
  ('university_pending',    'University lead pending',         'logged', null, 56),
  ('linkedin_connection',   'LinkedIn connection contacted',   'logged', null, 60),
  ('linkedin_followup',     'LinkedIn follow-up message',      'logged', null, 61),
  ('linkedin_positive',     'LinkedIn positive response',      'logged', null, 62),
  ('linkedin_closed',       'LinkedIn lead closed',            'logged', null, 63),
  ('linkedin_pending',      'LinkedIn lead pending',           'logged', null, 64),
  ('lead_counselled',       'Lead counselled',                 'logged', null, 70),
  ('student_followup',      'Student follow-up',               'logged', null, 71),
  ('lead_converted',        'Lead converted',                  'logged', null, 72),
  ('lead_pending',          'Lead pending',                    'logged', null, 73),
  ('partner_query',         'Partner query handled',           'logged', null, 74),
  ('course_options',        'Course / university options shared', 'logged', null, 75),
  ('admission_guidance',    'Admission guidance given',        'logged', null, 76),
  ('partner_training',      'Partner training conducted',      'logged', null, 77),
  ('profile_discussion',    'Student profile discussed',       'logged', null, 78),
  ('offer_followup',        'Offer / TAT follow-up',           'logged', null, 80),
  ('escalation_resolved',   'Escalation resolved',             'logged', null, 81),
  ('deposit_followup',      'Deposit follow-up',               'logged', null, 82),
  ('deposit_confirmed',     'Tuition deposit confirmed',       'logged', null, 83),
  ('cas_followup',          'CAS application / follow-up',     'logged', null, 84),
  ('cas_received',          'CAS received',                    'logged', null, 85),
  ('visa_followup',         'Visa process follow-up',          'logged', null, 86)
on conflict (id) do update set label = excluded.label, source = excluded.source, description = excluded.description, sort = excluded.sort;

-- =============================================================== activities
create table if not exists public.work_activities (
  id             bigint generated always as identity primary key,
  employee_id    uuid not null references public.employees (id) on delete cascade,
  designation_id text,
  activity_type  text not null references public.work_activity_types (id),
  source         text not null check (source in ('crm', 'logged')),
  entity_type    text,
  entity_id      text,
  application_id text,
  student_id     text,
  partner_id     text,
  quantity       integer not null default 1 check (quantity between 1 and 500),
  from_status    text,
  to_status      text,
  outcome        text,
  note           text,
  metadata       jsonb not null default '{}',
  occurred_at    timestamptz not null default now(),
  report_date    date not null,
  dedupe_key     text not null,
  voided_at      timestamptz,
  voided_by      uuid,
  void_reason    text,
  created_at     timestamptz not null default now()
);
create unique index if not exists work_activities_dedupe on public.work_activities (dedupe_key);
create index if not exists work_activities_emp_day on public.work_activities (employee_id, report_date);

-- Records one activity for an employee (internal; called by triggers and log_work_activity).
create or replace function public.record_work_activity(p_emp uuid, p_type text, p_dedupe text, p_entity_type text default null,
  p_entity_id text default null, p_application text default null, p_student text default null, p_partner text default null,
  p_from text default null, p_to text default null, p_quantity integer default 1, p_note text default null, p_meta jsonb default '{}')
returns bigint language plpgsql security definer set search_path = '' as $$
declare rid bigint; src text;
begin
  if p_emp is null or not exists (select 1 from public.employees where id = p_emp) then return null; end if;
  select source into src from public.work_activity_types where id = p_type;
  insert into public.work_activities (employee_id, designation_id, activity_type, source, entity_type, entity_id, application_id,
    student_id, partner_id, quantity, from_status, to_status, note, metadata, report_date, dedupe_key)
  values (p_emp, (select designation_id from public.employees where id = p_emp), p_type, coalesce(src, 'crm'), p_entity_type, p_entity_id,
    p_application, p_student, p_partner, greatest(1, coalesce(p_quantity, 1)), p_from, p_to, p_note, coalesce(p_meta, '{}'),
    public.company_today(), p_dedupe)
  on conflict (dedupe_key) do nothing
  returning id into rid;
  return rid;
end $$;

-- =============================================================== CRM triggers
-- The actor is the signed-in employee (auth.uid()); changes by non-employees (partners,
-- Super Admin without an employee record, service jobs) are not attributed to anyone.
create or replace function public.track_application_work()
returns trigger language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_employee_id(); d text := public.company_today()::text; t text;
begin
  if tg_op = 'INSERT' then
    perform public.record_work_activity(me, 'application_created', 'app-created:' || new.id, 'application', new.id, new.id, new.student_id, new.partner_id, null, new.status);
    if new.assigned_to is not null then
      perform public.record_work_activity(new.assigned_to, 'application_received', 'app-recv:' || new.id || ':' || new.assigned_to || ':' || d,
        'application', new.id, new.id, new.student_id, new.partner_id);
    end if;
    return new;
  end if;
  if new.assigned_to is distinct from old.assigned_to and new.assigned_to is not null then
    perform public.record_work_activity(new.assigned_to, 'application_received', 'app-recv:' || new.id || ':' || new.assigned_to || ':' || d,
      'application', new.id, new.id, new.student_id, new.partner_id);
  end if;
  if new.status is distinct from old.status and me is not null then
    perform public.record_work_activity(me, 'application_status', 'app-status:' || new.id || ':' || old.status || '>' || new.status || ':' || me || ':' || d,
      'application', new.id, new.id, new.student_id, new.partner_id, old.status, new.status);
    t := case
      when new.status = 'Submitted' then 'application_submitted'
      when new.status = 'Draft' then 'application_returned'
      when new.status in ('Conditional Offer', 'Unconditional Offer') and old.status not in ('Conditional Offer', 'Unconditional Offer') then 'offer_received'
      when new.status = 'Visa Lodged' then 'visa_lodged'
      when new.status = 'Visa Granted' then 'visa_approved'
    end;
    if t is not null then
      perform public.record_work_activity(me, t, 'app-' || t || ':' || new.id || ':' || me || ':' || d, 'application', new.id, new.id, new.student_id, new.partner_id, old.status, new.status);
    end if;
    if new.status in ('Visa Granted', 'Visa Refused') then
      perform public.record_work_activity(me, 'application_completed', 'app-done:' || new.id || ':' || me || ':' || d, 'application', new.id, new.id, new.student_id, new.partner_id, old.status, new.status);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists applications_track_work on public.applications;
create trigger applications_track_work after insert or update on public.applications
  for each row execute function public.track_application_work();

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
    if new.done and not old.done then
      perform public.record_work_activity(me, 'task_completed', 'task:' || new.id || ':' || me || ':' || d, 'task', new.id, null, null, null, 'open', 'done', 1, new.title);
    end if;
  end if;
  return new;
end $$;

create or replace function public.track_created_work()
returns trigger language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_employee_id();
begin
  if me is null then return new; end if;
  if tg_table_name = 'students' then
    perform public.record_work_activity(me, 'student_created', 'student:' || new.id, 'student', new.id, null, new.id, new.partner_id);
  elsif tg_table_name = 'partners' then
    perform public.record_work_activity(me, 'partner_onboarded', 'partner:' || new.id, 'partner', new.id, null, null, new.id);
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['documents', 'assessments', 'tasks'] loop
    execute format('drop trigger if exists %1$s_track_work on public.%1$I', t);
    execute format('create trigger %1$s_track_work after update on public.%1$I for each row execute function public.track_other_work()', t);
  end loop;
  foreach t in array array['students', 'partners'] loop
    execute format('drop trigger if exists %1$s_track_work on public.%1$I', t);
    execute format('create trigger %1$s_track_work after insert on public.%1$I for each row execute function public.track_created_work()', t);
  end loop;
end $$;

-- =============================================================== quick log + void
create or replace function public.log_work_activity(p_type text, p_quantity integer, p_note text, p_request_id uuid,
  p_related_type text default null, p_related_id text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_employee_id(); src text; rid bigint;
begin
  if me is null then raise exception 'Only employees can log work'; end if;
  if p_request_id is null then raise exception 'A request id is required'; end if;
  select source into src from public.work_activity_types where id = p_type;
  if src is distinct from 'logged' then raise exception 'This activity is recorded automatically from the CRM'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 500 then raise exception 'Enter a number from 1 to 500'; end if;
  if p_related_type is not null and p_related_type not in ('application', 'student', 'partner') then raise exception 'Unknown related record'; end if;
  if exists (select 1 from public.daily_reports r where r.employee_id = me and r.report_date = public.company_today()
             and r.status in ('Submitted', 'Reviewed', 'Approved')
             and not exists (select 1 from public.daily_reports o where o.employee_id = me and o.report_date = public.company_today() and o.status in ('Draft', 'Correction Requested'))) then
    raise exception 'REPORT_LOCKED: Today''s report is already submitted. Ask your manager to request a correction to add more work.';
  end if;
  rid := public.record_work_activity(me, p_type, 'log:' || p_request_id, p_related_type, p_related_id,
    case when p_related_type = 'application' then p_related_id end, case when p_related_type = 'student' then p_related_id end,
    case when p_related_type = 'partner' then p_related_id end, null, null, p_quantity, nullif(btrim(coalesce(p_note, '')), ''));
  if rid is null then select id into rid from public.work_activities where dedupe_key = 'log:' || p_request_id; end if;
  return rid;
end $$;

create or replace function public.void_work_activity(p_id bigint, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select * into a from public.work_activities where id = p_id for update;
  if a.id is null then raise exception 'Activity not found'; end if;
  if a.voided_at is not null then raise exception 'This activity was already corrected'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Enter the reason for the correction'; end if;
  if a.employee_id = auth.uid() then
    if a.source <> 'logged' then raise exception 'CRM activities can only be corrected by your manager or HR'; end if;
    if exists (select 1 from public.daily_reports r where r.employee_id = a.employee_id and r.report_date = a.report_date
               and r.status in ('Submitted', 'Reviewed', 'Approved')) then
      raise exception 'REPORT_LOCKED: The report for that day is already submitted';
    end if;
  elsif not public.can_approve_for(a.employee_id) then
    raise exception 'You cannot correct this activity';
  end if;
  update public.work_activities set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason) where id = p_id;
  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, changes)
  values (auth.uid(), public.my_role(), 'void', 'work_activities', p_id::text, jsonb_build_object('type', a.activity_type, 'reason', btrim(p_reason)));
end $$;

-- =============================================================== metric mapping
create table if not exists public.report_metric_sources (
  template_id    text not null,
  field_key      text not null,
  kind           text not null check (kind in ('activity', 'workload')),
  activity_types text[] not null default '{}',
  workload       text check (workload in ('apps_new', 'apps_awaiting', 'apps_conditional', 'apps_cas_visa', 'apps_open')),
  primary key (template_id, field_key)
);
delete from public.report_metric_sources;
insert into public.report_metric_sources (template_id, field_key, kind, activity_types, workload) values
  -- Application Team
  ('application_team', 'pr_new_received', 'activity', '{application_received}', null),
  ('application_team', 'pr_processed_submitted', 'activity', '{application_submitted}', null),
  ('application_team', 'pr_pending', 'workload', '{}', 'apps_new'),
  ('application_team', 'pr_returned', 'activity', '{application_returned}', null),
  ('application_team', 'pr_completed', 'activity', '{application_completed}', null),
  ('application_team', 'of_followups', 'activity', '{offer_followup}', null),
  ('application_team', 'of_received', 'activity', '{offer_received}', null),
  ('application_team', 'of_awaiting_decision', 'workload', '{}', 'apps_awaiting'),
  ('application_team', 'of_escalations_resolved', 'activity', '{escalation_resolved}', null),
  ('application_team', 'of_cases_pending', 'workload', '{}', 'apps_conditional'),
  ('application_team', 'tk_deposit_followups', 'activity', '{deposit_followup}', null),
  ('application_team', 'tk_deposits_confirmed', 'activity', '{deposit_confirmed}', null),
  ('application_team', 'tk_cas_applications', 'activity', '{cas_followup}', null),
  ('application_team', 'tk_cas_received', 'activity', '{cas_received}', null),
  ('application_team', 'tk_visa_followups', 'activity', '{visa_followup,visa_lodged}', null),
  ('application_team', 'tk_visa_approvals', 'activity', '{visa_approved}', null),
  ('application_team', 'tk_cases_pending', 'workload', '{}', 'apps_cas_visa'),
  -- Partner Success Officer
  ('partner_success_officer', 'lm_new_leads', 'activity', '{student_created}', null),
  ('partner_success_officer', 'lm_leads_counselled', 'activity', '{lead_counselled}', null),
  ('partner_success_officer', 'lm_student_followups', 'activity', '{student_followup}', null),
  ('partner_success_officer', 'lm_leads_converted', 'activity', '{lead_converted}', null),
  ('partner_success_officer', 'lm_pending_leads', 'activity', '{lead_pending}', null),
  ('partner_success_officer', 'ps_partner_queries', 'activity', '{partner_query}', null),
  ('partner_success_officer', 'ps_profiles_assessed', 'activity', '{assessment_completed}', null),
  ('partner_success_officer', 'ps_options_suggested', 'activity', '{course_options}', null),
  ('partner_success_officer', 'ps_admission_guidance', 'activity', '{admission_guidance}', null),
  ('partner_success_officer', 'ps_training_sessions', 'activity', '{partner_training}', null),
  ('partner_success_officer', 'ap_applications_generated', 'activity', '{application_created}', null),
  ('partner_success_officer', 'ap_applications_converted', 'activity', '{application_submitted}', null),
  ('partner_success_officer', 'ap_offers', 'activity', '{offer_received,offer_followup}', null),
  ('partner_success_officer', 'ap_tuition_deposits', 'activity', '{deposit_confirmed}', null),
  ('partner_success_officer', 'ap_cas_followups', 'activity', '{cas_followup}', null),
  ('partner_success_officer', 'ap_visa_updates', 'activity', '{visa_lodged,visa_approved}', null),
  ('partner_success_officer', 'ap_cases_closed', 'activity', '{application_completed}', null),
  ('partner_success_officer', 'ap_cases_pending', 'workload', '{}', 'apps_open'),
  -- Senior International Recruitment Manager
  ('senior_recruitment_manager', 'pd_new_partners_contacted', 'activity', '{partner_contact}', null),
  ('senior_recruitment_manager', 'pd_meetings_visits', 'activity', '{partner_meeting}', null),
  ('senior_recruitment_manager', 'pd_followup_calls', 'activity', '{partner_call}', null),
  ('senior_recruitment_manager', 'pd_proposal_requests', 'activity', '{proposal}', null),
  ('senior_recruitment_manager', 'pd_partners_onboarded', 'activity', '{partner_onboarded}', null),
  ('senior_recruitment_manager', 'pd_closed', 'activity', '{partner_closed}', null),
  ('senior_recruitment_manager', 'pd_pending', 'activity', '{partner_pending}', null),
  ('senior_recruitment_manager', 'tr_training_conducted', 'activity', '{partner_training}', null),
  ('senior_recruitment_manager', 'tr_options_shared', 'activity', '{course_options}', null),
  ('senior_recruitment_manager', 'tr_profiles_discussed', 'activity', '{assessment_completed,profile_discussion}', null),
  ('senior_recruitment_manager', 'tr_applications_generated', 'activity', '{application_created}', null),
  ('senior_recruitment_manager', 'tr_applications_converted', 'activity', '{application_submitted}', null),
  ('senior_recruitment_manager', 'as_offer_tat_followups', 'activity', '{offer_followup}', null),
  ('senior_recruitment_manager', 'as_cas_interview_support', 'activity', '{cas_followup}', null),
  ('senior_recruitment_manager', 'as_tuition_deposits', 'activity', '{deposit_confirmed}', null),
  ('senior_recruitment_manager', 'as_visa_applications', 'activity', '{visa_lodged}', null),
  ('senior_recruitment_manager', 'as_visa_successes', 'activity', '{visa_approved}', null),
  ('senior_recruitment_manager', 'as_escalations_resolved', 'activity', '{escalation_resolved}', null),
  ('senior_recruitment_manager', 'as_cases_pending', 'workload', '{}', 'apps_open'),
  -- Partnership Officer
  ('partnership_officer', 'po_new_partners_contacted', 'activity', '{partner_contact}', null),
  ('partnership_officer', 'po_followup_calls', 'activity', '{partner_call}', null),
  ('partnership_officer', 'po_meetings_fixed', 'activity', '{partner_meeting}', null),
  ('partnership_officer', 'po_proposals_sent', 'activity', '{proposal}', null),
  ('partnership_officer', 'po_partners_onboarded', 'activity', '{partner_onboarded}', null),
  ('partnership_officer', 'po_mous_signed', 'activity', '{mou_signed}', null),
  ('partnership_officer', 'po_closed', 'activity', '{partner_closed}', null),
  ('partnership_officer', 'po_pending', 'activity', '{partner_pending}', null),
  ('partnership_officer', 'up_new_universities_contacted', 'activity', '{university_contact}', null),
  ('partnership_officer', 'up_followups', 'activity', '{university_followup}', null),
  ('partnership_officer', 'up_meetings_fixed', 'activity', '{university_meeting}', null),
  ('partnership_officer', 'up_partnerships_onboarded', 'activity', '{university_onboarded}', null),
  ('partnership_officer', 'up_training_sessions_fixed', 'activity', '{university_training}', null),
  ('partnership_officer', 'up_closed', 'activity', '{university_closed}', null),
  ('partnership_officer', 'up_pending', 'activity', '{university_pending}', null),
  ('partnership_officer', 'li_new_connections', 'activity', '{linkedin_connection}', null),
  ('partnership_officer', 'li_followup_messages', 'activity', '{linkedin_followup}', null),
  ('partnership_officer', 'li_positive_responses', 'activity', '{linkedin_positive}', null),
  ('partnership_officer', 'li_closed', 'activity', '{linkedin_closed}', null),
  ('partnership_officer', 'li_pending', 'activity', '{linkedin_pending}', null);

create or replace function public.workload_statuses(p_kind text)
returns text[] language sql immutable set search_path = '' as $$
  select case p_kind
    when 'apps_new' then array['Draft', 'Pending Assessment']
    when 'apps_awaiting' then array['Submitted', 'Offer Pending']
    when 'apps_conditional' then array['Conditional Offer']
    when 'apps_cas_visa' then array['Unconditional Offer', 'Visa Lodged']
    when 'apps_open' then array['Draft', 'Pending Assessment', 'Submitted', 'Offer Pending', 'Conditional Offer', 'Unconditional Offer', 'Visa Lodged']
  end;
$$;

-- Figures for one employee, template and day:
-- { field: { value, kind, activity_ids | application_ids } } — work done that day (activities)
-- or the current workload (applications assigned to the employee, by status).
create or replace function public.compute_report_metrics(p_emp uuid, p_template text, p_date date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(s.field_key,
    case when s.kind = 'activity' then (
      select jsonb_build_object('value', coalesce(sum(a.quantity), 0), 'kind', 'activity', 'activity_ids', coalesce(jsonb_agg(a.id order by a.id), '[]'))
      from public.work_activities a
      where a.employee_id = p_emp and a.report_date = p_date and a.voided_at is null and a.activity_type = any (s.activity_types))
    else (
      select jsonb_build_object('value', count(*), 'kind', 'workload', 'application_ids', coalesce(jsonb_agg(ap.id order by ap.id), '[]'))
      from public.applications ap
      where ap.assigned_to = p_emp and ap.status = any (public.workload_statuses(s.workload)))
    end), '{}')
  from public.report_metric_sources s
  where s.template_id = p_template;
$$;

create or replace function public.report_metrics(p_template text, p_date date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := public.my_employee_id();
begin
  if me is null then return '{}'; end if;
  return public.compute_report_metrics(me, p_template, p_date);
end $$;

-- =============================================================== report saving
alter table public.daily_reports add column if not exists source_activity_ids bigint[] not null default '{}';
alter table public.daily_reports add column if not exists metric_details jsonb not null default '{}';
alter table public.daily_report_events add column if not exists request_id uuid;
create unique index if not exists daily_report_events_request on public.daily_report_events (request_id) where request_id is not null;

drop function if exists public.save_daily_report(text, date, jsonb, jsonb, jsonb, boolean, timestamptz);
create or replace function public.save_daily_report(p_template text, p_date date, p_metrics jsonb, p_notes jsonb,
  p_sources jsonb default '{}', p_submit boolean default false, p_expected_updated_at timestamptz default null, p_request_id uuid default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.my_employee_id(); e record; t record; r record; rid text; des text;
  v_details jsonb; v_metrics jsonb; v_notes jsonb; v_ids bigint[];
begin
  if me is null then raise exception 'Only employees submit daily reports'; end if;
  if p_date > public.company_today() then raise exception 'Reports cannot be filed for future dates'; end if;
  -- A repeated request (double click, retry) returns the first result.
  if p_request_id is not null then
    select report_id into rid from public.daily_report_events where request_id = p_request_id;
    if rid is not null then return rid; end if;
  end if;
  select * into e from public.employees where id = me;
  perform pg_advisory_xact_lock(hashtext('report:' || me || ':' || p_template || ':' || p_date));
  select * into r from public.daily_reports where employee_id = me and template_id = p_template and report_date = p_date;
  if r.id is not null then
    if r.status not in ('Draft', 'Correction Requested') then
      if p_submit and r.status = 'Submitted' and p_request_id is not null then return r.id; end if;
      raise exception 'REPORT_LOCKED: This report was already submitted. Ask your manager to request a correction to change it.';
    end if;
    if p_expected_updated_at is not null and r.updated_at > p_expected_updated_at + interval '1 millisecond' then
      raise exception 'STALE: This report was changed in another window. Reload it before saving.';
    end if;
    select * into t from public.report_templates where id = r.template_id and version = r.template_version;
  else
    select d.id into des from unnest(array[e.designation_id] || e.additional_designations) x(id)
      join public.designations d on d.id = x.id where d.report_template = p_template limit 1;
    if des is null then raise exception 'This report template is not assigned to your designation'; end if;
    select * into t from public.current_template(des);
  end if;
  -- Figures always come from recorded work, never from the browser.
  v_details := public.compute_report_metrics(me, t.id, p_date);
  v_metrics := coalesce((select jsonb_object_agg(k, (v ->> 'value')::int) from jsonb_each(v_details) x(k, v)), '{}');
  v_ids := coalesce(array(select distinct (x)::bigint from jsonb_each(v_details) d(k, v), jsonb_array_elements_text(coalesce(v -> 'activity_ids', '[]')) x), '{}');
  v_notes := coalesce((select jsonb_object_agg(k, to_jsonb(btrim(v #>> '{}'))) from jsonb_each(coalesce(p_notes, '{}')) x(k, v)
                     where jsonb_typeof(v) = 'string' and btrim(v #>> '{}') <> ''), '{}');
  perform public.validate_report(t.sections, v_metrics, v_notes);
  if r.id is null then
    insert into public.daily_reports (employee_id, template_id, template_version, designation_id, department_id, manager_id,
      report_date, status, metrics, notes, sources, submitted_at, source_activity_ids, metric_details)
    values (me, t.id, t.version, des, e.department_id, e.reporting_manager_id, p_date,
      case when p_submit then 'Submitted' else 'Draft' end, v_metrics, v_notes, '{}',
      case when p_submit then now() end, v_ids, v_details)
    returning id into rid;
  else
    rid := r.id;
    update public.daily_reports set metrics = v_metrics, notes = v_notes, sources = '{}', source_activity_ids = v_ids, metric_details = v_details,
      status = case when p_submit then 'Submitted' else status end,
      submitted_at = case when p_submit then now() else submitted_at end, updated_at = now()
    where id = rid;
  end if;
  insert into public.daily_report_events (report_id, action, actor_id, snapshot, request_id)
  values (rid, case when p_submit then 'submitted' else 'saved' end, me,
          jsonb_build_object('metrics', v_metrics, 'notes', v_notes, 'details', v_details), p_request_id);
  if p_submit then
    perform public.notify(array[e.reporting_manager_id], 'report', 'Daily report submitted',
      (select full_name from public.profiles where id = me) || ' · ' || to_char(p_date, 'DD Mon YYYY'), 'work/team');
  end if;
  return rid;
end $$;

-- =============================================================== RLS + realtime
alter table public.work_activity_types enable row level security;
alter table public.work_activities enable row level security;
alter table public.report_metric_sources enable row level security;
revoke all on public.work_activity_types, public.work_activities, public.report_metric_sources from anon, authenticated;
grant select on public.work_activity_types, public.work_activities, public.report_metric_sources to authenticated;
do $$
declare t text;
begin
  foreach t in array array['work_activity_types', 'work_activities', 'report_metric_sources'] loop
    execute coalesce((select string_agg(format('drop policy if exists %I on public.%I;', polname, t), ' ')
             from pg_policy where polrelid = format('public.%I', t)::regclass), 'select 1');
  end loop;
end $$;
create policy "activity types: staff read" on public.work_activity_types for select to authenticated using (public.is_staff());
create policy "metric sources: staff read" on public.report_metric_sources for select to authenticated using (public.is_staff());
create policy "activities: read" on public.work_activities for select to authenticated
  using (public.can_view_employee(employee_id) or public.staff_can('work_reports'));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'work_activities') then
    alter publication supabase_realtime add table public.work_activities;
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['log_work_activity(text, integer, text, uuid, text, text)', 'void_work_activity(bigint, text)',
                           'report_metrics(text, date)', 'save_daily_report(text, date, jsonb, jsonb, jsonb, boolean, timestamptz, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['record_work_activity(uuid, text, text, text, text, text, text, text, text, text, integer, text, jsonb)',
                           'compute_report_metrics(uuid, text, date)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
