-- Daily Work Report snapshots + Historical Onboarding approval (17 Nov 2026).
--
-- 1. One report, one data set. A submitted report already freezes its figures (metrics /
--    metric_details / source_activity_ids). It now also freezes the activity timeline and the pending
--    work it was submitted with, so the report screen, the admin view and the PDF all show the same
--    submitted snapshot — never a recalculation from today's data.
--
-- 2. Historical onboarding. New agencies still reach Onboarded only through registration → agreement
--    → approval → activation (set_agency_stage refuses 'onboarded'; unchanged). For agencies that were
--    genuinely onboarded under the previous process:
--      request_historical_onboarding  — anyone who works the agency asks for an administrator review
--                                       (reason / evidence), never changes the stage
--      review_historical_onboarding   — Super Admin or "Partner registrations" administrators approve,
--                                       flag for verification, or decline, one or many agencies
--    Approval sets the agency Onboarded with onboarding_type 'historical', records who / when / why /
--    evidence, keeps every proposal and activity, creates no registration, agreement, proposal, login
--    or email, and records no employee work (the company Onboarded total rises; nobody's daily report
--    does). A Super Admin approval also links the client (existing reconciliation: exact match to an
--    existing partner, otherwise a historical client record with no login); otherwise it waits in
--    Clients & Branches → "Onboarded — needs review". Original onboarding date only if known.

-- ================================================================ 1. report snapshots
alter table public.daily_reports add column if not exists timeline_snapshot jsonb;
alter table public.daily_reports add column if not exists pending_snapshot jsonb;

create or replace function public.snapshot_daily_report()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'Submitted' and (tg_op = 'INSERT' or old.status is distinct from 'Submitted' or old.submitted_at is distinct from new.submitted_at) then
    new.timeline_snapshot := coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'occurred_at', a.occurred_at, 'activity_type', a.activity_type, 'label', coalesce(t.label, a.activity_type),
               'manual', coalesce(t.source, 'crm') = 'logged', 'entity_type', a.entity_type, 'entity_id', a.entity_id,
               'entity_name', coalesce(ag.company_name, ag.contact_name, ag.reference, li.name, pa.name, up.institution_name),
               'application_id', a.application_id, 'from_status', a.from_status, 'to_status', a.to_status, 'quantity', a.quantity,
               'note', a.note, 'voided', false) order by a.occurred_at, a.id)
      from public.work_activities a
      left join public.work_activity_types t on t.id = a.activity_type
      left join public.agency_prospects ag on a.entity_type = 'agency' and ag.id::text = a.entity_id
      left join public.linkedin_prospects li on a.entity_type = 'linkedin' and li.id::text = a.entity_id
      left join public.partners pa on pa.id = coalesce(case when a.entity_type = 'partner' then a.entity_id end, a.partner_id)
      left join public.university_partnerships up on a.entity_type = 'university' and up.id::text = a.entity_id
      where a.employee_id = new.employee_id and a.report_date = new.report_date and a.voided_at is null), '[]');
    -- Pending work as the employee saw it when submitting (agency work queue; null for other roles).
    begin
      new.pending_snapshot := case when auth.uid() = new.employee_id then public.my_pending_work(new.report_date) end;
    exception when others then
      new.pending_snapshot := null;
    end;
  end if;
  return new;
end $$;
revoke all on function public.snapshot_daily_report() from public, anon, authenticated;
drop trigger if exists daily_reports_snapshot on public.daily_reports;
create trigger daily_reports_snapshot before insert or update on public.daily_reports
  for each row execute function public.snapshot_daily_report();

