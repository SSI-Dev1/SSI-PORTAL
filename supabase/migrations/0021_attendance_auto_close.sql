-- 0021_attendance_auto_close.sql — run after 0020_application_chat_all_portals.sql
-- (Supabase SQL Editor: Save this query as "0021_attendance_auto_close")
--
-- Automatic clock-out at the end of the attendance day, run by the database (pg_cron), not the
-- browser.
-- * Cutoff: local midnight (company timezone, default Asia/Kolkata) after the attendance date.
--   Shifts marked overnight instead end at their own cutoff on the next day (auto_close_time,
--   or four hours after the shift end). HR sets this per shift; each employee has a shift.
-- * auto_close_attendance(): closes every open session past its cutoff. Ends a running break at
--   the cutoff, records closed_reason 'auto_midnight', the cutoff time and the reason
--   "Missed Manual Clock-Out — System Auto-Closed", and flags the day for review. No clock-out
--   time is invented: the day earns no worked hours until a correction is approved. Safe to run
--   any number of times, concurrently or late (it closes whatever is overdue: reconciliation).
-- * The same closure runs before any clock action of that employee, and open_session() never
--   returns a session past its cutoff, so a delayed job cannot keep yesterday's timer running.
-- * The next day starts "Not Checked In"; Clock In creates a new session (never reuses one).
-- * Review: the employee requests a correction (existing flow) or HR / the manager resolves the
--   day directly (hr_resolve_auto_close). Original timestamps stay on the row; every change is
--   kept in attendance_corrections and the audit log.
-- Safe to run more than once.

-- =============================================================== configuration
alter table public.shifts add column if not exists overnight boolean not null default false;
alter table public.shifts add column if not exists auto_close_time time;  -- next-day local time; overnight shifts only

alter table public.attendance_sessions drop constraint if exists attendance_sessions_closed_reason_check;
alter table public.attendance_sessions add constraint attendance_sessions_closed_reason_check
  check (closed_reason in ('missing_punch_out', 'auto_midnight'));
alter table public.attendance_sessions add column if not exists auto_closed_at timestamptz;   -- the cutoff applied
alter table public.attendance_sessions add column if not exists closure_note text;
alter table public.attendance_sessions add column if not exists review_status text;
alter table public.attendance_sessions drop constraint if exists attendance_review_status_check;
alter table public.attendance_sessions add constraint attendance_review_status_check
  check (review_status is null or review_status in ('pending_review', 'corrected', 'reviewed'));
alter table public.attendance_sessions add column if not exists reviewed_by uuid;
alter table public.attendance_sessions add column if not exists reviewed_at timestamptz;
create index if not exists attendance_open_idx on public.attendance_sessions (work_date)
  where punch_out_at is null and closed_reason is null and punch_in_at is not null;

-- =============================================================== cutoff
-- When an open session of this employee for this date must end.
create or replace function public.att_cutoff(p_emp uuid, p_work_date date)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select case when coalesce(sh.overnight, false)
           then ((p_work_date + 1) + coalesce(sh.auto_close_time, (sh.end_time + interval '4 hours')::time, time '12:00'))
                at time zone public.company_tz()
           else (p_work_date + 1)::timestamp at time zone public.company_tz() end
  from (select 1) one
  left join public.employees e on e.id = p_emp
  left join public.shifts sh on sh.id = e.shift_id;
$$;

