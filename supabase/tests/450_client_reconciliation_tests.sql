-- Historically onboarded agencies reach Clients & Branches; onboarding progress shows the blocked step (0060).
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

\set super '''00000000-0000-0000-0000-0000000000a1'''
\set po    '''00000000-0000-0000-0000-0000000000f3'''
\set alg   '''eeeeeeee-0000-4000-8000-000000000001'''
\set lnk   '''eeeeeeee-0000-4000-8000-000000000002'''
\set dup   '''eeeeeeee-0000-4000-8000-000000000003'''
\set new   '''eeeeeeee-0000-4000-8000-000000000004'''

begin;
select pg_temp.trusted();
update public.profiles set permissions = array['agency_outreach', 'partners', 'tasks'] where id = :po;
-- Algate: imported as onboarded before the CRM (as in the screenshot), International, never linked.
insert into public.agency_prospects (id, reference, company_name, contact_name, email, phone, country, stage, assigned_officer, created_by, source,
                                     historical_onboarded, onboarding_type, agency_type) values
  (:alg, 'AG-ALG-1', 'Algate', 'Al Gate', 'contact@algate.test', '+44 20 7000 1111', 'United Kingdom', 'onboarded', :po, :super, 'import', true, 'historical', 'international'),
  (:lnk, 'AG-LNK-1', 'Linkable Overseas', 'Lin', 'lin@linkable.test', '+91 90000 44444', 'India', 'onboarded', :po, :super, 'import', true, 'historical', 'domestic'),
  (:dup, 'AG-DUP-1', 'Twin Education', 'Tia', 'tia@twin.test', null, 'India', 'onboarded', :po, :super, 'import', true, 'historical', null),
  (:new, 'AG-NEW-9', 'Fresh Start Agency', 'Fay', 'fay@fresh.test', null, 'India', 'new_prospect', :po, :super, 'manual', false, null, null);
-- an existing client record that matches Linkable by email; two client records that both match "Twin Education" by name
insert into public.partners (id, name, code, contact_name, email, status, portal_enabled) values
  ('rc-link', 'Linkable Overseas Pvt Ltd', 'RCLNK', 'Lin', 'lin@linkable.test', 'Active', false),
  ('rc-tw1', 'Twin Education', 'RCTW1', 'T One', 'one@twin.test', 'Active', false),
  ('rc-tw2', 'Twin  education', 'RCTW2', 'T Two', 'two@twin.test', 'Active', false);
create temp table w0 as select count(*) n from public.work_activities;
create temp table p0 as select count(*) n from public.partners;
grant select on w0, p0 to authenticated;

\echo '== TEST 1 / 2: why Algate is missing from Clients & Branches'
select pg_temp.check((select stage = 'onboarded' and partner_id is null and historical_onboarded from public.agency_prospects where id = :alg),
  'Algate is Onboarded (historical) in the Agency List — but has no client record (partner_id is null)');
select pg_temp.act_as(:super);
select pg_temp.check(not exists (select 1 from public.partners where name ilike '%alg%'), 'no partner organisation exists, so the Clients & Branches list and its search cannot show it');
select pg_temp.check((select verification = 'pending' from public.onboarded_agency_directory() where agency_id = :alg), 'it is only in the separate "Onboarded — needs review" block');
select pg_temp.check(public.historical_onboarding_block(:alg) = 'This agency is already onboarded', 'and the historical approval refuses it ("already onboarded"), so nothing could link it');

\echo '== TEST 3: preview (nothing changes)'
select pg_temp.check((select count(*) = 3 from jsonb_array_elements(public.client_reconciliation_preview(null)) x
  where x ->> 'reference' in ('AG-ALG-1', 'AG-LNK-1', 'AG-DUP-1')) and not exists (select 1 from jsonb_array_elements(public.client_reconciliation_preview(null)) x where x ->> 'reference' = 'AG-NEW-9'),
  'the reconciliation tool lists every unlinked onboarded agency, and no prospects');
