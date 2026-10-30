-- 0015_daily_reports.sql — run after 0014_leave.sql
-- (Supabase SQL Editor: Save this query as "0015_daily_reports")
--
-- Designation-based daily work reports:
-- * report_templates (versioned): Partnership Officer, Partner Success Officer, Senior
--   International Recruitment Manager and Application Team, with exactly the requested
--   sections and fields. Counts are whole numbers ≥ 0; summaries are free text.
-- * daily_reports: one per employee, template and date. The designation, department, manager
--   and template version of that day are stored on the report, so later designation changes
--   never alter or remove it. Written only through save_daily_report() / review_daily_report().
--   Statuses: Draft → Submitted → Reviewed / Approved, or Correction Requested (editable again).
--   Submitted reports are locked unless a correction is requested or a reviewer reopens them.
-- * daily_report_events: audit history of every save, submission and review (with values).
-- * report_crm_metrics(): counts the CRM already records for the employee on that day
--   (applications created, status changes, partners onboarded) as clearly-marked suggestions;
--   each value stores whether it was entered manually or taken from the CRM.
-- * report_expectations(): who is expected to report on a date (has a template, active, working
--   day, not on approved leave) — no empty reports are ever created.
-- Safe to run more than once.

create table if not exists public.report_templates (
  id          text not null,
  version     integer not null,
  name        text not null,
  sections    jsonb not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  primary key (id, version)
);

