-- 0054: Partnership Agreement in the registration workflow. Synthetic rows only; everything rolls back.
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
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.trusted() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;
-- What the Edge Function does with the service role when the agency uploads its signed copy.
create or replace function pg_temp.upload_signed(rid uuid, v int) returns void language sql as $$
  update public.registration_agreement_files set superseded_at = now() where registration_id = rid and kind = 'partner_signed' and superseded_at is null;
  insert into public.registration_agreement_files (registration_id, kind, version, storage_path, sha256, size, pages, review_status)
  values (rid, 'partner_signed', v, rid || '/agreement/signed-' || v || '.pdf', md5(v::text), 1000, 13, 'pending');
  update public.registration_agreements set status = 'partner_signed' where registration_id = rid;
$$;

\set super   '''00000000-0000-0000-0000-0000000000a1'''
\set admin   '''00000000-0000-0000-0000-0000000000a2'''
\set p1admin '''00000000-0000-0000-0000-0000000000b1'''
\set po      '''00000000-0000-0000-0000-0000000000f3'''

\echo '== countersign permission (TEST 15)'
begin;
select pg_temp.check('agreement_countersign' = any (public.staff_modules()), 'Countersign Agreement is a separate staff permission');
select pg_temp.check(not exists (select 1 from unnest(array['admin_staff', 'application_manager', 'assessment_staff', 'finance_staff', 'support_staff']) r
                                 where 'agreement_countersign' = any (public.role_default_permissions(r))), 'no role (Admin Staff, Partnership, Partner Success…) gets it by default');
select pg_temp.act_as(:admin);
select pg_temp.check(not public.can_countersign_agreements(), 'an ordinary admin cannot countersign');
select pg_temp.act_as(:super);
select pg_temp.check(public.can_countersign_agreements(), 'a Super Admin can');
select pg_temp.trusted();
update public.profiles set permissions = array['partners', 'agreement_countersign'] where id = :admin;
select pg_temp.act_as(:admin);
select pg_temp.check(public.can_countersign_agreements(), 'a named signatory can once granted');
rollback;

\echo '== templates: Super Admin only, one approved per agency type'
begin;
select pg_temp.trusted();
insert into public.agreement_templates (id, agency_type, version, name, layout, storage_path, sha256, pages) values
  ('aaaaaaaa-1111-4000-8000-000000000001', 'domestic', 1, 'Domestic v1', 'ssi_domestic_v1', 'templates/d1.pdf', 'h1', 13),
  ('aaaaaaaa-1111-4000-8000-000000000002', 'domestic', 2, 'Domestic v2', 'ssi_domestic_v1', 'templates/d2.pdf', 'h2', 13);
select pg_temp.act_as(:admin);
select pg_temp.denied($$select public.approve_agreement_template('aaaaaaaa-1111-4000-8000-000000000001')$$, 'only a Super Admin approves templates', '%Super Admin%');
select pg_temp.act_as(:super);
select public.approve_agreement_template('aaaaaaaa-1111-4000-8000-000000000001');
select public.approve_agreement_template('aaaaaaaa-1111-4000-8000-000000000002');
select pg_temp.trusted();
select pg_temp.check((select array_agg(status order by version) from public.agreement_templates where agency_type = 'domestic') = array['retired', 'approved'],
  'approving a new version retires the previous one');
select pg_temp.check(not exists (select 1 from public.agreement_templates where agency_type = 'international'), 'no International template is invented');
rollback;

\echo '== upload, submit, review, corrections, countersign, activation (TESTS 5-11)'
begin;
select pg_temp.act_as(:super);
select public.create_partner_registration('Agreement Test Agency') as created \gset
select (:'created'::jsonb ->> 'token') as tok, (:'created'::jsonb ->> 'id') as rid \gset
select pg_temp.trusted();
select pg_temp.check((select agreement_required from public.partner_registrations where id = :'rid'), 'new registrations require the agreement');
-- The Edge Function has issued the agreement (generated file, status ready).
insert into public.registration_agreements (registration_id, status, agency_type, agreement_date) values (:'rid', 'ready', 'domestic', '2026-11-17');
insert into public.registration_agreement_files (registration_id, kind, version, storage_path, sha256, size, pages) values (:'rid', 'generated', 1, :'rid' || '/agreement/gen-1.pdf', 'g1', 5000, 13);
select pg_temp.denied(format($$select public.submit_partner_registration(%L, '{}', 'v1', 'k1')$$, :'tok'), 'TEST 5: no submission without the signed agreement', '%AGREEMENT_REQUIRED%');
select pg_temp.upload_signed(:'rid', 1);
select public.submit_partner_registration(:'tok', '{}', 'v1', 'k2');
select pg_temp.check((select status = 'pending_review' from public.registration_agreements where registration_id = :'rid')
                     and (select status = 'submitted' from public.partner_registrations where id = :'rid'), 'TEST 7: submitted registration with its agreement Pending SSI Review');
select pg_temp.check((select count(*) from public.notifications where user_id = :super and title = 'New partner registration') >= 1, 'SSI GLOBAL staff are notified');

