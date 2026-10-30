-- Employees, daily reports, attendance, leave and HR permissions (0012–0015).
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
    if pattern <> '' and sqlerrm not like pattern then
      raise exception 'FAIL: % — wrong error: %', msg, sqlerrm using errcode = 'TF001';
    end if;
    raise notice 'pass: % (rejected: %)', msg, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % — statement was allowed', msg using errcode = 'TF001';
end $$;
-- Blocked = rejected with an error, or filtered by RLS so no row changes.
create or replace function pg_temp.blocked(stmt text, msg text) returns void language plpgsql as $$
declare n bigint;
begin
  begin
    execute stmt;
    get diagnostics n = row_count;
  exception when others then
    raise notice 'pass: % (rejected: %)', msg, sqlerrm;
    return;
  end;
  if n > 0 then raise exception 'FAIL: % — % row(s) changed', msg, n using errcode = 'TF001'; end if;
  raise notice 'pass: % (no rows visible to change)', msg;
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

\set super   '''00000000-0000-0000-0000-0000000000a1'''
\set p1admin '''00000000-0000-0000-0000-0000000000b1'''
\set hr      '''00000000-0000-0000-0000-0000000000f1'''
\set mgr     '''00000000-0000-0000-0000-0000000000f2'''
\set po      '''00000000-0000-0000-0000-0000000000f3'''
\set app     '''00000000-0000-0000-0000-0000000000f4'''
\set pso     '''00000000-0000-0000-0000-0000000000f5'''

-- Fixtures (trusted context): five employees; the officer and the application team member report to the manager.
insert into auth.users (id, email) values
  (:hr, 'hr@ssi.test'), (:mgr, 'mgr@ssi.test'), (:po, 'po@ssi.test'), (:app, 'app@ssi.test'), (:pso, 'pso@ssi.test');
insert into public.profiles (id, role, full_name, status, permissions) values
  (:hr, 'support_staff', 'Hana HR', 'active', '{tasks,hr,hr_accounts}'),
  (:mgr, 'application_manager', 'Manu Manager', 'active', null),
  (:po, 'support_staff', 'Priya Partnerships', 'active', null),
  (:app, 'application_manager', 'Arun Applications', 'active', null),
  (:pso, 'support_staff', 'Sara Success', 'active', null);
insert into public.employees (id, employee_code, designation_id, department_id, reporting_manager_id, joining_date, employment_status, date_of_birth, shift_id) values
  (:hr, 'SSI-001', 'hr_manager', 'hr', null, '2024-01-10', 'Active', '1990-05-01', 'standard'),
  (:mgr, 'SSI-002', 'senior_international_recruitment_manager', 'recruitment', null, '2023-03-01', 'Active', null, 'standard'),
  (:po, 'SSI-003', 'partnership_officer', 'partnerships', :mgr, '2025-06-01', 'Probation', null, 'standard'),
  (:app, 'SSI-004', 'application_team', 'applications', :mgr, '2025-01-01', 'Active', null, 'flexible'),
  (:pso, 'SSI-005', 'partner_success_officer', 'partnerships', null, '2025-01-01', 'Active', null, 'standard');
insert into public.employee_salaries (employee_id, amount) values (:po, 45000);

\echo '== access and workspaces'
begin; select pg_temp.act_as(:po);
select pg_temp.check((select employee and designations = '{partnership_officer}' and not has_team from public.my_access()), 'officer: employee workspace with Partnership Officer designation');
select pg_temp.check((select count(*) from public.my_report_templates() where id = 'partnership_officer') = 1, 'officer gets the Partnership Officer template');
select pg_temp.check((select jsonb_array_length(sections) from public.my_report_templates()) = 4, 'template has 4 sections');
select pg_temp.check((select count(*) from public.employee_salaries) = 0, 'employees cannot see salaries (even their own)');
select pg_temp.check((select count(*) from public.employees) = 1, 'employees see only their own employee record');
select pg_temp.blocked($$update public.employees set designation_id = 'hr_manager' where id = '00000000-0000-0000-0000-0000000000f3'$$, 'employee cannot change own designation');
select pg_temp.blocked($$update public.profiles set permissions = '{tasks,hr}' where id = '00000000-0000-0000-0000-0000000000f3'$$, 'employee cannot grant self HR');
rollback;

