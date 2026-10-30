-- 0013_attendance.sql — run after 0012_hr_foundation.sql
-- (Supabase SQL Editor: Save this query as "0013_attendance")
--
-- Work calendar and attendance:
-- * holidays (company / public, optionally limited to locations or departments) and
--   work_calendar (HR-chosen Saturday off per month, extra working days).
-- * attendance_sessions: one per employee per working date. Punch in / out and breaks are
--   recorded only through functions that use the server clock; employees cannot write the
--   tables. Approved corrections are stored next to the original times, never over them.
-- * attendance_locations: device-reported coordinates captured at punch in / out only, with
--   accuracy and capture time; readable by the employee, HR and Super Admin (not managers).
--   Policy (company_settings.location_policy): optional | required | approval.
-- * attendance_corrections and early_checkout_requests with manager / HR approval. Early
--   checkouts are limited per month (company_settings.early_checkout_monthly_limit, 2); going
--   over needs an explicit, audited HR / Super Admin override.
-- * attendance_days: per-session view with gross, break and net minutes, required minutes,
--   shortage, late arrival and early checkout (flexible shifts are never "late").
-- Safe to run more than once.

-- =============================================================== calendar
create table if not exists public.holidays (
  id             text primary key default gen_random_uuid()::text,
  holiday_date   date not null,
  name           text not null,
  kind           text not null default 'Company' check (kind in ('Company', 'Public')),
  locations      text[] not null default '{}',     -- empty = every location
  department_ids text[] not null default '{}',     -- empty = every department
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists holidays_date_idx on public.holidays (holiday_date);

-- Day-level overrides: a Saturday off (per month, chosen by HR) or an extra working day.
create table if not exists public.work_calendar (
  id         text primary key default gen_random_uuid()::text,
  work_date  date not null,
  kind       text not null check (kind in ('saturday_off', 'working_day', 'day_off')),
  shift_id   text references public.shifts (id) on delete cascade,   -- null = every shift
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_calendar_saturday check (kind <> 'saturday_off' or extract(isodow from work_date) = 6)
);
create unique index if not exists work_calendar_day_key on public.work_calendar (work_date, coalesce(shift_id, ''));

-- At most company_settings.saturday_offs_per_month Saturday offs per month and shift scope.
create or replace function public.guard_work_calendar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare lim int := coalesce((public.setting('saturday_offs_per_month') #>> '{}')::int, 1);
begin
  if new.kind = 'saturday_off' and (
       select count(*) from public.work_calendar w
       where w.kind = 'saturday_off' and w.id <> new.id and coalesce(w.shift_id, '') = coalesce(new.shift_id, '')
         and date_trunc('month', w.work_date) = date_trunc('month', new.work_date)) >= lim then
    raise exception 'Only % Saturday off per month is allowed. Remove the other Saturday off of this month first.', lim;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists work_calendar_guard on public.work_calendar;
create trigger work_calendar_guard before insert or update on public.work_calendar
  for each row execute function public.guard_work_calendar();

-- Is p_date a working day for this employee? (shift days, Saturday off, holidays, overrides)
create or replace function public.is_working_day(p_emp uuid, p_date date)
returns boolean language sql stable security definer set search_path = '' as $$
  with e as (
    select e.id, e.department_id, e.work_location, coalesce(s.working_days, '{1,2,3,4,5,6}') as days, e.shift_id
    from public.employees e left join public.shifts s on s.id = e.shift_id where e.id = p_emp
  ), o as (
    select w.kind from public.work_calendar w, e
    where w.work_date = p_date and (w.shift_id is null or w.shift_id = e.shift_id)
    order by (w.shift_id is null) limit 1   -- a shift-specific entry wins
  )
  select case
    when not exists (select 1 from e) then false
    when exists (select 1 from public.holidays h, e
                 where h.active and h.holiday_date = p_date
                   and (cardinality(h.department_ids) = 0 or e.department_id = any (h.department_ids))
                   and (cardinality(h.locations) = 0 or e.work_location = any (h.locations))) then false
    when (select kind from o) = 'working_day' then true
    when (select kind from o) in ('saturday_off', 'day_off') then false
    else (select extract(isodow from p_date)::int = any (e.days) from e)
  end;
$$;

-- =============================================================== attendance
create table if not exists public.attendance_sessions (
  id                     text primary key default gen_random_uuid()::text,
  employee_id            uuid not null references public.employees (id) on delete cascade,
  work_date              date not null,
  punch_in_at            timestamptz,            -- server time; null only for sessions created by a correction
  punch_out_at           timestamptz,            -- server time
  closed_reason          text check (closed_reason in ('missing_punch_out')),
  corrected_in_at        timestamptz,            -- approved correction (original kept above)
  corrected_out_at       timestamptz,
  corrected_break_minutes integer check (corrected_break_minutes >= 0),
  location_status_in     text check (location_status_in in ('captured', 'denied', 'unavailable')),
  location_status_out    text check (location_status_out in ('captured', 'denied', 'unavailable')),
  location_verified_by   uuid,
  location_verified_at   timestamptz,
  early_checkout_id      text,
  source                 text not null default 'punch' check (source in ('punch', 'correction')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint attendance_has_start check (punch_in_at is not null or corrected_in_at is not null)
);
create unique index if not exists attendance_day_key on public.attendance_sessions (employee_id, work_date);
create unique index if not exists attendance_open_key on public.attendance_sessions (employee_id)
  where punch_out_at is null and closed_reason is null and punch_in_at is not null;

create table if not exists public.break_sessions (
  id         text primary key default gen_random_uuid()::text,
  session_id text not null references public.attendance_sessions (id) on delete cascade,
  start_at   timestamptz not null default now(),
  end_at     timestamptz,
  constraint break_order check (end_at is null or end_at >= start_at)
);
create unique index if not exists break_open_key on public.break_sessions (session_id) where end_at is null;

create table if not exists public.attendance_locations (
  id          bigint generated always as identity primary key,
  session_id  text not null references public.attendance_sessions (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  kind        text not null check (kind in ('in', 'out')),
  latitude    double precision not null check (latitude between -90 and 90),
  longitude   double precision not null check (longitude between -180 and 180),
  accuracy_m  double precision check (accuracy_m >= 0),
  captured_at timestamptz,          -- device-reported capture time
  recorded_at timestamptz not null default now(),
  unique (session_id, kind)
);

create table if not exists public.attendance_corrections (
  id               text primary key default gen_random_uuid()::text,
  employee_id      uuid not null references public.employees (id) on delete cascade,
  work_date        date not null,
  session_id       text references public.attendance_sessions (id) on delete set null,
  correction_type  text not null check (correction_type in ('missed_punch_in', 'missed_punch_out', 'break_timing', 'technical')),
  requested_in_at  timestamptz,
  requested_out_at timestamptz,
  requested_break_minutes integer check (requested_break_minutes >= 0),
  reason           text not null check (length(btrim(reason)) >= 3),
  details          text,
  status           text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected', 'Cancelled')),
  original         jsonb,
  applied          jsonb,
  decided_by       uuid,
  decided_at       timestamptz,
  decision_comment text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint correction_times check (requested_out_at is null or requested_in_at is null or requested_out_at > requested_in_at)
);

create table if not exists public.early_checkout_requests (
  id               text primary key default gen_random_uuid()::text,
  employee_id      uuid not null references public.employees (id) on delete cascade,
  work_date        date not null,
  requested_time   timestamptz not null,
  reason           text not null check (length(btrim(reason)) >= 5),
  status           text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected', 'Cancelled')),
  decided_by       uuid,
  decided_at       timestamptz,
  decision_comment text,
  override         boolean not null default false,
  override_reason  text,
  actual_checkout_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint early_override_reason check (not override or length(btrim(coalesce(override_reason, ''))) >= 5)
);
create unique index if not exists early_checkout_day_key on public.early_checkout_requests (employee_id, work_date)
  where status in ('Pending', 'Approved');

-- =============================================================== punch functions
create or replace function public.att_require_employee()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare me uuid := public.my_employee_id();
begin
  if me is null then raise exception 'Only employees can record attendance'; end if;
  if (select employment_status from public.employees where id = me) = 'Resigned' then
    raise exception 'Attendance is closed for this employee';
  end if;
  return me;
end $$;

-- Saves a device-reported location (never invented) and applies the location policy.
create or replace function public.att_location(p_session text, p_emp uuid, p_kind text, p_loc jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  st text := coalesce(p_loc ->> 'status', 'unavailable');
  pol text := coalesce(public.setting('location_policy') #>> '{}', 'optional');
begin
  if st = 'captured' then
    if (p_loc ->> 'latitude') is null or (p_loc ->> 'longitude') is null then
      raise exception 'Location coordinates are missing';
    end if;
    insert into public.attendance_locations (session_id, employee_id, kind, latitude, longitude, accuracy_m, captured_at)
    values (p_session, p_emp, p_kind, (p_loc ->> 'latitude')::double precision, (p_loc ->> 'longitude')::double precision,
            (p_loc ->> 'accuracy')::double precision, (p_loc ->> 'captured_at')::timestamptz)
    on conflict (session_id, kind) do nothing;
    return 'captured';
  end if;
  if st not in ('denied', 'unavailable') then raise exception 'Unknown location status'; end if;
  if pol = 'required' then
    raise exception 'LOCATION_REQUIRED: Your company requires your location to punch %. Allow location access and try again, or ask HR for an attendance correction.',
      case p_kind when 'in' then 'in' else 'out' end;
  end if;
  return st;
end $$;

create or replace function public.punch_in(p_location jsonb default '{}')
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.att_require_employee();
  today date := public.company_today();
  sid text;
begin
  perform pg_advisory_xact_lock(hashtext('att:' || me));
  -- A session left open on an earlier day is closed as "missing punch-out" (no time is invented).
  update public.attendance_sessions set closed_reason = 'missing_punch_out', updated_at = now()
  where employee_id = me and work_date < today and punch_out_at is null and closed_reason is null;
  if exists (select 1 from public.attendance_sessions where employee_id = me and work_date = today) then
    raise exception 'ALREADY_PUNCHED_IN: You have already punched in today.';
  end if;
  insert into public.attendance_sessions (employee_id, work_date, punch_in_at) values (me, today, now()) returning id into sid;
  update public.attendance_sessions set location_status_in = public.att_location(sid, me, 'in', p_location) where id = sid;
  perform public.notify(array(select reporting_manager_id from public.employees where id = me), 'attendance',
    (select full_name from public.profiles where id = me) || ' punched in', null, 'hr/attendance');
  return sid;
end $$;

create or replace function public.open_session(p_emp uuid)
returns text language sql stable security definer set search_path = '' as $$
  select id from public.attendance_sessions
  where employee_id = p_emp and punch_out_at is null and closed_reason is null and punch_in_at is not null
  order by work_date desc limit 1;
$$;

create or replace function public.punch_out(p_location jsonb default '{}')
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.att_require_employee();
  sid text;
  ec text;
begin
  perform pg_advisory_xact_lock(hashtext('att:' || me));
  sid := public.open_session(me);
  if sid is null then raise exception 'NOT_PUNCHED_IN: You are not punched in.'; end if;
  update public.break_sessions set end_at = now() where session_id = sid and end_at is null;
  select id into ec from public.early_checkout_requests
  where employee_id = me and work_date = (select work_date from public.attendance_sessions where id = sid) and status = 'Approved';
  update public.attendance_sessions set punch_out_at = now(), early_checkout_id = ec,
    location_status_out = public.att_location(sid, me, 'out', p_location), updated_at = now()
  where id = sid;
  if ec is not null then update public.early_checkout_requests set actual_checkout_at = now() where id = ec; end if;
  return sid;
end $$;

create or replace function public.break_start()
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := public.att_require_employee(); sid text; bid text;
begin
  perform pg_advisory_xact_lock(hashtext('att:' || me));
  sid := public.open_session(me);
  if sid is null then raise exception 'NOT_PUNCHED_IN: Punch in before starting a break.'; end if;
  if exists (select 1 from public.break_sessions where session_id = sid and end_at is null) then
    raise exception 'ON_BREAK: A break is already running.';
  end if;
  insert into public.break_sessions (session_id) values (sid) returning id into bid;
  update public.attendance_sessions set updated_at = now() where id = sid;
  return bid;
end $$;

create or replace function public.break_end()
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := public.att_require_employee(); sid text; bid text;
begin
  perform pg_advisory_xact_lock(hashtext('att:' || me));
  sid := public.open_session(me);
  update public.break_sessions set end_at = now() where session_id = sid and end_at is null returning id into bid;
  if bid is null then raise exception 'NOT_ON_BREAK: No break is running.'; end if;
  update public.attendance_sessions set updated_at = now() where id = sid;
  return bid;
end $$;

-- HR / Super Admin confirm a punch made without location (policy "approval").
create or replace function public.verify_attendance_location(p_session text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_super_admin() or public.is_hr()) then raise exception 'Only HR can verify attendance'; end if;
  update public.attendance_sessions set location_verified_by = auth.uid(), location_verified_at = now(), updated_at = now() where id = p_session;
end $$;

-- Deletes locations older than the retention setting (HR / Super Admin).
create or replace function public.purge_attendance_locations()
returns integer language plpgsql security definer set search_path = '' as $$
declare n int; days int := coalesce((public.setting('location_retention_days') #>> '{}')::int, 180);
begin
  if public.is_end_user_request() and not (public.is_super_admin() or public.is_hr()) then raise exception 'Not allowed'; end if;
  delete from public.attendance_locations where recorded_at < now() - make_interval(days => days);
  get diagnostics n = row_count;
  return n;
end $$;

-- =============================================================== corrections
create or replace function public.request_attendance_correction(p_date date, p_type text, p_in timestamptz, p_out timestamptz,
  p_break_minutes integer, p_reason text, p_details text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := public.att_require_employee(); sid text; rid text; s record;
begin
  if p_date > public.company_today() then raise exception 'Corrections are for past or current days'; end if;
  select * into s from public.attendance_sessions where employee_id = me and work_date = p_date;
  sid := s.id;
  if p_type = 'missed_punch_in' and p_in is null then raise exception 'Enter the punch-in time'; end if;
  if p_type = 'missed_punch_out' and p_out is null then raise exception 'Enter the punch-out time'; end if;
  if p_type = 'break_timing' and p_break_minutes is null then raise exception 'Enter the correct break minutes'; end if;
  if p_type = 'missed_punch_out' and sid is null then raise exception 'There is no attendance on that day — request a missed punch-in instead'; end if;
  if (p_in is not null and (p_in at time zone public.company_tz())::date <> p_date)
     or (p_out is not null and p_out < (p_date::timestamp at time zone public.company_tz())) then
    raise exception 'The corrected times must be on the attendance date';
  end if;
  if exists (select 1 from public.attendance_corrections where employee_id = me and work_date = p_date and status = 'Pending') then
    raise exception 'A correction for this day is already waiting for approval';
  end if;
  insert into public.attendance_corrections (employee_id, work_date, session_id, correction_type, requested_in_at, requested_out_at,
    requested_break_minutes, reason, details, original)
  values (me, p_date, sid, p_type, p_in, p_out, p_break_minutes, btrim(p_reason), nullif(btrim(coalesce(p_details, '')), ''),
    case when sid is null then null else jsonb_build_object('punch_in_at', s.punch_in_at, 'punch_out_at', s.punch_out_at,
      'corrected_in_at', s.corrected_in_at, 'corrected_out_at', s.corrected_out_at, 'corrected_break_minutes', s.corrected_break_minutes) end)
  returning id into rid;
  perform public.notify(array(select reporting_manager_id from public.employees where id = me) || array(select public.staff_recipients('hr')),
    'attendance', 'Attendance correction requested', (select full_name from public.profiles where id = me) || ' · ' || to_char(p_date, 'DD Mon YYYY'), 'hr/corrections');
  return rid;
end $$;

create or replace function public.decide_attendance_correction(p_id text, p_approve boolean, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare c record; sid text; s record;
begin
  select * into c from public.attendance_corrections where id = p_id for update;
  if c.id is null then raise exception 'Correction not found'; end if;
  if not public.can_approve_for(c.employee_id) then raise exception 'You cannot decide this correction'; end if;
  if c.status <> 'Pending' then raise exception 'This correction was already decided'; end if;
  if not p_approve then
    update public.attendance_corrections set status = 'Rejected', decided_by = auth.uid(), decided_at = now(),
      decision_comment = p_comment, updated_at = now() where id = p_id;
  else
    perform pg_advisory_xact_lock(hashtext('att:' || c.employee_id));
    select * into s from public.attendance_sessions where employee_id = c.employee_id and work_date = c.work_date;
    sid := s.id;
    if sid is null then
      insert into public.attendance_sessions (employee_id, work_date, corrected_in_at, corrected_out_at, corrected_break_minutes, source)
      values (c.employee_id, c.work_date, coalesce(c.requested_in_at, c.requested_out_at), c.requested_out_at, c.requested_break_minutes, 'correction')
      returning id into sid;
    else
      update public.attendance_sessions set
        corrected_in_at = coalesce(c.requested_in_at, corrected_in_at),
        corrected_out_at = coalesce(c.requested_out_at, corrected_out_at),
        corrected_break_minutes = coalesce(c.requested_break_minutes, corrected_break_minutes),
        updated_at = now()
      where id = sid;
    end if;
    select * into s from public.attendance_sessions where id = sid;
    update public.attendance_corrections set status = 'Approved', decided_by = auth.uid(), decided_at = now(), decision_comment = p_comment,
      session_id = sid, updated_at = now(),
      applied = jsonb_build_object('corrected_in_at', s.corrected_in_at, 'corrected_out_at', s.corrected_out_at, 'corrected_break_minutes', s.corrected_break_minutes)
    where id = p_id;
  end if;
  perform public.notify(array[c.employee_id], 'attendance', 'Attendance correction ' || case when p_approve then 'approved' else 'rejected' end,
    to_char(c.work_date, 'DD Mon YYYY') || coalesce(' · ' || p_comment, ''), 'work/attendance');
end $$;

create or replace function public.cancel_attendance_correction(p_id text)
returns void language sql security definer set search_path = '' as $$
  update public.attendance_corrections set status = 'Cancelled', updated_at = now()
  where id = p_id and employee_id = auth.uid() and status = 'Pending';
$$;

-- =============================================================== early checkout
create or replace function public.early_checkouts_used(p_emp uuid, p_month date)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.early_checkout_requests
  where employee_id = p_emp and status = 'Approved' and date_trunc('month', work_date) = date_trunc('month', p_month);
$$;

create or replace function public.request_early_checkout(p_time timestamptz, p_reason text)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := public.att_require_employee(); d date := public.company_today(); rid text;
  lim int := coalesce((public.setting('early_checkout_monthly_limit') #>> '{}')::int, 2);
begin
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Enter the emergency reason'; end if;
  if (p_time at time zone public.company_tz())::date <> d or p_time < now() - interval '5 minutes' then
    raise exception 'Choose a checkout time later today';
  end if;
  if public.early_checkouts_used(me, d) >= lim then
    raise exception 'EARLY_LIMIT: You have used all % early checkouts for this month. HR can review exceptional cases.', lim;
  end if;
  insert into public.early_checkout_requests (employee_id, work_date, requested_time, reason) values (me, d, p_time, btrim(p_reason))
  returning id into rid;
  perform public.notify(array(select reporting_manager_id from public.employees where id = me), 'attendance', 'Early checkout requested',
    (select full_name from public.profiles where id = me) || ' · ' || to_char(p_time at time zone public.company_tz(), 'HH24:MI'), 'work/team');
  return rid;
end $$;

create or replace function public.decide_early_checkout(p_id text, p_approve boolean, p_comment text default null,
  p_override boolean default false, p_override_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r record; lim int := coalesce((public.setting('early_checkout_monthly_limit') #>> '{}')::int, 2);
begin
  select * into r from public.early_checkout_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if not public.can_approve_for(r.employee_id) then raise exception 'You cannot decide this request'; end if;
  if r.status <> 'Pending' then raise exception 'This request was already decided'; end if;
  if p_approve and public.early_checkouts_used(r.employee_id, r.work_date) >= lim then
    if not p_override then
      raise exception 'EARLY_LIMIT: This employee already has % approved early checkouts this month.', lim;
    end if;
    if not (public.is_super_admin() or public.is_hr()) then raise exception 'Only HR can approve beyond the monthly limit'; end if;
    if length(btrim(coalesce(p_override_reason, ''))) < 5 then raise exception 'Enter the reason for the exception'; end if;
  end if;
  update public.early_checkout_requests set status = case when p_approve then 'Approved' else 'Rejected' end,
    decided_by = auth.uid(), decided_at = now(), decision_comment = p_comment,
    override = p_approve and p_override and public.early_checkouts_used(r.employee_id, r.work_date) >= lim,
    override_reason = case when p_approve and p_override then p_override_reason end, updated_at = now()
  where id = p_id;
  if p_approve and p_override then
    insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, changes)
    values (auth.uid(), public.my_role(), 'override', 'early_checkout_requests', p_id, jsonb_build_object('reason', p_override_reason));
  end if;
  -- Already checked out that day: link the approval to the attendance.
  update public.attendance_sessions set early_checkout_id = p_id
  where p_approve and employee_id = r.employee_id and work_date = r.work_date and punch_out_at is not null;
  perform public.notify(array[r.employee_id], 'attendance', 'Early checkout ' || case when p_approve then 'approved' else 'rejected' end,
    p_comment, 'work/attendance');
end $$;

create or replace function public.cancel_early_checkout(p_id text)
returns void language sql security definer set search_path = '' as $$
  update public.early_checkout_requests set status = 'Cancelled', updated_at = now()
  where id = p_id and employee_id = auth.uid() and status = 'Pending';
$$;

-- =============================================================== calculations
-- One row per attendance session with the policy calculations (respects table RLS).
create or replace view public.attendance_days with (security_invoker = true) as
with b as (
  select bs.session_id,
         -- a running break counts until now; a break left open on a closed session counts as 0
         sum(extract(epoch from (coalesce(bs.end_at, case when s.punch_out_at is null and s.closed_reason is null then now() else bs.start_at end) - bs.start_at)) / 60) as minutes,
         bool_or(bs.end_at is null and s.punch_out_at is null and s.closed_reason is null) as on_break
  from public.break_sessions bs join public.attendance_sessions s on s.id = bs.session_id
  group by bs.session_id
), x as (
  select s.*, coalesce(s.corrected_in_at, s.punch_in_at) as eff_in,
         coalesce(s.corrected_out_at, s.punch_out_at) as eff_out,
         coalesce(s.corrected_break_minutes, round(b.minutes)::int, 0) as break_minutes,
         coalesce(b.on_break, false) as on_break,
         sh.flexible, sh.start_time, sh.end_time, sh.grace_minutes, coalesce(sh.required_minutes, 480) as required_minutes,
         coalesce(sh.unpaid_breaks, true) as unpaid_breaks
  from public.attendance_sessions s
  join public.employees e on e.id = s.employee_id
  left join public.shifts sh on sh.id = e.shift_id
  left join b on b.session_id = s.id
)
select x.id, x.employee_id, x.work_date, x.punch_in_at, x.punch_out_at, x.corrected_in_at, x.corrected_out_at, x.eff_in, x.eff_out,
       x.closed_reason, x.source, x.location_status_in, x.location_status_out, x.location_verified_at, x.early_checkout_id,
       case when x.eff_out is not null then 'Checked Out' when x.closed_reason is not null then 'Missing Punch-out'
            when x.on_break then 'On Break' else 'Checked In' end as state,
       round(extract(epoch from (coalesce(x.eff_out, case when x.closed_reason is null then now() end) - x.eff_in)) / 60)::int as gross_minutes,
       x.break_minutes,
       greatest(0, round(extract(epoch from (coalesce(x.eff_out, case when x.closed_reason is null then now() end) - x.eff_in)) / 60)::int
                   - case when x.unpaid_breaks then x.break_minutes else 0 end) as net_minutes,
       x.required_minutes,
       -- late only when the shift has a configured start time
       (not coalesce(x.flexible, true) and x.start_time is not null and x.eff_in is not null
        and (x.eff_in at time zone public.company_tz())::time > x.start_time + make_interval(mins => coalesce(x.grace_minutes, 0))) as late,
       (x.eff_out is not null and (
          (not coalesce(x.flexible, true) and x.end_time is not null and (x.eff_out at time zone public.company_tz())::time < x.end_time)
          or (coalesce(x.flexible, true) and round(extract(epoch from (x.eff_out - x.eff_in)) / 60) - case when x.unpaid_breaks then x.break_minutes else 0 end < x.required_minutes))) as early_checkout,
       x.updated_at
from x;

-- Server clock for the live working-hours display (the browser clock is never trusted).
create or replace function public.server_now()
returns timestamptz language sql stable set search_path = '' as $$ select now(); $$;

-- =============================================================== RLS
alter table public.holidays enable row level security;
alter table public.work_calendar enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.break_sessions enable row level security;
alter table public.attendance_locations enable row level security;
alter table public.attendance_corrections enable row level security;
alter table public.early_checkout_requests enable row level security;
revoke all on public.holidays, public.work_calendar, public.attendance_sessions, public.break_sessions, public.attendance_locations,
  public.attendance_corrections, public.early_checkout_requests from anon, authenticated;
grant select on public.holidays, public.work_calendar, public.attendance_sessions, public.break_sessions, public.attendance_locations,
  public.attendance_corrections, public.early_checkout_requests, public.attendance_days to authenticated;
grant insert, update, delete on public.holidays, public.work_calendar to authenticated;

do $$
declare t text;
begin
  foreach t in array array['holidays', 'work_calendar', 'attendance_sessions', 'break_sessions', 'attendance_locations',
                           'attendance_corrections', 'early_checkout_requests'] loop
    execute coalesce((select string_agg(format('drop policy if exists %I on public.%I;', polname, t), ' ')
             from pg_policy where polrelid = format('public.%I', t)::regclass), 'select 1');
  end loop;
end $$;

create policy "holidays: staff read" on public.holidays for select to authenticated using (public.is_staff());
create policy "holidays: hr manage" on public.holidays for all to authenticated
  using (public.is_super_admin() or public.is_hr()) with check (public.is_super_admin() or public.is_hr());
create policy "calendar: staff read" on public.work_calendar for select to authenticated using (public.is_staff());
create policy "calendar: hr manage" on public.work_calendar for all to authenticated
  using (public.is_super_admin() or public.is_hr()) with check (public.is_super_admin() or public.is_hr());
create policy "attendance: read" on public.attendance_sessions for select to authenticated using (public.can_view_employee(employee_id));
create policy "breaks: read" on public.break_sessions for select to authenticated
  using (exists (select 1 from public.attendance_sessions s where s.id = session_id and public.can_view_employee(s.employee_id)));
-- Locations: the employee, HR and Super Admin only.
create policy "locations: restricted" on public.attendance_locations for select to authenticated
  using (public.is_staff() and (employee_id = auth.uid() or public.is_super_admin() or public.is_hr()));
create policy "corrections: read" on public.attendance_corrections for select to authenticated using (public.can_view_employee(employee_id));
create policy "early checkout: read" on public.early_checkout_requests for select to authenticated using (public.can_view_employee(employee_id));

do $$
declare t text;
begin
  foreach t in array array['holidays', 'work_calendar', 'attendance_corrections', 'early_checkout_requests'] loop
    execute format('drop trigger if exists %1$s_audit on public.%1$I', t);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$I
                    for each row execute function public.audit_row()', t);
  end loop;
  foreach t in array array['holidays'] loop
    execute format('drop trigger if exists %1$s_touch on public.%1$I', t);
    execute format('create trigger %1$s_touch before update on public.%1$I for each row execute function public.touch_updated_at()', t);
  end loop;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['holidays', 'work_calendar', 'attendance_sessions', 'break_sessions', 'attendance_corrections', 'early_checkout_requests'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['is_working_day(uuid, date)', 'punch_in(jsonb)', 'punch_out(jsonb)', 'break_start()', 'break_end()',
                           'verify_attendance_location(text)', 'purge_attendance_locations()',
                           'request_attendance_correction(date, text, timestamptz, timestamptz, integer, text, text)',
                           'decide_attendance_correction(text, boolean, text)', 'cancel_attendance_correction(text)',
                           'early_checkouts_used(uuid, date)', 'request_early_checkout(timestamptz, text)', 'server_now()',
                           'decide_early_checkout(text, boolean, text, boolean, text)', 'cancel_early_checkout(text)', 'open_session(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['att_require_employee()', 'att_location(text, uuid, text, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