insert into public.report_templates (id, version, name, sections) values
('partnership_officer', 1, 'Partnership Officer — Daily Work Report', $j$[
 {"id":"outreach","title":"Partner Outreach & Onboarding","fields":[
   {"key":"po_new_partners_contacted","label":"New partners contacted","type":"count"},
   {"key":"po_followup_calls","label":"Follow-up calls completed","type":"count"},
   {"key":"po_meetings_fixed","label":"Meetings fixed","type":"count"},
   {"key":"po_proposals_sent","label":"Proposals sent","type":"count"},
   {"key":"po_partners_onboarded","label":"Partners onboarded","type":"count"},
   {"key":"po_mous_signed","label":"MOUs signed","type":"count"},
   {"key":"po_closed","label":"Closed","type":"count"},
   {"key":"po_pending","label":"Pending","type":"count"}]},
 {"id":"universities","title":"University Partnerships","fields":[
   {"key":"up_new_universities_contacted","label":"New universities contacted","type":"count"},
   {"key":"up_followups","label":"Follow-ups completed","type":"count"},
   {"key":"up_meetings_fixed","label":"Meetings fixed","type":"count"},
   {"key":"up_partnerships_onboarded","label":"Partnerships onboarded","type":"count"},
   {"key":"up_training_sessions_fixed","label":"Training sessions fixed","type":"count"},
   {"key":"up_closed","label":"Closed","type":"count"},
   {"key":"up_pending","label":"Pending","type":"count"}]},
 {"id":"linkedin","title":"LinkedIn Outreach","fields":[
   {"key":"li_new_connections","label":"New connections contacted","type":"count"},
   {"key":"li_followup_messages","label":"Follow-up messages sent","type":"count"},
   {"key":"li_positive_responses","label":"Positive responses received","type":"count"},
   {"key":"li_closed","label":"Closed","type":"count"},
   {"key":"li_pending","label":"Pending","type":"count"}]},
 {"id":"updates","title":"Key Updates","fields":[
   {"key":"achievements","label":"Today's Achievements","type":"text"},
   {"key":"pending_followups","label":"Pending Follow-ups","type":"text"},
   {"key":"tomorrow_plan","label":"Tomorrow's Plan","type":"text"},
   {"key":"support_required","label":"Support Required","type":"text"}]}
]$j$::jsonb),
('partner_success_officer', 1, 'Partner Success Officer — Daily Work Report', $j$[
 {"id":"leads","title":"Lead Management & Counselling","fields":[
   {"key":"lm_new_leads","label":"New leads received","type":"count"},
   {"key":"lm_leads_counselled","label":"Assigned leads counselled","type":"count"},
   {"key":"lm_student_followups","label":"Student follow-ups completed","type":"count"},
   {"key":"lm_leads_converted","label":"Leads converted","type":"count"},
   {"key":"lm_pending_leads","label":"Pending leads","type":"count"}]},
 {"id":"support","title":"Partner Support & Training","fields":[
   {"key":"ps_partner_queries","label":"Partner queries handled","type":"count"},
   {"key":"ps_profiles_assessed","label":"Student profiles assessed","type":"count"},
   {"key":"ps_options_suggested","label":"Course/university options suggested","type":"count"},
   {"key":"ps_admission_guidance","label":"Admission guidance provided","type":"count"},
   {"key":"ps_training_sessions","label":"Partner training sessions conducted","type":"count"}]},
 {"id":"progress","title":"Application & Admission Progress","fields":[
   {"key":"ap_applications_generated","label":"Applications generated","type":"count"},
   {"key":"ap_applications_converted","label":"Applications converted","type":"count"},
   {"key":"ap_offers","label":"Offers received / followed up","type":"count"},
   {"key":"ap_tuition_deposits","label":"Tuition deposits completed","type":"count"},
   {"key":"ap_cas_followups","label":"CAS follow-ups","type":"count"},
   {"key":"ap_visa_updates","label":"Visa updates / successful outcomes","type":"count"},
   {"key":"ap_cases_closed","label":"Cases closed","type":"count"},
   {"key":"ap_cases_pending","label":"Cases pending","type":"count"}]},
 {"id":"summary","title":"Daily Summary","fields":[
   {"key":"achievements","label":"Key Achievements","type":"text"},
   {"key":"pending_followups","label":"Pending Follow-ups","type":"text"},
   {"key":"tomorrow_plan","label":"Tomorrow's Plan","type":"text"},
   {"key":"support_required","label":"Support Required","type":"text"}]}
]$j$::jsonb),
('senior_recruitment_manager', 1, 'Senior International Recruitment Manager — Daily Work Report', $j$[
 {"id":"development","title":"Partner Development","fields":[
   {"key":"pd_new_partners_contacted","label":"New partners contacted","type":"count"},
   {"key":"pd_meetings_visits","label":"Partner meetings / office visits","type":"count"},
   {"key":"pd_followup_calls","label":"Follow-up calls completed","type":"count"},
   {"key":"pd_proposal_requests","label":"Proposal requests assigned","type":"count"},
   {"key":"pd_partners_onboarded","label":"Partners onboarded","type":"count"},
   {"key":"pd_closed","label":"Closed","type":"count"},
   {"key":"pd_pending","label":"Pending","type":"count"}]},
 {"id":"training","title":"Training & Recruitment","fields":[
   {"key":"tr_training_conducted","label":"Online/offline training conducted","type":"count"},
   {"key":"tr_options_shared","label":"University/course options shared","type":"count"},
   {"key":"tr_profiles_discussed","label":"Student profiles discussed","type":"count"},
   {"key":"tr_applications_generated","label":"Applications generated","type":"count"},
   {"key":"tr_applications_converted","label":"Applications converted","type":"count"}]},
 {"id":"admission","title":"Admission Support","fields":[
   {"key":"as_offer_tat_followups","label":"Offer/TAT follow-ups","type":"count"},
   {"key":"as_cas_interview_support","label":"CAS / interview support","type":"count"},
   {"key":"as_tuition_deposits","label":"Tuition deposits completed","type":"count"},
   {"key":"as_visa_applications","label":"Visa applications / updates","type":"count"},
   {"key":"as_visa_successes","label":"Successful visa outcomes","type":"count"},
   {"key":"as_escalations_resolved","label":"Escalations resolved","type":"count"},
   {"key":"as_cases_pending","label":"Cases pending","type":"count"}]},
 {"id":"summary","title":"Daily Summary","fields":[
   {"key":"achievements","label":"Key Achievements","type":"text"},
   {"key":"pending_followups","label":"Pending Follow-ups","type":"text"},
   {"key":"tomorrow_plan","label":"Tomorrow's Plan","type":"text"},
   {"key":"support_required","label":"Support Required","type":"text"}]}
]$j$::jsonb),
('application_team', 1, 'Application Team — Daily Work Report', $j$[
 {"id":"processing","title":"Application Processing","fields":[
   {"key":"pr_new_received","label":"New applications received","type":"count"},
   {"key":"pr_processed_submitted","label":"Applications processed/submitted","type":"count"},
   {"key":"pr_pending","label":"Applications pending","type":"count"},
   {"key":"pr_returned","label":"Applications returned for corrections","type":"count"},
   {"key":"pr_completed","label":"Applications completed","type":"count"}]},
 {"id":"offers","title":"Admission & Offer Follow-ups","fields":[
   {"key":"of_followups","label":"Offer follow-ups completed","type":"count"},
   {"key":"of_received","label":"Offers received","type":"count"},
   {"key":"of_awaiting_decision","label":"Applications awaiting university decisions","type":"count"},
   {"key":"of_escalations_resolved","label":"Escalations resolved","type":"count"},
   {"key":"of_cases_pending","label":"Cases pending","type":"count"}]},
 {"id":"tracking","title":"Deposit, CAS & Visa Tracking","fields":[
   {"key":"tk_deposit_followups","label":"Deposit follow-ups completed","type":"count"},
   {"key":"tk_deposits_confirmed","label":"Deposits confirmed","type":"count"},
   {"key":"tk_cas_applications","label":"CAS applications / follow-ups","type":"count"},
   {"key":"tk_cas_received","label":"CAS received","type":"count"},
   {"key":"tk_visa_followups","label":"Visa process follow-ups","type":"count"},
   {"key":"tk_visa_approvals","label":"Visa approvals","type":"count"},
   {"key":"tk_cases_pending","label":"Cases pending","type":"count"}]},
 {"id":"summary","title":"Daily Summary","fields":[
   {"key":"achievements","label":"Key Achievements","type":"text"},
   {"key":"pending_followups","label":"Pending Follow-ups","type":"text"},
   {"key":"tomorrow_plan","label":"Tomorrow's Plan","type":"text"},
   {"key":"support_required","label":"Support Required","type":"text"}]}
]$j$::jsonb)
on conflict (id, version) do nothing;

