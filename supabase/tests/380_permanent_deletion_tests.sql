-- 0053: Super Admin permanent deletion of test records. Synthetic rows only; everything rolls back.
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
-- Signed in `hours_ago` hours ago (amr timestamp), like a real Supabase session.
create or replace function pg_temp.act_as(uid text, hours_ago integer default 0) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now() - make_interval(hours => hours_ago))::bigint)))::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.trusted() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

\set super '''00000000-0000-0000-0000-0000000000a1'''
\set staff '''00000000-0000-0000-0000-0000000000a2'''

begin;
select pg_temp.trusted();
-- Disposable test records.
insert into public.agency_prospects (id, reference, company_name, contact_name, phone, created_by)
values ('dddddddd-0000-4000-8000-000000000001', 'AG-DEL-1', 'Delete Me Agency', 'Test POC', '+91 90000 00001', :super),
       ('dddddddd-0000-4000-8000-000000000002', 'AG-DEL-2', 'Delete Me Too', 'Test POC', '+91 90000 00002', :super),
       ('dddddddd-0000-4000-8000-000000000003', 'AG-DEL-3', 'Linked Agency', 'Test POC', '+91 90000 00003', :super);
insert into public.agency_activities (prospect_id, kind, note, actor) values ('dddddddd-0000-4000-8000-000000000001', 'note', 'test', :super);
insert into public.linkedin_prospects (id, reference, name, created_by, status, agency_id)
values ('eeeeeeee-0000-4000-8000-000000000001', 'LI-DEL-1', 'Delete Me Prospect', :super, 'not_contacted', null),
       ('eeeeeeee-0000-4000-8000-000000000002', 'LI-DEL-2', 'Converted Prospect', :super, 'converted', 'dddddddd-0000-4000-8000-000000000002');
insert into public.partners (id, name, code, contact_name, email, phone, city, branches) values ('pdel', 'Disposable Client', 'DCL', 'DC Admin', 'dc@x.test', '+91 90000 00009', 'Kochi', '{Kochi,Delhi}');
insert into auth.users (id, email) values ('ffffffff-0000-4000-8000-000000000001', 'dcadmin@x.test');
insert into public.profiles (id, role, partner_id, full_name, email, status) values ('ffffffff-0000-4000-8000-000000000001', 'partner_admin', 'pdel', 'DC Admin', 'dcadmin@x.test', 'active');
update public.agency_prospects set partner_id = 'p2' where id = 'dddddddd-0000-4000-8000-000000000003';
insert into public.work_activities (employee_id, activity_type, source, entity_type, entity_id, report_date, dedupe_key)
select e.id, 'agency_added', 'crm', 'agency', 'dddddddd-0000-4000-8000-000000000001', public.company_today(), 'test-del-wa' from public.employees e limit 1;

\echo '== TEST 5: only a Super Admin'
select pg_temp.act_as(:staff);
select pg_temp.denied($$select public.deletion_preview('agency', array['dddddddd-0000-4000-8000-000000000001'])$$, 'an employee cannot even preview a deletion', '%Only a Super Admin%');
select pg_temp.denied($$select public.delete_records('agency', array['dddddddd-0000-4000-8000-000000000001'], 'Delete Me Agency')$$, 'an employee cannot delete (backend, not just a hidden button)', '%Only a Super Admin%');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select pg_temp.denied($$select public.delete_records('linkedin', array['eeeeeeee-0000-4000-8000-000000000001'], 'Delete Me Prospect')$$, 'a partner cannot delete SSI GLOBAL records', '%Only a Super Admin%');

\echo '== preview and confirmation'
select pg_temp.act_as(:super);
select pg_temp.check((select (x -> 'items' -> 0 ->> 'eligible')::boolean and (x -> 'items' -> 0 -> 'related' ->> 'Activity history')::int = 1
                             and (x ->> 'confirm') = 'Delete Me Agency'
                      from public.deletion_preview('agency', array['dddddddd-0000-4000-8000-000000000001']) x),
  'preview names the record, its history and the confirmation phrase (dry run deletes nothing)');
