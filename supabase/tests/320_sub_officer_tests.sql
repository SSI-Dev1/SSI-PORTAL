-- Assigned Sub Officer, application attribution and team performance (0045). Synthetic rows only.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = notice;

create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', msg using errcode = 'TF001'; end if;
  raise notice 'pass: %', msg;
end $$;
create or replace function pg_temp.denied(stmt text, msg text, pattern text default '') returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    if pattern <> '' and sqlerrm not like pattern then raise exception 'FAIL: % — wrong error: %', msg, sqlerrm using errcode = 'TF001'; end if;
    raise notice 'pass: % (rejected: %)', msg, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % — statement was allowed', msg using errcode = 'TF001';
end $$;
create or replace function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated',
    'iat', extract(epoch from clock_timestamp())::bigint + 1)::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.trusted() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;


\set super   '''00000000-0000-0000-0000-0000000000a1'''
\set partner '''00000000-0000-0000-0000-0000000000b1'''
\set mgr     '''00000000-0000-0000-0000-0000000000f2'''
\set po      '''00000000-0000-0000-0000-0000000000f3'''
\set app     '''00000000-0000-0000-0000-0000000000f4'''
\set pso     '''00000000-0000-0000-0000-0000000000f5'''

begin;
select pg_temp.trusted();
-- f2 (Senior IRM) is the Main Officer; f3 and f4 report to f2; f5 is in no one's team here.
update public.employees set reporting_manager_id = :mgr where id in (:po, :app);
update public.profiles set permissions = array_append(coalesce(permissions, public.role_default_permissions(role)), 'agency_outreach')
where id in (:mgr, :po) and not ('agency_outreach' = any (coalesce(permissions, public.role_default_permissions(role))));
insert into public.partners (id, name, code, contact_name, email, status, portal_enabled, partnership_officer_id) values
  ('sx1', 'Sub One Overseas', 'SX1', 'A', 'a@sx1.test', 'Active', true, :mgr),
  ('sx2', 'Sub Two Overseas', 'SX2', 'B', 'b@sx2.test', 'Active', true, :mgr),
  ('sx3', 'Solo Client Edu', 'SX3', 'C', 'c@sx3.test', 'Active', true, :mgr),
  ('sx4', 'No Sub Edu', 'SX4', 'D', 'd@sx4.test', 'Active', true, :mgr);
insert into public.agency_prospects (id, reference, company_name, contact_name, phone, stage, assigned_officer, partner_id) values
  ('e0000000-0000-4000-8000-000000000001', 'AG-S-01', 'Sub One Overseas', 'A', '9300000001', 'onboarded', :mgr, 'sx1'),
  ('e0000000-0000-4000-8000-000000000002', 'AG-S-02', 'Sub Prospect Two', 'B', '9300000002', 'proposal_sent', :mgr, null),
  ('e0000000-0000-4000-8000-000000000003', 'AG-S-03', 'Sub Two Overseas', 'C', '9300000003', 'onboarded', :mgr, 'sx2'),
  ('e0000000-0000-4000-8000-000000000004', 'AG-S-04', 'Sub Prospect Four', 'D', '9300000004', 'new_prospect', :mgr, null),
  ('e0000000-0000-4000-8000-000000000005', 'AG-S-05', 'No Sub Edu', 'E', '9300000005', 'onboarded', :mgr, 'sx4');
insert into public.universities (id, name, country) values ('ux1', 'Sub Test University', 'UK') on conflict do nothing;
insert into public.courses (id, university_id, name, level, tuition, currency, intakes) values ('cx1', 'ux1', 'MSc Sub', 'Postgraduate', 20000, 'GBP', '{Sep 2026}') on conflict do nothing;
insert into public.students (id, partner_id, first_name, last_name, email) values
  ('sxs1', 'sx1', 'Ann', 'One', 'ann@sx.test'), ('sxs2', 'sx2', 'Bob', 'Two', 'bob@sx.test'),
  ('sxs3', 'sx3', 'Cat', 'Three', 'cat@sx.test'), ('sxs4', 'sx4', 'Dan', 'Four', 'dan@sx.test'),
  ('sxs5', 'sx1', 'Eve', 'Five', 'eve@sx.test'), ('sxs6', 'sx2', 'Fay', 'Six', 'fay@sx.test'), ('sxs7', 'sx1', 'Gus', 'Seven', 'gus@sx.test');