begin; select pg_temp.act_as(:mgr);
select pg_temp.check((select has_team from public.my_access()), 'manager has a team');
select pg_temp.check((select count(*) from public.employees) = 3, 'manager sees self and two reports only');
select pg_temp.check(not exists (select 1 from public.employees where id = '00000000-0000-0000-0000-0000000000f5'), 'manager does not see employees outside the team');
select pg_temp.check((select count(*) from public.employee_salaries) = 0, 'managers do not see salaries');
rollback;

begin; select pg_temp.act_as(:hr);
select pg_temp.check((select count(*) from public.employees) = 5, 'HR sees all employees');
select pg_temp.check((select count(*) from public.employee_salaries) = 0, 'HR without hr_salary cannot see salaries');
select pg_temp.denied($$update public.profiles set permissions = '{tasks,hr,hr_accounts,hr_salary}' where id = '00000000-0000-0000-0000-0000000000f1'$$, 'HR cannot grant itself salary access');
select pg_temp.blocked($$update public.profiles set permissions = '{tasks,hr}' where id = '00000000-0000-0000-0000-0000000000f4'$$, 'HR cannot grant HR permissions to others');
select pg_temp.blocked($$update public.employees set reporting_manager_id = '00000000-0000-0000-0000-0000000000f1' where id = '00000000-0000-0000-0000-0000000000a1'$$, 'HR cannot change Super Admin records');
rollback;

begin; select pg_temp.act_as(:super);
select pg_temp.check((select amount = 45000 from public.employee_salaries where employee_id = '00000000-0000-0000-0000-0000000000f3'), 'Super Admin sees salaries');
rollback;

begin; select pg_temp.act_as(:p1admin);
select pg_temp.check((select count(*) from public.employees) = 0, 'external partner sees no employees');
select pg_temp.check((select count(*) from public.employee_salaries) = 0, 'external partner sees no salaries');
select pg_temp.check((select count(*) from public.attendance_sessions) + (select count(*) from public.leave_requests) + (select count(*) from public.daily_reports) = 0, 'external partner sees no attendance, leave or reports');
select pg_temp.check((select count(*) from public.employee_directory()) = 0, 'external partner gets an empty employee directory');
select pg_temp.denied($$select public.punch_in('{}')$$, 'external partner cannot punch in');
select pg_temp.denied($$select public.save_daily_report('partnership_officer', current_date, '{}', '{}')$$, 'external partner cannot file reports');
rollback;

begin; select pg_temp.trusted();
select pg_temp.denied($$update public.employees set reporting_manager_id = '00000000-0000-0000-0000-0000000000f3' where id = '00000000-0000-0000-0000-0000000000f2'$$, 'reporting-line loops are rejected');
rollback;

