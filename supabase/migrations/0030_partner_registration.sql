-- 0030_partner_registration.sql — run after 0029_commission_management.sql
-- (Supabase SQL Editor: Save this query as "0030_partner_registration")
--
-- Partner registration (pre-onboarding for Clients & Branches):
-- * An authorised admin creates a registration for a company and gets a one-time-visible link
--   (#/partner-registration/<token>). Only a SHA-256 hash of the token is stored. The link opens
--   that one registration form — never a login, never portal access, never other data.
-- * The public form talks only to the partner-registration Edge Function (service role), which
--   validates the token, rate-limits, saves drafts and files, verifies the registered email with a
--   one-time code and submits. Anonymous users have no table access at all.
-- * Admins review (start review, request changes with a fresh link, reject, approve). Approval
--   does not create anything: "Approve & Create Partner" uses the existing Add Partner function,
--   which claims the registration first so one registration can never create two partners, and
--   marks it Activated only after the partner and its Partner Admin were created.
-- * Who: Super Admins, and Admin Staff given "Partner registrations" by a Super Admin. Nobody
--   else (Partnership Officers, HR, partners) — enforced here, not just in the menu.
-- Safe to run more than once.

-- =============================================================== permission
create or replace function public.staff_modules()
returns text[] language sql immutable set search_path = '' as $$
  select array['partners', 'students', 'applications', 'assessments', 'documents', 'finance',
               'catalogue', 'tasks', 'updates', 'reports', 'work_reports', 'hr', 'hr_accounts', 'hr_salary',
               'commission_view', 'commission_tag', 'commission_manage', 'commission_internal', 'commission_edit',
               'partner_onboarding'];
$$;
create or replace function public.hr_modules()
returns text[] language sql immutable set search_path = '' as $$
  select array['hr', 'hr_accounts', 'hr_salary', 'commission_view', 'commission_tag', 'commission_manage', 'commission_internal', 'commission_edit',
               'partner_onboarding'];
$$;

create or replace function public.can_manage_registrations()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.my_profile_ok() and (public.is_super_admin() or (public.my_role() = 'admin_staff' and public.staff_can('partner_onboarding')));
$$;
revoke all on function public.can_manage_registrations() from public, anon;
grant execute on function public.can_manage_registrations() to authenticated;

create or replace function public.registration_managers()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(p.id), '{}') from public.profiles p
  where p.status = 'active' and (p.role = 'super_admin' or (p.role = 'admin_staff' and 'partner_onboarding' = any (coalesce(p.permissions, '{}'))));
$$;
revoke all on function public.registration_managers() from public, anon, authenticated;

