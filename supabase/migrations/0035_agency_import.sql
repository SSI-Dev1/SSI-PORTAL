-- 0035_agency_import.sql — run after 0034_agency_outreach.sql
-- (Supabase SQL Editor: Save this query as "0035_agency_import")
--
-- 1. Contact status gets "unknown" (not yet recorded) and it is the default: a new or imported
--    agency is never marked Connected / Not connected without a recorded interaction.
-- 2. The Agency List is the team's whole pipeline: everyone with Agencies access sees every agency
--    (before: only their own). Imported agencies have no assigned officer until someone takes them.
-- 3. Excel import of agencies (administrators): preview with server-side matching, then import.
--    Original values (name, POC, number, email, status text, row number, file, time) are kept.
--    Safe matching only: exact email, exact phone digits (8+), or exact name (case and spaces
--    ignored) — never "similar" names. Existing agencies are never overwritten; matches are
--    skipped and listed. "Onboarded" rows link to an existing partner only on a single exact
--    match; otherwise they are kept as historically onboarded and flagged for reconciliation.
--    No login, partner or work-report activity is ever created by an import.
-- 4. Daily report attribution: "New partners contacted" = an employee's first outreach to a new
--    agency (attempt, call, meeting or Connected); later calls are follow-up calls. "Partners
--    onboarded" goes to the employee who sent the confirmed proposal — never to whoever happens to
--    be assigned. Closing and reopening are recorded.
-- Safe to run more than once.

-- =============================================================== columns
alter table public.agency_prospects drop constraint if exists agency_prospects_contact_status_check;
alter table public.agency_prospects add constraint agency_prospects_contact_status_check check (contact_status in ('unknown', 'not_connected', 'connected'));
alter table public.agency_prospects alter column contact_status set default 'unknown';
alter table public.agency_prospects
  add column if not exists first_contact_at      timestamptz,
  add column if not exists source                text not null default 'manual' check (source in ('manual', 'import')),
  add column if not exists import_id             uuid,
  add column if not exists source_row            integer,
  add column if not exists source_status         text,
  add column if not exists source_values         jsonb,
  add column if not exists historical_onboarded  boolean not null default false,
  add column if not exists needs_reconciliation  boolean not null default false,
  add column if not exists reconciliation_note   text check (char_length(reconciliation_note) <= 1000);
update public.agency_prospects set first_contact_at = coalesce(first_contact_at, first_connected_at) where first_connected_at is not null;

create table if not exists public.agency_imports (
  id          uuid primary key default gen_random_uuid(),
  file_name   text not null check (char_length(file_name) <= 200),
  sheet_name  text,
  row_count   integer not null,
  created     integer not null default 0,
  skipped     integer not null default 0,
  summary     jsonb not null default '{}',
  request_key uuid not null unique,
  imported_by uuid,
  imported_at timestamptz not null default now()
);
alter table public.agency_imports enable row level security;
revoke all on public.agency_imports from anon, authenticated;
grant select on public.agency_imports to authenticated;
drop policy if exists "agency imports: read" on public.agency_imports;
create policy "agency imports: read" on public.agency_imports for select to authenticated using (public.agency_access());