\echo '== daily reports'
begin; select pg_temp.act_as(:po);
select pg_temp.denied($$select public.save_daily_report('partnership_officer', public.company_today(), '{"po_meetings_fixed": -1}', '{}')$$, 'negative counts rejected', '%whole number%');
select pg_temp.denied($$select public.save_daily_report('partnership_officer', public.company_today(), '{"po_meetings_fixed": 1.5}', '{}')$$, 'fractional counts rejected', '%whole number%');
select pg_temp.denied($$select public.save_daily_report('partnership_officer', public.company_today(), '{"made_up": 3}', '{}')$$, 'unknown fields rejected', '%Unknown report field%');
select pg_temp.denied($$select public.save_daily_report('partnership_officer', public.company_today(), '{}', '{}', '{}', true)$$, 'empty reports cannot be submitted', '%EMPTY_REPORT%');
select pg_temp.denied($$select public.save_daily_report('application_team', public.company_today(), '{"pr_pending": 1}', '{}')$$, 'another designation''s template rejected');
select pg_temp.denied($$select public.save_daily_report('partnership_officer', public.company_today() + 1, '{"po_meetings_fixed": 1}', '{}')$$, 'future dates rejected');
select public.save_daily_report('partnership_officer', public.company_today(), '{"po_new_partners_contacted": 4, "li_new_connections": 0}', '{"achievements": "Two partner calls"}');
select pg_temp.check((select status = 'Draft' and metrics = '{"po_new_partners_contacted": 4, "li_new_connections": 0}' from public.daily_reports), 'draft saved with zero kept as a real value');
select public.save_daily_report('partnership_officer', public.company_today(), '{"po_new_partners_contacted": 5, "po_mous_signed": 1}', '{"achievements": "MOU signed", "tomorrow_plan": "Follow up"}', '{}', true);
select pg_temp.check((select status = 'Submitted' and submitted_at is not null and (metrics ->> 'po_mous_signed')::int = 1 from public.daily_reports), 'report submitted');
select pg_temp.check((select count(*) from public.daily_reports) = 1, 'same day and template updates the one report (no duplicate)');
select pg_temp.denied($$select public.save_daily_report('partnership_officer', public.company_today(), '{"po_closed": 1}', '{}')$$, 'submitted report is locked', '%REPORT_LOCKED%');
select pg_temp.denied($$select public.review_daily_report((select id from public.daily_reports), 'approve')$$, 'employees cannot approve their own report');
commit;

begin; select pg_temp.act_as(:mgr);
select pg_temp.check((select count(*) from public.daily_reports where employee_id = '00000000-0000-0000-0000-0000000000f3') = 1, 'manager sees the team report');
select pg_temp.check((select count(*) from public.notifications where kind = 'report') >= 1, 'manager was notified');
select pg_temp.denied($$select public.review_daily_report((select id from public.daily_reports limit 1), 'request_correction', '')$$, 'correction needs a comment');
select public.review_daily_report((select id from public.daily_reports limit 1), 'request_correction', 'Add the LinkedIn figures');
commit;

begin; select pg_temp.act_as(:pso);
select pg_temp.check((select count(*) from public.daily_reports) = 0, 'colleagues outside the team cannot see the report');
rollback;

begin; select pg_temp.act_as(:po);
select public.save_daily_report('partnership_officer', public.company_today(), '{"po_new_partners_contacted": 5, "po_mous_signed": 1, "li_new_connections": 12}', '{"achievements": "MOU signed"}', '{}', true);
select pg_temp.check((select status = 'Submitted' and (metrics ->> 'li_new_connections')::int = 12 from public.daily_reports), 'corrected report resubmitted');
commit;

begin; select pg_temp.act_as(:super);
select public.review_daily_report((select id from public.daily_reports limit 1), 'approve');
select pg_temp.check((select status = 'Approved' from public.daily_reports), 'admin approved the report');
select pg_temp.check((select count(*) from public.daily_report_events) = 5, 'audit history has every save, submission and review (5)');
select pg_temp.check((select count(*) from public.report_expectations(public.company_today()) where employee_id = '00000000-0000-0000-0000-0000000000f3' and status = 'Approved') = 1, 'expectations list the approved report');
select pg_temp.check((select count(*) from public.report_expectations(public.company_today()) where report_id is null) = 3, 'three employees with templates have not reported (no rows created)');
commit;

\echo '== designation change keeps history'
begin; select pg_temp.act_as(:super);
update public.employees set designation_id = 'partner_success_officer' where id = :po;
commit;
begin; select pg_temp.act_as(:po);
select pg_temp.check((select designation_id = 'partnership_officer' and template_id = 'partnership_officer' and template_version = 1 from public.daily_reports), 'old report keeps its designation and template');
select pg_temp.check((select string_agg(id, ',') from public.my_report_templates()) = 'partner_success_officer', 'new template for future reports');
select pg_temp.denied($$select public.save_daily_report('partnership_officer', public.company_today() - 1, '{"po_closed": 1}', '{}')$$, 'old template no longer usable for new dates');
select pg_temp.check((select count(*) from public.designation_history where employee_id = '00000000-0000-0000-0000-0000000000f3') = 2, 'designation history recorded');
rollback;