select pg_temp.check(exists (select 1 from public.agency_prospects where reference = 'AG-DEL-1'), 'preview left the record in place');
select pg_temp.denied($$select public.delete_records('agency', array['dddddddd-0000-4000-8000-000000000001'], 'delete')$$, 'wrong confirmation is refused', 'CONFIRM:%');
select pg_temp.act_as(:super, 13);
select pg_temp.denied($$select public.delete_records('agency', array['dddddddd-0000-4000-8000-000000000001'], 'Delete Me Agency')$$, 'a sign-in older than 12 hours must sign in again', 'REAUTH:%');

\echo '== TEST 1: isolated test agency'
select pg_temp.act_as(:super);
select pg_temp.check((select jsonb_array_length(r -> 'deleted') = 1 from public.delete_records('agency', array['dddddddd-0000-4000-8000-000000000001'], 'Delete Me Agency', false, 'aaaaaaaa-0000-4000-8000-000000000001') r),
  'the test agency is deleted');
select pg_temp.trusted();
select pg_temp.check(not exists (select 1 from public.agency_prospects where reference = 'AG-DEL-1')
                     and not exists (select 1 from public.agency_activities where prospect_id = 'dddddddd-0000-4000-8000-000000000001'),
  'removed from the database with its own activity history');
select pg_temp.check(exists (select 1 from public.work_activities where dedupe_key = 'test-del-wa'), 'Daily Work Report activity is kept (history not rewritten)');
select pg_temp.check((select count(*) from public.audit_log where action = 'record_deleted' and entity = 'agency' and entity_id = 'dddddddd-0000-4000-8000-000000000001' and changes ->> 'name' = 'Delete Me Agency') = 1,
  'TEST 8: the deletion is in the audit log');
select pg_temp.act_as(:super);
select pg_temp.check((select (r ->> 'repeated')::boolean from public.delete_records('agency', array['dddddddd-0000-4000-8000-000000000001'], 'x', false, 'aaaaaaaa-0000-4000-8000-000000000001') r),
  'a repeated request is answered, not run twice');

\echo '== TEST 2: LinkedIn prospect'
select public.delete_records('linkedin', array['eeeeeeee-0000-4000-8000-000000000001'], 'Delete Me Prospect');
select pg_temp.trusted();
select pg_temp.check(not exists (select 1 from public.linkedin_prospects where reference = 'LI-DEL-1'), 'the prospect is deleted');

\echo '== agency with a converted LinkedIn prospect; agency linked to a client'
select pg_temp.act_as(:super);
select public.delete_records('agency', array['dddddddd-0000-4000-8000-000000000002'], 'Delete Me Too');
select pg_temp.trusted();
select pg_temp.check((select agency_id is null and conversion_pending and status <> 'converted' from public.linkedin_prospects where reference = 'LI-DEL-2'),
  'its LinkedIn prospect is kept and set back to "Agency details needed"');
select pg_temp.act_as(:super);
select pg_temp.check((select not (x -> 'items' -> 0 ->> 'eligible')::boolean from public.deletion_preview('agency', array['dddddddd-0000-4000-8000-000000000003']) x),
  'an agency linked to a client is blocked');

\echo '== TEST 4: client with student applications is blocked'
select pg_temp.check((select not (x -> 'items' -> 0 ->> 'eligible')::boolean and (x -> 'items' -> 0 ->> 'blockers') like '%student%'
                      from public.deletion_preview('partner', array['p1']) x), 'a client with students / applications cannot be deleted');
select pg_temp.check((select jsonb_array_length(r -> 'deleted') = 0 and jsonb_array_length(r -> 'skipped') = 1
                      from public.delete_records('partner', array['p1'], (select name from public.partners where id = 'p1')) r),
  'deleting it is refused and reported, nothing cascades');
select pg_temp.trusted();
select pg_temp.check(exists (select 1 from public.partners where id = 'p1') and exists (select 1 from public.students where partner_id = 'p1'), 'the client and its students are untouched');

\echo '== TEST 3: disposable client, logins only when included; branch'
select pg_temp.act_as(:super);
select pg_temp.check((select jsonb_array_length(r -> 'skipped') = 1 from public.delete_records('partner', array['pdel'], 'Disposable Client') r),
  'a client with logins is not deleted unless the logins are included');
