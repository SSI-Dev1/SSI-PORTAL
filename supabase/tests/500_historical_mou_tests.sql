-- Complete Historical Onboarding with the existing MOU (0065): one step, no second approval, no duplicates.
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
create or replace function pg_temp.affected(stmt text) returns integer language plpgsql as $$
declare n integer;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;

\set super '''00000000-0000-0000-0000-0000000000a1'''
\set po    '''00000000-0000-0000-0000-0000000000f3'''
\set partner '''d0000000-0000-4000-8000-0000000003e1'''
\set ps    '''eeeeeeee-0000-4000-8000-000000000301'''
\set ob    '''eeeeeeee-0000-4000-8000-000000000302'''
\set nw    '''eeeeeeee-0000-4000-8000-000000000303'''
\set amb   '''eeeeeeee-0000-4000-8000-000000000304'''
\set ms    '''eeeeeeee-0000-4000-8000-000000000305'''

begin;
select pg_temp.trusted();
insert into public.agency_prospects (id, reference, company_name, contact_name, email, country, stage, assigned_officer, created_by, source, agency_type) values
  (:ps,  'AG-HM-1', 'Proposal Era Abroad', 'Pia', 'pia@era.test', 'India', 'proposal_sent', :po, :super, 'import', 'international'),
  (:nw,  'AG-HM-3', 'Brand New Co', 'Ned', 'ned@new.test', 'India', 'new_prospect', :po, :super, 'manual', null),
  (:amb, 'AG-HM-4', 'Twin Partners', 'Amy', 'amy@twinp.test', 'India', 'mou_sent', :po, :super, 'import', null),
  (:ms,  'AG-HM-5', 'Still Waiting Ltd', 'Will', 'will@wait.test', 'India', 'mou_sent', :po, :super, 'import', null);
insert into public.partners (id, name, code, contact_name, email, status, portal_enabled, onboarding_source) values
  ('hm-ob', 'Old Friend Study', 'HMOB', 'Olu', 'olu@friend.test', 'Active', false, 'historical'),
  ('hm-t1', 'Twin Partners', 'HMT1', 'One', 'one@twinp1.test', 'Active', false, 'portal'),
  ('hm-t2', 'Twin  partners', 'HMT2', 'Two', 'two@twinp2.test', 'Active', false, 'portal');
insert into public.agency_prospects (id, reference, company_name, contact_name, email, country, stage, assigned_officer, created_by, source,
                                     historical_onboarded, onboarding_type, historical_status, partner_id) values
  (:ob, 'AG-HM-2', 'Old Friend Study', 'Olu', 'olu@friend.test', 'India', 'onboarded', :po, :super, 'import', true, 'historical', 'approved', 'hm-ob');
insert into storage.objects (bucket_id, name) values
  ('agency-documents', 'eeeeeeee-0000-4000-8000-000000000301/mou-1.pdf'),
  ('agency-documents', 'eeeeeeee-0000-4000-8000-000000000302/mou-a.pdf'),
  ('agency-documents', 'eeeeeeee-0000-4000-8000-000000000302/mou-b.pdf'),
  ('agency-documents', 'eeeeeeee-0000-4000-8000-000000000303/mou-n.pdf'),
  ('agency-documents', 'eeeeeeee-0000-4000-8000-000000000304/mou-t.pdf');
create temp table w0 as select count(*) n from public.work_activities;
create temp table u0 as select count(*) n from public.profiles;
create temp table p0 as select count(*) n from public.partners;
grant select on w0, u0, p0 to authenticated;

\echo '== permission'
select pg_temp.act_as(:po);
select pg_temp.denied($$select public.complete_historical_onboarding('eeeeeeee-0000-4000-8000-000000000301', 'eeeeeeee-0000-4000-8000-000000000301/mou-1.pdf', 'MOU.pdf', 1000, true)$$,
  'an employee without the permission cannot complete it', '%authorised administrators%');

\echo '== validation before anything is saved'
select pg_temp.act_as(:super);
select pg_temp.denied($$select public.complete_historical_onboarding('eeeeeeee-0000-4000-8000-000000000301', 'eeeeeeee-0000-4000-8000-000000000301/mou-1.pdf', 'MOU.pdf', 1000, false)$$, 'confirmation required', '%Confirm%');
select pg_temp.denied($$select public.complete_historical_onboarding('eeeeeeee-0000-4000-8000-000000000301', null, null, null, true)$$, 'MOU required', '%Attach%');
select pg_temp.denied($$select public.complete_historical_onboarding('eeeeeeee-0000-4000-8000-000000000301', 'eeeeeeee-0000-4000-8000-000000000301/missing.pdf', 'MOU.pdf', 1000, true)$$, 'upload must exist', '%did not finish%');
select pg_temp.denied($$select public.complete_historical_onboarding('eeeeeeee-0000-4000-8000-000000000301', 'eeeeeeee-0000-4000-8000-000000000302/mou-a.pdf', 'MOU.pdf', 1000, true)$$, 'file must be in this agency''s folder', '%Attach%');
select pg_temp.denied($$select public.complete_historical_onboarding('eeeeeeee-0000-4000-8000-000000000301', 'eeeeeeee-0000-4000-8000-000000000301/mou-1.pdf', 'MOU.docx', 1000, true)$$, 'PDF only', '%PDF%');
select pg_temp.denied($$select public.complete_historical_onboarding('eeeeeeee-0000-4000-8000-000000000301', 'eeeeeeee-0000-4000-8000-000000000301/mou-1.pdf', 'MOU.pdf', 1000, true, current_date + 400)$$, 'no future original date', '%future%');