-- an application created before any Sub Officer exists
insert into public.applications (id, ref, student_id, partner_id, university_id, course_id, intake, status) values ('sxa0', 'SXA0', 'sxs1', 'sx1', 'ux1', 'cx1', 'Sep 2026', 'Submitted');
create temp table wb as select count(*) filter (where employee_id = '00000000-0000-0000-0000-0000000000f3') po, count(*) filter (where employee_id = '00000000-0000-0000-0000-0000000000f2') mgr from public.work_activities;
grant select on wb to authenticated;

\echo '== TEST 8 / 10: no Sub Officer yet'
select pg_temp.check((select sub_officer_id is null and main_officer_id = :mgr::uuid from public.application_attribution where application_id = 'sxa0'),
  'application before any allocation: Main Officer credited, Sub Officer Unassigned (nobody random)');

\echo '== candidates (team only)'
select pg_temp.act_as(:mgr);
select pg_temp.check((select array_agg(id::text order by id) from public.sub_officer_candidates(:mgr::uuid))::text[] @> array[:po, :app]
  and not exists (select 1 from public.sub_officer_candidates(:mgr::uuid) where id = :pso::uuid) and not exists (select 1 from public.sub_officer_candidates(:mgr::uuid) where id = :mgr::uuid),
  'the Main Officer sees only their team (not unrelated staff, not themselves)');

\echo '== TEST 1: bulk allocation'
select public.preview_agency_sub_officer(array['e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002']::uuid[], :po::uuid) as pv \gset
select pg_temp.check((:'pv'::jsonb ->> 'change')::int = 2 and (:'pv'::jsonb ->> 'out_of_scope')::int = 0, 'preview: 2 to assign');
select public.assign_agency_sub_officer(array['e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002']::uuid[], :po::uuid, 'split portfolio', gen_random_uuid());
select public.assign_agency_sub_officer(array['e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000004']::uuid[], :app::uuid, null, gen_random_uuid());
select pg_temp.check((select count(*) from public.agency_prospects where reference in ('AG-S-01', 'AG-S-02') and sub_officer = :po::uuid and assigned_officer = :mgr::uuid) = 2
  and (select count(*) from public.agency_prospects where reference in ('AG-S-03', 'AG-S-04') and sub_officer = :app::uuid and assigned_officer = :mgr::uuid) = 2,
  'two to B, two to C; Main Officer unchanged');
select pg_temp.check((select count(*) from public.sub_officer_history where prospect_id in (select id from public.agency_prospects where reference like 'AG-S-0%')) = 4, 'each allocation is in the history');

\echo '== TEST 3: Clients & Branches shows the same assignment'
select pg_temp.check((select sub_officer_id = :po::uuid from public.partners where id = 'sx1') and (select sub_officer_id = :app::uuid from public.partners where id = 'sx2')
  and (select sub_officer_id = :po::uuid and main_officer_id = :mgr::uuid from public.partner_directory_status() where partner_id = 'sx1'),
  'the linked client carries the agency''s Sub Officer and Main Officer');
select pg_temp.check((select sub_officer_id is null from public.partner_directory_status() where partner_id = 'sx4'), 'a client without a Sub Officer stays listed as Unassigned');

select pg_temp.check(exists (select 1 from public.portfolio_officer_names() where id = :po::uuid) and exists (select 1 from public.portfolio_officer_names() where id = :mgr::uuid),
  'Main and Sub Officer names are available to the Agency List');

\echo '== TEST 9: scope'
select pg_temp.denied($$select public.assign_agency_sub_officer(array['e0000000-0000-4000-8000-000000000005'::uuid], '00000000-0000-0000-0000-0000000000f5'::uuid, null, gen_random_uuid())$$,
  'someone outside the Main Officer''s team is refused', '%not in the Main Officer%');
