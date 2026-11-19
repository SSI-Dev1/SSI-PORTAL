-- Leads, student conversion, milestones, student activities, report v2, rollover and support escalation (0056).
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
-- today's figure of one report field, as the signed-in employee sees it on their own report
create or replace function pg_temp.m(emp text, k text) returns integer language sql as $$
  select case when emp::uuid = auth.uid() then (public.report_metrics('partner_success_officer', public.company_today()) -> k ->> 'value')::int end;
$$;

\set super '''00000000-0000-0000-0000-0000000000a1'''
\set mgr   '''00000000-0000-0000-0000-0000000000f2'''
\set app   '''00000000-0000-0000-0000-0000000000f4'''
\set ps1   '''00000000-0000-0000-0000-0000000000f5'''
\set ps2   '''00000000-0000-0000-0000-0000000000f6'''

\echo '== TEST 1 / 2: Partner Success Officers get Lead Management by designation'
-- the statement 0056 runs for existing accounts (fixtures were created after the migrations ran)
update public.profiles p set permissions = array_append(p.permissions, 'leads')
from public.employees e
where e.id = p.id and e.designation_id = 'partner_success_officer' and p.permissions is not null
  and p.role not in ('super_admin', 'admin_staff') and not ('leads' = any (p.permissions));
select pg_temp.check((select bool_and('leads' = any (permissions)) from public.profiles where id in (:ps1, :ps2)), 'both PSO accounts have Lead Management');
select pg_temp.check((select 'leads' = any (default_permissions) from public.designations where id = 'partner_success_officer'), 'future PSOs get it through the designation');
select pg_temp.check((select max(version) = 2 from public.report_templates where id = 'partner_success_officer'), 'PSO report template v2 is the current one');
select pg_temp.check((select sections::text like '%lm_no_response%' and sections::text like '%ap_cas_received%' and sections::text like '%tk_pending_tasks%'
  from public.report_templates where id = 'partner_success_officer' and version = 2), 'v2 has No response, CAS received and pending tasks');
select pg_temp.check((select count(*) = 1 from public.report_templates where id = 'partner_success_officer' and version = 1), 'v1 kept for reports already filed');
begin; select pg_temp.act_as(:app);
select pg_temp.check(not public.lead_access(), 'application team without the permission: no Lead Management');
select pg_temp.denied($$select public.save_lead(null, '{"name":"Nope"}', gen_random_uuid())$$, 'and cannot add leads', '%Not allowed%');
commit;

\echo '== TEST 3: new lead (name + phone only) is Pending and counts as a new lead once'
begin; select pg_temp.act_as(:ps1);
select (public.save_lead(null, '{"name":"Dan Kumar","phone":"+91 98470 11111","qualification":"BTech","application_details":"MSc Data Science, Sep intake"}',
        'aaaaaaaa-0000-4000-8000-000000000001') ->> 'id') as dan \gset
select pg_temp.check((public.save_lead(null, '{"name":"Dan Kumar"}', 'aaaaaaaa-0000-4000-8000-000000000001') ->> 'duplicate')::boolean, 'a double click returns the same lead');
select pg_temp.check((select reference like 'LD-%' and contact_status = 'unknown' and stage = 'cold' and partner_id is null and source = 'direct'
  and assigned_to = :ps1::uuid and public.lead_queue(stage, contact_status, no_response) = 'pending' from public.leads where id = :'dan'),
  'LD reference, Not recorded, Cold, Direct, assigned to the creator, queue Pending');
select pg_temp.check(pg_temp.m(:ps1, 'lm_new_leads') = 1 and pg_temp.m(:ps1, 'lm_leads_counselled') = 0 and pg_temp.m(:ps1, 'lm_pending_leads') = 1,
  'New leads received 1; Assigned leads contacted 0; Pending leads 1');
select pg_temp.denied($$select public.save_lead(null, '{"name":"Dan Again","phone":"+91-9847011111"}', gen_random_uuid())$$,
  'the same phone number cannot become a second lead', 'DUPLICATE:%LD-%');
