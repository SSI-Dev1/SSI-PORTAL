-- SSI GLOBAL CRM — auth roles and tenant isolation.
-- Apply in Supabase → SQL Editor (or `supabase db push`). Safe to run once on a new project.
--
-- Model: every Supabase Auth user has one row in public.profiles with
--   role = 'admin'   → SSI GLOBAL staff, sees everything
--   role = 'partner' → consultancy partner user, sees only rows with their partner_id
-- Row-level security enforces this in the database, not in the browser.

-- ---------------------------------------------------------------- partners
create table if not exists public.partners (
  id              text primary key default gen_random_uuid()::text,
  name            text not null,
  code            text not null unique,
  contact_name    text not null,
  email           text not null,
  phone           text,
  city            text,
  country         text,
  website         text,
  status          text not null default 'Onboarding' check (status in ('Active', 'Onboarding', 'Inactive')),
  tier            text not null default 'Silver' check (tier in ('Platinum', 'Gold', 'Silver')),
  branches        text[] not null default '{}',
  commission_rate numeric not null default 10,
  joined_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  role       text not null check (role in ('admin', 'partner')),
  partner_id text references public.partners (id) on delete set null,
  full_name  text,
  created_at timestamptz not null default now(),
  constraint partner_users_need_partner check (role = 'admin' or partner_id is not null)
);

-- Helpers used by policies. SECURITY DEFINER avoids recursive RLS on profiles.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.my_partner_id()
returns text language sql stable security definer set search_path = public as $$
  select partner_id from public.profiles where id = auth.uid() and role = 'partner';
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.my_partner_id() from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.my_partner_id() to authenticated;

-- ---------------------------------------------------------------- catalogue
create table if not exists public.universities (
  id            text primary key default gen_random_uuid()::text,
  name          text not null,
  country       text not null,
  city          text,
  ranking       int default 0,
  type          text default 'Public',
  partner_since text,
  website       text
);

create table if not exists public.courses (
  id            text primary key default gen_random_uuid()::text,
  university_id text not null references public.universities (id) on delete cascade,
  name          text not null,
  level         text not null,
  field         text,
  duration      text,
  tuition       numeric not null,
  currency      text not null,
  intakes       text[] not null default '{}',
  ielts_min     numeric
);

-- ---------------------------------------------------------------- partner-owned data
create table if not exists public.students (
  id                  text primary key default gen_random_uuid()::text,
  partner_id          text not null references public.partners (id) on delete cascade,
  first_name          text not null,
  last_name           text not null,
  email               text not null,
  phone               text,
  dob                 date,
  gender              text,
  nationality         text,
  passport_no         text,
  address             text,
  qualification       text,
  institution         text,
  gpa                 text,
  graduation_year     text,
  english_test        text,
  english_score       text,
  preferred_countries text[] not null default '{}',
  preferred_level     text,
  preferred_intake    text,
  budget              text,
  status              text not null default 'Active',
  created_at          timestamptz not null default now()
);

create table if not exists public.applications (
  id            text primary key default gen_random_uuid()::text,
  ref           text not null unique,
  student_id    text not null references public.students (id) on delete cascade,
  partner_id    text not null references public.partners (id) on delete cascade,
  university_id text not null references public.universities (id),
  course_id     text not null references public.courses (id),
  intake        text not null,
  status        text not null default 'Draft' check (status in (
                  'Draft', 'Pending Assessment', 'Submitted', 'Offer Pending', 'Conditional Offer',
                  'Unconditional Offer', 'Visa Lodged', 'Visa Granted', 'Visa Refused')),
  checklist     jsonb not null default '[]',
  timeline      jsonb not null default '[]',
  applied_at    timestamptz not null default now()
);

create table if not exists public.documents (
  id          text primary key default gen_random_uuid()::text,
  student_id  text not null references public.students (id) on delete cascade,
  partner_id  text not null references public.partners (id) on delete cascade,
  name        text not null,
  type        text not null,
  file_name   text not null,
  storage_key text,               -- path in Supabase Storage once uploads are wired
  size        bigint,
  status      text not null default 'Pending' check (status in ('Verified', 'Pending', 'Rejected')),
  uploaded_at timestamptz not null default now()
);

