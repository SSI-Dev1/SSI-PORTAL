-- 0024_account_credentials.sql — run after 0023_half_day_leave_lop.sql
-- (Supabase SQL Editor: Save this query as "0024_account_credentials")
--
-- Temporary login credentials sent by email when an account is created or its login access is
-- resent, and the delivery status of those emails.
-- * account_temp_credentials: one row per account with a temporary password: when it expires and
--   a copy of the bcrypt hash Supabase Auth stored for it (never the password). Nobody can read
--   this table from the app; only the account functions (service role) write it.
-- * While must_change_password is set, the account has no data access at all (my_profile_ok), so
--   the first-login password change cannot be skipped by calling the API directly.
-- * password_change_done() only succeeds when the temporary password has not expired and the
--   account's password really is different from it; the user cannot clear the flag any other way.
-- * account_credential_deliveries: one row per credentials email (pending / accepted by Brevo /
--   delivered / failed), updated from Brevo delivery events. No password and no email body.
-- Safe to run more than once.

-- =============================================================== temporary credentials
create table if not exists public.account_temp_credentials (
  user_id       uuid primary key references public.profiles (id) on delete cascade,
  password_hash text not null,           -- copy of auth.users.encrypted_password when issued
  expires_at    timestamptz not null,
  issued_at     timestamptz not null default now(),
  issued_by     uuid
);
alter table public.account_temp_credentials enable row level security;
revoke all on public.account_temp_credentials from anon, authenticated;
-- No policies: not readable or writable by any signed-in user.

-- Called by the account functions (service role) right after setting a temporary password.
create or replace function public.record_temp_credential(p_user uuid, p_hours int, p_issued_by uuid default null)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_expires timestamptz := now() + make_interval(hours => least(greatest(coalesce(p_hours, 72), 1), 720));
begin
  insert into public.account_temp_credentials (user_id, password_hash, expires_at, issued_by)
  select u.id, u.encrypted_password, v_expires, p_issued_by from auth.users u where u.id = p_user and u.encrypted_password is not null
  on conflict (user_id) do update set password_hash = excluded.password_hash, expires_at = excluded.expires_at,
    issued_at = now(), issued_by = excluded.issued_by;
  if not found then raise exception 'Unknown account'; end if;
  update public.profiles set must_change_password = true where id = p_user;
  return v_expires;
end $$;
revoke all on function public.record_temp_credential(uuid, int, uuid) from public, anon, authenticated;

-- 'expired' when the caller's temporary password has run out (the app then explains what to do).
create or replace function public.my_temp_password_state()
returns text language sql stable security definer set search_path = '' as $$
  select case when c.expires_at < now() then 'expired' else 'active' end
  from public.account_temp_credentials c where c.user_id = auth.uid();
$$;
revoke all on function public.my_temp_password_state() from public, anon;
grant execute on function public.my_temp_password_state() to authenticated;

-- =============================================================== first-login password change
-- An account that must change its password has no access to any data until it does.
create or replace function public.my_profile_ok()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and not p.must_change_password
      and (p.sessions_revoked_at is null
           or coalesce((auth.jwt() ->> 'iat')::bigint, 0) >= ceil(extract(epoch from p.sessions_revoked_at))::bigint));
$$;

create or replace function public.password_change_done()
returns void language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  select c.password_hash, c.expires_at into t from public.account_temp_credentials c where c.user_id = auth.uid();
  if found then
    if t.expires_at < now() then raise exception 'TEMP_PASSWORD_EXPIRED'; end if;
    if exists (select 1 from auth.users u where u.id = auth.uid() and u.encrypted_password is not distinct from t.password_hash) then
      raise exception 'PASSWORD_NOT_CHANGED';
    end if;
    delete from public.account_temp_credentials where user_id = auth.uid();
  end if;
  perform set_config('ssi.password_change_done', 'on', true);
  update public.profiles set must_change_password = false where id = auth.uid();
end $$;
revoke all on function public.password_change_done() from public, anon;
grant execute on function public.password_change_done() to authenticated;