commit;

\echo '== TEST 6 / 5: Not connected stays Pending; contact attempts count, never connect'
begin; select pg_temp.act_as(:ps1);
select public.set_lead_contact_status(:'dan', 'not_connected', null, gen_random_uuid());
select pg_temp.check((select public.lead_queue(stage, contact_status, no_response) = 'pending' from public.leads where id = :'dan'), 'Not connected: still Pending (TEST 6)');
select pg_temp.denied($$select public.log_lead_activity('$$ || :'dan' || $$', 'contact_attempt', null, null, null, gen_random_uuid())$$, 'an attempt needs an outcome', '%outcome%');
select public.log_lead_activity(:'dan', 'contact_attempt', 'no_answer', 'Rang twice', null, gen_random_uuid());
select public.log_lead_activity(:'dan', 'contact_attempt', 'busy', null, null, 'aaaaaaaa-0000-4000-8000-000000000002');
select public.log_lead_activity(:'dan', 'contact_attempt', 'busy', null, null, 'aaaaaaaa-0000-4000-8000-000000000002');
select pg_temp.check(pg_temp.m(:ps1, 'lm_contact_attempts') = 2, 'two attempts logged = 2 (a repeated request adds nothing) (TEST 5)');
select pg_temp.check((select contact_status = 'not_connected' from public.leads where id = :'dan'), 'contact status unchanged by attempts');
select pg_temp.denied($$select public.set_lead_contact_status('$$ || :'dan' || $$', 'unknown', null, gen_random_uuid())$$, 'Not connected cannot go back to Not recorded', '%Super Admin%');
commit;

\echo '== TEST 7: No Response'
begin; select pg_temp.act_as(:ps1);
select public.log_lead_activity(:'dan', 'no_response', null, 'No reply on WhatsApp either', null, gen_random_uuid());
select pg_temp.check((select no_response and public.lead_queue(stage, contact_status, no_response) = 'no_response' and stage = 'cold' from public.leads where id = :'dan'),
  'lead moves to No response, stays Cold (not Closed), record kept');
select pg_temp.check(pg_temp.m(:ps1, 'lm_pending_leads') = 0 and pg_temp.m(:ps1, 'lm_no_response') = 1, 'Pending 0, No response 1 — one queue per lead');
select pg_temp.check((select count(*) = 2 from public.lead_activities where lead_id = :'dan' and kind = 'contact_attempt'), 'attempt history kept');
commit;

\echo '== TEST 4: Connected counts once'
begin; select pg_temp.act_as(:ps1);
select public.set_lead_contact_status(:'dan', 'connected', null, gen_random_uuid());
select public.set_lead_contact_status(:'dan', 'connected', null, gen_random_uuid());
select pg_temp.check(pg_temp.m(:ps1, 'lm_leads_counselled') = 1, 'Assigned leads contacted = 1 after selecting Connected twice');
select pg_temp.check((select not no_response and public.lead_queue(stage, contact_status, no_response) = 'in_progress' from public.leads where id = :'dan'),
  'Connected clears No response: In progress');
select pg_temp.denied($$select public.set_lead_contact_status('$$ || :'dan' || $$', 'not_connected', 'x', gen_random_uuid())$$, 'an officer cannot undo Connected', '%Super Admin%');
select public.log_lead_activity(:'dan', 'call_done', 'information_shared', 'Explained UK options', null, gen_random_uuid());
select pg_temp.check(pg_temp.m(:ps1, 'lm_calls_done') = 1, 'Call done counted');
select public.log_lead_activity(:'dan', 'note', null, 'Prefers Manchester', null, gen_random_uuid());
select pg_temp.check(pg_temp.m(:ps1, 'lm_calls_done') + pg_temp.m(:ps1, 'lm_contact_attempts') + pg_temp.m(:ps1, 'lm_student_followups') = 3, 'a note adds to no figure');
commit;

