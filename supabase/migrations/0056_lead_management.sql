-- 0056_lead_management.sql — run after 0055_report_snapshots_historical_onboarding.sql
-- (Supabase SQL Editor: Save this query as "0056_lead_management")
--
-- Partner Success Officers' workflow (designation partner_success_officer, permission "leads";
-- never by employee name):
-- * Leads: prospective students from first inquiry to conversion. Contact outcome (Not recorded /
--   Not connected / Connected, forward only) is separate from the stage (Cold / Warm / Converted /
--   Closed) and from the No Response flag. One current queue per lead: Pending, No response,
--   In progress, Converted or Closed.
-- * Six Log Activity actions (Contact attempt, Call done, Follow-up done, Add follow-up, Add note,
--   Change stage) plus No Response. Follow-ups are lead_tasks rows: one row for the task's whole
--   life, carried to the next working day by the existing day-end rollover (never duplicated).
-- * Move to Student List: creates the student (or links the existing one with the same email under
--   the same agent), keeps the lead reference, marks the lead Converted only after that succeeded.
--   A lead without a partner agency is recorded under the agent "Direct" (internal partner record).
-- * Applications: deposit and CAS milestones (each state counted once per application) and a
--   history table; offers and visa already come from status changes (0017).
-- * Log Student Activity: course/university options suggested, offer follow-up, case closure, note.
-- * Partner Success report v2 (field per PDF item), pending lead queues, Tomorrow's Plan and
--   support requests in my_pending_work (so the screen, the snapshot and the PDF agree).
-- * Support requests with an Admin-configurable escalation to the reporting manager (off until set).
-- Safe to run more than once.

-- =============================================================== permission
create or replace function public.staff_modules()
returns text[] language sql immutable set search_path = '' as $$
  select array['partners', 'students', 'applications', 'assessments', 'documents', 'finance',
               'catalogue', 'tasks', 'updates', 'reports', 'work_reports', 'hr', 'hr_accounts', 'hr_salary',
               'commission_view', 'commission_tag', 'commission_manage', 'commission_internal', 'commission_edit',
               'partner_onboarding', 'agency_outreach', 'partner_accounts', 'partner_success', 'partner_create',
               'agreement_countersign', 'leads'];
$$;
update public.designations set default_permissions = array_append(default_permissions, 'leads')
where id = 'partner_success_officer' and not ('leads' = any (default_permissions));
update public.profiles p set permissions = array_append(p.permissions, 'leads')
from public.employees e
where e.id = p.id and e.designation_id = 'partner_success_officer' and p.permissions is not null
  and p.role not in ('super_admin', 'admin_staff') and not ('leads' = any (p.permissions));

create or replace function public.lead_access()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.my_profile_ok() and public.is_staff() and (public.is_super_admin() or public.staff_can('leads'));
$$;

-- =============================================================== "Direct" agent
-- Students must belong to a partner record; direct leads (no partner agency) use this internal one.
-- It has no portal, no logins, no commission and is never listed as a client (its status stays
-- Onboarding, so the onboarded-client directory skips it, and the partner directory skips internal).
alter table public.partners add column if not exists internal boolean not null default false;
insert into public.partners (id, name, code, contact_name, email, status, portal_enabled, commission_visible, internal)
values ('direct', 'Direct', 'DIRECT', 'SSI GLOBAL', 'direct@ssiglobal.invalid', 'Onboarding', false, false, true)
on conflict (id) do update set internal = true, portal_enabled = false, commission_visible = false;

create or replace function public.partner_directory_status()
returns table (partner_id text, business_status text, portal_status text, onboarding_source text, users integer, agency_id uuid,
               agency_reference text, contact_name text, phone text, agency_type text, main_officer_id uuid, sub_officer_id uuid)
language sql stable security definer set search_path = '' as $$
  with u as (select p.partner_id, count(*) filter (where p.status = 'active')::int as n from public.profiles p where p.partner_id is not null group by 1)
  select o.id,
         case when o.onboarding_source = 'historical' and coalesce(u.n, 0) = 0 then 'historical'
              when o.status in ('Active', 'Inactive') then 'verified'
              else 'not_onboarded' end,
         case when o.archived_at is not null then 'deactivated'
              when o.status = 'Inactive' then 'suspended'
              when coalesce(u.n, 0) = 0 then 'no_account'
              when not o.portal_enabled or o.status <> 'Active' then 'pending'
              else 'active' end,
         o.onboarding_source, coalesce(u.n, 0), a.id, a.reference, o.contact_name, o.phone, coalesce(o.agency_type, a.agency_type),
         coalesce(a.assigned_officer, o.partnership_officer_id), coalesce(a.sub_officer, o.sub_officer_id)
  from public.partners o
  left join u on u.partner_id = o.id
  left join public.agency_prospects a on a.partner_id = o.id
  where not o.internal and public.my_profile_ok() and public.is_staff() and (public.staff_can('partners') or public.agency_access());
$$;

-- =============================================================== leads
create table if not exists public.leads (
  id                  uuid primary key default gen_random_uuid(),
  reference           text not null unique,
  name                text not null check (char_length(btrim(name)) between 2 and 160),
  phone               text check (char_length(phone) <= 40),
  email               text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  qualification       text check (char_length(qualification) <= 200),
  application_details text check (char_length(application_details) <= 4000),
  partner_id          text references public.partners (id) on delete set null,
  source              text not null default 'direct' check (source in ('direct', 'partner', 'website', 'walk_in', 'social', 'referral', 'event', 'other')),
  contact_status      text not null default 'unknown' check (contact_status in ('unknown', 'not_connected', 'connected')),
  contact_changed_by  uuid,
  contact_changed_at  timestamptz,
  stage               text not null default 'cold' check (stage in ('cold', 'warm', 'converted', 'closed')),
  stage_changed_by    uuid,
  stage_changed_at    timestamptz,
  no_response         boolean not null default false,
  no_response_at      timestamptz,
  assigned_to         uuid references public.profiles (id) on delete set null,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  student_id          text unique references public.students (id) on delete set null,
  converted_by        uuid,
  converted_at        timestamptz,
  request_key         uuid unique
);
create index if not exists leads_assigned_idx on public.leads (assigned_to, stage);
create index if not exists leads_email_idx on public.leads (lower(email));

create table if not exists public.lead_activities (
  id         bigint generated always as identity primary key,
  lead_id    uuid not null references public.leads (id) on delete cascade,
  kind       text not null,
  outcome    text,
  note       text check (char_length(note) <= 4000),
  detail     jsonb not null default '{}',
  actor      uuid,
  at         timestamptz not null default now(),
  request_id uuid unique
);
create index if not exists lead_activities_idx on public.lead_activities (lead_id, at desc);

create table if not exists public.lead_tasks (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references public.leads (id) on delete cascade,
  due_date        date not null,
  due_time        time,
  note            text check (char_length(note) <= 2000),
  status          text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  assigned_to     uuid references public.profiles (id) on delete set null,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,
  completed_by    uuid,
  carried_over_to date,
  carry_count     integer not null default 0,
  request_key     uuid unique
);
create index if not exists lead_tasks_open_idx on public.lead_tasks (assigned_to, due_date) where status = 'open';
create index if not exists lead_tasks_lead_idx on public.lead_tasks (lead_id, status);

alter table public.students add column if not exists lead_id uuid unique references public.leads (id) on delete set null;

