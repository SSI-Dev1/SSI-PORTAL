-- 0048_linkedin_reporting.sql — run after 0047_partner_success.sql
-- (Supabase SQL Editor: Save this query as "0048_linkedin_reporting")
--
-- LinkedIn Outreach reporting corrections. Root causes:
-- * Follow-ups were credited with dedupe key 'li-act:<activity id>' — every click a new key, so the
--   same prospect counted again and again on one day.
-- * Positive / Closed credits had permanent keys and a stage change never reversed the previous
--   one — a prospect moved Closed → Positive on one day counted in both.
-- * The pipeline lived in the legacy mixed `status` column; there was no "Not responded" state, so
--   attempted-but-silent prospects stayed in "Pending contacts".
-- * Contact status could be set back freely (Connected → Not connected → Not recorded) by anyone.
-- * Moving a LinkedIn prospect to the Agency List never credited "New partners contacted".
-- Model from here on (three separate concepts):
-- * contact_status: Not recorded / Not connected / Connected (explicit; ordinary employees can only
--   move it forward; reversals are Super Admin corrections with a reason, audited).
-- * pipeline_stage (authoritative, one per prospect): pending → not_responded → positive / closed.
--   Follow-up Completed moves Pending → Not responded and never touches the contact status.
--   `status` is kept in step for older screens ('converted' still marks a moved prospect).
-- * next_follow_up: the one outstanding follow-up (unchanged).
-- Report credits: one follow-up per prospect per reporting day (first employee), one positive /
-- closed credit per prospect per day that follows the CURRENT stage (a same-day change reverses the
-- earlier credit; earlier days are never touched), one New partner contacted per agency relationship.
-- Existing data: reconciled below (voids only — no activity row is deleted; submitted reports are
-- frozen snapshots and do not change). Safe to run more than once.

-- =============================================================== pipeline stage
alter table public.linkedin_prospects add column if not exists pipeline_stage text;
alter table public.linkedin_prospects add column if not exists stage_changed_by uuid;
alter table public.linkedin_prospects add column if not exists stage_changed_at timestamptz;
update public.linkedin_prospects set pipeline_stage = case status
    when 'not_contacted' then 'pending' when 'contacted' then 'not_responded' when 'responded' then 'not_responded'
    when 'interested' then 'positive' when 'converted' then 'positive' when 'not_interested' then 'closed' else 'pending' end
where pipeline_stage is null;
alter table public.linkedin_prospects alter column pipeline_stage set default 'pending';
alter table public.linkedin_prospects alter column pipeline_stage set not null;
alter table public.linkedin_prospects drop constraint if exists linkedin_prospects_pipeline_check;
alter table public.linkedin_prospects add constraint linkedin_prospects_pipeline_check check (pipeline_stage in ('pending', 'not_responded', 'positive', 'closed'));
create index if not exists linkedin_prospects_pipeline_idx on public.linkedin_prospects (assigned_to, pipeline_stage);

-- Older screens read `status`: keep it in step with the pipeline (moved prospects stay 'converted').
create or replace function public.linkedin_status_sync()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from 'converted' then
    new.status := case new.pipeline_stage when 'pending' then 'not_contacted' when 'not_responded' then 'contacted'
                                          when 'positive' then 'interested' when 'closed' then 'not_interested' end;
  end if;
  return new;
end $$;
drop trigger if exists linkedin_status_sync on public.linkedin_prospects;
create trigger linkedin_status_sync before insert or update of pipeline_stage, status on public.linkedin_prospects
  for each row execute function public.linkedin_status_sync();
revoke all on function public.linkedin_status_sync() from public, anon, authenticated;