select pg_temp.act_as(:po);
select pg_temp.denied($$select public.assign_agency_sub_officer(array['e0000000-0000-4000-8000-000000000003'::uuid], '00000000-0000-0000-0000-0000000000f3'::uuid, null, gen_random_uuid())$$,
  'a Sub Officer cannot reassign agencies of their Main Officer', '%Main Officer can assign%');
select pg_temp.check((select (r ->> 'out_of_scope')::int = 2 and (r ->> 'changed')::int = 0
  from public.assign_agency_sub_officer(array['e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000004']::uuid[], :po::uuid, null, gen_random_uuid()) r),
  'bulk: agencies outside the caller''s scope are skipped, never changed');
select pg_temp.check((select count(*) from public.agency_prospects where reference in ('AG-S-03', 'AG-S-04') and sub_officer = :app::uuid) = 2, 'they keep their Sub Officer');
select pg_temp.act_as(:app);
select pg_temp.denied($$select public.assign_agency_sub_officer(array['e0000000-0000-4000-8000-000000000001'::uuid], null, null, gen_random_uuid())$$, 'staff without Agencies access are refused', '%Not allowed%');

\echo '== TEST 4 / 5: application attribution'
select pg_temp.trusted();
insert into public.applications (id, ref, student_id, partner_id, university_id, course_id, intake, status, created_by, assigned_to) values
  ('sxa1', 'SXA1', 'sxs5', 'sx1', 'ux1', 'cx1', 'Sep 2026', 'Conditional Offer', :super, :app),
  ('sxa2', 'SXA2', 'sxs2', 'sx2', 'ux1', 'cx1', 'Sep 2026', 'Draft', :super, null),
  ('sxa3', 'SXA3', 'sxs6', 'sx2', 'ux1', 'cx1', 'Sep 2026', 'Visa Granted', :super, null);
select pg_temp.check((select sub_officer_id = :po::uuid and main_officer_id = :mgr::uuid and creator_id = :super::uuid and processing_staff_id = :app::uuid
  and agency_id = 'e0000000-0000-4000-8000-000000000001'::uuid from public.application_attribution where application_id = 'sxa1'),
  'Sterling-style case: Sub Officer B credited; Main Officer, real creator and processing staff stored separately');
select pg_temp.check((select created_by = :super::uuid and assigned_to = :app::uuid from public.applications where id = 'sxa1'), 'the application''s own creator and processing staff are untouched');
select pg_temp.check((select count(*) from public.application_attribution where application_id in ('sxa2', 'sxa3') and sub_officer_id = :app::uuid) = 2, 'agency of Sub Officer C: C credited');

\echo '== TEST 6: team totals, each application once'
select pg_temp.act_as(:mgr);
select public.portfolio_performance() as tp \gset
select pg_temp.check((:'tp'::jsonb -> 'team' ->> 'applications')::int = 4 and (:'tp'::jsonb -> 'team' ->> 'agencies')::int = 5
  and (:'tp'::jsonb -> 'team' ->> 'allocated')::int = 4 and (:'tp'::jsonb -> 'team' ->> 'unassigned')::int = 1,
  'Main Officer: 5 agencies, 4 allocated, 1 unassigned, 4 team applications');
select pg_temp.check((select sum((x ->> 'applications')::int) from jsonb_array_elements(:'tp'::jsonb -> 'team' -> 'by_sub') x) = 4
  and exists (select 1 from jsonb_array_elements(:'tp'::jsonb -> 'team' -> 'by_sub') x where x ->> 'sub_officer' = :po and (x ->> 'applications')::int = 1)
  and exists (select 1 from jsonb_array_elements(:'tp'::jsonb -> 'team' -> 'by_sub') x where x ->> 'sub_officer' = :app and (x ->> 'applications')::int = 2)
  and exists (select 1 from jsonb_array_elements(:'tp'::jsonb -> 'team' -> 'by_sub') x where x ->> 'name' = 'Unassigned' and (x ->> 'applications')::int = 1),
  'by Sub Officer: B 1, C 2, Unassigned 1 — adds up to the team total, no double counting');
