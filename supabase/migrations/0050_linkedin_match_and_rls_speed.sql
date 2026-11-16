-- Production fixes (16 Nov 2026).
--
-- 1. LinkedIn "Move to Agency List" attached new agencies to unrelated existing ones.
--    convert_linkedin_prospect linked to any agency sharing the phone number (or email), whatever its
--    name. Live data showed four differently named prospects all linked to one agency because staff
--    reuse an office/test number, so the new agency never appeared in the Agency List.
--    Now: the same name — or the same phone/email with one name containing the other ("Hari
--    Overseas" / "Hari Overseas Pvt") — links (no duplicate); a phone/email used by an unrelated agency stops
--    with CONTACT_IN_USE naming that agency, and the employee can confirm "Create as a separate
--    agency" (p.allow_shared_contact). The prospect, its history and reporting are unchanged.
--    Positive Response (set_linkedin_stage) leaves such a prospect "Agency details needed" instead
--    of failing the stage change.
--
-- 2. Slow loading. No row-level security policy wrapped its helper calls in (select …), so
--    is_active_user(), staff_can('…'), auth.uid() and the like ran once per ROW (6,000 times for a
--    course-intake list; 3–6 s per request). Every policy is rewritten so calls that do not depend on
--    the row are evaluated once per query (an InitPlan). Same rules, same results — only the
--    evaluation count changes. agency_activities read checked agency_can_see(prospect_id) per row; its
--    existence test is already guaranteed by the foreign key, so it now checks agency_access() once.

-- ============================================================ 1. LinkedIn conversion
create or replace function public.convert_linkedin_prospect(p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare clash record; l record; nm text; poc text; ph text; digits text; em text; url text; extra text; ex uuid; aid uuid; ref text; linked boolean := false; missing text[] := '{}';
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
  -- Same agency = same name. A phone number or email alone is not proof: teams share office and
  -- test numbers, and linking on them attached new agencies to unrelated ones (0050).
  select a.id into ex from public.agency_prospects a
  where public.agency_name_key(nm) is not null and public.agency_name_key(a.company_name) = public.agency_name_key(nm)
  order by a.created_at limit 1;
  -- Same phone or email and one name contains the other ("Hari Overseas" / "Hari Overseas Pvt"): same agency.
  if ex is null and char_length(coalesce(public.agency_suggest_key(nm), '')) >= 4 then
    select a.id into ex from public.agency_prospects a
    where ((char_length(digits) >= 8 and public.agency_digits(a.phone) = digits)
        or (char_length(digits) >= 10 and char_length(public.agency_digits(a.phone)) >= 10 and right(public.agency_digits(a.phone), 10) = right(digits, 10))
        or (em is not null and lower(a.email) = em))
      and char_length(coalesce(public.agency_suggest_key(a.company_name), '')) >= 4
      and (strpos(public.agency_suggest_key(a.company_name), public.agency_suggest_key(nm)) > 0
        or strpos(public.agency_suggest_key(nm), public.agency_suggest_key(a.company_name)) > 0)
    order by a.created_at limit 1;
  end if;
  if ex is null and nm is not null and coalesce(p ->> 'allow_shared_contact', 'false') <> 'true' then
    select a.id, a.reference, a.company_name into clash from public.agency_prospects a
    where (char_length(digits) >= 8 and public.agency_digits(a.phone) = digits)
       or (char_length(digits) >= 10 and char_length(public.agency_digits(a.phone)) >= 10 and right(public.agency_digits(a.phone), 10) = right(digits, 10))
       or (em is not null and lower(a.email) = em)
    order by a.created_at limit 1;
    if clash.id is not null then
      raise exception 'CONTACT_IN_USE: This phone number or email is already in the Agency List as % (%). Check it is a different agency, then choose "Create as a separate agency" — or correct the details.',
        clash.reference, clash.company_name
        using hint = clash.id::text;
    end if;
  end if;
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

revoke all on function public.convert_linkedin_prospect(uuid, jsonb) from public, anon;
grant execute on function public.convert_linkedin_prospect(uuid, jsonb) to authenticated;

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
      begin
        conv := public.convert_linkedin_prospect(p_id, '{}'::jsonb);
      exception when others then
        -- Phone / email already used by a differently named agency: the employee decides in Move to Agency List.
        if sqlerrm not like 'CONTACT_IN_USE:%' then raise; end if;
        conv := null;
        missing := array_append(missing, 'a check of the agency (its phone or email is already listed)');
      end;
      if conv is not null then
        update public.linkedin_prospects set conversion_pending = false where id = p_id;
        return jsonb_build_object('status', 'converted', 'stage', 'positive', 'agency_id', conv ->> 'agency_id', 'linked', conv -> 'linked', 'conversion_pending', false);
      end if;
    end if;
    update public.linkedin_prospects set conversion_pending = true, updated_at = now() where id = p_id;
    return jsonb_build_object('status', 'interested', 'stage', 'positive', 'conversion_pending', true, 'missing', to_jsonb(missing));
  end if;
  return jsonb_build_object('status', (select status from public.linkedin_prospects where id = p_id), 'stage', st, 'conversion_pending', false);
end $$;

revoke all on function public.set_linkedin_stage(uuid, text, text, date, uuid) from public, anon;
grant execute on function public.set_linkedin_stage(uuid, text, text, date, uuid) to authenticated;

-- ============================================================ 2. Row-level security evaluated once per query
do $do$
declare
  r record;
  names text;
  pat text;
  q text;
  c text;
  stmt text;
begin
  -- Functions whose result cannot depend on the row when called with no arguments or only literals.
  select string_agg(distinct p.proname, '|' order by p.proname) into names
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
  where n.nspname in ('public', 'auth') and p.prokind = 'f' and p.provolatile in ('s', 'i') and p.proname ~ '^[a-z_0-9]+$'
    and not p.proretset and t.typcategory <> 'A'   -- scalar results only (arrays are used with = ANY (…))
    -- every overload must be scalar too, so a name is never wrapped for an array-returning variant
    and not exists (select 1 from pg_proc p2 join pg_type t2 on t2.oid = p2.prorettype
                    where p2.proname = p.proname and p2.pronamespace = p.pronamespace and (p2.proretset or t2.typcategory = 'A'));
  pat := '((?:public\.|auth\.)?)\m(' || names || ')\(((?:''[^'']*''::text)(?:, ''[^'']*''::text)*)?\)';
  for r in select schemaname, tablename, policyname, qual, with_check from pg_policies where schemaname = 'public' loop
    q := case when r.qual is null then null else regexp_replace(r.qual, pat, '(SELECT \1\2(\3))', 'g') end;
    c := case when r.with_check is null then null else regexp_replace(r.with_check, pat, '(SELECT \1\2(\3))', 'g') end;
    if q is not distinct from r.qual and c is not distinct from r.with_check then continue; end if;
    stmt := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if q is not null then stmt := stmt || format(' using (%s)', q); end if;
    if c is not null then stmt := stmt || format(' with check (%s)', c); end if;
    execute stmt;
  end loop;
end
$do$;

drop policy if exists "agency activities: read" on public.agency_activities;
create policy "agency activities: read" on public.agency_activities for select
  using ((select public.agency_access()) and prospect_id is not null);
