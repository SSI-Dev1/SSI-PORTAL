-- 0046 · LinkedIn Outreach: contact status vs follow-up completion, pending counts, next-day reminders
--
-- Root causes fixed:
-- * Follow-up Completed on a prospect whose outreach status was still "not contacted" was credited as
--   "New contact connected" (log_linkedin_activity used the follow-up as the first contact) and moved
--   the pipeline to "contacted". The live audit shows Dan and David John credited that way. Now only
--   an explicit Connected (set_linkedin_contact_status) counts as a connection; a follow-up counts as a
--   follow-up message and never touches the contact status.
-- * LinkedIn "Pending" mixed two things (not connected + follow-ups due) and, before 0044, was a
--   manual quick-log figure that stayed 0. Now two current counters: Pending contacts (Not recorded
--   or Not connected, not closed / converted — a name-only prospect counts at once) and LinkedIn
--   follow-ups due. The Senior IRM report gets the LinkedIn section too (template v2).
-- * Unresolved prospects without a follow-up get one next-action date (the next working day) at
--   day-end — one per prospect, never duplicated — and a reminder on the day.
-- Contact status: Not recorded / Not connected / Connected (explicit, audited). Follow-up: the one
-- outstanding next_follow_up date (completed = cleared or replaced). Pipeline: status (unchanged).
-- Safe to run more than once.

alter table public.linkedin_prospects add column if not exists next_follow_up_auto boolean not null default false;

