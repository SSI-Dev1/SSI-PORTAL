-- Partnership Agreement signing inside the existing Partner Registration workflow (17 Nov 2026).
--
-- Registration form → "Review Document": the agency views / downloads its agreement (the approved
-- template for its agency type, particulars filled from the form, Annexure A appended), signs it
-- by hand and uploads the signed PDF, then submits. SSI GLOBAL reviews it (approve for countersigning,
-- request changes — the same link reopens for a corrected upload — or reject), an authorised SSI
-- signatory uploads the countersigned PDF, and the final copy is emailed through an expiring,
-- registration-scoped download link and appears in the partner's documents once activated.
--
-- Data (no second registration system: everything hangs off partner_registrations):
--   agreement_templates            approved legal templates per agency type (Domestic / International)
--   registration_agreements        one per registration: agreement status, date, annexure, review,
--                                  countersignature, delivery
--   registration_agreement_files   every file version (generated, annexure, partner-signed, corrected,
--                                  countersigned) with SHA-256, uploader and review — never overwritten
-- Files live in the existing private bucket partner-registration-files; every read goes through the
-- partner-registration Edge Function (short-lived signed URLs), never a public URL.
--
-- Permissions: templates — Super Admin; review — registration managers (can_manage_registrations);
-- countersigning — Super Admin or the new staff permission "agreement_countersign" (granted per
-- person, never by role default; Partnership Officers / Partner Success do not get it).
-- Activation: a registration that requires an agreement can only be provisioned once the agreement is
-- countersigned. Registrations that existed before this migration (and historical partners) do not
-- require one.

-- ================================================================ permission
create or replace function public.staff_modules()
returns text[] language sql immutable set search_path = '' as $$
  select array['partners', 'students', 'applications', 'assessments', 'documents', 'finance',
               'catalogue', 'tasks', 'updates', 'reports', 'work_reports', 'hr', 'hr_accounts', 'hr_salary',
               'commission_view', 'commission_tag', 'commission_manage', 'commission_internal', 'commission_edit',
               'partner_onboarding', 'agency_outreach', 'partner_accounts', 'partner_success', 'partner_create',
               'agreement_countersign'];
$$;

create or replace function public.can_countersign_agreements()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_super_admin() or (public.is_staff() and public.staff_can('agreement_countersign'));
$$;
revoke all on function public.can_countersign_agreements() from public, anon;
grant execute on function public.can_countersign_agreements() to authenticated;

-- ================================================================ tables
create table if not exists public.agreement_templates (
  id                        uuid primary key default gen_random_uuid(),
  agency_type               text not null check (agency_type in ('domestic', 'international')),
  version                   integer not null check (version > 0),
  name                      text not null check (char_length(btrim(name)) between 3 and 200),
  layout                    text not null,                  -- measured placeholder layout (see agreementPdf.ts)
  storage_path              text not null unique,
  sha256                    text not null,
  pages                     integer not null check (pages > 0),
  requires_annexure         boolean not null default true,  -- Annexure A (commission rates) must be attached
  ssi_signatory_name        text,
  ssi_signatory_designation text,
  status                    text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  notes                     text check (char_length(notes) <= 2000),
  uploaded_by               uuid,
  uploaded_at               timestamptz not null default now(),
  approved_by               uuid,
  approved_at               timestamptz,
  unique (agency_type, version)
);
create unique index if not exists agreement_templates_one_approved on public.agreement_templates (agency_type) where status = 'approved';