\echo '== follow-ups: add, complete, Tomorrow''s Plan'
begin; select pg_temp.act_as(:ps1);
select public.add_lead_follow_up(:'dan', public.company_today(), '15:00', 'Send course list', 'aaaaaaaa-0000-4000-8000-000000000003') as t1 \gset
select pg_temp.check(public.add_lead_follow_up(:'dan', public.company_today(), '15:00', 'Send course list', 'aaaaaaaa-0000-4000-8000-000000000003') = :'t1'::uuid, 'Add follow-up is idempotent');
select pg_temp.denied($$select public.add_lead_follow_up('$$ || :'dan' || $$', public.company_today() - 1, null, null, gen_random_uuid())$$, 'no follow-ups in the past', '%past%');
select pg_temp.check(pg_temp.m(:ps1, 'tk_pending_tasks') = 1, 'pending follow-up task: 1');
select pg_temp.check((select jsonb_array_length(public.my_pending_work() -> 'leads') = 1), 'it is in the work queue / report pending list');
select public.log_lead_activity(:'dan', 'follow_up_done', null, 'Sent', :'t1', gen_random_uuid());
select pg_temp.check((select status = 'done' and completed_by = :ps1::uuid from public.lead_tasks where id = :'t1'), 'Follow-up done resolves the task');
select pg_temp.check(pg_temp.m(:ps1, 'lm_student_followups') = 1 and pg_temp.m(:ps1, 'tk_pending_tasks') = 0, 'Student follow-ups 1; pending tasks 0');
select pg_temp.denied($$select public.log_lead_activity('$$ || :'dan' || $$', 'follow_up_done', null, null, '$$ || :'t1' || $$', gen_random_uuid())$$, 'a completed follow-up cannot be completed again', '%already completed%');
select public.add_lead_follow_up(:'dan', (public.my_pending_work() ->> 'next_day')::date, '10:30', 'Call about documents', gen_random_uuid()) as t2 \gset
select pg_temp.check((select jsonb_array_length(r -> 'tomorrow') = 1 and r -> 'tomorrow' -> 0 ->> 'title' like 'Lead follow-up · Dan Kumar' from public.my_pending_work() r),
  'Tomorrow''s Plan lists the next working day''s follow-up automatically');
commit;

\echo '== TEST 20: an incomplete follow-up carries over once, never duplicated'
begin; select pg_temp.act_as(:ps1);
select public.add_lead_follow_up(:'dan', public.company_today(), null, 'Check passport', gen_random_uuid()) as t3 \gset
commit;
select public.rollover_pending_work(public.company_today());
select public.rollover_pending_work(public.company_today());
select pg_temp.check((select carry_count = 1 and status = 'open' and due_date = public.company_today() and assigned_to = :ps1::uuid
  and carried_over_to = public.next_working_day(:ps1::uuid, public.company_today()) from public.lead_tasks where id = :'t3'),
  'same task, original due date and employee kept, carried to the next working day once');
select pg_temp.check((select count(*) = 3 from public.lead_tasks where lead_id = :'dan'), 'no task was recreated');
select pg_temp.check((select carry_count = 0 from public.lead_tasks where id = :'t1'), 'a completed task is never carried');

\echo '== Change Stage'
begin; select pg_temp.act_as(:ps1);
select pg_temp.denied($$select public.set_lead_stage('$$ || :'dan' || $$', 'converted', null, gen_random_uuid())$$, 'Converted cannot be chosen by hand', '%Move to Student List%');
select public.set_lead_stage(:'dan', 'warm', null, gen_random_uuid());
select pg_temp.denied($$select public.set_lead_stage('$$ || :'dan' || $$', 'closed', null, gen_random_uuid())$$, 'closing needs a reason', '%reason%');
select (public.save_lead(null, '{"name":"Riya Thomas","email":"riya@lead.test","partner_id":"ps-st"}', gen_random_uuid()) ->> 'id') as riya \gset
select public.set_lead_stage(:'riya', 'closed', 'Joined another agency', gen_random_uuid());
select pg_temp.check(pg_temp.m(:ps1, 'lm_leads_closed') = 1, 'Closed counted');
select public.set_lead_stage(:'riya', 'warm', 'Came back', gen_random_uuid());
select pg_temp.check(pg_temp.m(:ps1, 'lm_leads_closed') = 0, 'reopened the same day: the Closed count is reversed');
select pg_temp.check((select count(*) = 2 from public.lead_activities where lead_id = :'riya' and kind = 'stage'), 'both stage changes kept in history');
commit;

