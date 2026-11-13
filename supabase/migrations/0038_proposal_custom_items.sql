-- 0038_proposal_custom_items.sql — run after 0037_hide_commission_tiers.sql
-- (Supabase SQL Editor: Save this query as "0038_proposal_custom_items")
--
-- Custom commission proposals, university by university. Before, "Custom commission" took ONE
-- value and applied it to every selected university. Now the officer picks a base tier, every
-- selected commission record (each university / level / campus / intake rule is its own record)
-- starts at that tier's partner rate, and each one can be changed on its own.
-- * Every proposal stores its lines in agency_proposal_items: record, base tier, base commission,
--   final commission, kind, currency, conditions, customised, who prepared it, approval status.
--   The master catalogue (tiers and rates) is never changed by a proposal.
-- * Approval: a line ABOVE its base rate, or a line with no base rate for that tier, needs a
--   commission manager's approval before the proposal can be sent. Lower or equal lines do not.
--   A commission manager's own proposal is approved as prepared. The kind (percent / amount) and
--   currency always follow the base rate — an amount is never turned into a percentage.
-- * Standard-tier proposals also store their lines (all "not customised").
-- Safe to run more than once.

create table if not exists public.agency_proposal_items (
  id             bigint generated always as identity primary key,
  proposal_id    uuid not null references public.agency_proposals (id) on delete cascade,
  record_id      text not null references public.commission_records (id),
  university_id  text,
  base_tier_id   text references public.commission_tiers (id),
  base_kind      text check (base_kind in ('percent', 'amount')),
  base_value     numeric(14, 4),
  final_kind     text not null check (final_kind in ('percent', 'amount')),
  final_value    numeric(14, 4) not null check (final_value > 0),
  currency       text check (currency is null or currency ~ '^[A-Z]{3}$'),
  conditions     text,
  customized     boolean not null default false,
  needs_approval boolean not null default false,
  approval_status text not null default 'not_required' check (approval_status in ('not_required', 'pending', 'approved', 'rejected')),
  modified_by    uuid,
  created_at     timestamptz not null default now(),
  unique (proposal_id, record_id)
);
alter table public.agency_proposal_items enable row level security;
revoke all on public.agency_proposal_items from anon, authenticated;
grant select on public.agency_proposal_items to authenticated;
drop policy if exists "proposal items: read" on public.agency_proposal_items;
create policy "proposal items: read" on public.agency_proposal_items for select to authenticated
  using (exists (select 1 from public.agency_proposals r where r.id = proposal_id
                 and (public.agency_can_see(r.prospect_id) or (public.commission_can('commission_manage') and r.status = 'pending_approval'))));