-- =============================================================== closure
-- Closes overdue open sessions (all employees, or one). Returns how many were closed.
create or replace function public.att_close_overdue(p_emp uuid default null, p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n integer := 0;
  k integer;
begin
  for r in
    select s.id, s.employee_id, s.work_date, public.att_cutoff(s.employee_id, s.work_date) as cut
    from public.attendance_sessions s
    where s.punch_out_at is null and s.closed_reason is null and s.punch_in_at is not null and s.corrected_out_at is null
      and (p_emp is null or s.employee_id = p_emp)
    order by s.work_date, s.id
  loop
    continue when r.cut > p_now;
    -- Same lock as every clock action of this employee: a clock-out at the same moment wins or waits.
    perform pg_advisory_xact_lock(hashtext('att:' || r.employee_id));
    update public.attendance_sessions
       set closed_reason = 'auto_midnight', auto_closed_at = r.cut,
           closure_note = 'Missed Manual Clock-Out — System Auto-Closed', review_status = 'pending_review', updated_at = now()
     where id = r.id and punch_out_at is null and closed_reason is null and corrected_out_at is null;
    get diagnostics k = row_count;
    continue when k = 0;   -- closed meanwhile (another run, or a clock-out): never twice
    update public.break_sessions set end_at = greatest(start_at, least(r.cut, p_now))
     where session_id = r.id and end_at is null;
    insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, changes)
    values (null, 'system', 'auto_clock_out', 'attendance_sessions', r.id,
            jsonb_build_object('work_date', r.work_date, 'cutoff', r.cut, 'reason', 'Missed Manual Clock-Out — System Auto-Closed'));
    perform public.notify(array[r.employee_id], 'attendance', 'Automatic clock-out · ' || to_char(r.work_date, 'DD Mon YYYY'),
      'You did not clock out. Request a correction with your actual finish time.', 'work/attendance');
    perform public.notify(array(select reporting_manager_id from public.employees where id = r.employee_id), 'attendance',
      (select full_name from public.profiles where id = r.employee_id) || ' · automatic clock-out', to_char(r.work_date, 'DD Mon YYYY') || ' · needs review', 'hr/attendance');
    n := n + 1;
  end loop;
  return n;
end $$;

-- Scheduled entry point (pg_cron) and HR "run now". Serialised, so overlapping runs queue.
create or replace function public.auto_close_attendance()
returns integer language plpgsql security definer set search_path = '' as $$
begin
  if public.is_end_user_request() and not (public.is_super_admin() or public.is_hr()) then
    raise exception 'Only HR can run the attendance closure';
  end if;
  perform pg_advisory_xact_lock(hashtext('att:auto-close'));
  return public.att_close_overdue(null, now());
end $$;

-- =============================================================== clock functions
create or replace function public.open_session(p_emp uuid)
returns text language sql stable security definer set search_path = '' as $$
  select id from public.attendance_sessions
  where employee_id = p_emp and punch_out_at is null and closed_reason is null and punch_in_at is not null
    and public.att_cutoff(employee_id, work_date) > now()
  order by work_date desc limit 1;
$$;

create or replace function public.punch_in(p_location jsonb default '{}')
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.att_require_employee();
  today date := public.company_today();
  sid text;
begin
  perform pg_advisory_xact_lock(hashtext('att:' || me));
  perform public.att_close_overdue(me, now());
  if exists (select 1 from public.attendance_sessions where employee_id = me and work_date = today) then
    raise exception 'ALREADY_PUNCHED_IN: You have already punched in today.';
  end if;
  -- An overnight shift from yesterday that has not reached its cutoff is still running.
  if public.open_session(me) is not null then
    raise exception 'STILL_CLOCKED_IN: Clock out of your current shift before clocking in again.';
  end if;
  insert into public.attendance_sessions (employee_id, work_date, punch_in_at) values (me, today, now()) returning id into sid;
  update public.attendance_sessions set location_status_in = public.att_location(sid, me, 'in', p_location) where id = sid;
  perform public.notify(array(select reporting_manager_id from public.employees where id = me), 'attendance',
    (select full_name from public.profiles where id = me) || ' punched in', null, 'hr/attendance');
  return sid;
end $$;

create or replace function public.punch_out(p_location jsonb default '{}')
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.att_require_employee();
  sid text;
  ec text;
begin
  perform pg_advisory_xact_lock(hashtext('att:' || me));
  perform public.att_close_overdue(me, now());
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

