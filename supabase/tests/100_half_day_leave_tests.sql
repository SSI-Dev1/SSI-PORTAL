-- Half-day leave, Loss of Pay, review history and fractional attendance totals (0023).
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
create or replace function pg_temp.ist(d date, t text) returns timestamptz language sql as $$
  select (d::text || ' ' || t)::timestamp at time zone 'Asia/Kolkata';
$$;
create or replace function pg_temp.bal(emp uuid, t text) returns record language sql as $$
  select (b.used, b.available) from public.leave_balances(emp, 2026) b where b.leave_type = t;
$$;

-- Employees from 70_hr_tests.sql: f1 HR, f2 manager, f3 officer (reports to f2, standard shift Mon–Sat), f5 not in f2's team.
\set hr  '''00000000-0000-0000-0000-0000000000f1'''
\set mgr '''00000000-0000-0000-0000-0000000000f2'''
\set po  '''00000000-0000-0000-0000-0000000000f3'''
\set pso '''00000000-0000-0000-0000-0000000000f5'''
\set partner '''00000000-0000-0000-0000-0000000000b1'''

\echo '== half-day and Loss of Pay requests'
begin;
select pg_temp.trusted();
select (select used from public.leave_balances(:po, 2026) where leave_type = 'sick') as sick_used0,
       (select used from public.leave_balances(:po, 2026) where leave_type = 'paid') as paid_used0 \gset
select pg_temp.act_as(:po);
select public.apply_leave('sick', '2026-03-02', '2026-03-02', 'Doctor visit', 'morning') as r_sl_am \gset
select public.apply_leave('paid', '2026-03-02', '2026-03-02', 'Family errand', 'afternoon') as r_pl_pm \gset
select pg_temp.check((select days = 0.5 and half_day_session = 'morning' from public.leave_requests where id = :'r_sl_am'), 'morning half day is 0.5 day');
select pg_temp.check((select count(*) from public.leave_requests where employee_id = :po and start_date = '2026-03-02') = 2, 'a morning and an afternoon half may share a date');
select pg_temp.denied($$select public.apply_leave('paid', '2026-03-02', '2026-03-02', 'Again', 'morning')$$, 'a second morning half on the same date is rejected', '%LEAVE_OVERLAP%');
select pg_temp.denied($$select public.apply_leave('paid', '2026-03-02', '2026-03-02', 'Full day', null)$$, 'a full day on a date with half days is rejected', '%LEAVE_OVERLAP%');
select pg_temp.denied($$select public.apply_leave('paid', '2026-03-09', '2026-03-10', 'Two dates', 'morning')$$, 'a half day spans one date only', '%single date%');
select pg_temp.denied($$select public.apply_leave('paid', '2026-03-09', '2026-03-09', 'Evening', 'evening')$$, 'session must be morning or afternoon', '%Morning or Afternoon%');
select pg_temp.check((select pending = 0.5 from public.leave_balances(:po, 2026) where leave_type = 'sick'), 'a pending half day reserves 0.5, not 1');
select public.apply_leave('lop', '2026-03-03', '2026-03-03', 'Personal work') as r_lop \gset
select public.apply_leave('sick', '2026-03-04', '2026-03-04', 'Unwell after lunch', 'afternoon') as r_sl_pm \gset
select public.apply_leave('paid', '2026-03-05', '2026-03-05', 'Bank', 'morning') as r_pl_am \gset
select pg_temp.check(not exists (select 1 from public.leave_balances(:po, 2026) where leave_type = 'lop'), 'Loss of Pay has no balance');
select pg_temp.check(public.apply_leave('lop', '2026-04-06', '2026-04-30', 'Long unpaid break') is not null, 'Loss of Pay is never limited by a balance');

select pg_temp.act_as(:mgr);
select public.decide_leave(:'r_sl_am', true, 'ok');
select public.decide_leave(:'r_pl_pm', true, 'ok');
select public.decide_leave(:'r_lop', true, 'approved unpaid');
select public.decide_leave(:'r_sl_pm', true, null);
select public.decide_leave(:'r_pl_am', true, null);
select pg_temp.check((select used = :sick_used0 + 1 from public.leave_balances(:po, 2026) where leave_type = 'sick'), 'two approved sick half days deduct 1.0');
select pg_temp.check((select used = :paid_used0 + 1 from public.leave_balances(:po, 2026) where leave_type = 'paid'), 'two approved paid half days deduct 1.0');
select pg_temp.check((select count(*) from public.leave_ledger where request_id = :'r_lop') = 0, 'approved Loss of Pay writes nothing to the balance ledger');
select pg_temp.check((select days = -0.5 from public.leave_ledger where request_id = :'r_sl_am' and entry_type = 'debit'), 'half-day debit is 0.5');

\echo '== review history'
select pg_temp.check((select array_agg(action order by id) from public.leave_events where request_id = :'r_sl_am') = '{requested,approved}', 'history: requested, approved');
select pg_temp.check((select actor_id = :mgr::uuid and comment = 'ok' from public.leave_events where request_id = :'r_sl_am' and action = 'approved'), 'history keeps the approver and comment');

\echo '== day status and monthly totals'
select pg_temp.trusted();
insert into public.attendance_sessions (employee_id, work_date, punch_in_at, punch_out_at) values
  (:po, '2026-03-04', pg_temp.ist('2026-03-04', '09:30'), pg_temp.ist('2026-03-04', '13:30')),
  (:po, '2026-03-06', pg_temp.ist('2026-03-06', '09:30'), pg_temp.ist('2026-03-06', '18:30'));