-- =============================================================== explicit contact status (+ Not recorded)
create or replace function public.set_linkedin_contact_status(p_id uuid, p_status text, p_note text, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l record; rid bigint; me uuid := public.my_employee_id();
begin
  if not public.linkedin_editable(p_id) then raise exception 'Not allowed to update this prospect'; end if;
  if p_status not in ('connected', 'not_connected', 'unknown') then raise exception 'Choose Connected, Not connected or Not recorded'; end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  select * into l from public.linkedin_prospects where id = p_id for update;
  if exists (select 1 from public.linkedin_activities where request_id = p_request) or l.contact_status = p_status then
    return jsonb_build_object('contact_status', l.contact_status, 'changed', false);
  end if;
  rid := public.linkedin_log(p_id, 'contact_status', p_note, jsonb_build_object('from', l.contact_status, 'to', p_status), p_request);
  update public.linkedin_prospects set contact_status = p_status, contact_changed_by = auth.uid(), contact_changed_at = now(),
    status = case when p_status = 'connected' and l.status = 'not_contacted' then 'contacted' else status end,
    last_contact_at = case when p_status = 'connected' then now() else last_contact_at end,
    updated_at = now()
  where id = p_id;
  -- New Contact Connected: only this explicit event, once per prospect.
  if p_status = 'connected' then
    perform public.agency_work(me, 'linkedin_connection', 'li-contact:' || p_id, null, p_note);
    update public.work_activities set entity_type = 'linkedin', entity_id = p_id::text where dedupe_key = 'li-contact:' || p_id and entity_id is null;
  end if;
  return jsonb_build_object('contact_status', p_status, 'changed', true);
end $$;

-- =============================================================== follow-up / stages never imply a connection
create or replace function public.log_linkedin_activity(p_id uuid, p_kind text, p_note text, p_next date, p_request uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare l record; rid bigint; me uuid := public.my_employee_id(); nst text;
begin
  if not public.linkedin_editable(p_id) then raise exception 'Not allowed to update this prospect'; end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  if p_kind not in ('contacted', 'follow_up', 'response', 'interested', 'not_interested', 'note', 'follow_up_date') then raise exception 'Unknown activity'; end if;
  if p_next is not null and p_next < public.company_today() then raise exception 'The follow-up date cannot be in the past'; end if;
  if p_kind = 'follow_up_date' and p_next is null then raise exception 'Choose the follow-up date'; end if;
  select * into l from public.linkedin_prospects where id = p_id for update;
  if l.status = 'converted' and p_kind not in ('note') then raise exception 'This prospect is already converted to an agency'; end if;
  rid := public.linkedin_log(p_id, p_kind, p_note,
    jsonb_build_object('next_follow_up', p_next, 'from', l.status, 'contact_status', l.contact_status, 'completed_follow_up', case when p_kind = 'follow_up' then l.next_follow_up end), p_request);
  if rid is null then return (select id from public.linkedin_activities where request_id = p_request); end if;
  -- Pipeline only (outreach sent / responded / positive / closed). The contact status is never changed here.
  nst := case p_kind when 'contacted' then case when l.status = 'not_contacted' then 'contacted' else l.status end
                     when 'follow_up' then case when l.status = 'not_contacted' then 'contacted' else l.status end
                     when 'response' then case when l.status in ('not_contacted', 'contacted') then 'responded' else l.status end
                     when 'interested' then 'interested' when 'not_interested' then 'not_interested' else l.status end;
  update public.linkedin_prospects set status = nst,
    last_contact_at = case when p_kind in ('contacted', 'follow_up', 'response', 'interested', 'not_interested') then now() else last_contact_at end,
    -- Follow-up Completed completes the outstanding follow-up, and a new date (if given) is the next one.
    next_follow_up = case when p_kind = 'follow_up' then p_next
                          when p_kind = 'follow_up_date' then p_next
                          when p_kind = 'not_interested' then null
                          else coalesce(p_next, next_follow_up) end,
    next_follow_up_auto = case when p_kind in ('follow_up', 'follow_up_date', 'not_interested') or p_next is not null then false else next_follow_up_auto end,
    updated_at = now()
  where id = p_id;
  -- Daily report: follow-up messages, positive responses and closing. Never a connection.
  if p_kind = 'follow_up' then perform public.agency_work(me, 'linkedin_followup', 'li-act:' || rid, null, p_note); end if;
  if p_kind = 'interested' then perform public.agency_work(me, 'linkedin_positive', 'li-positive:' || p_id, null, p_note); end if;
  if p_kind = 'not_interested' then perform public.agency_work(me, 'linkedin_closed', 'li-closed:' || p_id, null, p_note); end if;
  update public.work_activities set entity_type = 'linkedin', entity_id = p_id::text
  where dedupe_key in ('li-act:' || rid, 'li-positive:' || p_id, 'li-closed:' || p_id) and entity_id is null;
  return rid;
end $$;

-- =============================================================== pending counters (contacts vs follow-ups)
alter table public.report_metric_sources drop constraint if exists report_metric_sources_pending_check;
alter table public.report_metric_sources add constraint report_metric_sources_pending_check
  check (pending in ('agency_attempts', 'agency_not_connected', 'agency_followups', 'linkedin_pending', 'linkedin_followups'));

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
    -- Pending contacts: Not recorded or Not connected, still open (a name-only prospect counts at once).
    select l.id::text from public.linkedin_prospects l
      where p_key = 'linkedin_pending' and l.assigned_to = p_emp and l.status not in ('converted', 'not_interested') and l.contact_status <> 'connected'
    union all
    -- LinkedIn follow-ups due on or before the day (one per prospect).
    select l.id::text from public.linkedin_prospects l
      where p_key = 'linkedin_followups' and l.assigned_to = p_emp and l.status not in ('converted', 'not_interested')
        and l.next_follow_up is not null and l.next_follow_up <= p_date
  )
  select jsonb_build_object('value', count(*), 'kind', 'pending', 'pending', p_key, 'ids', coalesce(jsonb_agg(id), '[]')) from ids;
$$;
revoke all on function public.report_pending(uuid, text, date) from public, anon, authenticated;

-- Partnership Officer report v3: LinkedIn pending contacts and follow-ups shown separately.
insert into public.report_templates (id, version, name, sections)
select 'partnership_officer', 3, name, (
  select jsonb_agg(case when s ->> 'id' = 'linkedin' then jsonb_set(s, '{fields}', $j$[
     {"key":"li_new_connections","type":"count","label":"New contacts connected"},
     {"key":"li_followup_messages","type":"count","label":"Follow-up messages sent"},
     {"key":"li_positive_responses","type":"count","label":"Positive responses"},
     {"key":"li_closed","type":"count","label":"Closed"},
     {"key":"li_pending","type":"count","label":"Pending contacts (not connected)"},
     {"key":"li_pending_followups","type":"count","label":"LinkedIn follow-ups due"}]$j$::jsonb) else s end order by ord)
  from jsonb_array_elements(sections) with ordinality as e(s, ord))
from public.report_templates where id = 'partnership_officer' and version = 2
on conflict (id, version) do update set sections = excluded.sections;

-- Senior IRM report v2: the same LinkedIn section (existing sections unchanged).
insert into public.report_templates (id, version, name, sections)
select 'senior_recruitment_manager', 2, name, $s$[{"fields": [{"key": "pd_new_partners_contacted", "label": "New partners contacted", "type": "count"}, {"key": "pd_meetings_visits", "label": "Partner meetings / office visits", "type": "count"}, {"key": "pd_followup_calls", "label": "Follow-up calls completed", "type": "count"}, {"key": "pd_proposal_requests", "label": "Proposal requests assigned", "type": "count"}, {"key": "pd_partners_onboarded", "label": "Partners onboarded", "type": "count"}, {"key": "pd_closed", "label": "Closed", "type": "count"}, {"key": "pd_pending", "label": "Pending", "type": "count"}], "id": "development", "title": "Partner Development"}, {"fields": [{"key": "tr_training_conducted", "label": "Online/offline training conducted", "type": "count"}, {"key": "tr_options_shared", "label": "University/course options shared", "type": "count"}, {"key": "tr_profiles_discussed", "label": "Student profiles discussed", "type": "count"}, {"key": "tr_applications_generated", "label": "Applications generated", "type": "count"}, {"key": "tr_applications_converted", "label": "Applications converted", "type": "count"}], "id": "training", "title": "Training & Recruitment"}, {"fields": [{"key": "as_offer_tat_followups", "label": "Offer/TAT follow-ups", "type": "count"}, {"key": "as_cas_interview_support", "label": "CAS / interview support", "type": "count"}, {"key": "as_tuition_deposits", "label": "Tuition deposits completed", "type": "count"}, {"key": "as_visa_applications", "label": "Visa applications / updates", "type": "count"}, {"key": "as_visa_successes", "label": "Successful visa outcomes", "type": "count"}, {"key": "as_escalations_resolved", "label": "Escalations resolved", "type": "count"}, {"key": "as_cases_pending", "label": "Cases pending", "type": "count"}], "id": "admission", "title": "Admission Support"}, {"id": "linkedin", "title": "LinkedIn Outreach", "fields": [{"key": "li_new_connections", "type": "count", "label": "New contacts connected"}, {"key": "li_followup_messages", "type": "count", "label": "Follow-up messages sent"}, {"key": "li_positive_responses", "type": "count", "label": "Positive responses"}, {"key": "li_closed", "type": "count", "label": "Closed"}, {"key": "li_pending", "type": "count", "label": "Pending contacts (not connected)"}, {"key": "li_pending_followups", "type": "count", "label": "LinkedIn follow-ups due"}]}, {"fields": [{"key": "achievements", "label": "Key Achievements", "type": "text"}, {"key": "pending_followups", "label": "Pending Follow-ups", "type": "text"}, {"key": "tomorrow_plan", "label": "Tomorrow's Plan", "type": "text"}, {"key": "support_required", "label": "Support Required", "type": "text"}], "id": "summary", "title": "Daily Summary"}]$s$::jsonb
from public.report_templates where id = 'senior_recruitment_manager' and version = 1
on conflict (id, version) do update set sections = excluded.sections;

insert into public.report_metric_sources (template_id, field_key, kind, activity_types, workload, pending) values
  ('partnership_officer', 'li_pending_followups', 'pending', '{}', null, 'linkedin_followups'),
  ('senior_recruitment_manager', 'li_new_connections', 'activity', '{linkedin_connection}', null, null),
  ('senior_recruitment_manager', 'li_followup_messages', 'activity', '{linkedin_followup}', null, null),
  ('senior_recruitment_manager', 'li_positive_responses', 'activity', '{linkedin_positive}', null, null),
  ('senior_recruitment_manager', 'li_closed', 'activity', '{linkedin_closed}', null, null),
  ('senior_recruitment_manager', 'li_pending', 'pending', '{}', null, 'linkedin_pending'),
  ('senior_recruitment_manager', 'li_pending_followups', 'pending', '{}', null, 'linkedin_followups')
on conflict (template_id, field_key) do update set kind = excluded.kind, activity_types = excluded.activity_types, workload = excluded.workload, pending = excluded.pending;
update public.report_metric_sources set kind = 'pending', activity_types = '{}', pending = 'linkedin_pending'
where template_id = 'partnership_officer' and field_key = 'li_pending';

-- =============================================================== task queue, rollover, reminders
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
    'linkedin', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'reference', l.reference, 'due_date', l.next_follow_up, 'overdue', l.next_follow_up < d,
                 'contact_status', l.contact_status, 'auto', l.next_follow_up_auto) order by l.next_follow_up)
               from public.linkedin_prospects l where l.assigned_to = me and l.status not in ('converted', 'not_interested')
                 and l.next_follow_up is not null and l.next_follow_up <= d), '[]'),
    'linkedin_pending_contacts', (select count(*) from public.linkedin_prospects l where l.assigned_to = me and l.status not in ('converted', 'not_interested') and l.contact_status <> 'connected'),
    'not_connected', (select count(*) from public.agency_prospects p where p.assigned_officer = me and p.contact_status <> 'connected'
                        and p.stage not in ('onboarded', 'closed', 'inactive')),
    'open_attempts', (select count(*) from public.agency_activities x where x.kind = 'contact_attempt' and x.resolved_at is null and x.actor = me))
  into res;
  return res;
