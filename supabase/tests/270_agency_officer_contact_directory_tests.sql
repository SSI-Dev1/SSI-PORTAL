-- Officer assignment, contact-status correction and the onboarded directory (0040). Synthetic rows only.
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
    if pattern <> '' and sqlerrm not like pattern then raise exception 'FAIL: % — wrong error: %', msg, sqlerrm using errcode = 'TF001'; end if;
    raise notice 'pass: % (rejected: %)', msg, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % — statement was allowed', msg using errcode = 'TF001';
end $$;
create or replace function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated',
    'iat', extract(epoch from clock_timestamp())::bigint + 1)::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.trusted() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

\set admin   '''00000000-0000-0000-0000-0000000000a2'''
\set partner '''00000000-0000-0000-0000-0000000000b1'''
\set mgr     '''00000000-0000-0000-0000-0000000000f2'''
\set po      '''00000000-0000-0000-0000-0000000000f3'''
\set app     '''00000000-0000-0000-0000-0000000000f4'''

begin;
select pg_temp.trusted();
-- f2 plays the Senior IRM who becomes the default officer (Agencies & proposals permission, HR record).
update public.profiles set permissions = array_append(coalesce(permissions, public.role_default_permissions(role)), 'agency_outreach') where id = :mgr;
update public.profiles set full_name = 'Anson Siby' where id = :mgr;
insert into public.partners (id, name, code, contact_name, email, status, portal_enabled) values
  ('p_ster_t', 'Sterling', 'STRT', 'S', 'hello@sterling.test', 'Active', true),
  ('p_link_t', 'Linked Partner', 'LNKT', 'L', 'l@linked.test', 'Active', true);
insert into public.agency_prospects (id, reference, company_name, contact_name, phone, email, contact_status, stage, assigned_officer, source, historical_onboarded, needs_reconciliation, partner_id) values
  ('a0000000-0000-4000-8000-000000000001', 'AG-T-01', 'Alpha Abroad', 'Asha', '9000000001', null, 'unknown', 'proposal_sent', null, 'import', false, false, null),
  ('a0000000-0000-4000-8000-000000000002', 'AG-T-02', 'Beta Study', 'Bala', null, 'b@beta.test', 'not_connected', 'mou_sent', null, 'import', false, false, null),
  ('a0000000-0000-4000-8000-000000000003', 'AG-T-03', 'Gamma Careers', 'Gita', null, null, 'unknown', 'closed', :po, 'manual', false, false, null),
  ('a0000000-0000-4000-8000-000000000004', 'AG-T-04', 'Sterling Study Abroad', 'Sam', null, null, 'unknown', 'onboarded', null, 'import', true, true, null),
  ('a0000000-0000-4000-8000-000000000005', 'AG-T-05', 'Linked Partner', 'Lee', null, null, 'connected', 'onboarded', :po, 'manual', false, false, 'p_link_t');
create temp table ids as select array['a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003',
  'a0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000005']::uuid[] as all_ids;
grant select on ids to authenticated;
create temp table before as select (select count(*) from public.work_activities) as work, (select count(*) from public.partners) as partners,
  (select count(*) from public.profiles where partner_id is not null) as partner_users;
grant select on before to authenticated;
update public.partners set partnership_officer_id = :po where id = 'p_link_t';

\echo '== only administrators'
select pg_temp.act_as(:po);
select pg_temp.denied($$select public.preview_agency_officer((select all_ids from ids), '00000000-0000-0000-0000-0000000000f2')$$, 'an officer cannot preview bulk assignment', '%administrators%');
select pg_temp.denied($$select public.assign_agency_officer((select all_ids from ids), '00000000-0000-0000-0000-0000000000f2', true, null, gen_random_uuid())$$, 'an officer cannot assign in bulk', '%administrators%');
select pg_temp.denied($$select public.bulk_set_agency_contact((select all_ids from ids), 'connected', null, gen_random_uuid())$$, 'an officer cannot correct contact status in bulk', '%administrators%');

\echo '== eligible officers'
select pg_temp.act_as(:admin);
select pg_temp.check(exists (select 1 from public.agency_officer_candidates() where id = :mgr and full_name = 'Anson Siby'), 'the Senior IRM with Agencies access is listed with the full name');
select pg_temp.check(exists (select 1 from public.agency_officer_candidates() where id = :po), 'the Partnership Officer is listed');
select pg_temp.check(not exists (select 1 from public.agency_officer_candidates() where id in (:app, :partner)), 'employees without Agencies access and partner users are not listed');
select pg_temp.denied(format($$select public.assign_agency_officer((select all_ids from ids), %L, true, null, gen_random_uuid())$$, :app), 'an ineligible employee cannot be assigned', '%cannot be an agency officer%');

