-- 0042_historical_onboarding.sql — run after 0041_linkedin_profile_conversion.sql
-- (Supabase SQL Editor: Save this query as "0042_historical_onboarding")
--
-- Historical onboarded clients count as onboarded and appear in Clients & Branches.
-- * Business onboarding vs portal access, one definition for every screen (partner_directory_status):
--     business: historical (directory record from the imported sheet, no login yet) · verified
--               (an active or suspended partner organisation) · not_onboarded (still provisioning)
--     portal:   no_account · pending (users exist, portal not open) · active · suspended · deactivated
--   A historical client is onboarded without any login; it gets no portal access until a Super Admin
--   creates its first account and opens the portal.
-- * partnership_onboarding_summary(): the Onboarded KPI = business-onboarded partner organisations
--   + onboarded agencies not yet linked to one (each client once). "Mine" = the caller's own.
-- * reconcile_historical_onboarded(p_apply): for every onboarded agency without a partner link:
--   links it to an existing partner on an exact email, phone or name match (case and spaces
--   ignored); flags it for review when several partners match or a partner name is only close;
--   otherwise creates a historical client directory record (status Active, portal off, no login,
--   onboarding_source 'historical', the agency's contact details and officer). Never creates
--   logins, never sends emails, never counts as anyone's work today, never changes agency stages.
--   p_apply = false returns the same report without writing. Running it again changes nothing.
-- * issue_agency_registration refuses agencies already linked to a partner (their account is
--   created on that partner instead), so no second organisation can appear.
-- Safe to run more than once.

alter table public.partners add column if not exists onboarding_source text not null default 'portal';
alter table public.partners drop constraint if exists partners_onboarding_source_check;
alter table public.partners add constraint partners_onboarding_source_check check (onboarding_source in ('portal', 'historical'));
alter table public.partners add column if not exists historical_since timestamptz;

-- The partners column grant (0022) lists columns explicitly: new ones must be granted.
grant select (onboarding_source, historical_since) on public.partners to authenticated;

-- Partner records created by the reconciliation are not anyone's work today.
create or replace function public.track_created_work()
returns trigger language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_employee_id();
begin
  if me is null or coalesce(current_setting('ssi.historical_reconciliation', true), '') = 'on' then return new; end if;
  if tg_table_name = 'students' then
    perform public.record_work_activity(me, 'student_created', 'student:' || new.id, 'student', new.id, null, new.id, new.partner_id);
  elsif tg_table_name = 'partners' then
    perform public.record_work_activity(me, 'partner_onboarded', 'partner:' || new.id, 'partner', new.id, null, null, new.id);
  end if;
  return new;
end $$;

-- =============================================================== status
create or replace function public.partner_directory_status()
returns table (partner_id text, business_status text, portal_status text, onboarding_source text, users integer,
               agency_id uuid, agency_reference text, contact_name text, phone text)
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
         o.onboarding_source, coalesce(u.n, 0), a.id, a.reference, o.contact_name, o.phone
  from public.partners o
  left join u on u.partner_id = o.id
  left join public.agency_prospects a on a.partner_id = o.id
  where public.my_profile_ok() and public.is_staff() and (public.staff_can('partners') or public.agency_access());
$$;

create or replace function public.partnership_onboarding_summary()
returns jsonb language sql stable security definer set search_path = '' as $$
  with d as (select s.*, o.partnership_officer_id from public.partner_directory_status() s join public.partners o on o.id = s.partner_id where o.archived_at is null),
  open_agencies as (select a.* from public.agency_prospects a where a.stage = 'onboarded' and a.partner_id is null)
  select jsonb_build_object(
    'total', (select count(*) from d where business_status in ('historical', 'verified')) + (select count(*) from open_agencies),
    'historical', (select count(*) from d where business_status = 'historical'),
    'verified', (select count(*) from d where business_status = 'verified'),
    'unlinked', (select count(*) from open_agencies),
    'portal_active', (select count(*) from d where portal_status = 'active'),
    'no_account', (select count(*) from d where business_status in ('historical', 'verified') and portal_status = 'no_account'),
    'mine', (select count(*) from d where business_status in ('historical', 'verified') and partnership_officer_id = auth.uid())
            + (select count(*) from open_agencies where assigned_officer = auth.uid()))
  where public.my_profile_ok() and public.is_staff() and (public.staff_can('partners') or public.agency_access());
$$;

-- =============================================================== reconciliation
create or replace function public.reconcile_historical_onboarded(p_apply boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a record; n int; cand jsonb; pid text; v_code text;
  found int := 0; linked jsonb := '[]'; created jsonb := '[]'; conflicts jsonb := '[]';
begin
  if public.is_end_user_request() and not public.is_super_admin() then raise exception 'Only a Super Admin can reconcile historical clients'; end if;
  if p_apply then
    perform pg_advisory_xact_lock(hashtext('historical-onboarding'));
    perform set_config('ssi.historical_reconciliation', 'on', true);
  end if;
  for a in select * from public.agency_prospects where stage = 'onboarded' and partner_id is null order by company_name, reference for update loop
    found := found + 1;
    -- Exact matches only: email, phone digits (same last 10), or name (case and spaces ignored).
    select count(*), jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name)), min(o.id) into n, cand, pid
    from public.partners o
    where o.archived_at is null and not exists (select 1 from public.agency_prospects x where x.partner_id = o.id)
      and ((a.email is not null and lower(o.email) = lower(a.email))
        or (char_length(coalesce(public.agency_digits(a.phone), '')) >= 8 and char_length(coalesce(public.agency_digits(o.phone), '')) >= 8
            and right(public.agency_digits(o.phone), 10) = right(public.agency_digits(a.phone), 10))
        or (public.agency_name_key(o.name) = public.agency_name_key(a.company_name)));
    if n > 1 then
      conflicts := conflicts || jsonb_build_object('agency', a.company_name, 'reference', a.reference, 'reason', 'several partners match', 'candidates', cand);
      if p_apply then
        update public.agency_prospects set needs_reconciliation = true, reconciliation_note = 'Several partners match — choose the right one in Clients & Branches', updated_at = now() where id = a.id;
      end if;
      continue;
    end if;
    if n = 1 then
      linked := linked || jsonb_build_object('agency', a.company_name, 'reference', a.reference, 'partner', cand -> 0 ->> 'name');
      if p_apply then
        update public.agency_prospects set partner_id = pid, needs_reconciliation = false,
          reconciliation_note = 'Linked to the existing partner (exact email, phone or name match)', updated_at = now() where id = a.id;
        update public.partners set partnership_officer_id = coalesce(partnership_officer_id, case when exists (select 1 from public.employees e where e.id = a.assigned_officer) then a.assigned_officer end)
        where id = pid;
        perform public.agency_log(a.id, 'reconciled', 'Historical client linked to an existing partner', jsonb_build_object('partner_id', pid, 'match', 'exact'), null, null);
      end if;
      continue;
    end if;
    -- No exact match: a close name is left for an administrator; nothing is created.
    select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name)) into cand from public.partners o
    where o.archived_at is null and not exists (select 1 from public.agency_prospects x where x.partner_id = o.id)
      and public.agency_suggest_key(o.name) is not null and public.agency_suggest_key(a.company_name) is not null
      and (public.agency_suggest_key(o.name) = public.agency_suggest_key(a.company_name)
        or (length(public.agency_suggest_key(o.name)) >= 5 and public.agency_suggest_key(a.company_name) like public.agency_suggest_key(o.name) || '%')
        or (length(public.agency_suggest_key(a.company_name)) >= 5 and public.agency_suggest_key(o.name) like public.agency_suggest_key(a.company_name) || '%'));
    if cand is not null then
      conflicts := conflicts || jsonb_build_object('agency', a.company_name, 'reference', a.reference, 'reason', 'possible match — confirm or create', 'candidates', cand);
      if p_apply then
        update public.agency_prospects set needs_reconciliation = true,
          reconciliation_note = 'Possible match with ' || (cand -> 0 ->> 'name') || ' — confirm it is the same company, or create a new client record', updated_at = now() where id = a.id;
      end if;
      continue;
    end if;
    if a.company_name is null or a.contact_name is null then
      conflicts := conflicts || jsonb_build_object('agency', coalesce(a.company_name, a.reference), 'reference', a.reference, 'reason', 'agency name or contact person missing');
      continue;
    end if;
    created := created || jsonb_build_object('agency', a.company_name, 'reference', a.reference);
    if p_apply then
      v_code := 'H' || upper(substr(md5(a.id::text), 1, 6));
      while exists (select 1 from public.partners o where o.code = v_code) loop v_code := 'H' || upper(substr(md5(v_code || random()::text), 1, 6)); end loop;
      insert into public.partners (name, code, contact_name, email, phone, country, status, tier, portal_enabled, commission_visible, joined_at,
        partnership_officer_id, onboarding_source, historical_since)
      values (a.company_name, v_code, a.contact_name, coalesce(lower(a.email), ''), a.phone, a.country, 'Active', 'Silver', false, false, a.created_at,
        case when exists (select 1 from public.employees e where e.id = a.assigned_officer) then a.assigned_officer end, 'historical', now())
      returning id into pid;
      update public.agency_prospects set partner_id = pid, needs_reconciliation = false,
        reconciliation_note = 'Historical client record created in Clients & Branches (no login yet)', updated_at = now() where id = a.id;
      perform public.agency_log(a.id, 'reconciled', 'Historical client record created in Clients & Branches', jsonb_build_object('partner_id', pid, 'match', 'created'), null, null);
    end if;
  end loop;
  if p_apply then perform set_config('ssi.historical_reconciliation', '', true); end if;
  return jsonb_build_object('applied', coalesce(p_apply, false), 'found', found, 'linked_existing', jsonb_array_length(linked), 'created', jsonb_array_length(created),
    'conflicts', jsonb_array_length(conflicts), 'linked', linked, 'created_records', created, 'conflict_details', conflicts,
    'already_linked', (select count(*) from public.agency_prospects where stage = 'onboarded' and partner_id is not null));