\echo '== TEST 8 / 9: Move to Student List (Direct)'
begin; select pg_temp.act_as(:ps1);
select (select count(*) from public.students) as students_before \gset
select pg_temp.denied($$select public.convert_lead_to_student('$$ || :'dan' || $$', '{}', gen_random_uuid())$$, 'no email: the missing details are asked for', 'MISSING:%email%');
select pg_temp.check((select stage = 'warm' and student_id is null from public.leads where id = :'dan'), 'a failed move leaves the lead unconverted');
select public.convert_lead_to_student(:'dan', '{"email":"dan.k@lead.test"}', gen_random_uuid()) as conv \gset
select pg_temp.check((select s.partner_id = 'direct' and s.first_name = 'Dan' and s.last_name = 'Kumar' and s.lead_id = :'dan'::uuid and s.qualification = 'BTech'
  from public.students s where s.id = (:'conv'::jsonb ->> 'student_id')), 'student created under agent Direct with the lead''s details and reference (TEST 9)');
select pg_temp.check((select stage = 'converted' and student_id = (:'conv'::jsonb ->> 'student_id') and converted_by = :ps1::uuid from public.leads where id = :'dan'),
  'lead Converted only after the student was saved');
select pg_temp.check((public.convert_lead_to_student(:'dan', '{}', gen_random_uuid()) ->> 'already')::boolean, 'moving again returns the same student');
select pg_temp.check((select count(*) from public.students) = :students_before + 1, 'exactly one student created');
select pg_temp.check(pg_temp.m(:ps1, 'lm_leads_converted') = 1 and pg_temp.m(:ps1, 'lm_new_leads') = 2, 'Leads converted 1; the new student is not counted as another new lead');
select pg_temp.check((select count(*) = 0 from public.lead_tasks where lead_id = :'dan' and status = 'open'), 'open follow-ups of a converted lead are closed');
select pg_temp.denied($$select public.set_lead_stage('$$ || :'dan' || $$', 'cold', null, gen_random_uuid())$$, 'a converted lead cannot change stage', '%Student List%');
commit;

\echo '== partner lead: link the existing student, never duplicate or re-attribute'
begin; select pg_temp.act_as(:ps1);
select (public.save_lead(null, '{"name":"S One","email":"s1@ps.test","partner_id":"ps-st"}', gen_random_uuid()) ->> 'id') as l1 \gset
select public.convert_lead_to_student(:'l1', '{}', gen_random_uuid()) as c1 \gset
select pg_temp.check((:'c1'::jsonb ->> 'student_id') = 'pss1' and (:'c1'::jsonb ->> 'linked')::boolean, 'same email under the same agent: existing student linked');
select (public.save_lead(null, '{"name":"S Nine","email":"s9@ps.test","partner_id":"ps-st"}', gen_random_uuid()) ->> 'id') as l9 \gset
select pg_temp.denied($$select public.convert_lead_to_student('$$ || :'l9' || $$', '{}', gen_random_uuid())$$, 'same email under another agent: stopped', 'DUPLICATE:%Beta PS%');
select pg_temp.check((select partner_id = 'ps-be' from public.students where id = 'pss9'), 'the other agent''s student is untouched');
commit;