-- =============================================================== visibility: the whole pipeline
create or replace function public.agency_can_see(p_prospect uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.agency_access() and exists (select 1 from public.agency_prospects a where a.id = p_prospect);
$$;
drop policy if exists "agency prospects: read" on public.agency_prospects;
create policy "agency prospects: read" on public.agency_prospects for select to authenticated using (public.agency_access());

-- An officer takes an unassigned agency (administrators assign anyone through Edit).
create or replace function public.claim_agency(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.agency_access() then raise exception 'Not allowed'; end if;
  update public.agency_prospects set assigned_officer = auth.uid(), updated_at = now() where id = p_id and assigned_officer is null;
  if not found then raise exception 'This agency already has an officer'; end if;
  perform public.agency_log(p_id, 'assigned', null, jsonb_build_object('to', auth.uid()));
end $$;

-- =============================================================== outreach attribution
-- First outreach to an agency that was new (not imported mid-pipeline) = "New partner contacted".
create or replace function public.agency_first_outreach(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select * into a from public.agency_prospects where id = p_id for update;
  if a.first_contact_at is not null then return false; end if;
  update public.agency_prospects set first_contact_at = now() where id = p_id;
  return a.source = 'manual' or a.stage = 'new_prospect';
end $$;
revoke all on function public.agency_first_outreach(uuid) from public, anon, authenticated;

create or replace function public.create_agency_prospect(p jsonb, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
  return jsonb_build_object('id', rid, 'reference', ref, 'duplicate', false);
end $$;

create or replace function public.set_agency_contact_status(p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare a record; fresh boolean;
begin
  if not public.agency_can_see(p_id) then raise exception 'Not allowed to update this agency'; end if;
  if p_status not in ('connected', 'not_connected') then raise exception 'Unknown contact status'; end if;
  select * into a from public.agency_prospects where id = p_id for update;
  if a.contact_status = p_status then return; end if;
  fresh := public.agency_first_outreach(p_id);
  update public.agency_prospects set contact_status = p_status, contact_changed_by = auth.uid(), contact_changed_at = now(),
    first_connected_at = coalesce(first_connected_at, case when p_status = 'connected' then now() end),
    last_contact_at = now(), updated_at = now()
  where id = p_id;
  perform public.agency_log(p_id, 'contact_status', p_note, jsonb_build_object('from', a.contact_status, 'to', p_status));
  if fresh then perform public.agency_work(public.my_employee_id(), 'partner_contact', 'agency-contact:' || p_id, p_id); end if;
end $$;

-- contact_attempt · call · meeting · follow_up_done · note · follow_up (schedule)
create or replace function public.log_agency_activity(p_id uuid, p_kind text, p_note text, p_next date, p_request uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare rid bigint; me uuid := public.my_employee_id(); fresh boolean := false; outreach boolean;
begin
  if not public.agency_can_see(p_id) then raise exception 'Not allowed to update this agency'; end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  if p_kind not in ('contact_attempt', 'call', 'meeting', 'follow_up_done', 'note', 'follow_up') then raise exception 'Unknown activity'; end if;
  if p_kind in ('note', 'follow_up') and nullif(btrim(coalesce(p_note, '')), '') is null and p_next is null then raise exception 'Add a note or a follow-up date'; end if;
  if p_next is not null and p_next < public.company_today() then raise exception 'The follow-up date cannot be in the past'; end if;
  rid := public.agency_log(p_id, p_kind, p_note, jsonb_build_object('next_follow_up', p_next), p_request);
  if rid is null then return (select id from public.agency_activities where request_id = p_request); end if;
  outreach := p_kind in ('contact_attempt', 'call', 'meeting', 'follow_up_done');
  if outreach then fresh := public.agency_first_outreach(p_id); end if;
  update public.agency_prospects set
    last_contact_at = case when outreach then now() else last_contact_at end,
    contact_status = case when p_kind = 'contact_attempt' and contact_status = 'unknown' then 'not_connected' else contact_status end,
    contact_changed_by = case when p_kind = 'contact_attempt' and contact_status = 'unknown' then auth.uid() else contact_changed_by end,
    contact_changed_at = case when p_kind = 'contact_attempt' and contact_status = 'unknown' then now() else contact_changed_at end,
    next_follow_up = case when p_next is not null then p_next when outreach and next_follow_up <= public.company_today() then null else next_follow_up end,
    updated_at = now()
  where id = p_id;
  if fresh then
    perform public.agency_work(me, 'partner_contact', 'agency-contact:' || p_id, p_id, p_note);
  elsif p_kind in ('call', 'follow_up_done') then
    perform public.agency_work(me, 'partner_call', 'agency-act:' || rid, p_id, p_note);
  end if;
  if p_kind = 'meeting' then perform public.agency_work(me, 'partner_meeting', 'agency-act:' || rid, p_id, p_note); end if;
  if p_next is not null then perform public.agency_advance(p_id, 'follow_up_required'); end if;
  return rid;
end $$;

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
  perform public.agency_log(p_id, case when cur in ('closed', 'inactive') and p_stage not in ('closed', 'inactive') then 'reactivated' else 'stage' end,
                            p_note, jsonb_build_object('from', cur, 'to', p_stage));
  if p_stage = 'closed' then perform public.agency_work(public.my_employee_id(), 'partner_closed', 'agency-closed:' || p_id || ':' || now()::date, p_id, p_note); end if;
end $$;

-- Onboarded → credited to whoever sent the proposal the agency confirmed (if an employee).
create or replace function public.agency_follow_registration()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a record; nxt text; sender uuid;
begin
  if new.status is not distinct from old.status then return new; end if;
  select * into a from public.agency_prospects where registration_id = new.id;
  if a.id is null then return new; end if;
  nxt := case new.status when 'submitted' then 'registration_submitted' when 'in_review' then 'under_review' when 'approved' then 'approved'
                         when 'activated' then 'onboarded' when 'rejected' then 'closed' end;
  perform public.agency_log(a.id, 'registration_' || new.status, null, jsonb_build_object('registration_id', new.id, 'reference', new.reference), null, auth.uid());
  if new.status = 'changes_requested' or nxt is null then return new; end if;
  if new.status = 'activated' then
    update public.agency_prospects set partner_id = new.partner_id, historical_onboarded = false, needs_reconciliation = false, updated_at = now()
    where id = a.id and partner_id is null;
    update public.partners set partnership_officer_id = a.assigned_officer
    where id = new.partner_id and partnership_officer_id is null and a.assigned_officer is not null
      and exists (select 1 from public.employees e where e.id = a.assigned_officer);
    perform public.agency_advance(a.id, 'onboarded', auth.uid(), true);
    select p.sent_by into sender from public.agency_proposals p where p.prospect_id = a.id and p.status = 'confirmed' order by p.confirmed_at desc limit 1;
    perform public.agency_work((select id from public.employees where id = sender), 'partner_onboarded', 'agency-onboarded:' || a.id, a.id, coalesce(a.company_name, a.reference));
  elsif new.status = 'rejected' then
    perform public.agency_advance(a.id, 'closed', auth.uid(), true);
  else
    perform public.agency_advance(a.id, nxt, auth.uid());
  end if;
  return new;
end $$;

-- =============================================================== import
create or replace function public.agency_digits(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '');
$$;
create or replace function public.agency_name_key(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(lower(btrim(coalesce(p, ''))), '\s+', ' ', 'g'), '');
$$;
create or replace function public.agency_import_stage(p_status text)
returns text language sql immutable set search_path = '' as $$
  select case regexp_replace(lower(btrim(coalesce(p_status, ''))), '\s+', ' ', 'g')
    when 'onboarded' then 'onboarded' when 'on boarded' then 'onboarded'
    when 'proposal send' then 'proposal_sent' when 'proposal sent' then 'proposal_sent'
    when 'mou send' then 'mou_sent' when 'mou sent' then 'mou_sent'
    when 'closed' then 'closed' when 'inactive' then 'inactive'
    when 'new' then 'new_prospect' when 'new prospect' then 'new_prospect' when '' then 'new_prospect'
    else null end;
$$;

-- p_rows: [{row, name, poc, phone, email, status}] exactly as read from the sheet (phone as text).
create or replace function public.preview_agency_import(p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  it jsonb; out jsonb := '[]'; nm text; ph text; em text; st text; dup uuid; dupref text; pm text[]; why text; res text;
  seen_n text[] := '{}'; seen_p text[] := '{}'; seen_e text[] := '{}';
begin
  if not public.agency_manager() then raise exception 'Only administrators can import agencies'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'The sheet has no agency rows'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'Import at most 5,000 rows at a time'; end if;
  for it in select * from jsonb_array_elements(p_rows) loop
    nm := public.agency_name_key(it ->> 'name');
    ph := public.agency_digits(it ->> 'phone'); if char_length(ph) < 8 then ph := null; end if;
    em := lower(nullif(btrim(coalesce(it ->> 'email', '')), ''));
    st := public.agency_import_stage(it ->> 'status');
    dup := null; dupref := null; pm := null; why := null;
    if nm is null and public.agency_name_key(it ->> 'poc') is null and ph is null then
      res := 'invalid'; why := 'No agency name, contact or phone';
    elsif em is not null and em !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      res := 'invalid'; why := 'Email is not valid';
    elsif (nm is not null and nm = any (seen_n)) or (ph is not null and ph = any (seen_p)) or (em is not null and em = any (seen_e)) then
      res := 'duplicate_in_file'; why := 'Same name, phone or email as an earlier row';
    else
      select a.id, a.reference, case when em is not null and lower(a.email) = em then 'email' when ph is not null and public.agency_digits(a.phone) = ph then 'phone' else 'name' end
        into dup, dupref, why
      from public.agency_prospects a
      where (em is not null and lower(a.email) = em) or (ph is not null and public.agency_digits(a.phone) = ph) or (nm is not null and public.agency_name_key(a.company_name) = nm)
      limit 1;
      if dup is not null then res := 'existing'; why := 'Already in the Agency List (' || dupref || ', same ' || why || ')';
      elsif st is null then res := 'new'; why := 'Status "' || coalesce(it ->> 'status', '') || '" not recognised — imported as New prospect, original kept';
      else res := 'new'; end if;
    end if;
    if res = 'new' and st = 'onboarded' then
      select array_agg(o.id) into pm from public.partners o
      where o.archived_at is null and ((em is not null and lower(o.email) = em) or (nm is not null and public.agency_name_key(o.name) = nm))
        and not exists (select 1 from public.agency_prospects x where x.partner_id = o.id);
      if coalesce(cardinality(pm), 0) = 1 then res := 'new_linked'; else res := 'new_reconcile';
        why := case when coalesce(cardinality(pm), 0) > 1 then 'Onboarded in the sheet; several possible partners — choose one' else 'Onboarded in the sheet; no matching partner account — check before treating as active' end;
      end if;
    end if;
    if nm is not null then seen_n := seen_n || nm; end if;
    if ph is not null then seen_p := seen_p || ph; end if;
    if em is not null then seen_e := seen_e || em; end if;
    out := out || jsonb_build_object('row', it -> 'row', 'result', res, 'stage', coalesce(st, 'new_prospect'), 'reason', why, 'existing', dupref,
                                     'partner_id', case when res = 'new_linked' then pm[1] end);
  end loop;
  return jsonb_build_object('items', out,
    'counts', (select jsonb_object_agg(k, n) from (select e ->> 'result' as k, count(*) as n from jsonb_array_elements(out) e group by 1) x),
    'stages', (select jsonb_object_agg(k, n) from (select e ->> 'stage' as k, count(*) as n from jsonb_array_elements(out) e where e ->> 'result' like 'new%' group by 1) x));
end $$;

create or replace function public.import_agencies(p_file text, p_sheet text, p_rows jsonb, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pv jsonb; it jsonb; src jsonb; imp uuid; rid uuid; ref text; n_created int := 0; n_skipped int := 0; ex record;
begin
  if p_request is null then raise exception 'A request id is required'; end if;
  select * into ex from public.agency_imports where request_key = p_request;
  if ex.id is not null then return jsonb_build_object('import_id', ex.id, 'created', ex.created, 'skipped', ex.skipped, 'duplicate', true); end if;
  pv := public.preview_agency_import(p_rows);   -- re-checks permission and every row
  perform pg_advisory_xact_lock(hashtext('agency-import'));
  insert into public.agency_imports (file_name, sheet_name, row_count, request_key, imported_by, summary)
  values (left(coalesce(nullif(btrim(p_file), ''), 'import.xlsx'), 200), p_sheet, jsonb_array_length(p_rows), p_request, auth.uid(), jsonb_build_object('counts', pv -> 'counts', 'stages', pv -> 'stages'))
  returning id into imp;
  for it in select * from jsonb_array_elements(pv -> 'items') loop
    if it ->> 'result' not like 'new%' then n_skipped := n_skipped + 1; continue; end if;
    select e into src from jsonb_array_elements(p_rows) e where e -> 'row' = it -> 'row' limit 1;
    loop
      ref := public.agency_ref('AG');
      exit when not exists (select 1 from public.agency_prospects where reference = ref);
    end loop;
    insert into public.agency_prospects (reference, company_name, contact_name, phone, email, contact_status, stage, stage_changed_at, assigned_officer, created_by,
      source, import_id, source_row, source_status, source_values, historical_onboarded, needs_reconciliation, reconciliation_note, partner_id)
    values (ref, left(nullif(btrim(coalesce(src ->> 'name', '')), ''), 160), left(nullif(btrim(coalesce(src ->> 'poc', '')), ''), 120),
      left(nullif(btrim(coalesce(src ->> 'phone', '')), ''), 40), lower(nullif(btrim(coalesce(src ->> 'email', '')), '')), 'unknown', it ->> 'stage', null, null, auth.uid(),
      'import', imp, (src ->> 'row')::int, src ->> 'status', src, it ->> 'stage' = 'onboarded', it ->> 'result' = 'new_reconcile',
      case when it ->> 'result' = 'new_reconcile' then it ->> 'reason' end, nullif(it ->> 'partner_id', ''))
    returning id into rid;
    perform public.agency_log(rid, 'imported', null, jsonb_build_object('import_id', imp, 'file', p_file, 'row', src -> 'row', 'status', src ->> 'status',
                                                                         'partner_id', it ->> 'partner_id'));
    n_created := n_created + 1;
  end loop;
  update public.agency_imports i set created = n_created, skipped = n_skipped where i.id = imp;
  return jsonb_build_object('import_id', imp, 'created', n_created, 'skipped', n_skipped, 'counts', pv -> 'counts', 'stages', pv -> 'stages', 'duplicate', false);
end $$;

-- Administrators resolve a flagged "onboarded" import: link it to the partner, or confirm it stays historical.
create or replace function public.reconcile_agency(p_id uuid, p_partner text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  if not public.agency_manager() then raise exception 'Only administrators can reconcile agencies'; end if;
  select * into a from public.agency_prospects where id = p_id for update;
  if a.id is null then raise exception 'Agency not found'; end if;
  if p_partner is not null then
    if not exists (select 1 from public.partners where id = p_partner) then raise exception 'Partner not found'; end if;
    if exists (select 1 from public.agency_prospects where partner_id = p_partner and id <> p_id) then raise exception 'That partner is already linked to another agency'; end if;
    update public.agency_prospects set partner_id = p_partner, needs_reconciliation = false, reconciliation_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now() where id = p_id;
    perform public.agency_advance(p_id, 'onboarded', auth.uid(), true);
  else
    update public.agency_prospects set needs_reconciliation = false, reconciliation_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Kept as historically onboarded (no partner account)'), updated_at = now() where id = p_id;
  end if;
  perform public.agency_log(p_id, 'reconciled', p_note, jsonb_build_object('partner_id', p_partner));
end $$;

do $$
declare f text;
begin
  foreach f in array array['claim_agency(uuid)', 'preview_agency_import(jsonb)', 'import_agencies(text, text, jsonb, uuid)', 'reconcile_agency(uuid, text, text)',
                           'create_agency_prospect(jsonb, uuid)', 'set_agency_contact_status(uuid, text, text)', 'log_agency_activity(uuid, text, text, date, uuid)',
                           'set_agency_stage(uuid, text, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['agency_digits(text)', 'agency_name_key(text)', 'agency_import_stage(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agency_imports') then
    alter publication supabase_realtime add table public.agency_imports;
  end if;
end $$;
