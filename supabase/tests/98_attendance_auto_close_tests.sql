-- Automatic clock-out at the day cutoff, overnight shifts, review and corrections (0021).
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

-- Employees from 70_hr_tests.sql: f1 HR, f2 manager, f3 officer (reports to f2), f4 app team (reports to f2), f5.
\set hr  '''00000000-0000-0000-0000-0000000000f1'''
\set mgr '''00000000-0000-0000-0000-0000000000f2'''
\set po  '''00000000-0000-0000-0000-0000000000f3'''
\set app '''00000000-0000-0000-0000-0000000000f4'''
\set pso '''00000000-0000-0000-0000-0000000000f5'''
\set partner '''00000000-0000-0000-0000-0000000000b1'''

\echo '== TEST A: manual clock in and out'
begin; select pg_temp.act_as(:pso);
select public.clock_action('in', gen_random_uuid());
select public.clock_action('out', gen_random_uuid());
select pg_temp.check((select state = 'Checked Out' and out_kind = 'manual' and review_status is null and unverified_minutes = 0
                      from public.attendance_days where employee_id = :pso and work_date = public.company_today()), 'manual clock-out: normal record, nothing to review');
rollback;

\echo '== TEST B / D: forgotten clock-out is closed at local midnight, server side'
begin; select pg_temp.trusted();
delete from public.notifications;
insert into public.attendance_sessions (id, employee_id, work_date, punch_in_at)
values ('ac-1', :pso, public.company_today() - 1, pg_temp.ist(public.company_today() - 1, '10:00'));
insert into public.break_sessions (session_id, start_at) values ('ac-1', pg_temp.ist(public.company_today() - 1, '13:00'));
-- Before the job has run (browser closed, nobody signed in): already not running anywhere.
select pg_temp.check((select state = 'Auto Clock-Out' and gross_minutes is null and net_minutes = 0 and review_status = 'pending_review'
                      from public.attendance_days where id = 'ac-1'), 'overdue session shows as auto clock-out before the job runs, no time credited');
select pg_temp.check(public.open_session(:pso) is null, 'overdue session is never the open session');
select pg_temp.check(public.att_close_overdue(null, now()) = 1, 'scheduled closure closes the overdue session');
select pg_temp.check((select closed_reason = 'auto_midnight' and closure_note = 'Missed Manual Clock-Out — System Auto-Closed'
                      and auto_closed_at = (public.company_today())::timestamp at time zone 'Asia/Kolkata' and review_status = 'pending_review'
                      and punch_out_at is null
                      from public.attendance_sessions where id = 'ac-1'), 'closed as automatic clock-out at the Asia/Kolkata midnight cutoff, no clock-out invented');
select pg_temp.check((select end_at = (public.company_today())::timestamp at time zone 'Asia/Kolkata' from public.break_sessions where session_id = 'ac-1'), 'running break ends at the cutoff');
select pg_temp.check((select state = 'Auto Clock-Out' and out_kind = 'auto' and net_minutes = 0 and short_minutes is null
                      and recorded_minutes = 14 * 60 - (11 * 60) and unverified_minutes = recorded_minutes
                      from public.attendance_days where id = 'ac-1'), 'recorded 10:00→midnight minus break kept as unverified, not as worked hours');
select pg_temp.check((select count(*) from public.notifications where user_id = :pso and kind = 'attendance') = 1, 'employee is told about the automatic clock-out');
select pg_temp.check((select count(*) from public.audit_log where action = 'auto_clock_out' and entity_id = 'ac-1') = 1, 'closure is in the audit log');

\echo '== TEST F: running the closure again changes nothing'
select pg_temp.check(public.att_close_overdue(null, now()) = 0, 'second run closes nothing');
select pg_temp.check(public.auto_close_attendance() = 0, 'scheduled entry point is idempotent too');
select pg_temp.check((select count(*) from public.attendance_sessions where employee_id = :pso) = 1, 'no duplicate sessions');
select pg_temp.check((select count(*) from public.audit_log where action = 'auto_clock_out' and entity_id = 'ac-1') = 1, 'no duplicate clock-out records');
select pg_temp.check((select count(*) from public.notifications where user_id = :pso and kind = 'attendance') = 1, 'no duplicate notifications');