\echo '== attendance'
begin; select pg_temp.act_as(:app);
select public.punch_in('{"status": "captured", "latitude": 9.9312, "longitude": 76.2673, "accuracy": 25, "captured_at": "2026-01-01T03:30:00Z"}');
select pg_temp.check((select state = 'Checked In' and punch_in_at = now() from public.attendance_days), 'punch in uses the server clock');
select pg_temp.denied($$select public.punch_in('{}')$$, 'second punch-in rejected', '%ALREADY_PUNCHED_IN%');
select public.break_start();
select pg_temp.denied($$select public.break_start()$$, 'overlapping break rejected', '%ON_BREAK%');
select pg_temp.check((select state = 'On Break' from public.attendance_days), 'state is On Break');
select public.break_end();
select pg_temp.denied($$select public.break_end()$$, 'no open break to end', '%NOT_ON_BREAK%');
select public.punch_out('{"status": "denied"}');
select pg_temp.check((select state = 'Checked Out' and location_status_out = 'denied' from public.attendance_days), 'punch out without location under the optional policy');
select pg_temp.denied($$select public.punch_out('{}')$$, 'second punch-out rejected', '%NOT_PUNCHED_IN%');
select pg_temp.check((select count(*) from public.attendance_locations) = 1, 'employee sees own captured location only (no invented one)');
select pg_temp.blocked($$update public.attendance_sessions set punch_in_at = now() - interval '1 hour'$$, 'employees cannot edit punch times');
commit;

begin; select pg_temp.act_as(:mgr);
select pg_temp.check((select count(*) from public.attendance_sessions where employee_id = '00000000-0000-0000-0000-0000000000f4') = 1, 'manager sees team attendance');
select pg_temp.check((select count(*) from public.attendance_locations) = 0, 'managers cannot see locations');
rollback;
begin; select pg_temp.act_as(:hr);
select pg_temp.check((select count(*) from public.attendance_locations) = 1, 'HR can see locations');
rollback;

begin; select pg_temp.trusted();
update public.company_settings set value = '"required"' where key = 'location_policy';
select pg_temp.act_as(:pso);
select pg_temp.denied($$select public.punch_in('{"status": "denied"}')$$, 'required policy blocks punch without location', '%LOCATION_REQUIRED%');
rollback;

\echo '== working-hours calculations'
begin; select pg_temp.trusted();
-- Standard shift 09:30–18:30, grace 15 minutes, 8 hours required.
insert into public.attendance_sessions (id, employee_id, work_date, punch_in_at, punch_out_at) values
  ('t-on-time', :po, '2026-03-02', pg_temp.ist('2026-03-02', '09:40'), pg_temp.ist('2026-03-02', '18:40')),
  ('t-late', :po, '2026-03-03', pg_temp.ist('2026-03-03', '10:05'), pg_temp.ist('2026-03-03', '17:00')),
  ('t-flex', :app, '2026-03-02', pg_temp.ist('2026-03-02', '11:30'), pg_temp.ist('2026-03-02', '20:30'));
insert into public.break_sessions (session_id, start_at, end_at) values
  ('t-on-time', pg_temp.ist('2026-03-02', '13:00'), pg_temp.ist('2026-03-02', '13:45')),
  ('t-on-time', pg_temp.ist('2026-03-02', '16:00'), pg_temp.ist('2026-03-02', '16:15')),
  ('t-flex', pg_temp.ist('2026-03-02', '14:00'), pg_temp.ist('2026-03-02', '15:00'));
select pg_temp.check((select gross_minutes = 540 and break_minutes = 60 and net_minutes = 480 and not late and not early_checkout from public.attendance_days where id = 't-on-time'),
  'gross 9h − 1h unpaid break = 8h net, within grace, not early');
