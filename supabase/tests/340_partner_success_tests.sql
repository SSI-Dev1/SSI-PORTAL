-- Partner Success Officers: directory, My Clients, activities, attribution and permissions (0047).
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

\set super '''00000000-0000-0000-0000-0000000000a1'''
\set mgr   '''00000000-0000-0000-0000-0000000000f2'''
\set app   '''00000000-0000-0000-0000-0000000000f4'''
\set ps1   '''00000000-0000-0000-0000-0000000000f5'''
\set ps2   '''00000000-0000-0000-0000-0000000000f6'''

\echo '== the two Partner Success accounts (by designation)'
insert into auth.users (id, email) values (:ps2, 'pso2@ssi.test') on conflict do nothing;
insert into public.profiles (id, role, full_name, status, permissions) values (:ps2, 'support_staff', 'Sam Success', 'active', null) on conflict do nothing;
insert into public.employees (id, employee_code, designation_id, department_id, reporting_manager_id, joining_date, employment_status, shift_id)
values (:ps2, 'SSI-006', 'partner_success_officer', 'partnerships', :mgr, '2025-02-01', 'Active', 'standard') on conflict do nothing;
update public.employees set designation_id = 'partner_success_officer' where id = :ps1;
-- as created through Add Employee (designation defaults before 0047)
update public.profiles set permissions = '{partners,students,applications,catalogue,tasks,agency_outreach}' where id in (:ps1, :ps2);
-- the statement 0047 runs for existing accounts
update public.profiles p
set permissions = array_append(array_remove(array_remove(array_remove(array_remove(p.permissions, 'partners'), 'agency_outreach'), 'partner_onboarding'), 'partner_accounts'), 'partner_success')
from public.employees e
where e.id = p.id and e.designation_id = 'partner_success_officer' and p.permissions is not null and p.role not in ('super_admin', 'admin_staff')
  and not ('partner_success' = any (p.permissions));
select pg_temp.check((select bool_and('partner_success' = any (permissions) and not ('partners' = any (permissions)) and not ('agency_outreach' = any (permissions))
  and 'applications' = any (permissions)) from public.profiles where id in (:ps1, :ps2)),
  'both Partner Success accounts: partner_success added; partner editing and partnership development removed; application work kept');
select pg_temp.check((select 'partner_success' = any (default_permissions) and not ('partners' = any (default_permissions)) from public.designations where id = 'partner_success_officer'),
  'future Partner Success Officers get the same through the designation');

\echo '== fixtures: Main Officer f2; Sterling + Alpha -> PSO 1, Beta -> PSO 2'
insert into public.partners (id, name, code, contact_name, email, phone, city, country, status, portal_enabled, partnership_officer_id) values
  ('ps-st', 'Sterling PS', 'PSST', 'Stella', 'st@ps.test', '+91 9400000001', 'Kochi', 'India', 'Active', true, :mgr),
  ('ps-al', 'Alpha PS', 'PSAL', 'Al', 'al@ps.test', '+91 9400000002', 'Kochi', 'India', 'Active', true, :mgr),
  ('ps-be', 'Beta PS', 'PSBE', 'Bea', 'be@ps.test', '+44 2000000003', 'London', 'UK', 'Active', true, :mgr);
insert into public.partners (id, name, code, contact_name, email, status, portal_enabled, partnership_officer_id, onboarding_source)
values ('ps-hi', 'Historic PS', 'PSHI', 'Hal', 'hi@ps.test', 'Onboarding', false, :mgr, 'historical');
insert into auth.users (id, email) values ('d0000000-0000-4000-8000-0000000003e1', 'st-admin@ps.test'), ('d0000000-0000-4000-8000-0000000003e2', 'al-admin@ps.test'), ('d0000000-0000-4000-8000-0000000003e3', 'be-admin@ps.test');
insert into public.profiles (id, role, partner_id, full_name, status) values
  ('d0000000-0000-4000-8000-0000000003e1', 'partner_admin', 'ps-st', 'St Admin', 'active'),
  ('d0000000-0000-4000-8000-0000000003e2', 'partner_admin', 'ps-al', 'Al Admin', 'active'),
  ('d0000000-0000-4000-8000-0000000003e3', 'partner_admin', 'ps-be', 'Be Admin', 'active');
insert into public.agency_prospects (id, reference, company_name, stage, assigned_officer) values
  ('f0000000-0000-4000-8000-000000000001', 'AG-PS-01', 'Unlinked Onboarded PS', 'onboarded', :mgr),
  ('f0000000-0000-4000-8000-000000000002', 'AG-PS-02', 'Proposal Only PS', 'proposal_sent', :mgr);
begin; select pg_temp.act_as(:super);
select public.assign_partner_sub_officer('ps-st', :ps1::uuid, 'portfolio');
select public.assign_partner_sub_officer('ps-al', :ps1::uuid, 'portfolio');
select public.assign_partner_sub_officer('ps-be', :ps2::uuid, 'portfolio');
commit;