select pg_temp.check((select x -> 'plan' ->> 'action' = 'create' from jsonb_array_elements(public.client_reconciliation_preview(array[:alg::uuid])) x), 'Algate: no match — a historical client record will be created');
select pg_temp.check((select x -> 'plan' ->> 'action' = 'link' and x -> 'plan' ->> 'partner_id' = 'rc-link' from jsonb_array_elements(public.client_reconciliation_preview(array[:lnk::uuid])) x), 'Linkable: exact email match — links the existing client record');
select pg_temp.check((select x -> 'plan' ->> 'action' = 'conflict' and jsonb_array_length(x -> 'plan' -> 'candidates') = 2 from jsonb_array_elements(public.client_reconciliation_preview(array[:dup::uuid])) x), 'Twin: two matches — conflict for an administrator');
select pg_temp.check((select x -> 'plan' ->> 'action' = 'conflict' and x -> 'plan' ->> 'reason' like 'Not onboarded%' from jsonb_array_elements(public.client_reconciliation_preview(array[:new::uuid])) x), 'a new prospect is never eligible');
select pg_temp.check((select count(*) from public.partners) = (select n from p0), 'preview changes nothing');

\echo '== permissions'
select pg_temp.act_as(:po);
select pg_temp.check(public.client_reconciliation_preview(null) = '[]'::jsonb, 'a Partnership Officer sees no reconciliation preview');
select pg_temp.denied($$select public.reconcile_agencies_to_clients(array['eeeeeeee-0000-4000-8000-000000000001']::uuid[], 'Onboarded in 2023 by Anson')$$, 'and cannot reconcile', '%authorised administrators%');
select pg_temp.denied($$select public.set_agency_stage('eeeeeeee-0000-4000-8000-000000000004', 'onboarded')$$, 'TEST 18: a new agency cannot be set Onboarded by hand', '%workflow%');

\echo '== TEST 4: reconcile'
select pg_temp.act_as(:super);
select pg_temp.denied($$select public.reconcile_agencies_to_clients(array['eeeeeeee-0000-4000-8000-000000000001']::uuid[], 'short')$$, 'a reason is required', '%reason%');
select public.reconcile_agencies_to_clients(array[:alg, :lnk, :dup, :new]::uuid[], 'Onboarded under the previous process; agreement on file (2023)') as r \gset
select pg_temp.check(jsonb_array_length(:'r'::jsonb -> 'created') = 1 and jsonb_array_length(:'r'::jsonb -> 'linked') = 1 and jsonb_array_length(:'r'::jsonb -> 'skipped') = 2,
  'Algate created, Linkable linked, Twin and the new prospect skipped');
select pg_temp.check((select o.name = 'Algate' and o.onboarding_source = 'historical' and not o.portal_enabled and o.agency_type = 'international'
  and o.partnership_officer_id = :po::uuid and o.contact_name = 'Al Gate'
  from public.partners o join public.agency_prospects a on a.partner_id = o.id where a.id = :alg), 'Algate client record keeps its name, contact, type and officer');
select pg_temp.check((select historical_status = 'approved' and historical_reviewed_by = :super::uuid and historical_reviewed_at is not null and historical_reason like 'Onboarded under%'
  from public.agency_prospects where id = :alg), 'reviewer, time and reason recorded as the historical approval');
select pg_temp.check((select partner_id = 'rc-link' from public.agency_prospects where id = :lnk), 'Linkable linked to the existing record (no new partner)');
select pg_temp.check((select partner_id is null and stage = 'new_prospect' from public.agency_prospects where id = :new), 'the new prospect is untouched');
select pg_temp.check((select count(*) from public.partners) = (select n from p0) + 1, 'exactly one client record created');

\echo '== TEST 5 / 7: in Clients & Branches and its search; portal stays off'
select pg_temp.check((select count(*) = 1 from public.partners where name ilike '%alg%' and archived_at is null), 'search "Alg" finds Algate');
select pg_temp.check((select business_status = 'historical' and portal_status = 'no_account' from public.partner_directory_status() s join public.agency_prospects a on a.partner_id = s.partner_id where a.id = :alg),
  'business onboarded (historical) while portal access is not activated');
