-- 0044 · Partnership Development Officer: merged dashboard / daily report, nine agency log
-- actions, LinkedIn log (three actions), task rollover, University Partnerships, Education
-- Providers access and partner-account permission (Abigail's Portal Development Specification).
--
-- Report heads (all from saved events — nothing typed in, nothing inferred from a dropdown):
-- * New Partner Contacted   — the first time an agency is Connected (once per agency; unchanged).
--                             A contact attempt or creating a profile no longer counts.
-- * Follow-ups Attempted    — OPEN contact attempts (a pending counter, not a lifetime total):
--                             Contact Attempt opens one; Call Done / Follow-up Completed resolves
--                             the oldest open one for that agency (never below 0). The attempt
--                             history stays in the agency activity log.
-- * Follow-up Calls Completed — Call Done or Follow-up Completed (+1 each saved action).
-- * Meeting Fixed           — Schedule Meeting with attendee, date and time (+1 per meeting;
--                             a day-of reminder is sent). Record Meeting only records outcomes.
-- * Visits Done             — Visited Partner (+1; completes the open visit reminder).
-- * Proposal Sent           — the first successful proposal dispatch for an agency (+1 once;
--                             retries, failures and later versions do not count again).
-- * Partner Onboarded / MOU Signed / Closed — unchanged events (registration activation, MOU
--                             marked signed with a date, stage Closed).
-- * Pending / Pending Follow-ups — current counters: the officer's agencies not yet Connected,
--                             and open follow-ups, meetings and visits due on or before the day.
-- Agency follow-ups, meetings and visits are rows in agency_tasks: one row per item for its
-- whole life, so carrying it to the next working day never duplicates it.
-- Safe to run more than once.

-- =============================================================== agency tasks
create table if not exists public.agency_tasks (
  id                 uuid primary key default gen_random_uuid(),
  prospect_id        uuid not null references public.agency_prospects (id) on delete cascade,
  kind               text not null check (kind in ('follow_up', 'meeting', 'visit')),
  due_date           date not null,
  due_time           time,
  attendee           text check (char_length(attendee) <= 160),
  location           text check (char_length(location) <= 200),
  note               text check (char_length(note) <= 2000),
  status             text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  assigned_to        uuid references public.profiles (id) on delete set null,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  created_activity   bigint,
  completed_at       timestamptz,
  completed_by       uuid,
  completed_activity bigint,
  carried_over_to    date,
  carry_count        integer not null default 0,
  reminded_on        date,
  request_key        uuid unique
);
create index if not exists agency_tasks_open_idx on public.agency_tasks (assigned_to, due_date) where status = 'open';
create index if not exists agency_tasks_prospect_idx on public.agency_tasks (prospect_id, status);
alter table public.agency_tasks enable row level security;
revoke all on public.agency_tasks from anon;
grant select on public.agency_tasks to authenticated;
drop policy if exists "agency tasks: read" on public.agency_tasks;
create policy "agency tasks: read" on public.agency_tasks for select to authenticated using (public.agency_access());
do $$ begin
  begin
    alter publication supabase_realtime add table public.agency_tasks;
  exception when others then null;
  end;
end $$;

-- Contact attempts stay open until a call or completed follow-up resolves them.
alter table public.agency_activities add column if not exists resolved_at timestamptz;
alter table public.agency_activities add column if not exists resolved_by_activity bigint;
create index if not exists agency_activities_open_attempts on public.agency_activities (prospect_id, id) where kind = 'contact_attempt' and resolved_at is null;

insert into public.work_activity_types (id, label, source) values ('partner_visit', 'Partner visit done', 'crm')
on conflict (id) do nothing;

-- Next working day for an employee (company calendar; at most 30 days ahead).
create or replace function public.next_working_day(p_emp uuid, p_from date)
returns date language plpgsql stable security definer set search_path = '' as $$
declare d date := p_from + 1; i int := 0;
begin
  while i < 30 loop
    if p_emp is null or public.is_working_day(p_emp, d) then return d; end if;
    d := d + 1; i := i + 1;
  end loop;
  return p_from + 1;
end $$;

-- Internal: resolve the oldest open contact attempt for an agency (floor at zero).
create or replace function public.agency_resolve_attempt(p_prospect uuid, p_by bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare aid bigint;
begin
  select id into aid from public.agency_activities where prospect_id = p_prospect and kind = 'contact_attempt' and resolved_at is null order by id limit 1 for update;
  if aid is null then return false; end if;
  update public.agency_activities set resolved_at = now(), resolved_by_activity = p_by where id = aid;
  return true;
end $$;

-- Internal: complete one open task of a kind (a chosen one, or the earliest due).
create or replace function public.agency_complete_task(p_prospect uuid, p_kinds text[], p_task uuid, p_by bigint, p_due_by date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare tid uuid;
begin
  if p_task is not null then
    select id into tid from public.agency_tasks where id = p_task and prospect_id = p_prospect and status = 'open' and kind = any (p_kinds) for update;
    if tid is null then raise exception 'That task is already completed or belongs to another agency'; end if;
  else
    select id into tid from public.agency_tasks where prospect_id = p_prospect and status = 'open' and kind = any (p_kinds)
      and (p_due_by is null or due_date <= p_due_by) order by due_date, due_time nulls last, created_at limit 1 for update;
  end if;
  if tid is null then return null; end if;
  update public.agency_tasks set status = 'done', completed_at = now(), completed_by = auth.uid(), completed_activity = p_by where id = tid;
  return tid;
end $$;

-- Keeps agency_prospects.next_follow_up = the earliest open follow-up / meeting / visit.
create or replace function public.agency_sync_next(p_prospect uuid)
returns void language sql security definer set search_path = '' as $$
  update public.agency_prospects a set next_follow_up = (select min(t.due_date) from public.agency_tasks t where t.prospect_id = a.id and t.status = 'open'), updated_at = now()
  where a.id = p_prospect;
$$;

-- Day-of reminder (once per task per day).
create or replace function public.agency_task_remind(p_task uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  select k.*, coalesce(a.company_name, a.contact_name, a.reference) as agency into t
  from public.agency_tasks k join public.agency_prospects a on a.id = k.prospect_id where k.id = p_task;
  if t.id is null or t.status <> 'open' or t.due_date <> public.company_today() or t.reminded_on = t.due_date then return; end if;
  insert into public.notifications (user_id, kind, title, body, link)
  select u, 'task', case t.kind when 'meeting' then 'Meeting today' when 'visit' then 'Partner visit today' else 'Follow-up due today' end,
         t.agency || coalesce(' · ' || to_char(t.due_time, 'HH24:MI'), '') || coalesce(' · ' || t.attendee, ''), 'agencies/' || t.prospect_id
  from unnest(array[coalesce(t.assigned_to, t.created_by)]) u where u is not null;
  update public.agency_tasks set reminded_on = t.due_date where id = p_task;
end $$;

-- =============================================================== the nine agency actions
-- p: note, task_id, due_date, due_time, attendee, location, mode ('meeting' | 'visit'), outcome, visit_date
create or replace function public.agency_action(p_id uuid, p_kind text, p jsonb, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  rid bigint; me uuid := public.my_employee_id(); a record; note text := nullif(btrim(coalesce(p ->> 'note', '')), '');
  d date; tm time; att text; tid uuid; done uuid; resolved boolean := false; officer uuid; mode text;
begin
  if not public.agency_can_see(p_id) then raise exception 'Not allowed to update this agency'; end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  if p_kind not in ('call', 'contact_attempt', 'follow_up', 'follow_up_done', 'meeting', 'note', 'schedule_meeting', 'visit') then raise exception 'Unknown activity'; end if;
  -- A repeated request (double click, retry) returns the first result and changes nothing.
  select id into rid from public.agency_activities where request_id = p_request;
  if rid is not null then return jsonb_build_object('activity_id', rid, 'duplicate', true); end if;
  select * into a from public.agency_prospects where id = p_id for update;
  officer := coalesce(a.assigned_officer, auth.uid());
  tid := nullif(p ->> 'task_id', '')::uuid;

  if p_kind = 'note' and note is null then raise exception 'Write the note'; end if;
  if p_kind in ('follow_up', 'schedule_meeting') then
    d := nullif(p ->> 'due_date', '')::date;
    tm := nullif(p ->> 'due_time', '')::time;
    if d is null then raise exception 'Choose the date'; end if;
    if d < public.company_today() then raise exception 'The date cannot be in the past'; end if;
  end if;
  if p_kind = 'schedule_meeting' then
    att := nullif(btrim(coalesce(p ->> 'attendee', '')), '');
    mode := coalesce(nullif(p ->> 'mode', ''), 'meeting');
    if mode not in ('meeting', 'visit') then raise exception 'Choose a meeting or a visit'; end if;
    if att is null or tm is null then raise exception 'MISSING: Enter the attendee name and the meeting time'; end if;
  end if;
  if p_kind = 'visit' and nullif(p ->> 'visit_date', '') is not null and (p ->> 'visit_date')::date > public.company_today() then
    raise exception 'A visit can only be recorded once it has happened';
  end if;

  rid := public.agency_log(p_id, p_kind, note,
    jsonb_strip_nulls(jsonb_build_object('due_date', d, 'due_time', tm, 'attendee', att, 'mode', mode, 'location', nullif(p ->> 'location', ''),
      'outcome', nullif(p ->> 'outcome', ''), 'attendees', nullif(p ->> 'attendees', ''), 'visit_date', nullif(p ->> 'visit_date', ''), 'task_id', tid)), p_request);

  if p_kind in ('call', 'follow_up_done') then
    resolved := public.agency_resolve_attempt(p_id, rid);
    done := public.agency_complete_task(p_id, array['follow_up'], tid, rid, case when p_kind = 'call' and tid is null then public.company_today() end);
    perform public.agency_work(me, 'partner_call', 'agency-act:' || rid, p_id, note);
  elsif p_kind = 'contact_attempt' then
    null;   -- stays open; counted as an open attempt until resolved
  elsif p_kind = 'follow_up' then
    insert into public.agency_tasks (prospect_id, kind, due_date, due_time, note, assigned_to, created_by, created_activity, request_key)
    values (p_id, 'follow_up', d, tm, note, officer, auth.uid(), rid, p_request) returning id into done;
    perform public.agency_advance(p_id, 'follow_up_required');
  elsif p_kind = 'schedule_meeting' then
    insert into public.agency_tasks (prospect_id, kind, due_date, due_time, attendee, location, note, assigned_to, created_by, created_activity, request_key)
    values (p_id, mode, d, tm, att, nullif(btrim(coalesce(p ->> 'location', '')), ''), note, officer, auth.uid(), rid, p_request) returning id into done;
    perform public.agency_work(me, 'partner_meeting', 'agency-meeting:' || done, p_id, att);
    perform public.agency_task_remind(done);
  elsif p_kind = 'meeting' then
    done := public.agency_complete_task(p_id, array['meeting'], tid, rid, case when tid is null then public.company_today() end);
  elsif p_kind = 'visit' then
    done := public.agency_complete_task(p_id, array['visit', 'meeting'], tid, rid, case when tid is null then public.company_today() end);
    perform public.agency_work(me, 'partner_visit', 'agency-visit:' || rid, p_id, note);
  end if;
  -- First outreach date (for "contacted this month"); New Partner Contacted itself counts only
  -- when the agency is marked Connected (set_agency_contact_status / Add Agency as Connected).
  if p_kind in ('call', 'contact_attempt', 'follow_up_done', 'meeting', 'visit') then perform public.agency_first_outreach(p_id); end if;

  update public.agency_prospects set
    last_contact_at = case when p_kind in ('call', 'contact_attempt', 'follow_up_done', 'meeting', 'visit') then now() else last_contact_at end,
    contact_status = case when p_kind = 'contact_attempt' and contact_status = 'unknown' then 'not_connected' else contact_status end,
    contact_changed_by = case when p_kind = 'contact_attempt' and contact_status = 'unknown' then auth.uid() else contact_changed_by end,
    contact_changed_at = case when p_kind = 'contact_attempt' and contact_status = 'unknown' then now() else contact_changed_at end,
    updated_at = now()
  where id = p_id;
  perform public.agency_sync_next(p_id);
  return jsonb_build_object('activity_id', rid, 'duplicate', false, 'task_id', done, 'attempt_resolved', resolved);
end $$;

-- The earlier entry point keeps working (older clients): it maps to agency_action.
create or replace function public.log_agency_activity(p_id uuid, p_kind text, p_note text, p_next date, p_request uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  r := public.agency_action(p_id, p_kind, jsonb_build_object('note', p_note, 'due_date', p_next), p_request);
  if p_next is not null and p_kind <> 'follow_up' then
    perform public.agency_action(p_id, 'follow_up', jsonb_build_object('due_date', p_next), gen_random_uuid());
  end if;
  return (r ->> 'activity_id')::bigint;
end $$;

-- Cancel an open follow-up / meeting / visit (kept in history).
create or replace function public.cancel_agency_task(p_task uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  select * into t from public.agency_tasks where id = p_task for update;
  if t.id is null or not public.agency_can_see(t.prospect_id) then raise exception 'Not allowed'; end if;
  if t.status <> 'open' then raise exception 'This item is already %', t.status; end if;
  update public.agency_tasks set status = 'cancelled', completed_at = now(), completed_by = auth.uid() where id = p_task;
  perform public.agency_log(t.prospect_id, 'task_cancelled', p_note, jsonb_build_object('task_id', p_task, 'kind', t.kind, 'due_date', t.due_date));
  perform public.agency_sync_next(t.prospect_id);
end $$;

-- =============================================================== Proposal Sent: first dispatch per agency
create or replace function public.finish_agency_proposal_send(p_id uuid, p_actor uuid, p_ok boolean, p_message_id text, p_detail text)
returns void language plpgsql security definer set search_path = '' as $$
declare r record; first_send boolean;
begin
  select * into r from public.agency_proposals where id = p_id and status = 'sending' for update;
  if r.id is null then return; end if;
  if p_ok then
    first_send := not exists (select 1 from public.agency_proposals x where x.prospect_id = r.prospect_id and x.id <> p_id and x.sent_at is not null);
    update public.agency_proposals set status = 'awaiting_confirmation', email_status = 'accepted', provider_message_id = p_message_id, email_detail = null,
      sent_at = now(), sending_since = null, updated_at = now() where id = p_id;
    perform public.agency_log(r.prospect_id, 'proposal_sent', null, jsonb_build_object('proposal_id', p_id, 'reference', r.reference, 'to', r.recipient_email, 'first', first_send), null, p_actor);
    perform public.agency_advance(r.prospect_id, 'proposal_sent', p_actor);
    -- Proposal Sent counts the first successful dispatch for the agency only.
    if first_send then
      perform public.agency_work((select id from public.employees where id = p_actor), 'proposal', 'proposal-first:' || r.prospect_id, r.prospect_id, r.reference);
    end if;
  else
    update public.agency_proposals set status = 'delivery_failed', email_status = 'failed', email_detail = left(p_detail, 300), token_hash = null,
      sending_since = null, updated_at = now() where id = p_id;
    perform public.agency_log(r.prospect_id, 'proposal_failed', p_detail, jsonb_build_object('proposal_id', p_id, 'reference', r.reference), null, p_actor);
  end if;
end $$;

-- =============================================================== pending counters for the report
alter table public.report_metric_sources drop constraint if exists report_metric_sources_kind_check;
alter table public.report_metric_sources add constraint report_metric_sources_kind_check check (kind in ('activity', 'workload', 'pending'));
alter table public.report_metric_sources add column if not exists pending text
  check (pending in ('agency_attempts', 'agency_not_connected', 'agency_followups', 'linkedin_pending'));

create or replace function public.report_pending(p_emp uuid, p_key text, p_date date)
returns jsonb language sql stable security definer set search_path = '' as $$
  with ids as (
    select a.prospect_id::text as id from public.agency_activities a join public.agency_prospects p on p.id = a.prospect_id
      where p_key = 'agency_attempts' and a.kind = 'contact_attempt' and a.resolved_at is null and a.actor = p_emp
    union all
    select p.id::text from public.agency_prospects p
      where p_key = 'agency_not_connected' and p.assigned_officer = p_emp and p.contact_status <> 'connected'
        and p.stage not in ('onboarded', 'closed', 'inactive')
    union all
    select t.id::text from public.agency_tasks t
      where p_key = 'agency_followups' and t.status = 'open' and coalesce(t.assigned_to, t.created_by) = p_emp and t.due_date <= p_date
    union all
    select l.id::text from public.linkedin_prospects l
      where p_key = 'linkedin_pending' and l.assigned_to = p_emp and l.status not in ('converted', 'not_interested')
        and (l.contact_status <> 'connected' or (l.next_follow_up is not null and l.next_follow_up <= p_date))
  )
  select jsonb_build_object('value', count(*), 'kind', 'pending', 'pending', p_key, 'ids', coalesce(jsonb_agg(id), '[]')) from ids;
$$;
revoke all on function public.report_pending(uuid, text, date) from public, anon, authenticated;

create or replace function public.compute_report_metrics(p_emp uuid, p_template text, p_date date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(s.field_key,
    case when s.kind = 'activity' then (
      select jsonb_build_object('value', coalesce(sum(a.quantity), 0), 'kind', 'activity', 'activity_ids', coalesce(jsonb_agg(a.id order by a.id), '[]'))
      from public.work_activities a
      where a.employee_id = p_emp and a.report_date = p_date and a.voided_at is null and a.activity_type = any (s.activity_types))
    when s.kind = 'pending' then public.report_pending(p_emp, s.pending, p_date)
    else (
      select jsonb_build_object('value', count(*), 'kind', 'workload', 'application_ids', coalesce(jsonb_agg(ap.id order by ap.id), '[]'))
      from public.applications ap
      where ap.assigned_to = p_emp and ap.status = any (public.workload_statuses(s.workload)))
    end), '{}')
  from public.report_metric_sources s
  where s.template_id = p_template;
$$;

-- Partnership Officer report, version 2 (version 1 stays for reports already written with it).
insert into public.report_templates (id, version, name, sections) values
('partnership_officer', 2, 'Partnership Officer — Daily Work Report', $j$[
 {"id":"outreach","title":"Partner Outreach & Onboarding","fields":[
   {"key":"po_new_partners_contacted","type":"count","label":"New partners contacted"},
   {"key":"po_followups_attempted","type":"count","label":"Follow-ups attempted (open)"},
   {"key":"po_followup_calls","type":"count","label":"Follow-up calls completed"},
   {"key":"po_meetings_fixed","type":"count","label":"Meetings fixed"},
   {"key":"po_visits_done","type":"count","label":"Visits done"},
   {"key":"po_proposals_sent","type":"count","label":"Proposals sent"},
   {"key":"po_partners_onboarded","type":"count","label":"Partners onboarded"},
   {"key":"po_mous_signed","type":"count","label":"MOUs signed (optional)"},
   {"key":"po_closed","type":"count","label":"Closed"},
   {"key":"po_pending","type":"count","label":"Pending (not connected)"},
   {"key":"po_pending_followups","type":"count","label":"Pending follow-ups"}]},
 {"id":"universities","title":"University Partnerships","fields":[
   {"key":"up_new_universities_contacted","type":"count","label":"New universities contacted"},
   {"key":"up_followups","type":"count","label":"Follow-ups completed"},
   {"key":"up_meetings_fixed","type":"count","label":"Meetings fixed"},
   {"key":"up_partnerships_onboarded","type":"count","label":"Partnerships onboarded"},
   {"key":"up_training_sessions_fixed","type":"count","label":"Training sessions fixed"},
   {"key":"up_closed","type":"count","label":"Closed"},
   {"key":"up_pending","type":"count","label":"Pending"}]},
 {"id":"linkedin","title":"LinkedIn Outreach","fields":[
   {"key":"li_new_connections","type":"count","label":"New contacts connected"},
   {"key":"li_followup_messages","type":"count","label":"Follow-up messages sent"},
   {"key":"li_positive_responses","type":"count","label":"Positive responses"},
   {"key":"li_closed","type":"count","label":"Closed"},
   {"key":"li_pending","type":"count","label":"Pending"}]},
 {"id":"updates","title":"Key Updates","fields":[
   {"key":"achievements","type":"text","label":"Today's Achievements"},
   {"key":"pending_followups","type":"text","label":"Pending Follow-ups"},
   {"key":"tomorrow_plan","type":"text","label":"Tomorrow's Plan"},
   {"key":"support_required","type":"text","label":"Support Required"}]}
]$j$)
on conflict (id, version) do update set sections = excluded.sections, name = excluded.name;

insert into public.report_metric_sources (template_id, field_key, kind, activity_types, workload, pending) values
  ('partnership_officer', 'po_followups_attempted', 'pending', '{}', null, 'agency_attempts'),
  ('partnership_officer', 'po_visits_done', 'activity', '{partner_visit}', null, null),
  ('partnership_officer', 'po_pending_followups', 'pending', '{}', null, 'agency_followups')
on conflict (template_id, field_key) do update set kind = excluded.kind, activity_types = excluded.activity_types, workload = excluded.workload, pending = excluded.pending;
update public.report_metric_sources set kind = 'pending', activity_types = '{}', pending = 'agency_not_connected'
where template_id in ('partnership_officer', 'senior_recruitment_manager') and field_key in ('po_pending', 'pd_pending');
update public.report_metric_sources set kind = 'pending', activity_types = '{}', pending = 'linkedin_pending'
where template_id = 'partnership_officer' and field_key = 'li_pending';
update public.report_metric_sources set activity_types = '{partner_meeting,partner_visit}'
where template_id = 'senior_recruitment_manager' and field_key = 'pd_meetings_visits';

-- =============================================================== task queue, rollover, reminders
-- The signed-in employee's open work: agency follow-ups / meetings / visits (overdue ones carried
-- forward with their original due date), LinkedIn follow-ups due, and agencies not yet connected.
create or replace function public.my_pending_work(p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid(); d date := coalesce(p_date, public.company_today()); res jsonb;
begin
  if not public.agency_access() then return null; end if;
  select jsonb_build_object(
    'date', d,
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'prospect_id', t.prospect_id, 'agency', coalesce(a.company_name, a.contact_name, a.reference),
                 'reference', a.reference, 'due_date', t.due_date, 'due_time', t.due_time, 'attendee', t.attendee, 'note', t.note, 'overdue', t.due_date < d,
                 'carry_count', t.carry_count, 'created_at', t.created_at) order by t.due_date, t.due_time nulls last)
               from public.agency_tasks t join public.agency_prospects a on a.id = t.prospect_id
               where t.status = 'open' and coalesce(t.assigned_to, t.created_by) = me and t.due_date <= d + 7), '[]'),
    'linkedin', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'reference', l.reference, 'due_date', l.next_follow_up, 'overdue', l.next_follow_up < d)
               order by l.next_follow_up)
               from public.linkedin_prospects l where l.assigned_to = me and l.status not in ('converted', 'not_interested')
                 and l.next_follow_up is not null and l.next_follow_up <= d), '[]'),
    'not_connected', (select count(*) from public.agency_prospects p where p.assigned_officer = me and p.contact_status <> 'connected'
                        and p.stage not in ('onboarded', 'closed', 'inactive')),
    'open_attempts', (select count(*) from public.agency_activities x where x.kind = 'contact_attempt' and x.resolved_at is null and x.actor = me))
  into res;
  return res;
