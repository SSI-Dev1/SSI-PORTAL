-- Complete Historical Onboarding in one step, with the existing MOU attached (26 Nov 2026). Safe to run
-- more than once.
--
-- For agencies that were partners before the CRM (the records imported from the old sheet): an
-- authorised person (Super Admin, or Admin Staff with "Partner registrations" — can_manage_registrations)
-- opens the agency, attaches the MOU / partnership agreement already exchanged by email, confirms, and is
-- done. There is no request → approve round, no partner search, no registration form, proposal, invitation,
-- re-signing, login, password or email.
--
-- complete_historical_onboarding() does it all in ONE transaction:
--   permission → eligibility (historical record, not going through the new registration) → the uploaded
--   file exists in the private store under this agency → document recorded (agency, client record,
--   type, uploader, time, original filename, version, storage path) → agency Onboarded with the historical
--   approval recorded (who, when, original date, email reference, notes) → client record reused or created
--   (0064 sync, client_reconcile_plan). If the client record cannot be settled (ambiguous match), the whole
--   action is rolled back and the specific reason is returned as an error — nothing is half-done and no
--   generic "pending approval" is created.
--   Already onboarded: the MOU is attached to the existing record; onboarding is not restarted.
--   New agencies (created in the CRM, not imported) are refused: they follow the normal registration,
--   agreement and approval. Proposal Sent / MOU Sent / Closed records keep their stage until someone
--   authorised completes this action for them.
--   No Daily Work Report activity: a historical record is not today's new partner.
--
-- Documents: private bucket "agency-documents" (PDF only, 15 MB), path "<agency id>/<file>.pdf". Read by
-- SSI GLOBAL staff who can see the agency (signed, short-lived links), never by partner logins.

-- =============================================================== storage + document records
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('agency-documents', 'agency-documents', false, 15728640, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.agency_documents (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agency_prospects (id) on delete cascade,
  partner_id    text references public.partners (id) on delete set null,
  kind          text not null default 'historical_mou' check (kind in ('historical_mou')),
  file_name     text not null check (char_length(file_name) between 1 and 255),
  storage_path  text not null unique,
  size_bytes    bigint check (size_bytes is null or size_bytes between 1 and 15728640),
  version       integer not null default 1,
  uploaded_by   uuid references auth.users (id) on delete set null,
  uploaded_at   timestamptz not null default now(),
  request_id    uuid unique
);
create index if not exists agency_documents_agency_idx on public.agency_documents (agency_id, kind, version desc);
alter table public.agency_documents enable row level security;
revoke all on public.agency_documents from anon, authenticated;
grant select on public.agency_documents to authenticated;
drop policy if exists "agency documents: staff read" on public.agency_documents;
create policy "agency documents: staff read" on public.agency_documents for select to authenticated
  using ((select public.is_staff()) and public.agency_can_see(agency_id));

drop policy if exists "agency documents storage: upload" on storage.objects;
create policy "agency documents storage: upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'agency-documents' and public.can_manage_registrations()
  and exists (select 1 from public.agency_prospects a where a.id::text = (storage.foldername(name))[1]));
drop policy if exists "agency documents storage: read" on storage.objects;
create policy "agency documents storage: read" on storage.objects for select to authenticated using (
  bucket_id = 'agency-documents' and public.is_staff()
  and exists (select 1 from public.agency_prospects a where a.id::text = (storage.foldername(name))[1] and public.agency_can_see(a.id)));
-- An upload that was never recorded (e.g. the action was cancelled) can be removed by an authorised
-- person; a recorded MOU only by a Super Admin.
drop policy if exists "agency documents storage: delete" on storage.objects;
create policy "agency documents storage: delete" on storage.objects for delete to authenticated using (
  bucket_id = 'agency-documents' and (public.is_super_admin()
    or (public.can_manage_registrations() and not exists (select 1 from public.agency_documents d where d.storage_path = objects.name))));