\echo '== TEST 4 / 14: Proposal Sent record genuinely onboarded long ago → Onboarded + Clients & Partnerships in one step'
select public.complete_historical_onboarding(:ps, 'eeeeeeee-0000-4000-8000-000000000301/mou-1.pdf', 'Era MOU signed.pdf', 182000, true, '2024-06-01', 'Email 12 Jun 2024 from Pia', 'Signed MOU returned by email',
  '55555555-0000-4000-8000-000000000001') as r \gset
select pg_temp.check(:'r'::jsonb ->> 'status' = 'completed' and :'r'::jsonb ->> 'from' = 'proposal_sent' and :'r'::jsonb ->> 'partner_name' = 'Proposal Era Abroad', 'completed; client record created from the agency');
select pg_temp.trusted();
select pg_temp.check((select stage = 'onboarded' and historical_status = 'approved' and historical_reviewed_by = :super::uuid and historical_original_date = '2024-06-01'
  and historical_evidence = 'Email 12 Jun 2024 from Pia' and reference = 'AG-HM-1' and assigned_officer = :po::uuid from public.agency_prospects where id = :ps),
  'same agency: Onboarded, approval recorded once (no pending state), original date and email reference kept, officer kept');
select pg_temp.check((select o.agency_type = 'international' and not o.portal_enabled and o.archived_at is null and not o.internal
  from public.agency_prospects a join public.partners o on o.id = a.partner_id where a.id = :ps), 'in Clients & Partnerships; Domestic/International kept; no portal');
select pg_temp.check((select count(*) = 1 and bool_and(kind = 'historical_mou' and version = 1 and file_name = 'Era MOU signed.pdf' and uploaded_by = :super::uuid and partner_id is not null and size_bytes = 182000)
  from public.agency_documents where agency_id = :ps), 'MOU recorded: agency, client record, type, uploader, filename, version, size');
select pg_temp.check((select count(*) from public.profiles) = (select n from u0), 'TEST 16: no login created');
select pg_temp.check((select count(*) from public.work_activities) = (select n from w0), 'TEST 17: no Daily Work Report activity');

\echo '== TEST 10: the same click twice'
select pg_temp.act_as(:super);
select pg_temp.check(public.complete_historical_onboarding(:ps, 'eeeeeeee-0000-4000-8000-000000000301/mou-1.pdf', 'Era MOU signed.pdf', 182000, true, null, null, null,
  '55555555-0000-4000-8000-000000000001') ->> 'status' = 'repeat', 'repeat request recognised');
select pg_temp.trusted();
select pg_temp.check((select count(*) from public.agency_documents where agency_id = :ps) = 1 and (select count(*) from public.partners) = (select n from p0) + 1, 'no second document or client');

\echo '== TEST 9 / 12: already onboarded with its client record → MOU attached, nothing restarted'
select pg_temp.act_as(:super);
select pg_temp.check(public.complete_historical_onboarding(:ob, 'eeeeeeee-0000-4000-8000-000000000302/mou-a.pdf', 'Friend MOU.pdf', 5000, true) ->> 'status' = 'attached', 'attached');
select pg_temp.check(public.complete_historical_onboarding(:ob, 'eeeeeeee-0000-4000-8000-000000000302/mou-b.pdf', 'Friend MOU corrected.pdf', 5000, true) ->> 'version' = '2', 'a replacement is version 2');
select pg_temp.trusted();
select pg_temp.check((select partner_id = 'hm-ob' and stage = 'onboarded' and historical_status = 'approved' from public.agency_prospects where id = :ob), 'same client record and onboarding');
select pg_temp.check((select count(*) from public.agency_prospects where partner_id = 'hm-ob') = 1, 'no duplicate client');

\echo '== TEST 15: a new agency cannot use it'
select pg_temp.act_as(:super);
select pg_temp.denied($$select public.complete_historical_onboarding('eeeeeeee-0000-4000-8000-000000000303', 'eeeeeeee-0000-4000-8000-000000000303/mou-n.pdf', 'MOU.pdf', 1000, true)$$,
  'created in the CRM → normal onboarding only', '%normal proposal%');

\echo '== ambiguous client record: specific reason, nothing saved'
select pg_temp.denied($$select public.complete_historical_onboarding('eeeeeeee-0000-4000-8000-000000000304', 'eeeeeeee-0000-4000-8000-000000000304/mou-t.pdf', 'MOU.pdf', 1000, true)$$,
  'two possible client records', '%Not completed%');
select pg_temp.trusted();
select pg_temp.check((select stage = 'mou_sent' and partner_id is null and historical_status is null from public.agency_prospects where id = :amb)
  and not exists (select 1 from public.agency_documents where agency_id = :amb), 'rolled back: stage, link and document unchanged');

\echo '== TEST 13: untouched historical records keep their stage'
select pg_temp.check((select stage = 'mou_sent' and partner_id is null from public.agency_prospects where id = :ms), 'MOU Sent stays MOU Sent');

\echo '== TEST 18: partner logins cannot see MOUs'
select pg_temp.act_as(:partner);
select pg_temp.check((select count(*) from public.agency_documents) = 0, 'no document rows');
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'agency-documents') = 0, 'no files');
select pg_temp.denied($$insert into storage.objects (bucket_id, name) values ('agency-documents', 'eeeeeeee-0000-4000-8000-000000000301/x.pdf')$$, 'cannot upload', '%');
select pg_temp.act_as(:super);
select pg_temp.check((select count(*) from public.agency_documents where agency_id in (:ps, :ob)) = 3, 'Super Admin sees them');
select pg_temp.check(pg_temp.affected($q$delete from storage.objects where name = 'eeeeeeee-0000-4000-8000-000000000304/mou-t.pdf'$q$) = 1, 'unrecorded upload can be cleaned up');
rollback;
