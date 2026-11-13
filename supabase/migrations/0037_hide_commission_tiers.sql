-- 0037_hide_commission_tiers.sql — run after 0036_partnership_settings_fix.sql
-- (Supabase SQL Editor: Save this query as "0037_hide_commission_tiers")
--
-- Tier 1 / 2 / 3 (and "custom") are SSI GLOBAL's internal classification. Partners and agencies
-- must only see the commission they are offered, never which tier it comes from.
-- * The public proposal page (agency_proposal_for_token) now returns the universities and their
--   commission only — no tier id, tier label, arrangement kind or internal record ids.
-- * The Partner Portal Commission data (my_partner_commissions, and the staff preview of exactly
--   that view) no longer returns the tier or whether it is a custom agreement.
-- Nothing internal changes: tiers, rates, assignments, custom commissions and the stored proposal
-- snapshots stay as they are for SSI GLOBAL staff, calculation and audit.
-- Safe to run more than once.

-- =============================================================== partner commission (no tier)
drop function if exists public.my_partner_commissions();
drop function if exists public.preview_partner_commissions(text);
drop function if exists public.partner_commission_rows(text);

create function public.partner_commission_rows(p_partner text)
returns table (assignment_id text, university text, study_level text, variant text, intake text, country text,
               commission_kind text, commission_value numeric, currency text, conditions text, valid_from date, valid_to date, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id, r.university_name, r.study_level, r.variant, r.intake, c.name,
         case when a.is_custom then a.custom_kind else tr.value_kind end,
         case when a.is_custom then a.custom_value else tr.value end,
         case when a.is_custom then a.custom_currency when tr.value_kind = 'amount' then coalesce(tr.currency, r.currency) end,
         nullif(concat_ws(E'\n', nullif(r.conditions, ''), case when not a.is_custom then nullif(tr.note, '') end, nullif(a.partner_conditions, '')), ''),
         a.valid_from, a.valid_to, a.updated_at
  from public.partner_commission_assignments a
  join public.commission_records r on r.id = a.record_id and r.status = 'active'
  join public.commission_countries c on c.id = r.country_id
  left join public.commission_tier_rates tr on tr.record_id = a.record_id and tr.tier_id = a.tier_id
  where a.status = 'active' and a.partner_id = p_partner
    and (a.valid_to is null or a.valid_to >= public.company_today())
    and (a.is_custom or (tr.value_kind is not null and tr.value_kind <> 'unclear'))
  order by c.name, r.university_name;
$$;
revoke all on function public.partner_commission_rows(text) from public, anon, authenticated;

create function public.my_partner_commissions()
returns table (assignment_id text, university text, study_level text, variant text, intake text, country text,
               commission_kind text, commission_value numeric, currency text, conditions text, valid_from date, valid_to date, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select * from public.partner_commission_rows(public.my_partner_id())
  where public.my_partner_id() is not null and public.is_partner_admin()
    and public.can_view_commission(public.my_partner_id());
$$;
revoke all on function public.my_partner_commissions() from public, anon;
grant execute on function public.my_partner_commissions() to authenticated;

create function public.preview_partner_commissions(p_partner text)
returns table (assignment_id text, university text, study_level text, variant text, intake text, country text,
               commission_kind text, commission_value numeric, currency text, conditions text, valid_from date, valid_to date, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.commission_can('commission_view') then raise exception 'Not allowed to preview partner commission'; end if;
  return query select * from public.partner_commission_rows(p_partner);
end $$;
revoke all on function public.preview_partner_commissions(text) from public, anon;
grant execute on function public.preview_partner_commissions(text) to authenticated;

-- =============================================================== public proposal page (no tier)
-- Partner-facing fields of one university in a proposal snapshot.
create or replace function public.proposal_public_universities(p_arrangement jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'university', u ->> 'university', 'country', u ->> 'country', 'study_level', u ->> 'study_level', 'variant', u ->> 'variant',
           'intake', u ->> 'intake', 'commission_kind', u ->> 'commission_kind', 'commission_value', u -> 'commission_value',
           'currency', u ->> 'currency', 'conditions', u ->> 'conditions') order by ord), '[]')
  from jsonb_array_elements(coalesce(p_arrangement -> 'universities', '[]')) with ordinality as x(u, ord);
$$;
revoke all on function public.proposal_public_universities(jsonb) from public, anon, authenticated;

create or replace function public.agency_proposal_for_token(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select * into r from public.agency_proposals where token_hash = public.registration_token_hash(p_token);
  if r.id is null then return jsonb_build_object('state', 'invalid'); end if;
  if r.status = 'awaiting_confirmation' and r.expires_at < now() then
    update public.agency_proposals set status = 'expired', updated_at = now() where id = r.id;
    perform public.agency_log(r.prospect_id, 'proposal_expired', null, jsonb_build_object('proposal_id', r.id, 'reference', r.reference), null, null);
    r.status := 'expired';
  end if;
  if r.first_viewed_at is null then update public.agency_proposals set first_viewed_at = now() where id = r.id; end if;
  return jsonb_build_object('state', case r.status when 'awaiting_confirmation' then 'open' when 'confirmed' then 'confirmed' when 'declined' then 'declined'
           when 'expired' then 'expired' else 'closed' end,
    'reference', r.reference, 'company_name', r.company_name, 'recipient_name', r.recipient_name, 'country', r.country,
    'universities', public.proposal_public_universities(r.arrangement), 'terms_title', r.terms_title, 'terms_body', r.terms_body, 'message', r.message,
    'expires_at', r.expires_at, 'confirmed_at', r.confirmed_at, 'proposal_id', r.id);
end $$;
revoke all on function public.agency_proposal_for_token(text) from public, anon, authenticated;