-- Users still cannot change their own role, status, organisation or permissions, and can now only
-- clear "must change password" through password_change_done().
create or replace function public.guard_profile_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_end_user_request() and new.id = auth.uid()
     and (new.role is distinct from old.role or new.status is distinct from old.status
          or new.partner_id is distinct from old.partner_id or new.permissions is distinct from old.permissions
          or new.sessions_revoked_at is distinct from old.sessions_revoked_at
          or (new.must_change_password and not old.must_change_password)) then
    raise exception 'You cannot change your own role, organisation, permissions or status';
  end if;
  if public.is_end_user_request() and new.id = auth.uid() and old.must_change_password and not new.must_change_password
     and coalesce(current_setting('ssi.password_change_done', true), '') <> 'on' then
    raise exception 'Set a new password to continue';
  end if;
  if new.permissions is not null and not (new.permissions <@ public.staff_modules()) then
    raise exception 'Unknown permission';
  end if;
  if new.role not in ('super_admin', 'admin_staff', 'application_manager', 'assessment_staff', 'finance_staff', 'support_staff')
     and new.permissions is not null then
    new.permissions := null;
  end if;
  -- Leaving "active" ends every existing session.
  if new.status <> 'active' and old.status = 'active' then
    new.sessions_revoked_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;

-- =============================================================== who may manage an account
-- Super Admin: any account. HR with "hr_accounts": employees below Admin level, not themselves.
-- Partner team managers: staff accounts of their own organisation.
create or replace function public.can_manage_account(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles t
    where t.id = p_user and (
      public.is_super_admin()
      or (public.staff_can('hr_accounts') and t.id <> auth.uid()
          and t.role in ('application_manager', 'assessment_staff', 'finance_staff', 'support_staff'))
      or (t.role = 'partner_staff' and t.partner_id = public.my_partner_id() and public.partner_perm('team.manage') and t.id <> auth.uid())
    ));
$$;
revoke all on function public.can_manage_account(uuid) from public, anon;
grant execute on function public.can_manage_account(uuid) to authenticated;

-- =============================================================== delivery status
create table if not exists public.account_credential_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  kind                text not null check (kind in ('initial', 'resend')),
  status              text not null default 'pending' check (status in ('pending', 'accepted', 'delivered', 'failed')),
  detail              text,               -- short reason, never message content
  provider_message_id text unique,
  requested_by        uuid,
  temp_expires_at     timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists account_credential_deliveries_user_idx on public.account_credential_deliveries (user_id, created_at desc);
create index if not exists account_credential_deliveries_requester_idx on public.account_credential_deliveries (requested_by, created_at desc);
alter table public.account_credential_deliveries enable row level security;
revoke all on public.account_credential_deliveries from anon, authenticated;
grant select on public.account_credential_deliveries to authenticated;
drop policy if exists "credential deliveries: managers read" on public.account_credential_deliveries;
create policy "credential deliveries: managers read" on public.account_credential_deliveries for select to authenticated
  using (public.can_manage_account(user_id));

-- Brevo delivery events (service role only). Delivered or failed is final; "accepted" never
-- turns into "delivered" without the provider confirming delivery.
create or replace function public.apply_email_event(p_message_id text, p_event text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  ev text := lower(coalesce(p_event, ''));
  next_status text;
  next_detail text;
begin
  if ev in ('delivered', 'opened', 'unique_opened', 'click') then
    next_status := 'delivered';
  elsif ev in ('hard_bounce', 'hardbounce', 'invalid_email', 'blocked', 'error', 'spam') then
    next_status := 'failed';
    next_detail := left(coalesce(nullif(p_reason, ''), replace(ev, '_', ' ')), 200);
  elsif ev in ('soft_bounce', 'softbounce', 'deferred') then
    next_status := 'accepted';
    next_detail := 'Delivery delayed by the receiving server';
  elsif ev in ('request', 'sent') then
    next_status := 'accepted';
  else
    return;
  end if;
  update public.account_credential_deliveries d
  set status = next_status, detail = coalesce(next_detail, d.detail), updated_at = now()
  where d.provider_message_id = p_message_id
    and (d.status in ('pending', 'accepted') or (d.status = 'delivered' and next_status = 'failed' and ev <> 'spam'));
end $$;
revoke all on function public.apply_email_event(text, text, text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'account_credential_deliveries') then
    alter publication supabase_realtime add table public.account_credential_deliveries;
  end if;
end $$;
