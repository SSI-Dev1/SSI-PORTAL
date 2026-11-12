-- 0033_partner_first_login.sql — run after 0032_partner_commission_preview.sql
-- (Supabase SQL Editor: Save this query as "0033_partner_first_login")
--
-- Fix: a partner account with a temporary password could not sign in. The login said "Portal
-- access for your organisation is currently disabled" instead of asking for a new password.
-- my_access().portal_open was my_partner_id() is not null, and since 0024 my_partner_id() is
-- null while must_change_password is set (no data access until the password is changed). The
-- sign-in checks portal_open before the password-change step, so it never got there.
--
-- portal_open now checks only the account and its organisation (active account, portal on, not
-- archived, not Inactive). Data access is unchanged: everything stays locked until the
-- temporary password is replaced.
-- Safe to run more than once.

drop function if exists public.my_access();
create function public.my_access()
returns table (role text, status text, permissions text[], partner_id text, partner_name text,
               partner_modules text[], portal_open boolean, must_change_password boolean, department text,
               employee boolean, designations text[], has_team boolean,
               partner_permissions text[], commission boolean)
language sql stable security definer set search_path = '' as $$
  select p.role, p.status, public.my_permissions(), p.partner_id, o.name,
         case when public.my_partner_id() is not null then o.modules else array[]::text[] end,
         p.role in ('partner_admin', 'partner_staff') and p.status = 'active' and o.id is not null
           and o.portal_enabled and o.archived_at is null and o.status <> 'Inactive',
         p.must_change_password, p.department,
         e.id is not null and public.is_staff(),
         case when e.id is not null and public.is_staff() then array[e.designation_id] || e.additional_designations else array[]::text[] end,
         public.is_staff() and exists (select 1 from public.employees r where r.reporting_manager_id = p.id),
         public.my_partner_permissions(),
         case when p.partner_id is not null then public.can_view_commission(p.partner_id) else public.can_view_commission(null) or public.is_super_admin() or public.staff_can('partners') or public.staff_can('finance') end
  from public.profiles p
  left join public.partners o on o.id = p.partner_id
  left join public.employees e on e.id = p.id
  where p.id = auth.uid();
$$;
revoke all on function public.my_access() from public, anon;
grant execute on function public.my_access() to authenticated;
