-- 0050: row-level security helpers are evaluated once per query, not once per row.
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', msg using errcode = 'TF001'; end if;
  raise notice 'pass: %', msg;
end $$;

\echo '== policies wrap row-independent helpers'
select pg_temp.check(not exists (
  select 1 from pg_policies where schemaname = 'public'
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ '(^|[^.a-z_])(is_staff|is_super_admin|is_active_user|my_partner_id|agency_access|can_manage_employees)\(\)'
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) !~ '\(\s*SELECT (public\.)?(is_staff|is_super_admin|is_active_user|my_partner_id|agency_access|can_manage_employees)\(\)'),
  'no policy calls a zero-argument helper per row');
select pg_temp.check(not exists (
  select 1 from pg_policies where schemaname = 'public'
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ '(^|[^( ]|[^T] )staff_can\(''[a-z_]+''::text\)'
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) !~ 'SELECT (public\.)?staff_can'),
  'no policy calls staff_can(''…'') per row');
select pg_temp.check((select qual from pg_policies where tablename = 'courses' and policyname = 'courses: read') ~* 'select',
  'course reads check is_active_user() once');
select pg_temp.check((select qual from pg_policies where tablename = 'agency_activities' and policyname = 'agency activities: read') !~ 'agency_can_see',
  'agency activity reads no longer run agency_can_see per row');
rollback;