create table if not exists public.assessments (
  id           text primary key default gen_random_uuid()::text,
  student_id   text not null references public.students (id) on delete cascade,
  partner_id   text not null references public.partners (id) on delete cascade,
  course_id    text not null references public.courses (id),
  status       text not null default 'Pending' check (status in ('Pending', 'In Review', 'Eligible', 'Not Eligible')),
  notes        text default '',
  requested_at timestamptz not null default now()
);

create table if not exists public.payments (
  id          text primary key default gen_random_uuid()::text,
  invoice_no  text not null unique,
  partner_id  text not null references public.partners (id) on delete cascade,
  student_id  text references public.students (id) on delete set null,
  type        text not null,
  description text,
  amount      numeric not null,
  paid        numeric not null default 0,
  due_date    timestamptz not null,
  status      text not null default 'Pending'
);

create table if not exists public.announcements (
  id         text primary key default gen_random_uuid()::text,
  title      text not null,
  category   text not null,
  priority   text not null default 'Normal',
  body       text not null,
  published  boolean not null default false,
  publish_at timestamptz not null default now(),
  expires_at timestamptz not null,
  audience   text[],              -- null = all partners, otherwise partner ids
  created_at timestamptz not null default now()
);

create index if not exists students_partner_idx on public.students (partner_id);
create index if not exists applications_partner_idx on public.applications (partner_id);
create index if not exists documents_partner_idx on public.documents (partner_id);
create index if not exists assessments_partner_idx on public.assessments (partner_id);
create index if not exists payments_partner_idx on public.payments (partner_id);

-- ---------------------------------------------------------------- RLS
alter table public.partners      enable row level security;
alter table public.profiles      enable row level security;
alter table public.universities  enable row level security;
alter table public.courses       enable row level security;
alter table public.students      enable row level security;
alter table public.applications  enable row level security;
alter table public.documents     enable row level security;
alter table public.assessments   enable row level security;
alter table public.payments      enable row level security;
alter table public.announcements enable row level security;

-- profiles: users read their own row; only admins manage roles.
create policy "profiles: read own or admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "profiles: admin writes" on public.profiles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- partners: admins manage; a partner reads only its own record.
create policy "partners: read own or admin" on public.partners
  for select to authenticated using (public.is_admin() or id = public.my_partner_id());
create policy "partners: admin writes" on public.partners
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- catalogue: everyone signed in can read; admins edit.
create policy "universities: read" on public.universities for select to authenticated using (true);
create policy "universities: admin writes" on public.universities
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "courses: read" on public.courses for select to authenticated using (true);
create policy "courses: admin writes" on public.courses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- partner-owned tables: admin sees all, partner sees and writes only its own rows.
do $$
declare t text;
begin
  foreach t in array array['students', 'applications', 'documents', 'assessments'] loop
    execute format(
      'create policy "%1$s: tenant access" on public.%1$I for all to authenticated
         using (public.is_admin() or partner_id = public.my_partner_id())
         with check (public.is_admin() or partner_id = public.my_partner_id())', t);
  end loop;
end $$;

-- payments: partners can read their invoices; only admins create or change them.
create policy "payments: read own or admin" on public.payments
  for select to authenticated using (public.is_admin() or partner_id = public.my_partner_id());
create policy "payments: admin writes" on public.payments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- announcements: partners see published, live items addressed to them.
create policy "announcements: partner read" on public.announcements
  for select to authenticated using (
    public.is_admin()
    or (published and publish_at <= now() and (audience is null or public.my_partner_id() = any (audience)))
  );
create policy "announcements: admin writes" on public.announcements
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Partners may create Draft / Pending Assessment applications, but only SSI GLOBAL
-- admins can move an application through offer and visa stages.
create or replace function public.guard_application_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin()
     and new.status not in ('Draft', 'Pending Assessment')
     and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    raise exception 'Only SSI GLOBAL administrators can set status "%"', new.status;
  end if;
  return new;
end $$;

drop trigger if exists applications_status_guard on public.applications;
create trigger applications_status_guard
  before insert or update on public.applications
  for each row execute function public.guard_application_status();

-- Same for documents: partners upload (Pending); admins verify or reject.
create or replace function public.guard_document_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and new.status <> 'Pending'
     and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    raise exception 'Only SSI GLOBAL administrators can verify documents';
  end if;
  return new;
end $$;

drop trigger if exists documents_status_guard on public.documents;
create trigger documents_status_guard
  before insert or update on public.documents
  for each row execute function public.guard_document_status();