create or replace function public.create_agency_proposal(p_prospect uuid, p jsonb, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a record; t record; tier record; ex record; rid uuid; ref text; arr jsonb; unis jsonb; kind text; em text; ids text[];
  it jsonb; o record; rec record; fv numeric; fk text; fc text; lines jsonb := '[]'; approve boolean := false; manager boolean;
  missing text[] := '{}'; st text;
begin
  if not public.agency_can_see(p_prospect) then raise exception 'Not allowed to prepare a proposal for this agency'; end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  select * into ex from public.agency_proposals where request_key = p_request;
  if ex.id is not null then return jsonb_build_object('id', ex.id, 'reference', ex.reference, 'status', ex.status, 'duplicate', true); end if;
  select * into a from public.agency_prospects where id = p_prospect for update;
  if a.stage in ('closed', 'onboarded') then raise exception 'This agency is %; a proposal cannot be sent', replace(a.stage, '_', ' '); end if;
  manager := public.commission_can('commission_manage');

  em := lower(coalesce(public.agency_clean(p, 'recipient_email', 200), a.email));
  if coalesce(public.agency_clean(p, 'company_name', 160), a.company_name) is null then missing := array_append(missing, 'agency / company name'); end if;
  if coalesce(public.agency_clean(p, 'recipient_name', 120), a.contact_name) is null then missing := array_append(missing, 'primary contact name'); end if;
  if em is null or em !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then missing := array_append(missing, 'valid recipient email'); end if;
  if coalesce(public.agency_clean(p, 'country', 80), a.country) is null then missing := array_append(missing, 'country'); end if;
  kind := p ->> 'arrangement';
  if kind not in ('tier', 'custom') then missing := array_append(missing, 'commission arrangement'); end if;
  if kind = 'custom' then
    select array_agg(distinct x ->> 'record_id') into ids from jsonb_array_elements(coalesce(p -> 'items', '[]')) x;
  else
    select array_agg(distinct x) into ids from jsonb_array_elements_text(coalesce(p -> 'record_ids', '[]')) x;
  end if;
  if coalesce(cardinality(ids), 0) = 0 then missing := array_append(missing, 'at least one university'); end if;
  if cardinality(ids) > 300 then raise exception 'Select at most 300 universities in one proposal'; end if;
  select * into t from public.proposal_terms where id = (p ->> 'terms_id')::bigint and active;
  if t.id is null then missing := array_append(missing, 'approved proposal terms'); end if;
  if cardinality(missing) > 0 then raise exception 'MISSING: Before sending, add: %', array_to_string(missing, ', '); end if;

  select * into tier from public.commission_tiers where id = coalesce(p ->> 'base_tier_id', p ->> 'tier_id') and active;
  if tier.id is null then raise exception 'Choose a commission tier'; end if;

  if kind = 'tier' then
    select jsonb_agg(jsonb_build_object('record_id', o2.record_id, 'university', o2.university, 'country', o2.country, 'study_level', o2.study_level,
             'variant', o2.variant, 'intake', o2.intake, 'commission_kind', o2.commission_kind, 'commission_value', o2.commission_value,
             'currency', o2.currency, 'conditions', o2.conditions) order by o2.country, o2.university)
      into unis from public.proposal_commission_options(null) o2 where o2.record_id = any (ids) and o2.tier_id = tier.id;
    if coalesce(jsonb_array_length(unis), 0) <> cardinality(ids) then
      raise exception 'Some selected universities have no valid % rate. Remove them or choose another tier.', tier.label;
    end if;
    select jsonb_agg(u || jsonb_build_object('base_kind', u ->> 'commission_kind', 'base_value', u -> 'commission_value', 'customized', false, 'needs_approval', false))
      into lines from jsonb_array_elements(unis) u;
    arr := jsonb_build_object('kind', 'tier', 'tier_id', tier.id, 'tier_label', tier.label, 'universities', unis);
  else
    -- one line per commission record, each with its own final value
    for it in select * from jsonb_array_elements(p -> 'items') loop
      if exists (select 1 from jsonb_array_elements(lines) l where l ->> 'record_id' = it ->> 'record_id') then continue; end if;
      select r.*, c.name as country_name into rec from public.commission_records r join public.commission_countries c on c.id = r.country_id
      where r.id = it ->> 'record_id' and r.status = 'active';
      if rec.id is null then raise exception 'A selected university is not an active commission record'; end if;
      select * into o from public.proposal_commission_options(null) x where x.record_id = rec.id and x.tier_id = tier.id;
      fv := nullif(btrim(coalesce(it ->> 'value', '')), '')::numeric;
      if o.record_id is not null then
        fk := o.commission_kind; fc := o.currency;          -- kind and currency follow the base rate
      else
        fk := it ->> 'kind'; fc := upper(nullif(btrim(coalesce(it ->> 'currency', '')), ''));   -- no base: an authorised decision
        if fk is null or fk not in ('percent', 'amount') then raise exception '% has no % rate: choose percent or amount for it', rec.university_name, tier.label; end if;
      end if;
      if fv is null or fv <= 0 then raise exception 'Enter the commission for %', rec.university_name; end if;
      if fk = 'percent' and fv > 100 then raise exception 'The commission for % cannot be more than 100%%', rec.university_name; end if;
      if fk = 'amount' and (fc is null or fc !~ '^[A-Z]{3}$') then raise exception 'Enter the currency for %', rec.university_name; end if;
      lines := lines || jsonb_build_object('record_id', rec.id, 'university', rec.university_name, 'country', rec.country_name, 'study_level', rec.study_level,
        'variant', rec.variant, 'intake', rec.intake, 'commission_kind', fk, 'commission_value', fv, 'currency', case when fk = 'amount' then fc end,
        'conditions', coalesce(o.conditions, nullif(rec.conditions, '')), 'base_kind', o.commission_kind, 'base_value', o.commission_value,
        'customized', o.record_id is null or fv <> o.commission_value, 'needs_approval', o.record_id is null or fv > o.commission_value,
        'university_id', rec.university_id);
    end loop;
    select bool_or((l ->> 'needs_approval')::boolean) into approve from jsonb_array_elements(lines) l;
    select jsonb_agg(l - 'base_kind' - 'base_value' - 'customized' - 'needs_approval' - 'university_id' order by l ->> 'country', l ->> 'university')
      into unis from jsonb_array_elements(lines) l;
    arr := jsonb_build_object('kind', 'custom', 'base_tier_id', tier.id, 'tier_label', 'Custom (from ' || tier.label || ')', 'universities', unis);
  end if;
  st := case when approve and not manager then 'pending_approval' else 'draft' end;

  loop
    ref := public.agency_ref('PP');
    exit when not exists (select 1 from public.agency_proposals where reference = ref);
  end loop;
  insert into public.agency_proposals (reference, prospect_id, status, company_name, recipient_name, recipient_email, country, arrangement,
    terms_id, terms_title, terms_body, message, request_key, created_by, approved_by, approved_at)
  values (ref, p_prospect, st,
    coalesce(public.agency_clean(p, 'company_name', 160), a.company_name), coalesce(public.agency_clean(p, 'recipient_name', 120), a.contact_name),
    em, coalesce(public.agency_clean(p, 'country', 80), a.country), arr, t.id, t.title, t.body, public.agency_clean(p, 'message', 2000), p_request, auth.uid(),
    case when approve and manager then auth.uid() end, case when approve and manager then now() end)
  returning id into rid;
  insert into public.agency_proposal_items (proposal_id, record_id, university_id, base_tier_id, base_kind, base_value, final_kind, final_value, currency,
    conditions, customized, needs_approval, approval_status, modified_by)
  select rid, l ->> 'record_id', coalesce(l ->> 'university_id', (select university_id from public.commission_records where id = l ->> 'record_id')), tier.id,
         l ->> 'base_kind', (l ->> 'base_value')::numeric, l ->> 'commission_kind', (l ->> 'commission_value')::numeric, l ->> 'currency', l ->> 'conditions',
         (l ->> 'customized')::boolean, (l ->> 'needs_approval')::boolean,
         case when not (l ->> 'needs_approval')::boolean then 'not_required' when manager then 'approved' else 'pending' end, auth.uid()
  from jsonb_array_elements(lines) l;
  update public.agency_prospects set company_name = coalesce(company_name, public.agency_clean(p, 'company_name', 160)),
    contact_name = coalesce(contact_name, public.agency_clean(p, 'recipient_name', 120)), email = coalesce(email, em),
    country = coalesce(country, public.agency_clean(p, 'country', 80)), selected_tier = arr ->> 'tier_label', updated_at = now()
  where id = p_prospect;
  perform public.agency_log(p_prospect, case when st = 'pending_approval' then 'proposal_needs_approval' else 'proposal_prepared' end, null,
    jsonb_build_object('proposal_id', rid, 'reference', ref, 'arrangement', arr ->> 'tier_label', 'universities', jsonb_array_length(unis),
                       'customized', (select count(*) from jsonb_array_elements(lines) l where (l ->> 'customized')::boolean)));
  if st = 'pending_approval' then
    perform public.notify((select coalesce(array_agg(p2.id), '{}') from public.profiles p2 where p2.status = 'active'
                             and (p2.role = 'super_admin' or 'commission_manage' = any (coalesce(p2.permissions, '{}')))),
                          'partner', 'Custom commission proposal needs approval', coalesce(a.company_name, a.reference) || ' · ' || ref, 'agencies/' || p_prospect);
  end if;
  return jsonb_build_object('id', rid, 'reference', ref, 'status', st, 'duplicate', false);
end $$;

create or replace function public.decide_agency_proposal(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if not public.commission_can('commission_manage') then raise exception 'Only commission managers can approve custom commission proposals'; end if;
  select * into r from public.agency_proposals where id = p_id for update;
  if r.id is null or r.status <> 'pending_approval' then raise exception 'This proposal is not waiting for approval'; end if;
  update public.agency_proposals set status = case when p_approve then 'draft' else 'cancelled' end, approved_by = auth.uid(), approved_at = now(), updated_at = now() where id = p_id;
  update public.agency_proposal_items set approval_status = case when p_approve then 'approved' else 'rejected' end where proposal_id = p_id and needs_approval;
  perform public.agency_log(r.prospect_id, case when p_approve then 'proposal_approved' else 'proposal_rejected' end, p_note, jsonb_build_object('proposal_id', p_id, 'reference', r.reference));
end $$;

revoke all on function public.create_agency_proposal(uuid, jsonb, uuid) from public, anon;
grant execute on function public.create_agency_proposal(uuid, jsonb, uuid) to authenticated;
revoke all on function public.decide_agency_proposal(uuid, boolean, text) from public, anon;
grant execute on function public.decide_agency_proposal(uuid, boolean, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agency_proposal_items') then
    alter publication supabase_realtime add table public.agency_proposal_items;
  end if;
end $$;
