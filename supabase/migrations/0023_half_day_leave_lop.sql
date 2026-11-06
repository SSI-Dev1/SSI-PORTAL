-- 0023_half_day_leave_lop.sql — run after 0022_partner_team.sql
-- (Supabase SQL Editor: Save this query as "0023_half_day_leave_lop")
--
-- Half-day leave, Loss of Pay and fractional attendance, modelled on the Broken English
-- Production Suite leave engine (leave-policy.js: half_day_type morning/afternoon, a half day is
-- 0.5, an unpaid half is 0.5 LOP, monthly Present can be 21.5) but kept on SSI GLOBAL's own
-- entitlements: Sick Leave 12 days/year lapsing at year end, Paid Leave 12 days/year carried
-- forward (limit configurable in leave_types.carry_forward_max).
-- * leave_requests.half_day_session: 'morning' | 'afternoon' (a single date, 0.5 day). A morning
--   and an afternoon request may share a date.
-- * leave_types.paid + the 'lop' type (Loss of Pay): applied and approved like any leave, never
--   limited by or deducted from a balance; counted as LOP.
-- * leave_events: the review history of every request (requested, manager approved, approved,
--   rejected, cancelled) with who, when and the comment.
-- * attendance_calendar(): one authoritative status per day (Present, Morning Leave, Afternoon
--   Leave, Sick / Paid Leave, Loss of Pay, Absent, Holiday, Weekly off …) with present / paid /
--   sick / LOP / absent fractions. attendance_month_summary() adds them up per employee, so
--   calendars, HR summaries and payroll figures all use the same numbers.
--   Rules: an approved half covers half the day; the other half is Present if the employee
--   attended that day, otherwise 0.5 Absent. A working day without attendance or leave is
--   1 Absent once it has passed. Absent counts are unpaid and included in lop_days
--   (absent_days shows the unapproved part separately). Today is never counted as absent.
-- Safe to run more than once.

-- =============================================================== schema
alter table public.leave_types add column if not exists paid boolean not null default true;
insert into public.leave_types (id, name, annual_days, carry_forward, paid, requires_reason)
values ('lop', 'Loss of Pay', 0, false, false, true)
on conflict (id) do update set paid = false;

alter table public.leave_requests add column if not exists half_day_session text;
alter table public.leave_requests drop constraint if exists leave_half_day_session_check;
alter table public.leave_requests add constraint leave_half_day_session_check
  check (half_day_session is null or (half_day_session in ('morning', 'afternoon') and start_date = end_date and days = 0.5));
alter table public.leave_requests drop constraint if exists leave_days_half_steps;
alter table public.leave_requests add constraint leave_days_half_steps check (days * 2 = floor(days * 2));

