-- 0034_agency_outreach.sql — run after 0033_partner_first_login.sql
-- (Supabase SQL Editor: Save this query as "0034_agency_outreach")
--
-- Agency outreach for Partnership Officers: prospects → contact → proposal → confirmation →
-- registration (the existing 0030 flow) → admin approval → onboarded partner.
-- * Permission "agency_outreach" (Agencies & proposals). Granted here to every employee whose
--   designation is Partnership Officer, and added to that designation's defaults. Officers see
--   the prospects assigned to them or that they created; Super Admins and registration managers
--   (Admin Staff with "Partner registrations") see all. Approving registrations and creating
--   partner accounts stay with them, exactly as in 0030.
-- * agency_prospects is NOT a partner: no login, no portal. It links to a partners row only after
--   the registration was approved and the partner account created by an administrator.
-- * Contact status (Not Connected / Connected) and pipeline stage are separate columns.
-- * Proposals: commission comes from the commission master (0029) — standard tier rates, or a
--   custom commission that needs a commission manager's approval before it can be sent. The
--   partner-facing snapshot (no routes, portals, SSI GLOBAL values or remarks) is built here, not
--   in the browser. Sending happens in the agency-proposal Edge Function (Brevo); the recipient
--   confirms on a public page with a typed name and an explicit "I confirm" — opening the email or
--   the page never accepts anything. Only a hash of the link token is stored.
-- * Work reports: the existing Partnership Officer fields are filled from these saved events
--   (first contact, calls, meetings, proposals sent, MOUs signed, closed, onboarded), with dedupe
--   keys so nothing counts twice. Adding a prospect and sending an MOU are recorded but are not
--   counted as a contact or as an MOU signed.
-- Safe to run more than once.

-- =============================================================== permission
create or replace function public.staff_modules()
returns text[] language sql immutable set search_path = '' as $$
  select array['partners', 'students', 'applications', 'assessments', 'documents', 'finance',
               'catalogue', 'tasks', 'updates', 'reports', 'work_reports', 'hr', 'hr_accounts', 'hr_salary',
               'commission_view', 'commission_tag', 'commission_manage', 'commission_internal', 'commission_edit',
               'partner_onboarding', 'agency_outreach'];
$$;

update public.designations set default_permissions = array_append(default_permissions, 'agency_outreach')
where id = 'partnership_officer' and not ('agency_outreach' = any (default_permissions));
-- Existing Partnership Officers (by designation, never by name).
update public.profiles p set permissions = array_append(p.permissions, 'agency_outreach')
from public.employees e
where e.id = p.id and e.designation_id = 'partnership_officer' and p.permissions is not null
  and not ('agency_outreach' = any (p.permissions));

-- Everyone who may see every prospect (and approve registrations): unchanged 0030 rule.
create or replace function public.agency_manager()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_manage_registrations();
$$;
create or replace function public.agency_access()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.my_profile_ok() and public.is_staff() and (public.can_manage_registrations() or public.staff_can('agency_outreach'));
$$;
revoke all on function public.agency_manager() from public, anon;
revoke all on function public.agency_access() from public, anon;
grant execute on function public.agency_manager() to authenticated;
grant execute on function public.agency_access() to authenticated;

-- =============================================================== tables
create table if not exists public.agency_prospects (
  id                 uuid primary key default gen_random_uuid(),
  reference          text not null unique,
  company_name       text check (char_length(company_name) <= 160),
  contact_name       text check (char_length(contact_name) <= 120),
  phone              text check (char_length(phone) <= 40),
  email              text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  country            text check (char_length(country) <= 80),
  notes              text check (char_length(notes) <= 4000),
  contact_status     text not null default 'not_connected' check (contact_status in ('not_connected', 'connected')),
  contact_changed_by uuid,
  contact_changed_at timestamptz,
  first_connected_at timestamptz,
  stage              text not null default 'new_prospect' check (stage in ('new_prospect', 'follow_up_required', 'discussion', 'proposal_sent',
                       'proposal_confirmed', 'mou_sent', 'registration_pending', 'registration_submitted', 'under_review', 'approved',
                       'onboarded', 'inactive', 'closed')),
  stage_changed_by   uuid,
  stage_changed_at   timestamptz,
  assigned_officer   uuid references public.profiles (id) on delete set null,
  last_contact_at    timestamptz,
  next_follow_up     date,
  selected_tier      text,
  registration_id    uuid references public.partner_registrations (id) on delete set null,
  partner_id         text references public.partners (id) on delete set null,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint agency_identifiable check (coalesce(btrim(company_name), '') <> '' or coalesce(btrim(contact_name), '') <> '' or coalesce(btrim(phone), '') <> '')
);
create unique index if not exists agency_prospects_partner_key on public.agency_prospects (partner_id) where partner_id is not null;
create unique index if not exists agency_prospects_registration_key on public.agency_prospects (registration_id) where registration_id is not null;
create index if not exists agency_prospects_officer_idx on public.agency_prospects (assigned_officer, stage);

create table if not exists public.agency_activities (
  id          bigint generated always as identity primary key,
  prospect_id uuid not null references public.agency_prospects (id) on delete cascade,
  kind        text not null,
  note        text check (char_length(note) <= 2000),
  detail      jsonb not null default '{}',
  actor       uuid,
  at          timestamptz not null default now(),
  request_id  uuid unique
);
create index if not exists agency_activities_idx on public.agency_activities (prospect_id, at desc);

