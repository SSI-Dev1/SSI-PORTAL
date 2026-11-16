-- Super Admin permanent deletion of unnecessary (test) records (16 Nov 2026).
--
-- Deactivate / archive stay as they are. Permanent deletion is a separate, Super Admin-only path:
--
--   deletion_preview(kind, ids)            dry run: what each record is, what goes with it, what blocks it
--   delete_records(kind, ids, confirm, …)  re-checks everything in one transaction and deletes only the
--                                          eligible records; blocked ones are skipped and reported
--
-- kinds: agency, linkedin, partner (client organisation), partner_user (partner login), branch
-- ("<partner id>::<branch name>").
--
-- Protection rules
--   * Super Admin only (checked here, not in the browser), signed in within the last 12 hours
--     (re-authentication for a destructive action), confirmation typed: the record's name for one
--     record, "DELETE <n>" for several. At most 100 records per request.
--   * Real business data blocks deletion; it is never cascaded away:
--       client  – students, applications, documents, assessments, payments, commission assignments;
--                 partner logins unless explicitly included
--       agency  – a linked client record, an activated registration, historical onboarding
--       login   – SSI GLOBAL staff accounts (only partner logins can be deleted here); the last
--                 Partner Admin of a client that still has other logins
--       branch  – the client's only branch
--   * Deleted with the record (its own working history): agency activities, proposals, MOUs, emails,
--     tasks, officer history; LinkedIn activities; a client's feed entries and sub-officer history.
--   * Kept: Daily Work Report activities and submitted reports (no foreign key — history is never
--     rewritten), LinkedIn prospects converted into a deleted agency (set back to "Agency details
--     needed"), an agency whose client is deleted (flagged for reconciliation), audit log.
--   * Every deletion writes an audit_log row ("record_deleted") with the name, reference and counts.

create or replace function public.recent_sign_in(p_hours integer default 12)
returns boolean language sql stable set search_path = '' as $$
  -- Time of the session's most recent authentication (password, OTP, OAuth …) from the JWT.
  select coalesce(to_timestamp((select max((x ->> 'timestamp')::bigint) from jsonb_array_elements(
           case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) x))
         > now() - make_interval(hours => p_hours), false);
$$;

create or replace function public.deletion_preview(p_kind text, p_ids text[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  out jsonb := '[]';
  i text;
  item jsonb;
  blockers text[];
  related jsonb;
  nm text;
  ref text;
  n bigint;
  r record;
  pid text;
  br text;
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can permanently delete records'; end if;
  if p_kind not in ('agency', 'linkedin', 'partner', 'partner_user', 'branch') then raise exception 'Unknown record type'; end if;
  if coalesce(cardinality(p_ids), 0) = 0 then raise exception 'Select at least one record'; end if;
  if cardinality(p_ids) > 100 then raise exception 'Delete at most 100 records at a time'; end if;

  foreach i in array (select array_agg(distinct x) from unnest(p_ids) x) loop
    blockers := '{}'; related := '{}'; nm := null; ref := null;

    if p_kind = 'agency' then
      select * into r from public.agency_prospects where id::text = i;
      if r.id is null then out := out || jsonb_build_object('id', i, 'exists', false, 'eligible', false, 'blockers', jsonb_build_array('Record not found (already deleted?)')); continue; end if;
      nm := coalesce(r.company_name, r.contact_name, r.reference); ref := r.reference;
      if r.partner_id is not null then
        blockers := blockers || format('Linked to the client "%s" in Clients & Branches. Delete or unlink that client first.', (select name from public.partners where id = r.partner_id));
      end if;
      if r.historical_onboarded then blockers := blockers || 'Historically onboarded client — a real business record.'::text; end if;
      if exists (select 1 from public.partner_registrations g where g.id = r.registration_id and g.status = 'activated') then
        blockers := blockers || 'Its partner registration was activated (a partner account exists).'::text;
      end if;
      related := jsonb_build_object(
        'Activity history', (select count(*) from public.agency_activities where prospect_id = r.id),
        'Proposals', (select count(*) from public.agency_proposals where prospect_id = r.id),
        'MOUs', (select count(*) from public.agency_mous where prospect_id = r.id),
        'Onboarding emails', (select count(*) from public.agency_emails where prospect_id = r.id),
        'Tasks & follow-ups', (select count(*) from public.agency_tasks where prospect_id = r.id),
        'Officer history', (select count(*) from public.agency_officer_history where prospect_id = r.id)
                           + (select count(*) from public.sub_officer_history where prospect_id = r.id));
      item := jsonb_build_object('kept', jsonb_build_object(
        'LinkedIn prospects (set back to "Agency details needed")', (select count(*) from public.linkedin_prospects where agency_id = r.id),
        'Daily Work Report entries (unchanged)', (select count(*) from public.work_activities where entity_type = 'agency' and entity_id = r.id::text)));

    elsif p_kind = 'linkedin' then
      select * into r from public.linkedin_prospects where id::text = i;
      if r.id is null then out := out || jsonb_build_object('id', i, 'exists', false, 'eligible', false, 'blockers', jsonb_build_array('Record not found (already deleted?)')); continue; end if;
      nm := coalesce(r.name, r.reference); ref := r.reference;
      related := jsonb_build_object('LinkedIn activity history', (select count(*) from public.linkedin_activities where prospect_id = r.id));
      item := jsonb_build_object('kept', jsonb_build_object(
        'Agency created from it (unchanged)', case when r.agency_id is not null then 1 else 0 end,
        'Daily Work Report entries (unchanged)', (select count(*) from public.work_activities where entity_type = 'linkedin' and entity_id = r.id::text)));

    elsif p_kind = 'partner' then
      select * into r from public.partners where id = i;
      if r.id is null then out := out || jsonb_build_object('id', i, 'exists', false, 'eligible', false, 'blockers', jsonb_build_array('Record not found (already deleted?)')); continue; end if;
      nm := r.name; ref := r.code;
      select count(*) into n from public.students where partner_id = r.id;
      if n > 0 then blockers := blockers || format('%s student record(s) — real student data is never deleted with a client. Archive the client instead.', n); end if;
      select count(*) into n from public.applications where partner_id = r.id;
      if n > 0 then blockers := blockers || format('%s application(s).', n); end if;
      select count(*) into n from public.documents where partner_id = r.id;
      if n > 0 then blockers := blockers || format('%s student document(s).', n); end if;
      select count(*) into n from public.assessments where partner_id = r.id;
      if n > 0 then blockers := blockers || format('%s assessment(s).', n); end if;
      select count(*) into n from public.payments where partner_id = r.id;
      if n > 0 then blockers := blockers || format('%s invoice / payment record(s) — financial records are retained.', n); end if;
      select count(*) into n from public.partner_commission_assignments where partner_id = r.id;
      if n > 0 then blockers := blockers || format('%s commission assignment(s). End or remove them in Commission Management first.', n); end if;
      related := jsonb_build_object(
        'Partner logins (deleted only if included)', (select count(*) from public.profiles where partner_id = r.id),
        'Activity feed entries', (select count(*) from public.activities where partner_id = r.id),
        'Sub officer history', (select count(*) from public.sub_officer_history where partner_id = r.id),
        'Commission signals', (select count(*) from public.partner_commission_signals where partner_id = r.id));
      item := jsonb_build_object('kept', jsonb_build_object(
        'Agency List record (flagged for reconciliation)', (select count(*) from public.agency_prospects where partner_id = r.id),
        'Partner registrations (unlinked)', (select count(*) from public.partner_registrations where partner_id = r.id),
        'Client activity log entries (unlinked)', (select count(*) from public.client_activities where partner_id = r.id)));

    elsif p_kind = 'partner_user' then
      select p.*, o.name as org_name into r from public.profiles p left join public.partners o on o.id = p.partner_id where p.id::text = i;
      if r.id is null then out := out || jsonb_build_object('id', i, 'exists', false, 'eligible', false, 'blockers', jsonb_build_array('Account not found (already deleted?)')); continue; end if;
      nm := coalesce(r.full_name, r.email); ref := r.email;
      if r.role not in ('partner_admin', 'partner_staff') then
        blockers := blockers || 'This is an SSI GLOBAL staff account. Staff accounts are deactivated in User Management, not deleted here.'::text;
      elsif r.role = 'partner_admin' and r.partner_id is not null
        and not exists (select 1 from public.profiles x where x.partner_id = r.partner_id and x.role = 'partner_admin' and x.id <> r.id)
        and exists (select 1 from public.profiles x where x.partner_id = r.partner_id and x.id <> r.id and x.status = 'active') then
        blockers := blockers || format('Only Partner Admin of "%s", which still has other logins. Make another user Partner Admin first.', r.org_name);
      end if;
      related := jsonb_build_object(
        'Notifications', (select count(*) from public.notifications where user_id = r.id),
        'Login credential records', (select count(*) from public.account_credential_deliveries where user_id = r.id)
                                    + (select count(*) from public.account_temp_credentials where user_id = r.id));
      item := jsonb_build_object('kept', jsonb_build_object(
        'Students / applications they created (kept, creator cleared)', (select count(*) from public.students where created_by = r.id)
                                                                       + (select count(*) from public.applications where created_by = r.id),
        'Application chat messages (kept, sender cleared)', (select count(*) from public.application_messages where sender_id = r.id)));

    else -- branch
      pid := split_part(i, '::', 1); br := substr(i, length(pid) + 3);
      select * into r from public.partners where id = pid;
      if r.id is null or not (br = any (r.branches)) then out := out || jsonb_build_object('id', i, 'exists', false, 'eligible', false, 'blockers', jsonb_build_array('Branch not found (already removed?)')); continue; end if;
      nm := br; ref := r.name;
      if cardinality(r.branches) <= 1 then blockers := blockers || 'A client must keep at least one branch. Delete the client instead.'::text; end if;
      related := '{}';
      item := jsonb_build_object('kept', jsonb_build_object('Client record (unchanged)', 1));
    end if;

    out := out || (jsonb_build_object('id', i, 'exists', true, 'name', nm, 'reference', ref, 'type', p_kind,
      'related', related, 'affected', 1 + coalesce((select sum(v::bigint) from jsonb_each_text(related) x(k, v)
                                                    where p_kind <> 'partner' or k <> 'Partner logins (deleted only if included)'), 0),
      'blockers', to_jsonb(blockers), 'eligible', cardinality(blockers) = 0) || item);
  end loop;
  return jsonb_build_object('kind', p_kind, 'items', out, 'count', jsonb_array_length(out),
    'eligible', (select count(*) from jsonb_array_elements(out) x where (x ->> 'eligible')::boolean),
    'confirm', case when jsonb_array_length(out) = 1 then out -> 0 ->> 'name' else 'DELETE ' || jsonb_array_length(out) end);
end $$;
revoke all on function public.deletion_preview(text, text[]) from public, anon;
grant execute on function public.deletion_preview(text, text[]) to authenticated;

create or replace function public.delete_records(p_kind text, p_ids text[], p_confirm text, p_include_logins boolean default false, p_request uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  pv jsonb;
  it jsonb;
  done jsonb := '[]';
  skipped jsonb := '[]';
  i text;
  pid text;
  br text;
  logins integer;
  me uuid := auth.uid();
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can permanently delete records'; end if;
  if not public.recent_sign_in(12) then
    raise exception 'REAUTH: For your security, sign out and sign in again before permanently deleting records (your last sign-in was more than 12 hours ago).';
  end if;
  -- A repeated request (double click, retry) is answered from the audit log, never deleted twice.
  if p_request is not null and exists (select 1 from public.audit_log where action = 'record_deleted' and changes ->> 'request' = p_request::text) then
    return jsonb_build_object('repeated', true, 'deleted', (select jsonb_agg(entity_id) from public.audit_log where action = 'record_deleted' and changes ->> 'request' = p_request::text), 'skipped', '[]'::jsonb);
  end if;
  pv := public.deletion_preview(p_kind, p_ids);
  if btrim(coalesce(p_confirm, '')) is distinct from btrim(pv ->> 'confirm') then
    raise exception 'CONFIRM: Type % exactly to confirm.', pv ->> 'confirm';
  end if;

  for it in select * from jsonb_array_elements(pv -> 'items') loop
    i := it ->> 'id';
    if not (it ->> 'eligible')::boolean then
      skipped := skipped || jsonb_build_object('id', i, 'name', it ->> 'name', 'reasons', it -> 'blockers');
      continue;
    end if;
    if p_kind = 'partner' then
      select count(*) into logins from public.profiles where partner_id = i;
      if logins > 0 and not p_include_logins then
        skipped := skipped || jsonb_build_object('id', i, 'name', it ->> 'name', 'reasons', jsonb_build_array(format('%s partner login(s) — tick "Also delete partner logins" to include them.', logins)));
        continue;
      end if;
    end if;

    if p_kind = 'agency' then
      update public.linkedin_prospects set agency_id = null, status = 'interested', conversion_pending = true, updated_at = now()
      where agency_id::text = i;
      delete from public.agency_prospects where id::text = i;
    elsif p_kind = 'linkedin' then
      delete from public.linkedin_prospects where id::text = i;
    elsif p_kind = 'partner' then
      update public.agency_prospects set needs_reconciliation = true,
        reconciliation_note = format('Client record "%s" permanently deleted by a Super Admin', it ->> 'name'), updated_at = now()
      where partner_id = i;
      -- Partner logins (explicitly included): the sign-in account and, by cascade, its profile.
      delete from auth.users u where u.id in (select p.id from public.profiles p where p.partner_id = i and p.role in ('partner_admin', 'partner_staff'));
      delete from public.partners where id = i;
    elsif p_kind = 'partner_user' then
      delete from auth.users where id::text = i;
    else
      pid := split_part(i, '::', 1); br := substr(i, length(pid) + 3);
      update public.partners set branches = array_remove(branches, br) where id = pid;
    end if;

    insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, partner_id, changes)
    values (me, 'super_admin', 'record_deleted', p_kind, i,
            case when p_kind = 'partner' then null when p_kind = 'branch' then split_part(i, '::', 1) end,
            jsonb_build_object('name', it ->> 'name', 'reference', it ->> 'reference', 'related', it -> 'related',
                               'kept', it -> 'kept', 'request', p_request, 'logins_included', p_include_logins));
    done := done || jsonb_build_object('id', i, 'name', it ->> 'name');
  end loop;
  return jsonb_build_object('deleted', done, 'skipped', skipped);
end $$;
revoke all on function public.delete_records(text, text[], text, boolean, uuid) from public, anon;
grant execute on function public.delete_records(text, text[], text, boolean, uuid) to authenticated;