\echo '== TEST 1 / 2: Agency List — every onboarded client, read-only'
begin; select pg_temp.act_as(:ps1);
select pg_temp.check((select count(*) from public.onboarded_client_directory() where name in ('Sterling PS', 'Alpha PS', 'Beta PS', 'Historic PS', 'Unlinked Onboarded PS')) = 5,
  'PSO 1 sees all onboarded clients: assigned to them, to PSO 2, unassigned, historical and not yet linked');
select pg_temp.check((select count(*) from public.onboarded_client_directory() where name = 'Proposal Only PS') = 0, 'Proposal Sent agencies are not in the onboarded directory');
select pg_temp.check((select sub_officer = 'Sam Success' and main_officer = 'Manu Manager' and contact_name is null and phone is null and email is null and not mine
  from public.onboarded_client_directory() where name = 'Beta PS'), 'another officer''s client: officers shown, contact details hidden');
select pg_temp.check((select contact_name = 'Stella' and mine from public.onboarded_client_directory() where name = 'Sterling PS'), 'own client: contact details shown');
rollback;
begin; select pg_temp.act_as(:ps2);
select pg_temp.check((select count(*) from public.onboarded_client_directory() where name like '%PS') = 5, 'PSO 2 sees the same directory (TEST 2)');
rollback;
begin; select pg_temp.act_as(:app);
select pg_temp.check((select count(*) from public.onboarded_client_directory()) = 0, 'employees without access see nothing');
rollback;

\echo '== TEST 3 / 4: My Clients'
begin; select pg_temp.act_as(:ps1);
select pg_temp.check((select string_agg(name, ',' order by name) from public.my_clients()) = 'Alpha PS,Sterling PS', 'PSO 1: Sterling and Alpha only');
rollback;
begin; select pg_temp.act_as(:ps2);
select pg_temp.check((select string_agg(name, ',' order by name) from public.my_clients()) = 'Beta PS', 'PSO 2: Beta only — no Sterling (TEST 4)');
rollback;

\echo '== TEST 9 / 10 / 12: applications attributed at creation'
insert into public.universities (id, name, country) values ('ups', 'PS Test University', 'UK') on conflict do nothing;
insert into public.courses (id, university_id, name, level, tuition, currency, intakes) values ('cps', 'ups', 'MSc PS', 'Postgraduate', 20000, 'GBP', '{Sep 2026}') on conflict do nothing;
insert into public.students (id, partner_id, first_name, last_name, email)
select 'pss' || g, case when g <= 5 then 'ps-st' when g <= 8 then 'ps-al' else 'ps-be' end, 'S', g::text, 's' || g || '@ps.test' from generate_series(1, 10) g;
insert into public.applications (id, ref, student_id, partner_id, university_id, course_id, intake, status, created_by, assigned_to)
select 'psa' || g, 'PSA' || g, 'pss' || g, case when g <= 5 then 'ps-st' when g <= 8 then 'ps-al' else 'ps-be' end, 'ups', 'cps', 'Sep 2026', 'Submitted', :super, :app
from generate_series(1, 10) g;
select pg_temp.check((select count(*) = 8 and bool_and(creator_id = :super::uuid and processing_staff_id = :app::uuid and main_officer_id = :mgr::uuid)
  from public.application_attribution where sub_officer_id = :ps1::uuid), 'Sterling 5 + Alpha 3 credited to PSO 1; creator and processing staff kept separately');
begin; select pg_temp.act_as(:ps1);
select pg_temp.check((select sum(applications) = 8 and sum(submitted) = 8 from public.my_clients()), 'PSO 1 My Clients: 8 applications (5 + 3)');
select pg_temp.check((select (r -> 'mine' ->> 'applications')::int = 8 from public.portfolio_performance() r), 'PSO 1 portfolio: 8 — Beta''s applications not included (TEST 10)');
select pg_temp.check((select (public.portfolio_day() ->> 'applications')::int) = 8, 'today through my agencies: 8 (shown apart from personal work)');
rollback;
begin; select pg_temp.act_as(:ps2);
select pg_temp.check((select (r -> 'mine' ->> 'applications')::int = 2 from public.portfolio_performance() r), 'PSO 2: only Beta''s 2');
select pg_temp.check((select count(*) from public.application_attribution where sub_officer_id = :ps1::uuid) = 0, 'PSO 2 cannot read PSO 1''s attribution');
rollback;
begin; select pg_temp.act_as(:mgr);
select pg_temp.check((select (r -> 'team' ->> 'applications')::int = 10 from public.portfolio_performance() r), 'Main Officer team total 10 — each application once (TEST 12)');
rollback;

\echo '== TEST 11: offer received, counted once'
update public.applications set status = 'Conditional Offer' where id = 'psa1';
update public.applications set status = 'Unconditional Offer' where id = 'psa1';
begin; select pg_temp.act_as(:ps1);
select pg_temp.check((select sum(offers) from public.my_clients()) = 1 and (select (public.portfolio_day() ->> 'offers')::int) = 1, 'one offer through Sterling, counted once although the status changed twice');
rollback;
begin; select pg_temp.act_as(:ps2);
select pg_temp.check((select (public.portfolio_day() ->> 'offers')::int) = 0, 'PSO 2 gets no credit for it');
rollback;