end $$;

-- Day-end: open agency follow-ups / meetings / visits move to the next working day (0044), and each
-- unresolved LinkedIn prospect (Not recorded / Not connected, still open) without a follow-up gets
-- one next-action date on the next working day. Once per item; running it again changes nothing.
create or replace function public.rollover_pending_work(p_day date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d date := coalesce(p_day, public.company_today()); n int := 0; li int := 0; t record; nd date;
begin
  if auth.uid() is not null and not public.is_super_admin() then raise exception 'Not allowed'; end if;
  for t in select id, coalesce(assigned_to, created_by) emp from public.agency_tasks
           where status = 'open' and due_date <= d and (carried_over_to is null or carried_over_to <= d) for update loop
    update public.agency_tasks set carried_over_to = public.next_working_day(t.emp, d), carry_count = carry_count + 1 where id = t.id;
    n := n + 1;
  end loop;
  for t in select id, assigned_to from public.linkedin_prospects
           where status not in ('converted', 'not_interested') and contact_status <> 'connected' and next_follow_up is null and assigned_to is not null
           for update loop
    nd := public.next_working_day(t.assigned_to, d);
    update public.linkedin_prospects set next_follow_up = nd, next_follow_up_auto = true, updated_at = now() where id = t.id;
    perform public.linkedin_log(t.id, 'follow_up_date', 'Not connected yet — carried to the next working day', jsonb_build_object('next_follow_up', nd, 'auto', true), null);
    li := li + 1;
  end loop;
  return jsonb_build_object('day', d, 'carried', n, 'linkedin_scheduled', li);
end $$;

create or replace function public.send_task_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare t record; n int := 0; d date := public.company_today();
begin
  if auth.uid() is not null and not public.is_super_admin() then raise exception 'Not allowed'; end if;
  for t in select id from public.agency_tasks where status = 'open' and due_date = d and reminded_on is distinct from due_date loop
    perform public.agency_task_remind(t.id);
    n := n + 1;
  end loop;
  -- One LinkedIn reminder per employee per day (listing how many follow-ups are due).
  for t in select l.assigned_to u, count(*) c, min(l.name) first_name from public.linkedin_prospects l
           where l.status not in ('converted', 'not_interested') and l.next_follow_up is not null and l.next_follow_up <= d and l.assigned_to is not null
             and not exists (select 1 from public.reminder_log r where r.kind = 'li_followups' and r.ref = l.assigned_to::text and r.sent_on = d)
           group by l.assigned_to loop
    insert into public.notifications (user_id, kind, title, body, link)
    values (t.u, 'task', 'LinkedIn follow-ups due', t.c || ' prospect' || case when t.c = 1 then '' else 's' end || ' to follow up today (' || t.first_name || case when t.c > 1 then ' and others' else '' end || ')', 'agencies/linkedin');
    insert into public.reminder_log (kind, ref, sent_on) values ('li_followups', t.u::text, d) on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

do $$
declare f text;
begin
  foreach f in array array['set_linkedin_contact_status(uuid, text, text, uuid)', 'log_linkedin_activity(uuid, text, text, date, uuid)', 'my_pending_work(date)',
                           'rollover_pending_work(date)', 'send_task_reminders()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