-- Own leads (with Lead Management), all leads for a Super Admin, and the team members' leads for
-- their reporting manager.
create or replace function public.lead_visible(p_assigned uuid, p_created uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (public.lead_access() and (public.is_super_admin() or p_assigned = auth.uid() or p_created = auth.uid()))
      or (p_assigned is not null and p_assigned <> auth.uid() and public.in_my_team(p_assigned));
$$;
create or replace function public.lead_editable(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.leads l where l.id = p_id and public.lead_visible(l.assigned_to, l.created_by));
$$;

alter table public.leads enable row level security;
alter table public.lead_activities enable row level security;
alter table public.lead_tasks enable row level security;
revoke all on public.leads, public.lead_activities, public.lead_tasks from anon;
revoke insert, update, delete on public.leads, public.lead_activities, public.lead_tasks from authenticated;
grant select on public.leads, public.lead_activities, public.lead_tasks to authenticated;
drop policy if exists "leads: read" on public.leads;
create policy "leads: read" on public.leads for select to authenticated
  using (((select public.lead_access()) and ((select public.is_super_admin()) or assigned_to = (select auth.uid()) or created_by = (select auth.uid())))
         or (assigned_to is not null and public.in_my_team(assigned_to)));
drop policy if exists "lead activities: read" on public.lead_activities;
create policy "lead activities: read" on public.lead_activities for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));
drop policy if exists "lead tasks: read" on public.lead_tasks;
create policy "lead tasks: read" on public.lead_tasks for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));
do $$ begin
  begin alter publication supabase_realtime add table public.leads; exception when others then null; end;
  begin alter publication supabase_realtime add table public.lead_activities; exception when others then null; end;
  begin alter publication supabase_realtime add table public.lead_tasks; exception when others then null; end;
end $$;

-- =============================================================== activity types
insert into public.work_activity_types (id, label, source, description, sort) values
  ('lead_created',         'New lead added',               'crm', 'You added a lead', 90),
  ('lead_connected',       'Lead contacted (connected)',    'crm', 'You marked a lead Connected (once per lead)', 91),
  ('lead_contact_attempt', 'Lead contact attempt',          'crm', 'You logged a contact attempt on a lead', 92),
  ('lead_call',            'Lead call done',                'crm', 'You logged a completed call with a lead', 93),
  ('lead_followup',        'Lead follow-up completed',      'crm', 'You completed a lead follow-up', 94),
  ('lead_converted',       'Lead converted',                'crm', 'You moved a lead to the Student List', 72),
  ('lead_closed',          'Lead closed',                   'crm', 'You closed a lead', 95),
  ('deposit_update',       'Tuition deposit update',        'crm', 'You updated an application''s tuition deposit', 96),
  ('cas_received',         'CAS received',                  'crm', 'You recorded an application''s CAS as received', 97),
  ('case_closed',          'Case closed',                   'crm', 'You logged the closure of an application case', 98)
on conflict (id) do update set label = excluded.label, source = excluded.source, description = excluded.description, sort = excluded.sort;

-- =============================================================== helpers
create or replace function public.lead_log(p_lead uuid, p_kind text, p_note text, p_detail jsonb, p_request uuid, p_outcome text default null)
returns bigint language sql security definer set search_path = '' as $$
  insert into public.lead_activities (lead_id, kind, outcome, note, detail, actor, request_id)
  values (p_lead, p_kind, p_outcome, nullif(btrim(coalesce(p_note, '')), ''), coalesce(p_detail, '{}'), auth.uid(), p_request)
  returning id;
$$;
revoke all on function public.lead_log(uuid, text, text, jsonb, uuid, text) from public, anon, authenticated;

-- Current queue of a lead: exactly one of these.
create or replace function public.lead_queue(p_stage text, p_contact text, p_no_response boolean)
returns text language sql immutable set search_path = '' as $$
  select case when p_stage = 'converted' then 'converted' when p_stage = 'closed' then 'closed'
              when p_no_response then 'no_response' when p_contact <> 'connected' then 'pending' else 'in_progress' end;
$$;

