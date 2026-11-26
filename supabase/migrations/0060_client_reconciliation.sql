-- 0060_client_reconciliation.sql — run after 0059_record_tasks_escalation.sql
-- (Supabase SQL Editor: Save this query as "0060_client_reconciliation")
--
-- Historically onboarded agencies in Clients & Branches, and a clear view of where a normal
-- onboarding is blocked.
--
-- Why an agency like "Algate" is missing: the Agency List shows "Onboarded (historical)" for an
-- agency with stage = 'onboarded' and NO partner record (agency_prospects.partner_id is null).
-- Clients & Branches lists partner organisations; such an agency only appears in the separate
-- "Onboarded — needs review" block, never in the client list or its search. The existing fixes do not
-- reach it: review_historical_onboarding() refuses agencies that are already onboarded, and the bulk
-- reconcile_historical_onboarded() runs only as a side effect of a Super Admin approval.
--
-- 1. client_reconciliation_preview(ids)   what reconciliation would do per agency, nothing changed:
--      none (already linked) · link (exactly one existing partner matches by email / phone / name) ·
--      create (no match: a historical client record without login) · conflict (several or possible
--      matches, or name / contact missing — an administrator decides).
-- 2. reconcile_agencies_to_clients(ids, reason, partner)  Super Admin or registration managers.
--      Applies exactly the previewed action, idempotent (an advisory lock and partner_id checks: running
--      it twice links or creates nothing more), keeps the agency, its officers and history, records
--      who / when / why as the historical approval when none was recorded, creates no login, sends no
--      email, and records no employee work (administrative correction, not today's onboarding).
--      For a conflict, an administrator may pass the partner to link to explicitly.
-- 3. agency_onboarding_progress(id)  every step of the agency's onboarding (Path A historical or
--      Path B proposal → registration → agreement → review → countersign → approval → client →
--      portal) with done / current / blocked and the exact blocking reason recorded in the CRM
--      (e.g. no MOU document published, email failed, no approved agreement template, Annexure A
--      missing, waiting for the partner's signed upload). Read-only.
-- Safe to run more than once.

-- =============================================================== plan for one agency
create or replace function public.client_reconcile_plan(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a record; n int; cand jsonb; pid text; close_cand jsonb;
begin
  select * into a from public.agency_prospects where id = p_id;
  if a.id is null then return jsonb_build_object('action', 'conflict', 'reason', 'Agency not found'); end if;
  if a.partner_id is not null then
    return jsonb_build_object('action', 'none', 'partner_id', a.partner_id, 'partner_name', (select name from public.partners where id = a.partner_id),
                              'reason', 'Already linked to its client record — no change needed');
  end if;
  if a.stage <> 'onboarded' then
    return jsonb_build_object('action', 'conflict', 'reason', 'Not onboarded (stage: ' || replace(a.stage, '_', ' ') || '). Approve historical onboarding first, or complete the registration.');
  end if;
  -- Exact matches only (same rule as reconcile_historical_onboarded): email, phone (last 10 digits) or name.
  select count(*), jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name)), min(o.id) into n, cand, pid
  from public.partners o
  where o.archived_at is null and not o.internal and not exists (select 1 from public.agency_prospects x where x.partner_id = o.id)
    and ((a.email is not null and lower(o.email) = lower(a.email))
      or (char_length(coalesce(public.agency_digits(a.phone), '')) >= 8 and char_length(coalesce(public.agency_digits(o.phone), '')) >= 8
          and right(public.agency_digits(o.phone), 10) = right(public.agency_digits(a.phone), 10))
      or (public.agency_name_key(o.name) = public.agency_name_key(a.company_name)));
  if n > 1 then return jsonb_build_object('action', 'conflict', 'reason', 'Several client records match — choose the right one', 'candidates', cand); end if;
  if n = 1 then return jsonb_build_object('action', 'link', 'partner_id', pid, 'partner_name', cand -> 0 ->> 'name', 'reason', 'Links to the existing client record (exact match)'); end if;
  select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name)) into close_cand from public.partners o
  where o.archived_at is null and not o.internal and not exists (select 1 from public.agency_prospects x where x.partner_id = o.id)
    and public.agency_suggest_key(o.name) is not null and public.agency_suggest_key(a.company_name) is not null
    and (public.agency_suggest_key(o.name) = public.agency_suggest_key(a.company_name)
      or (length(public.agency_suggest_key(o.name)) >= 5 and public.agency_suggest_key(a.company_name) like public.agency_suggest_key(o.name) || '%')
      or (length(public.agency_suggest_key(a.company_name)) >= 5 and public.agency_suggest_key(o.name) like public.agency_suggest_key(a.company_name) || '%'));
  if close_cand is not null then
    return jsonb_build_object('action', 'conflict', 'reason', 'Possible match with ' || (close_cand -> 0 ->> 'name') || ' — confirm it is the same company, or create a new client record', 'candidates', close_cand);
  end if;
  if a.company_name is null then return jsonb_build_object('action', 'conflict', 'reason', 'Agency name missing — add it in the Agency List first'); end if;
  if a.contact_name is null then return jsonb_build_object('action', 'conflict', 'reason', 'Point of contact missing — add it in the Agency List first'); end if;
  return jsonb_build_object('action', 'create', 'reason', 'Creates its client record in Clients & Branches (business onboarded, no portal login)');