select pg_temp.check((select late and early_checkout and net_minutes = 415 from public.attendance_days where id = 't-late'), 'late arrival and early checkout flagged');
select pg_temp.check((select not late and net_minutes = 480 and not early_checkout from public.attendance_days where id = 't-flex'), 'flexible shift is never late');
rollback;

\echo '== attendance corrections'
begin; select pg_temp.trusted();
insert into public.attendance_sessions (id, employee_id, work_date, punch_in_at, closed_reason)
values ('t-forgot', :po, public.company_today() - 1, now() - interval '1 day', 'missing_punch_out');
select pg_temp.act_as(:po);
select pg_temp.check((select state = 'Missing Punch-out' from public.attendance_days where id = 't-forgot'), 'forgotten punch-out is shown, no time invented');
select public.request_attendance_correction(public.company_today() - 1, 'missed_punch_out', null, now() - interval '20 hours', null, 'Forgot to punch out');
select pg_temp.denied($$select public.request_attendance_correction(public.company_today() - 1, 'missed_punch_out', null, now() - interval '20 hours', null, 'Again')$$, 'one pending correction per day');
select pg_temp.denied($$select public.decide_attendance_correction((select id from public.attendance_corrections), true)$$, 'employee cannot approve own correction');
select pg_temp.act_as(:mgr);
select public.decide_attendance_correction((select id from public.attendance_corrections), true, 'OK');
select pg_temp.check((select punch_out_at is null and corrected_out_at is not null from public.attendance_sessions where id = 't-forgot'), 'original kept; corrected time stored separately');
select pg_temp.check((select eff_out = corrected_out_at and state = 'Checked Out' from public.attendance_days where id = 't-forgot'), 'totals use the approved correction');
select pg_temp.check((select status = 'Approved' and original ? 'punch_out_at' and applied ? 'corrected_out_at' and decided_by is not null from public.attendance_corrections), 'correction records original and applied values');
rollback;

\echo '== early checkout limit'
begin; select pg_temp.trusted();
insert into public.early_checkout_requests (employee_id, work_date, requested_time, reason, status) values
  (:po, date_trunc('month', public.company_today())::date, now(), 'Family emergency', 'Approved'),
  (:po, date_trunc('month', public.company_today())::date + 1, now(), 'Medical emergency', 'Approved');
select pg_temp.act_as(:po);
select pg_temp.denied($$select public.request_early_checkout(now() + interval '1 hour', 'Emergency')$$, 'third early checkout in a month rejected', '%EARLY_LIMIT%');
select pg_temp.denied($$select public.request_early_checkout(now() + interval '1 hour', '')$$, 'reason is mandatory');
rollback;
begin; select pg_temp.trusted();
insert into public.early_checkout_requests (id, employee_id, work_date, requested_time, reason, status) values
  ('ec-a', :po, date_trunc('month', public.company_today())::date, now(), 'Family emergency', 'Approved'),
  ('ec-b', :po, date_trunc('month', public.company_today())::date + 1, now(), 'Medical emergency', 'Approved'),
  ('ec-c', :po, date_trunc('month', public.company_today())::date + 2, now(), 'Another emergency', 'Pending');
select pg_temp.act_as(:mgr);
select pg_temp.denied($$select public.decide_early_checkout('ec-c', true)$$, 'approving beyond the limit is refused', '%EARLY_LIMIT%');
select pg_temp.denied($$select public.decide_early_checkout('ec-c', true, null, true, 'Exceptional')$$, 'managers cannot override the limit');
select pg_temp.act_as(:hr);
select pg_temp.denied($$select public.decide_early_checkout('ec-c', true, null, true, '')$$, 'override needs a reason');
select public.decide_early_checkout('ec-c', true, null, true, 'Hospital visit confirmed');
select pg_temp.check((select status = 'Approved' and override from public.early_checkout_requests where id = 'ec-c'), 'HR override approved and flagged');
select pg_temp.act_as(:super);
select pg_temp.check((select count(*) from public.audit_log where entity = 'early_checkout_requests' and action = 'override' and entity_id = 'ec-c') = 1, 'override audited');
rollback;