select pg_temp.check((public.portfolio_performance(:po::uuid) -> 'mine' ->> 'applications')::int = 1, 'the manager can open a team member''s portfolio');
select pg_temp.act_as(:po);
select public.portfolio_performance() as mp \gset
select pg_temp.check((:'mp'::jsonb -> 'mine' ->> 'agencies')::int = 2 and (:'mp'::jsonb -> 'mine' ->> 'applications')::int = 1 and (:'mp'::jsonb -> 'mine' ->> 'offers')::int = 1,
  'Sub Officer B: 2 agencies, 1 application through them (an offer)');
select pg_temp.denied($$select public.portfolio_performance('00000000-0000-0000-0000-0000000000f4')$$, 'a colleague''s portfolio is not visible', '%Not allowed%');

\echo '== TEST 7: reassignment'
select pg_temp.act_as(:mgr);
select public.assign_agency_sub_officer(array['e0000000-0000-4000-8000-000000000001'::uuid], :app::uuid, 'B on leave', gen_random_uuid());
select pg_temp.trusted();
insert into public.applications (id, ref, student_id, partner_id, university_id, course_id, intake, status) values ('sxa4', 'SXA4', 'sxs7', 'sx1', 'ux1', 'cx1', 'Sep 2026', 'Submitted');
select pg_temp.check((select sub_officer_id = :app::uuid from public.application_attribution where application_id = 'sxa4')
  and (select sub_officer_id = :po::uuid from public.application_attribution where application_id = 'sxa1'),
  'new applications follow the new Sub Officer; the earlier one stays with B');
select pg_temp.check((select from_officer = :po::uuid and to_officer = :app::uuid and reason = 'B on leave' and changed_by = :mgr::uuid and main_officer = :mgr::uuid
  from public.sub_officer_history where prospect_id = 'e0000000-0000-4000-8000-000000000001' order by id desc limit 1), 'history: previous, new, who, Main Officer and reason');

\echo '== client without an agency'
select pg_temp.act_as(:mgr);
select public.assign_partner_sub_officer('sx3', :po::uuid, 'direct client');
select pg_temp.trusted();
insert into public.applications (id, ref, student_id, partner_id, university_id, course_id, intake, status) values ('sxa5', 'SXA5', 'sxs3', 'sx3', 'ux1', 'cx1', 'Sep 2026', 'Draft');
select pg_temp.check((select sub_officer_id = :po::uuid and agency_id is null and main_officer_id = :mgr::uuid from public.application_attribution where application_id = 'sxa5'),
  'a client without an Agency List record credits its own Sub Officer');

\echo '== corrections'
select pg_temp.act_as(:mgr);
select pg_temp.denied($$select public.correct_application_attribution('sxa1', '00000000-0000-0000-0000-0000000000f4', 'wrong')$$, 'only a Super Admin corrects attribution', '%Super Admin%');
select pg_temp.act_as(:super);
select public.correct_application_attribution('sxa1', :app::uuid, 'Lead came from C');
select pg_temp.check((select sub_officer_id = :app::uuid and previous_sub_officer = :po::uuid and source = 'correction' and correction_reason = 'Lead came from C'
  from public.application_attribution where application_id = 'sxa1'), 'Super Admin correction keeps the previous officer and reason');

\echo '== TEST 10: personal work report unaffected'
select pg_temp.trusted();
select pg_temp.check((select count(*) filter (where employee_id = :po::uuid) from public.work_activities) = (select po from wb)
  and (select count(*) filter (where employee_id = :mgr::uuid) from public.work_activities) = (select mgr from wb),
  'application credit is not added to the officers'' personal Daily Work Report activities');
select pg_temp.act_as(:partner);
select pg_temp.check((select count(*) from public.application_attribution) = 0 and public.portfolio_performance() is null, 'partner users see no attribution');
rollback;