select public.delete_records('branch', array['pdel::Delhi'], 'Delhi');
select pg_temp.trusted();
select pg_temp.check((select branches = '{Kochi}' from public.partners where id = 'pdel'), 'a branch is removed from the client');
select pg_temp.act_as(:super);
select pg_temp.check((select not (x -> 'items' -> 0 ->> 'eligible')::boolean from public.deletion_preview('branch', array['pdel::Kochi']) x), 'the last branch cannot be removed');
select public.delete_records('partner', array['pdel'], 'Disposable Client', true);
select pg_temp.trusted();
select pg_temp.check(not exists (select 1 from public.partners where id = 'pdel')
                     and not exists (select 1 from auth.users where id = 'ffffffff-0000-4000-8000-000000000001'),
  'the client and its explicitly included login are deleted');

\echo '== staff accounts are not deletable here; TEST 6 bulk'
select pg_temp.act_as(:super);
select pg_temp.check((select not (x -> 'items' -> 0 ->> 'eligible')::boolean from public.deletion_preview('partner_user', array[:staff]) x),
  'an SSI GLOBAL staff account cannot be deleted as a partner login');
select pg_temp.trusted();
insert into public.linkedin_prospects (id, reference, name, created_by) values
  ('eeeeeeee-0000-4000-8000-000000000011', 'LI-BULK-1', 'Bulk One', :super), ('eeeeeeee-0000-4000-8000-000000000012', 'LI-BULK-2', 'Bulk Two', :super);
select pg_temp.act_as(:super);
select pg_temp.check((select (x ->> 'confirm') = 'DELETE 3' and (x ->> 'eligible')::int = 3
                      from public.deletion_preview('linkedin', array['eeeeeeee-0000-4000-8000-000000000011', 'eeeeeeee-0000-4000-8000-000000000012', 'eeeeeeee-0000-4000-8000-000000000002']) x),
  'bulk preview counts the selection and asks for "DELETE 3"');
select pg_temp.check((select jsonb_array_length(r -> 'deleted') = 3
                      from public.delete_records('linkedin', array['eeeeeeee-0000-4000-8000-000000000011', 'eeeeeeee-0000-4000-8000-000000000012', 'eeeeeeee-0000-4000-8000-000000000002'], 'DELETE 3') r),
  'bulk: exactly the confirmed selection is deleted');
select pg_temp.check((select jsonb_array_length(r -> 'deleted') = 0 and jsonb_array_length(r -> 'skipped') = 2
                      from public.delete_records('agency', array['dddddddd-0000-4000-8000-000000000003', 'dddddddd-0000-4000-8000-000000000099'], 'DELETE 2') r),
  'bulk: blocked or missing records are skipped and reported');
select pg_temp.trusted();
select pg_temp.check(exists (select 1 from public.agency_prospects where reference = 'AG-DEL-3') and exists (select 1 from public.linkedin_prospects where reference = 'LI-DEL-1') is false,
  'blocked records stay; deleted ones are gone');
rollback;

\echo '== 0052: HR work recorded automatically, once (TEST 16)'
begin;
select pg_temp.trusted();
insert into public.leave_requests (id, employee_id, leave_type, start_date, end_date, days, reason, status)
values ('99999999-0000-4000-8000-000000000001', '00000000-0000-0000-0000-0000000000f3', 'sick', public.company_today() + 3, public.company_today() + 3, 1, 'test', 'Pending');
update public.leave_requests set status = 'Approved', decided_by = '00000000-0000-0000-0000-0000000000f1', decided_at = now() where id = '99999999-0000-4000-8000-000000000001';
update public.leave_requests set decided_at = now() where id = '99999999-0000-4000-8000-000000000001';   -- re-save: nothing new
select pg_temp.check((select count(*) from public.work_activities where activity_type = 'hr_leave_processed' and employee_id = '00000000-0000-0000-0000-0000000000f1'
                      and entity_id = '99999999-0000-4000-8000-000000000001') = 1, 'the HR decision is recorded once, for the person who decided');
select pg_temp.check(((public.compute_report_metrics('00000000-0000-0000-0000-0000000000f1', 'hr', public.company_today()) -> 'hr_leave_processed' ->> 'value')::int) >= 1,
  'it fills "Leave requests processed" on the HR report');
select pg_temp.check((select report_template = 'hr' from public.designations where id = 'hr_manager'), 'HR designations have a report');
select pg_temp.check(not exists (select 1 from public.report_metric_sources where 'manual_work' = any (activity_types)), 'manual work never feeds a report figure');
rollback;
