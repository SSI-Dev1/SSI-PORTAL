-- 0063_normal_onboarding.sql — run after 0062_historical_verify.sql
-- (Supabase SQL Editor: Save this query as "0063_normal_onboarding")
--
-- Normal partner onboarding, end to end, without manual transfers:
-- proposal accepted → registration link (+ Partnership Agreement / MOU in the form) → partner signs and
-- uploads → submits → SSI review → countersigning → final approval → client record in Clients &
-- Partnerships (business onboarded, portal access separate).
--
-- What was wrong
-- 1. The MOU never reached the partner when the agreement could not be issued: no approved template for
--    the agency type, the agency type not set, or Annexure A (commission rates) not uploaded by staff.
--    The agreement then stayed "template_missing" / "annexure_missing" and nobody was told.
--    → The partner-registration function now builds Annexure A from the accepted proposal's confirmed
--      rates; every blocked agreement notifies the registration managers with the exact reason.
-- 2. The partner could still submit the registration with no agreement at all (the signed copy was only
--    required once an agreement existed). The approval then could never complete: activation refused it
--    (AGREEMENT_INCOMPLETE), so the agency stayed "Approved" and never reached Clients & Partnerships.
--    → submit_partner_registration refuses AGREEMENT_NOT_READY until the agreement is issued and signed.
-- 3. Business onboarding waited for a Super Admin to create the Partner Admin LOGIN ("Approve & Create
--    Partner"). Without that, an approved, countersigned agency never appeared in Clients & Partnerships.
--    → complete_registration_onboarding(): as soon as the registration is approved AND the agreement is
--      countersigned (or none is required), the client record is linked (exact single match, never one
--      owned by another agency or registration) or created from the registration (no login, no password,
--      no email, portal off). The registration becomes "activated" without a Partner Admin; the existing
--      trigger then marks the agency Onboarded, links it and credits the proposal sender once
--      (dedupe key agency-onboarded:<id>). Runs automatically from the approval and from the
--      countersignature; onboard_registration(id) lets a manager retry. Several matches → nothing linked,
--      the managers are notified to decide.
-- Portal access stays a separate step (Clients & Partnerships → partner account).
-- Safe to run more than once.

-- =============================================================== submit: the agreement is part of the submission
create or replace function public.submit_partner_registration(p_token text, p_answers jsonb, p_form_version text, p_idempotency text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; rev int; ag record;
begin
  select * into r from public.partner_registrations where token_hash = public.registration_token_hash(p_token) for update;
  if r.id is null or r.link_status = 'revoked' then raise exception 'LINK_UNUSABLE'; end if;
  if p_idempotency is not null and r.last_idempotency_key = p_idempotency and r.status in ('submitted', 'in_review') then
    return jsonb_build_object('reference', r.reference, 'duplicate', true);
  end if;
  if r.link_status <> 'active' or r.link_expires_at < now() or r.status not in ('link_generated', 'in_progress', 'changes_requested') then
    raise exception 'LINK_UNUSABLE';
  end if;
  if r.agreement_required then
    select * into ag from public.registration_agreements where registration_id = r.id for update;
    -- No agreement issued yet (no template / type / Annexure A, or never generated): it cannot be skipped.
    if ag.registration_id is null or ag.status in ('not_generated', 'template_missing', 'annexure_missing') then
      raise exception 'AGREEMENT_NOT_READY';
    end if;
    if ag.status in ('ready', 'partner_signed', 'changes_requested') then
      if not exists (select 1 from public.registration_agreement_files f where f.registration_id = r.id and f.kind = 'partner_signed'
                     and f.superseded_at is null and coalesce(f.review_status, 'pending') = 'pending') then
        raise exception 'AGREEMENT_REQUIRED';
      end if;
      update public.registration_agreements set status = 'pending_review', updated_at = now() where registration_id = r.id;
    end if;
  end if;
  rev := r.submission_count + 1;
  insert into public.partner_registration_revisions (registration_id, revision, form_version, answers, files) values (r.id, rev, p_form_version, p_answers, r.files);
  update public.partner_registrations set answers = p_answers, form_version = p_form_version, status = 'submitted', submitted_at = now(),
    submission_count = rev, last_idempotency_key = p_idempotency where id = r.id;
  insert into public.partner_registration_events (registration_id, actor, action, detail)
  values (r.id, null, case when rev = 1 then 'submitted' else 'resubmitted' end, jsonb_build_object('revision', rev));
  perform public.notify(public.registration_managers(), 'partner', case when rev = 1 then 'New partner registration' else 'Partner registration corrected' end,
                        r.company_name || ' · ' || r.reference, 'partners/registrations');
  return jsonb_build_object('reference', r.reference, 'duplicate', false, 'revision', rev);
end $$;
revoke all on function public.submit_partner_registration(text, jsonb, text, text) from public, anon, authenticated;

-- =============================================================== a blocked agreement is never silent
create or replace function public.agreement_blocked_notice()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record; why text;
begin
  if new.status not in ('template_missing', 'annexure_missing') or (tg_op = 'UPDATE' and old.status is not distinct from new.status) then return null; end if;
  select reference, company_name into r from public.partner_registrations where id = new.registration_id;
  why := case when new.status = 'annexure_missing' then 'Annexure A (commission rates) is missing and there is no accepted proposal to build it from — upload it on the registration'
              when new.agency_type is null then 'The agency type (Domestic / International) is not set — set it in the Agency List'
              else 'No approved ' || new.agency_type || ' agreement template — a Super Admin approves one in Partnership Agreement templates' end;
  insert into public.partner_registration_events (registration_id, actor, action, detail)
  values (new.registration_id, null, 'agreement_blocked', jsonb_build_object('status', new.status, 'reason', why));
  perform public.notify(public.registration_managers(), 'partner', 'Partnership Agreement not available', coalesce(r.company_name, '') || ' · ' || coalesce(r.reference, '') || ' — ' || why,
                        'partners/registrations');
  return null;
end $$;
drop trigger if exists registration_agreements_blocked on public.registration_agreements;
create trigger registration_agreements_blocked after insert or update of status on public.registration_agreements
  for each row execute function public.agreement_blocked_notice();

-- =============================================================== approved + countersigned → client record
drop function if exists public.complete_registration_onboarding(uuid);
create or replace function public.complete_registration_onboarding(p_id uuid, p_partner text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; a record; ag text; v_pid text; n int; cand jsonb; v_code text; v_email text; v_phone text; v_contact text; act text;
        v_prev text := coalesce(current_setting('ssi.historical_reconciliation', true), '');
begin
  perform pg_advisory_xact_lock(hashtext('registration-onboarding:' || p_id));
  select * into r from public.partner_registrations where id = p_id for update;
  if r.id is null then return jsonb_build_object('state', 'not_found'); end if;
  if r.partner_id is not null or r.status = 'activated' then return jsonb_build_object('state', 'already', 'partner_id', r.partner_id); end if;
  if r.status <> 'approved' then return jsonb_build_object('state', 'not_approved'); end if;
  if r.agreement_required then
    select status into ag from public.registration_agreements where registration_id = p_id;
    if coalesce(ag, '') not in ('countersigned', 'sent', 'completed') then return jsonb_build_object('state', 'awaiting_countersignature', 'agreement', ag); end if;
  end if;
  select * into a from public.agency_prospects where registration_id = p_id limit 1 for update;
  v_email := lower(nullif(btrim(coalesce(r.answers ->> 'company_email', a.email, r.answers ->> 'contact_email', r.intended_email, '')), ''));
  v_phone := nullif(btrim(coalesce(r.answers ->> 'contact_number', a.phone, r.answers ->> 'contact_mobile', '')), '');
  v_contact := nullif(btrim(coalesce(r.answers ->> 'contact_full_name', a.contact_name, '')), '');
  if a.id is not null and a.partner_id is not null then
    v_pid := a.partner_id; act := 'existing';
  elsif p_partner is not null then
    v_pid := p_partner; act := 'chosen';
  else
    -- Exact matches only, never a record that already belongs to another agency or registration.
    select count(*), jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name)), min(o.id) into n, cand, v_pid
    from public.partners o
    where o.archived_at is null and not o.internal
      and not exists (select 1 from public.agency_prospects x where x.partner_id = o.id)
      and not exists (select 1 from public.partner_registrations g where g.partner_id = o.id)
      and ((v_email is not null and lower(o.email) = v_email)
        or (char_length(coalesce(public.agency_digits(v_phone), '')) >= 8 and char_length(coalesce(public.agency_digits(o.phone), '')) >= 8
            and right(public.agency_digits(o.phone), 10) = right(public.agency_digits(v_phone), 10))
        or public.agency_name_key(o.name) = public.agency_name_key(r.company_name));
    if n > 1 then
      insert into public.partner_registration_events (registration_id, actor, action, detail) values (p_id, auth.uid(), 'onboarding_needs_review', jsonb_build_object('candidates', cand));
      perform public.notify(public.registration_managers(), 'partner', 'Onboarding needs a decision',
        r.company_name || ' · ' || r.reference || ' — several client records match. Choose the right one before it is added to Clients & Partnerships.', 'partners/registrations');
      return jsonb_build_object('state', 'conflict', 'candidates', cand);
    end if;
    act := case when n = 1 then 'linked' else 'created' end;
    if n = 0 then
      if v_contact is null then
        insert into public.partner_registration_events (registration_id, actor, action, detail) values (p_id, auth.uid(), 'onboarding_needs_review', jsonb_build_object('reason', 'contact person missing'));
        return jsonb_build_object('state', 'conflict', 'reason', 'Contact person missing');
      end if;
      v_code := 'P' || upper(substr(md5(p_id::text), 1, 6));
      while exists (select 1 from public.partners o where o.code = v_code) loop v_code := 'P' || upper(substr(md5(v_code || random()::text), 1, 6)); end loop;
      -- The onboarding credit goes to the proposal sender through the agency (below), not to the approver.
      perform set_config('ssi.historical_reconciliation', 'on', true);
      insert into public.partners (name, code, contact_name, email, phone, country, status, tier, portal_enabled, commission_visible, joined_at,
        partnership_officer_id, onboarding_source, agency_type)
      values (r.company_name, v_code, v_contact, coalesce(v_email, ''), v_phone, coalesce(r.country, a.country), 'Active', 'Silver', false, false, now(),
        case when exists (select 1 from public.employees e where e.id = a.assigned_officer) then a.assigned_officer end, 'portal', a.agency_type)
      returning id into v_pid;
      perform set_config('ssi.historical_reconciliation', v_prev, true);
    else
      update public.partners set status = case when status = 'Onboarding' then 'Active' else status end,
        partnership_officer_id = coalesce(partnership_officer_id, case when exists (select 1 from public.employees e where e.id = a.assigned_officer) then a.assigned_officer end),
        agency_type = coalesce(agency_type, a.agency_type)
      where id = v_pid;
    end if;
  end if;
  -- Business onboarded: the registration is complete (no Partner Admin login yet). The existing
  -- registration trigger marks the agency Onboarded, links it and records the onboarding once.
  update public.partner_registrations set status = 'activated', partner_id = v_pid, activated_at = now(), provisioning_since = null where id = p_id;
  insert into public.partner_registration_events (registration_id, actor, action, detail)
  values (p_id, auth.uid(), 'client_record_linked', jsonb_build_object('partner_id', v_pid, 'match', act, 'portal', 'not activated'));
  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, partner_id, changes)
  values (auth.uid(), case when public.is_super_admin() then 'super_admin' else 'partner_onboarding' end, 'registration_onboarded', 'partner_registrations', p_id::text, v_pid,
          jsonb_build_object('reference', r.reference, 'company', r.company_name, 'match', act, 'agency', a.id));
  return jsonb_build_object('state', act, 'partner_id', v_pid, 'partner_name', (select name from public.partners where id = v_pid));
