-- 0062_historical_verify.sql — run after 0061_student_import.sql (needs 0060_client_reconciliation)
-- (Supabase SQL Editor: Save this query as "0062_historical_verify")
--
-- One-click verification of a historically onboarded agency: Verify → Done.
--
-- Why the old screen asked for an "Existing partner": the Verify button opened a link-only dialog
-- (reconcile_agency(p_id, p_partner, p_note)) that can only attach the agency to a partner record
-- that already exists. An agency like Algate that was onboarded before the CRM has no such record,
-- so the administrator had to search for one that was never there.
--
-- verify_historical_agency(id) uses the agency's own record:
--   * Super Admin or registration managers only (can_manage_registrations) — as before.
--   * Only an agency already at stage "onboarded" without a client record; new agencies keep the
--     normal registration → agreement → approval path.
--   * Exact single match (email / phone / name, not owned by another agency) → linked to it;
--     no match → its client record is created from the agency's own details (reconcile_agencies_to_clients
--     from 0060: officer, type and contact kept, business onboarded, NO login, NO password, NO email,
--     no employee work credited).
--   * Several or possible matches, or name / contact missing → nothing is linked; only this agency is
--     flagged "needs reconciliation" with the reason, for an administrator to decide.
--   * Already linked → no change (safe to click twice).
-- Safe to run more than once.

create or replace function public.verify_historical_agency(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; plan jsonb; res jsonb; v_pid text; v_status text;
begin
  if not public.can_manage_registrations() then raise exception 'Only authorised administrators can verify historical onboarding'; end if;
  perform pg_advisory_xact_lock(hashtext('historical-onboarding'));
  select id, reference, company_name, stage, partner_id into a from public.agency_prospects where id = p_id for update;
  if a.id is null then raise exception 'Agency not found'; end if;
  if a.partner_id is not null then
    return jsonb_build_object('status', 'already', 'partner_id', a.partner_id, 'partner_name', (select o.name from public.partners o where o.id = a.partner_id));
  end if;
  if a.stage <> 'onboarded' then
    raise exception 'Only an agency already onboarded before the CRM can be verified here. A new agency follows the normal registration and approval.';
  end if;
  plan := public.client_reconcile_plan(p_id);
  if plan ->> 'action' = 'conflict' then
    update public.agency_prospects set needs_reconciliation = true, reconciliation_note = left(plan ->> 'reason', 500), updated_at = now()
    where id = p_id and partner_id is null;
    return jsonb_build_object('status', 'review', 'reason', plan ->> 'reason', 'candidates', coalesce(plan -> 'candidates', '[]'::jsonb));
  end if;
  res := public.reconcile_agencies_to_clients(array[p_id], 'Historical onboarding verified by an administrator', null);
  select partner_id into v_pid from public.agency_prospects where id = p_id;
  v_status := case when jsonb_array_length(res -> 'created') > 0 then 'created' when jsonb_array_length(res -> 'linked') > 0 then 'linked'
                   when v_pid is not null then 'already' else 'review' end;
  return jsonb_build_object('status', v_status, 'partner_id', v_pid, 'partner_name', (select o.name from public.partners o where o.id = v_pid),
                            'reason', res -> 'skipped' -> 0 ->> 'reason');
end $$;
revoke all on function public.verify_historical_agency(uuid) from public, anon;
grant execute on function public.verify_historical_agency(uuid) to authenticated;