-- =============================================================== create / edit
create or replace function public.save_lead(p_id uuid, p jsonb, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l record; rid uuid := p_id; ref text; nm text; em text; ph text; pid text; src text; who uuid; dup record; digits text;
begin
  if not public.lead_access() then raise exception 'Not allowed to manage leads'; end if;
  nm := public.agency_clean(p, 'name', 160);
  em := lower(public.agency_clean(p, 'email', 200));
  ph := public.agency_clean(p, 'phone', 40);
  if em is not null and em !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address, or leave it empty'; end if;
  if ph is not null and ph !~ '^\+?[0-9 ()./-]{7,30}$' then raise exception 'Enter a valid phone number, or leave it empty'; end if;
  pid := nullif(p ->> 'partner_id', '');
  if pid = 'direct' then pid := null; end if;
  if pid is not null and not exists (select 1 from public.partners where id = pid and archived_at is null and not internal) then
    raise exception 'Unknown agent / partner';
  end if;
  src := coalesce(nullif(p ->> 'source', ''), case when pid is null then 'direct' else 'partner' end);
  if src not in ('direct', 'partner', 'website', 'walk_in', 'social', 'referral', 'event', 'other') then raise exception 'Unknown lead source'; end if;
  who := nullif(p ->> 'assigned_to', '')::uuid;
  if who is not null and who <> auth.uid() and not (public.is_super_admin() or public.in_my_team(who)) then
    raise exception 'You can only assign leads to yourself or your team';
  end if;
  digits := public.agency_digits(ph);
  if rid is null then
    if p_request is null then raise exception 'A request id is required'; end if;
    select id, reference into rid, ref from public.leads where request_key = p_request;
    if rid is not null then return jsonb_build_object('id', rid, 'reference', ref, 'duplicate', true); end if;
    if nm is null or char_length(nm) < 2 then raise exception 'MISSING: Enter the student / lead name'; end if;
  end if;
  -- No duplicate leads: the same email or phone number already belongs to another lead.
  select x.reference, x.name into dup from public.leads x
  where x.id is distinct from rid
    and ((em is not null and lower(x.email) = em) or (digits is not null and char_length(digits) >= 7 and public.agency_digits(x.phone) = digits))
  limit 1;
  if dup.reference is not null then raise exception 'DUPLICATE: % (%) already has this email or phone number', dup.name, dup.reference; end if;
  if rid is null then
    loop
      ref := public.agency_ref('LD');
      exit when not exists (select 1 from public.leads where reference = ref);
    end loop;
    insert into public.leads (reference, name, phone, email, qualification, application_details, partner_id, source, assigned_to, created_by, request_key)
    values (ref, nm, ph, em, public.agency_clean(p, 'qualification', 200), public.agency_clean(p, 'application_details', 4000), pid, src,
            coalesce(who, auth.uid()), auth.uid(), p_request)
    returning id into rid;
    perform public.lead_log(rid, 'created', public.agency_clean(p, 'note', 2000), jsonb_build_object('source', src, 'partner_id', pid), null);
    perform public.li_credit(public.my_employee_id(), 'lead_created', 'lead:' || rid, 'lead', rid::text);
    return jsonb_build_object('id', rid, 'reference', ref, 'duplicate', false);
  end if;
  select * into l from public.leads where id = rid for update;
  if l.id is null or not public.lead_visible(l.assigned_to, l.created_by) then raise exception 'Lead not found'; end if;
  if l.stage = 'converted' and p ? 'partner_id' and pid is distinct from l.partner_id then
    raise exception 'This lead is already in the Student List; change the agent on the student record';
  end if;
  update public.leads set
    name = coalesce(case when p ? 'name' then nm end, name),
    phone = case when p ? 'phone' then ph else phone end,
    email = case when p ? 'email' then em else email end,
    qualification = case when p ? 'qualification' then public.agency_clean(p, 'qualification', 200) else qualification end,
    application_details = case when p ? 'application_details' then public.agency_clean(p, 'application_details', 4000) else application_details end,
    partner_id = case when p ? 'partner_id' then pid else partner_id end,
    source = case when p ? 'source' or p ? 'partner_id' then src else source end,
    assigned_to = case when p ? 'assigned_to' and who is not null then who else assigned_to end,
    updated_at = now()
  where id = rid;
  perform public.lead_log(rid, 'edited', null, '{}'::jsonb, null);
  return jsonb_build_object('id', rid, 'reference', l.reference, 'duplicate', false);
end $$;

-- =============================================================== contact outcome (forward only)
create or replace function public.set_lead_contact_status(p_id uuid, p_status text, p_note text, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l record; reversal boolean;
begin
  if not public.lead_editable(p_id) then raise exception 'Not allowed to update this lead'; end if;
  if p_status not in ('unknown', 'not_connected', 'connected') then raise exception 'Unknown contact status'; end if;
  if p_request is not null and exists (select 1 from public.lead_activities where request_id = p_request) then
    return jsonb_build_object('contact_status', (select contact_status from public.leads where id = p_id), 'duplicate', true);
  end if;
  select * into l from public.leads where id = p_id for update;
  if l.stage = 'converted' then raise exception 'This lead is already in the Student List'; end if;
  if l.contact_status = p_status then return jsonb_build_object('contact_status', p_status, 'unchanged', true); end if;
  reversal := l.contact_status = 'connected' or (l.contact_status = 'not_connected' and p_status = 'unknown');
  if reversal and not public.is_super_admin() then raise exception 'Contact status only moves forward. Ask a Super Admin to correct it.'; end if;
  if reversal and nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'Give a reason for the correction'; end if;
  update public.leads set contact_status = p_status, contact_changed_by = auth.uid(), contact_changed_at = now(),
    no_response = case when p_status = 'connected' then false else no_response end, updated_at = now() where id = p_id;
  perform public.lead_log(p_id, case when reversal then 'contact_correction' else 'contact_status' end, p_note,
    jsonb_build_object('from', l.contact_status, 'to', p_status), p_request);
  -- Assigned lead contacted: once per lead, for whoever recorded it first.
  if p_status = 'connected' then
    perform public.li_credit(public.my_employee_id(), 'lead_connected', 'lead-contact:' || p_id, 'lead', p_id::text);
  elsif l.contact_status = 'connected' then
    perform public.li_uncredit('lead-contact:' || p_id, 'Contact status corrected by a Super Admin');
  end if;
  return jsonb_build_object('contact_status', p_status);
end $$;

-- =============================================================== follow-up task
create or replace function public.add_lead_follow_up(p_id uuid, p_date date, p_time time, p_note text, p_request uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare l record; tid uuid;
begin
  if not public.lead_editable(p_id) then raise exception 'Not allowed to update this lead'; end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  select id into tid from public.lead_tasks where request_key = p_request;
  if tid is not null then return tid; end if;
  if p_date is null then raise exception 'Choose the follow-up date'; end if;
  if p_date < public.company_today() then raise exception 'The follow-up date cannot be in the past'; end if;
  select * into l from public.leads where id = p_id;
  if l.stage in ('converted', 'closed') then raise exception 'Reopen the lead before adding a follow-up'; end if;
  insert into public.lead_tasks (lead_id, due_date, due_time, note, assigned_to, created_by, request_key)
  values (p_id, p_date, p_time, nullif(btrim(coalesce(p_note, '')), ''), coalesce(l.assigned_to, auth.uid()), auth.uid(), p_request)
  returning id into tid;
  perform public.lead_log(p_id, 'follow_up_added', p_note, jsonb_build_object('task_id', tid, 'due_date', p_date, 'due_time', p_time), null);
  return tid;
end $$;

-- =============================================================== Log Activity
-- contact_attempt / call_done / follow_up_done / note / no_response. Contact status is never changed here.
create or replace function public.log_lead_activity(p_id uuid, p_kind text, p_outcome text, p_note text, p_task uuid, p_request uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare l record; rid bigint; me uuid := public.my_employee_id(); t record; n text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.lead_editable(p_id) then raise exception 'Not allowed to update this lead'; end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  select id into rid from public.lead_activities where request_id = p_request;
  if rid is not null then return rid; end if;
  if p_kind not in ('contact_attempt', 'call_done', 'follow_up_done', 'note', 'no_response') then raise exception 'Unknown activity'; end if;
  if p_kind = 'contact_attempt' and coalesce(p_outcome, '') not in ('no_answer', 'busy', 'switched_off', 'wrong_number', 'message_sent', 'callback_requested', 'other') then
    raise exception 'Choose the outcome of the attempt';
  end if;
  if p_kind = 'call_done' and coalesce(p_outcome, '') not in ('interested', 'needs_time', 'not_interested', 'information_shared', 'other') then
    raise exception 'Choose the outcome of the call';
  end if;
  if p_kind = 'note' and n is null then raise exception 'Write the note'; end if;
  select * into l from public.leads where id = p_id for update;
  if l.stage = 'converted' and p_kind <> 'note' then raise exception 'This lead is already in the Student List; log the work on the student'; end if;
  if p_kind = 'follow_up_done' then
    if p_task is not null then
      select * into t from public.lead_tasks where id = p_task and lead_id = p_id for update;
      if t.id is null then raise exception 'Follow-up not found'; end if;
      if t.status <> 'open' then raise exception 'This follow-up is already completed'; end if;
    end if;
  end if;
  rid := public.lead_log(p_id, p_kind, n, case when p_task is not null then jsonb_build_object('task_id', p_task) else '{}'::jsonb end, p_request, p_outcome);
  if p_kind = 'contact_attempt' then
    perform public.li_credit(me, 'lead_contact_attempt', 'lead-attempt:' || rid, 'lead', p_id::text, n);
  elsif p_kind = 'call_done' then
    perform public.li_credit(me, 'lead_call', 'lead-call:' || rid, 'lead', p_id::text, n);
  elsif p_kind = 'follow_up_done' then
    if p_task is not null then
      update public.lead_tasks set status = 'done', completed_at = now(), completed_by = auth.uid() where id = p_task;
    end if;
    perform public.li_credit(me, 'lead_followup', 'lead-fu:' || rid, 'lead', p_id::text, n);
  elsif p_kind = 'no_response' then
    update public.leads set no_response = true, no_response_at = now(), updated_at = now() where id = p_id;
  end if;
  update public.leads set updated_at = now() where id = p_id;
  return rid;
end $$;

-- =============================================================== Change Stage
-- Cold / Warm / Closed. Converted only through Move to Student List.
create or replace function public.set_lead_stage(p_id uuid, p_stage text, p_note text, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l record; d text := public.company_today()::text; me uuid := public.my_employee_id();
begin
  if not public.lead_editable(p_id) then raise exception 'Not allowed to update this lead'; end if;
  if p_stage = 'converted' then raise exception 'Use Move to Student List — a lead becomes Converted only when the student record is saved'; end if;
  if p_stage not in ('cold', 'warm', 'closed') then raise exception 'Unknown stage'; end if;
  if p_request is not null and exists (select 1 from public.lead_activities where request_id = p_request) then
    return jsonb_build_object('stage', (select stage from public.leads where id = p_id), 'duplicate', true);
  end if;
  select * into l from public.leads where id = p_id for update;
  if l.stage = 'converted' then raise exception 'This lead is already in the Student List'; end if;
  if l.stage = p_stage then return jsonb_build_object('stage', p_stage, 'unchanged', true); end if;
  if p_stage = 'closed' and nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'Give a reason for closing the lead'; end if;
  update public.leads set stage = p_stage, stage_changed_by = auth.uid(), stage_changed_at = now(), updated_at = now() where id = p_id;
  perform public.lead_log(p_id, 'stage', p_note, jsonb_build_object('from', l.stage, 'to', p_stage), p_request);
  if p_stage = 'closed' then
    update public.lead_tasks set status = 'cancelled' where lead_id = p_id and status = 'open';
    perform public.li_credit(me, 'lead_closed', 'lead-closed:' || p_id || ':' || d, 'lead', p_id::text, p_note);
  elsif l.stage = 'closed' then
    perform public.li_uncredit('lead-closed:' || p_id || ':' || d, 'Lead reopened');
  end if;
  return jsonb_build_object('stage', p_stage);
end $$;

-- =============================================================== Move to Student List
create or replace function public.convert_lead_to_student(p_id uuid, p jsonb, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l record; fn text; ln text; em text; pid text; sid text; linked boolean := false; other record; missing text[] := '{}';
begin
  if not public.lead_editable(p_id) then raise exception 'Not allowed to update this lead'; end if;
  if not (public.is_super_admin() or public.staff_can('students')) then raise exception 'Not allowed to add students'; end if;
  select * into l from public.leads where id = p_id for update;
  if l.stage = 'converted' and l.student_id is not null then
    return jsonb_build_object('student_id', l.student_id, 'already', true, 'linked', false);
  end if;
  if l.stage = 'closed' then raise exception 'Reopen the lead before moving it to the Student List'; end if;
  fn := coalesce(public.agency_clean(p, 'first_name', 80), nullif(split_part(btrim(l.name), ' ', 1), ''));
  ln := coalesce(public.agency_clean(p, 'last_name', 80), nullif(btrim(substr(btrim(l.name), char_length(split_part(btrim(l.name), ' ', 1)) + 1)), ''));
  em := lower(coalesce(public.agency_clean(p, 'email', 200), l.email));
  if fn is null then missing := array_append(missing, 'first name'); end if;
  if ln is null then missing := array_append(missing, 'last name'); end if;
  if em is null then missing := array_append(missing, 'email'); end if;
  if cardinality(missing) > 0 then raise exception 'MISSING: Add the student''s %', array_to_string(missing, ', '); end if;
  if em !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
  pid := coalesce(l.partner_id, 'direct');
  -- The same student under the same agent is linked, never duplicated. Under another agent: stop.
  select s.id, s.partner_id, pa.name into other from public.students s join public.partners pa on pa.id = s.partner_id
  where lower(s.email) = em order by (s.partner_id = pid) desc, s.created_at limit 1;
  if other.id is not null and other.partner_id <> pid then
    raise exception 'DUPLICATE: A student with this email already exists under %. Check the agent before moving this lead.', other.name;
  end if;
  if other.id is not null then
    sid := other.id; linked := true;
    update public.students set lead_id = coalesce(lead_id, p_id) where id = sid;
  else
    insert into public.students (partner_id, first_name, last_name, email, phone, qualification, status, lead_id)
    values (pid, fn, ln, em, l.phone, l.qualification, 'Active', p_id)
    returning id into sid;
    -- Counted once as "Leads converted"; the lead itself was already counted as a new lead.
    perform public.li_uncredit('student:' || sid, 'Counted as a converted lead (' || l.reference || ')');
  end if;
  update public.leads set stage = 'converted', student_id = sid, converted_by = auth.uid(), converted_at = now(),
    stage_changed_by = auth.uid(), stage_changed_at = now(), email = coalesce(email, em), no_response = false, updated_at = now()
  where id = p_id;
  update public.lead_tasks set status = 'cancelled' where lead_id = p_id and status = 'open';
  perform public.lead_log(p_id, 'converted', null, jsonb_build_object('student_id', sid, 'linked', linked, 'from', l.stage, 'partner_id', pid), p_request);
  perform public.li_credit(public.my_employee_id(), 'lead_converted', 'lead-convert:' || p_id, 'lead', p_id::text);
  return jsonb_build_object('student_id', sid, 'linked', linked, 'already', false, 'agent', (select name from public.partners where id = pid));
end $$;

-- An application for a converted lead's student is added to the lead history.
create or replace function public.lead_application_history()
returns trigger language plpgsql security definer set search_path = '' as $$
declare lid uuid;
begin
  select lead_id into lid from public.students where id = new.student_id;
  if lid is not null then
    insert into public.lead_activities (lead_id, kind, detail, actor)
    values (lid, 'application', jsonb_build_object('application_id', new.id, 'ref', new.ref, 'university_id', new.university_id, 'course_id', new.course_id), auth.uid());
  end if;
  return new;
end $$;
revoke all on function public.lead_application_history() from public, anon, authenticated;
drop trigger if exists applications_lead_history on public.applications;
create trigger applications_lead_history after insert on public.applications for each row execute function public.lead_application_history();

-- =============================================================== application milestones
alter table public.applications add column if not exists deposit_status text not null default 'not_started';
alter table public.applications add column if not exists cas_status text not null default 'not_started';
alter table public.applications drop constraint if exists applications_deposit_status_check;
alter table public.applications add constraint applications_deposit_status_check check (deposit_status in ('not_started', 'requested', 'partly_paid', 'paid'));
alter table public.applications drop constraint if exists applications_cas_status_check;
alter table public.applications add constraint applications_cas_status_check check (cas_status in ('not_started', 'requested', 'in_progress', 'issued'));

create table if not exists public.application_milestones (
  id             bigint generated always as identity primary key,
  application_id text not null references public.applications (id) on delete cascade,
  milestone      text not null check (milestone in ('deposit', 'cas')),
  from_value     text,
  to_value       text not null,
  note           text check (char_length(note) <= 2000),
  actor          uuid,
  at             timestamptz not null default now()
);
create index if not exists application_milestones_idx on public.application_milestones (application_id, at desc);
alter table public.application_milestones enable row level security;
revoke all on public.application_milestones from anon;
revoke insert, update, delete on public.application_milestones from authenticated;
grant select on public.application_milestones to authenticated;
drop policy if exists "application milestones: read" on public.application_milestones;
create policy "application milestones: read" on public.application_milestones for select to authenticated
  using (exists (select 1 from public.applications a where a.id = application_id));
do $$ begin
  begin alter publication supabase_realtime add table public.application_milestones; exception when others then null; end;
end $$;

-- Each milestone state counts once per application (saving it again adds nothing).
create or replace function public.set_application_milestone(p_app text, p_milestone text, p_value text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; prev text; me uuid := public.my_employee_id();
begin
  if not (public.my_profile_ok() and public.is_staff() and (public.is_super_admin() or public.staff_can('applications'))) then
    raise exception 'Not allowed to update applications';
  end if;
  select * into a from public.applications where id = p_app for update;
  if a.id is null then raise exception 'Application not found'; end if;
  if p_milestone = 'deposit' then
    if p_value not in ('not_started', 'requested', 'partly_paid', 'paid') then raise exception 'Unknown deposit status'; end if;
    prev := a.deposit_status;
    if prev = p_value then return jsonb_build_object('unchanged', true); end if;
    update public.applications set deposit_status = p_value, updated_at = now() where id = p_app;
    if p_value <> 'not_started' then
      perform public.record_work_activity(me, 'deposit_update', 'app-deposit:' || p_app || ':' || p_value, 'application', p_app, p_app, a.student_id, a.partner_id, prev, p_value, 1, p_note);
    end if;
    if p_value = 'paid' then
      perform public.record_work_activity(me, 'deposit_confirmed', 'app-deposit-paid:' || p_app, 'application', p_app, p_app, a.student_id, a.partner_id, prev, p_value, 1, p_note);
      update public.work_activities set source = 'crm' where dedupe_key = 'app-deposit-paid:' || p_app;
    end if;
  elsif p_milestone = 'cas' then
    if p_value not in ('not_started', 'requested', 'in_progress', 'issued') then raise exception 'Unknown CAS status'; end if;
    prev := a.cas_status;
    if prev = p_value then return jsonb_build_object('unchanged', true); end if;
    update public.applications set cas_status = p_value, updated_at = now() where id = p_app;
    if p_value in ('requested', 'in_progress') then
      perform public.record_work_activity(me, 'cas_followup', 'app-cas:' || p_app || ':' || p_value, 'application', p_app, p_app, a.student_id, a.partner_id, prev, p_value, 1, p_note);
      update public.work_activities set source = 'crm' where dedupe_key = 'app-cas:' || p_app || ':' || p_value;
    elsif p_value = 'issued' then
      perform public.record_work_activity(me, 'cas_received', 'app-cas-issued:' || p_app, 'application', p_app, p_app, a.student_id, a.partner_id, prev, p_value, 1, p_note);
    end if;
  else
    raise exception 'Unknown milestone';
  end if;
  insert into public.application_milestones (application_id, milestone, from_value, to_value, note, actor)
  values (p_app, p_milestone, prev, p_value, nullif(btrim(coalesce(p_note, '')), ''), auth.uid());
  return jsonb_build_object('from', prev, 'to', p_value);
end $$;

-- =============================================================== Log Student Activity
create table if not exists public.student_activities (
  id             bigint generated always as identity primary key,
  student_id     text not null references public.students (id) on delete cascade,
  application_id text references public.applications (id) on delete set null,
  kind           text not null check (kind in ('course_options', 'offer_followup', 'case_closed', 'note')),
  outcome        text,
  note           text check (char_length(note) <= 4000),
  detail         jsonb not null default '{}',
  completed_on   date,
  employee_id    uuid,
  at             timestamptz not null default now(),
  request_id     uuid unique
);
create index if not exists student_activities_idx on public.student_activities (student_id, at desc);
alter table public.student_activities enable row level security;
revoke all on public.student_activities from anon;
revoke insert, update, delete on public.student_activities from authenticated;
grant select on public.student_activities to authenticated;
drop policy if exists "student activities: read" on public.student_activities;
create policy "student activities: read" on public.student_activities for select to authenticated
  using ((select public.is_staff()) and exists (select 1 from public.students s where s.id = student_id));
do $$ begin
  begin alter publication supabase_realtime add table public.student_activities; exception when others then null; end;
end $$;

create or replace function public.log_student_activity(p_student text, p_application text, p_kind text, p_outcome text, p_note text,
  p_options jsonb, p_completed date, p_request uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare s record; a record; rid bigint; me uuid := public.my_employee_id(); n text := nullif(btrim(coalesce(p_note, '')), ''); o jsonb; opts jsonb := '[]';
begin
  if not (public.my_profile_ok() and public.is_staff() and (public.is_super_admin() or public.staff_can('students'))) then
    raise exception 'Not allowed to log student activities';
  end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  select id into rid from public.student_activities where request_id = p_request;
  if rid is not null then return rid; end if;
  select * into s from public.students where id = p_student;
  if s.id is null then raise exception 'Student not found'; end if;
  if p_application is not null then
    select * into a from public.applications where id = p_application;
    if a.id is null or a.student_id <> p_student then raise exception 'That application does not belong to this student'; end if;
  end if;
  if p_kind not in ('course_options', 'offer_followup', 'case_closed', 'note') then raise exception 'Unknown activity'; end if;
  if p_kind in ('offer_followup', 'case_closed') and p_application is null then raise exception 'Choose the application'; end if;
  if p_kind = 'offer_followup' and coalesce(p_outcome, '') not in ('completed', 'pending', 'no_response') then raise exception 'Choose the outcome'; end if;
  if p_kind = 'case_closed' and coalesce(p_outcome, '') not in ('completed', 'withdrawn', 'refused', 'deferred') then raise exception 'Choose how the case was closed'; end if;
  if p_kind = 'note' and n is null then raise exception 'Write the note'; end if;
  if p_completed is not null and p_completed > public.company_today() then raise exception 'The completion date cannot be in the future'; end if;
  if p_kind = 'course_options' then
    if jsonb_typeof(coalesce(p_options, '[]')) <> 'array' or jsonb_array_length(coalesce(p_options, '[]')) = 0 then
      raise exception 'Add at least one university or course option';
    end if;
    for o in select * from jsonb_array_elements(p_options) loop
      if nullif(o ->> 'university_id', '') is null or not exists (select 1 from public.universities where id = o ->> 'university_id') then
        raise exception 'Choose a university from the Education Providers list';
      end if;
      if nullif(o ->> 'course_id', '') is not null and not exists (select 1 from public.courses where id = o ->> 'course_id' and university_id = o ->> 'university_id') then
        raise exception 'That course does not belong to the chosen university';
      end if;
      opts := opts || jsonb_build_array(jsonb_build_object('university_id', o ->> 'university_id', 'course_id', nullif(o ->> 'course_id', '')));
    end loop;
    if jsonb_array_length(opts) > 20 then raise exception 'Up to 20 options at a time'; end if;
  end if;
  insert into public.student_activities (student_id, application_id, kind, outcome, note, detail, completed_on, employee_id, request_id)
  values (p_student, p_application, p_kind, p_outcome, n, case when p_kind = 'course_options' then jsonb_build_object('options', opts) else '{}'::jsonb end,
          coalesce(p_completed, case when p_kind <> 'note' then public.company_today() end), auth.uid(), p_request)
  returning id into rid;
  if p_kind = 'course_options' then
    perform public.record_work_activity(me, 'course_options', 'stu-options:' || rid, 'student', p_student, null, p_student, s.partner_id, null, null, 1, n);
    update public.work_activities set source = 'crm' where dedupe_key = 'stu-options:' || rid;
  elsif p_kind = 'offer_followup' and p_outcome = 'completed' then
    perform public.record_work_activity(me, 'offer_followup', 'stu-offer-fu:' || rid, 'student', p_student, p_application, p_student, s.partner_id, null, null, 1, n);
    update public.work_activities set source = 'crm' where dedupe_key = 'stu-offer-fu:' || rid;
  elsif p_kind = 'case_closed' then
    perform public.record_work_activity(me, 'case_closed', 'case-closed:' || p_application, 'student', p_student, p_application, p_student, s.partner_id, null, p_outcome, 1, n);
  end if;
  return rid;
end $$;

-- Partner training counts only when it was actually conducted (not when it is still pending).
create or replace function public.log_client_activity(p_key text, p_kind text, p_outcome text, p_note text, p_next date, p_request uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare d record; rid bigint; me uuid := public.my_employee_id(); wt text;
begin
  if not public.partner_success_access() then raise exception 'Not allowed to log client activities'; end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  select * into d from public.onboarded_client_directory() where key = p_key;
  if d.key is null then raise exception 'Client not found'; end if;
  if not d.mine then raise exception 'You can only log activities for your own clients (where you are the Sub Officer)'; end if;
  if p_kind not in ('query', 'training', 'course_options', 'admission_guidance', 'follow_up', 'meeting', 'note') then raise exception 'Unknown activity'; end if;
  if p_outcome is not null and p_outcome not in ('completed', 'pending', 'no_response', 'escalated') then raise exception 'Unknown outcome'; end if;
  if p_kind = 'note' and nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'Write the note'; end if;
  if p_next is not null and p_next < public.company_today() then raise exception 'The follow-up date cannot be in the past'; end if;
  insert into public.client_activities (client_key, partner_id, agency_id, employee_id, kind, outcome, note, next_follow_up, request_id)
  values (p_key, d.partner_id, d.agency_id, auth.uid(), p_kind, p_outcome, nullif(btrim(coalesce(p_note, '')), ''), p_next, p_request)
  on conflict (request_id) do nothing returning id into rid;
  if rid is null then return (select id from public.client_activities where request_id = p_request); end if;
  wt := case p_kind when 'query' then 'partner_query'
                    when 'training' then case when coalesce(p_outcome, 'completed') = 'completed' then 'partner_training' end
                    when 'course_options' then 'course_options'
                    when 'admission_guidance' then 'admission_guidance' end;
  if wt is not null then
    perform public.record_work_activity(me, wt, 'client-act:' || rid, 'client', p_key, null, null, d.partner_id, null, null, 1, p_note);
    update public.work_activities set source = 'crm' where dedupe_key = 'client-act:' || rid;
  end if;
  return rid;
end $$;

-- =============================================================== Partner Success report v2
insert into public.report_templates (id, version, name, sections) values
('partner_success_officer', 2, 'Partner Success Officer — Daily Work Report', $j$[
 {"id":"leads","title":"Lead Management & Counselling","fields":[
   {"key":"lm_new_leads","label":"New leads received","type":"count"},
   {"key":"lm_leads_counselled","label":"Assigned leads contacted (connected)","type":"count"},
   {"key":"lm_contact_attempts","label":"Follow-ups attempted (contact attempts)","type":"count"},
   {"key":"lm_calls_done","label":"Calls completed","type":"count"},
   {"key":"lm_student_followups","label":"Student follow-ups completed","type":"count"},
   {"key":"lm_leads_converted","label":"Leads converted to students","type":"count"},
   {"key":"lm_leads_closed","label":"Leads closed","type":"count"},
   {"key":"lm_pending_leads","label":"Pending leads (not connected yet)","type":"count"},
   {"key":"lm_no_response","label":"No response leads","type":"count"}]},
 {"id":"support","title":"Partner Support & Training","fields":[
   {"key":"ps_partner_queries","label":"Partner queries handled","type":"count"},
   {"key":"ps_profiles_assessed","label":"Student profiles assessed","type":"count"},
   {"key":"ps_options_suggested","label":"University / course options suggested","type":"count"},
   {"key":"ps_admission_guidance","label":"Admission guidance provided","type":"count"},
   {"key":"ps_training_sessions","label":"Partner training sessions conducted","type":"count"}]},
 {"id":"progress","title":"Application & Admission Progress","fields":[
   {"key":"ap_applications_generated","label":"Applications generated","type":"count"},
   {"key":"ap_applications_converted","label":"Applications converted (submitted)","type":"count"},
   {"key":"ap_offers","label":"Offers received","type":"count"},
   {"key":"ap_offer_followups","label":"Offer follow-ups completed","type":"count"},
   {"key":"ap_tuition_deposits","label":"Tuition deposit updates","type":"count"},
   {"key":"ap_deposits_completed","label":"Tuition deposits completed","type":"count"},
   {"key":"ap_cas_followups","label":"CAS progress updates","type":"count"},
   {"key":"ap_cas_received","label":"CAS received","type":"count"},
   {"key":"ap_visa_updates","label":"Visa updates (lodged / granted)","type":"count"},
   {"key":"ap_visa_success","label":"Successful visa outcomes","type":"count"},
   {"key":"ap_cases_closed","label":"Cases closed","type":"count"},
   {"key":"ap_cases_pending","label":"Cases pending","type":"count"}]},
 {"id":"tasks","title":"Pending Work","fields":[
   {"key":"tk_pending_tasks","label":"Pending follow-up tasks (due today or earlier)","type":"count"}]}
]$j$::jsonb)
on conflict (id, version) do update set sections = excluded.sections, name = excluded.name;

alter table public.report_metric_sources drop constraint if exists report_metric_sources_pending_check;
alter table public.report_metric_sources add constraint report_metric_sources_pending_check check (pending = any (array[
  'agency_attempts', 'agency_not_connected', 'agency_followups', 'linkedin_pending', 'linkedin_followups', 'linkedin_not_responded',
  'hr_leave_pending', 'hr_attendance_pending', 'hr_documents_pending', 'lead_pending', 'lead_no_response', 'lead_tasks_pending']));

insert into public.report_metric_sources (template_id, field_key, kind, activity_types, workload, pending) values
  ('partner_success_officer', 'lm_new_leads',          'activity', '{lead_created,student_created}', null, null),
  ('partner_success_officer', 'lm_leads_counselled',   'activity', '{lead_connected,lead_counselled}', null, null),
  ('partner_success_officer', 'lm_contact_attempts',   'activity', '{lead_contact_attempt}', null, null),
  ('partner_success_officer', 'lm_calls_done',         'activity', '{lead_call}', null, null),
  ('partner_success_officer', 'lm_student_followups',  'activity', '{student_followup,lead_followup}', null, null),
  ('partner_success_officer', 'lm_leads_converted',    'activity', '{lead_converted}', null, null),
  ('partner_success_officer', 'lm_leads_closed',       'activity', '{lead_closed}', null, null),
  ('partner_success_officer', 'lm_pending_leads',      'pending',  '{}', null, 'lead_pending'),
  ('partner_success_officer', 'lm_no_response',        'pending',  '{}', null, 'lead_no_response'),
  ('partner_success_officer', 'ap_offers',             'activity', '{offer_received}', null, null),
  ('partner_success_officer', 'ap_offer_followups',    'activity', '{offer_followup}', null, null),
  ('partner_success_officer', 'ap_tuition_deposits',   'activity', '{deposit_update}', null, null),
  ('partner_success_officer', 'ap_deposits_completed', 'activity', '{deposit_confirmed}', null, null),
  ('partner_success_officer', 'ap_cas_followups',      'activity', '{cas_followup}', null, null),
  ('partner_success_officer', 'ap_cas_received',       'activity', '{cas_received}', null, null),
  ('partner_success_officer', 'ap_visa_updates',       'activity', '{visa_lodged,visa_approved}', null, null),
  ('partner_success_officer', 'ap_visa_success',       'activity', '{visa_approved}', null, null),
  ('partner_success_officer', 'ap_cases_closed',       'activity', '{application_completed,case_closed}', null, null),
  ('partner_success_officer', 'tk_pending_tasks',      'pending',  '{}', null, 'lead_tasks_pending')
on conflict (template_id, field_key) do update set kind = excluded.kind, activity_types = excluded.activity_types, workload = excluded.workload, pending = excluded.pending;

-- Lead queues for one employee (current state; never added to completed work).
create or replace function public.report_pending_leads(p_emp uuid, p_key text, p_date date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('kind', 'pending', 'value', case p_key
    when 'lead_pending' then (select count(*) from public.leads l where l.assigned_to = p_emp
                              and public.lead_queue(l.stage, l.contact_status, l.no_response) = 'pending')
    when 'lead_no_response' then (select count(*) from public.leads l where l.assigned_to = p_emp
                              and public.lead_queue(l.stage, l.contact_status, l.no_response) = 'no_response')
    when 'lead_tasks_pending' then (select count(*) from public.lead_tasks t where t.status = 'open'
                              and coalesce(t.assigned_to, t.created_by) = p_emp and t.due_date <= p_date)
    else 0 end);
$$;
revoke all on function public.report_pending_leads(uuid, text, date) from public, anon, authenticated;

create or replace function public.compute_report_metrics(p_emp uuid, p_template text, p_date date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(s.field_key,
    case when s.kind = 'activity' then (
      select jsonb_build_object('value', coalesce(sum(a.quantity), 0), 'kind', 'activity', 'activity_ids', coalesce(jsonb_agg(a.id order by a.id), '[]'))
      from public.work_activities a
      where a.employee_id = p_emp and a.report_date = p_date and a.voided_at is null and a.activity_type = any (s.activity_types))
    when s.kind = 'pending' and s.pending like 'hr\_%' then public.report_pending_hr(p_emp, s.pending, p_date)
    when s.kind = 'pending' and s.pending like 'lead\_%' then public.report_pending_leads(p_emp, s.pending, p_date)
    when s.kind = 'pending' then public.report_pending(p_emp, s.pending, p_date)
    else (
      select jsonb_build_object('value', count(*), 'kind', 'workload', 'application_ids', coalesce(jsonb_agg(ap.id order by ap.id), '[]'))
      from public.applications ap
      where ap.assigned_to = p_emp and ap.status = any (public.workload_statuses(s.workload)))
    end), '{}')
  from public.report_metric_sources s
  where s.template_id = p_template;
$$;

-- =============================================================== timeline (Time / Action done)
create or replace function public.my_work_timeline(p_date date, p_emp uuid default null, p_limit integer default 200)
returns table (id bigint, occurred_at timestamptz, activity_type text, label text, manual boolean, entity_type text, entity_id text,
               entity_name text, application_id text, from_status text, to_status text, quantity integer, note text, voided boolean)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.occurred_at, a.activity_type, coalesce(t.label, a.activity_type), coalesce(t.source, 'crm') = 'logged',
         a.entity_type, a.entity_id,
         coalesce(ag.company_name, ag.contact_name, ag.reference, li.name, ld.name,
                  case when a.entity_type = 'student' then nullif(btrim(st.first_name || ' ' || st.last_name), '') end,
                  pa.name, up.institution_name),
         a.application_id, a.from_status, a.to_status, a.quantity, a.note, a.voided_at is not null
  from public.work_activities a
  left join public.work_activity_types t on t.id = a.activity_type
  left join public.agency_prospects ag on a.entity_type = 'agency' and ag.id::text = a.entity_id
  left join public.linkedin_prospects li on a.entity_type = 'linkedin' and li.id::text = a.entity_id
  left join public.leads ld on a.entity_type = 'lead' and ld.id::text = a.entity_id
  left join public.students st on a.entity_type = 'student' and st.id = a.entity_id
  left join public.partners pa on pa.id = coalesce(case when a.entity_type = 'partner' then a.entity_id end, a.partner_id)
  left join public.university_partnerships up on a.entity_type = 'university' and up.id::text = a.entity_id
  where a.employee_id = coalesce(p_emp, auth.uid()) and a.report_date = p_date
  order by a.occurred_at, a.id
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;
revoke all on function public.my_work_timeline(date, uuid, integer) from public, anon;
grant execute on function public.my_work_timeline(date, uuid, integer) to authenticated;

-- =============================================================== support requests + escalation
create table if not exists public.support_requests (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.profiles (id) on delete cascade,
  manager_id   uuid references public.profiles (id) on delete set null,
  title        text not null check (char_length(btrim(title)) between 3 and 200),
  details      text check (char_length(details) <= 4000),
  report_date  date not null default public.company_today(),
  status       text not null default 'open' check (status in ('open', 'resolved', 'cancelled')),
  created_at   timestamptz not null default now(),
  escalated_at timestamptz,
  escalated_to uuid[],
  resolved_at  timestamptz,
  resolved_by  uuid,
  resolution   text check (char_length(resolution) <= 2000),
  request_key  uuid unique
);
create index if not exists support_requests_open_idx on public.support_requests (status, created_at) where status = 'open';
create index if not exists support_requests_emp_idx on public.support_requests (employee_id, created_at desc);
create table if not exists public.support_request_events (
  id         bigint generated always as identity primary key,
  request_id uuid not null references public.support_requests (id) on delete cascade,
  kind       text not null,
  note       text,
  actor      uuid,
  at         timestamptz not null default now()
);
-- One row: hours an open request waits before it goes to the team manager. Null = escalation off.
create table if not exists public.support_escalation_policy (
  id         boolean primary key default true check (id),
  hours      integer check (hours is null or hours between 1 and 720),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.support_escalation_policy (id, hours) values (true, null) on conflict (id) do nothing;

alter table public.support_requests enable row level security;
alter table public.support_request_events enable row level security;
alter table public.support_escalation_policy enable row level security;
revoke all on public.support_requests, public.support_request_events, public.support_escalation_policy from anon;
revoke insert, update, delete on public.support_requests, public.support_request_events, public.support_escalation_policy from authenticated;
grant select on public.support_requests, public.support_request_events, public.support_escalation_policy to authenticated;
drop policy if exists "support requests: read" on public.support_requests;
create policy "support requests: read" on public.support_requests for select to authenticated
  using ((select public.my_profile_ok()) and (employee_id = (select auth.uid()) or manager_id = (select auth.uid()) or (select auth.uid()) = any (coalesce(escalated_to, '{}'))
         or (select public.is_super_admin()) or public.can_view_employee(employee_id)));
drop policy if exists "support request events: read" on public.support_request_events;
create policy "support request events: read" on public.support_request_events for select to authenticated
  using (exists (select 1 from public.support_requests r where r.id = request_id));
drop policy if exists "support escalation policy: read" on public.support_escalation_policy;
create policy "support escalation policy: read" on public.support_escalation_policy for select to authenticated using ((select public.is_staff()));
do $$ begin
  begin alter publication supabase_realtime add table public.support_requests; exception when others then null; end;
end $$;

create or replace function public.raise_support_request(p_title text, p_details text, p_request uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare rid uuid; mgr uuid;
begin
  if not (public.my_profile_ok() and public.is_staff()) then raise exception 'Not allowed'; end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  select id into rid from public.support_requests where request_key = p_request;
  if rid is not null then return rid; end if;
  if char_length(btrim(coalesce(p_title, ''))) < 3 then raise exception 'Describe what you need help with'; end if;
  select reporting_manager_id into mgr from public.employees where id = auth.uid();
  insert into public.support_requests (employee_id, manager_id, title, details, request_key)
  values (auth.uid(), mgr, btrim(p_title), nullif(btrim(coalesce(p_details, '')), ''), p_request)
  returning id into rid;
  insert into public.support_request_events (request_id, kind, actor) values (rid, 'raised', auth.uid());
  return rid;
end $$;

-- The employee may cancel their own; the manager, an escalation recipient or a Super Admin resolves.
create or replace function public.resolve_support_request(p_id uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select * into r from public.support_requests where id = p_id for update;
  if r.id is null then raise exception 'Not found'; end if;
  if p_status not in ('resolved', 'cancelled') then raise exception 'Unknown status'; end if;
  if r.status <> 'open' then raise exception 'This request is already closed'; end if;
  if p_status = 'cancelled' and r.employee_id <> auth.uid() and not public.is_super_admin() then raise exception 'Only the employee can withdraw the request'; end if;
  if p_status = 'resolved' and not (r.manager_id = auth.uid() or auth.uid() = any (coalesce(r.escalated_to, '{}')) or public.is_super_admin()
                                    or public.in_my_team(r.employee_id)) then
    raise exception 'Only the team manager or a Super Admin can resolve this request';
  end if;
  if p_status = 'resolved' and nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'Write how it was resolved'; end if;
  update public.support_requests set status = p_status, resolved_at = now(), resolved_by = auth.uid(), resolution = nullif(btrim(coalesce(p_note, '')), '') where id = p_id;
  insert into public.support_request_events (request_id, kind, note, actor) values (p_id, p_status, p_note, auth.uid());
  if p_status = 'resolved' and r.employee_id <> auth.uid() then
    perform public.notify(array[r.employee_id], 'support', 'Support request resolved', r.title, 'work/report');
  end if;
end $$;

create or replace function public.set_support_escalation_hours(p_hours integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can change the escalation rule'; end if;
  if p_hours is not null and p_hours not between 1 and 720 then raise exception 'Choose between 1 and 720 hours, or turn escalation off'; end if;
  update public.support_escalation_policy set hours = p_hours, updated_by = auth.uid(), updated_at = now() where id;
end $$;

-- Runs every 15 minutes: an open request older than the configured hours goes to the employee's
-- reporting manager (or the Super Admins when there is none) once; escalated_at prevents repeats.
create or replace function public.escalate_support_requests()
returns integer language plpgsql security definer set search_path = '' as $$
declare h integer; r record; who uuid[]; n int := 0;
begin
  if auth.uid() is not null and not public.is_super_admin() then raise exception 'Not allowed'; end if;
  select hours into h from public.support_escalation_policy where id;
  if h is null then return 0; end if;
  for r in select * from public.support_requests where status = 'open' and escalated_at is null and created_at < now() - make_interval(hours => h) for update loop
    who := case when r.manager_id is not null then array[r.manager_id]
                else (select array_agg(id) from public.profiles where role = 'super_admin' and status = 'active') end;
    update public.support_requests set escalated_at = now(), escalated_to = coalesce(who, '{}') where id = r.id;
    insert into public.support_request_events (request_id, kind, note) values (r.id, 'escalated', 'Open for more than ' || h || ' hours');
    if who is not null then
      perform public.notify(who, 'support', 'Support request escalated',
        coalesce((select full_name from public.profiles where id = r.employee_id), 'An employee') || ': ' || r.title, 'work/team');
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ssi-support-escalation';
    perform cron.schedule('ssi-support-escalation', '*/15 * * * *', 'select public.escalate_support_requests()');
  end if;
end $$;

-- =============================================================== pending work / Tomorrow's Plan
-- Same object as before for agency work, plus lead follow-ups, Tomorrow's Plan (open tasks due on
-- the next working day) and open support requests. Snapshotted at submission (0055).
create or replace function public.my_pending_work(p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid(); d date := coalesce(p_date, public.company_today()); res jsonb := '{}'; nd date; ag boolean := public.agency_access(); ld boolean := public.lead_access();
begin
  if not (ag or ld) then return null; end if;
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
        where ag and l.assigned_to = me and l.status not in ('converted', 'not_interested') and l.next_follow_up > d and l.next_follow_up <= nd) x), '[]'),
    'support', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'created_at', r.created_at, 'escalated', r.escalated_at is not null) order by r.created_at)
                 from public.support_requests r where r.employee_id = me and r.status = 'open'), '[]'));
  return res;
end $$;

-- =============================================================== day-end rollover (+ lead follow-ups)
create or replace function public.rollover_pending_work(p_day date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d date := coalesce(p_day, public.company_today()); n int := 0; li int := 0; lt int := 0; t record; nd date;
begin
  if auth.uid() is not null and not public.is_super_admin() then raise exception 'Not allowed'; end if;
  for t in select id, coalesce(assigned_to, created_by) emp from public.agency_tasks
           where status = 'open' and due_date <= d and (carried_over_to is null or carried_over_to <= d) for update loop
    update public.agency_tasks set carried_over_to = public.next_working_day(t.emp, d), carry_count = carry_count + 1 where id = t.id;
    n := n + 1;
  end loop;
  for t in select id, assigned_to from public.linkedin_prospects
           where status <> 'converted' and pipeline_stage in ('pending', 'not_responded') and next_follow_up is null and assigned_to is not null
           for update loop
    nd := public.next_working_day(t.assigned_to, d);
    update public.linkedin_prospects set next_follow_up = nd, next_follow_up_auto = true, updated_at = now() where id = t.id;
    perform public.linkedin_log(t.id, 'follow_up_date', 'No response yet — carried to the next working day', jsonb_build_object('next_follow_up', nd, 'auto', true), null);
    li := li + 1;
  end loop;
  -- Lead follow-ups: the same row stays open with its original due date; it is shown again on the
  -- next working day (carried_over_to), once per day, and never recreated.
  for t in select id, coalesce(assigned_to, created_by) emp from public.lead_tasks
           where status = 'open' and due_date <= d and (carried_over_to is null or carried_over_to <= d) for update loop
    update public.lead_tasks set carried_over_to = public.next_working_day(t.emp, d), carry_count = carry_count + 1 where id = t.id;
    lt := lt + 1;
  end loop;
  return jsonb_build_object('day', d, 'carried', n, 'linkedin_scheduled', li, 'lead_tasks_carried', lt);
end $$;

-- =============================================================== grants
do $$
declare f text;
begin
  foreach f in array array['lead_access()', 'lead_visible(uuid, uuid)', 'lead_editable(uuid)', 'save_lead(uuid, jsonb, uuid)',
    'set_lead_contact_status(uuid, text, text, uuid)', 'add_lead_follow_up(uuid, date, time, text, uuid)',
    'log_lead_activity(uuid, text, text, text, uuid, uuid)', 'set_lead_stage(uuid, text, text, uuid)', 'convert_lead_to_student(uuid, jsonb, uuid)',
    'set_application_milestone(text, text, text, text)', 'log_student_activity(text, text, text, text, text, jsonb, date, uuid)',
    'log_client_activity(text, text, text, text, date, uuid)', 'raise_support_request(text, text, uuid)', 'resolve_support_request(uuid, text, text)',
    'set_support_escalation_hours(integer)', 'escalate_support_requests()', 'my_pending_work(date)', 'rollover_pending_work(date)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.lead_queue(text, text, boolean) from public, anon;
grant execute on function public.lead_queue(text, text, boolean) to authenticated;
