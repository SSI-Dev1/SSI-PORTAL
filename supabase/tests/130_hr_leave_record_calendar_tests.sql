-- HR records leave for an employee and the workforce calendar (0026).
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

-- Employees from 70_hr_tests.sql: f1 HR, f2 manager, f3 officer (reports to f2), f4 application team (reports to f2), f5 not in f2's team.
\set hr  '''00000000-0000-0000-0000-0000000000f1'''
\set mgr '''00000000-0000-0000-0000-0000000000f2'''
\set po  '''00000000-0000-0000-0000-0000000000f3'''
\set app '''00000000-0000-0000-0000-0000000000f4'''
\set pso '''00000000-0000-0000-0000-0000000000f5'''

\echo '== HR records leave for an employee'
begin;
select pg_temp.trusted();
select (select used from public.leave_balances(:po, 2026) where leave_type = 'sick') as sick0,
       (select available from public.leave_balances(:po, 2026) where leave_type = 'paid') as paid_avail0 \gset
select pg_temp.act_as(:hr);
select public.hr_record_leave(:po, 'sick', '2026-05-04', '2026-05-04', 'Called in sick', 'morning') as r1 \gset
select pg_temp.check((select status = 'Approved' and days = 0.5 and recorded_by = :hr and decided_by = :hr from public.leave_requests where id = :'r1'),
  'recorded leave is approved at once, 0.5 day, with who recorded it');
select pg_temp.check((select used = :sick0 + 0.5 from public.leave_balances(:po, 2026) where leave_type = 'sick'), 'a recorded half day deducts exactly 0.5');
select pg_temp.trusted();
select pg_temp.check(exists (select 1 from public.notifications where user_id = :po and title = 'Leave recorded by HR'), 'the employee is notified');
select pg_temp.act_as(:hr);
select pg_temp.check((select code = 'HD' from public.workforce_calendar('2026-05-01') where employee_id = :po and day = '2026-05-04'), 'the workforce calendar shows the half day');
select pg_temp.denied(format($$select public.hr_record_leave(%L, 'paid', '2026-05-04', '2026-05-04', 'Same morning', 'morning')$$, :po), 'overlapping leave is rejected', '%LEAVE_OVERLAP%');
select pg_temp.check(public.hr_record_leave(:po, 'paid', '2026-05-04', '2026-05-04', 'Other half', 'afternoon') is not null, 'the other half of the same date can be recorded');
select pg_temp.denied(format($$select public.hr_record_leave(%L, 'lop', '2026-06-01', '2026-08-15', 'Too long', null)$$, :po), 'more than 60 days at a time is rejected', '%60 days%');
select pg_temp.denied(format($$select public.hr_record_leave(%L, 'paid', '2026-06-01', '2026-06-30', 'Whole month', null)$$, :po), 'paid leave above the balance is rejected', '%LEAVE_BALANCE%');
select public.hr_record_leave(:po, 'lop', '2026-05-06', '2026-05-06', 'Unpaid, reported late') as r_lop \gset
select pg_temp.check((select count(*) from public.leave_ledger where request_id = :'r_lop') = 0, 'recorded Loss of Pay never touches a balance');
select pg_temp.denied(format($$select public.hr_record_leave(%L, 'sick', '2026-05-07', '2026-05-07', 'x', null)$$, :po), 'a reason is required', '%reason%');
select pg_temp.denied(format($$select public.hr_record_leave(%L, 'sick', '2026-05-07', '2026-05-07', 'Myself', null)$$, :hr), 'HR cannot record leave for themselves', '%My Leave%');
rollback;

begin; select pg_temp.act_as(:mgr);
select pg_temp.denied(format($$select public.hr_record_leave(%L, 'sick', '2026-05-07', '2026-05-07', 'Manager try', null)$$, :po), 'a manager without HR access cannot record leave', '%Only HR%');
rollback;
begin; select pg_temp.act_as(:po);
select pg_temp.denied(format($$select public.hr_record_leave(%L, 'sick', '2026-05-07', '2026-05-07', 'Colleague', null)$$, :app), 'an employee cannot record leave for others', '%Only HR%');
rollback;

begin; select pg_temp.trusted();
update public.profiles set status = 'suspended' where id = :pso;
select pg_temp.act_as(:hr);
select pg_temp.denied(format($$select public.hr_record_leave(%L, 'sick', '2026-05-07', '2026-05-07', 'Inactive', null)$$, :pso), 'leave cannot be recorded for an inactive account', '%not active%');
rollback;

\echo '== workforce calendar visibility'
begin; select pg_temp.act_as(:hr);
select pg_temp.check((select count(*) from public.workforce_calendar('2026-05-01') where employee_id = :po) = 31, 'HR sees every day of the month for an employee');
select pg_temp.check((select count(distinct employee_id) from public.workforce_calendar('2026-05-01')) >= 5, 'HR sees all current employees');
rollback;
begin; select pg_temp.act_as(:mgr);
select pg_temp.check((select array_agg(distinct employee_id order by employee_id) from public.workforce_calendar('2026-05-01'))
  = array[:mgr, :po, :app]::uuid[], 'a manager sees themselves and their team only');
rollback;
begin; select pg_temp.act_as(:po);
select pg_temp.check((select array_agg(distinct employee_id) from public.workforce_calendar('2026-05-01')) = array[:po]::uuid[], 'an employee sees only themselves');
rollback;
begin; select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select count(*) from public.workforce_calendar('2026-05-01')) = 0, 'a partner user sees no internal HR calendar');
rollback;