-- CRM-derived suggestions: template field → what the CRM records (activities by the employee).
create table if not exists public.report_crm_sources (
  template_id text not null,
  field_key   text not null,
  label       text not null,
  titles      text[] not null,      -- activities.title values counted for the employee that day
  primary key (template_id, field_key)
);
insert into public.report_crm_sources (template_id, field_key, label, titles) values
  ('partnership_officer', 'po_partners_onboarded', 'Partners you added in the CRM', '{New partner onboarded}'),
  ('senior_recruitment_manager', 'pd_partners_onboarded', 'Partners you added in the CRM', '{New partner onboarded}'),
  ('partner_success_officer', 'ap_applications_generated', 'Applications you created', '{New application created}'),
  ('partner_success_officer', 'ap_offers', 'Applications you moved to an offer', '{Status changed to Conditional Offer,Status changed to Unconditional Offer}'),
  ('senior_recruitment_manager', 'tr_applications_generated', 'Applications you created', '{New application created}'),
  ('senior_recruitment_manager', 'as_visa_applications', 'Applications you moved to Visa Lodged', '{Status changed to Visa Lodged}'),
  ('senior_recruitment_manager', 'as_visa_successes', 'Applications you moved to Visa Granted', '{Status changed to Visa Granted}'),
  ('application_team', 'pr_processed_submitted', 'Applications you moved to Submitted', '{Status changed to Submitted}'),
  ('application_team', 'of_received', 'Applications you moved to an offer', '{Status changed to Conditional Offer,Status changed to Unconditional Offer}'),
  ('application_team', 'tk_visa_approvals', 'Applications you moved to Visa Granted', '{Status changed to Visa Granted}')
on conflict (template_id, field_key) do nothing;