\echo '== Saturday off, holidays and leave'
-- Next month: first Saturday off, a holiday on the first Monday.
select (date_trunc('month', public.company_today()) + interval '1 month')::date as m1 \gset
select (:'m1'::date + ((6 - extract(isodow from :'m1'::date)::int + 7) % 7))::date as sat1 \gset
select (:'sat1'::date + 2)::date as mon1 \gset
begin; select pg_temp.act_as(:hr);
select pg_temp.check(public.is_working_day('00000000-0000-0000-0000-0000000000f3', :'sat1'), 'Saturday is a working day by default');
insert into public.work_calendar (work_date, kind) values (:'sat1', 'saturday_off');
select pg_temp.check(not public.is_working_day('00000000-0000-0000-0000-0000000000f3', :'sat1'), 'HR-chosen Saturday off is not a working day');
select pg_temp.denied(format($$insert into public.work_calendar (work_date, kind) values (%L, 'saturday_off')$$, (:'sat1'::date + 7)), 'only one Saturday off per month', '%Saturday off per month%');
select pg_temp.denied(format($$insert into public.work_calendar (work_date, kind) values (%L, 'saturday_off')$$, (:'sat1'::date + 1)), 'Saturday off must be a Saturday');
insert into public.holidays (holiday_date, name, kind) values (:'mon1', 'Test Holiday', 'Public');
select pg_temp.check(not public.is_working_day('00000000-0000-0000-0000-0000000000f3', :'mon1'), 'holiday is not a working day');
select pg_temp.check(public.count_leave_days('00000000-0000-0000-0000-0000000000f3', (:'sat1'::date - 1), (:'mon1'::date + 1)) = 2,
  'leave Fri–Tue counts 2 days (Saturday off, Sunday and holiday skipped)');
commit;

begin; select pg_temp.act_as(:po);
select pg_temp.check((select available = 12 and pending = 0 from public.leave_balances('00000000-0000-0000-0000-0000000000f3') where leave_type = 'paid'), '12 paid leave days available');
select pg_temp.check((select available = 12 from public.leave_balances('00000000-0000-0000-0000-0000000000f3') where leave_type = 'sick'), '12 sick leave days available');
select pg_temp.denied(format($$select public.apply_leave('paid', %L, %L, 'Trip')$$, :'sat1', :'sat1'), 'leave on a day off is not needed');
select public.apply_leave('paid', (:'sat1'::date - 1), (:'mon1'::date + 1), 'Family trip');
select pg_temp.check((select days = 2 and status = 'Pending' from public.leave_requests), 'request counts working days only');
select pg_temp.check((select available = 10 and pending = 2 and used = 0 from public.leave_balances('00000000-0000-0000-0000-0000000000f3') where leave_type = 'paid'),
  'pending leave reserved, not deducted');
select pg_temp.check((select count(*) from public.leave_ledger where entry_type = 'debit') = 0, 'no ledger deduction while pending');
select pg_temp.denied(format($$select public.apply_leave('sick', %L, %L, 'Overlap')$$, :'mon1', :'mon1'), 'overlapping leave rejected', '%LEAVE_OVERLAP%');
select pg_temp.denied(format($$select public.apply_leave('paid', %L, %L, 'Too long')$$, (:'mon1'::date + 7), (:'mon1'::date + 30)), 'leave above the balance rejected', '%LEAVE_BALANCE%');
select pg_temp.denied($$select public.decide_leave((select id from public.leave_requests), true)$$, 'employees cannot approve their own leave');
commit;

begin; select pg_temp.act_as(:pso);
select pg_temp.denied($$select public.decide_leave((select id from public.leave_requests limit 1), true)$$, 'colleagues outside the team cannot approve');
rollback;

