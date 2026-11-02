-- 0016_attendance_parity.sql — run after 0015_daily_reports.sql
-- (Supabase SQL Editor: Save this query as "0016_attendance_parity")
--
-- Brings SSI attendance in line with the clock behaviour of the Broken English Studio system,
-- adapted to SSI's authenticated, row-level-secured design:
-- * clock_action(): one entry point for Clock In / Clock Out / Break with a per-tap request id.
--   The same id sent again (double tap, retry after a timeout, two tabs) returns the first
--   result and never performs a second action. Requests are scoped to the signed-in employee.
-- * attendance_days gains short_minutes / extra_minutes (worked time below / above the day's
--   required hours, after unpaid breaks) for closed days, plus the re-open audit fields.
-- * reopen_attendance(): the protected HR / Super Admin "Re-open attendance" for a completed
--   day (e.g. clocked out by mistake). The original clock-out is kept on the row and in the audit
--   log; the employee can then clock out again. Nobody can re-open their own attendance.
-- Safe to run more than once.

alter table public.attendance_sessions add column if not exists reopened_at timestamptz;
alter table public.attendance_sessions add column if not exists reopened_by uuid;
alter table public.attendance_sessions add column if not exists reopen_reason text;
alter table public.attendance_sessions add column if not exists previous_punch_out_at timestamptz;

-- =============================================================== idempotent clock actions
create table if not exists public.clock_requests (
  request_id  uuid primary key,
  employee_id uuid not null references public.employees (id) on delete cascade,
  kind        text not null check (kind in ('in', 'out', 'break_start', 'break_end')),
  result      jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists clock_requests_created_idx on public.clock_requests (created_at);
alter table public.clock_requests enable row level security;   -- written only by clock_action()
revoke all on public.clock_requests from anon, authenticated;

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
  -- Serialise this employee's taps, then answer a repeated tap with its first result.
  perform pg_advisory_xact_lock(hashtext('att:' || me));
  select * into prev from public.clock_requests where request_id = p_request_id;
  if found then
    if prev.employee_id <> me or prev.kind <> p_kind then raise exception 'This request id was already used'; end if;
    return prev.result || jsonb_build_object('replayed', true);
  end if;
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

-- =============================================================== protected re-open
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

-- =============================================================== view
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
       x.updated_at,
       -- Worked time against the day's required hours (BE: "Below 8h" / "Extra"), once the day is closed.
       case when x.eff_out is not null then greatest(0, x.required_minutes - (round(extract(epoch from (x.eff_out - x.eff_in)) / 60)::int
            - case when x.unpaid_breaks then x.break_minutes else 0 end)) end as short_minutes,
       case when x.eff_out is not null then greatest(0, (round(extract(epoch from (x.eff_out - x.eff_in)) / 60)::int
            - case when x.unpaid_breaks then x.break_minutes else 0 end) - x.required_minutes) end as extra_minutes,
       x.reopened_at, x.reopened_by, x.reopen_reason, x.previous_punch_out_at
from x;

grant select on public.attendance_days to authenticated;

do $$
declare f text;
begin
  foreach f in array array['clock_action(text, uuid, jsonb)', 'reopen_attendance(text, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
