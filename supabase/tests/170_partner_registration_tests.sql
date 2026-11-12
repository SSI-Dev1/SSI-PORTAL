-- Partner registration links, public submission, review and provisioning (0030).
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

\set super   '''00000000-0000-0000-0000-0000000000a1'''
\set admin   '''00000000-0000-0000-0000-0000000000a2'''
\set p1admin '''00000000-0000-0000-0000-0000000000b1'''
\set po      '''00000000-0000-0000-0000-0000000000f3'''
\set hr      '''00000000-0000-0000-0000-0000000000f1'''

\echo '== who may manage registrations'
begin;
select pg_temp.act_as(:admin);
select pg_temp.denied($$select public.create_partner_registration('Sterling Education')$$, 'Admin Staff without the permission cannot create links', '%authorised administrators%');
select pg_temp.act_as(:po);
select pg_temp.denied($$select public.create_partner_registration('Sterling Education')$$, 'a Partnership Officer cannot create links', '%authorised administrators%');
select pg_temp.act_as(:hr);
select pg_temp.denied($$select public.create_partner_registration('Sterling Education')$$, 'HR cannot create links', '%authorised administrators%');
select pg_temp.act_as(:p1admin);
select pg_temp.denied($$select public.create_partner_registration('Sterling Education')$$, 'a partner cannot create links', '%authorised administrators%');
rollback;

\echo '== link creation (TEST A) and the public form (TEST B, C, K)'
begin;
select pg_temp.act_as(:super);
select public.create_partner_registration('Sterling Education', null, null, 14, 'Met at the Kochi fair') as created \gset
select (:'created'::jsonb ->> 'token') as tok, (:'created'::jsonb ->> 'id') as rid \gset
select pg_temp.check(:'tok' ~ '^[0-9a-f]{64}$', 'a 64-character random token is returned once');
select pg_temp.check((select token_hash <> :'tok' and token_hash = public.registration_token_hash(:'tok') and status = 'link_generated' and company_name = 'Sterling Education'
  from public.partner_registrations where id = :'rid'), 'only the hash of the token is stored; status Link generated');
select public.create_partner_registration('Sterling Education') ->> 'token' as tok_b \gset
select pg_temp.check(:'tok' <> :'tok_b', 'every link is different, even for the same company name');
select pg_temp.check(not exists (select 1 from public.partners where name = 'Sterling Education') and not exists (select 1 from public.profiles where full_name = 'Sterling Education'),
  'creating a link creates no partner and no account');
select pg_temp.trusted();
select pg_temp.check((public.registration_for_token(:'tok') ->> 'company_name') = 'Sterling Education', 'the link opens its own registration');
select pg_temp.check((public.registration_for_token(repeat('a', 64)) ->> 'state') = 'invalid', 'an unknown token is rejected');
select pg_temp.check((public.registration_for_token('not-a-token') ->> 'state') = 'invalid', 'a malformed token is rejected');
select public.save_registration_draft(:'tok', '{"contact_full_name":"Asha N","registered_email":"asha@sterling.test"}');
select pg_temp.check((select status = 'in_progress' and answers ->> 'contact_full_name' = 'Asha N' from public.partner_registrations where id = :'rid'), 'saving a draft marks it In progress');
select public.submit_partner_registration(:'tok', '{"contact_full_name":"Asha N","registered_email":"asha@sterling.test"}', 'v1', 'idem-1') as sub \gset
select pg_temp.check((select status = 'submitted' and submitted_at is not null and submission_count = 1 from public.partner_registrations where id = :'rid'), 'submission is stored as Submitted');
select pg_temp.check((select count(*) from public.notifications where user_id = :super and title = 'New partner registration') = 1, 'admins are notified (TEST C)');
select public.submit_partner_registration(:'tok', '{"contact_full_name":"Asha N"}', 'v1', 'idem-1') ->> 'duplicate' as dup \gset
select pg_temp.check(:'dup' = 'true' and (select count(*) from public.partner_registration_revisions where registration_id = :'rid') = 1, 'a retried submission creates nothing new (TEST M)');
select pg_temp.denied(format($$select public.submit_partner_registration(%L, '{}', 'v1', 'idem-2')$$, :'tok'), 'a submitted form cannot be submitted again', '%LINK_UNUSABLE%');
select pg_temp.denied(format($$select public.save_registration_draft(%L, '{}')$$, :'tok'), 'nor edited', '%LINK_UNUSABLE%');
select pg_temp.check((public.registration_for_token(:'tok') ->> 'state') = 'submitted' and (public.registration_for_token(:'tok') -> 'answers') is null,
  'after submitting, the link shows only the status — never the answers');
