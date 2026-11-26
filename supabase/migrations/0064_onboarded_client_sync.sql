-- Every validly onboarded agency appears in Clients & Branches, automatically (26 Nov 2026). Safe to run
-- more than once.
--
-- Root cause (found on live data):
--   1. Historical approval (and the other historical paths before 0062) marked an agency onboarded but
--      never created or linked its client record. Such agencies only showed under "Needs review".
--   2. An agency could be linked to an internal record (the "Direct" placeholder used for direct
--      students): the directory hides internal records, so the agency vanished from Clients & Branches.
--      Nothing in the database stopped that link.
--
-- Fix at the source:
--   * An agency can never be linked to an internal record (trigger), and any such link is undone.
--   * sync_onboarded_agency_client(): the one shared completion step. It uses the agency's own identity
--     and client_reconcile_plan (0060): reuse an exact match, otherwise create the client record (no
--     portal login needed), and flag anything ambiguous for an administrator ("Needs review") instead of
--     guessing. It never creates a second record for the same agency.
--   * A trigger runs it whenever an agency becomes validly onboarded — historical onboarding approved, or
--     a completed partner registration — so no path can update the Agency List alone.
--   * A backfill runs it for every onboarded agency that is still missing from the directory.
-- Unauthorised stage changes are untouched: set_agency_stage / agency_advance keep their rules, and the
-- trigger only acts on an approved historical onboarding or a completed registration. Synchronisation is
-- an administrative correction: no Daily Work Report activity is recorded for it.

-- =============================================================== 1. no links to internal records
create or replace function public.guard_agency_partner_link()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.partner_id is not null and (tg_op = 'INSERT' or new.partner_id is distinct from old.partner_id)
     and exists (select 1 from public.partners o where o.id = new.partner_id and o.internal) then
    raise exception 'An agency cannot be linked to an internal record (%). Link it to its own client record.', new.partner_id;
  end if;
  return new;
end $$;
drop trigger if exists agency_prospects_partner_guard on public.agency_prospects;
create trigger agency_prospects_partner_guard before insert or update of partner_id on public.agency_prospects
  for each row execute function public.guard_agency_partner_link();