create or replace function public.clock_action(p_kind text, p_request_id uuid, p_location jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.att_require_employee();
  prev record;
  sid text;
  res jsonb;
begin
  if p_kind not in ('in', 'out', 'break_start', 'break_end') then raise exception 'Unknown clock action'; end if;
  if p_request_id is null then raise exception 'A request id is required'; end if;
  perform pg_advisory_xact_lock(hashtext('att:' || me));
  select * into prev from public.clock_requests where request_id = p_request_id;
  if found then
    if prev.employee_id <> me or prev.kind <> p_kind then raise exception 'This request id was already used'; end if;
    return prev.result || jsonb_build_object('replayed', true);
  end if;
  perform public.att_close_overdue(me, now());
  sid := case p_kind
    when 'in' then public.punch_in(p_location)
    when 'out' then public.punch_out(p_location)
    when 'break_start' then public.break_start()
    else public.break_end() end;
  res := jsonb_build_object('result', 'ok', 'kind', p_kind, 'id', sid, 'at', now(), 'replayed', false);
  insert into public.clock_requests (request_id, employee_id, kind, result) values (p_request_id, me, p_kind, res);
  delete from public.clock_requests where created_at < now() - interval '7 days';
  return res;
end $$;

-- Re-opening is for a day that has not ended; an ended day is fixed with a correction.
create or replace function public.reopen_attendance(p_session text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  if not (public.is_super_admin() or public.is_hr()) then raise exception 'Only HR can re-open attendance'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Enter the reason for re-opening'; end if;
  select * into s from public.attendance_sessions where id = p_session for update;
  if s.id is null then raise exception 'Attendance not found'; end if;
  if s.employee_id = auth.uid() then raise exception 'You cannot re-open your own attendance'; end if;
  if s.punch_in_at is null then raise exception 'This day has no clock-in to re-open — use an attendance correction instead'; end if;
  if s.punch_out_at is null and s.corrected_out_at is null and s.closed_reason is null then raise exception 'This attendance is still open'; end if;
  if public.att_cutoff(s.employee_id, s.work_date) <= now() then
    raise exception 'This attendance day has ended — correct it instead of re-opening it';
  end if;
  perform pg_advisory_xact_lock(hashtext('att:' || s.employee_id));
  if exists (select 1 from public.attendance_sessions o where o.employee_id = s.employee_id and o.id <> s.id
             and o.punch_out_at is null and o.closed_reason is null and o.punch_in_at is not null) then
    raise exception 'The employee has another open attendance; it must be clocked out first';
  end if;
  update public.attendance_sessions set
    previous_punch_out_at = coalesce(punch_out_at, previous_punch_out_at),
    punch_out_at = null, corrected_out_at = null, closed_reason = null,
    reopened_at = now(), reopened_by = auth.uid(), reopen_reason = btrim(p_reason), updated_at = now()
  where id = p_session;
  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, changes)
  values (auth.uid(), public.my_role(), 'reopen', 'attendance_sessions', p_session,
          jsonb_build_object('punch_out_at', s.punch_out_at, 'corrected_out_at', s.corrected_out_at, 'closed_reason', s.closed_reason, 'reason', btrim(p_reason)));
  perform public.notify(array[s.employee_id], 'attendance', 'Attendance re-opened by HR',
    to_char(s.work_date, 'DD Mon YYYY') || ' · clock out again when you finish', 'work/attendance');
end $$;

-- =============================================================== review
-- A decided correction settles the review of an automatically closed day.
create or replace function public.att_correction_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('Approved', 'Rejected') and old.status is distinct from new.status and new.session_id is not null then
    update public.attendance_sessions
       set review_status = case when new.status = 'Approved' then 'corrected' else 'reviewed' end,
           reviewed_by = new.decided_by, reviewed_at = coalesce(new.decided_at, now()), updated_at = now()
     where id = new.session_id and closed_reason = 'auto_midnight';
  end if;
  return null;
end $$;
drop trigger if exists attendance_corrections_review on public.attendance_corrections;
create trigger attendance_corrections_review after update on public.attendance_corrections
  for each row execute function public.att_correction_review();

-- HR or the employee's manager settles an automatically closed day without waiting for a request:
-- p_out = the actual finish time (applied as an approved correction), or null = no further time
-- is credited. Never on one's own attendance.
create or replace function public.hr_resolve_auto_close(p_session text, p_out timestamptz, p_break_minutes integer, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare s record; cid text;
begin
  select * into s from public.attendance_sessions where id = p_session for update;
  if s.id is null then raise exception 'Attendance not found'; end if;
  if not public.can_approve_for(s.employee_id) then raise exception 'You cannot review this attendance'; end if;
  if s.closed_reason is distinct from 'auto_midnight' or s.review_status is distinct from 'pending_review' then
    raise exception 'This attendance is not waiting for review';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Enter a note for the review'; end if;
  if exists (select 1 from public.attendance_corrections c where c.employee_id = s.employee_id and c.work_date = s.work_date and c.status = 'Pending') then
    raise exception 'The employee has a pending correction for this day — decide that request instead';
  end if;
  if p_break_minutes is not null and p_break_minutes < 0 then raise exception 'Break minutes cannot be negative'; end if;
  if p_out is not null and (p_out <= coalesce(s.corrected_in_at, s.punch_in_at) or p_out > s.auto_closed_at) then
    raise exception 'The finish time must be after the clock-in and no later than the automatic cutoff';
  end if;
  perform pg_advisory_xact_lock(hashtext('att:' || s.employee_id));
  insert into public.attendance_corrections (employee_id, work_date, session_id, correction_type, requested_out_at, requested_break_minutes,
    reason, status, original, decided_by, decided_at, decision_comment)
  values (s.employee_id, s.work_date, s.id, 'missed_punch_out', p_out, p_break_minutes, btrim(p_note), 'Pending',
    jsonb_build_object('punch_in_at', s.punch_in_at, 'punch_out_at', s.punch_out_at, 'closed_reason', s.closed_reason, 'auto_closed_at', s.auto_closed_at,
      'corrected_in_at', s.corrected_in_at, 'corrected_out_at', s.corrected_out_at, 'corrected_break_minutes', s.corrected_break_minutes),
    null, null, null)
  returning id into cid;
  if p_out is not null then
    update public.attendance_sessions set corrected_out_at = p_out, corrected_break_minutes = coalesce(p_break_minutes, corrected_break_minutes), updated_at = now()
    where id = s.id;
  end if;
  update public.attendance_corrections set status = case when p_out is null then 'Rejected' else 'Approved' end,
    decided_by = auth.uid(), decided_at = now(), decision_comment = btrim(p_note), updated_at = now(),
    applied = case when p_out is null then jsonb_build_object('credited', false)
                   else jsonb_build_object('corrected_out_at', p_out, 'corrected_break_minutes', coalesce(p_break_minutes, s.corrected_break_minutes)) end
  where id = cid;
  perform public.notify(array[s.employee_id], 'attendance', 'Attendance reviewed · ' || to_char(s.work_date, 'DD Mon YYYY'),
    case when p_out is null then 'No further time credited' else 'Finish time set to ' || to_char(p_out at time zone public.company_tz(), 'HH24:MI') end, 'work/attendance');
end $$;

-- =============================================================== view
create or replace view public.attendance_days with (security_invoker = true) as
with s0 as (
  select s.*, public.att_cutoff(s.employee_id, s.work_date) as cutoff_at from public.attendance_sessions s
), s1 as (
  -- live = open and before its cutoff (an overdue session counts as closed even before the job runs)
  select s0.*, (s0.punch_out_at is null and s0.closed_reason is null and s0.corrected_out_at is null and s0.cutoff_at > now()) as live
  from s0
), b as (
  select bs.session_id,
         -- a running break counts until now; a break left open on a closed session counts as 0
         sum(extract(epoch from (coalesce(bs.end_at, case when s1.live then now() else bs.start_at end) - bs.start_at)) / 60) as minutes,
         bool_or(bs.end_at is null and s1.live) as on_break
  from public.break_sessions bs join s1 on s1.id = bs.session_id
  group by bs.session_id
), x as (
  select s1.*, coalesce(s1.corrected_in_at, s1.punch_in_at) as eff_in,
         coalesce(s1.corrected_out_at, s1.punch_out_at) as eff_out,
         coalesce(s1.corrected_break_minutes, round(b.minutes)::int, 0) as break_minutes,
         coalesce(b.on_break, false) as on_break,
         sh.flexible, sh.start_time, sh.end_time, sh.grace_minutes, coalesce(sh.required_minutes, 480) as required_minutes,
         coalesce(sh.unpaid_breaks, true) as unpaid_breaks,
         (s1.closed_reason = 'auto_midnight' or (s1.closed_reason is null and s1.punch_in_at is not null
            and s1.punch_out_at is null and s1.corrected_out_at is null and not s1.live)) as auto_closed
  from s1
  join public.employees e on e.id = s1.employee_id
  left join public.shifts sh on sh.id = e.shift_id
  left join b on b.session_id = s1.id
)
select x.id, x.employee_id, x.work_date, x.punch_in_at, x.punch_out_at, x.corrected_in_at, x.corrected_out_at, x.eff_in, x.eff_out,
       x.closed_reason, x.source, x.location_status_in, x.location_status_out, x.location_verified_at, x.early_checkout_id,
       case when x.eff_out is not null then 'Checked Out' when x.auto_closed then 'Auto Clock-Out'
            when x.closed_reason is not null then 'Missing Punch-out'
            when x.on_break then 'On Break' else 'Checked In' end as state,
       round(extract(epoch from (coalesce(x.eff_out, case when x.live then now() end) - x.eff_in)) / 60)::int as gross_minutes,
       x.break_minutes,
       greatest(0, round(extract(epoch from (coalesce(x.eff_out, case when x.live then now() end) - x.eff_in)) / 60)::int
                   - case when x.unpaid_breaks then x.break_minutes else 0 end) as net_minutes,
       x.required_minutes,
       (not coalesce(x.flexible, true) and x.start_time is not null and x.eff_in is not null
        and (x.eff_in at time zone public.company_tz())::time > x.start_time + make_interval(mins => coalesce(x.grace_minutes, 0))) as late,
       (x.eff_out is not null and (
          (not coalesce(x.flexible, true) and x.end_time is not null and (x.eff_out at time zone public.company_tz())::time < x.end_time)
          or (coalesce(x.flexible, true) and round(extract(epoch from (x.eff_out - x.eff_in)) / 60) - case when x.unpaid_breaks then x.break_minutes else 0 end < x.required_minutes))) as early_checkout,
       x.updated_at,
       case when x.eff_out is not null then greatest(0, x.required_minutes - (round(extract(epoch from (x.eff_out - x.eff_in)) / 60)::int
            - case when x.unpaid_breaks then x.break_minutes else 0 end)) end as short_minutes,
       case when x.eff_out is not null then greatest(0, (round(extract(epoch from (x.eff_out - x.eff_in)) / 60)::int
            - case when x.unpaid_breaks then x.break_minutes else 0 end) - x.required_minutes) end as extra_minutes,
       x.reopened_at, x.reopened_by, x.reopen_reason, x.previous_punch_out_at,
       -- 0021: how the day ended, and what is confirmed vs only recorded
       x.cutoff_at, x.auto_closed_at, x.closure_note,
       case when x.auto_closed and x.closed_reason is null then 'pending_review' else x.review_status end as review_status,
       case when x.corrected_out_at is not null then 'corrected' when x.punch_out_at is not null then 'manual'
            when x.auto_closed then 'auto' when x.closed_reason = 'missing_punch_out' then 'missing' end as out_kind,
       -- recorded = clock-in to the automatic cutoff (unpaid breaks removed); never credited as work
       case when x.auto_closed and x.eff_out is null then greatest(0, round(extract(epoch from (coalesce(x.auto_closed_at, x.cutoff_at) - x.eff_in)) / 60)::int
            - case when x.unpaid_breaks then x.break_minutes else 0 end) end as recorded_minutes,
       case when x.auto_closed and x.eff_out is null then greatest(0, round(extract(epoch from (coalesce(x.auto_closed_at, x.cutoff_at) - x.eff_in)) / 60)::int
            - case when x.unpaid_breaks then x.break_minutes else 0 end) else 0 end as unverified_minutes,
       exists (select 1 from public.attendance_corrections c where c.employee_id = x.employee_id and c.work_date = x.work_date and c.status = 'Pending') as correction_pending
from x;
grant select on public.attendance_days to authenticated;

-- =============================================================== grants
do $$
declare f text;
begin
  foreach f in array array['open_session(uuid)', 'punch_in(jsonb)', 'punch_out(jsonb)', 'clock_action(text, uuid, jsonb)',
                           'reopen_attendance(text, text)', 'auto_close_attendance()', 'hr_resolve_auto_close(text, timestamptz, integer, text)',
                           'att_cutoff(uuid, date)'] loop   -- att_cutoff: used by the attendance_days view (security invoker)
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['att_close_overdue(uuid, timestamptz)', 'att_correction_review()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- =============================================================== schedule
-- Every 5 minutes: closes sessions at most 5 minutes after their cutoff, and catches up after any
-- outage (every overdue session is closed on the next run). Needs the pg_cron extension
-- (Supabase: Database → Extensions → pg_cron). Without it the closure still happens on the
-- employee's next clock action and the view never shows an overdue session as running.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron is not available here: %', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ssi-attendance-auto-close';
    perform cron.schedule('ssi-attendance-auto-close', '*/5 * * * *', 'select public.auto_close_attendance()');
  end if;
end $$;
