-- Supabase rejects UPDATE / DELETE without WHERE ("UPDATE requires a WHERE clause"); the local test
-- server does not. Fail here if any public function contains one (0036 fixed the first case).
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = notice;

do $$
declare bad text;
begin
  select string_agg(distinct p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join lateral regexp_matches(p.prosrc, '((update|delete\s+from)\s+public\.\w+[^;]*;)', 'gi') m
  where n.nspname = 'public' and m[1] !~* '\mwhere\M';
  if bad is not null then raise exception 'FAIL: UPDATE/DELETE without WHERE in: %', bad using errcode = 'TF001'; end if;
  raise notice 'pass: no public function updates or deletes without WHERE';
end $$;