-- ================================================================ 2. historical onboarding
alter table public.agency_prospects add column if not exists onboarding_type text;
alter table public.agency_prospects drop constraint if exists agency_prospects_onboarding_type_check;
alter table public.agency_prospects add constraint agency_prospects_onboarding_type_check check (onboarding_type is null or onboarding_type in ('normal', 'historical'));
alter table public.agency_prospects add column if not exists historical_status text;
alter table public.agency_prospects drop constraint if exists agency_prospects_historical_status_check;
alter table public.agency_prospects add constraint agency_prospects_historical_status_check check (historical_status is null or historical_status in ('requested', 'approved', 'flagged', 'declined'));
alter table public.agency_prospects add column if not exists historical_requested_by uuid;
alter table public.agency_prospects add column if not exists historical_requested_at timestamptz;
alter table public.agency_prospects add column if not exists historical_request_note text check (char_length(historical_request_note) <= 2000);
alter table public.agency_prospects add column if not exists historical_reviewed_by uuid;
alter table public.agency_prospects add column if not exists historical_reviewed_at timestamptz;
alter table public.agency_prospects add column if not exists historical_reason text check (char_length(historical_reason) <= 2000);
alter table public.agency_prospects add column if not exists historical_evidence text check (char_length(historical_evidence) <= 2000);
alter table public.agency_prospects add column if not exists historical_original_date date;
create index if not exists agency_prospects_historical_status on public.agency_prospects (historical_status) where historical_status is not null;

-- Onboarded agencies keep their classification: imported/historical ones were already marked.
update public.agency_prospects set onboarding_type = case when historical_onboarded then 'historical' else 'normal' end
where stage = 'onboarded' and onboarding_type is null;