create table if not exists public.daily_reports (
  id               text primary key default gen_random_uuid()::text,
  employee_id      uuid not null references public.employees (id) on delete cascade,
  template_id      text not null,
  template_version integer not null,
  designation_id   text not null,
  department_id    text,
  manager_id       uuid,
  report_date      date not null,
  status           text not null default 'Draft' check (status in ('Draft', 'Submitted', 'Reviewed', 'Correction Requested', 'Approved')),
  metrics          jsonb not null default '{}',     -- field key → whole number
  notes            jsonb not null default '{}',     -- field key → text
  sources          jsonb not null default '{}',     -- field key → "crm" when taken from the CRM suggestion
  submitted_at     timestamptz,
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  review_comment   text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (template_id, template_version) references public.report_templates (id, version)
);
create unique index if not exists daily_reports_day_key on public.daily_reports (employee_id, template_id, report_date);
create index if not exists daily_reports_date_idx on public.daily_reports (report_date, status);

create table if not exists public.daily_report_events (
  id         bigint generated always as identity primary key,
  report_id  text not null references public.daily_reports (id) on delete cascade,
  action     text not null,
  actor_id   uuid,
  at         timestamptz not null default now(),
  comment    text,
  snapshot   jsonb
);

-- =============================================================== functions
create or replace function public.current_template(p_designation text)
returns table (id text, version integer, name text, sections jsonb)
language sql stable security definer set search_path = '' as $$
  select t.id, t.version, t.name, t.sections from public.designations d
  join public.report_templates t on t.id = d.report_template and t.active
  where d.id = p_designation
  order by t.version desc limit 1;
$$;

-- Templates the caller reports with today (one per designation they hold).
create or replace function public.my_report_templates()
returns table (designation_id text, designation text, id text, version integer, name text, sections jsonb)
language sql stable security definer set search_path = '' as $$
  select d.id, d.name, t.id, t.version, t.name, t.sections
  from public.employees e
  cross join lateral unnest(array[e.designation_id] || e.additional_designations) with ordinality as x(des, ord)
  join public.designations d on d.id = x.des
  cross join lateral public.current_template(d.id) t
  where e.id = public.my_employee_id()
  order by x.ord;
$$;

create or replace function public.report_crm_metrics(p_template text, p_date date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(s.field_key, jsonb_build_object('label', s.label, 'value',
    (select count(*) from public.activities a
     where a.actor_id = auth.uid() and a.title = any (s.titles)
       and (a.at at time zone public.company_tz())::date = p_date))), '{}')
  from public.report_crm_sources s
  where s.template_id = p_template and public.my_employee_id() is not null;
$$;