-- RLS: who can see it
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');   -- HR: no registration rights
select pg_temp.check((select count(*) from public.registration_agreement_files where registration_id = :'rid') = 0, 'an employee without registration rights sees no agreement files');
select pg_temp.act_as(:p1admin);
select pg_temp.check((select count(*) from public.registration_agreement_files where registration_id = :'rid') = 0
                     and (select count(*) from public.registration_agreements where registration_id = :'rid') = 0, 'TEST 14: another partner sees nothing');
select pg_temp.denied($$select public.approve_agreement_for_countersign('00000000-0000-0000-0000-000000000000')$$, 'a partner cannot review agreements', '%authorised administrators%');

-- TEST 9: corrections reopen the same registration for a new upload
select pg_temp.act_as(:super);
select public.request_agreement_changes(:'rid', array['missing_signature', 'missing_seal'], 'Please sign page 13 and add the seal') ->> 'token' as tok2 \gset
select pg_temp.trusted();
select pg_temp.check((select status = 'changes_requested' and review -> 'reasons' ? 'missing_seal' from public.registration_agreements where registration_id = :'rid')
                     and (select status = 'changes_requested' and change_request -> 'fields' ? 'signed_agreement' from public.partner_registrations where id = :'rid'),
  'changes requested: the link reopens for the signed agreement, with the reasons');
select pg_temp.check((select review_status = 'changes_requested' from public.registration_agreement_files where registration_id = :'rid' and kind = 'partner_signed' and version = 1),
  'the reviewed copy is marked');
select pg_temp.denied(format($$select public.submit_partner_registration(%L, '{}', 'v1', 'k3')$$, :'tok2'), 'the returned copy alone cannot be resubmitted', '%AGREEMENT_REQUIRED%');
-- TEST 10: corrected copy
select pg_temp.upload_signed(:'rid', 2);
select public.submit_partner_registration(:'tok2', '{}', 'v1', 'k4');
select pg_temp.check((select status = 'pending_review' from public.registration_agreements where registration_id = :'rid'), 'the corrected copy goes back to Pending SSI Review (not countersigned automatically)');
select pg_temp.check((select count(*) from public.registration_agreement_files where registration_id = :'rid' and kind = 'partner_signed') = 2, 'the earlier version is kept in history');

-- Approve for countersigning; activation needs the countersigned copy
select pg_temp.act_as(:super);
select public.approve_agreement_for_countersign(:'rid');
select public.approve_registration(:'rid', 'ok');
select pg_temp.trusted();
select pg_temp.check((select status = 'approved_for_countersign' from public.registration_agreements where registration_id = :'rid'), 'approved for countersigning');
select pg_temp.denied(format($$select public.begin_registration_provisioning(%L, %L)$$, :'rid', :super), 'TEST 20: no partner account before the agreement is countersigned', '%AGREEMENT_INCOMPLETE%');
-- TEST 11: countersigned (the Edge Function stores the file and sets the status)
insert into public.registration_agreement_files (registration_id, kind, version, storage_path, sha256, size, pages) values (:'rid', 'countersigned', 1, :'rid' || '/agreement/cs-1.pdf', 'c1', 1200, 13);
update public.registration_agreements set status = 'countersigned', countersigned_by = :super, countersigned_at = now() where registration_id = :'rid';
select pg_temp.check((public.begin_registration_provisioning(:'rid', :super) ->> 'reference') is not null, 'once countersigned, the existing activation proceeds');
rollback;

\echo '== registrations from before the agreement step are unaffected'
begin;
select pg_temp.act_as(:super);
select public.create_partner_registration('Older Agency') ->> 'id' as oid \gset
select pg_temp.trusted();
update public.partner_registrations set agreement_required = false, status = 'approved' where id = :'oid';
select pg_temp.check((public.begin_registration_provisioning(:'oid', :super) ->> 'reference') is not null, 'no agreement needed for registrations that did not require one');
rollback;

\echo '== Partnership Officer follows the agreement status of their own agency; reject'
begin;
select pg_temp.act_as(:super);
select public.create_partner_registration('Officer Agency') ->> 'id' as orid \gset
select pg_temp.trusted();
insert into public.agency_prospects (reference, company_name, assigned_officer, registration_id, created_by) values ('AG-AGR-1', 'Officer Agency', :po, :'orid', :super);
insert into public.registration_agreements (registration_id, status) values (:'orid', 'pending_review');
select pg_temp.act_as(:po);
select pg_temp.check((select status from public.registration_agreements where registration_id = :'orid') = 'pending_review', 'the officer sees the status');
select pg_temp.check((select count(*) from public.registration_agreement_files where registration_id = :'orid') = 0, 'but not the documents');
select pg_temp.denied(format($$select public.reject_agreement(%L, 'test')$$, :'orid'), 'and cannot review', '%authorised administrators%');
select pg_temp.act_as(:super);
select public.reject_agreement(:'orid', 'Not our template');
select pg_temp.check((select status = 'rejected' from public.registration_agreements where registration_id = :'orid'), 'an invalid document can be rejected');
rollback;
