-- 0029_commission_management.sql — run after 0028_employee_self_service.sql
-- (Supabase SQL Editor: Save this query as "0029_commission_management")
--
-- Commission management: country-wise master commission records (university, intake, route,
-- portal provider, Tier 1 / 2 / 3 partner rates), SSI GLOBAL's internal commission and margin
-- kept in a separate locked table, partner tier assignments and custom agreements with approval
-- and history, sheet imports with a stored copy of every changed record, and links from
-- applications to the commission that applies (application_commissions, staff only).
--
-- Who sees what (enforced here, never by hiding things in the app):
-- * commission_view      commission records and Tier 1/2/3 partner rates, partner assignments
-- * commission_tag       tag a partner agency to a record with a standard tier; changing an
--                        existing agreement waits for approval
-- * commission_manage    assign / change / deactivate agreements, custom commissions, approvals
-- * commission_internal  SSI GLOBAL's own commission, margin and the full source row
-- * commission_edit      edit master records, providers, countries, tiers; import sheets
-- Super Admins have all five; only a Super Admin grants them. A Partner Admin sees only their
-- organisation's own assigned rate through my_partner_commissions() (never internal values,
-- other tiers or other partners); partner employees see nothing.
-- Money values are numeric (exact decimals). Percentages are stored as percent (20 = 20%).
-- Safe to run more than once.

-- =============================================================== permissions
create or replace function public.staff_modules()
returns text[] language sql immutable set search_path = '' as $$
  select array['partners', 'students', 'applications', 'assessments', 'documents', 'finance',
               'catalogue', 'tasks', 'updates', 'reports', 'work_reports', 'hr', 'hr_accounts', 'hr_salary',
               'commission_view', 'commission_tag', 'commission_manage', 'commission_internal', 'commission_edit'];
$$;

-- Permissions only a Super Admin can grant or remove (HR rights and commission rights).
create or replace function public.hr_modules()
returns text[] language sql immutable set search_path = '' as $$
  select array['hr', 'hr_accounts', 'hr_salary', 'commission_view', 'commission_tag', 'commission_manage', 'commission_internal', 'commission_edit'];
$$;