end $$;
revoke all on function public.client_reconcile_plan(uuid) from public, anon, authenticated;

-- =============================================================== preview (admin)
-- p_ids null: every onboarded agency that is not in Clients & Branches yet.
create or replace function public.client_reconciliation_preview(p_ids uuid[] default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'reference', a.reference, 'name', a.company_name, 'contact', a.contact_name, 'email', a.email, 'country', a.country,
      'agency_type', a.agency_type, 'stage', a.stage, 'onboarding_type', a.onboarding_type, 'historical_onboarded', a.historical_onboarded,
      'historical_status', a.historical_status, 'source_status', a.source_status, 'assigned_officer', a.assigned_officer, 'sub_officer', a.sub_officer,
      'registration_status', (select g.status from public.partner_registrations g where g.id = a.registration_id),
      'linked_partner', a.partner_id,
      'plan', public.client_reconcile_plan(a.id)) order by a.company_name nulls last, a.reference), '[]')
  from public.agency_prospects a
  where public.can_manage_registrations()
    and ((p_ids is null and a.stage = 'onboarded' and a.partner_id is null) or a.id = any (coalesce(p_ids, '{}')));
$$;

-- =============================================================== apply (admin, idempotent)
create or replace function public.reconcile_agencies_to_clients(p_ids uuid[], p_reason text, p_partner text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i uuid; a record; plan jsonb; act text; pid text; v_code text;
        linked jsonb := '[]'; created jsonb := '[]'; unchanged jsonb := '[]'; skipped jsonb := '[]';
begin
  if not public.can_manage_registrations() then raise exception 'Only authorised administrators can reconcile clients'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'Give the reason / evidence (at least 10 characters)'; end if;
  if coalesce(cardinality(p_ids), 0) = 0 or cardinality(p_ids) > 200 then raise exception 'Select between 1 and 200 agencies'; end if;
  if p_partner is not null and cardinality(p_ids) <> 1 then raise exception 'Choose the client record for one agency at a time'; end if;
  perform pg_advisory_xact_lock(hashtext('historical-onboarding'));
  -- Administrative correction: no employee work is recorded for anything created here.
  perform set_config('ssi.historical_reconciliation', 'on', true);
  foreach i in array (select array_agg(distinct x) from unnest(p_ids) x) loop
    select * into a from public.agency_prospects where id = i for update;
    plan := public.client_reconcile_plan(i);
    act := plan ->> 'action';
    if act = 'none' then
      unchanged := unchanged || jsonb_build_object('id', i, 'name', coalesce(a.company_name, a.reference), 'partner', plan ->> 'partner_name');
      continue;
    end if;
    if p_partner is not null and a.stage = 'onboarded' and a.partner_id is null then
      -- An administrator's explicit choice for a conflict: the record must exist and not belong to another agency.
      if not exists (select 1 from public.partners o where o.id = p_partner and o.archived_at is null and not o.internal) then raise exception 'Client record not found'; end if;
      if exists (select 1 from public.agency_prospects x where x.partner_id = p_partner and x.id <> i) then raise exception 'That client record already belongs to another agency'; end if;
      act := 'link'; pid := p_partner;
    elsif act = 'link' then
      pid := plan ->> 'partner_id';
    elsif act <> 'create' then
      skipped := skipped || jsonb_build_object('id', i, 'name', coalesce(a.company_name, a.reference, i::text), 'reason', plan ->> 'reason');
      continue;
    end if;
    if act = 'create' then
      v_code := 'H' || upper(substr(md5(a.id::text), 1, 6));
      while exists (select 1 from public.partners o where o.code = v_code) loop v_code := 'H' || upper(substr(md5(v_code || random()::text), 1, 6)); end loop;
      insert into public.partners (name, code, contact_name, email, phone, country, status, tier, portal_enabled, commission_visible, joined_at,
        partnership_officer_id, onboarding_source, historical_since, agency_type)
      values (a.company_name, v_code, a.contact_name, coalesce(lower(a.email), ''), a.phone, a.country, 'Active', 'Silver', false, false,
        coalesce(a.historical_original_date::timestamptz, a.created_at),
        case when exists (select 1 from public.employees e where e.id = a.assigned_officer) then a.assigned_officer end, 'historical', now(), a.agency_type)
      returning id into pid;
      created := created || jsonb_build_object('id', i, 'name', a.company_name, 'partner_id', pid);
    else
      update public.partners set partnership_officer_id = coalesce(partnership_officer_id, case when exists (select 1 from public.employees e where e.id = a.assigned_officer) then a.assigned_officer end),
        agency_type = coalesce(agency_type, a.agency_type)
      where id = pid;
      linked := linked || jsonb_build_object('id', i, 'name', a.company_name, 'partner_id', pid, 'partner', (select name from public.partners where id = pid));
    end if;
    -- The agency keeps everything; it gains its client record. The historical approval is recorded
    -- (who / when / why) only if none was recorded before — earlier evidence is kept as it is.
    update public.agency_prospects set partner_id = pid, needs_reconciliation = false,
      reconciliation_note = case when act = 'create' then 'Client record created in Clients & Branches (no login yet)' else 'Linked to the existing client record' end,
      onboarding_type = coalesce(onboarding_type, 'historical'),
      historical_status = case when historical_status is null or historical_status in ('requested', 'flagged') then 'approved' else historical_status end,
      historical_reviewed_by = case when historical_status is null or historical_status in ('requested', 'flagged') then auth.uid() else historical_reviewed_by end,
      historical_reviewed_at = case when historical_status is null or historical_status in ('requested', 'flagged') then now() else historical_reviewed_at end,
      historical_reason = coalesce(historical_reason, btrim(p_reason)),
      updated_at = now()
    where id = i;
    perform public.agency_log(i, 'reconciled', btrim(p_reason), jsonb_build_object('partner_id', pid, 'match', case when act = 'create' then 'created' when p_partner is not null then 'chosen' else 'exact' end));
    insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, partner_id, changes)
    values (auth.uid(), case when public.is_super_admin() then 'super_admin' else 'partner_onboarding' end, 'client_reconciled', 'agency_prospects', i::text, pid,
            jsonb_build_object('reference', a.reference, 'name', a.company_name, 'action', act, 'reason', btrim(p_reason)));
  end loop;
  perform set_config('ssi.historical_reconciliation', '', true);
  return jsonb_build_object('linked', linked, 'created', created, 'unchanged', unchanged, 'skipped', skipped);
