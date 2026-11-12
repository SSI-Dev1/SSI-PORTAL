-- 0032_partner_commission_preview.sql — run after 0031_commission_partner_view_bulk.sql
-- (Supabase SQL Editor: Save this query as "0032_partner_commission_preview")
--
-- The partner Commission page could not be checked from "Preview partner portal": the preview
-- keeps the staff member's own account, and my_partner_commissions() only answers a Partner
-- Admin about their own organisation. This adds preview_partner_commissions(partner) for staff
-- with commission access. It returns exactly the same restricted columns the partner receives —
-- no other tiers, routes, portal names, SSI GLOBAL values or remarks — built by one shared
-- internal function so the two views can never drift apart.
-- Safe to run more than once.

-- Internal row builder: not callable by any client role.
create or replace function public.partner_commission_rows(p_partner text)
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
  where a.status = 'active' and a.partner_id = p_partner
    and (a.valid_to is null or a.valid_to >= public.company_today())
    -- an unreadable sheet value is never shown as if it were an agreed rate
    and (a.is_custom or (tr.value_kind is not null and tr.value_kind <> 'unclear'))
  order by c.name, r.university_name;
$$;
revoke all on function public.partner_commission_rows(text) from public, anon, authenticated;

-- Partner Admin, own organisation, while SSI GLOBAL shows commission to them (same as 0031).
create or replace function public.my_partner_commissions()
returns table (assignment_id text, university text, study_level text, variant text, intake text, country text,
               tier text, is_custom boolean, commission_kind text, commission_value numeric, currency text,
               conditions text, valid_from date, valid_to date, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select * from public.partner_commission_rows(public.my_partner_id())
  where public.my_partner_id() is not null and public.is_partner_admin()
    and public.can_view_commission(public.my_partner_id());
$$;
revoke all on function public.my_partner_commissions() from public, anon;
grant execute on function public.my_partner_commissions() to authenticated;

-- Staff preview of what one partner sees. Needs commission catalogue access (Super Admin, or a
-- commission_view / tag / manage / edit permission). Partners can never call it usefully.
create or replace function public.preview_partner_commissions(p_partner text)
returns table (assignment_id text, university text, study_level text, variant text, intake text, country text,
               tier text, is_custom boolean, commission_kind text, commission_value numeric, currency text,
               conditions text, valid_from date, valid_to date, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.commission_can('commission_view') then raise exception 'Not allowed to preview partner commission'; end if;
  return query select * from public.partner_commission_rows(p_partner);
end $$;
revoke all on function public.preview_partner_commissions(text) from public, anon;
grant execute on function public.preview_partner_commissions(text) to authenticated;