\echo '== preview, then assign without overwriting'
select pg_temp.check((select (r ->> 'found')::int = 5 and (r ->> 'unassigned')::int = 3 and (r ->> 'other')::int = 2 and (r ->> 'already')::int = 0
                      and r -> 'others' -> 0 ->> 'count' = '2' and r ->> 'officer_name' = 'Anson Siby'
                      from public.preview_agency_officer((select all_ids from ids), :mgr) r), 'preview: 3 unassigned, 2 with another officer (listed by name)');
select pg_temp.check((select count(*) from public.agency_officer_history where prospect_id = any ((select all_ids from ids)::uuid[])) = 0, 'preview changes nothing');
select public.assign_agency_officer((select all_ids from ids), :mgr, false, 'Initial assignment', 'bbbbbbbb-0000-4000-8000-000000000001') as r1 \gset
select pg_temp.check((:'r1'::jsonb ->> 'changed')::int = 3 and (:'r1'::jsonb ->> 'skipped_other_officer')::int = 2, 'without confirmation only unassigned agencies are assigned');
select pg_temp.check((select assigned_officer = :po::uuid from public.agency_prospects where reference = 'AG-T-03'), 'another officer''s agency is not overwritten');
select pg_temp.check((select count(*) from public.agency_officer_history where to_officer = :mgr::uuid and change_kind = 'bulk' and note = 'Initial assignment') = 3, 'history: 3 bulk assignments with the note');
select pg_temp.check((select (r ->> 'replayed')::boolean from public.assign_agency_officer((select all_ids from ids), :mgr, false, 'again', 'bbbbbbbb-0000-4000-8000-000000000001') r), 'the same request again is replayed');
select pg_temp.check((select count(*) from public.agency_officer_history where prospect_id = any ((select all_ids from ids)::uuid[])) = 3, 'replay adds no history');

\echo '== explicit confirmation replaces, linked partner follows'
select public.assign_agency_officer((select all_ids from ids), :mgr, true, 'Confirmed reassignment', 'bbbbbbbb-0000-4000-8000-000000000002') as r2 \gset
select pg_temp.check((:'r2'::jsonb ->> 'changed')::int = 2 and (:'r2'::jsonb ->> 'unchanged')::int = 3, 'confirmed: the 2 other agencies move, 3 already correct');
select pg_temp.check((select count(*) from public.agency_prospects where id = any ((select all_ids from ids)::uuid[]) and assigned_officer = :mgr::uuid) = 5, 'all 5 agencies have the officer');
select pg_temp.check((select partnership_officer_id = :mgr::uuid from public.partners where id = 'p_link_t'), 'the linked partner''s Partnership Officer follows');
select pg_temp.check((select from_officer = :po::uuid from public.agency_officer_history where prospect_id = 'a0000000-0000-4000-8000-000000000003' order by id desc limit 1), 'history keeps the previous officer');

\echo '== the officer stays editable'
select public.assign_agency_officer(array['a0000000-0000-4000-8000-000000000001']::uuid[], :po, true, 'Handover', gen_random_uuid());
select pg_temp.check((select assigned_officer = :po::uuid from public.agency_prospects where reference = 'AG-T-01'), 'one agency changed to another officer later');
select pg_temp.check((select change_kind = 'single' from public.agency_officer_history where prospect_id = 'a0000000-0000-4000-8000-000000000001' order by id desc limit 1), 'a single change is recorded as such');
select pg_temp.denied($$select public.assign_agency_officer((select all_ids from ids), null, false, null, gen_random_uuid())$$, 'removing officers needs explicit confirmation', '%explicit confirmation%');

\echo '== contact status correction'
select pg_temp.check((select (r ->> 'change')::int = 4 and (r ->> 'already')::int = 1 and (r -> 'from' ->> 'unknown')::int = 3 and (r -> 'from' ->> 'not_connected')::int = 1
                      from public.preview_agency_contact((select all_ids from ids), 'connected') r), 'preview: 4 to change (3 not recorded, 1 not connected), 1 already Connected');