\echo '== TEST 10 / 15: application from the converted lead'
insert into public.applications (id, ref, student_id, partner_id, university_id, course_id, intake, status, created_by, assigned_to)
select 'lda1', 'LDA1', s.id, s.partner_id, 'ups', 'cps', 'Sep 2026', 'Draft', :ps1, :ps1 from public.students s where s.lead_id = :'dan';
select pg_temp.check((select count(*) = 1 from public.lead_activities where lead_id = :'dan' and kind = 'application' and detail ->> 'application_id' = 'lda1'),
  'the application appears in the lead history');

\echo '== TEST 17: deposit and CAS milestones, once each'
begin; select pg_temp.act_as(:ps1);
select public.set_application_milestone('lda1', 'deposit', 'requested', null);
select public.set_application_milestone('lda1', 'deposit', 'paid', 'Receipt seen');
select pg_temp.check((public.set_application_milestone('lda1', 'deposit', 'paid', null) ->> 'unchanged')::boolean, 'saving Paid again changes nothing');
select public.set_application_milestone('lda1', 'cas', 'requested', null);
select public.set_application_milestone('lda1', 'cas', 'issued', null);
select pg_temp.check(pg_temp.m(:ps1, 'ap_tuition_deposits') = 2 and pg_temp.m(:ps1, 'ap_deposits_completed') = 1
  and pg_temp.m(:ps1, 'ap_cas_followups') = 1 and pg_temp.m(:ps1, 'ap_cas_received') = 1, 'deposit updates 2, completed 1, CAS progress 1, CAS received 1');
select public.set_application_milestone('lda1', 'deposit', 'requested', 'Refund issue');
select public.set_application_milestone('lda1', 'deposit', 'paid', null);
select pg_temp.check(pg_temp.m(:ps1, 'ap_deposits_completed') = 1 and pg_temp.m(:ps1, 'ap_tuition_deposits') = 2, 'going back and forth adds no duplicate milestone');
select pg_temp.check((select count(*) = 6 from public.application_milestones where application_id = 'lda1'), 'every change kept in the milestone history');
select pg_temp.denied($$select public.set_application_milestone('lda1', 'deposit', 'lost', null)$$, 'unknown milestone values rejected', '%Unknown%');
commit;
begin; select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select pg_temp.denied($$select public.set_application_milestone('lda1', 'cas', 'issued', null)$$, 'partner users cannot set milestones', '%Not allowed%');
commit;

\echo '== TEST 16 / 18: offer and visa come from status changes'
begin; select pg_temp.act_as(:ps1);
update public.applications set status = 'Conditional Offer' where id = 'lda1';
update public.applications set status = 'Visa Lodged' where id = 'lda1';
select pg_temp.check(pg_temp.m(:ps1, 'ap_offers') = 1 and pg_temp.m(:ps1, 'ap_visa_updates') = 1 and pg_temp.m(:ps1, 'ap_visa_success') = 0,
  'Offer received 1; visa update 1; no visa success until Visa Granted');
update public.applications set status = 'Visa Granted' where id = 'lda1';
select pg_temp.check(pg_temp.m(:ps1, 'ap_visa_success') = 1 and pg_temp.m(:ps1, 'ap_visa_updates') = 2, 'Visa Granted: success 1');
commit;

\echo '== TEST 13 / 19: Log Student Activity'
begin; select pg_temp.act_as(:ps1);
select public.log_student_activity('pss1', null, 'course_options', null, 'Shared 1 option', '[{"university_id":"ups","course_id":"cps"}]', null, gen_random_uuid());
select pg_temp.check((select detail -> 'options' -> 0 ->> 'course_id' = 'cps' from public.student_activities where student_id = 'pss1' and kind = 'course_options'),
  'options stored under the student (TEST 13)');
select pg_temp.check(pg_temp.m(:ps1, 'ps_options_suggested') = 1, 'options suggested: 1');
select pg_temp.denied($$select public.log_student_activity('pss1', null, 'course_options', null, null, '[{"university_id":"ups","course_id":"nope"}]', null, gen_random_uuid())$$,
  'a course must belong to the university', '%does not belong%');
