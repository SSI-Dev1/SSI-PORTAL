-- 0039_linkedin_outreach_onboarding.sql — run after 0038_proposal_custom_items.sql
-- (Supabase SQL Editor: Save this query as "0039_linkedin_outreach_onboarding")
--
-- 1. LinkedIn Outreach (manual — no LinkedIn API, no scraping): prospects need only a name.
--    Employees record contacts, follow-up messages and responses; "Convert to Agency" needs a
--    phone number, links to an existing agency instead of duplicating it, keeps the LinkedIn
--    history and marks the prospect Converted. Visible to its owner, the owner's reporting
--    manager (e.g. a Senior IRM for their team) and administrators.
-- 2. Senior International Recruitment Managers get "Agencies & proposals" by designation, like
--    Partnership Officers. Registration approval and partner accounts stay with administrators.
-- 3. After an agency confirms a proposal: an approved MOU document (published by an administrator)
--    is emailed together with the registration form. Each email is tracked on its own (accepted /
--    delivered / failed via the Brevo webhook) and can be retried; an emailed MOU is recorded as
--    "sent", never "signed".
-- 4. Daily reports: LinkedIn connection contacted, follow-up message, positive response and closed
--    feed the existing LinkedIn fields; adding a prospect is recorded but not counted.
-- Safe to run more than once.

-- =============================================================== permissions
update public.designations set default_permissions = array_append(default_permissions, 'agency_outreach')
where id = 'senior_international_recruitment_manager' and not ('agency_outreach' = any (default_permissions));
update public.profiles p set permissions = array_append(p.permissions, 'agency_outreach')
from public.employees e
where e.id = p.id and e.designation_id = 'senior_international_recruitment_manager' and p.permissions is not null
  and not ('agency_outreach' = any (p.permissions));

alter table public.agency_prospects drop constraint if exists agency_prospects_source_check;
alter table public.agency_prospects add constraint agency_prospects_source_check check (source in ('manual', 'import', 'linkedin'));

insert into public.work_activity_types (id, label, source, description, sort) values
  ('linkedin_added', 'LinkedIn prospect added', 'crm', 'You added a LinkedIn prospect (not counted as a contact)', 27)
on conflict (id) do update set label = excluded.label, source = excluded.source, description = excluded.description, sort = excluded.sort;

