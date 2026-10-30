-- 0014_leave.sql — run after 0013_attendance.sql
-- (Supabase SQL Editor: Save this query as "0014_leave")
--
-- Leave management:
-- * leave_types: Sick Leave 12 days / year, lapses at year end (no carry forward); Paid Leave
--   12 days / year, unused days carry forward with no maximum unless HR sets one. HR can change
--   accrual (upfront / monthly), prorating for joiners and eligibility.
-- * leave_ledger: every grant, carry forward, lapse, deduction and reversal as a signed entry,
--   so balances are auditable. Deductions happen only on approval (never for pending requests),
--   at most once per request; cancelling an approved leave adds a reversal.
-- * leave_requests: days are counted on the employee's working days only (holidays, Saturday off
--   and non-working days are skipped unless company_settings.leave_counts_non_working_days).
--   Overlapping pending / approved requests are rejected. Approval: manager or HR
--   (company_settings.leave_approval = manager_then_hr needs both).
-- * hr_reminders(): birthdays, work anniversaries, probation completions, upcoming leave and
--   holidays for HR, without birth years. send_hr_reminders() turns today's into notifications once.
-- Safe to run more than once.

create table if not exists public.leave_types (
  id                   text primary key,
  name                 text not null,
  annual_days          numeric not null check (annual_days >= 0),
  carry_forward        boolean not null default false,
  carry_forward_max    numeric check (carry_forward_max >= 0),   -- null = no limit
  accrual              text not null default 'upfront' check (accrual in ('upfront', 'monthly')),
  prorate_new_joiners  boolean not null default false,
  eligible_after_days  integer not null default 0 check (eligible_after_days >= 0),
  requires_reason      boolean not null default true,
  active               boolean not null default true,
  updated_at           timestamptz not null default now()
);
insert into public.leave_types (id, name, annual_days, carry_forward) values
  ('sick', 'Sick Leave', 12, false),
  ('paid', 'Paid Leave', 12, true)
on conflict (id) do nothing;

create table if not exists public.leave_requests (
  id               text primary key default gen_random_uuid()::text,
  employee_id      uuid not null references public.employees (id) on delete cascade,
  leave_type       text not null references public.leave_types (id),
  start_date       date not null,
  end_date         date not null,
  days             numeric not null check (days > 0),
  reason           text,
  status           text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected', 'Cancelled')),
  manager_approved_by uuid,
  manager_approved_at timestamptz,
  decided_by       uuid,
  decided_at       timestamptz,
  decision_comment text,
  cancelled_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint leave_dates check (end_date >= start_date)
);
create index if not exists leave_requests_emp_idx on public.leave_requests (employee_id, start_date);