-- =============================================================== tables
create table if not exists public.partner_registrations (
  id                   uuid primary key default gen_random_uuid(),
  reference            text not null unique,
  company_name         text not null check (char_length(btrim(company_name)) between 2 and 160),
  intended_email       text check (intended_email is null or intended_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  country              text check (char_length(country) <= 80),
  internal_notes       text check (char_length(internal_notes) <= 2000),
  token_hash           text unique,
  link_expires_at      timestamptz,
  link_status          text not null default 'active' check (link_status in ('active', 'revoked', 'closed')),
  status               text not null default 'link_generated' check (status in ('link_generated', 'in_progress', 'submitted', 'in_review',
                                                                                'changes_requested', 'approved', 'rejected', 'activated')),
  form_version         text,
  answers              jsonb not null default '{}',
  files                jsonb not null default '{}',     -- field key → {id, name, size, mime}
  verified_email       text,
  email_verified_at    timestamptz,
  submission_count     integer not null default 0,
  last_idempotency_key text,
  submitted_at         timestamptz,
  first_opened_at      timestamptz,
  last_opened_at       timestamptz,
  change_request       jsonb,                           -- {reason, fields[], instructions, at, by}
  assigned_reviewer    uuid,
  reviewed_by          uuid,
  reviewed_at          timestamptz,
  decision_reason      text check (char_length(decision_reason) <= 2000),
  provisioning_since   timestamptz,
  partner_id           text references public.partners (id) on delete set null,
  partner_admin_id     uuid,
  activated_at         timestamptz,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists partner_registrations_partner_key on public.partner_registrations (partner_id) where partner_id is not null;
create index if not exists partner_registrations_status_idx on public.partner_registrations (status, created_at desc);

-- Every submission (first and corrected) is kept.
create table if not exists public.partner_registration_revisions (
  id              bigint generated always as identity primary key,
  registration_id uuid not null references public.partner_registrations (id) on delete cascade,
  revision        integer not null,
  form_version    text,
  answers         jsonb not null,
  files           jsonb not null default '{}',
  submitted_at    timestamptz not null default now(),
  unique (registration_id, revision)
);

create table if not exists public.partner_registration_events (
  id              bigint generated always as identity primary key,
  registration_id uuid not null references public.partner_registrations (id) on delete cascade,
  at              timestamptz not null default now(),
  actor           uuid,                -- null = the applicant (public link)
  action          text not null,
  detail          jsonb
);
create index if not exists partner_registration_events_idx on public.partner_registration_events (registration_id, at);

create table if not exists public.partner_registration_files (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.partner_registrations (id) on delete cascade,
  field_key       text not null,
  file_name       text not null check (char_length(file_name) <= 200),
  size            bigint not null check (size > 0 and size <= 10485760),
  mime            text not null,
  storage_path    text not null unique,
  uploaded_at     timestamptz not null default now()
);

-- One-time email codes (hash only) and request counters for the public function.
create table if not exists public.partner_registration_email_codes (
  registration_id uuid primary key references public.partner_registrations (id) on delete cascade,
  email           text not null,
  code_hash       text not null,
  expires_at      timestamptz not null,
  attempts        integer not null default 0,
  sent_at         timestamptz not null default now()
);
create table if not exists public.partner_registration_hits (
  bucket       text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (bucket, window_start)
);

do $$
declare t text;
begin
  foreach t in array array['partner_registrations', 'partner_registration_revisions', 'partner_registration_events', 'partner_registration_files',
                           'partner_registration_email_codes', 'partner_registration_hits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
grant select on public.partner_registrations, public.partner_registration_revisions, public.partner_registration_events, public.partner_registration_files to authenticated;

drop policy if exists "partner registrations: managers read" on public.partner_registrations;
create policy "partner registrations: managers read" on public.partner_registrations for select to authenticated using (public.can_manage_registrations());
drop policy if exists "registration revisions: managers read" on public.partner_registration_revisions;
create policy "registration revisions: managers read" on public.partner_registration_revisions for select to authenticated using (public.can_manage_registrations());
drop policy if exists "registration events: managers read" on public.partner_registration_events;
create policy "registration events: managers read" on public.partner_registration_events for select to authenticated using (public.can_manage_registrations());
drop policy if exists "registration files: managers read" on public.partner_registration_files;
create policy "registration files: managers read" on public.partner_registration_files for select to authenticated using (public.can_manage_registrations());
-- Codes and counters: service role only (no policies).

-- Private storage for uploaded registration documents (written via signed upload URLs issued by
-- the Edge Function after it checked the link; read only by registration managers).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('partner-registration-files', 'partner-registration-files', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "registration files storage: managers read" on storage.objects;
create policy "registration files storage: managers read" on storage.objects for select to authenticated using (
  bucket_id = 'partner-registration-files' and public.can_manage_registrations());

-- =============================================================== helpers
create or replace function public.registration_token_hash(p_token text)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;

-- 64 hex characters from two random UUIDs (≈244 random bits); returned once, stored as a hash.
create or replace function public.new_registration_token()
returns text language sql volatile set search_path = '' as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

create or replace function public.log_registration(p_id uuid, p_action text, p_detail jsonb default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.partner_registration_events (registration_id, actor, action, detail) values (p_id, auth.uid(), p_action, p_detail);
$$;

create or replace function public.touch_partner_registration()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists partner_registrations_touch on public.partner_registrations;
create trigger partner_registrations_touch before update on public.partner_registrations for each row execute function public.touch_partner_registration();

-- =============================================================== admin actions
create or replace function public.create_partner_registration(p_company text, p_email text default null, p_country text default null,
                                                             p_days integer default 14, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare tok text := public.new_registration_token(); rid uuid; ref text; exp timestamptz;
begin
  if not public.can_manage_registrations() then raise exception 'Only authorised administrators can create registration links'; end if;
  if char_length(btrim(coalesce(p_company, ''))) < 2 then raise exception 'Enter the company name'; end if;
  if nullif(btrim(coalesce(p_email, '')), '') is not null and btrim(p_email) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
  exp := now() + make_interval(days => least(greatest(coalesce(p_days, 14), 1), 90));
  loop
    ref := 'PR-' || to_char(now(), 'YY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from public.partner_registrations where reference = ref);
  end loop;
  insert into public.partner_registrations (reference, company_name, intended_email, country, internal_notes, token_hash, link_expires_at, created_by)
  values (ref, btrim(p_company), nullif(lower(btrim(coalesce(p_email, ''))), ''), nullif(btrim(coalesce(p_country, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''),
          public.registration_token_hash(tok), exp, auth.uid())
  returning id into rid;
  perform public.log_registration(rid, 'link_created', jsonb_build_object('expires_at', exp));
  return jsonb_build_object('id', rid, 'reference', ref, 'token', tok, 'expires_at', exp);
end $$;

-- A new link replaces the old one (the old link stops working at once).
create or replace function public.regenerate_registration_link(p_id uuid, p_days integer default 14)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; tok text := public.new_registration_token(); exp timestamptz;
begin
  if not public.can_manage_registrations() then raise exception 'Only authorised administrators can manage registration links'; end if;
  select * into r from public.partner_registrations where id = p_id for update;
  if r.id is null then raise exception 'Registration not found'; end if;
  if r.status in ('approved', 'rejected', 'activated') then raise exception 'This registration is closed (%)', r.status; end if;
  exp := now() + make_interval(days => least(greatest(coalesce(p_days, 14), 1), 90));
  update public.partner_registrations set token_hash = public.registration_token_hash(tok), link_expires_at = exp, link_status = 'active' where id = p_id;
  perform public.log_registration(p_id, 'link_regenerated', jsonb_build_object('expires_at', exp));
  return jsonb_build_object('token', tok, 'expires_at', exp);
end $$;

create or replace function public.revoke_registration_link(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_registrations() then raise exception 'Only authorised administrators can manage registration links'; end if;
  update public.partner_registrations set link_status = 'revoked' where id = p_id and link_status = 'active';
  if not found then raise exception 'There is no active link to revoke'; end if;
  perform public.log_registration(p_id, 'link_revoked', jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), '')));
end $$;

create or replace function public.start_registration_review(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_registrations() then raise exception 'Only authorised administrators can review registrations'; end if;
  update public.partner_registrations set status = 'in_review', assigned_reviewer = auth.uid() where id = p_id and status = 'submitted';
  if not found then
    update public.partner_registrations set assigned_reviewer = auth.uid() where id = p_id and status = 'in_review';
    if not found then raise exception 'Only a submitted registration can be reviewed'; end if;
  end if;
  perform public.log_registration(p_id, 'review_started');
end $$;

-- Reopens the form for corrections with a fresh link (returned once for the admin to send).
create or replace function public.request_registration_changes(p_id uuid, p_reason text, p_fields text[], p_instructions text default null, p_days integer default 14)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; tok text := public.new_registration_token(); exp timestamptz; cr jsonb;
begin
  if not public.can_manage_registrations() then raise exception 'Only authorised administrators can request changes'; end if;
  select * into r from public.partner_registrations where id = p_id for update;
  if r.id is null then raise exception 'Registration not found'; end if;
  if r.status not in ('submitted', 'in_review') then raise exception 'Changes can only be requested for a submitted registration'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Enter the reason'; end if;
  exp := now() + make_interval(days => least(greatest(coalesce(p_days, 14), 1), 90));
  cr := jsonb_build_object('reason', btrim(p_reason), 'fields', to_jsonb(coalesce(p_fields, '{}')), 'instructions', nullif(btrim(coalesce(p_instructions, '')), ''),
                           'at', now(), 'by', auth.uid());
  update public.partner_registrations set status = 'changes_requested', change_request = cr, token_hash = public.registration_token_hash(tok),
    link_expires_at = exp, link_status = 'active', reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  perform public.log_registration(p_id, 'changes_requested', cr);
  return jsonb_build_object('token', tok, 'expires_at', exp);
end $$;

create or replace function public.reject_registration(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_registrations() then raise exception 'Only authorised administrators can reject registrations'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Enter the internal reason'; end if;
  update public.partner_registrations set status = 'rejected', link_status = 'closed', decision_reason = btrim(p_reason), reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_id and status in ('submitted', 'in_review', 'changes_requested', 'approved') and partner_id is null and provisioning_since is null;
  if not found then raise exception 'This registration cannot be rejected now'; end if;
  perform public.log_registration(p_id, 'rejected', jsonb_build_object('reason', btrim(p_reason)));
end $$;

create or replace function public.approve_registration(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_registrations() then raise exception 'Only authorised administrators can approve registrations'; end if;
  update public.partner_registrations set status = 'approved', link_status = 'closed', decision_reason = nullif(btrim(coalesce(p_note, '')), ''),
    reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_id and status in ('submitted', 'in_review');
  if not found then raise exception 'Only a submitted registration can be approved'; end if;
  perform public.log_registration(p_id, 'approved', jsonb_build_object('note', nullif(btrim(coalesce(p_note, '')), '')));
end $$;

do $$
declare f text;
begin
  foreach f in array array['create_partner_registration(text, text, text, integer, text)', 'regenerate_registration_link(uuid, integer)',
                           'revoke_registration_link(uuid, text)', 'start_registration_review(uuid)',
                           'request_registration_changes(uuid, text, text[], text, integer)', 'reject_registration(uuid, text)', 'approve_registration(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- =============================================================== public form (service role only, via the Edge Function)
-- Counts a request in a fixed window; false = over the limit.
create or replace function public.registration_rate_hit(p_bucket text, p_limit integer, p_window_minutes integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare ws timestamptz := to_timestamp(floor(extract(epoch from now()) / (p_window_minutes * 60)) * (p_window_minutes * 60)); n int;
begin
  insert into public.partner_registration_hits (bucket, window_start, hits) values (p_bucket, ws, 1)
  on conflict (bucket, window_start) do update set hits = public.partner_registration_hits.hits + 1 returning hits into n;
  delete from public.partner_registration_hits where window_start < now() - interval '1 day';
  return n <= p_limit;
end $$;

-- The registration a link opens, or why it cannot be used (never reveals other registrations).
create or replace function public.registration_for_token(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if p_token !~ '^[0-9a-f]{64}$' then return jsonb_build_object('state', 'invalid'); end if;
  select * into r from public.partner_registrations where token_hash = public.registration_token_hash(p_token);
  if r.id is null then return jsonb_build_object('state', 'invalid'); end if;
  if r.link_status = 'revoked' then return jsonb_build_object('state', 'revoked'); end if;
  if r.status in ('submitted', 'in_review', 'approved', 'activated') then
    return jsonb_build_object('state', 'submitted', 'company_name', r.company_name, 'reference', r.reference, 'submitted_at', r.submitted_at);
  end if;
  if r.status = 'rejected' or r.link_status = 'closed' then return jsonb_build_object('state', 'closed'); end if;
  if r.link_expires_at < now() then return jsonb_build_object('state', 'expired'); end if;
  update public.partner_registrations set first_opened_at = coalesce(first_opened_at, now()), last_opened_at = now() where id = r.id;
  return jsonb_build_object('state', 'open', 'id', r.id, 'reference', r.reference, 'company_name', r.company_name, 'country', r.country,
    'intended_email', r.intended_email, 'status', r.status, 'answers', r.answers, 'files', r.files,
    'verified_email', r.verified_email, 'expires_at', r.link_expires_at,
    'change_request', case when r.status = 'changes_requested' then r.change_request - 'by' end);
end $$;

create or replace function public.save_registration_draft(p_token text, p_answers jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select * into r from public.partner_registrations where token_hash = public.registration_token_hash(p_token) for update;
  if r.id is null or r.link_status <> 'active' or r.link_expires_at < now() or r.status not in ('link_generated', 'in_progress', 'changes_requested') then
    raise exception 'LINK_UNUSABLE';
  end if;
  update public.partner_registrations set answers = coalesce(p_answers, '{}'),
    status = case when status = 'link_generated' then 'in_progress' else status end where id = r.id;
  if r.status = 'link_generated' then perform public.log_registration(r.id, 'started'); end if;
end $$;

create or replace function public.submit_partner_registration(p_token text, p_answers jsonb, p_form_version text, p_idempotency text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; rev int;
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

-- Provisioning hooks for the admin-users function (service role): claim → create → finish/release.
create or replace function public.begin_registration_provisioning(p_id uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record;
begin
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

create or replace function public.finish_registration_provisioning(p_id uuid, p_partner text, p_user uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.partner_registrations set status = 'activated', partner_id = p_partner, partner_admin_id = p_user, activated_at = now(), provisioning_since = null
  where id = p_id and status = 'approved' and partner_id is null;
  if not found then raise exception 'Registration could not be marked as activated'; end if;
  insert into public.partner_registration_events (registration_id, actor, action, detail) values (p_id, p_actor, 'activated', jsonb_build_object('partner_id', p_partner));
end $$;

create or replace function public.release_registration_provisioning(p_id uuid, p_actor uuid, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.partner_registrations set provisioning_since = null where id = p_id and status = 'approved' and partner_id is null;
  insert into public.partner_registration_events (registration_id, actor, action, detail) values (p_id, p_actor, 'provisioning_failed', jsonb_build_object('error', left(p_error, 300)));
end $$;

do $$
declare f text;
begin
  foreach f in array array['registration_rate_hit(text, integer, integer)', 'registration_for_token(text)', 'save_registration_draft(text, jsonb)',
                           'submit_partner_registration(text, jsonb, text, text)', 'begin_registration_provisioning(uuid, uuid)',
                           'finish_registration_provisioning(uuid, text, uuid, uuid)', 'release_registration_provisioning(uuid, uuid, text)',
                           'log_registration(uuid, text, jsonb)', 'new_registration_token()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- =============================================================== audit, realtime
do $$
begin
  execute 'drop trigger if exists partner_registrations_audit on public.partner_registrations';
  execute 'create trigger partner_registrations_audit after insert or update or delete on public.partner_registrations for each row execute function public.audit_row()';
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'partner_registrations') then
      alter publication supabase_realtime add table public.partner_registrations;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'partner_registration_events') then
      alter publication supabase_realtime add table public.partner_registration_events;
    end if;
  end if;
end $$;