commit;

\echo '== who can see submissions'
begin; select pg_temp.act_as(:admin);
select pg_temp.check((select count(*) from public.partner_registrations) = 0, 'Admin Staff without the permission see nothing');
rollback;
begin; select pg_temp.act_as(:p1admin);
select pg_temp.check((select count(*) from public.partner_registrations) + (select count(*) from public.partner_registration_events) = 0, 'partners see nothing (TEST D)');
rollback;
begin; set local role anon;
select pg_temp.denied($$select count(*) from public.partner_registrations$$, 'anonymous visitors cannot read registrations', '%permission denied%');
select pg_temp.denied($$select public.registration_for_token(repeat('a', 64))$$, 'nor call the link functions directly', '%permission denied%');
rollback;
begin; select pg_temp.trusted();
update public.profiles set permissions = '{partners,partner_onboarding}' where id = :admin;
select pg_temp.act_as(:admin);
select pg_temp.check((select count(*) from public.partner_registrations where company_name = 'Sterling Education') = 2, 'Admin Staff with "Partner registrations" see them');
rollback;

\echo '== review: changes requested and corrected (TEST E, F)'
begin;
select id as rid from public.partner_registrations where status = 'submitted' and company_name = 'Sterling Education' \gset
select pg_temp.act_as(:po);
select pg_temp.denied(format($$select public.approve_registration(%L)$$, :'rid'), 'unauthorised staff cannot approve (TEST L)', '%authorised administrators%');
select pg_temp.act_as(:super);
select public.start_registration_review(:'rid');
select pg_temp.check((select status = 'in_review' and assigned_reviewer = :super from public.partner_registrations where id = :'rid'), 'review started, reviewer assigned');
select public.request_registration_changes(:'rid', 'Address incomplete', '{office_address,postal_code}', 'Please add the full street address') ->> 'token' as tok2 \gset
select pg_temp.check((select status = 'changes_requested' and change_request -> 'fields' ? 'office_address' from public.partner_registrations where id = :'rid'), 'changes requested with fields');
select pg_temp.trusted();
select pg_temp.check((public.registration_for_token(:'tok2') -> 'change_request' ->> 'reason') = 'Address incomplete', 'the new link opens the form with the request');
select pg_temp.check((public.registration_for_token(:'tok2') -> 'change_request' ->> 'by') is null, 'without revealing who asked');
select pg_temp.check((public.registration_for_token(:'tok2') -> 'answers' ->> 'contact_full_name') = 'Asha N', 'with the previous answers to correct');
select public.submit_partner_registration(:'tok2', '{"contact_full_name":"Asha N","office_address":"12 MG Road, Kochi"}', 'v1', 'idem-3');
select pg_temp.check((select status = 'submitted' and submission_count = 2 from public.partner_registrations where id = :'rid')
  and (select count(*) from public.partner_registration_revisions where registration_id = :'rid') = 2, 'corrected submission kept as revision 2; revision 1 preserved');
select pg_temp.check((select count(*) from public.notifications where user_id = :super and title = 'Partner registration corrected') = 1, 'admins are told about the correction');
commit;