end $$;
revoke all on function public.complete_registration_onboarding(uuid, text) from public, anon, authenticated;

-- Automatic: after the approval, and after the countersignature. A failure never undoes the approval
-- or the countersignature — it is recorded and the managers can retry.
create or replace function public.registration_onboarding_hook()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if tg_table_name = 'partner_registrations' then
    if new.status <> 'approved' or old.status = 'approved' then return null; end if;
    v_id := new.id;
  else
    if new.status not in ('countersigned', 'sent', 'completed') or old.status in ('countersigned', 'sent', 'completed') then return null; end if;
    v_id := new.registration_id;
  end if;
  begin
    perform public.complete_registration_onboarding(v_id);
  exception when others then
    insert into public.partner_registration_events (registration_id, actor, action, detail) values (v_id, auth.uid(), 'onboarding_failed', jsonb_build_object('error', left(sqlerrm, 300)));
  end;
  return null;
end $$;
drop trigger if exists partner_registrations_zz_onboarding on public.partner_registrations;
create trigger partner_registrations_zz_onboarding after update of status on public.partner_registrations
  for each row execute function public.registration_onboarding_hook();
drop trigger if exists registration_agreements_onboarding on public.registration_agreements;
create trigger registration_agreements_onboarding after update of status on public.registration_agreements
  for each row execute function public.registration_onboarding_hook();