begin; select pg_temp.act_as(:mgr);
select pg_temp.check((select count(*) from public.notifications where kind = 'leave') >= 1, 'manager received the leave request');
select public.decide_leave((select id from public.leave_requests), true, 'Enjoy');
select pg_temp.denied($$select public.decide_leave((select id from public.leave_requests), true)$$, 'cannot approve twice');
commit;

begin; select pg_temp.act_as(:po);
select pg_temp.check((select status = 'Approved' from public.leave_requests), 'employee sees the approval');
select pg_temp.check((select used = 2 and available = 10 and pending = 0 from public.leave_balances('00000000-0000-0000-0000-0000000000f3') where leave_type = 'paid'), 'balance deducted once on approval');
select pg_temp.check((select count(*) from public.leave_ledger where entry_type = 'debit') = 1, 'one ledger debit');
select public.cancel_leave((select id from public.leave_requests));
select pg_temp.check((select used = 0 and available = 12 from public.leave_balances('00000000-0000-0000-0000-0000000000f3') where leave_type = 'paid'), 'cancelling future approved leave restores the balance');
select pg_temp.check((select count(*) from public.leave_ledger where entry_type = 'reversal') = 1, 'reversal recorded in the ledger');
commit;

begin; select pg_temp.trusted();
-- Year end: paid leave carries forward in full (no invented cap), sick leave lapses.
insert into public.leave_ledger (employee_id, leave_type, leave_year, entry_type, days, note)
values (:po, 'paid', public.leave_year_of(public.company_today()), 'debit', -3, 'test'),
       (:po, 'sick', public.leave_year_of(public.company_today()), 'debit', -4, 'test');
select public.ensure_leave_year(:po, public.leave_year_of(public.company_today()) + 1);
select pg_temp.check((select days = 9 from public.leave_ledger where employee_id = :po and leave_type = 'paid' and entry_type = 'carry_forward'), 'unused paid leave (9) carried forward');
select pg_temp.check(not exists (select 1 from public.leave_ledger where employee_id = :po and leave_type = 'sick' and entry_type = 'carry_forward'), 'sick leave never carries forward');
select pg_temp.check((select days = -8 from public.leave_ledger where employee_id = :po and leave_type = 'sick' and entry_type = 'lapse'), 'unused sick leave (8) lapses');
select pg_temp.check((select available = 21 from public.leave_balances(:po, public.leave_year_of(public.company_today()) + 1) where leave_type = 'paid'), 'next year: 12 + 9 paid days');
select public.ensure_leave_year(:po, public.leave_year_of(public.company_today()) + 1);
select pg_temp.check((select count(*) from public.leave_ledger where employee_id = :po and entry_type in ('grant', 'carry_forward')
  and leave_year = public.leave_year_of(public.company_today()) + 1) = 3, 'year roll-over is idempotent');
rollback;

\echo '== team balances and server clock'
begin; select pg_temp.act_as(:mgr);
select pg_temp.check((select count(distinct employee_id) from public.team_leave_balances()) = 3, 'manager sees balances of self and team only');
select pg_temp.check(abs(extract(epoch from public.server_now() - now())) < 1, 'server clock available');
rollback;
begin; select pg_temp.act_as(:p1admin);
select pg_temp.check((select count(*) from public.team_leave_balances()) = 0, 'partners get no balances');
rollback;

\echo '== reminders'
begin; select pg_temp.act_as(:hr);
select pg_temp.check((select count(*) from public.hr_reminders(400) where kind = 'birthday' and employee_id = '00000000-0000-0000-0000-0000000000f1') = 1, 'birthday reminder for HR');
select pg_temp.check((select count(*) from public.hr_reminders(400) where kind = 'holiday') >= 1, 'upcoming holiday listed');
select pg_temp.check((select bool_and(detail is null or detail not like '%1990%') from public.hr_reminders(400)), 'birth years are not exposed');
rollback;
begin; select pg_temp.act_as(:po);
select pg_temp.check((select count(*) from public.hr_reminders(400) where kind in ('birthday', 'anniversary')) = 0, 'employees do not see colleagues'' personal reminders');
rollback;

\echo 'ALL SECURITY TESTS PASSED'