-- =============================================================== 2. the shared completion step
-- Internal (not callable by users). Returns {status: linked | created | already | review | skipped, ...}.
create or replace function public.sync_onboarded_agency_client(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; plan jsonb; act text; pid text; v_code text; prev text := current_setting('ssi.historical_reconciliation', true);
begin
  select * into a from public.agency_prospects where id = p_id for update;
  if a.id is null then return jsonb_build_object('status', 'skipped', 'reason', 'Agency not found'); end if;
  if a.partner_id is not null then return jsonb_build_object('status', 'already', 'partner_id', a.partner_id); end if;
  if a.stage <> 'onboarded' then return jsonb_build_object('status', 'skipped', 'reason', 'Not onboarded'); end if;
  if not coalesce(a.historical_status = 'approved'
          or exists (select 1 from public.partner_registrations g where g.id = a.registration_id and g.status in ('approved', 'activated')), false) then
    return jsonb_build_object('status', 'skipped', 'reason', 'Onboarding not approved yet');
  end if;
  plan := public.client_reconcile_plan(p_id);
  act := plan ->> 'action';
  if act = 'conflict' then
    -- Ambiguous: an administrator chooses (Needs review). Nothing is guessed or duplicated.
    update public.agency_prospects set needs_reconciliation = true, reconciliation_note = left(plan ->> 'reason', 500), updated_at = now()
    where id = p_id and partner_id is null;
    return jsonb_build_object('status', 'review', 'reason', plan ->> 'reason', 'candidates', coalesce(plan -> 'candidates', '[]'::jsonb));
  end if;
  if act not in ('create', 'link') then return jsonb_build_object('status', 'skipped', 'reason', plan ->> 'reason'); end if;
  perform set_config('ssi.historical_reconciliation', 'on', true);   -- administrative: no work activities
  if act = 'create' then
    v_code := 'H' || upper(substr(md5(a.id::text), 1, 6));
    while exists (select 1 from public.partners o where o.code = v_code) loop v_code := 'H' || upper(substr(md5(v_code || random()::text), 1, 6)); end loop;
    insert into public.partners (name, code, contact_name, email, phone, country, status, tier, portal_enabled, commission_visible, joined_at,
      partnership_officer_id, onboarding_source, historical_since, agency_type)
    values (a.company_name, v_code, a.contact_name, coalesce(lower(a.email), ''), a.phone, a.country, 'Active', 'Silver', false, false,
      coalesce(a.historical_original_date::timestamptz, a.created_at),
      case when exists (select 1 from public.employees e where e.id = a.assigned_officer) then a.assigned_officer end,
      case when a.historical_status = 'approved' or a.registration_id is null then 'historical' else 'portal' end,
      case when a.historical_status = 'approved' then now() end, a.agency_type)
    returning id into pid;
  else
    pid := plan ->> 'partner_id';
    update public.partners set partnership_officer_id = coalesce(partnership_officer_id, case when exists (select 1 from public.employees e where e.id = a.assigned_officer) then a.assigned_officer end),
      agency_type = coalesce(agency_type, a.agency_type)
    where id = pid;
  end if;
  -- The agency keeps its identity and everything it holds (officers, proposals, registration, agreement, history).
  update public.agency_prospects set partner_id = pid, needs_reconciliation = false,
    reconciliation_note = case when act = 'create' then 'Client record created in Clients & Branches automatically (no login needed)' else 'Linked to its existing client record automatically' end,
    updated_at = now()
  where id = p_id;
  perform public.agency_log(p_id, 'reconciled', btrim(coalesce(p_reason, 'Onboarding completed')),
    jsonb_build_object('partner_id', pid, 'match', case when act = 'create' then 'created' else 'exact' end, 'automatic', true));
  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, partner_id, changes)
  values (auth.uid(), 'system', 'client_reconciled', 'agency_prospects', p_id::text, pid,
          jsonb_build_object('reference', a.reference, 'name', a.company_name, 'action', act, 'reason', btrim(coalesce(p_reason, 'Onboarding completed')), 'automatic', true));
  perform set_config('ssi.historical_reconciliation', coalesce(prev, ''), true);
  return jsonb_build_object('status', case when act = 'create' then 'created' else 'linked' end, 'partner_id', pid);
end $$;
revoke all on function public.sync_onboarded_agency_client(uuid, text) from public, anon, authenticated;

-- =============================================================== 3. run it whenever onboarding completes
create or replace function public.agency_onboarded_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.stage = 'onboarded' and new.partner_id is null
     and (tg_op = 'INSERT' or old.stage is distinct from new.stage or old.historical_status is distinct from new.historical_status
          or old.registration_id is distinct from new.registration_id or old.partner_id is not null) then
    perform public.sync_onboarded_agency_client(new.id,
      case when new.historical_status = 'approved' then 'Historical onboarding approved' else 'Partner registration completed' end);
  end if;
  return null;
end $$;
drop trigger if exists agency_prospects_onboarded_sync on public.agency_prospects;
create trigger agency_prospects_onboarded_sync after insert or update of stage, historical_status, registration_id, partner_id on public.agency_prospects
  for each row execute function public.agency_onboarded_sync();

-- =============================================================== 4. repair existing records
-- (a) links to internal records are undone (the agency is then synchronised to its own client record);
do $$
declare r record;
begin
  for r in select a.id, a.partner_id, o.name from public.agency_prospects a join public.partners o on o.id = a.partner_id where o.internal loop
    update public.agency_prospects set partner_id = null, updated_at = now() where id = r.id;
    perform public.agency_log(r.id, 'reconciled', 'Unlinked from the internal "' || r.name || '" record — an agency needs its own client record',
      jsonb_build_object('previous_partner_id', r.partner_id, 'automatic', true));
  end loop;
end $$;
-- (b) every approved onboarded agency still missing from the directory is synchronised (idempotent).
do $$
declare r record;
begin
  for r in select id from public.agency_prospects where stage = 'onboarded' and partner_id is null order by company_name nulls last, reference loop
    perform public.sync_onboarded_agency_client(r.id, 'Synchronised to Clients & Branches (onboarded before automatic synchronisation)');
  end loop;
end $$;