select pg_temp.check(not exists (select 1 from public.profiles p join public.agency_prospects a on a.partner_id = p.partner_id where a.id = :alg), 'no login was created');
select pg_temp.check((select verification = 'verified' from public.onboarded_agency_directory() where agency_id = :alg), 'no longer in "needs review"');

\echo '== TEST 6: idempotent'
select public.reconcile_agencies_to_clients(array[:alg, :lnk]::uuid[], 'Second run to confirm nothing changes') as r2 \gset
select pg_temp.check(jsonb_array_length(:'r2'::jsonb -> 'unchanged') = 2 and jsonb_array_length(:'r2'::jsonb -> 'created') = 0 and jsonb_array_length(:'r2'::jsonb -> 'linked') = 0,
  'running again: both already linked, nothing created');
select pg_temp.check((select count(*) from public.partners) = (select n from p0) + 1, 'still one new client record');

\echo '== conflicts: an administrator chooses'
select pg_temp.denied($$select public.reconcile_agencies_to_clients(array['eeeeeeee-0000-4000-8000-000000000003', 'eeeeeeee-0000-4000-8000-000000000002']::uuid[], 'Chose the right Twin record', 'rc-tw1')$$,
  'a chosen record applies to one agency at a time', '%one agency%');
select pg_temp.denied($$select public.reconcile_agencies_to_clients(array['eeeeeeee-0000-4000-8000-000000000003']::uuid[], 'Chose the right Twin record', 'rc-link')$$,
  'a record already used by another agency cannot be chosen', '%another agency%');
select public.reconcile_agencies_to_clients(array[:dup]::uuid[], 'Confirmed by phone it is Twin Education (one@twin.test)', 'rc-tw1');
select pg_temp.check((select partner_id = 'rc-tw1' from public.agency_prospects where id = :dup), 'Twin linked to the chosen record');

\echo '== TEST 20: no employee work recorded'
select pg_temp.trusted();
select pg_temp.check((select count(*) from public.work_activities) = (select n from w0), 'reconciliation adds nothing to anyone''s Daily Work Report');
select pg_temp.check((select count(*) = 3 from public.agency_activities where prospect_id in (:alg, :lnk, :dup) and kind = 'reconciled'), 'each reconciliation is in the agency history');
select pg_temp.check((select count(*) = 3 from public.audit_log where action = 'client_reconciled' and entity_id in (:alg, :lnk, :dup)), 'and in the audit log');

\echo '== onboarding progress'
select pg_temp.act_as(:po);
select pg_temp.check((select r ->> 'path' = 'historical'
    and (select s ->> 'state' from jsonb_array_elements(r -> 'steps') s where s ->> 'key' = 'client') = 'done'
    and (select s ->> 'state' from jsonb_array_elements(r -> 'steps') s where s ->> 'key' = 'portal') = 'current'
  from public.agency_onboarding_progress(:alg) r), 'Algate: historical path, in Clients & Branches, portal not activated');
select pg_temp.trusted();
insert into public.agency_emails (prospect_id, kind, status, detail) values (:new, 'mou', 'not_configured', 'No MOU document is published');
select pg_temp.act_as(:po);
select pg_temp.check((select (select s ->> 'state' from jsonb_array_elements(r -> 'steps') s where s ->> 'key' = 'mou_email') = 'blocked'
    and (select s ->> 'detail' from jsonb_array_elements(r -> 'steps') s where s ->> 'key' = 'mou_email') like '%no MOU document is published%'
    and (select s ->> 'state' from jsonb_array_elements(r -> 'steps') s where s ->> 'key' = 'proposal_sent') = 'current'
  from public.agency_onboarding_progress(:new) r), 'normal path: the MOU step shows the exact recorded blocker');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f4');
select pg_temp.denied($$select public.agency_onboarding_progress('eeeeeeee-0000-4000-8000-000000000001')$$, 'staff without agency access cannot read onboarding progress', '%Not allowed%');
rollback;