select pg_temp.denied($$select public.log_student_activity('pss1', 'lda1', 'offer_followup', 'completed', null, null, null, gen_random_uuid())$$,
  'the application must belong to the student', '%does not belong%');
select (select id from public.students where lead_id = :'dan') as dan_student \gset
select public.log_student_activity(:'dan_student', 'lda1', 'offer_followup', 'pending', 'Waiting for the student', null, null, gen_random_uuid());
select pg_temp.check(pg_temp.m(:ps1, 'ap_offer_followups') = 0, 'a pending offer follow-up is not counted as completed');
select public.log_student_activity(:'dan_student', 'lda1', 'offer_followup', 'completed', 'Accepted the offer', null, public.company_today(), gen_random_uuid());
select pg_temp.check(pg_temp.m(:ps1, 'ap_offer_followups') = 1, 'completed offer follow-up: 1 (TEST 19)');
select public.log_student_activity(:'dan_student', 'lda1', 'case_closed', 'completed', 'Enrolled', null, null, gen_random_uuid());
select public.log_student_activity(:'dan_student', 'lda1', 'case_closed', 'completed', 'Again', null, null, gen_random_uuid());
select pg_temp.check((select count(*) = 1 from public.work_activities where activity_type = 'case_closed' and application_id = 'lda1' and voided_at is null), 'a case is closed once');
select pg_temp.check((select status = 'Visa Granted' from public.applications where id = 'lda1'), 'logging the closure does not change the application status');
commit;

\echo '== TEST 11 / 14: partner query and training (own clients only)'
begin; select pg_temp.act_as(:super); select public.assign_partner_sub_officer('ps-st', :ps1::uuid, 'portfolio'); commit;
begin; select pg_temp.act_as(:ps1);
select pg_temp.m(:ps1, 'ps_training_sessions') as tr0, pg_temp.m(:ps1, 'ps_partner_queries') as q0 \gset
select public.log_client_activity('p:ps-st', 'training', 'pending', 'Scheduled for Friday', null, gen_random_uuid());
select pg_temp.check(pg_temp.m(:ps1, 'ps_training_sessions') = :tr0, 'a scheduled (pending) training is not counted as conducted');
select public.log_client_activity('p:ps-st', 'training', 'completed', 'Visa documentation session', null, gen_random_uuid());
select public.log_client_activity('p:ps-st', 'query', null, 'Asked about Jan intake', null, gen_random_uuid());
select pg_temp.check(pg_temp.m(:ps1, 'ps_training_sessions') = :tr0 + 1 and pg_temp.m(:ps1, 'ps_partner_queries') = :q0 + 1, 'training +1, partner query +1');
select pg_temp.check((select partner_id = 'ps-st' from public.work_activities where activity_type = 'partner_query' and employee_id = :ps1::uuid order by id desc limit 1),
  'the query is attributed to the selected agent (TEST 11)');
select pg_temp.denied($$select public.log_client_activity('p:ps-be', 'query', null, 'x', null, gen_random_uuid())$$, 'not on an unrelated agency', '%own clients%');
commit;

\echo '== TEST 24: access'
begin; select pg_temp.act_as(:ps2);
select (public.save_lead(null, '{"name":"Zara Ali","phone":"+44 7700 900123"}', gen_random_uuid()) ->> 'id') as zara \gset
select pg_temp.check((select count(*) from public.leads where id in (:'dan', :'riya')) = 0, 'another officer cannot see these leads');
select pg_temp.denied($$select public.set_lead_stage('$$ || :'riya' || $$', 'cold', null, gen_random_uuid())$$, 'or change them', '%Not allowed%');
select pg_temp.check(pg_temp.m(:ps2, 'lm_new_leads') = 1, 'each officer is credited only with their own work (PSO 2: 1; PSO 1 stays 2 above)');
commit;
begin; select pg_temp.act_as(:mgr);
select pg_temp.check((select count(*) from public.leads where id = :'zara') = 1 and (select count(*) from public.leads where id = :'dan') = 0,
  'the team manager sees the team member''s lead, not other teams''');