create or replace function public.validate_report(p_sections jsonb, p_metrics jsonb, p_notes jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; counts text[]; texts text[];
begin
  select array_agg(f ->> 'key') filter (where f ->> 'type' = 'count'), array_agg(f ->> 'key') filter (where f ->> 'type' = 'text')
  into counts, texts
  from jsonb_array_elements(p_sections) s, jsonb_array_elements(s -> 'fields') f;
  for k, v in select * from jsonb_each(coalesce(p_metrics, '{}')) loop
    if not k = any (counts) then raise exception 'Unknown report field %', k; end if;
    if jsonb_typeof(v) = 'null' then continue; end if;
    if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric) or (v #>> '{}')::numeric < 0 or (v #>> '{}')::numeric > 100000 then
      raise exception 'INVALID_COUNT: "%" must be a whole number of 0 or more', k;
    end if;
  end loop;
  for k, v in select * from jsonb_each(coalesce(p_notes, '{}')) loop
    if not k = any (texts) then raise exception 'Unknown report field %', k; end if;
    if jsonb_typeof(v) not in ('string', 'null') or length(coalesce(v #>> '{}', '')) > 5000 then
      raise exception 'Text for "%" is too long (5000 characters max)', k;
    end if;
  end loop;
end $$;

create or replace function public.save_daily_report(p_template text, p_date date, p_metrics jsonb, p_notes jsonb,
  p_sources jsonb default '{}', p_submit boolean default false, p_expected_updated_at timestamptz default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.my_employee_id(); e record; t record; r record; rid text; des text;
  v_metrics jsonb; v_notes jsonb;
begin
  if me is null then raise exception 'Only employees submit daily reports'; end if;
  if p_date > public.company_today() then raise exception 'Reports cannot be filed for future dates'; end if;
  select * into e from public.employees where id = me;
  perform pg_advisory_xact_lock(hashtext('report:' || me || ':' || p_template || ':' || p_date));
  select * into r from public.daily_reports where employee_id = me and template_id = p_template and report_date = p_date;
  if r.id is not null then
    if r.status not in ('Draft', 'Correction Requested') then
      raise exception 'REPORT_LOCKED: This report was already submitted. Ask your manager to request a correction to change it.';
    end if;
    if p_expected_updated_at is not null and r.updated_at > p_expected_updated_at + interval '1 millisecond' then
      raise exception 'STALE: This report was changed in another window. Reload it before saving.';
    end if;
    select * into t from public.report_templates where id = r.template_id and version = r.template_version;
  else
    -- New report: the template must belong to one of the employee's designations today.
    select d.id into des from unnest(array[e.designation_id] || e.additional_designations) x(id)
      join public.designations d on d.id = x.id where d.report_template = p_template limit 1;
    if des is null then raise exception 'This report template is not assigned to your designation'; end if;
    select * into t from public.current_template(des);
  end if;
  -- Blank strings and nulls are dropped; only filled values are stored.
  v_metrics := coalesce((select jsonb_object_agg(k, v) from jsonb_each(coalesce(p_metrics, '{}')) x(k, v) where jsonb_typeof(v) <> 'null'), '{}');
  v_notes := coalesce((select jsonb_object_agg(k, to_jsonb(btrim(v #>> '{}'))) from jsonb_each(coalesce(p_notes, '{}')) x(k, v)
                     where jsonb_typeof(v) = 'string' and btrim(v #>> '{}') <> ''), '{}');
  perform public.validate_report(t.sections, v_metrics, v_notes);
  if p_submit and v_metrics = '{}' and v_notes = '{}' then
    raise exception 'EMPTY_REPORT: Fill in at least one figure or summary before submitting.';
  end if;
  if r.id is null then
    insert into public.daily_reports (employee_id, template_id, template_version, designation_id, department_id, manager_id,
      report_date, status, metrics, notes, sources, submitted_at)
    values (me, t.id, t.version, des, e.department_id, e.reporting_manager_id, p_date,
      case when p_submit then 'Submitted' else 'Draft' end, v_metrics, v_notes, coalesce(p_sources, '{}'),
      case when p_submit then now() end)
    returning id into rid;
  else
    rid := r.id;
    update public.daily_reports set metrics = v_metrics, notes = v_notes, sources = coalesce(p_sources, '{}'),
      status = case when p_submit then 'Submitted' else status end,
      submitted_at = case when p_submit then now() else submitted_at end, updated_at = now()
    where id = rid;
  end if;
  insert into public.daily_report_events (report_id, action, actor_id, snapshot)
  values (rid, case when p_submit then 'submitted' else 'saved' end, me, jsonb_build_object('metrics', v_metrics, 'notes', v_notes, 'sources', p_sources));
  if p_submit then
    perform public.notify(array[e.reporting_manager_id], 'report', 'Daily report submitted',
      (select full_name from public.profiles where id = me) || ' · ' || to_char(p_date, 'DD Mon YYYY'), 'work/team');
  end if;
  return rid;
end $$;

create or replace function public.review_daily_report(p_id text, p_action text, p_comment text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare r record; nxt text;
begin
  select * into r from public.daily_reports where id = p_id for update;
  if r.id is null then raise exception 'Report not found'; end if;
  if not (public.can_approve_for(r.employee_id) or (public.staff_can('work_reports') and r.employee_id <> auth.uid())) then
    raise exception 'You cannot review this report';
  end if;
  nxt := case
    when p_action = 'review' and r.status = 'Submitted' then 'Reviewed'
    when p_action = 'approve' and r.status in ('Submitted', 'Reviewed') then 'Approved'
    when p_action = 'request_correction' and r.status in ('Submitted', 'Reviewed', 'Approved') then 'Correction Requested'
  end;
  if nxt is null then raise exception 'This action is not possible while the report is %', r.status; end if;
  if nxt = 'Correction Requested' and length(btrim(coalesce(p_comment, ''))) < 3 then
    raise exception 'Explain what needs to be corrected';
  end if;
  update public.daily_reports set status = nxt, reviewed_by = auth.uid(), reviewed_at = now(),
    review_comment = coalesce(nullif(btrim(coalesce(p_comment, '')), ''), review_comment), updated_at = now()
  where id = p_id;
  insert into public.daily_report_events (report_id, action, actor_id, comment) values (p_id, lower(replace(nxt, ' ', '_')), auth.uid(), p_comment);
  perform public.notify(array[r.employee_id], 'report', 'Daily report ' || lower(nxt),
    to_char(r.report_date, 'DD Mon YYYY') || coalesce(' · ' || nullif(btrim(coalesce(p_comment, '')), ''), ''), 'work/reports');
  return nxt;
end $$;

-- Who should report on a date and whether they did (no rows are created for missing reports).
create or replace function public.report_expectations(p_date date)
returns table (employee_id uuid, full_name text, designation_id text, department_id text, manager_id uuid,
               template_id text, report_id text, status text, on_leave boolean, working_day boolean)
language sql stable security definer set search_path = '' as $$
  select e.id, p.full_name, x.des, e.department_id, e.reporting_manager_id, d.report_template, r.id, r.status,
         exists (select 1 from public.leave_requests l where l.employee_id = e.id and l.status = 'Approved' and p_date between l.start_date and l.end_date),
         public.is_working_day(e.id, p_date)
  from public.employees e
  join public.profiles p on p.id = e.id
  cross join lateral unnest(array[e.designation_id] || e.additional_designations) x(des)
  join public.designations d on d.id = x.des and d.report_template is not null
  left join public.daily_reports r on r.employee_id = e.id and r.template_id = d.report_template and r.report_date = p_date
  where p.status = 'active' and e.employment_status <> 'Resigned'
    and (e.joining_date is null or e.joining_date <= p_date)
    and (public.is_super_admin() or public.staff_can('work_reports') or public.is_hr() or public.in_my_team(e.id) or e.id = auth.uid())
  order by p.full_name;
$$;

-- =============================================================== RLS
alter table public.report_templates enable row level security;
alter table public.report_crm_sources enable row level security;
alter table public.daily_reports enable row level security;
alter table public.daily_report_events enable row level security;
revoke all on public.report_templates, public.report_crm_sources, public.daily_reports, public.daily_report_events from anon, authenticated;
grant select on public.report_templates, public.report_crm_sources, public.daily_reports, public.daily_report_events to authenticated;
do $$
declare t text;
begin
  foreach t in array array['report_templates', 'report_crm_sources', 'daily_reports', 'daily_report_events'] loop
    execute coalesce((select string_agg(format('drop policy if exists %I on public.%I;', polname, t), ' ')
             from pg_policy where polrelid = format('public.%I', t)::regclass), 'select 1');
  end loop;
end $$;
create policy "templates: staff read" on public.report_templates for select to authenticated using (public.is_staff());
create policy "crm sources: staff read" on public.report_crm_sources for select to authenticated using (public.is_staff());
create policy "reports: read" on public.daily_reports for select to authenticated
  using (public.can_view_employee(employee_id) or public.staff_can('work_reports'));
create policy "report events: read" on public.daily_report_events for select to authenticated
  using (exists (select 1 from public.daily_reports r where r.id = report_id
                 and (public.can_view_employee(r.employee_id) or public.staff_can('work_reports'))));

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['daily_reports', 'report_templates'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['current_template(text)', 'my_report_templates()', 'report_crm_metrics(text, date)',
                           'save_daily_report(text, date, jsonb, jsonb, jsonb, boolean, timestamptz)',
                           'review_daily_report(text, text, text)', 'report_expectations(date)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
