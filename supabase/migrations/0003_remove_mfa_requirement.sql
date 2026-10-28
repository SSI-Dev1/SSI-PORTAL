-- SSI GLOBAL CRM — remove the two-step (MFA) requirement (run after 0002).
--
-- 0002 granted staff privileges only to sessions with JWT aal = aal2 (authenticator app).
-- Two-step verification is out of scope for the base release, so staff access now depends
-- on an active staff profile alone. Every other control is unchanged: RLS on every table,
-- tenant isolation, suspension, server-derived partner_id, audit log, private storage.
-- To reintroduce a second factor later, gate these two helpers again.

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active' and role in ('super_admin', 'admin_staff'));
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and status = 'active' and role = 'super_admin');
$$;