end $$;

-- Day-end: every open item due today or earlier moves to the next working day's queue (same row,
-- original due date kept, carry count +1, once per day). Morning: day-of reminders.
create or replace function public.rollover_pending_work(p_day date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d date := coalesce(p_day, public.company_today()); n int := 0; t record;
begin
  if auth.uid() is not null and not public.is_super_admin() then raise exception 'Not allowed'; end if;
  for t in select id, coalesce(assigned_to, created_by) emp from public.agency_tasks
           where status = 'open' and due_date <= d and (carried_over_to is null or carried_over_to <= d) for update loop
    update public.agency_tasks set carried_over_to = public.next_working_day(t.emp, d), carry_count = carry_count + 1 where id = t.id;
    n := n + 1;
  end loop;
  return jsonb_build_object('day', d, 'carried', n);
end $$;

create or replace function public.send_task_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare t record; n int := 0;
begin
  if auth.uid() is not null and not public.is_super_admin() then raise exception 'Not allowed'; end if;
  for t in select id from public.agency_tasks where status = 'open' and due_date = public.company_today() and reminded_on is distinct from due_date loop
    perform public.agency_task_remind(t.id);
    n := n + 1;
  end loop;
  return n;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('ssi-task-rollover', 'ssi-task-reminders');
    -- 23:50 IST and 07:30 IST (company time is IST; cron runs in UTC).
    perform cron.schedule('ssi-task-rollover', '20 18 * * *', 'select public.rollover_pending_work()');
    perform cron.schedule('ssi-task-reminders', '0 2 * * *', 'select public.send_task_reminders()');
  end if;
end $$;

-- =============================================================== LinkedIn: three log actions
alter table public.linkedin_prospects add column if not exists conversion_pending boolean not null default false;

-- Change Stage: contacted, responded, positive response (interested), closed (not_interested),
-- with an optional next follow-up. Positive Response moves the contact to the Agency List when
-- the agency name, point of contact and a valid phone are known; otherwise it is marked as a
-- pending conversion and the missing details are asked for (nothing is invented).
create or replace function public.set_linkedin_stage(p_id uuid, p_stage text, p_note text, p_next date, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l record; kind text; rid bigint; conv jsonb; missing text[] := '{}'; digits text;
begin
  if not public.linkedin_editable(p_id) then raise exception 'Not allowed to update this prospect'; end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  if p_stage not in ('contacted', 'responded', 'interested', 'not_interested') then raise exception 'Unknown stage'; end if;
  select * into l from public.linkedin_prospects where id = p_id for update;
  if exists (select 1 from public.linkedin_activities where request_id = p_request) then
    return jsonb_build_object('status', l.status, 'duplicate', true, 'agency_id', l.agency_id, 'conversion_pending', l.conversion_pending);
  end if;
  if l.status = 'converted' then raise exception 'This prospect is already in the Agency List'; end if;
  kind := case p_stage when 'contacted' then 'contacted' when 'responded' then 'response' else p_stage end;
  rid := public.log_linkedin_activity(p_id, kind, p_note, p_next, p_request);
  if p_stage = 'interested' then
    digits := public.agency_digits(l.phone);
    if l.company_name is null then missing := array_append(missing, 'agency / company name'); end if;
    if l.phone is null or l.phone !~ '^\+?[0-9 ()./-]{7,30}$' or char_length(coalesce(digits, '')) not between 7 and 15 then missing := array_append(missing, 'a valid phone number'); end if;
    if cardinality(missing) = 0 then
      conv := public.convert_linkedin_prospect(p_id, '{}'::jsonb);
      update public.linkedin_prospects set conversion_pending = false where id = p_id;
      return jsonb_build_object('status', 'converted', 'agency_id', conv ->> 'agency_id', 'linked', conv -> 'linked', 'conversion_pending', false);
    end if;
    update public.linkedin_prospects set conversion_pending = true, updated_at = now() where id = p_id;
    return jsonb_build_object('status', 'interested', 'conversion_pending', true, 'missing', to_jsonb(missing));
  end if;
  return jsonb_build_object('status', (select status from public.linkedin_prospects where id = p_id), 'conversion_pending', false);
end $$;

-- =============================================================== University Partnerships
create table if not exists public.university_partnerships (
  id               uuid primary key default gen_random_uuid(),
  reference        text not null unique,
  institution_name text not null check (char_length(btrim(institution_name)) between 2 and 200),
  university_id    text references public.universities (id) on delete set null,
  country          text check (char_length(country) <= 80),
  city             text check (char_length(city) <= 80),
  contact_person   text check (char_length(contact_person) <= 120),
  designation      text check (char_length(designation) <= 120),
  email            text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone            text check (char_length(phone) <= 40),
  website          text check (char_length(website) <= 300),
  status           text not null default 'prospect'
                   check (status in ('prospect', 'contacted', 'in_discussion', 'meeting_fixed', 'agreement_sent', 'onboarded', 'closed')),
  assigned_officer uuid references public.profiles (id) on delete set null,
  follow_up_date   date,
  notes            text check (char_length(notes) <= 8000),
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_by       uuid,
  updated_at       timestamptz not null default now(),
  request_key      uuid unique
);
create table if not exists public.university_partnership_notes (
  id             bigint generated always as identity primary key,
  partnership_id uuid not null references public.university_partnerships (id) on delete cascade,
  kind           text not null default 'note',
  note           text check (char_length(note) <= 4000),
  detail         jsonb not null default '{}',
  author         uuid,
  at             timestamptz not null default now()
);
create index if not exists university_partnership_notes_idx on public.university_partnership_notes (partnership_id, at desc);
alter table public.university_partnerships enable row level security;
alter table public.university_partnership_notes enable row level security;
revoke all on public.university_partnerships, public.university_partnership_notes from anon;
grant select on public.university_partnerships, public.university_partnership_notes to authenticated;
drop policy if exists "university partnerships: read" on public.university_partnerships;
create policy "university partnerships: read" on public.university_partnerships for select to authenticated using (public.agency_access());
drop policy if exists "university partnership notes: read" on public.university_partnership_notes;
create policy "university partnership notes: read" on public.university_partnership_notes for select to authenticated using (public.agency_access());
do $$ begin
  begin alter publication supabase_realtime add table public.university_partnerships; exception when others then null; end;
  begin alter publication supabase_realtime add table public.university_partnership_notes; exception when others then null; end;
end $$;

-- Create (no id) or update a university partnership. Report heads: first contact, meeting
-- fixed, onboarded and closed are counted once per partnership when its status reaches them.
create or replace function public.save_university_partnership(p_id uuid, p jsonb, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; rid uuid := p_id; ref text; st text; em text; me uuid := public.my_employee_id(); nm text; old_status text; extra text;
begin
  if not public.agency_access() then raise exception 'Not allowed to manage university partnerships'; end if;
  nm := public.agency_clean(p, 'institution_name', 200);
  st := coalesce(nullif(p ->> 'status', ''), 'prospect');
  if st not in ('prospect', 'contacted', 'in_discussion', 'meeting_fixed', 'agreement_sent', 'onboarded', 'closed') then raise exception 'Unknown status'; end if;
  em := lower(public.agency_clean(p, 'email', 200));
  if em is not null and em !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address, or leave it empty'; end if;
  if nullif(p ->> 'university_id', '') is not null and not exists (select 1 from public.universities where id = p ->> 'university_id') then
    raise exception 'Unknown Education Provider';
  end if;
  extra := public.agency_clean(p, 'note', 4000);
  if rid is null then
    if p_request is null then raise exception 'A request id is required'; end if;
    select id into rid from public.university_partnerships where request_key = p_request;
    if rid is not null then return jsonb_build_object('id', rid, 'duplicate', true); end if;
    if nm is null or char_length(nm) < 2 then raise exception 'MISSING: Enter the university / institution name'; end if;
    loop
      ref := public.agency_ref('UP');
      exit when not exists (select 1 from public.university_partnerships where reference = ref);
    end loop;
    insert into public.university_partnerships (reference, institution_name, university_id, country, city, contact_person, designation, email, phone, website,
      status, assigned_officer, follow_up_date, notes, created_by, updated_by, request_key)
    values (ref, nm, nullif(p ->> 'university_id', ''), public.agency_clean(p, 'country', 80), public.agency_clean(p, 'city', 80), public.agency_clean(p, 'contact_person', 120),
      public.agency_clean(p, 'designation', 120), em, public.agency_clean(p, 'phone', 40), public.agency_clean(p, 'website', 300), st,
      coalesce(case when public.agency_manager() then nullif(p ->> 'assigned_officer', '')::uuid end, auth.uid()),
      nullif(p ->> 'follow_up_date', '')::date, public.agency_clean(p, 'notes', 8000), auth.uid(), auth.uid(), p_request)
    returning id into rid;
    insert into public.university_partnership_notes (partnership_id, kind, note, detail, author) values (rid, 'created', extra, jsonb_build_object('status', st), auth.uid());
    old_status := 'prospect';
  else
    select * into r from public.university_partnerships where id = rid for update;
    if r.id is null then raise exception 'Not found'; end if;
    old_status := r.status;
    update public.university_partnerships set
      institution_name = coalesce(case when p ? 'institution_name' then nm end, institution_name),
      university_id = case when p ? 'university_id' then nullif(p ->> 'university_id', '') else university_id end,
      country = case when p ? 'country' then public.agency_clean(p, 'country', 80) else country end,
      city = case when p ? 'city' then public.agency_clean(p, 'city', 80) else city end,
      contact_person = case when p ? 'contact_person' then public.agency_clean(p, 'contact_person', 120) else contact_person end,
      designation = case when p ? 'designation' then public.agency_clean(p, 'designation', 120) else designation end,
      email = case when p ? 'email' then em else email end,
      phone = case when p ? 'phone' then public.agency_clean(p, 'phone', 40) else phone end,
      website = case when p ? 'website' then public.agency_clean(p, 'website', 300) else website end,
      status = st,
      assigned_officer = case when p ? 'assigned_officer' and public.agency_manager() then nullif(p ->> 'assigned_officer', '')::uuid else assigned_officer end,
      follow_up_date = case when p ? 'follow_up_date' then nullif(p ->> 'follow_up_date', '')::date else follow_up_date end,
      notes = case when p ? 'notes' then public.agency_clean(p, 'notes', 8000) else notes end,
      updated_by = auth.uid(), updated_at = now()
    where id = rid;
    insert into public.university_partnership_notes (partnership_id, kind, note, detail, author)
    values (rid, case when old_status <> st then 'status' else 'edited' end, extra, jsonb_build_object('from', old_status, 'to', st), auth.uid());
  end if;
  if st <> 'prospect' then perform public.record_work_activity(me, 'university_contact', 'up-contact:' || rid, 'university', rid::text); end if;
  if st = 'meeting_fixed' and old_status <> st then perform public.record_work_activity(me, 'university_meeting', 'up-meeting:' || rid, 'university', rid::text); end if;
  if st = 'onboarded' then perform public.record_work_activity(me, 'university_onboarded', 'up-onboarded:' || rid, 'university', rid::text); end if;
  if st = 'closed' then perform public.record_work_activity(me, 'university_closed', 'up-closed:' || rid, 'university', rid::text); end if;
  return jsonb_build_object('id', rid, 'duplicate', false);
end $$;

create or replace function public.add_university_partnership_note(p_id uuid, p_note text, p_followup_done boolean default false)
returns bigint language plpgsql security definer set search_path = '' as $$
declare rid bigint; n text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.agency_access() then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.university_partnerships where id = p_id) then raise exception 'Not found'; end if;
  if n is null then raise exception 'Write the note'; end if;
  insert into public.university_partnership_notes (partnership_id, kind, note, author) values (p_id, case when p_followup_done then 'follow_up_done' else 'note' end, n, auth.uid())
  returning id into rid;
  update public.university_partnerships set updated_at = now(), updated_by = auth.uid(),
    follow_up_date = case when p_followup_done and follow_up_date <= public.company_today() then null else follow_up_date end where id = p_id;
  if p_followup_done then perform public.record_work_activity(public.my_employee_id(), 'university_followup', 'up-fu:' || rid, 'university', p_id::text); end if;
  return rid;
end $$;

-- =============================================================== partner accounts permission
-- "Partner accounts": an employee a Super Admin trusts to create partner logins for existing
-- (onboarded, not archived) organisations. Portal access itself stays a Super Admin decision.
create or replace function public.staff_modules()
returns text[] language sql immutable set search_path = '' as $$
  select array['partners', 'students', 'applications', 'assessments', 'documents', 'finance',
               'catalogue', 'tasks', 'updates', 'reports', 'work_reports', 'hr', 'hr_accounts', 'hr_salary',
               'commission_view', 'commission_tag', 'commission_manage', 'commission_internal', 'commission_edit',
               'partner_onboarding', 'agency_outreach', 'partner_accounts'];
$$;

-- =============================================================== grants
do $$
declare f text;
begin
  foreach f in array array['agency_action(uuid, text, jsonb, uuid)', 'log_agency_activity(uuid, text, text, date, uuid)', 'cancel_agency_task(uuid, text)',
                           'my_pending_work(date)', 'rollover_pending_work(date)', 'send_task_reminders()', 'set_linkedin_stage(uuid, text, text, date, uuid)',
                           'save_university_partnership(uuid, jsonb, uuid)', 'add_university_partnership_note(uuid, text, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['agency_resolve_attempt(uuid, bigint)', 'agency_complete_task(uuid, text[], uuid, bigint, date)', 'agency_sync_next(uuid)',
                           'agency_task_remind(uuid)', 'next_working_day(uuid, date)', 'finish_agency_proposal_send(uuid, uuid, boolean, text, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

update public.work_activity_types set label = 'Meeting fixed (scheduled)' where id = 'partner_meeting';
