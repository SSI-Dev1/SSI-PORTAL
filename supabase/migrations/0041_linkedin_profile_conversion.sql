-- 0041_linkedin_profile_conversion.sql — run after 0040_agency_officer_contact_directory.sql
-- (Supabase SQL Editor: Save this query as "0041_linkedin_profile_conversion")
--
-- LinkedIn Outreach: prospect profile, contact status and "Move to Agency List".
-- * linkedin_prospects.contact_status: Not recorded (default) / Not connected / Connected, separate
--   from the outreach progress (status) and from any agency stage. Set only by an explicit choice
--   (set_linkedin_contact_status), with who and when. Adding a prospect never marks it Connected.
--   The first Connected counts once as "LinkedIn connection contacted" in the daily report (same
--   key as "Record contact", so the two never count twice). Not connected is recorded, not counted.
-- * convert_linkedin_prospect (Move to Agency List) now requires the agency / company name, the
--   point of contact's full name and a valid phone number (kept as text); email, country, LinkedIn
--   link and notes are optional. It no longer invents contact: the new agency takes the prospect's
--   recorded contact status (or Connected when a response / positive response was recorded) and dates. An existing agency (same phone, email or name) is linked instead
--   of duplicated; repeating the move returns the same agency. "Prospect converted to agency" is
--   recorded once per prospect for the employee. No partner, login or portal access is created.
-- * Fix: 0040 had redefined agency_name_key (used by the Excel import and LinkedIn duplicate checks)
--   to ignore punctuation too. It is restored to the 0035 rule (case and spaces ignored); the looser
--   key used only for Clients & Branches suggestions is now agency_suggest_key.
-- Safe to run more than once.

alter table public.linkedin_prospects add column if not exists contact_status text not null default 'unknown';
alter table public.linkedin_prospects drop constraint if exists linkedin_prospects_contact_status_check;
alter table public.linkedin_prospects add constraint linkedin_prospects_contact_status_check check (contact_status in ('unknown', 'not_connected', 'connected'));
alter table public.linkedin_prospects add column if not exists contact_changed_by uuid;
alter table public.linkedin_prospects add column if not exists contact_changed_at timestamptz;

insert into public.work_activity_types (id, label, source, description, sort) values
  ('linkedin_converted', 'LinkedIn prospect moved to Agency List', 'crm', 'You moved a LinkedIn prospect to the Agency List (not counted as a call or contact)', 28)
on conflict (id) do update set label = excluded.label, source = excluded.source, description = excluded.description, sort = excluded.sort;


-- =============================================================== name keys
create or replace function public.agency_name_key(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(lower(btrim(coalesce(p, ''))), '\s+', ' ', 'g'), '');
$$;
create or replace function public.agency_suggest_key(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '', 'g'), '');
$$;