-- Eligible for historical onboarding: a record that existed before the CRM (imported) or is already
-- marked historical, and is not going through the new registration.
create or replace function public.historical_eligibility(p_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when a.id is null then 'Agency not found'
    when not coalesce(a.source = 'import' or a.historical_onboarded or a.onboarding_type = 'historical', false)
      then 'This agency was created in the CRM — it follows the normal proposal, registration, agreement and approval'
    when coalesce(g.status in ('submitted', 'in_review', 'approved', 'activated'), false) and a.partner_id is null
      then 'This agency is going through the new registration process — finish it there'
    else null end
  from (select p_id as id) x
  left join public.agency_prospects a on a.id = x.id
  left join public.partner_registrations g on g.id = a.registration_id;
$$;
revoke all on function public.historical_eligibility(uuid) from public, anon;
grant execute on function public.historical_eligibility(uuid) to authenticated;

-- =============================================================== the one-step action
create or replace function public.complete_historical_onboarding(p_id uuid, p_path text, p_file_name text, p_size bigint,
                                                                 p_confirm boolean, p_original_date date default null,
                                                                 p_email_ref text default null, p_notes text default null,
                                                                 p_request uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; blocked text; ver int; plan jsonb; pid text; prev_stage text; already boolean; doc uuid;
begin
  if not public.can_manage_registrations() then raise exception 'Only authorised administrators can complete historical onboarding'; end if;
  if p_request is not null and exists (select 1 from public.agency_documents d where d.request_id = p_request) then
    -- the same click arriving twice: return what was done
    select partner_id into pid from public.agency_prospects where id = p_id;
    return jsonb_build_object('status', 'repeat', 'partner_id', pid, 'partner_name', (select name from public.partners where id = pid));
  end if;
  perform pg_advisory_xact_lock(hashtext('historical-onboarding'));
  select * into a from public.agency_prospects where id = p_id for update;
  blocked := public.historical_eligibility(p_id);
  if blocked is not null then raise exception '%', blocked; end if;
  if a.stage = 'onboarded' and a.historical_status is distinct from 'approved' and a.registration_id is not null and a.partner_id is not null then
    raise exception 'This agency was onboarded through the new registration — attach documents there';
  end if;
  if not coalesce(p_confirm, false) then raise exception 'Confirm that this agency was previously approved and onboarded'; end if;
  if p_original_date is not null and p_original_date > public.company_today() then raise exception 'The original partnership date cannot be in the future'; end if;
  if char_length(coalesce(p_email_ref, '')) > 500 or char_length(coalesce(p_notes, '')) > 2000 then raise exception 'The email reference or notes are too long'; end if;
  -- The MOU: required, a PDF in this agency's private folder, uploaded just now.
  if p_path is null or (storage.foldername(p_path))[1] is distinct from p_id::text or lower(p_path) !~ '\.pdf$' then
    raise exception 'Attach the existing MOU or partnership agreement (PDF)';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'agency-documents' and o.name = p_path) then
    raise exception 'The MOU upload did not finish — attach the file again';
  end if;
  if exists (select 1 from public.agency_documents d where d.storage_path = p_path) then raise exception 'This file is already recorded'; end if;
  if char_length(btrim(coalesce(p_file_name, ''))) = 0 or lower(p_file_name) !~ '\.pdf$' then raise exception 'Only PDF files are accepted'; end if;
  if p_size is not null and (p_size < 1 or p_size > 15728640) then raise exception 'The file must be a PDF up to 15 MB'; end if;

  perform set_config('ssi.historical_reconciliation', 'on', true);   -- a historical record, not today's work
  already := a.stage = 'onboarded';
  prev_stage := a.stage;
  if not already then
    update public.agency_prospects set stage = 'onboarded', stage_changed_by = auth.uid(), stage_changed_at = now(),
      onboarding_type = 'historical', historical_onboarded = true, historical_status = 'approved',
      historical_reviewed_by = auth.uid(), historical_reviewed_at = now(),
      historical_reason = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), 'Historical onboarding completed with the existing MOU'),
      historical_evidence = coalesce(nullif(btrim(coalesce(p_email_ref, '')), ''), historical_evidence),
      historical_original_date = coalesce(p_original_date, historical_original_date), needs_reconciliation = false, updated_at = now()
    where id = p_id;
  else
    -- Already onboarded: keep the onboarding as it is; record the evidence only where it was missing.
    update public.agency_prospects set onboarding_type = coalesce(onboarding_type, 'historical'), historical_onboarded = true,
      historical_status = case when historical_status is null or historical_status in ('requested', 'flagged') then 'approved' else historical_status end,
      historical_reviewed_by = coalesce(historical_reviewed_by, auth.uid()), historical_reviewed_at = coalesce(historical_reviewed_at, now()),
      historical_reason = coalesce(historical_reason, nullif(btrim(coalesce(p_notes, '')), ''), 'Historical onboarding completed with the existing MOU'),
      historical_evidence = coalesce(historical_evidence, nullif(btrim(coalesce(p_email_ref, '')), '')),
      historical_original_date = coalesce(historical_original_date, p_original_date), updated_at = now()
    where id = p_id;
  end if;
  -- Client record: the 0064 trigger ran on the stage change; settle it here for every case and refuse if
  -- it is ambiguous (rolls everything back with the reason).
  select partner_id into pid from public.agency_prospects where id = p_id;
  if pid is null then
    plan := public.sync_onboarded_agency_client(p_id, 'Historical onboarding completed with the existing MOU');
    if plan ->> 'status' not in ('created', 'linked', 'already') then
      raise exception 'Not completed: %', coalesce(plan ->> 'reason', 'the client record could not be settled');
    end if;
    pid := plan ->> 'partner_id';
  end if;
  select coalesce(max(version), 0) + 1 into ver from public.agency_documents where agency_id = p_id and kind = 'historical_mou';
  insert into public.agency_documents (agency_id, partner_id, kind, file_name, storage_path, size_bytes, version, uploaded_by, request_id)
  values (p_id, pid, 'historical_mou', btrim(p_file_name), p_path, p_size, ver, auth.uid(), p_request)
  returning id into doc;
  perform public.agency_log(p_id, case when already then 'historical_mou_attached' else 'historical_approved' end,
    coalesce(nullif(btrim(coalesce(p_notes, '')), ''), 'Historical onboarding completed with the existing MOU'),
    jsonb_build_object('from', prev_stage, 'to', 'onboarded', 'document', btrim(p_file_name), 'version', ver, 'original_date', p_original_date,
                       'email_reference', nullif(btrim(coalesce(p_email_ref, '')), ''), 'partner_id', pid));
  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, partner_id, changes)
  values (auth.uid(), case when public.is_super_admin() then 'super_admin' else 'partner_onboarding' end, 'historical_onboarding_completed',
          'agency_prospects', p_id::text, pid, jsonb_build_object('reference', a.reference, 'name', a.company_name, 'from', prev_stage,
          'document', btrim(p_file_name), 'version', ver, 'already_onboarded', already));
  perform set_config('ssi.historical_reconciliation', '', true);
  return jsonb_build_object('status', case when already then 'attached' else 'completed' end, 'partner_id', pid,
                            'partner_name', (select name from public.partners where id = pid), 'document_id', doc, 'version', ver, 'from', prev_stage);
end $$;
revoke all on function public.complete_historical_onboarding(uuid, text, text, bigint, boolean, date, text, text, uuid) from public, anon;
grant execute on function public.complete_historical_onboarding(uuid, text, text, bigint, boolean, date, text, text, uuid) to authenticated;