-- =============================================================== report credit helpers
-- Credit p_emp once for p_key (or re-activate a credit that was reversed earlier the same day).
create or replace function public.li_credit(p_emp uuid, p_type text, p_key text, p_entity_type text, p_entity text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare rid bigint;
begin
  if p_emp is null then return; end if;
  update public.work_activities set voided_at = null, voided_by = null, void_reason = null where dedupe_key = p_key and voided_at is not null;
  if found then return; end if;
  rid := public.record_work_activity(p_emp, p_type, p_key, p_entity_type, p_entity, null, null, null, null, null, 1, p_note);
  if rid is not null then update public.work_activities set source = 'crm' where id = rid; end if;
end $$;
-- Reverse a credit (kept, voided with a reason).
create or replace function public.li_uncredit(p_key text, p_reason text)
returns void language sql security definer set search_path = '' as $$
  update public.work_activities set voided_at = now(), voided_by = auth.uid(), void_reason = p_reason where dedupe_key = p_key and voided_at is null;
$$;
revoke all on function public.li_credit(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.li_uncredit(text, text) from public, anon, authenticated;

-- =============================================================== contact status (forward only)
create or replace function public.set_linkedin_contact_status(p_id uuid, p_status text, p_note text, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l record; me uuid := public.my_employee_id(); reversal boolean;
begin
  if not public.linkedin_editable(p_id) then raise exception 'Not allowed to update this prospect'; end if;
  if p_status not in ('connected', 'not_connected', 'unknown') then raise exception 'Choose Connected, Not connected or Not recorded'; end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  select * into l from public.linkedin_prospects where id = p_id for update;
  if exists (select 1 from public.linkedin_activities where request_id = p_request) or l.contact_status = p_status then
    return jsonb_build_object('contact_status', l.contact_status, 'changed', false);
  end if;
  -- Forward only: Not recorded → Not connected → Connected. Going back is a Super Admin correction.
  reversal := (l.contact_status = 'connected') or (l.contact_status = 'not_connected' and p_status = 'unknown');
  if reversal and not public.is_super_admin() then
    raise exception '%', case when l.contact_status = 'connected' then 'A Connected contact cannot be changed back. Ask a Super Admin to correct it.'
                              else 'Not connected cannot be reset to Not recorded. Ask a Super Admin to correct it.' end;
  end if;
  if reversal and nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'Give a reason for the correction'; end if;
  perform public.linkedin_log(p_id, case when reversal then 'contact_correction' else 'contact_status' end, p_note,
                              jsonb_build_object('from', l.contact_status, 'to', p_status), p_request);
  update public.linkedin_prospects set contact_status = p_status, contact_changed_by = auth.uid(), contact_changed_at = now(),
    last_contact_at = case when p_status = 'connected' then now() else last_contact_at end, updated_at = now()
  where id = p_id;
  -- New contacts connected: the explicit Connected, once per prospect. A correction away from
  -- Connected reverses that credit (kept, voided with the reason).
  if p_status = 'connected' then
    perform public.li_credit(coalesce(me, (select employee_id from public.work_activities where dedupe_key = 'li-contact:' || p_id)), 'linkedin_connection',
                             'li-contact:' || p_id, 'linkedin', p_id::text, p_note);
  elsif l.contact_status = 'connected' then
    perform public.li_uncredit('li-contact:' || p_id, 'Contact status corrected by a Super Admin: ' || btrim(p_note));
  end if;
  return jsonb_build_object('contact_status', p_status, 'changed', true, 'correction', reversal);
end $$;

-- =============================================================== Follow-up Completed / note / follow-up date
create or replace function public.log_linkedin_activity(p_id uuid, p_kind text, p_note text, p_next date, p_request uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare l record; rid bigint; me uuid := public.my_employee_id(); d date := public.company_today();
begin
  if not public.linkedin_editable(p_id) then raise exception 'Not allowed to update this prospect'; end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  -- Older callers: stage words go through set_linkedin_stage.
  if p_kind in ('contacted', 'response', 'interested', 'not_interested') then
    perform public.set_linkedin_stage(p_id, case p_kind when 'interested' then 'positive' when 'not_interested' then 'closed' else 'not_responded' end, p_note, p_next, p_request);
    return (select id from public.linkedin_activities where request_id = p_request);
  end if;
  if p_kind not in ('follow_up', 'note', 'follow_up_date') then raise exception 'Unknown activity'; end if;
  if p_next is not null and p_next < d then raise exception 'The follow-up date cannot be in the past'; end if;
  if p_kind = 'follow_up_date' and p_next is null then raise exception 'Choose the follow-up date'; end if;
  select * into l from public.linkedin_prospects where id = p_id for update;
  if l.status = 'converted' and p_kind <> 'note' then raise exception 'This prospect is already in the Agency List'; end if;
  rid := public.linkedin_log(p_id, p_kind, p_note,
    jsonb_build_object('next_follow_up', p_next, 'stage', l.pipeline_stage, 'contact_status', l.contact_status,
                       'completed_follow_up', case when p_kind = 'follow_up' then l.next_follow_up end), p_request);
  if rid is null then return (select id from public.linkedin_activities where request_id = p_request); end if;
  if p_kind = 'note' then return rid; end if;
  -- Follow-up Completed: the attempt is made. Pending → Not responded; the contact status is never changed.
  update public.linkedin_prospects set
    pipeline_stage = case when p_kind = 'follow_up' and pipeline_stage = 'pending' then 'not_responded' else pipeline_stage end,
    stage_changed_by = case when p_kind = 'follow_up' and pipeline_stage = 'pending' then auth.uid() else stage_changed_by end,
    stage_changed_at = case when p_kind = 'follow_up' and pipeline_stage = 'pending' then now() else stage_changed_at end,
    last_contact_at = case when p_kind = 'follow_up' then now() else last_contact_at end,
    next_follow_up = p_next,
    next_follow_up_auto = false,
    updated_at = now()
  where id = p_id;
  if p_kind = 'follow_up' and l.pipeline_stage = 'pending' then
    perform public.linkedin_log(p_id, 'stage', null, jsonb_build_object('from', 'pending', 'to', 'not_responded', 'automatic', true), null);
  end if;
  -- Follow-up messages sent: one per prospect per reporting day (the first employee that day).
  if p_kind = 'follow_up' then
    perform public.li_credit(me, 'linkedin_followup', 'li-followup:' || p_id || ':' || d, 'linkedin', p_id::text, p_note);
  end if;
  return rid;
end $$;

-- =============================================================== Change Stage (one current stage)
create or replace function public.set_linkedin_stage(p_id uuid, p_stage text, p_note text, p_next date, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l record; st text; me uuid := public.my_employee_id(); d date := public.company_today(); conv jsonb; missing text[] := '{}'; digits text;
begin
  if not public.linkedin_editable(p_id) then raise exception 'Not allowed to update this prospect'; end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  st := case p_stage when 'contacted' then 'not_responded' when 'responded' then 'not_responded' when 'interested' then 'positive'
                     when 'not_interested' then 'closed' else p_stage end;
  if st not in ('pending', 'not_responded', 'positive', 'closed') then raise exception 'Unknown stage'; end if;
  select * into l from public.linkedin_prospects where id = p_id for update;
  if exists (select 1 from public.linkedin_activities where request_id = p_request) then
    return jsonb_build_object('status', l.status, 'stage', l.pipeline_stage, 'duplicate', true, 'agency_id', l.agency_id, 'conversion_pending', l.conversion_pending);
  end if;
  if l.status = 'converted' then raise exception 'This prospect is already in the Agency List'; end if;
  if st = 'pending' and not public.is_super_admin() then raise exception 'Only a Super Admin can move a prospect back to Pending'; end if;
  if p_next is not null and p_next < d then raise exception 'The follow-up date cannot be in the past'; end if;
  if st <> l.pipeline_stage then
    perform public.linkedin_log(p_id, 'stage', p_note, jsonb_build_object('from', l.pipeline_stage, 'to', st), p_request);
    update public.linkedin_prospects set pipeline_stage = st, stage_changed_by = auth.uid(), stage_changed_at = now(),
      next_follow_up = case when st = 'closed' then null else coalesce(p_next, next_follow_up) end,
      next_follow_up_auto = case when st = 'closed' or p_next is not null then false else next_follow_up_auto end,
      conversion_pending = case when st = 'positive' then conversion_pending else false end,
      last_contact_at = case when st in ('positive', 'closed') then now() else last_contact_at end,
      updated_at = now()
    where id = p_id;
    -- Today's credit for the stage being left is reversed; earlier days stay as recorded.
    if l.pipeline_stage = 'positive' then perform public.li_uncredit('li-positive:' || p_id || ':' || d, 'Stage changed to ' || st || ' the same day'); end if;
    if l.pipeline_stage = 'closed' then perform public.li_uncredit('li-closed:' || p_id || ':' || d, 'Stage changed to ' || st || ' the same day'); end if;
    if st = 'positive' then perform public.li_credit(me, 'linkedin_positive', 'li-positive:' || p_id || ':' || d, 'linkedin', p_id::text, p_note); end if;
    if st = 'closed' then perform public.li_credit(me, 'linkedin_closed', 'li-closed:' || p_id || ':' || d, 'linkedin', p_id::text, p_note); end if;
  elsif p_note is not null or p_next is not null then
    perform public.linkedin_log(p_id, 'note', p_note, jsonb_build_object('next_follow_up', p_next), p_request);
    if p_next is not null then update public.linkedin_prospects set next_follow_up = p_next, next_follow_up_auto = false, updated_at = now() where id = p_id; end if;
  end if;
  -- Positive Response starts the move to the Agency List (needs agency name and a valid phone; nothing is invented).
  if st = 'positive' then
    digits := public.agency_digits(l.phone);
    if l.company_name is null then missing := array_append(missing, 'agency / company name'); end if;
    if l.phone is null or l.phone !~ '^\+?[0-9 ()./-]{7,30}$' or char_length(coalesce(digits, '')) not between 7 and 15 then missing := array_append(missing, 'a valid phone number'); end if;
    if cardinality(missing) = 0 then
      conv := public.convert_linkedin_prospect(p_id, '{}'::jsonb);
      update public.linkedin_prospects set conversion_pending = false where id = p_id;
      return jsonb_build_object('status', 'converted', 'stage', 'positive', 'agency_id', conv ->> 'agency_id', 'linked', conv -> 'linked', 'conversion_pending', false);
    end if;
    update public.linkedin_prospects set conversion_pending = true, updated_at = now() where id = p_id;
    return jsonb_build_object('status', 'interested', 'stage', 'positive', 'conversion_pending', true, 'missing', to_jsonb(missing));
  end if;
  return jsonb_build_object('status', (select status from public.linkedin_prospects where id = p_id), 'stage', st, 'conversion_pending', false);
end $$;

-- =============================================================== Move to Agency List (latest: 0043 + New partner contacted, once)
create or replace function public.convert_linkedin_prospect(p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l record; nm text; poc text; ph text; digits text; em text; url text; extra text; ex uuid; aid uuid; ref text; linked boolean := false; missing text[] := '{}';
  cs text; cs_at timestamptz; me uuid := public.my_employee_id();
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
  cs := case when l.contact_status <> 'unknown' then l.contact_status when l.pipeline_stage = 'positive' then 'connected' else 'unknown' end;
  cs_at := case when l.contact_status <> 'unknown' then l.contact_changed_at when cs = 'connected' then coalesce(l.last_contact_at, now()) end;
  select a.id into ex from public.agency_prospects a
  where (char_length(digits) >= 8 and public.agency_digits(a.phone) = digits)
     or (char_length(digits) >= 10 and char_length(public.agency_digits(a.phone)) >= 10 and right(public.agency_digits(a.phone), 10) = right(digits, 10))
     or (em is not null and lower(a.email) = em)
     or (public.agency_name_key(a.company_name) = public.agency_name_key(nm))
  order by a.created_at limit 1;
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
    insert into public.agency_prospects (reference, company_name, contact_name, phone, email, country, notes, contact_status, contact_changed_by,
      contact_changed_at, first_connected_at, first_contact_at, last_contact_at, assigned_officer, created_by, source, source_values)
    values (ref, nm, poc, ph, em, public.agency_clean(p, 'country', 80), nullif(concat_ws(E'\n\n', l.notes, extra), ''),
      cs, coalesce(l.contact_changed_by, case when cs <> 'unknown' then l.assigned_to end), cs_at,
      case when cs = 'connected' then cs_at end, case when cs <> 'unknown' then coalesce(cs_at, l.last_contact_at) end,
      l.last_contact_at, coalesce(l.assigned_to, auth.uid()), auth.uid(),
      'linkedin', jsonb_build_object('linkedin_id', p_id, 'linkedin_reference', l.reference, 'linkedin_url', url))
    returning id into aid;
    perform public.agency_log(aid, 'converted_from_linkedin', extra, jsonb_build_object('linkedin_id', p_id, 'reference', l.reference, 'linkedin_url', url));
    perform public.agency_work(me, 'agency_added', 'agency-added:' || aid, aid);
  end if;
  -- Agency Type (0043): new agencies take the chosen type; an existing agency keeps its own classification.
  if not linked or (select agency_type from public.agency_prospects where id = aid) is null then
    perform public.agency_apply_type(aid, p ->> 'agency_type', null, jsonb_build_object('on', 'linkedin', 'linkedin_id', p_id));
  end if;
  update public.linkedin_prospects set status = 'converted', pipeline_stage = 'positive', agency_id = aid, converted_at = now(), converted_by = auth.uid(),
    company_name = coalesce(company_name, nm), phone = coalesce(phone, ph), email = coalesce(email, em), linkedin_url = coalesce(linkedin_url, url), updated_at = now()
  where id = p_id;
  perform public.linkedin_log(p_id, 'converted', extra, jsonb_build_object('agency_id', aid, 'linked_existing', linked), null);
  perform public.agency_work(me, 'linkedin_converted', 'li-converted:' || p_id, aid, coalesce(nm, l.name));
  -- New partners contacted: once per agency relationship (same key as an Agency List contact), so a
  -- later Connected, edit, stage change or a second LinkedIn record for the same agency never adds one.
  -- Qualifies only with evidence of contact (Connected or a Positive response) — a bare move invents nothing.
  if cs = 'connected' then
    if not exists (select 1 from public.work_activities where dedupe_key = 'agency-contact:' || aid) then
      perform public.agency_work(me, 'partner_contact', 'agency-contact:' || aid, aid, coalesce(nm, l.name));
    end if;
    update public.agency_prospects set first_contact_at = coalesce(first_contact_at, now()) where id = aid;
  end if;
  return jsonb_build_object('agency_id', aid, 'linked', linked, 'duplicate', false);
end $$;

-- =============================================================== Agency List contact status (forward only)
create or replace function public.set_agency_contact_status(p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare a record; fresh boolean; reversal boolean;
begin
  if not public.agency_can_see(p_id) then raise exception 'Not allowed to update this agency'; end if;
  if p_status not in ('connected', 'not_connected', 'unknown') then raise exception 'Unknown contact status'; end if;
  select * into a from public.agency_prospects where id = p_id for update;
  if a.contact_status = p_status then return; end if;
  reversal := (a.contact_status = 'connected') or (a.contact_status = 'not_connected' and p_status = 'unknown');
  if reversal and not public.is_super_admin() then
    raise exception '%', case when a.contact_status = 'connected' then 'A Connected agency cannot be changed back. Ask a Super Admin to correct it.'
                              else 'Not connected cannot be reset to Not recorded. Ask a Super Admin to correct it.' end;
  end if;
  if reversal and nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'Give a reason for the correction'; end if;
  if p_status = 'unknown' and not reversal then raise exception 'Unknown contact status'; end if;
  fresh := case when reversal then false else public.agency_first_outreach(p_id) end;
  update public.agency_prospects set contact_status = p_status, contact_changed_by = auth.uid(), contact_changed_at = now(),
    first_connected_at = coalesce(first_connected_at, case when p_status = 'connected' then now() end),
    last_contact_at = case when reversal then last_contact_at else now() end, updated_at = now()
  where id = p_id;
  perform public.agency_log(p_id, case when reversal then 'contact_correction' else 'contact_status' end, p_note, jsonb_build_object('from', a.contact_status, 'to', p_status));
  if fresh then perform public.agency_work(public.my_employee_id(), 'partner_contact', 'agency-contact:' || p_id, p_id); end if;
end $$;

-- Bulk contact correction (0040) follows the same rule: moving forward stays with agency managers,
-- a reversal (Connected -> anything, Not connected -> Not recorded) is Super Admin only with a reason.
create or replace function public.bulk_set_agency_contact(p_ids uuid[], p_status text, p_note text, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid; prev jsonb; a record; changed int := 0; same int := 0; reversals int;
begin
  if not public.agency_manager() then raise exception 'Only administrators can correct contact status in bulk'; end if;
  if p_status not in ('unknown', 'not_connected', 'connected') then raise exception 'Unknown contact status'; end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  select summary into prev from public.agency_bulk_operations where request_key = p_request;
  if prev is not null then return prev || jsonb_build_object('replayed', true); end if;
  select count(*) into reversals from public.agency_prospects
   where id = any (p_ids) and contact_status <> p_status
     and (contact_status = 'connected' or (contact_status = 'not_connected' and p_status = 'unknown'));
  if reversals > 0 and not public.is_super_admin() then
    raise exception '% selected agenc% would move back from Connected or Not connected. Ask a Super Admin to correct it.', reversals, case when reversals = 1 then 'y' else 'ies' end;
  end if;
  if reversals > 0 and nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'Give a reason for the correction'; end if;
  insert into public.agency_bulk_operations (kind, request_key, actor, note) values ('contact_status', p_request, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into op;
  for a in select id, contact_status from public.agency_prospects where id = any (p_ids) order by id for update loop
    if a.contact_status = p_status then same := same + 1; continue; end if;
    update public.agency_prospects set contact_status = p_status, contact_changed_by = auth.uid(), contact_changed_at = now(), updated_at = now() where id = a.id;
    perform public.agency_log(a.id, 'contact_status_corrected', p_note, jsonb_build_object('from', a.contact_status, 'to', p_status, 'operation', op, 'correction', true));
    changed := changed + 1;
  end loop;
  update public.agency_bulk_operations set summary = jsonb_build_object('operation', op, 'status', p_status, 'changed', changed, 'unchanged', same) where id = op;
  return (select summary from public.agency_bulk_operations where id = op) || jsonb_build_object('replayed', false);
end $$;

-- =============================================================== report figures
alter table public.report_metric_sources drop constraint if exists report_metric_sources_pending_check;
alter table public.report_metric_sources add constraint report_metric_sources_pending_check
  check (pending in ('agency_attempts', 'agency_not_connected', 'agency_followups', 'linkedin_pending', 'linkedin_followups', 'linkedin_not_responded'));

create or replace function public.report_pending(p_emp uuid, p_key text, p_date date)
returns jsonb language sql stable security definer set search_path = '' as $$
  with ids as (
    select a.prospect_id::text as id from public.agency_activities a join public.agency_prospects p on p.id = a.prospect_id
      where p_key = 'agency_attempts' and a.kind = 'contact_attempt' and a.resolved_at is null and a.actor = p_emp
    union all
    select p.id::text from public.agency_prospects p
      where p_key = 'agency_not_connected' and p.assigned_officer = p_emp and p.contact_status <> 'connected'
        and p.stage not in ('onboarded', 'closed', 'inactive')
    union all
    select t.id::text from public.agency_tasks t
      where p_key = 'agency_followups' and t.status = 'open' and coalesce(t.assigned_to, t.created_by) = p_emp and t.due_date <= p_date
    union all
    -- Pending contacts: not attempted yet (current stage Pending).
    select l.id::text from public.linkedin_prospects l
      where p_key = 'linkedin_pending' and l.assigned_to = p_emp and l.status <> 'converted' and l.pipeline_stage = 'pending'
    union all
    -- Not responded: attempted, no response yet (current stage).
    select l.id::text from public.linkedin_prospects l
      where p_key = 'linkedin_not_responded' and l.assigned_to = p_emp and l.status <> 'converted' and l.pipeline_stage = 'not_responded'
    union all
    select l.id::text from public.linkedin_prospects l
      where p_key = 'linkedin_followups' and l.assigned_to = p_emp and l.status <> 'converted' and l.pipeline_stage in ('pending', 'not_responded', 'positive')
        and l.next_follow_up is not null and l.next_follow_up <= p_date
  )
  select jsonb_build_object('value', count(*), 'kind', 'pending', 'pending', p_key, 'ids', coalesce(jsonb_agg(id), '[]')) from ids;
$$;
revoke all on function public.report_pending(uuid, text, date) from public, anon, authenticated;

-- New template versions with "Not responded" right after "Pending contacts" (submitted reports keep their version).
insert into public.report_templates (id, version, name, sections)
select t.id, t.version + 1, t.name, (
  select jsonb_agg(case when s ->> 'id' = 'linkedin' then jsonb_set(s, '{fields}', (
      select jsonb_agg(f order by o) from (
        select case when f ->> 'key' = 'li_pending' then jsonb_set(f, '{label}', '"Pending contacts (not attempted)"') else f end as f, o * 10 as o
        from jsonb_array_elements(s -> 'fields') with ordinality as x(f, o)
        union all
        select '{"key":"li_not_responded","type":"count","label":"Not responded"}'::jsonb, (select o * 10 + 5 from jsonb_array_elements(s -> 'fields') with ordinality as y(f, o) where f ->> 'key' = 'li_pending')
      ) z)) else s end order by ord)
  from jsonb_array_elements(t.sections) with ordinality as e(s, ord))
from public.report_templates t
where t.id in ('partnership_officer', 'senior_recruitment_manager')
  and t.version = (select max(version) from public.report_templates x where x.id = t.id)
  and exists (select 1 from jsonb_array_elements(t.sections) s, jsonb_array_elements(s -> 'fields') f where f ->> 'key' = 'li_pending')
  and not exists (select 1 from jsonb_array_elements(t.sections) s, jsonb_array_elements(s -> 'fields') f where f ->> 'key' = 'li_not_responded')
on conflict (id, version) do nothing;
insert into public.report_metric_sources (template_id, field_key, kind, activity_types, workload, pending) values
  ('partnership_officer', 'li_not_responded', 'pending', '{}', null, 'linkedin_not_responded'),
  ('senior_recruitment_manager', 'li_not_responded', 'pending', '{}', null, 'linkedin_not_responded')
on conflict (template_id, field_key) do update set kind = excluded.kind, activity_types = excluded.activity_types, workload = excluded.workload, pending = excluded.pending;

-- Day-end: Pending and Not responded prospects stay eligible — one next-action date each (unchanged rule).
create or replace function public.rollover_pending_work(p_day date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d date := coalesce(p_day, public.company_today()); n int := 0; li int := 0; t record; nd date;
begin
  if auth.uid() is not null and not public.is_super_admin() then raise exception 'Not allowed'; end if;
  for t in select id, coalesce(assigned_to, created_by) emp from public.agency_tasks
           where status = 'open' and due_date <= d and (carried_over_to is null or carried_over_to <= d) for update loop
    update public.agency_tasks set carried_over_to = public.next_working_day(t.emp, d), carry_count = carry_count + 1 where id = t.id;
    n := n + 1;
  end loop;
  for t in select id, assigned_to from public.linkedin_prospects
           where status <> 'converted' and pipeline_stage in ('pending', 'not_responded') and next_follow_up is null and assigned_to is not null
           for update loop
    nd := public.next_working_day(t.assigned_to, d);
    update public.linkedin_prospects set next_follow_up = nd, next_follow_up_auto = true, updated_at = now() where id = t.id;
    perform public.linkedin_log(t.id, 'follow_up_date', 'No response yet — carried to the next working day', jsonb_build_object('next_follow_up', nd, 'auto', true), null);
    li := li + 1;
  end loop;
  return jsonb_build_object('day', d, 'carried', n, 'linkedin_scheduled', li);
end $$;

-- Current LinkedIn figures for one employee (or the whole team for administrators): one stage per prospect.
create or replace function public.linkedin_summary(p_date date default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as u, public.agency_manager() as all_rows, coalesce(p_date, public.company_today()) as d),
  l as (select x.* from public.linkedin_prospects x, me where public.linkedin_can_see(x.assigned_to, x.created_by) and (me.all_rows or x.assigned_to = me.u))
  select jsonb_build_object(
    'pending', (select count(*) from l where status <> 'converted' and pipeline_stage = 'pending'),
    'not_responded', (select count(*) from l where status <> 'converted' and pipeline_stage = 'not_responded'),
    'positive', (select count(*) from l where pipeline_stage = 'positive'),
    'closed', (select count(*) from l where pipeline_stage = 'closed'),
    'connected', (select count(*) from l where contact_status = 'connected'),
    'follow_ups_today', (select count(distinct w.entity_id) from public.work_activities w, me
                         where w.activity_type = 'linkedin_followup' and w.voided_at is null and w.report_date = me.d and w.entity_id in (select id::text from l)),
    'due', (select count(*) from l, me where status <> 'converted' and pipeline_stage <> 'closed' and next_follow_up is not null and next_follow_up <= me.d))
  where public.agency_access();
$$;

do $$
declare f text;
begin
  foreach f in array array['set_linkedin_contact_status(uuid, text, text, uuid)', 'log_linkedin_activity(uuid, text, text, date, uuid)',
                           'set_linkedin_stage(uuid, text, text, date, uuid)', 'convert_linkedin_prospect(uuid, jsonb)',
                           'set_agency_contact_status(uuid, text, text)', 'rollover_pending_work(date)', 'linkedin_summary(date)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- =============================================================== reconcile existing data (voids only; logged)
create table if not exists public.linkedin_reconciliation (
  id      bigint generated always as identity primary key,
  run_at  timestamptz not null default now(),
  item    text not null,
  count   integer not null,
  detail  jsonb
);
alter table public.linkedin_reconciliation enable row level security;
revoke all on public.linkedin_reconciliation from anon, authenticated;
grant select on public.linkedin_reconciliation to authenticated;
drop policy if exists "linkedin reconciliation: admins" on public.linkedin_reconciliation;
create policy "linkedin reconciliation: admins" on public.linkedin_reconciliation for select to authenticated using (public.agency_manager());

-- Safe to run again (only touches what is still wrong). Super Admins or the database owner.
create or replace function public.reconcile_linkedin_reporting()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n int; m int; k int; flagged jsonb;
begin
  if auth.uid() is not null and not public.is_super_admin() then raise exception 'Not allowed'; end if;
  -- 1. One follow-up credit per prospect per reporting day: void the later duplicates.
  with dup as (
    select id from (select w.id, row_number() over (partition by w.entity_id, w.report_date order by w.occurred_at, w.id) rn
                    from public.work_activities w where w.activity_type = 'linkedin_followup' and w.voided_at is null and w.entity_type = 'linkedin' and w.entity_id is not null) x
    where rn > 1)
  update public.work_activities w set voided_at = now(), void_reason = 'Duplicate follow-up for the same prospect on the same day (0048)' from dup where w.id = dup.id;
  get diagnostics n = row_count;
  -- 2. Positive and Closed credited for one prospect on the same day: keep the one matching the current stage.
  with pairs as (
    select p.entity_id, p.report_date from public.work_activities p join public.work_activities c
      on c.entity_id = p.entity_id and c.report_date = p.report_date and c.activity_type = 'linkedin_closed' and c.voided_at is null
    where p.activity_type = 'linkedin_positive' and p.voided_at is null and p.entity_type = 'linkedin'),
  v as (
    select w.id from public.work_activities w join pairs on pairs.entity_id = w.entity_id and pairs.report_date = w.report_date
    join public.linkedin_prospects l on l.id::text = w.entity_id
    where w.voided_at is null and ((w.activity_type = 'linkedin_closed' and l.pipeline_stage = 'positive') or (w.activity_type = 'linkedin_positive' and l.pipeline_stage = 'closed')))
  update public.work_activities w set voided_at = now(), void_reason = 'Positive and Closed on the same day: kept the current stage (0048)' from v where w.id = v.id;
  get diagnostics m = row_count;
  -- 3. Moved to the Agency List without a New partners contacted credit: credit the employee who moved it, on that day.
  with c as (
    select l.id, l.agency_id, l.converted_by, l.converted_at, coalesce(a.company_name, l.name) nm from public.linkedin_prospects l
    join public.agency_prospects a on a.id = l.agency_id
    join public.employees e on e.id = l.converted_by
    where l.status = 'converted' and l.converted_at is not null and a.contact_status = 'connected'
      and not exists (select 1 from public.work_activities w where w.dedupe_key = 'agency-contact:' || l.agency_id))
  insert into public.work_activities (employee_id, designation_id, activity_type, source, entity_type, entity_id, partner_id, quantity, note, report_date, occurred_at, dedupe_key)
  select c.converted_by, (select designation_id from public.employees where id = c.converted_by), 'partner_contact', 'crm', 'agency', c.agency_id::text, null, 1, c.nm,
         (c.converted_at at time zone public.company_tz())::date, c.converted_at, 'agency-contact:' || c.agency_id
  from c on conflict (dedupe_key) do nothing;
  get diagnostics k = row_count;
  -- 4. For review: a Connected contact whose only "connection" was recorded with a follow-up before 0046 cannot be told apart safely.
  select coalesce(jsonb_agg(jsonb_build_object('prospect', l.id, 'reference', l.reference)), '[]') into flagged
  from public.linkedin_prospects l
  where l.contact_status = 'connected' and not exists (select 1 from public.linkedin_activities a where a.prospect_id = l.id and a.kind in ('contact_status', 'contact_correction'));
  insert into public.linkedin_reconciliation (item, count, detail) values
    ('duplicate_followups_voided', n, null), ('positive_closed_same_day_voided', m, null), ('conversion_contact_credits_added', k, null),
    ('connected_without_explicit_record', jsonb_array_length(flagged), flagged);
  return jsonb_build_object('duplicate_followups_voided', n, 'positive_closed_same_day_voided', m, 'conversion_contact_credits_added', k,
                            'connected_without_explicit_record', jsonb_array_length(flagged));
end $$;
revoke all on function public.reconcile_linkedin_reporting() from public, anon;
grant execute on function public.reconcile_linkedin_reporting() to authenticated;
select public.reconcile_linkedin_reporting();