\echo '== approval and provisioning (TEST H, M)'
begin;
select id as rid from public.partner_registrations where status = 'submitted' and company_name = 'Sterling Education' \gset
select pg_temp.act_as(:super);
select pg_temp.denied(format($$select public.begin_registration_provisioning(%L, %L)$$, :'rid', :super), 'provisioning hooks are not callable by users', '%permission denied%');
select public.approve_registration(:'rid', 'Good fit');
select pg_temp.check((select status = 'approved' and link_status = 'closed' and partner_id is null from public.partner_registrations where id = :'rid'), 'approval alone creates no partner');
select pg_temp.trusted();
select public.begin_registration_provisioning(:'rid', :super);
select pg_temp.denied(format($$select public.begin_registration_provisioning(%L, %L)$$, :'rid', :super), 'a second simultaneous attempt is refused', '%IN_PROGRESS%');
select public.release_registration_provisioning(:'rid', :super, 'Email already used');
select pg_temp.check((select status = 'approved' and provisioning_since is null from public.partner_registrations where id = :'rid'), 'a failed attempt keeps it Approved (not Activated)');
select public.begin_registration_provisioning(:'rid', :super);
insert into public.partners (id, name, code, contact_name, email, phone, city, status) values ('st-new', 'Sterling Education', 'STE', 'Asha N', 'asha@sterling.test', '+91 9999999999', 'Kochi', 'Active');
select public.finish_registration_provisioning(:'rid', 'st-new', null, :super);
select pg_temp.check((select status = 'activated' and partner_id = 'st-new' from public.partner_registrations where id = :'rid'), 'marked Activated and linked to the new partner');
select pg_temp.denied(format($$select public.begin_registration_provisioning(%L, %L)$$, :'rid', :super), 'it can never create a second partner', '%ALREADY_ACTIVATED%');
rollback;

\echo '== reject, revoke, expiry (TEST G, K)'
begin;
select pg_temp.act_as(:super);
select public.create_partner_registration('Other Agency') as c2 \gset
select (:'c2'::jsonb ->> 'token') as t2, (:'c2'::jsonb ->> 'id') as r2 \gset
select pg_temp.trusted();
select public.submit_partner_registration(:'t2', '{"contact_full_name":"X Y"}', 'v1', 'k');
select pg_temp.act_as(:super);
select pg_temp.denied(format($$select public.reject_registration(%L, '')$$, :'r2'), 'rejecting needs an internal reason', '%internal reason%');
select public.reject_registration(:'r2', 'Not a fit for our markets');
select pg_temp.check((select status = 'rejected' and link_status = 'closed' and reviewed_by = :super from public.partner_registrations where id = :'r2'), 'rejected, reviewer recorded, link closed');
select pg_temp.denied(format($$select public.approve_registration(%L)$$, :'r2'), 'a rejected registration cannot be approved', '%Only a submitted%');
select pg_temp.trusted();
select pg_temp.denied(format($$select public.begin_registration_provisioning(%L, %L)$$, :'r2', :super), 'nor activated (TEST G)', '%NOT_APPROVED%');
select pg_temp.act_as(:super);
select public.create_partner_registration('Third Agency') as c3 \gset
select (:'c3'::jsonb ->> 'token') as t3, (:'c3'::jsonb ->> 'id') as r3 \gset
select public.revoke_registration_link(:'r3', 'Sent to the wrong person');
select pg_temp.trusted();
select pg_temp.check((public.registration_for_token(:'t3') ->> 'state') = 'revoked', 'a revoked link is refused');
select pg_temp.denied(format($$select public.save_registration_draft(%L, '{}')$$, :'t3'), 'and cannot save', '%LINK_UNUSABLE%');
select pg_temp.act_as(:super);
select public.regenerate_registration_link(:'r3') ->> 'token' as t3b \gset
select pg_temp.trusted();
select pg_temp.check((public.registration_for_token(:'t3b') ->> 'state') = 'open' and (public.registration_for_token(:'t3') ->> 'state') = 'invalid', 'a regenerated link works; the old one no longer does');
update public.partner_registrations set link_expires_at = now() - interval '1 minute' where id = :'r3';
select pg_temp.check((public.registration_for_token(:'t3b') ->> 'state') = 'expired', 'an expired link is refused');
select pg_temp.check(public.registration_rate_hit('ip:test', 2, 60) and public.registration_rate_hit('ip:test', 2, 60) and not public.registration_rate_hit('ip:test', 2, 60), 'rate limit counts requests');
rollback;
