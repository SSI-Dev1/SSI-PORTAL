-- Students for the Senior IRM, Partnerships, Partner Success and Applications departments (27 Nov 2026).
-- Safe to run more than once.
--
-- One student database, one Students page. Senior IRM, Partner Success and Applications already hold
-- the "students" module (view and edit). Partnerships did not: its officers now get a separate,
-- READ-ONLY module "students_view":
--   * read students and their applications (status, university, course, intake);
--   * no add / edit (still "students"), no application changes ("applications"), no documents
--     ("documents"), no deletion (Super Admin only, 0058), no assignment.
-- Admins grant or remove it per employee in the existing account permissions (it is in
-- staff_modules(), so saving it never gives "Unknown permission"); new Partnership Officers get it
-- through their designation. Partner Success keeps its existing visibility (unchanged here).
-- student_officers(): the student's agency, Main Officer and Sub Officer for the profile, to anyone who
-- may read that student.

create or replace function public.staff_modules()
returns text[] language sql immutable set search_path = '' as $$
  select array['partners', 'students', 'applications', 'assessments', 'documents', 'finance',
               'catalogue', 'tasks', 'updates', 'reports', 'work_reports', 'hr', 'hr_accounts', 'hr_salary',
               'commission_view', 'commission_tag', 'commission_manage', 'commission_internal', 'commission_edit',
               'partner_onboarding', 'agency_outreach', 'partner_accounts', 'partner_success', 'partner_create',
               'agreement_countersign', 'leads', 'students_view'];
$$;

-- Read access: the existing rule, plus "students_view" (read only).
drop policy if exists "students: read" on public.students;
create policy "students: read" on public.students for select to authenticated using (
  (select public.staff_can('students')) or (select public.staff_can('students_view'))
  or (partner_id = (select public.my_partner_id()) and (select public.partner_perm('students.view'))));
drop policy if exists "applications: read" on public.applications;
create policy "applications: read" on public.applications for select to authenticated using (
  (select public.staff_can('applications')) or (select public.staff_can('students_view'))
  or (partner_id = (select public.my_partner_id()) and (select public.partner_perm('applications.view'))));

-- Partnership Officers: by designation (future accounts) and for current accounts with their own list.
update public.designations set default_permissions = array_append(default_permissions, 'students_view')
where id = 'partnership_officer' and not ('students_view' = any (default_permissions));
update public.profiles p set permissions = array_append(p.permissions, 'students_view')
from public.employees e
where e.id = p.id and e.designation_id = 'partnership_officer' and p.permissions is not null
  and not ('students_view' = any (p.permissions)) and not ('students' = any (p.permissions));

-- Agency, Main Officer and Sub Officer of a student (names only), for anyone who may read the student.
create or replace function public.student_officers(p_student text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'partner', o.name, 'agency_reference', a.reference,
    'main_officer', (select full_name from public.profiles where id = coalesce(a.assigned_officer, o.partnership_officer_id)),
    'sub_officer', (select full_name from public.profiles where id = a.sub_officer))
  from public.students s
  left join public.partners o on o.id = s.partner_id
  left join public.agency_prospects a on a.partner_id = s.partner_id
  where s.id = p_student and public.my_profile_ok()
    and (public.staff_can('students') or public.staff_can('students_view')
         or (s.partner_id = public.my_partner_id() and public.partner_perm('students.view')))
  limit 1;
$$;
revoke all on function public.student_officers(text) from public, anon;
grant execute on function public.student_officers(text) to authenticated;