create table if not exists public.registration_agreements (
  registration_id      uuid primary key references public.partner_registrations (id) on delete cascade,
  status               text not null default 'not_generated' check (status in (
                         'not_generated', 'template_missing', 'annexure_missing', 'ready', 'partner_signed', 'pending_review',
                         'changes_requested', 'approved_for_countersign', 'countersigned', 'sent', 'completed', 'rejected')),
  agency_type          text check (agency_type in ('domestic', 'international')),
  template_id          uuid references public.agreement_templates (id),
  agreement_date       date,
  particulars          jsonb,
  particulars_hash     text,
  annexure_resolution  text check (char_length(annexure_resolution) <= 1000),
  annexure_resolved_by uuid,
  annexure_resolved_at timestamptz,
  reviewer             uuid references public.profiles (id) on delete set null,
  review               jsonb,                 -- latest review {reasons[], note, by, at}
  approved_by          uuid,
  approved_at          timestamptz,
  countersigned_by     uuid,
  countersigned_at     timestamptz,
  version_flag         text,                  -- set when a countersigned copy does not match the partner-signed one
  delivery_token_hash  text unique,
  delivery_expires_at  timestamptz,
  sent_by              uuid,
  sent_at              timestamptz,
  email_status         text check (email_status in ('accepted', 'failed', 'not_configured')),
  email_detail         text,
  completed_at         timestamptz,
  updated_at           timestamptz not null default now()
);

create table if not exists public.registration_agreement_files (
  id               uuid primary key default gen_random_uuid(),
  registration_id  uuid not null references public.partner_registrations (id) on delete cascade,
  kind             text not null check (kind in ('generated', 'annexure', 'partner_signed', 'countersigned')),
  version          integer not null check (version > 0),
  template_id      uuid references public.agreement_templates (id),
  storage_path     text not null unique,
  sha256           text not null,
  size             integer not null check (size > 0),
  pages            integer,
  file_name        text,
  uploaded_by      uuid,                       -- null = the agency through its registration link
  uploaded_at      timestamptz not null default now(),
  superseded_at    timestamptz,
  review_status    text check (review_status in ('pending', 'accepted', 'changes_requested', 'rejected')),
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  unique (registration_id, kind, version)
);
create index if not exists registration_agreement_files_reg on public.registration_agreement_files (registration_id, kind, version desc);

alter table public.partner_registrations add column if not exists agreement_required boolean not null default true;
-- Registrations that already exist keep their current process (no agreement step added to them).
update public.partner_registrations set agreement_required = false
where agreement_required and created_at < now() and not exists (select 1 from public.registration_agreements a where a.registration_id = partner_registrations.id);

-- ================================================================ row-level security (reads only; writes go through functions)
alter table public.agreement_templates enable row level security;
alter table public.registration_agreements enable row level security;
alter table public.registration_agreement_files enable row level security;

drop policy if exists "agreement templates: staff read" on public.agreement_templates;
create policy "agreement templates: staff read" on public.agreement_templates for select
  using ((select public.can_manage_registrations()) or (select public.can_countersign_agreements()));

drop policy if exists "registration agreements: read" on public.registration_agreements;
create policy "registration agreements: read" on public.registration_agreements for select using (
  (select public.can_manage_registrations()) or (select public.can_countersign_agreements())
  -- Partnership Officers follow the agreement status of their own agencies.
  or exists (select 1 from public.agency_prospects a where a.registration_id = registration_agreements.registration_id and a.assigned_officer = (select auth.uid()))
  -- The activated partner sees its own agreement.
  or exists (select 1 from public.partner_registrations r where r.id = registration_agreements.registration_id
             and r.partner_id is not null and r.partner_id = (select public.my_partner_id())));

drop policy if exists "registration agreement files: read" on public.registration_agreement_files;
create policy "registration agreement files: read" on public.registration_agreement_files for select using (
  (select public.can_manage_registrations()) or (select public.can_countersign_agreements())
  or (kind = 'countersigned' and superseded_at is null and exists (
        select 1 from public.partner_registrations r join public.registration_agreements g on g.registration_id = r.id
        where r.id = registration_agreement_files.registration_id and r.partner_id is not null and r.partner_id = (select public.my_partner_id())
          and g.status in ('sent', 'completed'))));