create table if not exists public.leave_events (
  id          bigint generated always as identity primary key,
  request_id  text not null references public.leave_requests (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  action      text not null check (action in ('requested', 'manager_approved', 'approved', 'rejected', 'cancelled')),
  actor_id    uuid,
  comment     text,
  at          timestamptz not null default now()
);
create index if not exists leave_events_request_idx on public.leave_events (request_id, at);
alter table public.leave_events enable row level security;
revoke all on public.leave_events from anon, authenticated;
grant select on public.leave_events to authenticated;
drop policy if exists "leave events: read" on public.leave_events;
create policy "leave events: read" on public.leave_events for select to authenticated using (public.can_view_employee(employee_id));

create or replace function public.track_leave_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.leave_events (request_id, employee_id, action, actor_id, comment)
    values (new.id, new.employee_id, 'requested', coalesce(auth.uid(), new.employee_id), new.reason);
  else
    if new.manager_approved_at is distinct from old.manager_approved_at and new.manager_approved_at is not null then
      insert into public.leave_events (request_id, employee_id, action, actor_id, comment)
      values (new.id, new.employee_id, 'manager_approved', new.manager_approved_by, new.decision_comment);
    end if;
    if new.status is distinct from old.status and new.status in ('Approved', 'Rejected', 'Cancelled') then
      insert into public.leave_events (request_id, employee_id, action, actor_id, comment)
      values (new.id, new.employee_id, lower(new.status), coalesce(auth.uid(), new.decided_by),
              case when new.status = 'Cancelled' then null else new.decision_comment end);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists leave_requests_events on public.leave_requests;
create trigger leave_requests_events after insert or update on public.leave_requests
  for each row execute function public.track_leave_event();

-- =============================================================== balances (paid types only)
create or replace function public.ensure_leave_year(p_emp uuid, p_year integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  t record; e record; prev numeric; grant_days numeric; months int; ys date := public.leave_year_start(p_year);
begin
  select * into e from public.employees where id = p_emp;
  if e.id is null then return; end if;
  for t in select * from public.leave_types where active and paid loop
    if exists (select 1 from public.leave_ledger where employee_id = p_emp and leave_type = t.id and leave_year = p_year and entry_type = 'grant') then
      continue;
    end if;
    grant_days := t.annual_days;
    if t.prorate_new_joiners and e.joining_date is not null and e.joining_date > ys then
      months := greatest(0, 12 - ((extract(year from e.joining_date)::int - extract(year from ys)::int) * 12
                                   + extract(month from e.joining_date)::int - extract(month from ys)::int));
      grant_days := round(t.annual_days * months / 12.0 * 2) / 2;
    end if;
    insert into public.leave_ledger (employee_id, leave_type, leave_year, entry_type, days, note)
    values (p_emp, t.id, p_year, 'grant', grant_days, 'Annual entitlement') on conflict do nothing;
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
    where t.active and t.paid group by t.id, t.name, t.accrual
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

-- =============================================================== workflow
drop function if exists public.apply_leave(text, date, date, text);
create or replace function public.apply_leave(p_type text, p_start date, p_end date, p_reason text, p_half text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_employee_id(); n numeric; t record; e record; rid text; y int; avail numeric;
begin
  if me is null then raise exception 'Only employees can apply for leave'; end if;
  select * into t from public.leave_types where id = p_type and active;
  if t.id is null then raise exception 'Unknown leave type'; end if;
  if p_end < p_start then raise exception 'The end date is before the start date'; end if;
  if p_half is not null and p_half not in ('morning', 'afternoon') then raise exception 'Choose Morning or Afternoon for a half day'; end if;
  if p_half is not null and p_end <> p_start then raise exception 'A half day is for a single date'; end if;
  y := public.leave_year_of(p_start);
  if public.leave_year_of(p_end) <> y then raise exception 'Split leave that crosses the leave year into two requests'; end if;
  if t.requires_reason and length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Enter a reason'; end if;
  select * into e from public.employees where id = me;
  if e.joining_date is not null and p_start < e.joining_date + t.eligible_after_days then
    raise exception '% is available from %', t.name, to_char(e.joining_date + t.eligible_after_days, 'DD Mon YYYY');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || me));
  -- A morning and an afternoon half may share a date; anything else may not overlap.
  if exists (select 1 from public.leave_requests r where r.employee_id = me and r.status in ('Pending', 'Approved')
             and daterange(r.start_date, r.end_date, '[]') && daterange(p_start, p_end, '[]')
             and not (p_half is not null and r.half_day_session is not null and r.half_day_session <> p_half)) then
    raise exception 'LEAVE_OVERLAP: You already have leave on some of these dates';
  end if;
  n := public.count_leave_days(me, p_start, p_end);
  if n = 0 then raise exception 'These dates are holidays or non-working days — no leave is needed'; end if;
  if p_half is not null then n := 0.5; end if;
  if t.paid then
    select b.available into avail from public.leave_balances(me, y) b where b.leave_type = p_type;
    if coalesce(avail, 0) < n then
      raise exception 'LEAVE_BALANCE: Not enough % balance for % day(s). Choose Loss of Pay for unpaid leave.', t.name, n;
    end if;
  end if;
  insert into public.leave_requests (employee_id, leave_type, start_date, end_date, days, reason, half_day_session)
  values (me, p_type, p_start, p_end, n, nullif(btrim(coalesce(p_reason, '')), ''), p_half) returning id into rid;
  perform public.notify(array(select reporting_manager_id from public.employees where id = me) || array(select public.staff_recipients('hr')),
    'leave', 'Leave request: ' || (select full_name from public.profiles where id = me),
    t.name || ' · ' || to_char(p_start, 'DD Mon') || case when p_end > p_start then ' – ' || to_char(p_end, 'DD Mon') else '' end
      || case when p_half = 'morning' then ' · Morning Leave' when p_half = 'afternoon' then ' · Afternoon Leave' else '' end
      || ' (' || n || ' day' || case when n = 1 then '' else 's' end || ')',
    'hr/leave');
  return rid;
end $$;

create or replace function public.decide_leave(p_id text, p_approve boolean, p_comment text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare r record; two_step boolean := coalesce(public.setting('leave_approval') #>> '{}', 'manager_or_hr') = 'manager_then_hr';
  hr boolean := public.is_super_admin() or public.is_hr(); y int; paid boolean;
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
  select t.paid into paid from public.leave_types t where t.id = r.leave_type;
  perform pg_advisory_xact_lock(hashtext('leave:' || r.employee_id));
  if paid then   -- Loss of Pay never touches a balance
    if public.leave_available(r.employee_id, r.leave_type, y) < r.days then
      raise exception 'LEAVE_BALANCE: The employee no longer has enough balance for this leave';
    end if;
    insert into public.leave_ledger (employee_id, leave_type, leave_year, entry_type, days, request_id, note, created_by)
    values (r.employee_id, r.leave_type, y, 'debit', -r.days, r.id,
            case r.half_day_session when 'morning' then 'Approved leave · Morning Leave' when 'afternoon' then 'Approved leave · Afternoon Leave' else 'Approved leave' end, auth.uid());
  end if;
  update public.leave_requests set status = 'Approved', decided_by = auth.uid(), decided_at = now(),
    decision_comment = coalesce(p_comment, decision_comment), updated_at = now() where id = p_id;
  perform public.notify(array[r.employee_id], 'leave', 'Leave approved',
    to_char(r.start_date, 'DD Mon') || case when r.end_date > r.start_date then ' – ' || to_char(r.end_date, 'DD Mon') else '' end
      || case r.half_day_session when 'morning' then ' · Morning Leave' when 'afternoon' then ' · Afternoon Leave' else '' end, 'work/leave');
  return 'Approved';
end $$;

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
  -- Only what was deducted is returned (Loss of Pay was never deducted).
  if r.status = 'Approved' then
    insert into public.leave_ledger (employee_id, leave_type, leave_year, entry_type, days, request_id, note, created_by)
    select r.employee_id, r.leave_type, public.leave_year_of(r.start_date), 'reversal', -d.days, r.id, 'Leave cancelled', auth.uid()
    from public.leave_ledger d where d.request_id = r.id and d.entry_type = 'debit'
    on conflict do nothing;
  end if;
  update public.leave_requests set status = 'Cancelled', cancelled_at = now(), updated_at = now() where id = p_id;
end $$;

-- =============================================================== day status
create or replace function public.attendance_calendar(p_emp uuid, p_from date, p_to date)
returns table (day date, code text, label text, half_session text, working boolean, attended boolean,
               present numeric, paid_leave numeric, sick_leave numeric, lop numeric, absent numeric, counted boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  d date;
  today date := public.company_today();
  e record;
  w boolean; att boolean; hol text; leave_on_off boolean := coalesce((public.setting('leave_counts_non_working_days') #>> '{}')::boolean, false);
  lv record; units numeric; pl numeric; sl numeric; lp numeric; pres numeric; ab numeric; rem numeric; lbl text; cd text; sess text;
begin
  if public.is_end_user_request() and not public.can_view_employee(p_emp) then raise exception 'Not allowed'; end if;
  if p_to < p_from or p_to - p_from > 400 then raise exception 'Choose a range of up to 400 days'; end if;
  select * into e from public.employees where id = p_emp;
  if e.id is null then return; end if;
  d := p_from;
  while d <= p_to loop
    w := public.is_working_day(p_emp, d);
    att := exists (select 1 from public.attendance_sessions s where s.employee_id = p_emp and s.work_date = d
                   and coalesce(s.corrected_in_at, s.punch_in_at) is not null);
    hol := (select h.name from public.holidays h where h.active and h.holiday_date = d
              and (cardinality(h.department_ids) = 0 or e.department_id = any (h.department_ids))
              and (cardinality(h.locations) = 0 or e.work_location = any (h.locations)) limit 1);
    pl := 0; sl := 0; lp := 0; pres := 0; ab := 0; units := 0; lbl := null; cd := null; sess := null;
    if w or leave_on_off then
      for lv in select r.leave_type, r.half_day_session, t.paid, t.name from public.leave_requests r join public.leave_types t on t.id = r.leave_type
                where r.employee_id = p_emp and r.status = 'Approved' and d between r.start_date and r.end_date
                order by r.half_day_session is not null, r.half_day_session = 'afternoon' loop
        continue when units >= 1;
        if lv.half_day_session is null then
          units := 1; cd := case when lv.leave_type = 'sick' then 'SL' when lv.paid then 'PL' else 'LOP' end; lbl := lv.name;
          if lv.leave_type = 'sick' then sl := 1; elsif lv.paid then pl := 1; else lp := 1; end if;
        else
          units := units + 0.5;
          sess := case when sess is null then lv.half_day_session else 'both' end;
          lbl := concat_ws(' + ', lbl, initcap(lv.half_day_session) || ' Leave (' || lv.name || ')');
          if lv.leave_type = 'sick' then sl := sl + 0.5; elsif lv.paid then pl := pl + 0.5; else lp := lp + 0.5; end if;
          cd := 'HD';
        end if;
      end loop;
    end if;
    if not w and units = 0 then
      cd := case when hol is not null then 'H' else 'WO' end;
      lbl := coalesce(hol, 'Weekly off') || case when att then ' · worked' else '' end;
    elsif d > today then
      if units = 0 then cd := 'UP'; lbl := 'Upcoming'; end if;
    else
      rem := 1 - least(units, 1);
      if rem > 0 then
        if att then
          pres := rem;
          if units = 0 then cd := 'P'; lbl := 'Present';
          else lbl := lbl || ' · ' || case sess when 'morning' then 'Afternoon' when 'afternoon' then 'Morning' else 'Other half' end || ' present'; end if;
        elsif d = today then
          if units = 0 then cd := 'OPEN'; lbl := 'Not checked in yet'; end if;
        else
          ab := rem;
          if units = 0 then cd := 'A'; lbl := 'Absent';
          else lbl := lbl || ' · ' || case sess when 'morning' then 'Afternoon' when 'afternoon' then 'Morning' else 'Other half' end || ' absent'; end if;
        end if;
      end if;
    end if;
    day := d; code := cd; label := lbl; half_session := sess; working := w; attended := att;
    present := pres; paid_leave := pl; sick_leave := sl; lop := lp + ab; absent := ab;
    counted := (w or leave_on_off) and d <= today and not (d = today and units = 0 and not att);
    return next;
    d := d + 1;
  end loop;
end $$;

-- Monthly totals per employee the caller may see (HR: everyone; managers: their team; employees: themselves).
create or replace function public.attendance_month_summary(p_month date)
returns table (employee_id uuid, working_days numeric, present_days numeric, paid_leave_days numeric, sick_leave_days numeric,
               lop_days numeric, absent_days numeric, half_days numeric, holidays numeric)
language sql stable security definer set search_path = '' as $$
  select e.id,
         coalesce(sum(case when c.working then 1 else 0 end) filter (where c.counted), 0),
         coalesce(sum(c.present), 0), coalesce(sum(c.paid_leave), 0), coalesce(sum(c.sick_leave), 0),
         coalesce(sum(c.lop), 0), coalesce(sum(c.absent), 0),
         count(*) filter (where c.code = 'HD')::numeric,
         count(*) filter (where c.code = 'H')::numeric
  from public.employees e
  cross join lateral public.attendance_calendar(e.id, date_trunc('month', p_month)::date,
                                                least((date_trunc('month', p_month) + interval '1 month - 1 day')::date, public.company_today())) c
  where public.can_view_employee(e.id) and date_trunc('month', p_month)::date <= public.company_today()
  group by e.id;
$$;

-- =============================================================== realtime + grants
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leave_events') then
    alter publication supabase_realtime add table public.leave_events;
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['apply_leave(text, date, date, text, text)', 'decide_leave(text, boolean, text)', 'cancel_leave(text)',
                           'leave_balances(uuid, integer)', 'attendance_calendar(uuid, date, date)', 'attendance_month_summary(date)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['ensure_leave_year(uuid, integer)', 'track_leave_event()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