commit;
begin; select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select count(*) from public.leads) = 0 and (select count(*) from public.lead_activities) = 0 and (select count(*) from public.student_activities) = 0,
  'partner users see no leads or staff activity');
commit;

\echo '== Direct agent is never a client'
select pg_temp.check((select internal and not portal_enabled and status = 'Onboarding' from public.partners where id = 'direct'), 'Direct: internal, no portal');
begin; select pg_temp.act_as(:super);
select pg_temp.check(not exists (select 1 from public.onboarded_client_directory() where partner_id = 'direct'), 'not in the onboarded client directory');
select pg_temp.check(not exists (select 1 from public.partner_directory_status() where partner_id = 'direct'), 'not in the partner directory');
commit;

\echo '== TEST 21: report figures and timeline'
begin; select pg_temp.act_as(:ps1);
select pg_temp.check((select count(*) >= 10 and bool_and(entity_name is not null) from public.my_work_timeline(public.company_today()) where entity_type in ('lead', 'student')),
  'Time / Action done rows name the lead or student');
select pg_temp.check((select string_agg(label, '|' order by occurred_at, id) like 'New lead added%' from public.my_work_timeline(public.company_today()) where entity_type = 'lead'),
  'in time order, starting with the new lead');
commit;

\echo '== TEST 23: support request escalation'
begin; select pg_temp.act_as(:ps2);
select public.raise_support_request('Need access to the UCAS portal', 'For two applications', 'aaaaaaaa-0000-4000-8000-000000000009') as sr \gset
select pg_temp.check((select manager_id = :mgr::uuid and status = 'open' from public.support_requests where id = :'sr'), 'request saved with the reporting manager');
select pg_temp.check((select jsonb_array_length(public.my_pending_work() -> 'support') = 1), 'shown in the employee''s report');
commit;
select pg_temp.check(public.escalate_support_requests() = 0, 'no escalation while no rule is configured');
begin; select pg_temp.act_as(:ps2);
select pg_temp.denied($$select public.set_support_escalation_hours(4)$$, 'only a Super Admin sets the rule', '%Super Admin%');
commit;
begin; select pg_temp.act_as(:super); select public.set_support_escalation_hours(4); commit;
update public.support_requests set created_at = now() - interval '5 hours' where id = :'sr';
select (select count(*) from public.notifications where user_id = :mgr::uuid) as notes_before \gset
select pg_temp.check(public.escalate_support_requests() = 1, 'open for 5 hours with a 4-hour rule: escalated');
select pg_temp.check(public.escalate_support_requests() = 0, 'never escalated twice');
select pg_temp.check((select escalated_to = array[:mgr::uuid] and escalated_at is not null and status = 'open' from public.support_requests where id = :'sr'),
  'escalated to the team manager; the request stays open');
select pg_temp.check((select count(*) from public.notifications where user_id = :mgr::uuid) = :notes_before + 1, 'the manager is notified once');
begin; select pg_temp.act_as(:ps1);
select pg_temp.check((select count(*) from public.support_requests where id = :'sr') = 0, 'another officer cannot see it');
select pg_temp.denied($$select public.resolve_support_request('$$ || :'sr' || $$', 'resolved', 'done')$$, 'or resolve it', '%team manager%');
commit;
begin; select pg_temp.act_as(:mgr);
select pg_temp.denied($$select public.resolve_support_request('$$ || :'sr' || $$', 'resolved', null)$$, 'resolving needs a note', '%resolved%');
select public.resolve_support_request(:'sr', 'resolved', 'Access granted');
select pg_temp.check((select status = 'resolved' and resolved_by = :mgr::uuid from public.support_requests where id = :'sr'), 'manager resolves it');
select pg_temp.check((select count(*) = 3 from public.support_request_events where request_id = :'sr'), 'raised, escalated and resolved are audited');
commit;
begin; select pg_temp.act_as(:super); select public.set_support_escalation_hours(null); commit;