end $$;

-- =============================================================== onboarding progress (read-only)
create or replace function public.agency_onboarding_progress(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a record; p record; g record; ag record; em_mou record; em_reg record; o record; users int := 0; steps jsonb := '[]';
        historical boolean; tpl boolean; mou_doc boolean;
  -- step(key, label, state, detail): state done | current | blocked | waiting | skipped
begin
  if not public.agency_can_see(p_id) then raise exception 'Not allowed to view this agency'; end if;
  select * into a from public.agency_prospects where id = p_id;
  select * into p from public.agency_proposals where prospect_id = p_id order by created_at desc limit 1;
  select * into g from public.partner_registrations where id = a.registration_id;
  select * into ag from public.registration_agreements where registration_id = a.registration_id;
  select * into em_mou from public.agency_emails where prospect_id = p_id and kind = 'mou';
  select * into em_reg from public.agency_emails where prospect_id = p_id and kind = 'registration';
  select * into o from public.partners where id = a.partner_id;
  if o.id is not null then select count(*) into users from public.profiles where partner_id = o.id and status = 'active'; end if;
  historical := a.onboarding_type = 'historical' or a.historical_onboarded or (a.stage = 'onboarded' and a.registration_id is null);
  mou_doc := exists (select 1 from public.mou_documents where active);

  if historical then
    steps := steps || jsonb_build_object('key', 'historical', 'label', 'Historical onboarding verified',
      'state', case when a.historical_status = 'approved' or a.partner_id is not null then 'done' when a.historical_status = 'declined' then 'blocked'
                    when a.stage = 'onboarded' then 'current' else 'waiting' end,
      'detail', case when a.historical_status = 'approved' then 'Approved ' || to_char(a.historical_reviewed_at at time zone public.company_tz(), 'DD Mon YYYY')
                     when a.historical_status = 'declined' then 'Declined: ' || coalesce(a.historical_reason, '')
                     when a.historical_status = 'flagged' then 'Flagged for verification: ' || coalesce(a.historical_reason, '')
                     when a.historical_status = 'requested' then 'Review requested — waiting for an administrator'
                     when a.stage = 'onboarded' then 'Imported as onboarded — an administrator verifies it by reconciling it to Clients & Branches'
                     else 'Not onboarded' end);
  else
    steps := steps || jsonb_build_object('key', 'proposal_sent', 'label', 'Partnership proposal sent',
      'state', case when p.id is null then 'current' when p.status in ('sent', 'awaiting_confirmation', 'confirmed') or p.email_status in ('accepted', 'delivered') then 'done'
                    when p.status = 'delivery_failed' or p.email_status = 'failed' then 'blocked' when p.status in ('declined', 'expired', 'cancelled') then 'blocked' else 'current' end,
      'detail', case when p.id is null then 'No proposal yet'
                     when p.status = 'delivery_failed' or p.email_status = 'failed' then 'Proposal email failed: ' || coalesce(p.email_detail, 'no detail') || ' — use Send Proposal again'
                     when p.status in ('draft', 'pending_approval', 'sending') then 'Proposal ' || replace(p.status, '_', ' ')
                     when p.status in ('declined', 'expired', 'cancelled') then 'Proposal ' || p.status
                     else 'Sent ' || coalesce(to_char(p.sent_at at time zone public.company_tz(), 'DD Mon YYYY HH24:MI'), '') ||
                          case when p.email_status = 'delivered' then ' · delivered' when p.email_status = 'accepted' then ' · accepted by the email service' else '' end end);
    steps := steps || jsonb_build_object('key', 'proposal_confirmed', 'label', 'Proposal confirmed by the agency',
      'state', case when p.confirmed_at is not null then 'done' when p.id is not null and p.status in ('sent', 'awaiting_confirmation') then 'current' else 'waiting' end,
      'detail', case when p.confirmed_at is not null then 'Confirmed ' || to_char(p.confirmed_at at time zone public.company_tz(), 'DD Mon YYYY HH24:MI')
                     when p.id is not null and p.status in ('sent', 'awaiting_confirmation') then 'Waiting for the agency to open the proposal link and confirm' else null end);
    steps := steps || jsonb_build_object('key', 'mou_email', 'label', 'MOU email',
      'state', case when em_mou.status in ('accepted', 'delivered') then 'done' when em_mou.status in ('failed', 'not_configured') then 'blocked'
                    when p.confirmed_at is not null then 'current' else 'waiting' end,
      'detail', case when em_mou.status = 'delivered' then 'Delivered'
                     when em_mou.status = 'accepted' then 'Accepted by the email service (delivery not reported yet)'
                     when em_mou.status = 'not_configured' then 'Not sent: no MOU document is published — publish it in Agencies → Proposal terms & settings, then use Resend'
                     when em_mou.status = 'failed' then 'Failed: ' || coalesce(em_mou.detail, 'no detail') || ' — use Resend'
                     when p.confirmed_at is not null then case when mou_doc then 'No send attempt recorded — use Resend' else 'No MOU document is published' end
                     else 'Sent after the proposal is confirmed' end);
    steps := steps || jsonb_build_object('key', 'registration_invited', 'label', 'Registration link issued and emailed',
      'state', case when g.id is not null and coalesce(em_reg.status, '') in ('accepted', 'delivered') then 'done'
                    when g.id is not null and g.status not in ('link_generated') then 'done'
                    when em_reg.status = 'failed' then 'blocked' when g.id is not null then 'current' when p.confirmed_at is not null then 'blocked' else 'waiting' end,
      'detail', case when em_reg.status = 'failed' then 'Registration email failed: ' || coalesce(em_reg.detail, 'no detail') || ' — use Resend'
                     when g.id is null and p.confirmed_at is not null then 'Confirmed, but no registration was issued — an administrator issues it from Partner Registrations'
                     when g.id is not null then 'Registration ' || g.reference || coalesce(' · email ' || em_reg.status, '') ||
                          case when g.link_expires_at < now() and g.status in ('link_generated', 'in_progress') then ' · link expired — use Resend' else '' end
                     else null end);
    steps := steps || jsonb_build_object('key', 'registration_submitted', 'label', 'Registration completed by the partner',
      'state', case when g.status in ('submitted', 'in_review', 'approved', 'activated') then 'done' when g.status = 'changes_requested' then 'current'
                    when g.status = 'rejected' then 'blocked' when g.id is not null then 'current' else 'waiting' end,
      'detail', case when g.submitted_at is not null then 'Submitted ' || to_char(g.submitted_at at time zone public.company_tz(), 'DD Mon YYYY HH24:MI')
                     when g.status = 'changes_requested' then 'Changes requested — waiting for the partner'
                     when g.first_opened_at is not null then 'Opened ' || to_char(g.first_opened_at at time zone public.company_tz(), 'DD Mon YYYY') || ', not submitted yet'
                     when g.id is not null then 'Link not opened yet' else null end);
    if g.id is not null and not g.agreement_required then
      steps := steps || jsonb_build_object('key', 'agreement', 'label', 'Partnership Agreement', 'state', 'skipped', 'detail', 'Not required for this registration (issued before agreements were introduced)');
    else
      tpl := exists (select 1 from public.agreement_templates t where t.status = 'approved' and t.agency_type = coalesce(ag.agency_type, a.agency_type));
      steps := steps || jsonb_build_object('key', 'agreement_issued', 'label', 'Agreement available to the partner',
        'state', case when ag.status in ('ready', 'partner_signed', 'pending_review', 'changes_requested', 'approved_for_countersign', 'countersigned', 'sent', 'completed') then 'done'
                      when ag.status in ('template_missing', 'annexure_missing') or (g.id is not null and (a.agency_type is null or not tpl)) then 'blocked'
                      when g.id is not null then 'current' else 'waiting' end,
        'detail', case when ag.status = 'annexure_missing' then 'Annexure A (commission rates) is missing — attach it in Partner Registrations → Agreement'
                       when a.agency_type is null and g.id is not null then 'Agency type not set — classify the agency as Domestic or International'
                       when (ag.status = 'template_missing' or g.id is not null) and not tpl then 'No approved ' || coalesce(ag.agency_type, a.agency_type, '') || ' agreement template — a Super Admin uploads and approves it'
                       when ag.status = 'not_generated' or (g.id is not null and ag.registration_id is null) then 'Generated when the partner opens the registration'
                       when ag.status is not null then 'Agreement ' || replace(ag.status, '_', ' ') else null end);
      steps := steps || jsonb_build_object('key', 'partner_signed', 'label', 'Partner-signed agreement uploaded',
        'state', case when ag.status in ('pending_review', 'approved_for_countersign', 'countersigned', 'sent', 'completed') then 'done'
                      when ag.status in ('ready', 'partner_signed', 'changes_requested') then 'current' when ag.status = 'rejected' then 'blocked' else 'waiting' end,
        'detail', case when ag.status = 'changes_requested' then 'Changes requested — waiting for a corrected upload'
                       when ag.status = 'ready' then 'Waiting for the partner to download, sign and upload the PDF'
                       when ag.status = 'partner_signed' then 'Uploaded — waiting for the partner to submit the registration' else null end);
      steps := steps || jsonb_build_object('key', 'ssi_review', 'label', 'SSI GLOBAL review',
        'state', case when ag.status in ('approved_for_countersign', 'countersigned', 'sent', 'completed') then 'done' when ag.status = 'pending_review' then 'current'
                      when ag.status = 'rejected' then 'blocked' else 'waiting' end,
        'detail', case when ag.status = 'pending_review' then 'Waiting for a registration manager to review the signed PDF' when ag.status = 'rejected' then 'Agreement rejected' else null end);
      steps := steps || jsonb_build_object('key', 'countersigned', 'label', 'Countersigned by SSI GLOBAL',
        'state', case when ag.countersigned_at is not null then 'done' when ag.status = 'approved_for_countersign' then 'current' else 'waiting' end,
        'detail', case when ag.countersigned_at is not null then 'Countersigned ' || to_char(ag.countersigned_at at time zone public.company_tz(), 'DD Mon YYYY')
                       when ag.status = 'approved_for_countersign' then 'Waiting for an authorised signatory to upload the countersigned PDF' else null end);
      steps := steps || jsonb_build_object('key', 'final_sent', 'label', 'Final agreement sent to the partner',
        'state', case when ag.sent_at is not null and coalesce(ag.email_status, 'accepted') = 'accepted' then 'done'
                      when ag.email_status in ('failed', 'not_configured') then 'blocked' when ag.countersigned_at is not null then 'current' else 'waiting' end,
        'detail', case when ag.email_status = 'failed' then 'Email failed: ' || coalesce(ag.email_detail, 'no detail') || ' — send it again'
                       when ag.email_status = 'not_configured' then 'Email service not configured' when ag.sent_at is not null then 'Sent ' || to_char(ag.sent_at at time zone public.company_tz(), 'DD Mon YYYY') else null end);
    end if;
    steps := steps || jsonb_build_object('key', 'approved', 'label', 'Registration approved',
      'state', case when g.status in ('approved', 'activated') then 'done' when g.status in ('submitted', 'in_review') then 'current' when g.status = 'rejected' then 'blocked' else 'waiting' end,
      'detail', case when g.reviewed_at is not null and g.status in ('approved', 'activated', 'rejected') then initcap(g.status) || ' ' || to_char(g.reviewed_at at time zone public.company_tz(), 'DD Mon YYYY')
                     when g.status in ('submitted', 'in_review') then 'Waiting for administrator review' else null end);
  end if;
  steps := steps || jsonb_build_object('key', 'onboarded', 'label', 'Business onboarded',
    'state', case when a.stage = 'onboarded' then 'done' else 'waiting' end,
    'detail', case when a.stage = 'onboarded' then coalesce(case when historical then 'Historical' else 'Through registration' end, '') else null end);
  steps := steps || jsonb_build_object('key', 'client', 'label', 'In Clients & Branches',
    'state', case when a.partner_id is not null then 'done' when a.stage = 'onboarded' then 'blocked' else 'waiting' end,
    'detail', case when a.partner_id is not null then o.name || case when o.onboarding_source = 'historical' then ' (historical client record)' else '' end
                   when a.stage = 'onboarded' then 'Onboarded but not linked to a client record — an administrator uses "Reconcile to Clients & Branches"' else null end);
  steps := steps || jsonb_build_object('key', 'portal', 'label', 'Partner portal access',
    'state', case when users > 0 and o.portal_enabled then 'done' when a.partner_id is not null then 'current' else 'waiting' end,
    'detail', case when users > 0 and o.portal_enabled then users || ' active login' || case when users = 1 then '' else 's' end
                   when a.partner_id is not null then 'Not activated — separate from business onboarding; only an administrator provisions it' else null end);
  return jsonb_build_object('agency_id', p_id, 'path', case when historical then 'historical' else 'normal' end, 'steps', steps);
end $$;

do $$
declare f text;
begin
  foreach f in array array['client_reconciliation_preview(uuid[])', 'reconcile_agencies_to_clients(uuid[], text, text)', 'agency_onboarding_progress(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