-- ================================================================ helpers
create or replace function public.agreement_countersigners()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(p.id), '{}') from public.profiles p
  where p.status = 'active' and (p.role = 'super_admin' or (p.role in ('admin_staff', 'application_manager', 'assessment_staff', 'finance_staff', 'support_staff')
        and 'agreement_countersign' = any (coalesce(p.permissions, '{}'))));
$$;
revoke all on function public.agreement_countersigners() from public, anon, authenticated;

create or replace function public.log_agreement(p_reg uuid, p_action text, p_detail jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.partner_registration_events (registration_id, actor, action, detail) values (p_reg, auth.uid(), p_action, coalesce(p_detail, '{}'));
$$;
revoke all on function public.log_agreement(uuid, text, jsonb) from public, anon, authenticated;

-- ================================================================ staff actions
create or replace function public.approve_agreement_template(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can approve agreement templates'; end if;
  select * into t from public.agreement_templates where id = p_id for update;
  if t.id is null then raise exception 'Template not found'; end if;
  if t.status = 'approved' then return; end if;
  update public.agreement_templates set status = 'retired' where agency_type = t.agency_type and status = 'approved';
  update public.agreement_templates set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_id;
  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, changes)
  values (auth.uid(), 'super_admin', 'agreement_template_approved', 'agreement_templates', p_id::text,
          jsonb_build_object('agency_type', t.agency_type, 'version', t.version, 'sha256', t.sha256));
end $$;

create or replace function public.set_agreement_details(p_reg uuid, p_date date default null, p_reviewer uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  if not public.can_manage_registrations() then raise exception 'Only authorised administrators can change agreement details'; end if;
  insert into public.registration_agreements (registration_id) values (p_reg) on conflict do nothing;
  select * into a from public.registration_agreements where registration_id = p_reg for update;
  if p_date is not null then
    if a.status not in ('not_generated', 'template_missing', 'annexure_missing', 'ready', 'changes_requested') then
      raise exception 'The agreement date cannot change after the agency has signed. Request changes first.';
    end if;
    update public.registration_agreements set agreement_date = p_date, particulars_hash = null, updated_at = now() where registration_id = p_reg;
    perform public.log_agreement(p_reg, 'agreement_date_set', jsonb_build_object('date', p_date));
  end if;
  if p_reviewer is not null then
    update public.registration_agreements set reviewer = p_reviewer, updated_at = now() where registration_id = p_reg;
    perform public.log_agreement(p_reg, 'agreement_reviewer_set', jsonb_build_object('reviewer', p_reviewer));
  end if;
end $$;

-- Annexure A: proceed without a separate annexure only with a recorded Super Admin decision.
create or replace function public.resolve_agreement_annexure(p_reg uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can resolve a missing Annexure A'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'Explain how the commission annexure is covered (at least 10 characters)'; end if;
  insert into public.registration_agreements (registration_id) values (p_reg) on conflict do nothing;
  update public.registration_agreements set annexure_resolution = btrim(p_note), annexure_resolved_by = auth.uid(), annexure_resolved_at = now(),
    particulars_hash = null, status = case when status = 'annexure_missing' then 'not_generated' else status end, updated_at = now()
  where registration_id = p_reg;
  perform public.log_agreement(p_reg, 'agreement_annexure_resolved', jsonb_build_object('note', btrim(p_note)));
end $$;

-- Reopens the registration link for a corrected signed agreement (same mechanism as form changes).
create or replace function public.request_agreement_changes(p_reg uuid, p_reasons text[], p_note text default null, p_days integer default 14)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; res jsonb; labels text[];
begin
  if not public.can_manage_registrations() then raise exception 'Only authorised administrators can request agreement changes'; end if;
  select * into a from public.registration_agreements where registration_id = p_reg for update;
  if a.registration_id is null or a.status <> 'pending_review' then raise exception 'Only a signed agreement waiting for review can be returned'; end if;
  if coalesce(cardinality(p_reasons), 0) = 0 and char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Choose a reason or write a comment'; end if;
  labels := array(select case r when 'missing_signature' then 'Missing signature' when 'missing_seal' then 'Missing company seal'
                                 when 'incomplete_pages' then 'Incomplete pages' when 'company_info' then 'Incorrect company information'
                                 when 'representative' then 'Incorrect authorised representative' when 'wrong_version' then 'Wrong document version'
                                 else 'Other' end from unnest(coalesce(p_reasons, '{}')) r);
  res := public.request_registration_changes(p_reg, 'Please upload a corrected signed Partnership Agreement: ' || coalesce(array_to_string(labels, ', '), 'see comments'),
                                             array['signed_agreement'], p_note, p_days);
  update public.registration_agreements set status = 'changes_requested', updated_at = now(),
    review = jsonb_build_object('reasons', to_jsonb(coalesce(p_reasons, '{}')), 'note', nullif(btrim(coalesce(p_note, '')), ''), 'by', auth.uid(), 'at', now())
  where registration_id = p_reg;
  update public.registration_agreement_files set review_status = 'changes_requested', reviewed_by = auth.uid(), reviewed_at = now()
  where registration_id = p_reg and kind = 'partner_signed' and superseded_at is null;
  perform public.log_agreement(p_reg, 'agreement_changes_requested', jsonb_build_object('reasons', to_jsonb(coalesce(p_reasons, '{}'))));
  return res;
end $$;

create or replace function public.approve_agreement_for_countersign(p_reg uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare a record; r record;
begin
  if not public.can_manage_registrations() then raise exception 'Only authorised administrators can approve agreements'; end if;
  select * into a from public.registration_agreements where registration_id = p_reg for update;
  if a.registration_id is null or a.status <> 'pending_review' then raise exception 'Only a signed agreement waiting for review can be approved'; end if;
  update public.registration_agreements set status = 'approved_for_countersign', approved_by = auth.uid(), approved_at = now(), updated_at = now() where registration_id = p_reg;
  update public.registration_agreement_files set review_status = 'accepted', reviewed_by = auth.uid(), reviewed_at = now()
  where registration_id = p_reg and kind = 'partner_signed' and superseded_at is null;
  select company_name, reference into r from public.partner_registrations where id = p_reg;
  perform public.notify(public.agreement_countersigners(), 'partner', 'Agreement ready for countersigning', r.company_name || ' · ' || r.reference, 'partners/registrations');
  perform public.log_agreement(p_reg, 'agreement_approved_for_countersign');
end $$;

create or replace function public.reject_agreement(p_reg uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_registrations() then raise exception 'Only authorised administrators can reject agreements'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Enter the reason'; end if;
  update public.registration_agreements set status = 'rejected', updated_at = now(),
    review = jsonb_build_object('reasons', '[]'::jsonb, 'note', btrim(p_note), 'by', auth.uid(), 'at', now(), 'rejected', true)
  where registration_id = p_reg and status in ('pending_review', 'approved_for_countersign');
  if not found then raise exception 'This agreement cannot be rejected now'; end if;
  update public.registration_agreement_files set review_status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
  where registration_id = p_reg and kind = 'partner_signed' and superseded_at is null;
  perform public.log_agreement(p_reg, 'agreement_rejected', jsonb_build_object('note', btrim(p_note)));
end $$;

do $$
declare f text;
begin
  foreach f in array array['approve_agreement_template(uuid)', 'set_agreement_details(uuid, date, uuid)', 'resolve_agreement_annexure(uuid, text)',
                           'request_agreement_changes(uuid, text[], text, integer)', 'approve_agreement_for_countersign(uuid)', 'reject_agreement(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ================================================================ registration submit (agreement required → signed copy required)
create or replace function public.submit_partner_registration(p_token text, p_answers jsonb, p_form_version text, p_idempotency text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; rev int; ag record;
begin
  select * into r from public.partner_registrations where token_hash = public.registration_token_hash(p_token) for update;
  if r.id is null or r.link_status = 'revoked' then raise exception 'LINK_UNUSABLE'; end if;
  -- The same submission retried (double click, network retry): report success, change nothing.
  if p_idempotency is not null and r.last_idempotency_key = p_idempotency and r.status in ('submitted', 'in_review') then
    return jsonb_build_object('reference', r.reference, 'duplicate', true);
  end if;
  if r.link_status <> 'active' or r.link_expires_at < now() or r.status not in ('link_generated', 'in_progress', 'changes_requested') then
    raise exception 'LINK_UNUSABLE';
  end if;
  if r.agreement_required then
    select * into ag from public.registration_agreements where registration_id = r.id for update;
    -- When SSI GLOBAL has issued an agreement, the signed copy is part of the submission.
    if ag.registration_id is not null and ag.status in ('ready', 'partner_signed', 'changes_requested') then
      if not exists (select 1 from public.registration_agreement_files f where f.registration_id = r.id and f.kind = 'partner_signed'
                     and f.superseded_at is null and coalesce(f.review_status, 'pending') = 'pending') then
        raise exception 'AGREEMENT_REQUIRED';
      end if;
      update public.registration_agreements set status = 'pending_review', updated_at = now() where registration_id = r.id;
    end if;
  end if;
  rev := r.submission_count + 1;
  insert into public.partner_registration_revisions (registration_id, revision, form_version, answers, files) values (r.id, rev, p_form_version, p_answers, r.files);
  update public.partner_registrations set answers = p_answers, form_version = p_form_version, status = 'submitted', submitted_at = now(),
    submission_count = rev, last_idempotency_key = p_idempotency where id = r.id;
  insert into public.partner_registration_events (registration_id, actor, action, detail)
  values (r.id, null, case when rev = 1 then 'submitted' else 'resubmitted' end, jsonb_build_object('revision', rev));
  perform public.notify(public.registration_managers(), 'partner', case when rev = 1 then 'New partner registration' else 'Partner registration corrected' end,
                        r.company_name || ' · ' || r.reference, 'partners/registrations');
  return jsonb_build_object('reference', r.reference, 'duplicate', false, 'revision', rev);
end $$;

-- ================================================================ activation needs a countersigned agreement (when required)
create or replace function public.begin_registration_provisioning(p_id uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select * into r from public.partner_registrations where id = p_id;
  if r.id is not null and r.agreement_required and r.status = 'approved' and r.partner_id is null
     and not exists (select 1 from public.registration_agreements a where a.registration_id = p_id and a.status in ('countersigned', 'sent', 'completed')) then
    raise exception 'AGREEMENT_INCOMPLETE';
  end if;
  update public.partner_registrations set provisioning_since = now()
  where id = p_id and status = 'approved' and partner_id is null and (provisioning_since is null or provisioning_since < now() - interval '10 minutes')
  returning * into r;
  if r.id is null then
    select * into r from public.partner_registrations where id = p_id;
    if r.id is null then raise exception 'Registration not found'; end if;
    if r.partner_id is not null or r.status = 'activated' then raise exception 'ALREADY_ACTIVATED'; end if;
    if r.status <> 'approved' then raise exception 'NOT_APPROVED'; end if;
    raise exception 'IN_PROGRESS';
  end if;
  insert into public.partner_registration_events (registration_id, actor, action) values (p_id, p_actor, 'provisioning_started');
  return jsonb_build_object('company_name', r.company_name, 'reference', r.reference);
end $$;

-- ================================================================ realtime
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'registration_agreements') then
      alter publication supabase_realtime add table public.registration_agreements;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'registration_agreement_files') then
      alter publication supabase_realtime add table public.registration_agreement_files;
    end if;
  end if;
end $$;
