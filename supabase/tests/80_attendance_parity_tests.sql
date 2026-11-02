-- Clock taps are idempotent, extra / below-required minutes, protected HR re-open (0016).
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

-- Employees from 70_hr_tests.sql: f1 HR, f2 manager, f3 officer (reports to f2), f4 app team (flexible, reports to f2), f5.
\set hr  '''00000000-0000-0000-0000-0000000000f1'''
\set mgr '''00000000-0000-0000-0000-0000000000f2'''
\set po  '''00000000-0000-0000-0000-0000000000f3'''
\set app '''00000000-0000-0000-0000-0000000000f4'''
\set pso '''00000000-0000-0000-0000-0000000000f5'''
\set rid1 '''11111111-1111-4111-8111-111111111111'''
\set rid2 '''22222222-2222-4222-8222-222222222222'''

\echo '== idempotent clock taps'
begin; select pg_temp.act_as(:pso);
select public.clock_action('in', :rid1);
select pg_temp.check((select (public.clock_action('in', '11111111-1111-4111-8111-111111111111') ->> 'replayed')::boolean), 'same tap again replays the first result');
select pg_temp.check((select count(*) from public.attendance_sessions where employee_id = '00000000-0000-0000-0000-0000000000f5') = 1, 'double tap creates one clock-in');
select pg_temp.denied($$select public.clock_action('out', '11111111-1111-4111-8111-111111111111')$$, 'a request id cannot be reused for another action', '%already used%');
select pg_temp.denied($$select public.clock_action('in', '33333333-3333-4333-8333-333333333333')$$, 'a new clock-in tap on the same day is still rejected', '%ALREADY_PUNCHED_IN%');
select public.clock_action('out', :rid2);
select pg_temp.check((select (public.clock_action('out', '22222222-2222-4222-8222-222222222222') ->> 'replayed')::boolean), 'repeated clock-out tap replays instead of failing');
select pg_temp.check((select state = 'Checked Out' from public.attendance_days where employee_id = '00000000-0000-0000-0000-0000000000f5'), 'clocked out once');
select pg_temp.act_as(:po);
select pg_temp.denied($$select public.clock_action('in', '11111111-1111-4111-8111-111111111111')$$, 'another employee cannot replay someone else''s request', '%already used%');
select pg_temp.denied($$select count(*) from public.clock_requests$$, 'clock requests are not readable', '%permission denied%');
rollback;

\echo '== extra and below-required minutes'
begin; select pg_temp.trusted();
insert into public.attendance_sessions (id, employee_id, work_date, punch_in_at, punch_out_at) values
  ('p-extra', :app, '2026-03-04', pg_temp.ist('2026-03-04', '09:00'), pg_temp.ist('2026-03-04', '18:30')),
  ('p-short', :app, '2026-03-05', pg_temp.ist('2026-03-05', '10:00'), pg_temp.ist('2026-03-05', '16:00')),
  ('p-open',  :app, '2026-03-06', pg_temp.ist('2026-03-06', '10:00'), null);
insert into public.break_sessions (session_id, start_at, end_at) values ('p-extra', pg_temp.ist('2026-03-04', '13:00'), pg_temp.ist('2026-03-04', '13:30'));
select pg_temp.check((select net_minutes = 540 and extra_minutes = 60 and short_minutes = 0 from public.attendance_days where id = 'p-extra'), 'flexible day: 9h30 − 30m break = 9h → 1h extra');
select pg_temp.check((select net_minutes = 360 and short_minutes = 120 and extra_minutes = 0 from public.attendance_days where id = 'p-short'), '6h worked → 2h below the 8h day');
select pg_temp.check((select short_minutes is null and extra_minutes is null from public.attendance_days where id = 'p-open'), 'open day has no extra / below figures yet');
rollback;

\echo '== protected re-open'
begin; select pg_temp.trusted();
insert into public.attendance_sessions (id, employee_id, work_date, punch_in_at, punch_out_at)
values ('r1', :po, public.company_today(), now() - interval '3 hours', now() - interval '1 hour');
select pg_temp.act_as(:po);
select pg_temp.denied($$select public.reopen_attendance('r1', 'Clicked by mistake')$$, 'employees cannot re-open attendance', '%Only HR%');
select pg_temp.act_as(:mgr);
select pg_temp.denied($$select public.reopen_attendance('r1', 'Clicked by mistake')$$, 'managers without HR rights cannot re-open', '%Only HR%');
select pg_temp.act_as(:hr);
select pg_temp.denied($$select public.reopen_attendance('r1', '')$$, 're-open needs a reason', '%reason%');
select public.reopen_attendance('r1', 'Clocked out by mistake');
select pg_temp.check((select punch_out_at is null and previous_punch_out_at is not null and reopened_by = '00000000-0000-0000-0000-0000000000f1' from public.attendance_sessions where id = 'r1'), 'original clock-out kept; day open again');
select pg_temp.denied($$select public.reopen_attendance('r1', 'again')$$, 'an open day cannot be re-opened', '%still open%');
select pg_temp.act_as(:po);
select public.clock_action('out', '44444444-4444-4444-8444-444444444444');
select pg_temp.check((select state = 'Checked Out' from public.attendance_days where id = 'r1'), 'employee can clock out again after re-open');
select pg_temp.act_as(:hr);
select pg_temp.denied($$select public.reopen_attendance((select id from public.attendance_sessions where employee_id = '00000000-0000-0000-0000-0000000000f1' limit 1), 'mine')$$, 'HR cannot re-open own attendance');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select pg_temp.check((select count(*) from public.audit_log where entity = 'attendance_sessions' and action = 'reopen' and entity_id = 'r1') = 1, 're-open is audited');
rollback;

\echo 'ALL SECURITY TESTS PASSED'