/** Why an agency cannot go through historical onboarding (null = it can). */
create or replace function public.historical_onboarding_block(p_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when a.id is null then 'Agency not found'
    when a.stage = 'onboarded' then 'This agency is already onboarded'
    when g.status in ('submitted', 'in_review', 'approved', 'activated') then 'This agency is going through the new registration process — finish it there'
    else null end
  from (select p_id as id) x
  left join public.agency_prospects a on a.id = x.id
  left join public.partner_registrations g on g.id = a.registration_id;
$$;
revoke all on function public.historical_onboarding_block(uuid) from public, anon;
grant execute on function public.historical_onboarding_block(uuid) to authenticated;

create or replace function public.request_historical_onboarding(p_id uuid, p_note text, p_evidence text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare blocked text; a record;
begin
  if not public.agency_can_see(p_id) then raise exception 'Not allowed to update this agency'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'Explain how and when this agency was onboarded (at least 10 characters)'; end if;
  blocked := public.historical_onboarding_block(p_id);
  if blocked is not null then raise exception '%', blocked; end if;
  select * into a from public.agency_prospects where id = p_id for update;
  if a.historical_status = 'requested' then raise exception 'A historical onboarding review is already requested'; end if;
  update public.agency_prospects set historical_status = 'requested', historical_requested_by = auth.uid(), historical_requested_at = now(),
    historical_request_note = btrim(p_note), historical_evidence = coalesce(nullif(btrim(coalesce(p_evidence, '')), ''), historical_evidence), updated_at = now()
  where id = p_id;
  perform public.agency_log(p_id, 'historical_requested', btrim(p_note), jsonb_build_object('evidence', nullif(btrim(coalesce(p_evidence, '')), '')));
  perform public.notify(public.registration_managers(), 'partner', 'Historical onboarding review requested',
                        coalesce(a.company_name, a.reference) || ' · ' || a.reference, 'agencies/' || p_id);
end $$;

-- Approve / flag / decline one or many agencies (admin reconciliation).
create or replace function public.review_historical_onboarding(p_ids uuid[], p_decision text, p_reason text, p_evidence text default null, p_original_date date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i uuid; blocked text; done jsonb := '[]'; skipped jsonb := '[]'; a record; rec jsonb := null;
begin
  if not public.can_manage_registrations() then raise exception 'Only authorised administrators can approve historical onboarding'; end if;
  if p_decision not in ('approve', 'flag', 'decline') then raise exception 'Unknown decision'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'Give the reason (at least 10 characters)'; end if;
  if coalesce(cardinality(p_ids), 0) = 0 or cardinality(p_ids) > 200 then raise exception 'Select between 1 and 200 agencies'; end if;
  if p_original_date is not null and p_original_date > public.company_today() then raise exception 'The original onboarding date cannot be in the future'; end if;
  -- Administrative correction: nothing here is anyone's daily work.
  perform set_config('ssi.historical_reconciliation', 'on', true);
  foreach i in array (select array_agg(distinct x) from unnest(p_ids) x) loop
    select * into a from public.agency_prospects where id = i for update;
    blocked := public.historical_onboarding_block(i);
    if blocked is not null then
      skipped := skipped || jsonb_build_object('id', i, 'name', coalesce(a.company_name, a.reference, i::text), 'reason', blocked);
      continue;
    end if;
    if p_decision = 'approve' then
      update public.agency_prospects set stage = 'onboarded', stage_changed_by = auth.uid(), stage_changed_at = now(),
        onboarding_type = 'historical', historical_onboarded = true, historical_status = 'approved',
        historical_reviewed_by = auth.uid(), historical_reviewed_at = now(), historical_reason = btrim(p_reason),
        historical_evidence = coalesce(nullif(btrim(coalesce(p_evidence, '')), ''), historical_evidence),
        historical_original_date = coalesce(p_original_date, historical_original_date), updated_at = now()
      where id = i;
      perform public.agency_log(i, 'historical_approved', btrim(p_reason),
        jsonb_build_object('from', a.stage, 'to', 'onboarded', 'original_date', p_original_date, 'evidence', nullif(btrim(coalesce(p_evidence, '')), '')));
    else
      update public.agency_prospects set historical_status = case when p_decision = 'flag' then 'flagged' else 'declined' end,
        historical_reviewed_by = auth.uid(), historical_reviewed_at = now(), historical_reason = btrim(p_reason),
        needs_reconciliation = case when p_decision = 'flag' then true else needs_reconciliation end,
        reconciliation_note = case when p_decision = 'flag' then 'Historical onboarding: ' || btrim(p_reason) else reconciliation_note end, updated_at = now()
      where id = i;
      perform public.agency_log(i, case when p_decision = 'flag' then 'historical_flagged' else 'historical_declined' end, btrim(p_reason), '{}'::jsonb);
    end if;
    insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, changes)
    values (auth.uid(), case when public.is_super_admin() then 'super_admin' else 'partner_onboarding' end, 'historical_onboarding_' || p_decision, 'agency_prospects', i::text,
            jsonb_build_object('reference', a.reference, 'name', a.company_name, 'from_stage', a.stage, 'reason', btrim(p_reason), 'original_date', p_original_date));
    done := done || jsonb_build_object('id', i, 'name', coalesce(a.company_name, a.reference));
  end loop;
  -- Super Admin: link to the client record now (existing reconciliation; exact matches only, no logins).
  if p_decision = 'approve' and jsonb_array_length(done) > 0 and public.is_super_admin() then
    rec := public.reconcile_historical_onboarded(true);
  end if;
  perform set_config('ssi.historical_reconciliation', '', true);
  return jsonb_build_object('decision', p_decision, 'done', done, 'skipped', skipped, 'reconciliation', rec);
end $$;

/** Admin preview before approving: status, proposals, registration and possible duplicate partners. */
create or replace function public.preview_historical_onboarding(p_ids uuid[])
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'reference', a.reference, 'name', a.company_name, 'contact', a.contact_name, 'stage', a.stage, 'source', a.source,
    'agency_type', a.agency_type, 'historical_onboarded', a.historical_onboarded, 'historical_status', a.historical_status,
    'request_note', a.historical_request_note, 'evidence', a.historical_evidence, 'created_at', a.created_at,
    'proposals', (select count(*) from public.agency_proposals p where p.prospect_id = a.id),
    'proposal_status', (select p.status from public.agency_proposals p where p.prospect_id = a.id order by p.created_at desc limit 1),
    'proposal_confirmed_at', (select max(p.confirmed_at) from public.agency_proposals p where p.prospect_id = a.id),
    'mous', (select count(*) from public.agency_mous m where m.prospect_id = a.id),
    'registration_status', (select g.status from public.partner_registrations g where g.id = a.registration_id),
    'linked_partner', (select o.name from public.partners o where o.id = a.partner_id),
    'possible_partners', (select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name)) from public.partners o
                          where o.archived_at is null and not exists (select 1 from public.agency_prospects x where x.partner_id = o.id)
                            and ((a.email is not null and lower(o.email) = lower(a.email))
                              or (public.agency_name_key(o.name) = public.agency_name_key(a.company_name)))),
    'blocked', public.historical_onboarding_block(a.id)) order by a.company_name), '[]')
  from public.agency_prospects a
  where a.id = any (p_ids) and public.can_manage_registrations();
$$;

do $$
declare f text;
begin
  foreach f in array array['request_historical_onboarding(uuid, text, text)', 'review_historical_onboarding(uuid[], text, text, text, date)',
                           'preview_historical_onboarding(uuid[])'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