\echo '== TEST C: next morning starts fresh'
select pg_temp.act_as(:pso);
select pg_temp.check(not exists (select 1 from public.attendance_days where employee_id = :pso and state in ('Checked In', 'On Break')), 'nothing is running');
select public.clock_action('in', gen_random_uuid());
select pg_temp.check((select count(*) from public.attendance_sessions where employee_id = :pso) = 2, 'clock-in creates a new session');
select pg_temp.check((select state = 'Checked In' and break_minutes = 0 from public.attendance_days where employee_id = :pso and work_date = public.company_today()), 'new day: own working and break time');
select pg_temp.check((select closed_reason = 'auto_midnight' from public.attendance_sessions where id = 'ac-1'), 'previous day kept in history unchanged');
rollback;

\echo '== lazy closure on the next clock action (job delayed)'
begin; select pg_temp.trusted();
insert into public.attendance_sessions (id, employee_id, work_date, punch_in_at)
values ('ac-2', :pso, public.company_today() - 2, pg_temp.ist(public.company_today() - 2, '09:00'));
select pg_temp.act_as(:pso);
select public.clock_action('in', gen_random_uuid());
select pg_temp.trusted();
select pg_temp.check((select closed_reason = 'auto_midnight' and review_status = 'pending_review' from public.attendance_sessions where id = 'ac-2'), 'clocking in closes the overdue session first');
rollback;

\echo '== TEST G: overnight shift follows its own cutoff'
begin; select pg_temp.trusted();
insert into public.shifts (id, name, flexible, start_time, end_time, required_minutes, overnight, auto_close_time)
values ('night', 'Night (22:00–06:00)', false, '22:00', '06:00', 480, true, '10:00');
update public.employees set shift_id = 'night' where id = :app;
insert into public.attendance_sessions (id, employee_id, work_date, punch_in_at)
values ('ov-1', :app, date '2026-04-10', pg_temp.ist('2026-04-10', '22:00')),
       ('day-1', :pso, date '2026-04-10', pg_temp.ist('2026-04-10', '22:00'));
select pg_temp.check(public.att_close_overdue(null, pg_temp.ist('2026-04-11', '05:00')) = 1, 'at 05:00 only the daytime-shift session is closed');
select pg_temp.check((select closed_reason is null from public.attendance_sessions where id = 'ov-1'), 'overnight shift is not closed when the date changes');
select pg_temp.check(public.att_close_overdue(null, pg_temp.ist('2026-04-11', '09:59')) = 0, 'still running before the configured cutoff');
select pg_temp.check(public.att_close_overdue(null, pg_temp.ist('2026-04-11', '10:01')) = 1, 'closed after the overnight cutoff');
select pg_temp.check((select auto_closed_at = pg_temp.ist('2026-04-11', '10:00') from public.attendance_sessions where id = 'ov-1'), 'overnight cutoff time recorded');
update public.shifts set auto_close_time = null where id = 'night';
select pg_temp.check(public.att_cutoff(:app, date '2026-04-10') = pg_temp.ist('2026-04-11', '10:00'), 'default overnight cutoff: four hours after the shift end');
rollback;

\echo '== TEST H: HR settles an automatically closed day'
begin; select pg_temp.trusted();
insert into public.attendance_sessions (id, employee_id, work_date, punch_in_at)
values ('ac-3', :pso, public.company_today() - 1, pg_temp.ist(public.company_today() - 1, '09:30'));
select public.att_close_overdue(:pso, now());
select pg_temp.act_as(:pso);
select pg_temp.denied($$select public.hr_resolve_auto_close('ac-3', now() - interval '20 hours', 30, 'own')$$, 'employee cannot settle their own day', '%cannot review%');
select pg_temp.act_as(:hr);
select pg_temp.denied(format($$select public.hr_resolve_auto_close('ac-3', %L, 30, 'too late')$$, pg_temp.ist(public.company_today(), '01:00')), 'finish time after the cutoff is rejected', '%no later than%');
select public.hr_resolve_auto_close('ac-3', pg_temp.ist(public.company_today() - 1, '18:00'), 30, 'Confirmed with the team lead');
select pg_temp.check((select state = 'Checked Out' and out_kind = 'corrected' and review_status = 'corrected' and net_minutes = 480 and unverified_minutes = 0
                      from public.attendance_days where id = 'ac-3'), 'approved correction: 09:30–18:00 minus 30m = 8h credited');
