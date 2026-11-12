-- 0031_commission_partner_view_bulk.sql — run after 0030_partner_registration.sql
-- (Supabase SQL Editor: Save this query as "0031_commission_partner_view_bulk")
--
-- 1. Partner commission view, strictly limited. my_partner_commissions() used to also return the
--    processing route (direct / portal), the portal name and the raw sheet text. It now returns
--    only: university, level / campus, intake, country, the assigned tier, that tier's partner
--    commission (or the partner's custom commission), currency, partner-facing conditions and
--    validity. Never other tiers, SSI GLOBAL's commission or profit, routes or portal names,
--    internal remarks or other partners.
-- 2. Bulk assignment for commission managers: preview, then apply one tier (with per-university
--    overrides) to many commission records for one partner in a single transaction. Custom
--    agreements and changes waiting for approval are never touched; existing standard
--    agreements change only when the admin explicitly confirms overwriting.
-- Safe to run more than once.

drop function if exists public.my_partner_commissions();
create function public.my_partner_commissions()
returns table (assignment_id text, university text, study_level text, variant text, intake text, country text,
               tier text, is_custom boolean, commission_kind text, commission_value numeric, currency text,
               conditions text, valid_from date, valid_to date, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id, r.university_name, r.study_level, r.variant, r.intake, c.name,
         t.label, a.is_custom,
         case when a.is_custom then a.custom_kind else tr.value_kind end,
         case when a.is_custom then a.custom_value else tr.value end,
         case when a.is_custom then a.custom_currency when tr.value_kind = 'amount' then coalesce(tr.currency, r.currency) end,
         nullif(concat_ws(E'\n', nullif(r.conditions, ''), case when not a.is_custom then nullif(tr.note, '') end, nullif(a.partner_conditions, '')), ''),
         a.valid_from, a.valid_to, a.updated_at
  from public.partner_commission_assignments a
  join public.commission_records r on r.id = a.record_id and r.status = 'active'
  join public.commission_countries c on c.id = r.country_id
  join public.commission_tiers t on t.id = a.tier_id
  left join public.commission_tier_rates tr on tr.record_id = a.record_id and tr.tier_id = a.tier_id
  where a.status = 'active' and a.partner_id = public.my_partner_id() and public.is_partner_admin()
    and public.can_view_commission(a.partner_id)
    and (a.valid_to is null or a.valid_to >= public.company_today())
    -- an unreadable sheet value is never shown as if it were an agreed rate
    and (a.is_custom or (tr.value_kind is not null and tr.value_kind <> 'unclear'))
  order by c.name, r.university_name;
$$;
revoke all on function public.my_partner_commissions() from public, anon;
grant execute on function public.my_partner_commissions() to authenticated;

-- =============================================================== bulk assignment
-- p_items: [{"record_id": "...", "tier_id": "tier_1"}, ...] (max 2000).
-- Returns one result per item: new | unchanged | change | custom_kept | pending_kept | no_tier_data | inactive | unknown.
create or replace function public.preview_bulk_partner_commissions(p_partner text, p_items jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare it jsonb; r record; tr record; cur record; pend boolean; res text; out jsonb := '[]'; seen text[] := '{}';
begin
  if not public.commission_can('commission_manage') then raise exception 'Only commission managers can assign commissions in bulk'; end if;
  if not exists (select 1 from public.partners where id = p_partner) then raise exception 'Partner agency not found'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Select at least one university'; end if;
  if jsonb_array_length(p_items) > 2000 then raise exception 'Select at most 2,000 records at a time'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    continue when (it ->> 'record_id') = any (seen);
    seen := seen || (it ->> 'record_id');
    select * into r from public.commission_records where id = it ->> 'record_id';
    select * into tr from public.commission_tier_rates where record_id = r.id and tier_id = it ->> 'tier_id';
    select * into cur from public.partner_commission_assignments where partner_id = p_partner and record_id = r.id and status = 'active';
    pend := exists (select 1 from public.partner_commission_assignments where partner_id = p_partner and record_id = r.id and status = 'pending_approval');
    res := case
      when r.id is null then 'unknown'
      when r.status <> 'active' then 'inactive'
      when not exists (select 1 from public.commission_tiers where id = it ->> 'tier_id' and active) or tr.record_id is null or tr.value_kind = 'unclear' then 'no_tier_data'
      when cur.id is not null and cur.is_custom then 'custom_kept'
      when pend then 'pending_kept'
      when cur.id is null then 'new'
      when cur.tier_id = it ->> 'tier_id' then 'unchanged'
      else 'change' end;
    out := out || jsonb_build_object('record_id', it ->> 'record_id', 'tier_id', it ->> 'tier_id', 'result', res, 'current_tier', cur.tier_id);
  end loop;
  return jsonb_build_object('items', out, 'counts', (select jsonb_object_agg(k, n) from (select e ->> 'result' as k, count(*) as n from jsonb_array_elements(out) e group by 1) x));
end $$;

create or replace function public.bulk_assign_partner_commissions(p_partner text, p_items jsonb, p_overwrite boolean default false, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pv jsonb; it jsonb; cur record; done_new int := 0; done_change int := 0; skipped int := 0; res text;
begin
  pv := public.preview_bulk_partner_commissions(p_partner, p_items);   -- re-checks permission and every item
  perform pg_advisory_xact_lock(hashtext('commission-bulk:' || p_partner));
  for it in select * from jsonb_array_elements(pv -> 'items') loop
    res := it ->> 'result';
    if res = 'new' then
      insert into public.partner_commission_assignments (partner_id, record_id, tier_id, status, assigned_by, updated_by, decided_by, decided_at, decision_note)
      values (p_partner, it ->> 'record_id', it ->> 'tier_id', 'active', auth.uid(), auth.uid(), auth.uid(), now(), coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Bulk assignment'))
      on conflict do nothing;
      if found then done_new := done_new + 1; else skipped := skipped + 1; end if;
    elsif res = 'change' and p_overwrite then
      select * into cur from public.partner_commission_assignments where partner_id = p_partner and record_id = it ->> 'record_id' and status = 'active' for update;
      if cur.id is null or cur.is_custom then skipped := skipped + 1; continue; end if;
      update public.partner_commission_assignments set status = 'inactive', updated_by = auth.uid(), updated_at = now(), decision_note = 'Replaced by bulk assignment' where id = cur.id;
      insert into public.partner_commission_assignments (partner_id, record_id, tier_id, status, replaces_id, assigned_by, updated_by, decided_by, decided_at, decision_note,
                                                         valid_from, valid_to, partner_conditions, internal_remarks)
      values (p_partner, it ->> 'record_id', it ->> 'tier_id', 'active', cur.id, auth.uid(), auth.uid(), auth.uid(), now(), coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Bulk assignment'),
              cur.valid_from, cur.valid_to, cur.partner_conditions, cur.internal_remarks);
      done_change := done_change + 1;
    elsif res <> 'unchanged' then
      skipped := skipped + 1;
    end if;
  end loop;
  perform public.match_application_commissions(p_partner);
  return jsonb_build_object('created', done_new, 'changed', done_change, 'skipped', skipped,
    'unchanged', coalesce((pv -> 'counts' ->> 'unchanged')::int, 0), 'counts', pv -> 'counts');
end $$;

revoke all on function public.preview_bulk_partner_commissions(text, jsonb) from public, anon;
revoke all on function public.bulk_assign_partner_commissions(text, jsonb, boolean, text) from public, anon;
grant execute on function public.preview_bulk_partner_commissions(text, jsonb) to authenticated;
grant execute on function public.bulk_assign_partner_commissions(text, jsonb, boolean, text) to authenticated;