-- Manual retry / an administrator's choice of the client record for a conflict.
create or replace function public.onboard_registration(p_id uuid, p_partner text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_registrations() then raise exception 'Only authorised administrators can complete onboarding'; end if;
  if p_partner is not null then
    if not exists (select 1 from public.partners o where o.id = p_partner and o.archived_at is null and not o.internal) then raise exception 'Client record not found'; end if;
    if exists (select 1 from public.partner_registrations g where g.partner_id = p_partner and g.id <> p_id)
       or exists (select 1 from public.agency_prospects x where x.partner_id = p_partner and x.registration_id is distinct from p_id) then
      raise exception 'That client record already belongs to another agency';
    end if;
  end if;
  return public.complete_registration_onboarding(p_id, p_partner);
end $$;
revoke all on function public.onboard_registration(uuid, text) from public, anon;
grant execute on function public.onboard_registration(uuid, text) to authenticated;

-- The registration → agency trigger (0035), unchanged except that a repair records no employee work.
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
    if coalesce(current_setting('ssi.historical_reconciliation', true), '') <> 'on' then
      select p.sent_by into sender from public.agency_proposals p where p.prospect_id = a.id and p.status = 'confirmed' order by p.confirmed_at desc limit 1;
      perform public.agency_work((select id from public.employees where id = sender), 'partner_onboarded', 'agency-onboarded:' || a.id, a.id, coalesce(a.company_name, a.reference));
    end if;
  elsif new.status = 'rejected' then
    perform public.agency_advance(a.id, 'closed', auth.uid(), true);
  else
    perform public.agency_advance(a.id, nxt, auth.uid());
  end if;
  return new;
end $$;

-- Registrations already approved and countersigned before this migration: complete them now.
do $$
declare g record;
begin
  perform set_config('ssi.historical_reconciliation', 'on', true);  -- a repair, not today's work
  for g in select r.id from public.partner_registrations r
           where r.status = 'approved' and r.partner_id is null
             and (not r.agreement_required or exists (select 1 from public.registration_agreements x where x.registration_id = r.id and x.status in ('countersigned', 'sent', 'completed')))
  loop
    begin
      perform public.complete_registration_onboarding(g.id);
    exception when others then
      insert into public.partner_registration_events (registration_id, actor, action, detail) values (g.id, null, 'onboarding_failed', jsonb_build_object('error', left(sqlerrm, 300)));
    end;
  end loop;
  perform set_config('ssi.historical_reconciliation', '', true);
end $$;

-- =============================================================== agreement type for an unclassified agency
-- The agreement template depends on Domestic / International. A registration manager sets it here (also
-- for a registration with no Agency List record); the linked agency gets it too when it has none.
create or replace function public.set_registration_agreement_type(p_reg uuid, p_type text)
returns void language plpgsql security definer set search_path = '' as $$
declare v text := public.agency_type_value(p_type); st text;
begin
  if not public.can_manage_registrations() then raise exception 'Only authorised administrators can set the agreement type'; end if;
  if v is null then raise exception 'Choose Domestic or International'; end if;
  if not exists (select 1 from public.partner_registrations where id = p_reg) then raise exception 'Registration not found'; end if;
  insert into public.registration_agreements (registration_id, agency_type) values (p_reg, v) on conflict (registration_id) do nothing;
  select status into st from public.registration_agreements where registration_id = p_reg for update;
  if st not in ('not_generated', 'template_missing', 'annexure_missing', 'ready', 'changes_requested') then raise exception 'The agreement has already been signed — its type can no longer change'; end if;
  update public.registration_agreements set agency_type = v, particulars_hash = null,
    status = case when status in ('template_missing', 'annexure_missing') then 'not_generated' else status end, updated_at = now()
  where registration_id = p_reg;
  perform public.agency_apply_type(x.id, v, 'Set for the Partnership Agreement', jsonb_build_object('registration_id', p_reg))
  from public.agency_prospects x where x.registration_id = p_reg and x.agency_type is null;
  perform public.log_agreement(p_reg, 'agreement_type_set', jsonb_build_object('agency_type', v));
end $$;
revoke all on function public.set_registration_agreement_type(uuid, text) from public, anon;
grant execute on function public.set_registration_agreement_type(uuid, text) to authenticated;
