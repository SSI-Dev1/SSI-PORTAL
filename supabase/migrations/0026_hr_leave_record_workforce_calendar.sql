-- 0026_hr_leave_record_workforce_calendar.sql — run after 0025_hr_org_structure.sql
-- (Supabase SQL Editor: Save this query as "0026_hr_leave_record_workforce_calendar")
--
-- * HR can record leave for an employee (for example sick leave reported by phone). The same
--   rules as an employee's own request apply — leave type, dates, half day, overlap, working
--   days and balance — and the leave is approved immediately, deducted from the balance (paid
--   types only), recorded with who entered it, and the employee is notified. HR cannot record
--   leave for themselves (they apply like everyone else).
-- * workforce_calendar(month): the server's day status (present, leave, half day, absent,
--   holiday, weekly off…) for every employee the caller may see, so the Workforce Calendar and
--   Attendance Exceptions use the same numbers as attendance, leave and payroll.
-- Safe to run more than once.

alter table public.leave_requests add column if not exists recorded_by uuid;

create or replace function public.hr_record_leave(p_emp uuid, p_type text, p_start date, p_end date, p_reason text, p_half text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare n numeric; t record; e record; rid text; y int; avail numeric;
begin
  if not (public.is_super_admin() or public.is_hr()) then raise exception 'Only HR can record leave for an employee'; end if;
  if p_emp = auth.uid() then raise exception 'Apply for your own leave from My Leave'; end if;
  select em.*, p.status as account_status into e from public.employees em join public.profiles p on p.id = em.id where em.id = p_emp;
  if e.id is null then raise exception 'Employee not found'; end if;
  if e.employment_status = 'Resigned' or e.account_status <> 'active' then raise exception 'This employee is not active'; end if;
  select * into t from public.leave_types where id = p_type and active;
  if t.id is null then raise exception 'Unknown leave type'; end if;
  if p_end < p_start then raise exception 'The end date is before the start date'; end if;
  if p_half is not null and p_half not in ('morning', 'afternoon') then raise exception 'Choose Morning or Afternoon for a half day'; end if;
  if p_half is not null and p_end <> p_start then raise exception 'A half day is for a single date'; end if;
  if p_end - p_start > 60 then raise exception 'Record at most 60 days at a time'; end if;
  y := public.leave_year_of(p_start);
  if public.leave_year_of(p_end) <> y then raise exception 'Split leave that crosses the leave year into two requests'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Enter a reason (for example how the employee reported it)'; end if;
  if e.joining_date is not null and p_start < e.joining_date + t.eligible_after_days then
    raise exception '% is available from %', t.name, to_char(e.joining_date + t.eligible_after_days, 'DD Mon YYYY');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || p_emp));
  if exists (select 1 from public.leave_requests r where r.employee_id = p_emp and r.status in ('Pending', 'Approved')
             and daterange(r.start_date, r.end_date, '[]') && daterange(p_start, p_end, '[]')
             and not (p_half is not null and r.half_day_session is not null and r.half_day_session <> p_half)) then
    raise exception 'LEAVE_OVERLAP: The employee already has leave on some of these dates';
  end if;
  n := public.count_leave_days(p_emp, p_start, p_end);
  if n = 0 then raise exception 'These dates are holidays or non-working days — no leave is needed'; end if;
  if p_half is not null then n := 0.5; end if;
  if t.paid then
    select b.available into avail from public.leave_balances(p_emp, y) b where b.leave_type = p_type;
    if coalesce(avail, 0) < n then
      raise exception 'LEAVE_BALANCE: Not enough % balance for % day(s). Record Loss of Pay for unpaid leave.', t.name, n;
    end if;
  end if;
  insert into public.leave_requests (employee_id, leave_type, start_date, end_date, days, reason, half_day_session,
                                     status, decided_by, decided_at, decision_comment, recorded_by)
  values (p_emp, p_type, p_start, p_end, n, btrim(p_reason), p_half,
          'Approved', auth.uid(), now(), 'Recorded by HR', auth.uid()) returning id into rid;
  if t.paid then
    insert into public.leave_ledger (employee_id, leave_type, leave_year, entry_type, days, request_id, note, created_by)
    values (p_emp, p_type, y, 'debit', -n, rid,
            case p_half when 'morning' then 'Recorded by HR · Morning Leave' when 'afternoon' then 'Recorded by HR · Afternoon Leave' else 'Recorded by HR' end, auth.uid());
  end if;
  perform public.notify(array[p_emp], 'leave', 'Leave recorded by HR',
    t.name || ' · ' || to_char(p_start, 'DD Mon') || case when p_end > p_start then ' – ' || to_char(p_end, 'DD Mon') else '' end
      || case p_half when 'morning' then ' · Morning Leave' when 'afternoon' then ' · Afternoon Leave' else '' end
      || ' (' || n || ' day' || case when n = 1 then '' else 's' end || ')', 'work/leave');
  return rid;
end $$;
revoke all on function public.hr_record_leave(uuid, text, date, date, text, text) from public, anon;
grant execute on function public.hr_record_leave(uuid, text, date, date, text, text) to authenticated;

-- Day status for every employee the caller may see (HR: everyone; managers: their team; others: themselves).
create or replace function public.workforce_calendar(p_month date)
returns table (employee_id uuid, day date, code text, label text, half_session text, working boolean, attended boolean)
language sql stable security definer set search_path = '' as $$
  select e.id, c.day, c.code, c.label, c.half_session, c.working, c.attended
  from public.employees e
  join public.profiles p on p.id = e.id
  cross join lateral public.attendance_calendar(e.id, date_trunc('month', p_month)::date,
                                                (date_trunc('month', p_month) + interval '1 month - 1 day')::date) c
  where public.can_view_employee(e.id) and p.status = 'active' and e.employment_status <> 'Resigned'
  order by e.id, c.day;
$$;
revoke all on function public.workforce_calendar(date) from public, anon;
grant execute on function public.workforce_calendar(date) to authenticated;