-- Approved proposal terms (versioned; written by administrators, never invented by the system).
create table if not exists public.proposal_terms (
  id         bigint generated always as identity primary key,
  title      text not null check (char_length(btrim(title)) between 2 and 160),
  body       text not null check (char_length(btrim(body)) between 20 and 20000),
  active     boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.agency_proposals (
  id                  uuid primary key default gen_random_uuid(),
  reference           text not null unique,
  prospect_id         uuid not null references public.agency_prospects (id) on delete cascade,
  status              text not null default 'draft' check (status in ('draft', 'pending_approval', 'sending', 'sent', 'delivery_failed',
                        'awaiting_confirmation', 'confirmed', 'declined', 'expired', 'superseded', 'cancelled')),
  company_name        text not null,
  recipient_name      text not null,
  recipient_email     text not null check (recipient_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  country             text not null,
  arrangement         jsonb not null,         -- partner-facing snapshot only
  terms_id            bigint references public.proposal_terms (id),
  terms_title         text not null,
  terms_body          text not null,
  message             text check (char_length(message) <= 2000),
  request_key         uuid not null unique,
  token_hash          text unique,
  expires_at          timestamptz,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  approved_by         uuid,
  approved_at         timestamptz,
  sending_since       timestamptz,
  sent_by             uuid,
  sent_at             timestamptz,
  email_status        text not null default 'not_sent' check (email_status in ('not_sent', 'accepted', 'delivered', 'failed')),
  email_detail        text,
  provider_message_id text,
  first_viewed_at     timestamptz,
  confirmed_at        timestamptz,
  confirmed_name      text,
  declined_at         timestamptz,
  decline_reason      text check (char_length(decline_reason) <= 1000),
  updated_at          timestamptz not null default now()
);
create index if not exists agency_proposals_prospect_idx on public.agency_proposals (prospect_id, created_at desc);
create index if not exists agency_proposals_message_idx on public.agency_proposals (provider_message_id) where provider_message_id is not null;

create table if not exists public.agency_mous (
  id          uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.agency_prospects (id) on delete cascade,
  reference   text check (char_length(reference) <= 80),
  sent_on     date not null,
  sent_by     uuid,
  status      text not null default 'sent' check (status in ('sent', 'signed', 'cancelled')),
  signed_on   date,
  note        text check (char_length(note) <= 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists agency_mous_prospect_idx on public.agency_mous (prospect_id);

create table if not exists public.partnership_settings (
  id                     boolean primary key default true check (id),
  auto_registration_link boolean not null default true,   -- after confirmation, email the registration link automatically
  proposal_valid_days    integer not null default 30 check (proposal_valid_days between 1 and 180),
  updated_by             uuid,
  updated_at             timestamptz not null default now()
);
insert into public.partnership_settings (id) values (true) on conflict do nothing;

-- =============================================================== row level security
do $$
declare t text;
begin
  foreach t in array array['agency_prospects', 'agency_activities', 'agency_proposals', 'agency_mous', 'proposal_terms', 'partnership_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

create or replace function public.agency_can_see(p_prospect uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.agency_access() and (public.agency_manager() or exists (
    select 1 from public.agency_prospects a where a.id = p_prospect and auth.uid() in (a.assigned_officer, a.created_by)));
$$;
revoke all on function public.agency_can_see(uuid) from public, anon;
grant execute on function public.agency_can_see(uuid) to authenticated;

drop policy if exists "agency prospects: read" on public.agency_prospects;
create policy "agency prospects: read" on public.agency_prospects for select to authenticated
  using (public.agency_access() and (public.agency_manager() or auth.uid() in (assigned_officer, created_by)));
drop policy if exists "agency activities: read" on public.agency_activities;
create policy "agency activities: read" on public.agency_activities for select to authenticated using (public.agency_can_see(prospect_id));
drop policy if exists "agency mous: read" on public.agency_mous;
create policy "agency mous: read" on public.agency_mous for select to authenticated using (public.agency_can_see(prospect_id));
drop policy if exists "agency proposals: read" on public.agency_proposals;
create policy "agency proposals: read" on public.agency_proposals for select to authenticated
  using (public.agency_can_see(prospect_id) or (public.commission_can('commission_manage') and status = 'pending_approval'));
drop policy if exists "proposal terms: read" on public.proposal_terms;
create policy "proposal terms: read" on public.proposal_terms for select to authenticated using (public.agency_access());
drop policy if exists "partnership settings: read" on public.partnership_settings;
create policy "partnership settings: read" on public.partnership_settings for select to authenticated using (public.agency_access());
-- The link token's hash is never readable by anyone signed in.
revoke select on public.agency_proposals from authenticated;
grant select (id, reference, prospect_id, status, company_name, recipient_name, recipient_email, country, arrangement, terms_id, terms_title,
              terms_body, message, request_key, expires_at, created_by, created_at, approved_by, approved_at, sending_since, sent_by, sent_at,
              email_status, email_detail, provider_message_id, first_viewed_at, confirmed_at, confirmed_name, declined_at, decline_reason, updated_at)
  on public.agency_proposals to authenticated;

-- =============================================================== helpers
create or replace function public.agency_ref(p_prefix text)
returns text language sql volatile set search_path = '' as $$
  select p_prefix || '-' || to_char(now(), 'YY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
$$;

create or replace function public.agency_stage_rank(p text)
returns integer language sql immutable set search_path = '' as $$
  select case p when 'new_prospect' then 0 when 'follow_up_required' then 1 when 'discussion' then 2 when 'proposal_sent' then 3
    when 'proposal_confirmed' then 4 when 'mou_sent' then 5 when 'registration_pending' then 6 when 'registration_submitted' then 7
    when 'under_review' then 8 when 'approved' then 9 when 'onboarded' then 10 else -1 end;
$$;

create or replace function public.agency_log(p_prospect uuid, p_kind text, p_note text default null, p_detail jsonb default '{}', p_request uuid default null, p_actor uuid default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare rid bigint;
begin
  insert into public.agency_activities (prospect_id, kind, note, detail, actor, request_id)
  values (p_prospect, p_kind, nullif(btrim(coalesce(p_note, '')), ''), coalesce(p_detail, '{}'), coalesce(p_actor, auth.uid()), p_request)
  on conflict (request_id) do nothing
  returning id into rid;
  return rid;
end $$;

-- Moves the pipeline forward (system events); never backwards, never out of Inactive / Closed.
create or replace function public.agency_advance(p_prospect uuid, p_stage text, p_actor uuid default null, p_force boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare cur text;
begin
  select stage into cur from public.agency_prospects where id = p_prospect for update;
  if cur is null or cur = p_stage then return; end if;
  if not p_force and (cur in ('inactive', 'closed') or public.agency_stage_rank(p_stage) <= public.agency_stage_rank(cur)) then return; end if;
  update public.agency_prospects set stage = p_stage, stage_changed_by = coalesce(p_actor, auth.uid()), stage_changed_at = now(), updated_at = now() where id = p_prospect;
  perform public.agency_log(p_prospect, 'stage', null, jsonb_build_object('from', cur, 'to', p_stage), null, p_actor);
end $$;

-- Daily-report activity for an employee (automatic: recorded as CRM, so not voidable as a manual log).
create or replace function public.agency_work(p_emp uuid, p_type text, p_dedupe text, p_prospect uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare rid bigint;
begin
  rid := public.record_work_activity(p_emp, p_type, p_dedupe, 'agency', p_prospect::text, null, null, null, null, null, 1, p_note);
  if rid is not null then update public.work_activities set source = 'crm' where id = rid; end if;
end $$;

revoke all on function public.agency_ref(text) from public, anon, authenticated;
revoke all on function public.agency_log(uuid, text, text, jsonb, uuid, uuid) from public, anon, authenticated;
revoke all on function public.agency_advance(uuid, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.agency_work(uuid, text, text, uuid, text) from public, anon, authenticated;

insert into public.work_activity_types (id, label, source, description, sort) values
  ('agency_added', 'Agency prospect added', 'crm', 'You added an agency prospect (not counted as a contact)', 25),
  ('mou_sent', 'MOU sent', 'crm', 'You recorded an MOU as sent (not counted as signed)', 26)
on conflict (id) do update set label = excluded.label, source = excluded.source, description = excluded.description, sort = excluded.sort;

-- =============================================================== prospects
create or replace function public.agency_clean(p jsonb, k text, maxlen integer)
returns text language sql immutable set search_path = '' as $$
  select nullif(left(btrim(coalesce(p ->> k, '')), maxlen), '');
$$;

create or replace function public.create_agency_prospect(p jsonb, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rid uuid; ref text; em text; officer uuid; connected boolean; me uuid := auth.uid();
begin
  if not public.agency_access() then raise exception 'Not allowed to add agencies'; end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  select id, reference into rid, ref from public.agency_prospects
  where id = (select prospect_id from public.agency_activities where request_id = p_request);
  if rid is not null then return jsonb_build_object('id', rid, 'reference', ref, 'duplicate', true); end if;
  if public.agency_clean(p, 'company_name', 160) is null and public.agency_clean(p, 'contact_name', 120) is null and public.agency_clean(p, 'phone', 40) is null then
    raise exception 'Enter at least the agency name, the contact person or a phone number';
  end if;
  em := lower(public.agency_clean(p, 'email', 200));
  if em is not null and em !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address, or leave it empty'; end if;
  officer := coalesce(case when public.agency_manager() then nullif(p ->> 'assigned_officer', '')::uuid end, me);
  connected := (p ->> 'contact_status') = 'connected';
  loop
    ref := public.agency_ref('AG');
    exit when not exists (select 1 from public.agency_prospects where reference = ref);
  end loop;
  insert into public.agency_prospects (reference, company_name, contact_name, phone, email, country, notes, contact_status, contact_changed_by,
    contact_changed_at, first_connected_at, last_contact_at, assigned_officer, created_by)
  values (ref, public.agency_clean(p, 'company_name', 160), public.agency_clean(p, 'contact_name', 120), public.agency_clean(p, 'phone', 40), em,
    public.agency_clean(p, 'country', 80), public.agency_clean(p, 'notes', 4000), case when connected then 'connected' else 'not_connected' end,
    me, now(), case when connected then now() end, case when connected then now() end, officer, me)
  returning id into rid;
  perform public.agency_log(rid, 'created', public.agency_clean(p, 'notes', 2000), jsonb_build_object('contact_status', case when connected then 'connected' else 'not_connected' end), p_request);
  perform public.agency_work(public.my_employee_id(), 'agency_added', 'agency-added:' || rid, rid);
  if connected then perform public.agency_work(public.my_employee_id(), 'partner_contact', 'agency-contact:' || rid, rid); end if;
  return jsonb_build_object('id', rid, 'reference', ref, 'duplicate', false);
end $$;

create or replace function public.update_agency_prospect(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare a record; em text; changed jsonb := '{}'; k text;
begin
  if not public.agency_can_see(p_id) then raise exception 'Not allowed to edit this agency'; end if;
  select * into a from public.agency_prospects where id = p_id for update;
  em := case when p ? 'email' then lower(public.agency_clean(p, 'email', 200)) else a.email end;
  if em is not null and em !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address, or leave it empty'; end if;
  update public.agency_prospects set
    company_name = case when p ? 'company_name' then public.agency_clean(p, 'company_name', 160) else company_name end,
    contact_name = case when p ? 'contact_name' then public.agency_clean(p, 'contact_name', 120) else contact_name end,
    phone = case when p ? 'phone' then public.agency_clean(p, 'phone', 40) else phone end,
    email = em,
    country = case when p ? 'country' then public.agency_clean(p, 'country', 80) else country end,
    notes = case when p ? 'notes' then public.agency_clean(p, 'notes', 4000) else notes end,
    assigned_officer = case when p ? 'assigned_officer' and public.agency_manager() then nullif(p ->> 'assigned_officer', '')::uuid else assigned_officer end,
    updated_at = now()
  where id = p_id;
  foreach k in array array['company_name', 'contact_name', 'phone', 'email', 'country', 'notes', 'assigned_officer'] loop
    if p ? k then changed := changed || jsonb_build_object(k, true); end if;
  end loop;
  perform public.agency_log(p_id, 'edited', null, jsonb_build_object('fields', (select coalesce(jsonb_agg(x), '[]') from jsonb_object_keys(changed) x)));
end $$;

create or replace function public.set_agency_contact_status(p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  if not public.agency_can_see(p_id) then raise exception 'Not allowed to update this agency'; end if;
  if p_status not in ('connected', 'not_connected') then raise exception 'Unknown contact status'; end if;
  select * into a from public.agency_prospects where id = p_id for update;
  if a.contact_status = p_status then return; end if;
  update public.agency_prospects set contact_status = p_status, contact_changed_by = auth.uid(), contact_changed_at = now(),
    first_connected_at = coalesce(first_connected_at, case when p_status = 'connected' then now() end),
    last_contact_at = case when p_status = 'connected' then now() else last_contact_at end, updated_at = now()
  where id = p_id;
  perform public.agency_log(p_id, 'contact_status', p_note, jsonb_build_object('from', a.contact_status, 'to', p_status));
  -- "New partners contacted": the first time an agency becomes Connected, once per agency.
  if p_status = 'connected' then perform public.agency_work(public.my_employee_id(), 'partner_contact', 'agency-contact:' || p_id, p_id); end if;
end $$;

-- call · meeting · follow_up_done · note · follow_up (schedule)
create or replace function public.log_agency_activity(p_id uuid, p_kind text, p_note text, p_next date, p_request uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare rid bigint; me uuid := public.my_employee_id();
begin
  if not public.agency_can_see(p_id) then raise exception 'Not allowed to update this agency'; end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  if p_kind not in ('call', 'meeting', 'follow_up_done', 'note', 'follow_up') then raise exception 'Unknown activity'; end if;
  if p_kind in ('note', 'follow_up') and nullif(btrim(coalesce(p_note, '')), '') is null and p_next is null then raise exception 'Add a note or a follow-up date'; end if;
  if p_next is not null and p_next < public.company_today() then raise exception 'The follow-up date cannot be in the past'; end if;
  rid := public.agency_log(p_id, p_kind, p_note, jsonb_build_object('next_follow_up', p_next), p_request);
  if rid is null then return (select id from public.agency_activities where request_id = p_request); end if;
  update public.agency_prospects set
    last_contact_at = case when p_kind in ('call', 'meeting', 'follow_up_done') then now() else last_contact_at end,
    next_follow_up = case when p_next is not null then p_next when p_kind in ('call', 'meeting', 'follow_up_done') and next_follow_up <= public.company_today() then null else next_follow_up end,
    updated_at = now()
  where id = p_id;
  if p_kind in ('call', 'follow_up_done') then perform public.agency_work(me, 'partner_call', 'agency-act:' || rid, p_id, p_note);
  elsif p_kind = 'meeting' then perform public.agency_work(me, 'partner_meeting', 'agency-act:' || rid, p_id, p_note); end if;
  if p_next is not null then perform public.agency_advance(p_id, 'follow_up_required'); end if;
  return rid;
end $$;

-- Manual stages: discussion, follow-up, inactive, closed, back to new (system stages come from events).
create or replace function public.set_agency_stage(p_id uuid, p_stage text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare cur text;
begin
  if not public.agency_can_see(p_id) then raise exception 'Not allowed to update this agency'; end if;
  if p_stage not in ('new_prospect', 'follow_up_required', 'discussion', 'inactive', 'closed') then
    raise exception 'This stage is set by the workflow (proposal, MOU, registration, activation)';
  end if;
  select stage into cur from public.agency_prospects where id = p_id for update;
  if cur = 'onboarded' and p_stage <> 'inactive' then raise exception 'An onboarded partner can only be marked Inactive'; end if;
  if cur = p_stage then return; end if;
  update public.agency_prospects set stage = p_stage, stage_changed_by = auth.uid(), stage_changed_at = now(), updated_at = now() where id = p_id;
  perform public.agency_log(p_id, 'stage', p_note, jsonb_build_object('from', cur, 'to', p_stage));
  if p_stage = 'closed' then perform public.agency_work(public.my_employee_id(), 'partner_closed', 'agency-closed:' || p_id, p_id, p_note); end if;
end $$;

-- =============================================================== MOU
create or replace function public.record_agency_mou(p_id uuid, p_reference text, p_sent_on date, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare mid uuid;
begin
  if not public.agency_can_see(p_id) then raise exception 'Not allowed to update this agency'; end if;
  if p_sent_on is null or p_sent_on > public.company_today() then raise exception 'Enter the date the MOU was actually sent (not in the future)'; end if;
  insert into public.agency_mous (prospect_id, reference, sent_on, sent_by, note)
  values (p_id, nullif(btrim(coalesce(p_reference, '')), ''), p_sent_on, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into mid;
  perform public.agency_log(p_id, 'mou_sent', p_note, jsonb_build_object('mou_id', mid, 'reference', p_reference, 'sent_on', p_sent_on));
  perform public.agency_work(public.my_employee_id(), 'mou_sent', 'mou-sent:' || mid, p_id);
  perform public.agency_advance(p_id, 'mou_sent');
  return mid;
end $$;

create or replace function public.set_agency_mou_status(p_mou uuid, p_status text, p_signed_on date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  select * into m from public.agency_mous where id = p_mou for update;
  if m.id is null or not public.agency_can_see(m.prospect_id) then raise exception 'Not allowed to update this MOU'; end if;
  if p_status not in ('signed', 'cancelled') then raise exception 'Unknown MOU status'; end if;
  if m.status <> 'sent' then raise exception 'This MOU is already %', m.status; end if;
  if p_status = 'signed' and (p_signed_on is null or p_signed_on > public.company_today() or p_signed_on < m.sent_on) then raise exception 'Enter the date the MOU was signed'; end if;
  update public.agency_mous set status = p_status, signed_on = case when p_status = 'signed' then p_signed_on end, updated_at = now() where id = p_mou;
  perform public.agency_log(m.prospect_id, 'mou_' || p_status, null, jsonb_build_object('mou_id', p_mou, 'signed_on', p_signed_on));
  if p_status = 'signed' then perform public.agency_work(public.my_employee_id(), 'mou_signed', 'mou-signed:' || p_mou, m.prospect_id); end if;
end $$;

-- =============================================================== proposal terms & settings
create or replace function public.publish_proposal_terms(p_title text, p_body text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare rid bigint;
begin
  if not public.agency_manager() then raise exception 'Only administrators can publish proposal terms'; end if;
  update public.proposal_terms set active = false where active;
  insert into public.proposal_terms (title, body, created_by) values (btrim(p_title), btrim(p_body), auth.uid()) returning id into rid;
  return rid;
end $$;

create or replace function public.update_partnership_settings(p_auto boolean, p_days integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.agency_manager() then raise exception 'Only administrators can change these settings'; end if;
  update public.partnership_settings set auto_registration_link = coalesce(p_auto, auto_registration_link),
    proposal_valid_days = coalesce(p_days, proposal_valid_days), updated_by = auth.uid(), updated_at = now();
end $$;

-- =============================================================== commission options (partner-facing only)
create or replace function public.proposal_commission_options(p_country text default null)
returns table (record_id text, university text, country text, study_level text, variant text, intake text,
               tier_id text, tier_label text, commission_kind text, commission_value numeric, currency text, conditions text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.agency_access() then raise exception 'Not allowed to prepare proposals'; end if;
  return query
    select r.id, r.university_name, c.name, r.study_level, r.variant, r.intake, t.id, t.label, tr.value_kind, tr.value,
           case when tr.value_kind = 'amount' then coalesce(tr.currency, r.currency) end,
           nullif(concat_ws(E'\n', nullif(r.conditions, ''), nullif(tr.note, '')), '')
    from public.commission_records r
    join public.commission_countries c on c.id = r.country_id
    join public.commission_tier_rates tr on tr.record_id = r.id and tr.value_kind in ('percent', 'amount')
    join public.commission_tiers t on t.id = tr.tier_id and t.active
    where r.status = 'active' and (p_country is null or c.name = p_country or c.id = p_country)
      and (r.effective_to is null or r.effective_to >= public.company_today())
    order by c.name, r.university_name, t.sort;
end $$;

-- =============================================================== proposals
create or replace function public.create_agency_proposal(p_prospect uuid, p jsonb, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a record; t record; tier record; ex record; rid uuid; ref text; arr jsonb; unis jsonb; kind text; em text; ids text[];
  ck text; cv numeric; cc text; missing text[] := '{}';
begin
  if not public.agency_can_see(p_prospect) then raise exception 'Not allowed to prepare a proposal for this agency'; end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  select * into ex from public.agency_proposals where request_key = p_request;
  if ex.id is not null then return jsonb_build_object('id', ex.id, 'reference', ex.reference, 'status', ex.status, 'duplicate', true); end if;
  select * into a from public.agency_prospects where id = p_prospect for update;
  if a.stage in ('closed', 'onboarded') then raise exception 'This agency is %; a proposal cannot be sent', replace(a.stage, '_', ' '); end if;

  em := lower(coalesce(public.agency_clean(p, 'recipient_email', 200), a.email));
  if coalesce(public.agency_clean(p, 'company_name', 160), a.company_name) is null then missing := array_append(missing, 'agency / company name'); end if;
  if coalesce(public.agency_clean(p, 'recipient_name', 120), a.contact_name) is null then missing := array_append(missing, 'primary contact name'); end if;
  if em is null or em !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then missing := array_append(missing, 'valid recipient email'); end if;
  if coalesce(public.agency_clean(p, 'country', 80), a.country) is null then missing := array_append(missing, 'country'); end if;
  kind := p ->> 'arrangement';
  if kind not in ('tier', 'custom') then missing := array_append(missing, 'commission arrangement'); end if;
  select array_agg(distinct x) into ids from jsonb_array_elements_text(coalesce(p -> 'record_ids', '[]')) x;
  if coalesce(cardinality(ids), 0) = 0 then missing := array_append(missing, 'at least one university'); end if;
  if cardinality(ids) > 300 then raise exception 'Select at most 300 universities in one proposal'; end if;
  select * into t from public.proposal_terms where id = (p ->> 'terms_id')::bigint and active;
  if t.id is null then missing := array_append(missing, 'approved proposal terms'); end if;
  if cardinality(missing) > 0 then raise exception 'MISSING: Before sending, add: %', array_to_string(missing, ', '); end if;

  if kind = 'tier' then
    select * into tier from public.commission_tiers where id = p ->> 'tier_id' and active;
    if tier.id is null then raise exception 'Choose a commission tier'; end if;
    select jsonb_agg(jsonb_build_object('record_id', o.record_id, 'university', o.university, 'country', o.country, 'study_level', o.study_level,
             'variant', o.variant, 'intake', o.intake, 'commission_kind', o.commission_kind, 'commission_value', o.commission_value,
             'currency', o.currency, 'conditions', o.conditions) order by o.country, o.university)
      into unis from public.proposal_commission_options(null) o where o.record_id = any (ids) and o.tier_id = tier.id;
    if coalesce(jsonb_array_length(unis), 0) <> cardinality(ids) then
      raise exception 'Some selected universities have no valid % rate. Remove them or choose another tier.', tier.label;
    end if;
    arr := jsonb_build_object('kind', 'tier', 'tier_id', tier.id, 'tier_label', tier.label, 'universities', unis);
  else
    ck := p ->> 'custom_kind'; cv := nullif(p ->> 'custom_value', '')::numeric; cc := upper(nullif(btrim(coalesce(p ->> 'custom_currency', '')), ''));
    if ck not in ('percent', 'amount') or cv is null or cv <= 0 or (ck = 'percent' and cv > 100) then raise exception 'Enter the custom commission (percent up to 100, or an amount)'; end if;
    if ck = 'amount' and (cc is null or cc !~ '^[A-Z]{3}$') then raise exception 'Enter the currency for a custom amount (e.g. GBP)'; end if;
    select jsonb_agg(jsonb_build_object('record_id', r.id, 'university', r.university_name, 'country', c.name, 'study_level', r.study_level,
             'variant', r.variant, 'intake', r.intake, 'commission_kind', ck, 'commission_value', cv, 'currency', case when ck = 'amount' then cc end,
             'conditions', nullif(r.conditions, '')) order by c.name, r.university_name)
      into unis from public.commission_records r join public.commission_countries c on c.id = r.country_id
      where r.id = any (ids) and r.status = 'active';
    if coalesce(jsonb_array_length(unis), 0) <> cardinality(ids) then raise exception 'Some selected universities are not active commission records'; end if;
    arr := jsonb_build_object('kind', 'custom', 'tier_label', 'Custom commission', 'universities', unis);
  end if;

  loop
    ref := public.agency_ref('PP');
    exit when not exists (select 1 from public.agency_proposals where reference = ref);
  end loop;
  insert into public.agency_proposals (reference, prospect_id, status, company_name, recipient_name, recipient_email, country, arrangement,
    terms_id, terms_title, terms_body, message, request_key, created_by)
  values (ref, p_prospect, case when kind = 'custom' then 'pending_approval' else 'draft' end,
    coalesce(public.agency_clean(p, 'company_name', 160), a.company_name), coalesce(public.agency_clean(p, 'recipient_name', 120), a.contact_name),
    em, coalesce(public.agency_clean(p, 'country', 80), a.country), arr, t.id, t.title, t.body, public.agency_clean(p, 'message', 2000), p_request, auth.uid())
  returning id into rid;
  -- Fill the agency's missing details from the proposal (never overwrite what is there).
  update public.agency_prospects set company_name = coalesce(company_name, public.agency_clean(p, 'company_name', 160)),
    contact_name = coalesce(contact_name, public.agency_clean(p, 'recipient_name', 120)), email = coalesce(email, em),
    country = coalesce(country, public.agency_clean(p, 'country', 80)), selected_tier = arr ->> 'tier_label', updated_at = now()
  where id = p_prospect;
  perform public.agency_log(p_prospect, case when kind = 'custom' then 'proposal_needs_approval' else 'proposal_prepared' end, null,
    jsonb_build_object('proposal_id', rid, 'reference', ref, 'arrangement', arr ->> 'tier_label', 'universities', jsonb_array_length(unis)));
  if kind = 'custom' then
    perform public.notify((select coalesce(array_agg(p2.id), '{}') from public.profiles p2 where p2.status = 'active'
                             and (p2.role = 'super_admin' or 'commission_manage' = any (coalesce(p2.permissions, '{}')))),
                          'partner', 'Custom commission proposal needs approval', coalesce(a.company_name, a.reference) || ' · ' || ref, 'agencies/' || p_prospect);
  end if;
  return jsonb_build_object('id', rid, 'reference', ref, 'status', case when kind = 'custom' then 'pending_approval' else 'draft' end, 'duplicate', false);
end $$;

create or replace function public.decide_agency_proposal(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if not public.commission_can('commission_manage') then raise exception 'Only commission managers can approve custom commission proposals'; end if;
  select * into r from public.agency_proposals where id = p_id for update;
  if r.id is null or r.status <> 'pending_approval' then raise exception 'This proposal is not waiting for approval'; end if;
  update public.agency_proposals set status = case when p_approve then 'draft' else 'cancelled' end, approved_by = auth.uid(), approved_at = now(), updated_at = now() where id = p_id;
  perform public.agency_log(r.prospect_id, case when p_approve then 'proposal_approved' else 'proposal_rejected' end, p_note, jsonb_build_object('proposal_id', p_id, 'reference', r.reference));
end $$;

create or replace function public.cancel_agency_proposal(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select * into r from public.agency_proposals where id = p_id for update;
  if r.id is null or not public.agency_can_see(r.prospect_id) then raise exception 'Not allowed'; end if;
  if r.status not in ('draft', 'pending_approval', 'delivery_failed', 'awaiting_confirmation') then raise exception 'This proposal can no longer be cancelled'; end if;
  update public.agency_proposals set status = 'cancelled', token_hash = null, updated_at = now() where id = p_id;
  perform public.agency_log(r.prospect_id, 'proposal_cancelled', null, jsonb_build_object('proposal_id', p_id, 'reference', r.reference));
end $$;

-- The Edge Function asks this as the signed-in user before sending.
create or replace function public.can_send_agency_proposal(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.agency_proposals r where r.id = p_id and public.agency_can_see(r.prospect_id));
$$;
revoke all on function public.can_send_agency_proposal(uuid) from public, anon;
grant execute on function public.can_send_agency_proposal(uuid) to authenticated;

-- Service role only: claim a proposal for sending (once), issue its link token.
create or replace function public.begin_agency_proposal_send(p_id uuid, p_actor uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; days integer;
begin
  select proposal_valid_days into days from public.partnership_settings;
  update public.agency_proposals set status = 'sending', sending_since = now(), token_hash = public.registration_token_hash(p_token),
    expires_at = now() + make_interval(days => coalesce(days, 30)), sent_by = p_actor, updated_at = now()
  where id = p_id and (status in ('draft', 'delivery_failed') or (status = 'sending' and sending_since < now() - interval '5 minutes'))
  returning * into r;
  if r.id is null then
    select * into r from public.agency_proposals where id = p_id;
    if r.id is null then raise exception 'Proposal not found'; end if;
    raise exception 'STATE: %', r.status;
  end if;
  -- Earlier open proposals for this agency stop working.
  update public.agency_proposals set status = 'superseded', token_hash = null, updated_at = now()
  where prospect_id = r.prospect_id and id <> p_id and status in ('draft', 'pending_approval', 'delivery_failed', 'awaiting_confirmation', 'sending');
  return to_jsonb(r) - 'token_hash';
end $$;

create or replace function public.finish_agency_proposal_send(p_id uuid, p_actor uuid, p_ok boolean, p_message_id text, p_detail text)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select * into r from public.agency_proposals where id = p_id and status = 'sending' for update;
  if r.id is null then return; end if;
  if p_ok then
    update public.agency_proposals set status = 'awaiting_confirmation', email_status = 'accepted', provider_message_id = p_message_id, email_detail = null,
      sent_at = now(), sending_since = null, updated_at = now() where id = p_id;
    perform public.agency_log(r.prospect_id, 'proposal_sent', null, jsonb_build_object('proposal_id', p_id, 'reference', r.reference, 'to', r.recipient_email), null, p_actor);
    perform public.agency_advance(r.prospect_id, 'proposal_sent', p_actor);
    perform public.agency_work((select id from public.employees where id = p_actor), 'proposal', 'proposal-sent:' || p_id, r.prospect_id, r.reference);
  else
    update public.agency_proposals set status = 'delivery_failed', email_status = 'failed', email_detail = left(p_detail, 300), token_hash = null,
      sending_since = null, updated_at = now() where id = p_id;
    perform public.agency_log(r.prospect_id, 'proposal_failed', p_detail, jsonb_build_object('proposal_id', p_id, 'reference', r.reference), null, p_actor);
  end if;
end $$;

-- Public (service role): what the recipient sees. Opening never changes the decision.
create or replace function public.agency_proposal_for_token(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select * into r from public.agency_proposals where token_hash = public.registration_token_hash(p_token);
  if r.id is null then return jsonb_build_object('state', 'invalid'); end if;
  if r.status = 'awaiting_confirmation' and r.expires_at < now() then
    update public.agency_proposals set status = 'expired', updated_at = now() where id = r.id;
    perform public.agency_log(r.prospect_id, 'proposal_expired', null, jsonb_build_object('proposal_id', r.id, 'reference', r.reference), null, null);
    r.status := 'expired';
  end if;
  if r.first_viewed_at is null then update public.agency_proposals set first_viewed_at = now() where id = r.id; end if;
  return jsonb_build_object('state', case r.status when 'awaiting_confirmation' then 'open' when 'confirmed' then 'confirmed' when 'declined' then 'declined'
           when 'expired' then 'expired' else 'closed' end,
    'reference', r.reference, 'company_name', r.company_name, 'recipient_name', r.recipient_name, 'country', r.country,
    'arrangement', r.arrangement, 'terms_title', r.terms_title, 'terms_body', r.terms_body, 'message', r.message,
    'expires_at', r.expires_at, 'confirmed_at', r.confirmed_at, 'proposal_id', r.id);
end $$;

create or replace function public.confirm_agency_proposal(p_token text, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select * into r from public.agency_proposals where token_hash = public.registration_token_hash(p_token) for update;
  if r.id is null then raise exception 'LINK_UNUSABLE'; end if;
  if r.status = 'confirmed' then return jsonb_build_object('proposal_id', r.id, 'duplicate', true); end if;
  if r.status <> 'awaiting_confirmation' or r.expires_at < now() then raise exception 'LINK_UNUSABLE'; end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Type your full name to confirm'; end if;
  update public.agency_proposals set status = 'confirmed', confirmed_at = now(), confirmed_name = left(btrim(p_name), 120), updated_at = now() where id = r.id;
  perform public.agency_log(r.prospect_id, 'proposal_confirmed', null, jsonb_build_object('proposal_id', r.id, 'reference', r.reference, 'by', left(btrim(p_name), 120)), null, null);
  perform public.agency_advance(r.prospect_id, 'proposal_confirmed', null);
  perform public.notify((select array_remove(array[a.assigned_officer, a.created_by], null) from public.agency_prospects a where a.id = r.prospect_id)
                        || public.registration_managers(), 'partner', 'Proposal confirmed', r.company_name || ' · ' || r.reference, 'agencies/' || r.prospect_id);
  return jsonb_build_object('proposal_id', r.id, 'duplicate', false);
end $$;

create or replace function public.decline_agency_proposal(p_token text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select * into r from public.agency_proposals where token_hash = public.registration_token_hash(p_token) for update;
  if r.id is null or r.status <> 'awaiting_confirmation' or r.expires_at < now() then raise exception 'LINK_UNUSABLE'; end if;
  update public.agency_proposals set status = 'declined', declined_at = now(), decline_reason = nullif(left(btrim(coalesce(p_reason, '')), 1000), ''), updated_at = now() where id = r.id;
  perform public.agency_log(r.prospect_id, 'proposal_declined', p_reason, jsonb_build_object('proposal_id', r.id, 'reference', r.reference), null, null);
  perform public.notify((select array_remove(array[a.assigned_officer, a.created_by], null) from public.agency_prospects a where a.id = r.prospect_id),
                        'partner', 'Proposal declined', r.company_name || ' · ' || r.reference, 'agencies/' || r.prospect_id);
end $$;

-- After confirmation: create the company's registration (the 0030 flow) and link it to the agency.
-- Service role only. Returns the one-time token for emailing, or null when the settings say an
-- administrator issues the link (then the agency waits in Registration pending and they are told).
create or replace function public.issue_registration_for_proposal(p_proposal uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; a record; tok text := public.new_registration_token(); rid uuid; ref text; exp timestamptz; auto boolean;
begin
  select * into r from public.agency_proposals where id = p_proposal and status = 'confirmed';
  if r.id is null then raise exception 'Proposal is not confirmed'; end if;
  select * into a from public.agency_prospects where id = r.prospect_id for update;
  if a.registration_id is not null then return jsonb_build_object('state', 'exists', 'registration_id', a.registration_id); end if;
  select auto_registration_link into auto from public.partnership_settings;
  if not coalesce(auto, true) then
    perform public.agency_advance(a.id, 'registration_pending', null);
    perform public.notify(public.registration_managers(), 'partner', 'Registration link needed', r.company_name || ' confirmed proposal ' || r.reference, 'agencies/' || a.id);
    return jsonb_build_object('state', 'manual');
  end if;
  exp := now() + interval '14 days';
  loop
    ref := 'PR-' || to_char(now(), 'YY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from public.partner_registrations where reference = ref);
  end loop;
  insert into public.partner_registrations (reference, company_name, intended_email, country, internal_notes, token_hash, link_expires_at, created_by)
  values (ref, r.company_name, r.recipient_email, r.country, 'From agency ' || a.reference || ', proposal ' || r.reference, public.registration_token_hash(tok), exp, a.assigned_officer)
  returning id into rid;
  insert into public.partner_registration_events (registration_id, actor, action, detail) values (rid, null, 'link_created', jsonb_build_object('expires_at', exp, 'proposal', r.reference));
  update public.agency_prospects set registration_id = rid, updated_at = now() where id = a.id;
  perform public.agency_log(a.id, 'registration_link', null, jsonb_build_object('registration_id', rid, 'reference', ref), null, null);
  perform public.agency_advance(a.id, 'registration_pending', null);
  return jsonb_build_object('state', 'created', 'registration_id', rid, 'reference', ref, 'token', tok, 'expires_at', exp, 'company_name', r.company_name, 'email', r.recipient_email);
end $$;

-- An administrator issues the link by hand (when automatic links are off, or to redo one).
create or replace function public.issue_agency_registration(p_prospect uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; res jsonb;
begin
  if not public.can_manage_registrations() then raise exception 'Only authorised administrators can issue registration links'; end if;
  select * into a from public.agency_prospects where id = p_prospect for update;
  if a.id is null then raise exception 'Agency not found'; end if;
  if a.registration_id is not null then raise exception 'This agency already has a registration'; end if;
  if a.company_name is null then raise exception 'Add the agency name first'; end if;
  res := public.create_partner_registration(a.company_name, a.email, a.country, 14, 'From agency ' || a.reference);
  update public.agency_prospects set registration_id = (res ->> 'id')::uuid, updated_at = now() where id = p_prospect;
  perform public.agency_log(p_prospect, 'registration_link', null, jsonb_build_object('registration_id', res ->> 'id', 'reference', res ->> 'reference'));
  perform public.agency_advance(p_prospect, 'registration_pending');
  return res;
end $$;

-- Registration progress → agency pipeline (and the officer's "Partners onboarded").
create or replace function public.agency_follow_registration()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a record; nxt text;
begin
  if new.status is not distinct from old.status then return new; end if;
  select * into a from public.agency_prospects where registration_id = new.id;
  if a.id is null then return new; end if;
  nxt := case new.status when 'submitted' then 'registration_submitted' when 'in_review' then 'under_review' when 'approved' then 'approved'
                         when 'activated' then 'onboarded' when 'rejected' then 'closed' end;
  perform public.agency_log(a.id, 'registration_' || new.status, null, jsonb_build_object('registration_id', new.id, 'reference', new.reference), null, auth.uid());
  if new.status = 'changes_requested' then return new; end if;
  if nxt is null then return new; end if;
  if new.status = 'activated' then
    update public.agency_prospects set partner_id = new.partner_id, updated_at = now() where id = a.id and partner_id is null;
    update public.partners set partnership_officer_id = a.assigned_officer
    where id = new.partner_id and partnership_officer_id is null and a.assigned_officer is not null
      and exists (select 1 from public.employees e where e.id = a.assigned_officer);
    perform public.agency_advance(a.id, 'onboarded', auth.uid(), true);
    perform public.agency_work((select id from public.employees where id = a.assigned_officer), 'partner_onboarded', 'agency-onboarded:' || a.id, a.id,
                               coalesce(a.company_name, a.reference));
  elsif new.status = 'rejected' then
    perform public.agency_advance(a.id, 'closed', auth.uid(), true);
  else
    perform public.agency_advance(a.id, nxt, auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists partner_registrations_agency on public.partner_registrations;
create trigger partner_registrations_agency after update on public.partner_registrations for each row execute function public.agency_follow_registration();

-- Brevo delivery events now also update proposal emails (credential emails unchanged).
create or replace function public.apply_email_event(p_message_id text, p_event text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  ev text := lower(coalesce(p_event, ''));
  next_status text;
  next_detail text;
begin
  if ev in ('delivered', 'opened', 'unique_opened', 'click') then
    next_status := 'delivered';
  elsif ev in ('hard_bounce', 'hardbounce', 'invalid_email', 'blocked', 'error', 'spam') then
    next_status := 'failed';
    next_detail := left(coalesce(nullif(p_reason, ''), replace(ev, '_', ' ')), 200);
  elsif ev in ('soft_bounce', 'softbounce', 'deferred') then
    next_status := 'accepted';
    next_detail := 'Delivery delayed by the receiving server';
  elsif ev in ('request', 'sent') then
    next_status := 'accepted';
  else
    return;
  end if;
  update public.account_credential_deliveries d
  set status = next_status, detail = coalesce(next_detail, d.detail), updated_at = now()
  where d.provider_message_id = p_message_id
    and (d.status in ('pending', 'accepted') or (d.status = 'delivered' and next_status = 'failed' and ev <> 'spam'));
  update public.agency_proposals r
  set email_status = next_status, email_detail = coalesce(next_detail, r.email_detail), updated_at = now()
  where r.provider_message_id = p_message_id
    and (r.email_status = 'accepted' or (r.email_status = 'delivered' and next_status = 'failed' and ev <> 'spam'));
end $$;
revoke all on function public.apply_email_event(text, text, text) from public, anon, authenticated;

-- =============================================================== grants
do $$
declare f text;
begin
  foreach f in array array['create_agency_prospect(jsonb, uuid)', 'update_agency_prospect(uuid, jsonb)', 'set_agency_contact_status(uuid, text, text)',
                           'log_agency_activity(uuid, text, text, date, uuid)', 'set_agency_stage(uuid, text, text)', 'record_agency_mou(uuid, text, date, text)',
                           'set_agency_mou_status(uuid, text, date)', 'publish_proposal_terms(text, text)', 'update_partnership_settings(boolean, integer)',
                           'proposal_commission_options(text)', 'create_agency_proposal(uuid, jsonb, uuid)', 'decide_agency_proposal(uuid, boolean, text)',
                           'cancel_agency_proposal(uuid)', 'issue_agency_registration(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['begin_agency_proposal_send(uuid, uuid, text)', 'finish_agency_proposal_send(uuid, uuid, boolean, text, text)',
                           'agency_proposal_for_token(text)', 'confirm_agency_proposal(text, text)', 'decline_agency_proposal(text, text)',
                           'issue_registration_for_proposal(uuid)', 'agency_clean(jsonb, text, integer)', 'agency_stage_rank(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on function public.agency_stage_rank(text) to authenticated;

-- =============================================================== realtime
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['agency_prospects', 'agency_activities', 'agency_proposals', 'agency_mous'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
