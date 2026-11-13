-- 0043 · Agency Type: Domestic / International classification
--
-- * agency_prospects.agency_type and partners.agency_type: 'domestic' | 'international', or NULL
--   for "Not Classified". Existing records stay NULL: nothing is inferred from country, phone or
--   email, and nothing is assumed International. One Agency List and one Clients & Branches —
--   the type is a field on the existing records, not a separate list.
-- * A linked agency and its partner organisation always carry the same type (trigger), so the
--   Agency List, Agency Profile and Clients & Branches agree.
-- * Setting a type: anyone who may edit the agency (Partnership Officers, Senior IRM with
--   Agencies & proposals, registration managers, Super Admin). Bulk classification (preview, then
--   confirm): administrators who manage agencies, like the other bulk actions. Every change is in
--   the agency activity history with the previous value; bulk runs are in agency_bulk_operations.
-- * partner_directory_status() and partnership_onboarding_summary(p_type) expose the type so the
--   Clients & Branches filter and the dashboard counts use the same definition.
-- Safe to run more than once.

alter table public.agency_prospects add column if not exists agency_type text;
alter table public.agency_prospects add column if not exists agency_type_changed_by uuid;
alter table public.agency_prospects add column if not exists agency_type_changed_at timestamptz;
alter table public.partners add column if not exists agency_type text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'agency_prospects_agency_type_check') then
    alter table public.agency_prospects add constraint agency_prospects_agency_type_check check (agency_type in ('domestic', 'international'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'partners_agency_type_check') then
    alter table public.partners add constraint partners_agency_type_check check (agency_type in ('domestic', 'international'));
  end if;
end $$;
create index if not exists agency_prospects_type_idx on public.agency_prospects (agency_type);
grant select (agency_type) on public.partners to authenticated;

alter table public.agency_bulk_operations drop constraint if exists agency_bulk_operations_kind_check;
alter table public.agency_bulk_operations add constraint agency_bulk_operations_kind_check check (kind in ('officer', 'contact_status', 'agency_type'));

-- Validates a requested type: NULL / '' = nothing chosen; anything else must be Domestic or International.
create or replace function public.agency_type_value(p text)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := lower(nullif(btrim(coalesce(p, '')), ''));
begin
  if v is not null and v not in ('domestic', 'international') then raise exception 'Agency Type must be Domestic or International'; end if;
  return v;
end $$;

-- Internal: set an agency's type and record it (no permission check — callers check).
create or replace function public.agency_apply_type(p_agency uuid, p_type text, p_note text, p_detail jsonb default '{}')
returns boolean language plpgsql security definer set search_path = '' as $$
declare v text := public.agency_type_value(p_type); cur text;
begin
  if v is null then return false; end if;
  select agency_type into cur from public.agency_prospects where id = p_agency for update;
  if not found then raise exception 'Agency not found'; end if;
  if cur is not distinct from v then return false; end if;
  update public.agency_prospects set agency_type = v, agency_type_changed_by = auth.uid(), agency_type_changed_at = now(), updated_at = now() where id = p_agency;
  perform public.agency_log(p_agency, 'agency_type', p_note, coalesce(p_detail, '{}') || jsonb_build_object('from', cur, 'to', v));
  return true;
end $$;
revoke all on function public.agency_apply_type(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.agency_type_value(text) from public, anon;
grant execute on function public.agency_type_value(text) to authenticated;

-- A linked agency and partner share one type: a newly linked agency takes the partner's type
-- when it has none; the agency's type is copied to its partner.
create or replace function public.agency_type_before()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.agency_type is null and new.partner_id is not null then
    new.agency_type := (select o.agency_type from public.partners o where o.id = new.partner_id);
  end if;
  return new;
end $$;
create or replace function public.agency_type_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.partner_id is not null and new.agency_type is not null then
    update public.partners set agency_type = new.agency_type where id = new.partner_id and agency_type is distinct from new.agency_type;
  end if;
  return null;
end $$;
drop trigger if exists agency_type_before on public.agency_prospects;
create trigger agency_type_before before insert or update of partner_id on public.agency_prospects for each row execute function public.agency_type_before();
drop trigger if exists agency_type_sync on public.agency_prospects;
create trigger agency_type_sync after insert or update of agency_type, partner_id on public.agency_prospects for each row execute function public.agency_type_sync();

-- One agency (Agency Profile).
create or replace function public.set_agency_type(p_id uuid, p_type text, p_note text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.agency_can_see(p_id) then raise exception 'Not allowed to update this agency'; end if;
  if public.agency_type_value(p_type) is null then raise exception 'Choose Domestic or International'; end if;
  return public.agency_apply_type(p_id, p_type, nullif(btrim(coalesce(p_note, '')), ''), '{}');
end $$;

-- A client in Clients & Branches (and its agency, when linked).
create or replace function public.set_partner_agency_type(p_partner text, p_type text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v text := public.agency_type_value(p_type); cur text; aid uuid;
begin
  if not (public.my_profile_ok() and public.is_staff() and (public.agency_access() or public.is_super_admin())) then
    raise exception 'Not allowed to classify clients';
  end if;
  if v is null then raise exception 'Choose Domestic or International'; end if;
  select agency_type into cur from public.partners where id = p_partner for update;
  if not found then raise exception 'Client not found'; end if;
  select id into aid from public.agency_prospects where partner_id = p_partner;
  if aid is not null then perform public.agency_apply_type(aid, v, null, jsonb_build_object('on', 'clients_and_branches', 'partner_id', p_partner)); end if;
  if cur is not distinct from v then return false; end if;
  update public.partners set agency_type = v where id = p_partner;
  return true;
end $$;

-- Bulk classification (administrators): preview, then confirm.
create or replace function public.preview_agency_type(p_ids uuid[], p_type text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v text := public.agency_type_value(p_type); res jsonb;
begin
  if not public.agency_manager() then raise exception 'Only administrators can classify agencies in bulk'; end if;
  if v is null then raise exception 'Choose Domestic or International'; end if;
  select jsonb_build_object('selected', coalesce(cardinality(p_ids), 0), 'found', count(*),
    'already', count(*) filter (where agency_type = v),
    'change', count(*) filter (where agency_type is distinct from v),
    'from', jsonb_build_object('unclassified', count(*) filter (where agency_type is null),
                               'domestic', count(*) filter (where agency_type = 'domestic' and v <> 'domestic'),
                               'international', count(*) filter (where agency_type = 'international' and v <> 'international')))
  into res from public.agency_prospects where id = any (p_ids);
  return res;
end $$;

create or replace function public.bulk_set_agency_type(p_ids uuid[], p_type text, p_note text, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v text := public.agency_type_value(p_type); op uuid; prev jsonb; a record; changed int := 0; same int := 0;
begin
  if not public.agency_manager() then raise exception 'Only administrators can classify agencies in bulk'; end if;
  if v is null then raise exception 'Choose Domestic or International'; end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  if coalesce(cardinality(p_ids), 0) > 5000 then raise exception 'Select at most 5000 agencies at a time'; end if;
  select summary into prev from public.agency_bulk_operations where request_key = p_request;
  if prev is not null then return prev || jsonb_build_object('replayed', true); end if;
  insert into public.agency_bulk_operations (kind, request_key, actor, note) values ('agency_type', p_request, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into op;
  for a in select id, agency_type from public.agency_prospects where id = any (p_ids) order by id for update loop
    if a.agency_type is not distinct from v then same := same + 1; continue; end if;
    perform public.agency_apply_type(a.id, v, p_note, jsonb_build_object('operation', op, 'bulk', true));
    changed := changed + 1;
  end loop;
  update public.agency_bulk_operations set summary = jsonb_build_object('operation', op, 'agency_type', v, 'changed', changed, 'unchanged', same) where id = op;
  return (select summary from public.agency_bulk_operations where id = op) || jsonb_build_object('replayed', false);
end $$;

-- Add Agency, Edit Agency and LinkedIn → Move to Agency List accept an optional agency_type.
CREATE OR REPLACE FUNCTION public.create_agency_prospect(p jsonb, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare rid uuid; ref text; em text; officer uuid; st text; me uuid := auth.uid();
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
  perform public.agency_type_value(p ->> 'agency_type');
  officer := coalesce(case when public.agency_manager() then nullif(p ->> 'assigned_officer', '')::uuid end, me);
  st := coalesce(nullif(p ->> 'contact_status', ''), 'unknown');
  if st not in ('unknown', 'connected', 'not_connected') then st := 'unknown'; end if;
  loop
    ref := public.agency_ref('AG');
    exit when not exists (select 1 from public.agency_prospects where reference = ref);
  end loop;
  insert into public.agency_prospects (reference, company_name, contact_name, phone, email, country, notes, contact_status, contact_changed_by,
    contact_changed_at, first_connected_at, first_contact_at, last_contact_at, assigned_officer, created_by)
  values (ref, public.agency_clean(p, 'company_name', 160), public.agency_clean(p, 'contact_name', 120), public.agency_clean(p, 'phone', 40), em,
    public.agency_clean(p, 'country', 80), public.agency_clean(p, 'notes', 4000), st,
    case when st <> 'unknown' then me end, case when st <> 'unknown' then now() end, case when st = 'connected' then now() end,
    case when st <> 'unknown' then now() end, case when st <> 'unknown' then now() end, officer, me)
  returning id into rid;
  perform public.agency_log(rid, 'created', public.agency_clean(p, 'notes', 2000), jsonb_build_object('contact_status', st), p_request);
  perform public.agency_work(public.my_employee_id(), 'agency_added', 'agency-added:' || rid, rid);
  -- Saying you already reached them when adding counts as the contact (once per agency).
  if st <> 'unknown' then perform public.agency_work(public.my_employee_id(), 'partner_contact', 'agency-contact:' || rid, rid); end if;
  -- Agency Type (0043): only when the user chose one; otherwise Not Classified.
  perform public.agency_apply_type(rid, p ->> 'agency_type', null, jsonb_build_object('on', 'created'));
  return jsonb_build_object('id', rid, 'reference', ref, 'duplicate', false);
end $function$;

CREATE OR REPLACE FUNCTION public.update_agency_prospect(p_id uuid, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Agency Type (0043): set or changed only when a value is chosen; never cleared by an edit.
  if p ? 'agency_type' then perform public.agency_apply_type(p_id, p ->> 'agency_type', null, jsonb_build_object('on', 'edited')); end if;
  foreach k in array array['company_name', 'contact_name', 'phone', 'email', 'country', 'notes', 'assigned_officer'] loop
    if p ? k then changed := changed || jsonb_build_object(k, true); end if;
  end loop;
  perform public.agency_log(p_id, 'edited', null, jsonb_build_object('fields', (select coalesce(jsonb_agg(x), '[]') from jsonb_object_keys(changed) x)));
end $function$;

CREATE OR REPLACE FUNCTION public.convert_linkedin_prospect(p_id uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform public.agency_type_value(p ->> 'agency_type');
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
  -- Agency Type (0043): new agencies take the chosen type; an existing agency keeps its own classification.
  if not linked or (select agency_type from public.agency_prospects where id = aid) is null then
    perform public.agency_apply_type(aid, p ->> 'agency_type', null, jsonb_build_object('on', 'linkedin', 'linkedin_id', p_id));
  end if;
  return jsonb_build_object('agency_id', aid, 'linked', linked, 'duplicate', false);
end $function$;

-- Clients & Branches: the client's type travels with its directory status.
drop function if exists public.partnership_onboarding_summary();
drop function if exists public.partner_directory_status();
create function public.partner_directory_status()
returns table (partner_id text, business_status text, portal_status text, onboarding_source text, users integer, agency_id uuid,
               agency_reference text, contact_name text, phone text, agency_type text)
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
         o.onboarding_source, coalesce(u.n, 0), a.id, a.reference, o.contact_name, o.phone, coalesce(o.agency_type, a.agency_type)
  from public.partners o
  left join u on u.partner_id = o.id
  left join public.agency_prospects a on a.partner_id = o.id
  where public.my_profile_ok() and public.is_staff() and (public.staff_can('partners') or public.agency_access());
$$;

-- p_type: NULL = all, 'domestic', 'international' or 'unclassified'.
create function public.partnership_onboarding_summary(p_type text default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  with d as (select s.*, o.partnership_officer_id from public.partner_directory_status() s join public.partners o on o.id = s.partner_id
             where o.archived_at is null
               and (p_type is null or (p_type = 'unclassified' and s.agency_type is null) or s.agency_type = p_type)),
  open_agencies as (select a.* from public.agency_prospects a where a.stage = 'onboarded' and a.partner_id is null
               and (p_type is null or (p_type = 'unclassified' and a.agency_type is null) or a.agency_type = p_type))
  select jsonb_build_object(
    'total', (select count(*) from d where business_status in ('historical', 'verified')) + (select count(*) from open_agencies),
    'historical', (select count(*) from d where business_status = 'historical'),
    'verified', (select count(*) from d where business_status = 'verified'),
    'unlinked', (select count(*) from open_agencies),
    'portal_active', (select count(*) from d where portal_status = 'active'),
    'no_account', (select count(*) from d where business_status in ('historical', 'verified') and portal_status = 'no_account'),
    'mine', (select count(*) from d where business_status in ('historical', 'verified') and partnership_officer_id = auth.uid())
            + (select count(*) from open_agencies where assigned_officer = auth.uid()))
  where public.my_profile_ok() and public.is_staff() and (public.staff_can('partners') or public.agency_access())
    and (p_type is null or p_type in ('domestic', 'international', 'unclassified'));
$$;

-- Onboarded agencies for Clients & Branches (incl. those still to review) carry their type too.
drop function if exists public.onboarded_agency_directory();
CREATE FUNCTION public.onboarded_agency_directory()
 RETURNS TABLE(agency_id uuid, reference text, company_name text, contact_name text, phone text, email text, country text, assigned_officer uuid, officer_name text, partner_id text, verification text, historical boolean, needs_reconciliation boolean, reconciliation_note text, source_status text, registration_id uuid, registration_status text, suggested_partner_id text, suggested_partner_name text, stage_changed_at timestamp with time zone, agency_type text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select a.id, a.reference, a.company_name, a.contact_name, a.phone, a.email, a.country, a.assigned_officer, pr.full_name, a.partner_id,
         case when a.partner_id is not null then 'verified' else 'pending' end,
         a.historical_onboarded, a.needs_reconciliation, a.reconciliation_note, a.source_status, a.registration_id, r.status,
         s.id, s.name, a.stage_changed_at, a.agency_type
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
$function$;
revoke all on function public.onboarded_agency_directory() from public, anon;
grant execute on function public.onboarded_agency_directory() to authenticated;

revoke all on function public.partner_directory_status() from public, anon;
revoke all on function public.partnership_onboarding_summary(text) from public, anon;
revoke all on function public.set_agency_type(uuid, text, text) from public, anon;
revoke all on function public.set_partner_agency_type(text, text) from public, anon;
revoke all on function public.preview_agency_type(uuid[], text) from public, anon;
revoke all on function public.bulk_set_agency_type(uuid[], text, text, uuid) from public, anon;
grant execute on function public.partner_directory_status() to authenticated;
grant execute on function public.partnership_onboarding_summary(text) to authenticated;
grant execute on function public.set_agency_type(uuid, text, text) to authenticated;
grant execute on function public.set_partner_agency_type(text, text) to authenticated;
grant execute on function public.preview_agency_type(uuid[], text) to authenticated;
grant execute on function public.bulk_set_agency_type(uuid[], text, text, uuid) to authenticated;
revoke all on function public.agency_type_before() from public, anon, authenticated;
revoke all on function public.agency_type_sync() from public, anon, authenticated;