select public.bulk_set_agency_contact((select all_ids from ids), 'connected', 'Status correction from the master sheet', 'cccccccc-0000-4000-8000-000000000001') as c1 \gset
select pg_temp.check((:'c1'::jsonb ->> 'changed')::int = 4, '4 agencies set to Connected');
select pg_temp.check((select count(*) from public.agency_prospects where id = any ((select all_ids from ids)::uuid[]) and contact_status = 'connected') = 5, 'contact status column shows Connected for all');
select pg_temp.check((select array_agg(stage order by reference) from public.agency_prospects where id = any ((select all_ids from ids)::uuid[])) = '{proposal_sent,mou_sent,closed,onboarded,onboarded}', 'pipeline stages unchanged');
select pg_temp.check((select bool_and(first_contact_at is null and first_connected_at is null and last_contact_at is null) from public.agency_prospects where reference in ('AG-T-01', 'AG-T-02', 'AG-T-03', 'AG-T-04')),
  'no contact dates are invented (the dashboard does not count them as contacted)');
select pg_temp.check((select count(*) from public.agency_activities where kind = 'contact_status_corrected' and (detail ->> 'correction')::boolean) = 4, 'each correction is audited as a correction');
select pg_temp.check((select count(*) from public.agency_activities where prospect_id = any ((select all_ids from ids)::uuid[]) and kind in ('call', 'meeting', 'contact_attempt', 'follow_up_done')) = 0, 'no calls or outreach are logged');
select pg_temp.check((select (r ->> 'replayed')::boolean from public.bulk_set_agency_contact((select all_ids from ids), 'connected', null, 'cccccccc-0000-4000-8000-000000000001') r), 'the same correction again is replayed');
select pg_temp.check((select count(*) from public.agency_bulk_operations where request_key in ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000001')) = 3, 'every bulk operation is recorded once');
select pg_temp.trusted();
select pg_temp.check((select count(*) from public.work_activities) = (select work from before), 'no daily work-report activity was created by assignments or corrections');

\echo '== Clients & Branches directory'
select pg_temp.act_as(:admin);
select pg_temp.check((select verification = 'pending' and suggested_partner_id = 'p_ster_t' and historical and needs_reconciliation and officer_name = 'Anson Siby'
                      from public.onboarded_agency_directory() where reference = 'AG-T-04'), 'historical onboarded agency: pending verification, suggested partner "Sterling"');
select pg_temp.check((select verification = 'verified' and partner_id = 'p_link_t' and suggested_partner_id is null from public.onboarded_agency_directory() where reference = 'AG-T-05'), 'linked onboarded agency: verified');
select pg_temp.check(not exists (select 1 from public.onboarded_agency_directory() where reference in ('AG-T-01', 'AG-T-02', 'AG-T-03')), 'proposal / MOU / closed agencies are not in the partner directory');
select pg_temp.trusted();
select pg_temp.check((select count(*) from public.partners) = (select partners from before) and (select count(*) from public.profiles where partner_id is not null) = (select partner_users from before),
  'listing creates no partner organisation and no login');
select pg_temp.act_as(:po);
select pg_temp.check((select count(*) from public.onboarded_agency_directory() where reference like 'AG-T-%') = 2, 'a Partnership Officer sees the onboarded directory');
select pg_temp.act_as(:app);
select pg_temp.check((select count(*) from public.onboarded_agency_directory()) = 0, 'staff without Clients & Branches or Agencies access see nothing');
select pg_temp.act_as(:partner);
select pg_temp.check((select count(*) from public.onboarded_agency_directory()) = 0, 'partner users see nothing');
select pg_temp.check((select count(*) from public.agency_officer_history) = 0, 'partner users read no officer history');

\echo '== verification links, never duplicates'
select pg_temp.act_as(:admin);
select public.reconcile_agency('a0000000-0000-4000-8000-000000000004', 'p_ster_t', 'Same company, confirmed by phone');
select pg_temp.check((select verification = 'verified' and partner_id = 'p_ster_t' and not needs_reconciliation from public.onboarded_agency_directory() where reference = 'AG-T-04'), 'after verification the agency is linked and verified');
select pg_temp.denied($$select public.reconcile_agency('a0000000-0000-4000-8000-000000000001', 'p_ster_t', 'dup')$$, 'a partner cannot be linked to a second agency', '%already linked%');
select pg_temp.check((select status = 'Active' and portal_enabled from public.partners where id = 'p_ster_t'), 'the existing partner account is unchanged');
rollback;
