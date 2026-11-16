-- 0051: "Partners · Add partner" for Partnership Officers.
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', msg using errcode = 'TF001'; end if;
  raise notice 'pass: %', msg;
end $$;

\echo '== partner_create permission'
select pg_temp.check('partner_create' = any (public.staff_modules()), 'partner_create is a known staff permission');
select pg_temp.check(not exists (select 1 from unnest(array['admin_staff', 'application_manager', 'assessment_staff', 'finance_staff', 'support_staff']) r
                                 where 'partner_create' = any (public.role_default_permissions(r))),
  'no role gets it by default (Partner Success, Application Team, other staff)');
select pg_temp.check((select count(*) from public.audit_log where action = 'permission_granted' and changes ->> 'permission' = 'partner_create')
                     = (select count(*) from public.profiles where 'partner_create' = any (coalesce(permissions, '{}'))),
  'every grant made by the migration is in the audit log');
-- An account can hold it (the profile guard accepts it).
update public.profiles set permissions = array['agency_outreach', 'partner_create']
where id = (select id from public.profiles where role = 'admin_staff' limit 1);
select pg_temp.check(exists (select 1 from public.profiles where 'partner_create' = any (coalesce(permissions, '{}'))), 'a Super Admin can grant it to an account');
rollback;