-- =============================================================== LinkedIn prospects
create table if not exists public.linkedin_prospects (
  id               uuid primary key default gen_random_uuid(),
  reference        text not null unique,
  name             text not null check (char_length(btrim(name)) between 1 and 120),
  company_name     text check (char_length(company_name) <= 160),
  phone            text check (char_length(phone) <= 40),
  email            text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  linkedin_url     text check (char_length(linkedin_url) <= 300),
  notes            text check (char_length(notes) <= 4000),
  status           text not null default 'not_contacted' check (status in ('not_contacted', 'contacted', 'responded', 'interested', 'not_interested', 'converted')),
  last_contact_at  timestamptz,
  next_follow_up   date,
  assigned_to      uuid references public.profiles (id) on delete set null,
  agency_id        uuid references public.agency_prospects (id) on delete set null,
  converted_at     timestamptz,
  converted_by     uuid,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists linkedin_prospects_owner_idx on public.linkedin_prospects (assigned_to, status);
create table if not exists public.linkedin_activities (
  id          bigint generated always as identity primary key,
  prospect_id uuid not null references public.linkedin_prospects (id) on delete cascade,
  kind        text not null,
  note        text check (char_length(note) <= 2000),
  detail      jsonb not null default '{}',
  actor       uuid,
  at          timestamptz not null default now(),
  request_id  uuid unique
);
create index if not exists linkedin_activities_idx on public.linkedin_activities (prospect_id, at desc);

-- The owner, their reporting manager (team view) and administrators.
create or replace function public.linkedin_can_see(p_owner uuid, p_creator uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.agency_access() and (public.agency_manager() or auth.uid() in (p_owner, p_creator)
    or exists (select 1 from public.employees e where e.id in (p_owner, p_creator) and e.reporting_manager_id = auth.uid()));
$$;
revoke all on function public.linkedin_can_see(uuid, uuid) from public, anon;
grant execute on function public.linkedin_can_see(uuid, uuid) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['linkedin_prospects', 'linkedin_activities'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
drop policy if exists "linkedin prospects: read" on public.linkedin_prospects;
create policy "linkedin prospects: read" on public.linkedin_prospects for select to authenticated using (public.linkedin_can_see(assigned_to, created_by));
drop policy if exists "linkedin activities: read" on public.linkedin_activities;
create policy "linkedin activities: read" on public.linkedin_activities for select to authenticated
  using (exists (select 1 from public.linkedin_prospects l where l.id = prospect_id and public.linkedin_can_see(l.assigned_to, l.created_by)));

create or replace function public.linkedin_editable(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.linkedin_prospects l where l.id = p_id and public.linkedin_can_see(l.assigned_to, l.created_by));
$$;
revoke all on function public.linkedin_editable(uuid) from public, anon, authenticated;

create or replace function public.linkedin_log(p_id uuid, p_kind text, p_note text, p_detail jsonb, p_request uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare rid bigint;
begin
  insert into public.linkedin_activities (prospect_id, kind, note, detail, actor, request_id)
  values (p_id, p_kind, nullif(btrim(coalesce(p_note, '')), ''), coalesce(p_detail, '{}'), auth.uid(), p_request)
  on conflict (request_id) do nothing returning id into rid;
  return rid;
end $$;
revoke all on function public.linkedin_log(uuid, text, text, jsonb, uuid) from public, anon, authenticated;

create or replace function public.create_linkedin_prospect(p jsonb, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rid uuid; ref text; em text; url text;
begin
  if not public.agency_access() then raise exception 'Not allowed to add LinkedIn prospects'; end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  select l.id, l.reference into rid, ref from public.linkedin_prospects l
  where l.id = (select prospect_id from public.linkedin_activities where request_id = p_request);
  if rid is not null then return jsonb_build_object('id', rid, 'reference', ref, 'duplicate', true); end if;
  if public.agency_clean(p, 'name', 120) is null then raise exception 'Enter the name'; end if;
  em := lower(public.agency_clean(p, 'email', 200));
  if em is not null and em !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address, or leave it empty'; end if;
  url := public.agency_clean(p, 'linkedin_url', 300);
  if url is not null and url !~* '^(https?://)?([a-z]{2,3}\.)?linkedin\.com/' then raise exception 'Enter a linkedin.com profile link, or leave it empty'; end if;
  loop
    ref := public.agency_ref('LI');
    exit when not exists (select 1 from public.linkedin_prospects where reference = ref);
  end loop;
  insert into public.linkedin_prospects (reference, name, company_name, phone, email, linkedin_url, notes, assigned_to, created_by)
  values (ref, public.agency_clean(p, 'name', 120), public.agency_clean(p, 'company_name', 160), public.agency_clean(p, 'phone', 40), em, url,
          public.agency_clean(p, 'notes', 4000), auth.uid(), auth.uid())
  returning id into rid;
  perform public.linkedin_log(rid, 'created', public.agency_clean(p, 'notes', 2000), '{}', p_request);
  perform public.agency_work(public.my_employee_id(), 'linkedin_added', 'li-added:' || rid, null);
  update public.work_activities set entity_type = 'linkedin', entity_id = rid::text where dedupe_key = 'li-added:' || rid;
  return jsonb_build_object('id', rid, 'reference', ref, 'duplicate', false);
end $$;

create or replace function public.update_linkedin_prospect(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare em text; url text;
begin
  if not public.linkedin_editable(p_id) then raise exception 'Not allowed to edit this prospect'; end if;
  if p ? 'name' and public.agency_clean(p, 'name', 120) is null then raise exception 'The name cannot be empty'; end if;
  em := lower(public.agency_clean(p, 'email', 200));
  if p ? 'email' and em is not null and em !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address, or leave it empty'; end if;
  url := public.agency_clean(p, 'linkedin_url', 300);
  if p ? 'linkedin_url' and url is not null and url !~* '^(https?://)?([a-z]{2,3}\.)?linkedin\.com/' then raise exception 'Enter a linkedin.com profile link, or leave it empty'; end if;
  update public.linkedin_prospects set
    name = case when p ? 'name' then public.agency_clean(p, 'name', 120) else name end,
    company_name = case when p ? 'company_name' then public.agency_clean(p, 'company_name', 160) else company_name end,
    phone = case when p ? 'phone' then public.agency_clean(p, 'phone', 40) else phone end,
    email = case when p ? 'email' then em else email end,
    linkedin_url = case when p ? 'linkedin_url' then url else linkedin_url end,
    notes = case when p ? 'notes' then public.agency_clean(p, 'notes', 4000) else notes end,
    assigned_to = case when p ? 'assigned_to' and public.agency_manager() then nullif(p ->> 'assigned_to', '')::uuid else assigned_to end,
    updated_at = now()
  where id = p_id;
  perform public.linkedin_log(p_id, 'edited', null, '{}', null);
end $$;

-- contacted · follow_up (message) · response · interested · not_interested · note · follow_up_date
create or replace function public.log_linkedin_activity(p_id uuid, p_kind text, p_note text, p_next date, p_request uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare l record; rid bigint; me uuid := public.my_employee_id(); nst text;
begin
  if not public.linkedin_editable(p_id) then raise exception 'Not allowed to update this prospect'; end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  if p_kind not in ('contacted', 'follow_up', 'response', 'interested', 'not_interested', 'note', 'follow_up_date') then raise exception 'Unknown activity'; end if;
  if p_next is not null and p_next < public.company_today() then raise exception 'The follow-up date cannot be in the past'; end if;
  select * into l from public.linkedin_prospects where id = p_id for update;
  if l.status = 'converted' and p_kind not in ('note') then raise exception 'This prospect is already converted to an agency'; end if;
  rid := public.linkedin_log(p_id, p_kind, p_note, jsonb_build_object('next_follow_up', p_next, 'from', l.status), p_request);
  if rid is null then return (select id from public.linkedin_activities where request_id = p_request); end if;
  nst := case p_kind when 'contacted' then case when l.status = 'not_contacted' then 'contacted' else l.status end
                     when 'follow_up' then case when l.status = 'not_contacted' then 'contacted' else l.status end
                     when 'response' then case when l.status in ('not_contacted', 'contacted') then 'responded' else l.status end
                     when 'interested' then 'interested' when 'not_interested' then 'not_interested' else l.status end;
  update public.linkedin_prospects set status = nst,
    last_contact_at = case when p_kind in ('contacted', 'follow_up', 'response', 'interested', 'not_interested') then now() else last_contact_at end,
    next_follow_up = coalesce(p_next, case when p_kind in ('contacted', 'follow_up', 'response') and next_follow_up <= public.company_today() then null else next_follow_up end),
    updated_at = now()
  where id = p_id;
  -- Daily report (once per prospect for the first contact, positive response and closing)
  if p_kind = 'contacted' or (p_kind = 'follow_up' and l.status = 'not_contacted') then
    perform public.agency_work(me, 'linkedin_connection', 'li-contact:' || p_id, null, p_note);
  elsif p_kind = 'follow_up' then
    perform public.agency_work(me, 'linkedin_followup', 'li-act:' || rid, null, p_note);
  end if;
  if p_kind = 'interested' then perform public.agency_work(me, 'linkedin_positive', 'li-positive:' || p_id, null, p_note); end if;
  if p_kind = 'not_interested' then perform public.agency_work(me, 'linkedin_closed', 'li-closed:' || p_id, null, p_note); end if;
  update public.work_activities set entity_type = 'linkedin', entity_id = p_id::text
  where dedupe_key in ('li-contact:' || p_id, 'li-act:' || rid, 'li-positive:' || p_id, 'li-closed:' || p_id) and entity_id is null;
  return rid;
end $$;

-- Convert to Agency: phone required; an existing agency (same phone — last 10 digits — email or company name) is
-- linked instead of creating a duplicate.
create or replace function public.convert_linkedin_prospect(p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l record; nm text; ph text; digits text; em text; ex uuid; aid uuid; ref text; linked boolean := false;
begin
  if not public.linkedin_editable(p_id) then raise exception 'Not allowed to convert this prospect'; end if;
  select * into l from public.linkedin_prospects where id = p_id for update;
  if l.agency_id is not null then return jsonb_build_object('agency_id', l.agency_id, 'linked', true, 'duplicate', true); end if;
  nm := coalesce(public.agency_clean(p, 'company_name', 160), public.agency_clean(p, 'name', 120), l.company_name, l.name);
  ph := coalesce(public.agency_clean(p, 'phone', 40), l.phone);
  digits := public.agency_digits(ph);
  if ph is null or ph !~ '^\+?[0-9 ()./-]{7,30}$' or char_length(coalesce(digits, '')) not between 7 and 15 then
    raise exception 'MISSING: Enter a valid phone number to convert this prospect to an agency';
  end if;
  em := lower(coalesce(public.agency_clean(p, 'email', 200), l.email));
  if em is not null and em !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address, or leave it empty'; end if;
  select a.id into ex from public.agency_prospects a
  where (char_length(digits) >= 8 and public.agency_digits(a.phone) = digits)
     -- same number written with and without the country code
     or (char_length(digits) >= 10 and char_length(public.agency_digits(a.phone)) >= 10 and right(public.agency_digits(a.phone), 10) = right(digits, 10))
     or (em is not null and lower(a.email) = em)
     or (public.agency_name_key(a.company_name) = public.agency_name_key(nm))
  order by a.created_at limit 1;
  if ex is not null then
    aid := ex; linked := true;
    update public.agency_prospects set phone = coalesce(phone, ph), email = coalesce(email, em), updated_at = now() where id = aid;
    perform public.agency_log(aid, 'linked_from_linkedin', null, jsonb_build_object('linkedin_id', p_id, 'reference', l.reference));
  else
    loop
      ref := public.agency_ref('AG');
      exit when not exists (select 1 from public.agency_prospects where reference = ref);
    end loop;
    insert into public.agency_prospects (reference, company_name, contact_name, phone, email, country, notes, contact_status, contact_changed_by,
      contact_changed_at, first_connected_at, first_contact_at, last_contact_at, assigned_officer, created_by, source, source_values)
    values (ref, nm, coalesce(public.agency_clean(p, 'contact_name', 120), l.name), ph, em, public.agency_clean(p, 'country', 80), l.notes,
      'connected', auth.uid(), now(), now(), now(), coalesce(l.last_contact_at, now()), coalesce(l.assigned_to, auth.uid()), auth.uid(),
      'linkedin', jsonb_build_object('linkedin_id', p_id, 'linkedin_reference', l.reference, 'linkedin_url', l.linkedin_url))
    returning id into aid;
    perform public.agency_log(aid, 'converted_from_linkedin', null, jsonb_build_object('linkedin_id', p_id, 'reference', l.reference, 'linkedin_url', l.linkedin_url));
    perform public.agency_work(public.my_employee_id(), 'agency_added', 'agency-added:' || aid, aid);
  end if;
  update public.linkedin_prospects set status = 'converted', agency_id = aid, converted_at = now(), converted_by = auth.uid(),
    phone = coalesce(phone, ph), email = coalesce(email, em), updated_at = now()
  where id = p_id;
  perform public.linkedin_log(p_id, 'converted', null, jsonb_build_object('agency_id', aid, 'linked_existing', linked), null);
  return jsonb_build_object('agency_id', aid, 'linked', linked, 'duplicate', false);
end $$;

-- =============================================================== MOU document and onboarding emails
create table if not exists public.mou_documents (
  id         bigint generated always as identity primary key,
  title      text not null check (char_length(btrim(title)) between 2 and 160),
  body       text not null check (char_length(btrim(body)) between 20 and 30000),
  active     boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
create table if not exists public.agency_emails (
  id                  bigint generated always as identity primary key,
  prospect_id         uuid not null references public.agency_prospects (id) on delete cascade,
  proposal_id         uuid references public.agency_proposals (id) on delete set null,
  kind                text not null check (kind in ('mou', 'registration')),
  status              text not null check (status in ('accepted', 'delivered', 'failed', 'not_configured')),
  provider_message_id text,
  detail              text,
  attempts            integer not null default 1,
  last_attempt_by     uuid,
  updated_at          timestamptz not null default now(),
  unique (prospect_id, kind)
);
create index if not exists agency_emails_message_idx on public.agency_emails (provider_message_id) where provider_message_id is not null;
do $$
declare t text;
begin
  foreach t in array array['mou_documents', 'agency_emails'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
drop policy if exists "mou documents: read" on public.mou_documents;
create policy "mou documents: read" on public.mou_documents for select to authenticated using (public.agency_access());
drop policy if exists "agency emails: read" on public.agency_emails;
create policy "agency emails: read" on public.agency_emails for select to authenticated using (public.agency_can_see(prospect_id));

create or replace function public.publish_mou_document(p_title text, p_body text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare rid bigint;
begin
  if not public.agency_manager() then raise exception 'Only administrators can publish the MOU'; end if;
  update public.mou_documents set active = false where active;
  insert into public.mou_documents (title, body, created_by) values (btrim(p_title), btrim(p_body), auth.uid()) returning id into rid;
  return rid;
end $$;

-- Service role (agency-proposal function): record an onboarding email attempt.
create or replace function public.record_agency_email(p_prospect uuid, p_proposal uuid, p_kind text, p_status text, p_message text, p_detail text, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record; mid uuid;
begin
  insert into public.agency_emails as e (prospect_id, proposal_id, kind, status, provider_message_id, detail, last_attempt_by)
  values (p_prospect, p_proposal, p_kind, p_status, p_message, left(p_detail, 300), p_actor)
  on conflict (prospect_id, kind) do update set status = excluded.status, provider_message_id = excluded.provider_message_id, detail = excluded.detail,
    attempts = e.attempts + 1, last_attempt_by = excluded.last_attempt_by, proposal_id = coalesce(excluded.proposal_id, e.proposal_id), updated_at = now();
  perform public.agency_log(p_prospect, p_kind || '_email_' || p_status, p_detail, jsonb_build_object('proposal_id', p_proposal), null, p_actor);
  -- An emailed MOU is "sent" (once), never "signed".
  if p_kind = 'mou' and p_status = 'accepted' and not exists (select 1 from public.agency_mous where prospect_id = p_prospect and status <> 'cancelled') then
    select reference into r from public.agency_proposals where id = p_proposal;
    insert into public.agency_mous (prospect_id, reference, sent_on, sent_by, note)
    values (p_prospect, 'MOU-' || coalesce(r.reference, 'AUTO'), public.company_today(), p_actor, 'Emailed automatically after the proposal was confirmed')
    returning id into mid;
    perform public.agency_log(p_prospect, 'mou_sent', null, jsonb_build_object('mou_id', mid, 'automatic', true), null, p_actor);
  end if;
end $$;

-- Service role: a fresh registration link for an agency whose registration is still open (retry).
create or replace function public.reissue_agency_registration_link(p_prospect uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; g record; tok text := public.new_registration_token(); exp timestamptz := now() + interval '14 days';
begin
  select * into a from public.agency_prospects where id = p_prospect;
  if a.registration_id is null then return jsonb_build_object('state', 'none'); end if;
  select * into g from public.partner_registrations where id = a.registration_id for update;
  if g.status not in ('link_generated', 'in_progress', 'changes_requested') then return jsonb_build_object('state', 'closed', 'status', g.status); end if;
  update public.partner_registrations set token_hash = public.registration_token_hash(tok), link_expires_at = exp, link_status = 'active' where id = g.id;
  insert into public.partner_registration_events (registration_id, actor, action, detail) values (g.id, null, 'link_regenerated', jsonb_build_object('expires_at', exp, 'reason', 'email retry'));
  return jsonb_build_object('state', 'ok', 'registration_id', g.id, 'token', tok, 'expires_at', exp, 'company_name', g.company_name, 'email', coalesce(g.intended_email, a.email));
end $$;

-- Brevo events also update onboarding emails.
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
  update public.agency_emails e
  set status = next_status, detail = coalesce(next_detail, e.detail), updated_at = now()
  where e.provider_message_id = p_message_id
    and (e.status = 'accepted' or (e.status = 'delivered' and next_status = 'failed' and ev <> 'spam'));
end $$;
revoke all on function public.apply_email_event(text, text, text) from public, anon, authenticated;

-- =============================================================== grants and realtime
do $$
declare f text; t text;
begin
  foreach f in array array['create_linkedin_prospect(jsonb, uuid)', 'update_linkedin_prospect(uuid, jsonb)', 'log_linkedin_activity(uuid, text, text, date, uuid)',
                           'convert_linkedin_prospect(uuid, jsonb)', 'publish_mou_document(text, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['record_agency_email(uuid, uuid, text, text, text, text, uuid)', 'reissue_agency_registration_link(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['linkedin_prospects', 'linkedin_activities', 'agency_emails'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