create table if not exists public.leave_ledger (
  id          bigint generated always as identity primary key,
  employee_id uuid not null references public.employees (id) on delete cascade,
  leave_type  text not null references public.leave_types (id),
  leave_year  integer not null,
  entry_type  text not null check (entry_type in ('grant', 'carry_forward', 'lapse', 'debit', 'reversal', 'adjustment')),
  days        numeric not null,
  request_id  text references public.leave_requests (id) on delete set null,
  note        text,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create unique index if not exists leave_ledger_request_key on public.leave_ledger (request_id, entry_type) where entry_type in ('debit', 'reversal');
create unique index if not exists leave_ledger_year_key on public.leave_ledger (employee_id, leave_type, leave_year, entry_type)
  where entry_type in ('grant', 'carry_forward', 'lapse');

-- =============================================================== helpers
create or replace function public.leave_year_of(p_date date)
returns integer language sql stable security definer set search_path = '' as $$
  select case when extract(month from p_date)::int >= coalesce((public.setting('leave_year_start_month') #>> '{}')::int, 1)
              then extract(year from p_date)::int else extract(year from p_date)::int - 1 end;
$$;
create or replace function public.leave_year_start(p_year integer)
returns date language sql stable security definer set search_path = '' as $$
  select make_date(p_year, coalesce((public.setting('leave_year_start_month') #>> '{}')::int, 1), 1);
$$;

-- Leave days in a range for this employee (working days only, unless configured otherwise).
create or replace function public.count_leave_days(p_emp uuid, p_start date, p_end date)
returns numeric language sql stable security definer set search_path = '' as $$
  select count(*)::numeric from generate_series(p_start, p_end, interval '1 day') d
  where coalesce((public.setting('leave_counts_non_working_days') #>> '{}')::boolean, false)
     or public.is_working_day(p_emp, d::date);
$$;

-- Creates the year's grant (and carry forward / lapse of the previous year) once.
create or replace function public.ensure_leave_year(p_emp uuid, p_year integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  t record; e record; prev numeric; grant_days numeric; months int; ys date := public.leave_year_start(p_year);
begin
  select * into e from public.employees where id = p_emp;
  if e.id is null then return; end if;
  for t in select * from public.leave_types where active loop
    if exists (select 1 from public.leave_ledger where employee_id = p_emp and leave_type = t.id and leave_year = p_year and entry_type = 'grant') then
      continue;
    end if;
    grant_days := t.annual_days;
    if t.prorate_new_joiners and e.joining_date is not null and e.joining_date > ys then
      months := greatest(0, 12 - ((extract(year from e.joining_date)::int - extract(year from ys)::int) * 12
                                   + extract(month from e.joining_date)::int - extract(month from ys)::int));
      grant_days := round(t.annual_days * months / 12.0 * 2) / 2;   -- nearest half day
    end if;
    insert into public.leave_ledger (employee_id, leave_type, leave_year, entry_type, days, note)
    values (p_emp, t.id, p_year, 'grant', grant_days, 'Annual entitlement') on conflict do nothing;
    -- Previous year: carry forward (paid) or record the lapse (sick).
    select sum(days) into prev from public.leave_ledger where employee_id = p_emp and leave_type = t.id and leave_year = p_year - 1;
    if prev is not null and prev > 0 then
      if t.carry_forward then
        insert into public.leave_ledger (employee_id, leave_type, leave_year, entry_type, days, note)
        values (p_emp, t.id, p_year, 'carry_forward', least(prev, coalesce(t.carry_forward_max, prev)), 'Carried forward from ' || (p_year - 1))
        on conflict do nothing;
        if t.carry_forward_max is not null and prev > t.carry_forward_max then
          insert into public.leave_ledger (employee_id, leave_type, leave_year, entry_type, days, note)
          values (p_emp, t.id, p_year - 1, 'lapse', -(prev - t.carry_forward_max), 'Above the carry-forward limit') on conflict do nothing;
        end if;
      else
        insert into public.leave_ledger (employee_id, leave_type, leave_year, entry_type, days, note)
        values (p_emp, t.id, p_year - 1, 'lapse', -prev, 'Unused leave lapses at year end') on conflict do nothing;
      end if;
    end if;
  end loop;
end $$;

-- Balances for one leave year. Monthly accrual makes only the earned part available;
-- pending requests are shown but never deducted.
create or replace function public.leave_balances(p_emp uuid, p_year integer default null)
returns table (leave_type text, name text, leave_year integer, entitled numeric, carried numeric, accrued numeric,
               adjusted numeric, used numeric, pending numeric, available numeric)
language plpgsql security definer set search_path = '' as $$
declare y int := coalesce(p_year, public.leave_year_of(public.company_today()));
begin
  if public.is_end_user_request() and not public.can_view_employee(p_emp) then raise exception 'Not allowed'; end if;
  if y >= public.leave_year_of(public.company_today()) then perform public.ensure_leave_year(p_emp, y); end if;
  return query
  with l as (
    select t.id, t.name, t.accrual,
      coalesce(sum(x.days) filter (where x.entry_type = 'grant'), 0) as g,
      coalesce(sum(x.days) filter (where x.entry_type = 'carry_forward'), 0) as cf,
      coalesce(sum(x.days) filter (where x.entry_type in ('adjustment', 'lapse')), 0) as adj,
      -coalesce(sum(x.days) filter (where x.entry_type in ('debit', 'reversal')), 0) as u
    from public.leave_types t
    left join public.leave_ledger x on x.leave_type = t.id and x.employee_id = p_emp and x.leave_year = y
    where t.active group by t.id, t.name, t.accrual
  ), m as (
    select l.*, case when l.accrual = 'monthly' then
        round(l.g * least(12, greatest(0, (extract(year from public.company_today())::int - extract(year from public.leave_year_start(y))::int) * 12
              + extract(month from public.company_today())::int - extract(month from public.leave_year_start(y))::int + 1)) / 12.0 * 2) / 2
      else l.g end as acc,
      coalesce((select sum(r.days) from public.leave_requests r where r.employee_id = p_emp and r.leave_type = l.id
                and r.status = 'Pending' and public.leave_year_of(r.start_date) = y), 0) as pend
    from l
  )
  select m.id, m.name, y, m.g, m.cf, m.acc, m.adj, m.u, m.pend, m.acc + m.cf + m.adj - m.u - m.pend from m;
end $$;

-- Days that can still be approved (pending requests not subtracted).
create or replace function public.leave_available(p_emp uuid, p_type text, p_year integer)
returns numeric language sql security definer set search_path = '' as $$
  select b.available + b.pending from public.leave_balances(p_emp, p_year) b where b.leave_type = p_type;
$$;

-- Balances of every employee the caller may see (HR: all, managers: their team, employees: self).
create or replace function public.team_leave_balances(p_year integer default null)
returns table (employee_id uuid, leave_type text, name text, leave_year integer, entitled numeric, carried numeric, accrued numeric,
               adjusted numeric, used numeric, pending numeric, available numeric)
language sql security definer set search_path = '' as $$
  select e.id, b.* from public.employees e
  cross join lateral public.leave_balances(e.id, p_year) b
  where public.can_view_employee(e.id);
$$;

-- =============================================================== workflow
create or replace function public.apply_leave(p_type text, p_start date, p_end date, p_reason text)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_employee_id(); n numeric; t record; e record; rid text; y int;
begin
  if me is null then raise exception 'Only employees can apply for leave'; end if;
  select * into t from public.leave_types where id = p_type and active;
  if t.id is null then raise exception 'Unknown leave type'; end if;
  if p_end < p_start then raise exception 'The end date is before the start date'; end if;
  y := public.leave_year_of(p_start);
  if public.leave_year_of(p_end) <> y then raise exception 'Split leave that crosses the leave year into two requests'; end if;
  if t.requires_reason and length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Enter a reason'; end if;
  select * into e from public.employees where id = me;
  if e.joining_date is not null and p_start < e.joining_date + t.eligible_after_days then
    raise exception '% is available from %', t.name, to_char(e.joining_date + t.eligible_after_days, 'DD Mon YYYY');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || me));
  if exists (select 1 from public.leave_requests where employee_id = me and status in ('Pending', 'Approved')
             and daterange(start_date, end_date, '[]') && daterange(p_start, p_end, '[]')) then
    raise exception 'LEAVE_OVERLAP: You already have leave on some of these dates';
  end if;
  n := public.count_leave_days(me, p_start, p_end);
  if n = 0 then raise exception 'These dates are holidays or non-working days — no leave is needed'; end if;
  if (select available from public.leave_balances(me, y) where leave_type = p_type) < n then
    raise exception 'LEAVE_BALANCE: Not enough % balance for % day(s)', t.name, n;
  end if;
  insert into public.leave_requests (employee_id, leave_type, start_date, end_date, days, reason)
  values (me, p_type, p_start, p_end, n, nullif(btrim(coalesce(p_reason, '')), '')) returning id into rid;
  perform public.notify(array(select reporting_manager_id from public.employees where id = me) || array(select public.staff_recipients('hr')),
    'leave', 'Leave request: ' || (select full_name from public.profiles where id = me),
    t.name || ' · ' || to_char(p_start, 'DD Mon') || case when p_end > p_start then ' – ' || to_char(p_end, 'DD Mon') else '' end || ' (' || n || ' day' || case when n = 1 then '' else 's' end || ')',
    'hr/leave');
  return rid;
end $$;

create or replace function public.decide_leave(p_id text, p_approve boolean, p_comment text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare r record; two_step boolean := coalesce(public.setting('leave_approval') #>> '{}', 'manager_or_hr') = 'manager_then_hr';
  hr boolean := public.is_super_admin() or public.is_hr(); y int;
begin
  select * into r from public.leave_requests where id = p_id for update;
  if r.id is null then raise exception 'Leave request not found'; end if;
  if not public.can_approve_for(r.employee_id) then raise exception 'You cannot decide this request'; end if;
  if r.status <> 'Pending' then raise exception 'This request was already decided'; end if;
  if not p_approve then
    update public.leave_requests set status = 'Rejected', decided_by = auth.uid(), decided_at = now(), decision_comment = p_comment, updated_at = now() where id = p_id;
    perform public.notify(array[r.employee_id], 'leave', 'Leave request rejected', p_comment, 'work/leave');
    return 'Rejected';
  end if;
  if two_step and not hr then
    update public.leave_requests set manager_approved_by = auth.uid(), manager_approved_at = now(), decision_comment = p_comment, updated_at = now() where id = p_id;
    perform public.notify(array(select public.staff_recipients('hr')), 'leave', 'Leave approved by manager — HR approval needed', null, 'hr/leave');
    return 'Pending';
  end if;
  y := public.leave_year_of(r.start_date);
  perform pg_advisory_xact_lock(hashtext('leave:' || r.employee_id));
  if public.leave_available(r.employee_id, r.leave_type, y) < r.days then
    raise exception 'LEAVE_BALANCE: The employee no longer has enough balance for this leave';
  end if;
  insert into public.leave_ledger (employee_id, leave_type, leave_year, entry_type, days, request_id, note, created_by)
  values (r.employee_id, r.leave_type, y, 'debit', -r.days, r.id, 'Approved leave', auth.uid());
  update public.leave_requests set status = 'Approved', decided_by = auth.uid(), decided_at = now(),
    decision_comment = coalesce(p_comment, decision_comment), updated_at = now() where id = p_id;
  perform public.notify(array[r.employee_id], 'leave', 'Leave approved',
    to_char(r.start_date, 'DD Mon') || case when r.end_date > r.start_date then ' – ' || to_char(r.end_date, 'DD Mon') else '' end, 'work/leave');
  return 'Approved';
end $$;

-- Employees cancel pending leave, or approved leave that has not started; HR can cancel any approved leave.
create or replace function public.cancel_leave(p_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select * into r from public.leave_requests where id = p_id for update;
  if r.id is null then raise exception 'Leave request not found'; end if;
  if r.status not in ('Pending', 'Approved') then raise exception 'This request cannot be cancelled'; end if;
  if not ((r.employee_id = auth.uid() and (r.status = 'Pending' or r.start_date > public.company_today()))
          or ((public.is_super_admin() or public.is_hr()) and r.employee_id <> auth.uid())) then
    raise exception 'You cannot cancel this leave';
  end if;
  if r.status = 'Approved' then
    insert into public.leave_ledger (employee_id, leave_type, leave_year, entry_type, days, request_id, note, created_by)
    values (r.employee_id, r.leave_type, public.leave_year_of(r.start_date), 'reversal', r.days, r.id, 'Leave cancelled', auth.uid());
  end if;
  update public.leave_requests set status = 'Cancelled', cancelled_at = now(), updated_at = now() where id = p_id;
end $$;

-- HR balance adjustment (audited, with a note).
create or replace function public.adjust_leave(p_emp uuid, p_type text, p_days numeric, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_super_admin() or public.is_hr()) or p_emp = auth.uid() then raise exception 'Only HR can adjust leave balances'; end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Enter a note for the adjustment'; end if;
  insert into public.leave_ledger (employee_id, leave_type, leave_year, entry_type, days, note, created_by)
  values (p_emp, p_type, public.leave_year_of(public.company_today()), 'adjustment', p_days, btrim(p_note), auth.uid());
end $$;

-- =============================================================== reminders
create table if not exists public.reminder_log (
  kind     text not null,
  ref      text not null,
  sent_on  date not null,
  primary key (kind, ref, sent_on)
);
alter table public.reminder_log enable row level security;
revoke all on public.reminder_log from anon, authenticated;

-- Next yearly occurrence of a date on or after p_from (29 Feb → 28 Feb in other years).
create or replace function public.next_occurrence(p_date date, p_from date)
returns date language sql immutable set search_path = '' as $$
  select min(x) from (
    select (make_date(y, extract(month from p_date)::int, 1)
            + (least(extract(day from p_date)::int,
                     extract(day from (make_date(y, extract(month from p_date)::int, 1) + interval '1 month - 1 day'))::int) - 1)) x
    from generate_series(extract(year from p_from)::int, extract(year from p_from)::int + 1) y
  ) s where x >= p_from;
$$;

create or replace function public.hr_reminders(p_days integer default 30)
returns table (kind text, on_date date, employee_id uuid, title text, detail text)
language sql stable security definer set search_path = '' as $$
  with today as (select public.company_today() as d),
  e as (select e.*, p.full_name from public.employees e join public.profiles p on p.id = e.id
        where p.status = 'active' and e.employment_status <> 'Resigned'
          and (public.is_super_admin() or public.is_hr() or public.in_my_team(e.id))),
  nxt as (
    select e.id, e.full_name, e.date_of_birth, e.joining_date, e.probation_end_date, e.employment_status,
      public.next_occurrence(e.date_of_birth, (select d from today)) as bday,
      public.next_occurrence(e.joining_date, greatest((select d from today), e.joining_date + 1)) as anniv
    from e
  )
  select * from (
    select 'birthday', bday, id, 'Birthday: ' || full_name, null::text from nxt where bday is not null
    union all
    select 'anniversary', anniv, id, 'Work anniversary: ' || full_name,
           (extract(year from anniv)::int - extract(year from joining_date)::int) || ' year(s)' from nxt where anniv is not null
    union all
    select 'probation', probation_end_date, id, 'Probation ends: ' || full_name, null from nxt
      where employment_status = 'Probation' and probation_end_date is not null
    union all
    select 'leave', r.start_date, r.employee_id, 'On leave: ' || e.full_name,
           (select name from public.leave_types where id = r.leave_type) || ' · ' || r.days || ' day(s)'
      from public.leave_requests r join e on e.id = r.employee_id where r.status = 'Approved'
    union all
    select 'holiday', h.holiday_date, null, h.name, h.kind || ' holiday' from public.holidays h where h.active and public.is_staff()
  ) x(kind, on_date, employee_id, title, detail)
  where on_date between (select d from today) and (select d from today) + p_days
  order by on_date, kind;
$$;

-- Today's reminders as notifications (HR, the employee's manager; holidays to everyone). Runs once a day.
create or replace function public.send_hr_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; today date := public.company_today(); mgr uuid;
begin
  if public.is_end_user_request() and not public.is_staff() then raise exception 'Not allowed'; end if;
  for r in
    select x.* from (
      select 'birthday' k, e.id ref, 'Birthday today: ' || p.full_name t, e.reporting_manager_id m from public.employees e join public.profiles p on p.id = e.id
        where p.status = 'active' and e.employment_status <> 'Resigned' and to_char(e.date_of_birth, 'MM-DD') = to_char(today, 'MM-DD')
      union all
      select 'anniversary', e.id::text, 'Work anniversary today: ' || p.full_name, e.reporting_manager_id from public.employees e join public.profiles p on p.id = e.id
        where p.status = 'active' and e.employment_status <> 'Resigned' and e.joining_date < today and to_char(e.joining_date, 'MM-DD') = to_char(today, 'MM-DD')
      union all
      select 'probation', e.id::text, 'Probation ends in 7 days: ' || p.full_name, e.reporting_manager_id from public.employees e join public.profiles p on p.id = e.id
        where e.employment_status = 'Probation' and e.probation_end_date = today + 7
      union all
      select 'holiday', h.id, 'Holiday tomorrow: ' || h.name, null from public.holidays h where h.active and h.holiday_date = today + 1
    ) x
  loop
    insert into public.reminder_log (kind, ref, sent_on) values (r.k, r.ref, today) on conflict do nothing;
    if found then
      if r.k = 'holiday' then
        insert into public.notifications (user_id, kind, title, link)
        select e.id, 'reminder', r.t, 'work/holidays' from public.employees e join public.profiles p on p.id = e.id where p.status = 'active';
      else
        insert into public.notifications (user_id, kind, title, link)
        select distinct u, 'reminder', r.t, 'hr/reminders' from unnest(array(select public.staff_recipients('hr')) || r.m) u where u is not null;
      end if;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- =============================================================== RLS
alter table public.leave_types enable row level security;
alter table public.leave_requests enable row level security;
alter table public.leave_ledger enable row level security;
revoke all on public.leave_types, public.leave_requests, public.leave_ledger from anon, authenticated;
grant select on public.leave_types, public.leave_requests, public.leave_ledger to authenticated;
grant update on public.leave_types to authenticated;
do $$
declare t text;
begin
  foreach t in array array['leave_types', 'leave_requests', 'leave_ledger'] loop
    execute coalesce((select string_agg(format('drop policy if exists %I on public.%I;', polname, t), ' ')
             from pg_policy where polrelid = format('public.%I', t)::regclass), 'select 1');
  end loop;
end $$;
create policy "leave types: staff read" on public.leave_types for select to authenticated using (public.is_staff());
create policy "leave types: hr update" on public.leave_types for update to authenticated
  using (public.is_super_admin() or public.is_hr()) with check (public.is_super_admin() or public.is_hr());
create policy "leave requests: read" on public.leave_requests for select to authenticated using (public.can_view_employee(employee_id));
create policy "leave ledger: read" on public.leave_ledger for select to authenticated using (public.can_view_employee(employee_id));

do $$
declare t text;
begin
  foreach t in array array['leave_types', 'leave_requests'] loop
    execute format('drop trigger if exists %1$s_audit on public.%1$I', t);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$I
                    for each row execute function public.audit_row()', t);
  end loop;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['leave_types', 'leave_requests', 'leave_ledger'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['leave_year_of(date)', 'count_leave_days(uuid, date, date)', 'leave_balances(uuid, integer)',
                           'apply_leave(text, date, date, text)', 'decide_leave(text, boolean, text)', 'cancel_leave(text)',
                           'adjust_leave(uuid, text, numeric, text)', 'team_leave_balances(integer)', 'hr_reminders(integer)', 'send_hr_reminders()', 'next_occurrence(date, date)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['ensure_leave_year(uuid, integer)', 'leave_available(uuid, text, integer)', 'leave_year_start(integer)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
