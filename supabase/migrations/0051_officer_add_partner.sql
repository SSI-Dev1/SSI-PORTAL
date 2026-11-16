-- Partnership Officers can add partners (16 Nov 2026).
--
-- New staff permission "partner_create" (Partners · Add partner, Super Admin grants). Holders use the
-- existing Add Partner form and the admin-users create_partner action. A partner they add is created
-- the same way (organisation + Partner Admin login) but held for approval: status Onboarding, portal
-- closed, no login email. A Super Admin approves by opening portal access and sending the login
-- (User Management → Partners), exactly as for any closed partner. Enforced in admin-users; the
-- database guard (guard_partner_insert / guard_partner_changes) already keeps portal access a Super
-- Admin decision for every non-Super-Admin write.
--
-- Not given by role defaults. Granted once here to active employees whose designation (primary or
-- additional) is Partnership Officer — never to Partner Success Officers, the Application Team,
-- partners or other staff. A Super Admin can grant or remove it per account afterwards.

create or replace function public.staff_modules()
returns text[] language sql immutable set search_path = '' as $$
  select array['partners', 'students', 'applications', 'assessments', 'documents', 'finance',
               'catalogue', 'tasks', 'updates', 'reports', 'work_reports', 'hr', 'hr_accounts', 'hr_salary',
               'commission_view', 'commission_tag', 'commission_manage', 'commission_internal', 'commission_edit',
               'partner_onboarding', 'agency_outreach', 'partner_accounts', 'partner_success', 'partner_create'];
$$;

with officers as (
  select p.id, coalesce(p.permissions, public.role_default_permissions(p.role)) as current
  from public.profiles p
  join public.employees e on e.id = p.id
  where p.status = 'active'
    and p.role in ('admin_staff', 'application_manager', 'assessment_staff', 'finance_staff', 'support_staff')
    and (e.designation_id = 'partnership_officer' or 'partnership_officer' = any (e.additional_designations))
), granted as (
  update public.profiles p
  set permissions = o.current || array['partner_create']
  from officers o
  where p.id = o.id and not ('partner_create' = any (o.current))
  returning p.id
)
insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, changes)
select null, 'system', 'permission_granted', 'profiles', g.id::text,
       jsonb_build_object('permission', 'partner_create', 'reason', 'Partnership Officer designation (0051)')
from granted g;