select pg_temp.act_as(:po);
select pg_temp.check((select code = 'HD' and sick_leave = 0.5 and paid_leave = 0.5 and present = 0 and lop = 0
                      and label = 'Morning Leave (Sick Leave) + Afternoon Leave (Paid Leave)' from public.attendance_calendar(:po, '2026-03-02', '2026-03-02')),
  'morning sick + afternoon paid: 0.5 + 0.5, no LOP');
select pg_temp.check((select code = 'LOP' and lop = 1 and absent = 0 and label = 'Loss of Pay' from public.attendance_calendar(:po, '2026-03-03', '2026-03-03')), 'approved Loss of Pay day = 1 LOP');
select pg_temp.check((select code = 'HD' and present = 0.5 and sick_leave = 0.5 and lop = 0 and label like 'Afternoon Leave (Sick Leave) · Morning present'
                      from public.attendance_calendar(:po, '2026-03-04', '2026-03-04')), 'Afternoon Leave + worked morning = 0.5 present');
select pg_temp.check((select code = 'HD' and paid_leave = 0.5 and absent = 0.5 and lop = 0.5 and label like 'Morning Leave (Paid Leave) · Afternoon absent'
                      from public.attendance_calendar(:po, '2026-03-05', '2026-03-05')), 'Morning Leave without attendance: other half 0.5 absent (0.5 LOP), never a full day');
select pg_temp.check((select code = 'P' and present = 1 from public.attendance_calendar(:po, '2026-03-06', '2026-03-06')), 'attended day = 1 present');
select pg_temp.check((select code = 'WO' and not working and present = 0 and lop = 0 from public.attendance_calendar(:po, '2026-03-08', '2026-03-08')), 'Sunday is a weekly off, never absent');
select pg_temp.check((select code = 'A' and absent = 1 and lop = 1 from public.attendance_calendar(:po, '2026-03-07', '2026-03-07')), 'working day without attendance or leave = 1 absent');
select pg_temp.check((select sum(present) = 1.5 and sum(paid_leave) = 1 and sum(sick_leave) = 1 and sum(absent) = 1.5 and sum(lop) = 2.5
                      from public.attendance_calendar(:po, '2026-03-02', '2026-03-07')), 'week totals: 1.5 present · 1 paid · 1 sick · 1.5 absent · 2.5 LOP');
select pg_temp.check((select s.present_days = (select sum(present) from public.attendance_calendar(:po, '2026-03-01', '2026-03-31'))
                         and s.lop_days = (select sum(lop) from public.attendance_calendar(:po, '2026-03-01', '2026-03-31'))
                         and s.half_days = 3 and s.present_days = 1.5
                      from public.attendance_month_summary('2026-03-15') s where s.employee_id = :po), 'monthly summary uses the same day values (fractional 1.5 present, 3 half days)');
select pg_temp.check((select working_days = present_days + paid_leave_days + sick_leave_days + lop_days from public.attendance_month_summary('2026-03-01') where employee_id = :po),
  'every working day is fully accounted for: present + paid + sick + LOP = working days');
select pg_temp.check((select count(*) from public.attendance_month_summary('2026-03-01')) = 1, 'an employee sees only their own summary');

\echo '== who may see it'
select pg_temp.act_as(:mgr);
select pg_temp.check((select count(*) from public.attendance_calendar(:po, '2026-03-01', '2026-03-31')) = 31, 'manager sees the team member''s calendar');
select pg_temp.act_as(:pso);
select pg_temp.denied(format($$select * from public.attendance_calendar(%L, '2026-03-01', '2026-03-31')$$, :po), 'a colleague outside the team cannot', '%Not allowed%');
select pg_temp.check((select count(*) from public.leave_events where employee_id = :po) = 0, 'a colleague reads no leave history');
select pg_temp.act_as(:partner);
select pg_temp.denied(format($$select * from public.attendance_calendar(%L, '2026-03-01', '2026-03-31')$$, :po), 'partners cannot read SSI attendance', '%Not allowed%');
select pg_temp.check((select count(*) from public.attendance_month_summary('2026-03-01')) = 0, 'partners get no attendance summary');

\echo '== cancellation returns only what was deducted'
select pg_temp.act_as(:po);
select pg_temp.denied(format($$select public.cancel_leave(%L)$$, :'r_pl_am'), 'employee cannot cancel approved leave that has started', '%cannot cancel%');
select pg_temp.act_as(:hr);
select public.cancel_leave(:'r_lop');
select public.cancel_leave(:'r_pl_am');
select pg_temp.check((select count(*) from public.leave_ledger where request_id = :'r_lop') = 0, 'cancelled Loss of Pay: still nothing in the ledger');
select pg_temp.check((select days = 0.5 from public.leave_ledger where request_id = :'r_pl_am' and entry_type = 'reversal'), 'cancelled paid half day returns 0.5');
select pg_temp.check((select used = :paid_used0 + 0.5 from public.leave_balances(:po, 2026) where leave_type = 'paid'), 'paid balance back to one half day used');
select pg_temp.check((select array_agg(action order by id) from public.leave_events where request_id = :'r_lop') = '{requested,approved,cancelled}', 'history records the cancellation');
select pg_temp.check((select code = 'A' and absent = 1 from public.attendance_calendar(:po, '2026-03-03', '2026-03-03')), 'after cancelling Loss of Pay the day is an unapproved absence');
rollback;