end $$;

-- An agency already linked to a partner gets its login on that partner, not a new registration.
create or replace function public.issue_agency_registration(p_prospect uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; res jsonb;
begin
  if not public.can_manage_registrations() then raise exception 'Only authorised administrators can issue registration links'; end if;
  select * into a from public.agency_prospects where id = p_prospect for update;
  if a.id is null then raise exception 'Agency not found'; end if;
  if a.partner_id is not null then raise exception 'This agency is already a client in Clients & Branches — create its partner account there instead'; end if;
  if a.registration_id is not null then raise exception 'This agency already has a registration'; end if;
  if a.company_name is null then raise exception 'Add the agency name first'; end if;
  res := public.create_partner_registration(a.company_name, a.email, a.country, 14, 'From agency ' || a.reference);
  update public.agency_prospects set registration_id = (res ->> 'id')::uuid, updated_at = now() where id = p_prospect;
  perform public.agency_log(p_prospect, 'registration_link', null, jsonb_build_object('registration_id', res ->> 'id', 'reference', res ->> 'reference'));
  perform public.agency_advance(p_prospect, 'registration_pending');
  return res;
end $$;

do $$
declare f text;
begin
  foreach f in array array['partner_directory_status()', 'partnership_onboarding_summary()', 'reconcile_historical_onboarded(boolean)', 'issue_agency_registration(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