-- Onboarded agencies with their partner link (verified) or without one (pending verification).
-- Readable by staff who may see Clients & Branches or the Agency List; no commission or finance data.
create or replace function public.onboarded_agency_directory()
returns table (agency_id uuid, reference text, company_name text, contact_name text, phone text, email text, country text,
               assigned_officer uuid, officer_name text, partner_id text, verification text, historical boolean,
               needs_reconciliation boolean, reconciliation_note text, source_status text, registration_id uuid, registration_status text,
               suggested_partner_id text, suggested_partner_name text, stage_changed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id, a.reference, a.company_name, a.contact_name, a.phone, a.email, a.country, a.assigned_officer, pr.full_name, a.partner_id,
         case when a.partner_id is not null then 'verified' else 'pending' end,
         a.historical_onboarded, a.needs_reconciliation, a.reconciliation_note, a.source_status, a.registration_id, r.status,
         s.id, s.name, a.stage_changed_at
  from public.agency_prospects a
  left join public.profiles pr on pr.id = a.assigned_officer
  left join public.partner_registrations r on r.id = a.registration_id
  left join lateral (
    select o.id, o.name from public.partners o
    where a.partner_id is null and o.archived_at is null
      and not exists (select 1 from public.agency_prospects x where x.partner_id = o.id)
      and public.agency_suggest_key(o.name) is not null and public.agency_suggest_key(a.company_name) is not null
      and (public.agency_suggest_key(o.name) = public.agency_suggest_key(a.company_name)
           or (length(public.agency_suggest_key(o.name)) >= 5 and public.agency_suggest_key(a.company_name) like public.agency_suggest_key(o.name) || '%')
           or (length(public.agency_suggest_key(a.company_name)) >= 5 and public.agency_suggest_key(o.name) like public.agency_suggest_key(a.company_name) || '%')
           or (a.email is not null and lower(o.email) = lower(a.email)))
    order by (public.agency_suggest_key(o.name) = public.agency_suggest_key(a.company_name)) desc, (lower(o.email) = lower(coalesce(a.email, ''))) desc, o.name
    limit 1) s on true
  where a.stage = 'onboarded'
    and public.my_profile_ok() and public.is_staff() and (public.staff_can('partners') or public.agency_access())
  order by a.company_name nulls last, a.reference;
$$;

grant execute on function public.onboarded_agency_directory() to authenticated;
revoke all on function public.onboarded_agency_directory() from public, anon;

-- =============================================================== contact status
create or replace function public.set_linkedin_contact_status(p_id uuid, p_status text, p_note text, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l record; rid bigint; me uuid := public.my_employee_id();
begin
  if not public.linkedin_editable(p_id) then raise exception 'Not allowed to update this prospect'; end if;
  if p_status not in ('connected', 'not_connected') then raise exception 'Choose Connected or Not connected'; end if;
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
  if p_status = 'connected' then
    perform public.agency_work(me, 'linkedin_connection', 'li-contact:' || p_id, null, p_note);
    update public.work_activities set entity_type = 'linkedin', entity_id = p_id::text where dedupe_key = 'li-contact:' || p_id and entity_id is null;
  end if;
  return jsonb_build_object('contact_status', p_status, 'changed', true);
end $$;

-- =============================================================== Move to Agency List
create or replace function public.convert_linkedin_prospect(p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l record; nm text; poc text; ph text; digits text; em text; url text; extra text; ex uuid; aid uuid; ref text; linked boolean := false; missing text[] := '{}';
  cs text; cs_at timestamptz;
begin
  if not public.linkedin_editable(p_id) then raise exception 'Not allowed to convert this prospect'; end if;
  select * into l from public.linkedin_prospects where id = p_id for update;
  if l.agency_id is not null then return jsonb_build_object('agency_id', l.agency_id, 'linked', true, 'duplicate', true); end if;
  nm := coalesce(public.agency_clean(p, 'company_name', 160), l.company_name);
  poc := coalesce(public.agency_clean(p, 'contact_name', 120), l.name);
  ph := coalesce(public.agency_clean(p, 'phone', 40), l.phone);
  digits := public.agency_digits(ph);
  if ph is null or ph !~ '^\+?[0-9 ()./-]{7,30}$' or char_length(coalesce(digits, '')) not between 7 and 15 then missing := array_append(missing, 'a valid phone number'); end if;
  em := lower(coalesce(public.agency_clean(p, 'email', 200), l.email));
  if em is not null and em !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address, or leave it empty'; end if;
  url := coalesce(public.agency_clean(p, 'linkedin_url', 300), l.linkedin_url);
  if url is not null and url !~* '^(https?://)?([a-z]{2,3}\.)?linkedin\.com/' then raise exception 'Enter a linkedin.com profile link, or leave it empty'; end if;
  extra := public.agency_clean(p, 'notes', 2000);
  -- Recorded outcomes only: an explicit status, or a recorded response / positive response.
  cs := case when l.contact_status <> 'unknown' then l.contact_status when l.status in ('responded', 'interested') then 'connected' else 'unknown' end;
  cs_at := case when l.contact_status <> 'unknown' then l.contact_changed_at when cs = 'connected' then l.last_contact_at end;
  select a.id into ex from public.agency_prospects a
  where (char_length(digits) >= 8 and public.agency_digits(a.phone) = digits)
     or (char_length(digits) >= 10 and char_length(public.agency_digits(a.phone)) >= 10 and right(public.agency_digits(a.phone), 10) = right(digits, 10))
     or (em is not null and lower(a.email) = em)
     or (public.agency_name_key(a.company_name) = public.agency_name_key(nm))
  order by a.created_at limit 1;
  -- A new agency needs its name and point of contact; linking to an existing one does not.
  if ex is null and nm is null then missing := array_prepend('agency / company name', missing); end if;
  if ex is null and poc is null then missing := array_append(missing, 'point of contact full name'); end if;
  if cardinality(missing) > 0 then raise exception 'MISSING: Enter %', array_to_string(missing, ', '); end if;
  if ex is not null then
    aid := ex; linked := true;
    update public.agency_prospects set phone = coalesce(phone, ph), email = coalesce(email, em), contact_name = coalesce(contact_name, poc), updated_at = now() where id = aid;
    perform public.agency_log(aid, 'linked_from_linkedin', null, jsonb_build_object('linkedin_id', p_id, 'reference', l.reference));
  else
    loop
      ref := public.agency_ref('AG');
      exit when not exists (select 1 from public.agency_prospects where reference = ref);
    end loop;
    -- Contact status and dates come from the prospect: moving to the Agency List is not a contact.
    insert into public.agency_prospects (reference, company_name, contact_name, phone, email, country, notes, contact_status, contact_changed_by,
      contact_changed_at, first_connected_at, first_contact_at, last_contact_at, assigned_officer, created_by, source, source_values)
    values (ref, nm, poc, ph, em, public.agency_clean(p, 'country', 80), nullif(concat_ws(E'\n\n', l.notes, extra), ''),
      cs, coalesce(l.contact_changed_by, case when cs <> 'unknown' then l.assigned_to end), cs_at,
      case when cs = 'connected' then cs_at end,
      case when cs <> 'unknown' then coalesce(cs_at, l.last_contact_at) end,
      l.last_contact_at, coalesce(l.assigned_to, auth.uid()), auth.uid(),
      'linkedin', jsonb_build_object('linkedin_id', p_id, 'linkedin_reference', l.reference, 'linkedin_url', url))
    returning id into aid;
    perform public.agency_log(aid, 'converted_from_linkedin', extra, jsonb_build_object('linkedin_id', p_id, 'reference', l.reference, 'linkedin_url', url));
    perform public.agency_work(public.my_employee_id(), 'agency_added', 'agency-added:' || aid, aid);
  end if;
  update public.linkedin_prospects set status = 'converted', agency_id = aid, converted_at = now(), converted_by = auth.uid(),
    company_name = coalesce(company_name, nm), phone = coalesce(phone, ph), email = coalesce(email, em), linkedin_url = coalesce(linkedin_url, url), updated_at = now()
  where id = p_id;
  perform public.linkedin_log(p_id, 'converted', extra, jsonb_build_object('agency_id', aid, 'linked_existing', linked), null);
  perform public.agency_work(public.my_employee_id(), 'linkedin_converted', 'li-converted:' || p_id, aid, coalesce(nm, l.name));
  return jsonb_build_object('agency_id', aid, 'linked', linked, 'duplicate', false);
end $$;

do $$
declare f text;
begin
  foreach f in array array['set_linkedin_contact_status(uuid, text, text, uuid)', 'convert_linkedin_prospect(uuid, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