select pg_temp.check((select punch_out_at is null and closed_reason = 'auto_midnight' and auto_closed_at is not null and corrected_out_at = pg_temp.ist(public.company_today() - 1, '18:00')
                      from public.attendance_sessions where id = 'ac-3'), 'original record kept next to the correction');
select pg_temp.check((select status = 'Approved' and original ->> 'closed_reason' = 'auto_midnight' and decided_by = :hr::uuid
                      from public.attendance_corrections where session_id = 'ac-3'), 'correction history holds the original values and who approved');
select pg_temp.denied($$select public.hr_resolve_auto_close('ac-3', null, null, 'again')$$, 'a settled day cannot be settled twice', '%not waiting for review%');
select pg_temp.denied($$select public.reopen_attendance('ac-3', 'reopen old day')$$, 'an ended day cannot be re-opened', '%has ended%');
rollback;

\echo '== employee correction request on an automatically closed day'
begin; select pg_temp.trusted();
insert into public.attendance_sessions (id, employee_id, work_date, punch_in_at)
values ('ac-4', :po, public.company_today() - 1, pg_temp.ist(public.company_today() - 1, '10:00'));
select public.att_close_overdue(:po, now());
select pg_temp.act_as(:po);
select public.request_attendance_correction(public.company_today() - 1, 'missed_punch_out', null, pg_temp.ist(public.company_today() - 1, '17:00'), null, 'Forgot to clock out');
select pg_temp.check((select correction_pending and review_status = 'pending_review' from public.attendance_days where id = 'ac-4'), 'pending review shown with the pending request');
select pg_temp.act_as(:mgr);
select public.decide_attendance_correction((select id from public.attendance_corrections where session_id = 'ac-4'), true, 'ok');
select pg_temp.check((select review_status = 'corrected' and out_kind = 'corrected' and net_minutes = 420 and not correction_pending
                      from public.attendance_days where id = 'ac-4'), 'manager approval settles the review and recalculates hours');
rollback;
begin; select pg_temp.trusted();
insert into public.attendance_sessions (id, employee_id, work_date, punch_in_at)
values ('ac-5', :po, public.company_today() - 1, pg_temp.ist(public.company_today() - 1, '10:00'));
select public.att_close_overdue(:po, now());
select pg_temp.act_as(:po);
select public.request_attendance_correction(public.company_today() - 1, 'missed_punch_out', null, pg_temp.ist(public.company_today() - 1, '23:00'), null, 'Worked late');
select pg_temp.act_as(:hr);
select public.decide_attendance_correction((select id from public.attendance_corrections where session_id = 'ac-5'), false, 'No evidence');
select pg_temp.check((select review_status = 'reviewed' and state = 'Auto Clock-Out' and net_minutes = 0 from public.attendance_days where id = 'ac-5'), 'rejected request: reviewed, still no time credited');
rollback;

\echo '== access'
begin; select pg_temp.trusted();
insert into public.attendance_sessions (id, employee_id, work_date, punch_in_at)
values ('ac-6', :pso, public.company_today() - 1, pg_temp.ist(public.company_today() - 1, '10:00'));
select pg_temp.act_as(:pso);
select pg_temp.denied($$select public.att_close_overdue(null, now())$$, 'the closure internals are not callable by users', '%permission denied%');
select pg_temp.denied($$select public.auto_close_attendance()$$, 'only HR can run the closure on demand', '%Only HR%');
select pg_temp.act_as(:hr);
select pg_temp.check(public.auto_close_attendance() = 1, 'HR can run the closure on demand');
select pg_temp.act_as(:partner);
select pg_temp.check((select count(*) from public.attendance_days) = 0, 'partner users see no SSI attendance');
select pg_temp.check((select count(*) from public.attendance_corrections) = 0, 'partner users see no attendance corrections');
select pg_temp.check((select count(*) from public.employee_salaries) = 0, 'partner users see no SSI salaries');
select pg_temp.denied($$select public.hr_resolve_auto_close('ac-6', null, null, 'x partner')$$, 'partner cannot review SSI attendance', '%cannot review%');
rollback;