create or replace function public.commission_can(p text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_staff() and (public.is_super_admin() or public.staff_can(p)
    -- managing and tagging imply seeing the records they act on
    or (p = 'commission_view' and (public.staff_can('commission_tag') or public.staff_can('commission_manage') or public.staff_can('commission_edit')))
    or (p = 'commission_tag' and public.staff_can('commission_manage')));
$$;
revoke all on function public.commission_can(text) from public, anon;
grant execute on function public.commission_can(text) to authenticated;

-- =============================================================== reference data
create table if not exists public.commission_countries (
  id         text primary key,
  name       text not null check (char_length(btrim(name)) between 2 and 80),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists commission_countries_name_key on public.commission_countries (lower(btrim(name)));

create table if not exists public.commission_providers (
  id         text primary key default gen_random_uuid()::text,
  name       text not null check (char_length(btrim(name)) between 1 and 120),
  notes      text check (char_length(notes) <= 500),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists commission_providers_name_key on public.commission_providers (lower(btrim(name)));

create table if not exists public.commission_tiers (
  id          text primary key,
  label       text not null,
  description text check (char_length(description) <= 300),
  sort        integer not null default 0,
  active      boolean not null default true
);
-- Labels only; the rates come from the commission records.
insert into public.commission_tiers (id, label, sort) values ('tier_1', 'Tier 1', 1), ('tier_2', 'Tier 2', 2), ('tier_3', 'Tier 3', 3)
on conflict (id) do nothing;

-- =============================================================== imports
create table if not exists public.commission_imports (
  id          text primary key default gen_random_uuid()::text,
  file_name   text not null,
  sheet_name  text,
  country_id  text references public.commission_countries (id),
  row_count   integer not null default 0,
  summary     jsonb not null default '{}',
  imported_by uuid,
  imported_at timestamptz not null default now()
);

-- =============================================================== master records (partner-facing fields)
create table if not exists public.commission_records (
  id               text primary key default gen_random_uuid()::text,
  source_key       text not null unique,       -- duplicate detection across imports
  country_id       text not null references public.commission_countries (id),
  university_name  text not null check (char_length(btrim(university_name)) between 2 and 200),
  university_id    text references public.universities (id) on delete set null,
  intake           text check (char_length(intake) <= 200),
  study_level      text check (char_length(study_level) <= 40),
  variant          text check (char_length(variant) <= 120),   -- campus / programme distinction from the sheet
  student_market   text check (char_length(student_market) <= 80),
  route            text not null default 'portal' check (route in ('direct', 'portal')),
  provider_id      text references public.commission_providers (id) on delete set null,
  provider_label   text check (char_length(provider_label) <= 120),  -- exactly as written in the sheet
  currency         text check (currency is null or currency ~ '^[A-Z]{3}$'),
  conditions       text check (char_length(conditions) <= 1000),     -- partner-safe conditions
  effective_from   date,
  effective_to     date,
  status           text not null default 'active' check (status in ('active', 'inactive')),
  needs_review     boolean not null default false,
  review_notes     text check (char_length(review_notes) <= 1000),
  source_import_id text references public.commission_imports (id) on delete set null,
  source_sheet     text,
  source_row       integer,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_by       uuid,
  updated_at       timestamptz not null default now(),
  constraint commission_records_dates check (effective_to is null or effective_from is null or effective_to >= effective_from)
);
create index if not exists commission_records_country_idx on public.commission_records (country_id, university_name);

-- Partner-facing tier rates (what a partner on that tier is offered).
create table if not exists public.commission_tier_rates (
  record_id    text not null references public.commission_records (id) on delete cascade,
  tier_id      text not null references public.commission_tiers (id),
  raw_value    text,                          -- the cell exactly as in the sheet
  value_kind   text not null check (value_kind in ('percent', 'amount', 'unclear')),
  value        numeric(14, 4),                -- percent (20 = 20%) or amount in currency
  currency     text check (currency is null or currency ~ '^[A-Z]{3}$'),
  note         text check (char_length(note) <= 300),
  needs_review boolean not null default false,
  primary key (record_id, tier_id),
  constraint tier_rate_value check (value_kind = 'unclear' or value is not null)
);

-- SSI GLOBAL's own commission, margin and the full source row: internal only.
create table if not exists public.commission_internal (
  record_id      text primary key references public.commission_records (id) on delete cascade,
  received_raw   text,
  received_kind  text check (received_kind in ('percent', 'amount', 'unclear')),
  received_value numeric(14, 4),
  margin_raw     text,
  margin_kind    text check (margin_kind in ('percent', 'amount', 'unclear')),
  margin_value   numeric(14, 4),
  internal_notes text check (char_length(internal_notes) <= 2000),
  source_row     jsonb not null default '{}',  -- every column of the sheet row, original headers
  updated_by     uuid,
  updated_at     timestamptz not null default now()
);

-- Previous versions of a record (before each change or import).
create table if not exists public.commission_record_versions (
  id         bigint generated always as identity primary key,
  record_id  text not null references public.commission_records (id) on delete cascade,
  import_id  text references public.commission_imports (id) on delete set null,
  snapshot   jsonb not null,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index if not exists commission_record_versions_idx on public.commission_record_versions (record_id, changed_at desc);

-- =============================================================== partner assignments
create table if not exists public.partner_commission_assignments (
  id               text primary key default gen_random_uuid()::text,
  partner_id       text not null references public.partners (id) on delete cascade,
  record_id        text not null references public.commission_records (id) on delete cascade,
  tier_id          text not null references public.commission_tiers (id),
  is_custom        boolean not null default false,
  custom_kind      text check (custom_kind in ('percent', 'amount')),
  custom_value     numeric(14, 4) check (custom_value is null or custom_value >= 0),
  custom_currency  text check (custom_currency is null or custom_currency ~ '^[A-Z]{3}$'),
  partner_conditions text check (char_length(partner_conditions) <= 1000),  -- shown to the partner
  internal_remarks text check (char_length(internal_remarks) <= 1000),      -- SSI only
  valid_from       date,
  valid_to         date,
  status           text not null default 'active' check (status in ('active', 'pending_approval', 'inactive', 'rejected')),
  replaces_id      text references public.partner_commission_assignments (id) on delete set null,
  assigned_by      uuid,
  assigned_at      timestamptz not null default now(),
  updated_by       uuid,
  updated_at       timestamptz not null default now(),
  decided_by       uuid,
  decided_at       timestamptz,
  decision_note    text check (char_length(decision_note) <= 300),
  constraint assignment_custom_shape check ((not is_custom and custom_kind is null and custom_value is null)
                                            or (is_custom and custom_kind is not null and custom_value is not null)),
  constraint assignment_dates check (valid_to is null or valid_from is null or valid_to >= valid_from)
);
create unique index if not exists partner_commission_active_key on public.partner_commission_assignments (partner_id, record_id) where status = 'active';
create unique index if not exists partner_commission_pending_key on public.partner_commission_assignments (partner_id, record_id) where status = 'pending_approval';
create index if not exists partner_commission_partner_idx on public.partner_commission_assignments (partner_id, status);

create table if not exists public.commission_assignment_history (
  id            bigint generated always as identity primary key,
  assignment_id text not null references public.partner_commission_assignments (id) on delete cascade,
  partner_id    text not null,
  record_id     text not null,
  action        text not null,
  actor         uuid,
  at            timestamptz not null default now(),
  before        jsonb,
  after         jsonb
);
create index if not exists commission_assignment_history_idx on public.commission_assignment_history (assignment_id, at);

-- Partner-readable "something changed" signal, so a Partner Admin's page refreshes live without
-- being able to subscribe to the confidential tables.
create table if not exists public.partner_commission_signals (
  partner_id text primary key references public.partners (id) on delete cascade,
  changed_at timestamptz not null default now()
);

-- =============================================================== applications
-- The commission that applies to an application lives in its own staff-only table, so partners
-- (who can read their applications) never receive commission references.
create table if not exists public.application_commissions (
  application_id text primary key references public.applications (id) on delete cascade,
  match          text not null check (match in ('matched', 'ambiguous', 'none', 'confirmed')),
  record_id      text references public.commission_records (id) on delete set null,
  assignment_id  text references public.partner_commission_assignments (id) on delete set null,
  candidates     integer not null default 0,
  confirmed_by   uuid,
  updated_at     timestamptz not null default now()
);

-- =============================================================== row level security
do $$
declare t text;
begin
  foreach t in array array['commission_countries', 'commission_providers', 'commission_tiers', 'commission_imports', 'commission_records',
                           'commission_tier_rates', 'commission_internal', 'commission_record_versions', 'partner_commission_assignments',
                           'commission_assignment_history', 'partner_commission_signals', 'application_commissions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
grant insert, update on public.commission_countries, public.commission_providers, public.commission_tiers to authenticated;

drop policy if exists "commission countries: read" on public.commission_countries;
drop policy if exists "commission countries: edit" on public.commission_countries;
drop policy if exists "commission countries: update" on public.commission_countries;
create policy "commission countries: read" on public.commission_countries for select to authenticated using (public.commission_can('commission_view'));
create policy "commission countries: edit" on public.commission_countries for insert to authenticated with check (public.commission_can('commission_edit'));
create policy "commission countries: update" on public.commission_countries for update to authenticated using (public.commission_can('commission_edit')) with check (public.commission_can('commission_edit'));

drop policy if exists "commission providers: read" on public.commission_providers;
drop policy if exists "commission providers: edit" on public.commission_providers;
drop policy if exists "commission providers: update" on public.commission_providers;
create policy "commission providers: read" on public.commission_providers for select to authenticated using (public.commission_can('commission_view'));
create policy "commission providers: edit" on public.commission_providers for insert to authenticated with check (public.commission_can('commission_edit'));
create policy "commission providers: update" on public.commission_providers for update to authenticated using (public.commission_can('commission_edit')) with check (public.commission_can('commission_edit'));

drop policy if exists "commission tiers: read" on public.commission_tiers;
drop policy if exists "commission tiers: update" on public.commission_tiers;
create policy "commission tiers: read" on public.commission_tiers for select to authenticated using (public.commission_can('commission_view'));
create policy "commission tiers: update" on public.commission_tiers for update to authenticated using (public.commission_can('commission_edit')) with check (public.commission_can('commission_edit'));

drop policy if exists "commission imports: read" on public.commission_imports;
create policy "commission imports: read" on public.commission_imports for select to authenticated using (public.commission_can('commission_edit'));

drop policy if exists "commission records: read" on public.commission_records;
create policy "commission records: read" on public.commission_records for select to authenticated using (public.commission_can('commission_view'));
drop policy if exists "commission tier rates: read" on public.commission_tier_rates;
create policy "commission tier rates: read" on public.commission_tier_rates for select to authenticated using (public.commission_can('commission_view'));
drop policy if exists "commission internal: read" on public.commission_internal;
create policy "commission internal: read" on public.commission_internal for select to authenticated using (public.commission_can('commission_internal'));
drop policy if exists "commission versions: read" on public.commission_record_versions;
create policy "commission versions: read" on public.commission_record_versions for select to authenticated
  using (public.commission_can('commission_internal') and public.commission_can('commission_edit'));

drop policy if exists "partner assignments: staff read" on public.partner_commission_assignments;
create policy "partner assignments: staff read" on public.partner_commission_assignments for select to authenticated using (public.commission_can('commission_view'));
drop policy if exists "assignment history: staff read" on public.commission_assignment_history;
create policy "assignment history: staff read" on public.commission_assignment_history for select to authenticated using (public.commission_can('commission_view'));

drop policy if exists "commission signal: own partner" on public.partner_commission_signals;
create policy "commission signal: own partner" on public.partner_commission_signals for select to authenticated
  using (public.can_view_commission(partner_id) or public.commission_can('commission_view'));

drop policy if exists "application commissions: staff read" on public.application_commissions;
create policy "application commissions: staff read" on public.application_commissions for select to authenticated using (public.commission_can('commission_view'));

-- Records, rates, internal values and assignments change only through the functions below.

-- =============================================================== helpers
create or replace function public.commission_slug(p text)
returns text language sql immutable set search_path = '' as $$
  select trim(both '_' from regexp_replace(lower(btrim(coalesce(p, ''))), '[^a-z0-9]+', '_', 'g'));
$$;

create or replace function public.commission_snapshot(p_record text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'record', (select to_jsonb(r) from public.commission_records r where r.id = p_record),
    'tiers', (select coalesce(jsonb_agg(to_jsonb(t) order by t.tier_id), '[]') from public.commission_tier_rates t where t.record_id = p_record),
    'internal', (select to_jsonb(i) - 'source_row' from public.commission_internal i where i.record_id = p_record));
$$;
revoke all on function public.commission_snapshot(text) from public, anon, authenticated;

create or replace function public.touch_partner_commission_signal(p_partner text)
returns void language sql security definer set search_path = '' as $$
  insert into public.partner_commission_signals (partner_id, changed_at) values (p_partner, now())
  on conflict (partner_id) do update set changed_at = now();
$$;
revoke all on function public.touch_partner_commission_signal(text) from public, anon, authenticated;

-- Assignment history and the partner signal on every change.
create or replace function public.log_partner_commission_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.commission_assignment_history (assignment_id, partner_id, record_id, action, actor, before, after)
  values (new.id, new.partner_id, new.record_id,
          case when tg_op = 'INSERT' then case when new.status = 'pending_approval' then 'tag_requested' when new.is_custom then 'custom_assigned' else 'assigned' end
               when new.status is distinct from old.status then new.status
               when new.is_custom is distinct from old.is_custom or new.custom_value is distinct from old.custom_value then 'custom_changed'
               when new.tier_id is distinct from old.tier_id then 'tier_changed'
               else 'edited' end,
          auth.uid(), case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  perform public.touch_partner_commission_signal(new.partner_id);
  return new;
end $$;
drop trigger if exists partner_commission_assignments_log on public.partner_commission_assignments;
create trigger partner_commission_assignments_log after insert or update on public.partner_commission_assignments
  for each row execute function public.log_partner_commission_assignment();

-- A master record change refreshes every partner tagged to it.
create or replace function public.signal_commission_record()
returns trigger language plpgsql security definer set search_path = '' as $$
declare rid text := coalesce(new.record_id, old.record_id);
begin
  perform public.touch_partner_commission_signal(a.partner_id) from public.partner_commission_assignments a where a.record_id = rid and a.status = 'active';
  return coalesce(new, old);
end $$;
create or replace function public.signal_commission_record_row()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.touch_partner_commission_signal(a.partner_id) from public.partner_commission_assignments a where a.record_id = new.id and a.status = 'active';
  return new;
end $$;
drop trigger if exists commission_tier_rates_signal on public.commission_tier_rates;
create trigger commission_tier_rates_signal after insert or update or delete on public.commission_tier_rates
  for each row execute function public.signal_commission_record();
drop trigger if exists commission_records_signal on public.commission_records;
create trigger commission_records_signal after update on public.commission_records
  for each row execute function public.signal_commission_record_row();

-- =============================================================== master records
-- Saves the partner-facing part of a record and its tier rates (commission_edit), and the
-- internal part only when the caller may see internal values. Keeps the previous version.
create or replace function public.save_commission_record(p_id text, p_record jsonb, p_tiers jsonb, p_internal jsonb default null)
returns text language plpgsql security definer set search_path = '' as $$
declare rid text := p_id; c text; prov text; t jsonb; exists_before boolean;
begin
  if not public.commission_can('commission_edit') then raise exception 'You cannot edit commission records'; end if;
  if p_internal is not null and not public.commission_can('commission_internal') then raise exception 'You cannot edit internal commission values'; end if;
  c := p_record ->> 'country_id';
  if c is null or not exists (select 1 from public.commission_countries where id = c) then raise exception 'Choose a country'; end if;
  if char_length(btrim(coalesce(p_record ->> 'university_name', ''))) < 2 then raise exception 'Enter the university'; end if;
  if coalesce(p_record ->> 'route', 'portal') not in ('direct', 'portal') then raise exception 'Unknown application route'; end if;
  prov := nullif(p_record ->> 'provider_id', '');
  if (p_record ->> 'route') = 'portal' and prov is null and nullif(btrim(coalesce(p_record ->> 'provider_label', '')), '') is null then
    raise exception 'Choose the portal provider';
  end if;
  exists_before := rid is not null and exists (select 1 from public.commission_records where id = rid);
  if exists_before then
    insert into public.commission_record_versions (record_id, snapshot, changed_by) values (rid, public.commission_snapshot(rid), auth.uid());
    update public.commission_records set country_id = c, university_name = btrim(p_record ->> 'university_name'),
      university_id = nullif(p_record ->> 'university_id', ''), intake = nullif(btrim(coalesce(p_record ->> 'intake', '')), ''),
      study_level = nullif(btrim(coalesce(p_record ->> 'study_level', '')), ''), variant = nullif(btrim(coalesce(p_record ->> 'variant', '')), ''),
      student_market = nullif(btrim(coalesce(p_record ->> 'student_market', '')), ''), route = coalesce(p_record ->> 'route', 'portal'),
      provider_id = case when coalesce(p_record ->> 'route', 'portal') = 'direct' then null else prov end,
      provider_label = case when coalesce(p_record ->> 'route', 'portal') = 'direct' then null else nullif(btrim(coalesce(p_record ->> 'provider_label', '')), '') end,
      currency = nullif(upper(btrim(coalesce(p_record ->> 'currency', ''))), ''), conditions = nullif(btrim(coalesce(p_record ->> 'conditions', '')), ''),
      effective_from = nullif(p_record ->> 'effective_from', '')::date, effective_to = nullif(p_record ->> 'effective_to', '')::date,
      status = coalesce(p_record ->> 'status', 'active'), needs_review = coalesce((p_record ->> 'needs_review')::boolean, false),
      review_notes = nullif(btrim(coalesce(p_record ->> 'review_notes', '')), ''), updated_by = auth.uid(), updated_at = now()
    where id = rid;
  else
    insert into public.commission_records (source_key, country_id, university_name, university_id, intake, study_level, variant, student_market, route,
      provider_id, provider_label, currency, conditions, effective_from, effective_to, status, needs_review, review_notes, created_by, updated_by)
    values (coalesce(nullif(p_record ->> 'source_key', ''), 'manual:' || gen_random_uuid()::text), c, btrim(p_record ->> 'university_name'),
      nullif(p_record ->> 'university_id', ''), nullif(btrim(coalesce(p_record ->> 'intake', '')), ''), nullif(btrim(coalesce(p_record ->> 'study_level', '')), ''),
      nullif(btrim(coalesce(p_record ->> 'variant', '')), ''), nullif(btrim(coalesce(p_record ->> 'student_market', '')), ''), coalesce(p_record ->> 'route', 'portal'),
      case when coalesce(p_record ->> 'route', 'portal') = 'direct' then null else prov end,
      case when coalesce(p_record ->> 'route', 'portal') = 'direct' then null else nullif(btrim(coalesce(p_record ->> 'provider_label', '')), '') end,
      nullif(upper(btrim(coalesce(p_record ->> 'currency', ''))), ''), nullif(btrim(coalesce(p_record ->> 'conditions', '')), ''),
      nullif(p_record ->> 'effective_from', '')::date, nullif(p_record ->> 'effective_to', '')::date, coalesce(p_record ->> 'status', 'active'),
      coalesce((p_record ->> 'needs_review')::boolean, false), nullif(btrim(coalesce(p_record ->> 'review_notes', '')), ''), auth.uid(), auth.uid())
    returning id into rid;
  end if;
  if p_tiers is not null then
    for t in select * from jsonb_array_elements(p_tiers) loop
      if not exists (select 1 from public.commission_tiers where id = t ->> 'tier_id') then raise exception 'Unknown tier'; end if;
      insert into public.commission_tier_rates (record_id, tier_id, raw_value, value_kind, value, currency, note, needs_review)
      values (rid, t ->> 'tier_id', t ->> 'raw_value', t ->> 'value_kind', nullif(t ->> 'value', '')::numeric, nullif(upper(coalesce(t ->> 'currency', '')), ''),
              nullif(t ->> 'note', ''), coalesce((t ->> 'needs_review')::boolean, false))
      on conflict (record_id, tier_id) do update set raw_value = excluded.raw_value, value_kind = excluded.value_kind, value = excluded.value,
        currency = excluded.currency, note = excluded.note, needs_review = excluded.needs_review;
    end loop;
  end if;
  if p_internal is not null then
    insert into public.commission_internal (record_id, received_raw, received_kind, received_value, margin_raw, margin_kind, margin_value, internal_notes, source_row, updated_by)
    values (rid, p_internal ->> 'received_raw', nullif(p_internal ->> 'received_kind', ''), nullif(p_internal ->> 'received_value', '')::numeric,
            p_internal ->> 'margin_raw', nullif(p_internal ->> 'margin_kind', ''), nullif(p_internal ->> 'margin_value', '')::numeric,
            nullif(p_internal ->> 'internal_notes', ''), coalesce(p_internal -> 'source_row', '{}'), auth.uid())
    on conflict (record_id) do update set received_raw = excluded.received_raw, received_kind = excluded.received_kind, received_value = excluded.received_value,
      margin_raw = excluded.margin_raw, margin_kind = excluded.margin_kind, margin_value = excluded.margin_value, internal_notes = excluded.internal_notes,
      source_row = case when excluded.source_row = '{}'::jsonb then public.commission_internal.source_row else excluded.source_row end,
      updated_by = auth.uid(), updated_at = now();
  end if;
  return rid;
end $$;

-- =============================================================== sheet import
-- p_rows: rows parsed from the sheet by the app (src/lib/commissionImport.ts), one object per
-- source row with source_key, partner-facing fields, tiers[], internal{} and source_row{}.
-- Preview never writes; apply needs p_confirm when standard partner agreements would see new rates.
create or replace function public.preview_commission_import(p_country_name text, p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare cid text := public.commission_slug(p_country_name); r jsonb; rec record; out jsonb := '[]'; changes jsonb; t jsonb; old_t record;
  n_new int := 0; n_changed int := 0; n_same int := 0; affected int := 0; keys text[] := '{}'; new_providers text[] := '{}'; new_unis text[] := '{}';
begin
  if not (public.commission_can('commission_edit') and public.commission_can('commission_internal')) then raise exception 'You cannot import commission sheets'; end if;
  if char_length(btrim(coalesce(p_country_name, ''))) < 2 then raise exception 'Choose the destination country'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if (r ->> 'source_key') = any (keys) then
      out := out || jsonb_build_object('source_row', r -> 'source_row_number', 'university', r ->> 'university_name', 'status', 'duplicate_in_sheet');
      continue;
    end if;
    keys := keys || (r ->> 'source_key');
    if nullif(r ->> 'provider_label', '') is not null and not exists (select 1 from public.commission_providers p where lower(p.name) = lower(btrim(r ->> 'provider_label')))
       and not (lower(btrim(r ->> 'provider_label')) = any (new_providers)) and position('/' in (r ->> 'provider_label')) = 0 then
      new_providers := new_providers || lower(btrim(r ->> 'provider_label'));
    end if;
    select * into rec from public.commission_records where source_key = r ->> 'source_key';
    if rec.id is null then
      n_new := n_new + 1;
      if not exists (select 1 from public.commission_records x where lower(x.university_name) = lower(btrim(r ->> 'university_name'))) then
        new_unis := array(select distinct unnest(new_unis || (r ->> 'university_name')));
      end if;
      out := out || jsonb_build_object('source_row', r -> 'source_row_number', 'university', r ->> 'university_name', 'provider', r ->> 'provider_label', 'status', 'new');
    else
      changes := '[]';
      if rec.intake is distinct from nullif(r ->> 'intake', '') then changes := changes || jsonb_build_object('field', 'Intake', 'from', rec.intake, 'to', r ->> 'intake'); end if;
      if rec.provider_label is distinct from nullif(r ->> 'provider_label', '') then changes := changes || jsonb_build_object('field', 'Portal', 'from', rec.provider_label, 'to', r ->> 'provider_label'); end if;
      if rec.currency is distinct from nullif(r ->> 'currency', '') then changes := changes || jsonb_build_object('field', 'Currency', 'from', rec.currency, 'to', r ->> 'currency'); end if;
      if rec.conditions is distinct from nullif(r ->> 'conditions', '') then changes := changes || jsonb_build_object('field', 'Conditions', 'from', rec.conditions, 'to', r ->> 'conditions'); end if;
      for t in select * from jsonb_array_elements(coalesce(r -> 'tiers', '[]')) loop
        select * into old_t from public.commission_tier_rates where record_id = rec.id and tier_id = t ->> 'tier_id';
        if old_t.raw_value is distinct from (t ->> 'raw_value') or old_t.value is distinct from nullif(t ->> 'value', '')::numeric or old_t.value_kind is distinct from (t ->> 'value_kind') then
          changes := changes || jsonb_build_object('field', (select label from public.commission_tiers where id = t ->> 'tier_id'), 'from', old_t.raw_value, 'to', t ->> 'raw_value', 'tier', true);
        end if;
      end loop;
      if (select received_raw from public.commission_internal where record_id = rec.id) is distinct from (r -> 'internal' ->> 'received_raw') then
        changes := changes || jsonb_build_object('field', 'SSI GLOBAL commission', 'from', (select received_raw from public.commission_internal where record_id = rec.id), 'to', r -> 'internal' ->> 'received_raw', 'internal', true);
      end if;
      if (select margin_raw from public.commission_internal where record_id = rec.id) is distinct from (r -> 'internal' ->> 'margin_raw') then
        changes := changes || jsonb_build_object('field', 'Profit', 'from', (select margin_raw from public.commission_internal where record_id = rec.id), 'to', r -> 'internal' ->> 'margin_raw', 'internal', true);
      end if;
      if jsonb_array_length(changes) = 0 then
        n_same := n_same + 1;
      else
        n_changed := n_changed + 1;
        if exists (select 1 from jsonb_array_elements(changes) e where (e ->> 'tier')::boolean) then
          affected := affected + (select count(*) from public.partner_commission_assignments a where a.record_id = rec.id and a.status = 'active' and not a.is_custom);
        end if;
        out := out || jsonb_build_object('source_row', r -> 'source_row_number', 'university', r ->> 'university_name', 'provider', r ->> 'provider_label', 'status', 'changed', 'changes', changes,
          'standard_assignments', (select count(*) from public.partner_commission_assignments a where a.record_id = rec.id and a.status = 'active' and not a.is_custom),
          'custom_assignments', (select count(*) from public.partner_commission_assignments a where a.record_id = rec.id and a.status = 'active' and a.is_custom));
      end if;
    end if;
  end loop;
  return jsonb_build_object(
    'country', jsonb_build_object('id', cid, 'name', btrim(p_country_name), 'new', not exists (select 1 from public.commission_countries where id = cid)),
    'counts', jsonb_build_object('rows', jsonb_array_length(p_rows), 'new', n_new, 'changed', n_changed, 'unchanged', n_same),
    'new_providers', to_jsonb(new_providers), 'new_universities', to_jsonb(new_unis),
    'not_in_sheet', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'university', x.university_name, 'provider', x.provider_label)), '[]')
                     from public.commission_records x where x.country_id = cid and x.status = 'active' and x.source_key like 'sheet:%' and not (x.source_key = any (keys))),
    'affected_standard_assignments', affected,
    'rows', out);
end $$;

create or replace function public.apply_commission_import(p_country_name text, p_file_name text, p_sheet_name text, p_rows jsonb, p_confirm_partner_changes boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cid text := public.commission_slug(p_country_name); pv jsonb; iid text; r jsonb; rid text; prov text; t jsonb; uni text; seen text[] := '{}';
  n_new int := 0; n_changed int := 0;
begin
  if not (public.commission_can('commission_edit') and public.commission_can('commission_internal')) then raise exception 'You cannot import commission sheets'; end if;
  pv := public.preview_commission_import(p_country_name, p_rows);
  if (pv ->> 'affected_standard_assignments')::int > 0 and not coalesce(p_confirm_partner_changes, false) then
    raise exception 'CONFIRM_PARTNER_CHANGES: % partner agreement(s) on standard tiers would get new rates. Review and confirm.', pv ->> 'affected_standard_assignments';
  end if;
  insert into public.commission_countries (id, name) values (cid, btrim(p_country_name)) on conflict (id) do nothing;
  insert into public.commission_imports (file_name, sheet_name, country_id, row_count, summary, imported_by)
  values (left(coalesce(p_file_name, 'sheet'), 200), left(p_sheet_name, 120), cid, jsonb_array_length(p_rows), pv - 'rows', auth.uid())
  returning id into iid;
  for r in select * from jsonb_array_elements(p_rows) loop
    continue when (r ->> 'source_key') = any (seen);
    seen := seen || (r ->> 'source_key');
    prov := null;
    if nullif(btrim(coalesce(r ->> 'provider_label', '')), '') is not null and position('/' in (r ->> 'provider_label')) = 0 then
      select id into prov from public.commission_providers where lower(name) = lower(btrim(r ->> 'provider_label'));
      if prov is null then
        insert into public.commission_providers (name) values (btrim(r ->> 'provider_label')) returning id into prov;
      end if;
    end if;
    select u.id into uni from public.universities u where lower(btrim(u.name)) = lower(btrim(r ->> 'university_name')) limit 1;
    select id into rid from public.commission_records where source_key = r ->> 'source_key';
    if rid is null then n_new := n_new + 1; else
      if exists (select 1 from jsonb_array_elements(pv -> 'rows') e where e ->> 'status' = 'changed' and (e ->> 'source_row') = (r ->> 'source_row_number')) then
        n_changed := n_changed + 1;
        insert into public.commission_record_versions (record_id, import_id, snapshot, changed_by) values (rid, iid, public.commission_snapshot(rid), auth.uid());
      end if;
    end if;
    insert into public.commission_records (source_key, country_id, university_name, university_id, intake, study_level, variant, student_market, route,
      provider_id, provider_label, currency, conditions, needs_review, review_notes, source_import_id, source_sheet, source_row, created_by, updated_by)
    values (r ->> 'source_key', cid, btrim(r ->> 'university_name'), uni, nullif(r ->> 'intake', ''), nullif(r ->> 'study_level', ''), nullif(r ->> 'variant', ''),
      nullif(r ->> 'student_market', ''), coalesce(r ->> 'route', 'portal'), prov, nullif(btrim(coalesce(r ->> 'provider_label', '')), ''),
      nullif(r ->> 'currency', ''), nullif(r ->> 'conditions', ''), coalesce((r ->> 'needs_review')::boolean, false), nullif(r ->> 'review_notes', ''),
      iid, left(p_sheet_name, 120), (r ->> 'source_row_number')::int, auth.uid(), auth.uid())
    on conflict (source_key) do update set university_name = excluded.university_name, university_id = coalesce(excluded.university_id, public.commission_records.university_id),
      intake = excluded.intake, study_level = excluded.study_level, variant = excluded.variant, student_market = excluded.student_market, route = excluded.route,
      provider_id = excluded.provider_id, provider_label = excluded.provider_label, currency = excluded.currency, conditions = excluded.conditions,
      needs_review = excluded.needs_review, review_notes = excluded.review_notes, source_import_id = excluded.source_import_id,
      source_sheet = excluded.source_sheet, source_row = excluded.source_row, updated_by = auth.uid(), updated_at = now()
    returning id into rid;
    for t in select * from jsonb_array_elements(coalesce(r -> 'tiers', '[]')) loop
      insert into public.commission_tier_rates (record_id, tier_id, raw_value, value_kind, value, currency, note, needs_review)
      values (rid, t ->> 'tier_id', t ->> 'raw_value', t ->> 'value_kind', nullif(t ->> 'value', '')::numeric, nullif(t ->> 'currency', ''), nullif(t ->> 'note', ''),
              coalesce((t ->> 'needs_review')::boolean, false))
      on conflict (record_id, tier_id) do update set raw_value = excluded.raw_value, value_kind = excluded.value_kind, value = excluded.value,
        currency = excluded.currency, note = excluded.note, needs_review = excluded.needs_review;
    end loop;
    insert into public.commission_internal (record_id, received_raw, received_kind, received_value, margin_raw, margin_kind, margin_value, source_row, updated_by)
    values (rid, r -> 'internal' ->> 'received_raw', nullif(r -> 'internal' ->> 'received_kind', ''), nullif(r -> 'internal' ->> 'received_value', '')::numeric,
            r -> 'internal' ->> 'margin_raw', nullif(r -> 'internal' ->> 'margin_kind', ''), nullif(r -> 'internal' ->> 'margin_value', '')::numeric,
            coalesce(r -> 'source_row', '{}'), auth.uid())
    on conflict (record_id) do update set received_raw = excluded.received_raw, received_kind = excluded.received_kind, received_value = excluded.received_value,
      margin_raw = excluded.margin_raw, margin_kind = excluded.margin_kind, margin_value = excluded.margin_value, source_row = excluded.source_row,
      updated_by = auth.uid(), updated_at = now();
  end loop;
  update public.commission_imports set summary = summary || jsonb_build_object('applied_new', n_new, 'applied_changed', n_changed) where id = iid;
  perform public.match_application_commissions(null);
  return jsonb_build_object('import_id', iid, 'new', n_new, 'changed', n_changed);
end $$;

-- =============================================================== agency tagging and assignments
-- Tag a partner to a record with a standard tier. New tags by taggers are active; replacing an
-- existing agreement is active only for commission_manage, otherwise it waits for approval.
create or replace function public.tag_partner_commission(p_partner text, p_record text, p_tier text, p_valid_from date default null,
                                                         p_valid_to date default null, p_partner_conditions text default null, p_remarks text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cur record; manage boolean := public.commission_can('commission_manage'); aid text; st text;
begin
  if not public.commission_can('commission_tag') then raise exception 'You cannot tag agencies to commissions'; end if;
  if not exists (select 1 from public.partners where id = p_partner) then raise exception 'Partner agency not found'; end if;
  if not exists (select 1 from public.commission_records where id = p_record and status = 'active') then raise exception 'Commission record not found or inactive'; end if;
  if not exists (select 1 from public.commission_tiers where id = p_tier and active) then raise exception 'Choose a commission tier'; end if;
  if not exists (select 1 from public.commission_tier_rates where record_id = p_record and tier_id = p_tier) then raise exception 'This record has no rate for that tier'; end if;
  if p_valid_to is not null and p_valid_from is not null and p_valid_to < p_valid_from then raise exception 'The end date is before the start date'; end if;
  perform pg_advisory_xact_lock(hashtext('commission:' || p_partner || ':' || p_record));
  select * into cur from public.partner_commission_assignments where partner_id = p_partner and record_id = p_record and status = 'active';
  if cur.id is not null and cur.tier_id = p_tier and not cur.is_custom then
    raise exception 'This agency already has % on this record', (select label from public.commission_tiers where id = p_tier);
  end if;
  if exists (select 1 from public.partner_commission_assignments where partner_id = p_partner and record_id = p_record and status = 'pending_approval') then
    raise exception 'A change for this agency and record is already waiting for approval';
  end if;
  st := case when cur.id is null or manage then 'active' else 'pending_approval' end;
  if st = 'active' and cur.id is not null then
    update public.partner_commission_assignments set status = 'inactive', updated_by = auth.uid(), updated_at = now(), decision_note = 'Replaced' where id = cur.id;
  end if;
  insert into public.partner_commission_assignments (partner_id, record_id, tier_id, partner_conditions, internal_remarks, valid_from, valid_to, status,
                                                     replaces_id, assigned_by, updated_by, decided_by, decided_at)
  values (p_partner, p_record, p_tier, nullif(btrim(coalesce(p_partner_conditions, '')), ''), nullif(btrim(coalesce(p_remarks, '')), ''), p_valid_from, p_valid_to, st,
          cur.id, auth.uid(), auth.uid(), case when st = 'active' then auth.uid() end, case when st = 'active' then now() end)
  returning id into aid;
  if st = 'pending_approval' then
    perform public.notify(array(select p.id from public.profiles p where p.status = 'active'
                                  and (p.role = 'super_admin' or 'commission_manage' = any (coalesce(p.permissions, '{}')))),
      'finance', 'Commission change waiting for approval', (select name from public.partners where id = p_partner), 'commissions');
  end if;
  perform public.match_application_commissions(p_partner);
  return jsonb_build_object('id', aid, 'status', st);
end $$;

-- Custom agreement for one partner (commission_manage). The master record is never changed.
create or replace function public.set_custom_partner_commission(p_partner text, p_record text, p_tier text, p_kind text, p_value numeric, p_currency text,
                                                                p_valid_from date default null, p_valid_to date default null,
                                                                p_partner_conditions text default null, p_remarks text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare cur record; aid text;
begin
  if not public.commission_can('commission_manage') then raise exception 'Only commission managers can set custom commissions'; end if;
  if not exists (select 1 from public.partners where id = p_partner) then raise exception 'Partner agency not found'; end if;
  if not exists (select 1 from public.commission_records where id = p_record and status = 'active') then raise exception 'Commission record not found or inactive'; end if;
  if not exists (select 1 from public.commission_tiers where id = p_tier) then raise exception 'Choose a commission tier'; end if;
  if p_kind not in ('percent', 'amount') then raise exception 'Choose percentage or fixed amount'; end if;
  if p_value is null or p_value < 0 or (p_kind = 'percent' and p_value > 100) then raise exception 'Enter a valid commission value'; end if;
  if p_kind = 'amount' and coalesce(p_currency, '') !~ '^[A-Z]{3}$' then raise exception 'Choose the currency of the amount'; end if;
  if length(btrim(coalesce(p_remarks, ''))) < 3 then raise exception 'Add an internal remark explaining the agreement'; end if;
  if p_valid_to is not null and p_valid_from is not null and p_valid_to < p_valid_from then raise exception 'The end date is before the start date'; end if;
  perform pg_advisory_xact_lock(hashtext('commission:' || p_partner || ':' || p_record));
  select * into cur from public.partner_commission_assignments where partner_id = p_partner and record_id = p_record and status = 'active';
  if cur.id is not null then
    update public.partner_commission_assignments set status = 'inactive', updated_by = auth.uid(), updated_at = now(), decision_note = 'Replaced by custom agreement' where id = cur.id;
  end if;
  update public.partner_commission_assignments set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = 'Superseded by custom agreement'
  where partner_id = p_partner and record_id = p_record and status = 'pending_approval';
  insert into public.partner_commission_assignments (partner_id, record_id, tier_id, is_custom, custom_kind, custom_value, custom_currency, partner_conditions,
                                                     internal_remarks, valid_from, valid_to, status, replaces_id, assigned_by, updated_by, decided_by, decided_at)
  values (p_partner, p_record, p_tier, true, p_kind, p_value, case when p_kind = 'amount' then p_currency end, nullif(btrim(coalesce(p_partner_conditions, '')), ''),
          btrim(p_remarks), p_valid_from, p_valid_to, 'active', cur.id, auth.uid(), auth.uid(), auth.uid(), now())
  returning id into aid;
  perform public.match_application_commissions(p_partner);
  return aid;
end $$;

create or replace function public.decide_partner_commission(p_id text, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  if not public.commission_can('commission_manage') then raise exception 'Only commission managers can approve changes'; end if;
  select * into a from public.partner_commission_assignments where id = p_id for update;
  if a.id is null or a.status <> 'pending_approval' then raise exception 'Nothing to approve'; end if;
  if a.assigned_by = auth.uid() and not public.is_super_admin() then raise exception 'Someone else must approve your own change'; end if;
  if not p_approve and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Say why the change is rejected'; end if;
  if p_approve then
    update public.partner_commission_assignments set status = 'inactive', updated_by = auth.uid(), updated_at = now(), decision_note = 'Replaced'
    where partner_id = a.partner_id and record_id = a.record_id and status = 'active';
  end if;
  update public.partner_commission_assignments set status = case when p_approve then 'active' else 'rejected' end, decided_by = auth.uid(), decided_at = now(),
    decision_note = nullif(btrim(coalesce(p_note, '')), ''), updated_by = auth.uid(), updated_at = now() where id = p_id;
  perform public.notify(array[a.assigned_by], 'finance', 'Commission change ' || case when p_approve then 'approved' else 'rejected' end,
                        (select name from public.partners where id = a.partner_id), 'commissions');
  perform public.match_application_commissions(a.partner_id);
end $$;

create or replace function public.deactivate_partner_commission(p_id text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select * into a from public.partner_commission_assignments where id = p_id for update;
  if a.id is null then raise exception 'Assignment not found'; end if;
  if not (public.commission_can('commission_manage') or (a.status = 'pending_approval' and a.assigned_by = auth.uid() and public.commission_can('commission_tag'))) then
    raise exception 'Only commission managers can end an agreement';
  end if;
  if a.status not in ('active', 'pending_approval') then raise exception 'This agreement is already closed'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Enter a reason'; end if;
  update public.partner_commission_assignments set status = 'inactive', decision_note = btrim(p_reason), updated_by = auth.uid(), updated_at = now() where id = p_id;
  perform public.match_application_commissions(a.partner_id);
end $$;

-- =============================================================== partner view
-- What a Partner Admin may see: their own active agreements and the one rate that applies.
create or replace function public.my_partner_commissions()
returns table (assignment_id text, country text, university text, intake text, study_level text, variant text, route text, provider text,
               tier text, is_custom boolean, commission_kind text, commission_value numeric, currency text, raw_value text,
               conditions text, valid_from date, valid_to date, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id, c.name, r.university_name, r.intake, r.study_level, r.variant, r.route, coalesce(p.name, r.provider_label),
         t.label, a.is_custom,
         case when a.is_custom then a.custom_kind else tr.value_kind end,
         case when a.is_custom then a.custom_value else tr.value end,
         case when a.is_custom then a.custom_currency else coalesce(tr.currency, r.currency) end,
         case when a.is_custom then null else tr.raw_value end,
         concat_ws(E'\n', nullif(r.conditions, ''), nullif(tr.note, ''), nullif(a.partner_conditions, '')),
         a.valid_from, a.valid_to, a.updated_at
  from public.partner_commission_assignments a
  join public.commission_records r on r.id = a.record_id and r.status = 'active'
  join public.commission_countries c on c.id = r.country_id
  join public.commission_tiers t on t.id = a.tier_id
  left join public.commission_tier_rates tr on tr.record_id = a.record_id and tr.tier_id = a.tier_id
  left join public.commission_providers p on p.id = r.provider_id
  where a.status = 'active' and a.partner_id = public.my_partner_id() and public.is_partner_admin()
    and public.can_view_commission(a.partner_id)
    and (a.valid_to is null or a.valid_to >= public.company_today())
  order by c.name, r.university_name;
$$;
revoke all on function public.my_partner_commissions() from public, anon;
grant execute on function public.my_partner_commissions() to authenticated;

-- =============================================================== applications
-- Links applications to the commission that applies to their partner and university: exactly one
-- active agreement → matched; several (different portals, levels or campuses) → ambiguous, for a
-- commission manager to choose; none → none. A confirmed choice is never changed automatically.
create or replace function public.match_application_commissions(p_partner text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.application_commissions (application_id, match, record_id, assignment_id, candidates)
  select ap.id,
         case when count(a.id) = 1 then 'matched' when count(a.id) > 1 then 'ambiguous' else 'none' end,
         case when count(a.id) = 1 then min(a.record_id) end,
         case when count(a.id) = 1 then min(a.id) end,
         count(a.id)
  from public.applications ap
  left join public.commission_records r on r.university_id = ap.university_id and r.status = 'active'
  left join public.partner_commission_assignments a on a.record_id = r.id and a.partner_id = ap.partner_id and a.status = 'active'
  where p_partner is null or ap.partner_id = p_partner
  group by ap.id
  on conflict (application_id) do update set match = excluded.match, record_id = excluded.record_id, assignment_id = excluded.assignment_id,
    candidates = excluded.candidates, updated_at = now()
  where public.application_commissions.match <> 'confirmed'
    and (public.application_commissions.match, public.application_commissions.assignment_id, public.application_commissions.candidates)
        is distinct from (excluded.match, excluded.assignment_id, excluded.candidates);
end $$;
revoke all on function public.match_application_commissions(text) from public, anon, authenticated;

create or replace function public.applications_commission_match()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.university_id is not distinct from old.university_id and new.partner_id is not distinct from old.partner_id then return new; end if;
  -- A changed university or partner makes any earlier confirmation stale.
  delete from public.application_commissions where application_id = new.id and tg_op = 'UPDATE';
  insert into public.application_commissions (application_id, match, record_id, assignment_id, candidates)
  select new.id, case when count(a.id) = 1 then 'matched' when count(a.id) > 1 then 'ambiguous' else 'none' end,
         case when count(a.id) = 1 then min(a.record_id) end, case when count(a.id) = 1 then min(a.id) end, count(a.id)
  from public.commission_records r
  join public.partner_commission_assignments a on a.record_id = r.id and a.partner_id = new.partner_id and a.status = 'active'
  where r.university_id = new.university_id and r.status = 'active'
  on conflict (application_id) do nothing;
  return new;
end $$;
drop trigger if exists applications_commission_match on public.applications;
create trigger applications_commission_match after insert or update on public.applications
  for each row execute function public.applications_commission_match();

-- A commission manager picks the right agreement (or none) for an application.
create or replace function public.confirm_application_commission(p_application text, p_assignment text)
returns void language plpgsql security definer set search_path = '' as $$
declare ap_partner text; a_partner text; a_record text;
begin
  if not public.commission_can('commission_manage') then raise exception 'Only commission managers can confirm application commissions'; end if;
  select partner_id into ap_partner from public.applications where id = p_application;
  if ap_partner is null then raise exception 'Application not found'; end if;
  if p_assignment is not null then
    select partner_id, record_id into a_partner, a_record from public.partner_commission_assignments where id = p_assignment and status = 'active';
    if a_partner is null or a_partner <> ap_partner then raise exception 'That agreement does not belong to this application''s partner'; end if;
  end if;
  insert into public.application_commissions (application_id, match, record_id, assignment_id, candidates, confirmed_by)
  values (p_application, 'confirmed', a_record, p_assignment, case when p_assignment is null then 0 else 1 end, auth.uid())
  on conflict (application_id) do update set match = 'confirmed', record_id = excluded.record_id, assignment_id = excluded.assignment_id,
    confirmed_by = auth.uid(), updated_at = now();
end $$;

do $$
declare f text;
begin
  foreach f in array array['save_commission_record(text, jsonb, jsonb, jsonb)', 'preview_commission_import(text, jsonb)',
                           'apply_commission_import(text, text, text, jsonb, boolean)',
                           'tag_partner_commission(text, text, text, date, date, text, text)',
                           'set_custom_partner_commission(text, text, text, text, numeric, text, date, date, text, text)',
                           'decide_partner_commission(text, boolean, text)', 'deactivate_partner_commission(text, text)',
                           'confirm_application_commission(text, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- =============================================================== audit, realtime
do $$
declare t text;
begin
  foreach t in array array['commission_countries', 'commission_providers', 'commission_tiers', 'commission_records', 'commission_imports',
                           'partner_commission_assignments'] loop
    execute format('drop trigger if exists %1$s_audit on public.%1$I', t);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$I
                    for each row execute function public.audit_row()', t);
  end loop;
  foreach t in array array['commission_records', 'commission_providers', 'commission_countries'] loop
    execute format('drop trigger if exists %1$s_touch on public.%1$I', t);
    execute format('create trigger %1$s_touch before update on public.%1$I for each row execute function public.touch_updated_at()', t);
  end loop;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['commission_records', 'commission_tier_rates', 'commission_internal', 'commission_providers', 'commission_countries',
                             'partner_commission_assignments', 'commission_imports', 'partner_commission_signals', 'application_commissions'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