\echo '== TEST 16: activities on own clients only'
create temp table w0 as select count(*) n from public.work_activities where employee_id = :ps1::uuid and activity_type = 'partner_query';
begin; select pg_temp.act_as(:ps1);
select public.log_client_activity('p:ps-al', 'query', 'completed', 'Answered fee question', public.company_today() + 3, '66666666-0000-0000-0000-000000000001') as act \gset
select public.log_client_activity('p:ps-al', 'query', 'completed', 'Answered fee question', null, '66666666-0000-0000-0000-000000000001');
select pg_temp.check((select employee_id = :ps1::uuid and kind = 'query' and outcome = 'completed' and partner_id = 'ps-al' from public.client_activities where id = :act), 'saved with employee, client, type and outcome');
select pg_temp.check((select next_follow_up = public.company_today() + 3 from public.my_clients() where name = 'Alpha PS'), 'the follow-up shows on My Clients');
select pg_temp.denied($$select public.log_client_activity('p:ps-be', 'query', null, 'x', null, gen_random_uuid())$$, 'not on another officer''s client (TEST 8)', '%own clients%');
commit;
select pg_temp.check((select count(*) from public.work_activities where employee_id = :ps1::uuid and activity_type = 'partner_query') - (select n from w0) = 1,
  'counted once in PSO 1''s Partner queries (retry ignored)');
begin; select pg_temp.act_as(:ps2);
select pg_temp.check((select count(*) from public.client_activities where partner_id = 'ps-al') = 0, 'PSO 2 cannot read PSO 1''s client activities');
select pg_temp.denied($$select public.log_client_activity('p:ps-al', 'note', null, 'x', null, gen_random_uuid())$$, 'PSO 2 cannot log on Alpha', '%own clients%');
rollback;

\echo '== TEST 13: reassignment keeps history'
begin; select pg_temp.act_as(:super);
select public.assign_partner_sub_officer('ps-st', :ps2::uuid, 'rebalance');
commit;
insert into public.students (id, partner_id, first_name, last_name, email) values ('pss11', 'ps-st', 'S', '11', 's11@ps.test');
insert into public.applications (id, ref, student_id, partner_id, university_id, course_id, intake, status) values ('psa11', 'PSA11', 'pss11', 'ps-st', 'ups', 'cps', 'Sep 2026', 'Submitted');
select pg_temp.check((select sub_officer_id = :ps2::uuid from public.application_attribution where application_id = 'psa11')
  and (select count(*) from public.application_attribution where partner_id = 'ps-st' and sub_officer_id = :ps1::uuid) = 5,
  'new Sterling application goes to PSO 2; the 5 earlier stay with PSO 1');
begin; select pg_temp.act_as(:ps1);
select pg_temp.check((select string_agg(name, ',') from public.my_clients()) = 'Alpha PS', 'Sterling left PSO 1''s My Clients');
select pg_temp.check((select (r -> 'mine' ->> 'applications')::int = 8 from public.portfolio_performance() r), 'PSO 1 keeps the 8 applications earned before');
rollback;
begin; select pg_temp.act_as(:ps2);
select pg_temp.check((select string_agg(name, ',' order by name) from public.my_clients()) = 'Beta PS,Sterling PS', 'Sterling is now in PSO 2''s My Clients');
rollback;

\echo '== TEST 14 / 15: no partner, registration, proposal or commission powers'
begin; select pg_temp.act_as(:ps1);
select pg_temp.denied($$insert into public.partners (id, name, code, contact_name, email, status) values ('ps-x', 'X', 'X', 'X', 'x@x.test', 'Active')$$, 'cannot create a partner organisation', '%');
update public.partners set name = 'Changed' where id = 'ps-al';
select pg_temp.check((select name = 'Alpha PS' from public.partners where id = 'ps-al'), 'cannot edit a partner organisation');
select pg_temp.denied($$select public.create_partner_registration('X Co', null, null, 14, null)$$, 'cannot create registration links', '%');
select pg_temp.denied($$select * from public.proposal_commission_options(null)$$, 'no proposal commission options', '%');
select pg_temp.check((select count(*) from public.commission_internal) + (select count(*) from public.commission_tier_rates) = 0, 'no commission data');
select pg_temp.check((select count(*) from public.agency_prospects) = 0, 'no access to the partnership pipeline');
select pg_temp.denied($$select public.assign_partner_sub_officer('ps-al', '00000000-0000-0000-0000-0000000000f6'::uuid, null)$$, 'cannot reassign Sub Officers', '%');
rollback;

\echo '== admins choose any Partner Success Officer as Sub Officer'
begin; select pg_temp.act_as(:super);
select pg_temp.check(public.sub_officer_eligible(:mgr::uuid, :ps1::uuid), 'PSO 1 (outside the Main Officer''s team) is eligible when an administrator assigns');
rollback;
