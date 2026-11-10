-- 0027_hr_work_assets_documents.sql — run after 0026_hr_leave_record_workforce_calendar.sql
-- (Supabase SQL Editor: Save this query as "0027_hr_work_assets_documents")
--
-- * Work assignments: the existing CRM "tasks" table becomes the single task engine (no second
--   task system). kind = 'task' rows behave exactly as before; kind = 'assignment' rows are work
--   assigned to an employee with a description, status, progress, start date and an append-only
--   history (task_events). Assignments are created, edited, reassigned and cancelled only through
--   database functions: HR and Super Admins for anyone, managers for their own team. The assignee
--   updates status and progress only. Visible to the assignee, whoever assigned it, their
--   managers and HR.
-- * Company assets: assets, who holds them (issue / return history) and their status. Managed by
--   HR; employees see the assets issued to them.
-- * Employee documents: private storage bucket "hr-documents" (never public URLs). HR uploads;
--   the employee sees a document only when HR shares it with them. Every upload, download,
--   share and archive is recorded. Files are never overwritten; documents are archived, not
--   deleted (only a Super Admin can delete).
-- Safe to run more than once.

-- =============================================================== work assignments
alter table public.tasks add column if not exists kind text not null default 'task';
alter table public.tasks add column if not exists description text;
alter table public.tasks add column if not exists status text;
alter table public.tasks add column if not exists progress integer not null default 0;
alter table public.tasks add column if not exists start_date date;
alter table public.tasks add column if not exists completed_at timestamptz;
alter table public.tasks add column if not exists assigned_by uuid references public.profiles (id) on delete set null;
alter table public.tasks add column if not exists last_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_kind_check') then
    alter table public.tasks add constraint tasks_kind_check check (kind in ('task', 'assignment'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_status_check') then
    alter table public.tasks add constraint tasks_status_check
      check (status is null or status in ('Not Started', 'In Progress', 'On Hold', 'Completed', 'Cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_progress_check') then
    alter table public.tasks add constraint tasks_progress_check check (progress between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_assignment_shape') then
    alter table public.tasks add constraint tasks_assignment_shape
      check (kind = 'task' or (status is not null and assigned_to is not null and char_length(coalesce(description, '')) <= 4000));
  end if;
end $$;
create index if not exists tasks_assignment_idx on public.tasks (assigned_to, status) where kind = 'assignment';

create table if not exists public.task_events (
  id      bigint generated always as identity primary key,
  task_id text not null references public.tasks (id) on delete cascade,
  at      timestamptz not null default now(),
  actor   uuid,
  action  text not null check (action in ('created', 'edited', 'reassigned', 'progress', 'completed', 'reopened', 'cancelled')),
  detail  jsonb
);
create index if not exists task_events_task_idx on public.task_events (task_id, at);
alter table public.task_events enable row level security;
revoke all on public.task_events from anon, authenticated;
grant select on public.task_events to authenticated;

-- Who may give work to this employee: HR and Super Admins (anyone), managers (their team).
create or replace function public.can_assign_to(p_emp uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.employees e join public.profiles p on p.id = e.id
    where e.id = p_emp and p.status = 'active' and e.employment_status <> 'Resigned')
    and (public.is_super_admin() or public.is_hr() or public.in_my_team(p_emp));
$$;

create or replace function public.can_see_assignment(p_assignee uuid, p_by uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_staff() and (auth.uid() = p_assignee or auth.uid() = p_by or public.is_super_admin() or public.is_hr()
                                or (p_assignee is not null and public.in_my_team(p_assignee)));
$$;

-- Plain tasks keep their rules; assignments are read through can_see_assignment and changed only by the functions below.
drop policy if exists "tasks: staff" on public.tasks;
drop policy if exists "tasks: read" on public.tasks;
drop policy if exists "tasks: insert" on public.tasks;
drop policy if exists "tasks: update" on public.tasks;
drop policy if exists "tasks: delete" on public.tasks;
create policy "tasks: read" on public.tasks for select to authenticated using (
  (kind = 'task' and (public.staff_can('tasks') or (public.is_staff() and assigned_to = auth.uid())))
  or (kind = 'assignment' and public.can_see_assignment(assigned_to, assigned_by)));
create policy "tasks: insert" on public.tasks for insert to authenticated
  with check (kind = 'task' and (public.staff_can('tasks') or (public.is_staff() and assigned_to = auth.uid())));
create policy "tasks: update" on public.tasks for update to authenticated
  using (kind = 'task' and (public.staff_can('tasks') or (public.is_staff() and assigned_to = auth.uid())))
  with check (kind = 'task' and (public.staff_can('tasks') or (public.is_staff() and assigned_to = auth.uid())));
create policy "tasks: delete" on public.tasks for delete to authenticated
  using (kind = 'task' and (public.staff_can('tasks') or (public.is_staff() and assigned_to = auth.uid())));

drop policy if exists "task events: read" on public.task_events;
create policy "task events: read" on public.task_events for select to authenticated using (
  exists (select 1 from public.tasks t where t.id = task_id and t.kind = 'assignment' and public.can_see_assignment(t.assigned_to, t.assigned_by)));

create or replace function public.save_assignment(p_id text, p_title text, p_description text, p_assignee uuid,
                                                  p_priority text, p_due timestamptz, p_start date default null)
returns text language plpgsql security definer set search_path = '' as $$
declare t record; rid text; nm text;
begin
  if not public.is_staff() then raise exception 'Not permitted'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 300 then raise exception 'Enter a title of 3 to 300 characters'; end if;
  if char_length(coalesce(p_description, '')) > 4000 then raise exception 'The description is too long'; end if;
  if p_priority not in ('High', 'Medium', 'Normal') then raise exception 'Unknown priority'; end if;
  if p_due is null then raise exception 'Choose a deadline'; end if;
  if p_start is not null and p_start > (p_due at time zone 'Asia/Kolkata')::date then raise exception 'The start date is after the deadline'; end if;
  if p_id is not null and not exists (select 1 from public.tasks x where x.id = p_id and x.kind = 'assignment'
       and (x.assigned_by = auth.uid() or public.is_super_admin() or public.is_hr() or public.in_my_team(x.assigned_to))) then
    raise exception 'Only whoever assigned this work, the employee''s manager or HR can change it';
  end if;
  if not public.can_assign_to(p_assignee) then raise exception 'You can only assign work to current employees in your team'; end if;
  select full_name into nm from public.profiles where id = p_assignee;
  if p_id is null then
    insert into public.tasks (kind, title, description, assigned_to, assignee, assigned_by, priority, due, start_date, status, progress, done, created_by)
    values ('assignment', btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_assignee, nm, auth.uid(), p_priority, p_due, p_start,
            'Not Started', 0, false, auth.uid())
    returning id into rid;
    insert into public.task_events (task_id, actor, action, detail) values (rid, auth.uid(), 'created', jsonb_build_object('assignee', p_assignee, 'due', p_due, 'priority', p_priority));
    perform public.notify(array[p_assignee], 'task', 'New work assigned: ' || btrim(p_title),
      'Due ' || to_char(p_due at time zone 'Asia/Kolkata', 'DD Mon YYYY') || ' · ' || p_priority || ' priority', 'work/assigned');
    return rid;
  end if;
  select * into t from public.tasks where id = p_id and kind = 'assignment' for update;
  if t.id is null then raise exception 'Assignment not found'; end if;
  if not (t.assigned_by = auth.uid() or public.is_super_admin() or public.is_hr() or public.in_my_team(t.assigned_to)) then
    raise exception 'Only whoever assigned this work, the employee''s manager or HR can change it';
  end if;
  if t.status = 'Cancelled' then raise exception 'This assignment was cancelled'; end if;
  update public.tasks set title = btrim(p_title), description = nullif(btrim(coalesce(p_description, '')), ''), priority = p_priority,
    due = p_due, start_date = p_start, assigned_to = p_assignee, assignee = nm where id = p_id;
  if p_assignee is distinct from t.assigned_to then
    insert into public.task_events (task_id, actor, action, detail) values (p_id, auth.uid(), 'reassigned', jsonb_build_object('from', t.assigned_to, 'to', p_assignee));
    perform public.notify(array[p_assignee], 'task', 'Work reassigned to you: ' || btrim(p_title),
      'Due ' || to_char(p_due at time zone 'Asia/Kolkata', 'DD Mon YYYY'), 'work/assigned');
  else
    insert into public.task_events (task_id, actor, action, detail) values (p_id, auth.uid(), 'edited',
      jsonb_build_object('due', p_due, 'priority', p_priority));
    if t.due is distinct from p_due then
      perform public.notify(array[p_assignee], 'task', 'Deadline changed: ' || btrim(p_title), 'Now due ' || to_char(p_due at time zone 'Asia/Kolkata', 'DD Mon YYYY'), 'work/assigned');
    end if;
  end if;
  return p_id;
end $$;

create or replace function public.update_assignment_progress(p_id text, p_status text, p_progress integer, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t record; prog int;
begin
  select * into t from public.tasks where id = p_id and kind = 'assignment' for update;
  if t.id is null then raise exception 'Assignment not found'; end if;
  if not (t.assigned_to = auth.uid() or t.assigned_by = auth.uid() or public.is_super_admin() or public.is_hr() or public.in_my_team(t.assigned_to)) then
    raise exception 'You cannot update this assignment';
  end if;
  if t.status = 'Cancelled' then raise exception 'This assignment was cancelled'; end if;
  if p_status not in ('Not Started', 'In Progress', 'On Hold', 'Completed') then raise exception 'Unknown status'; end if;
  if char_length(coalesce(p_note, '')) > 1000 then raise exception 'The note is too long'; end if;
  prog := case when p_status = 'Completed' then 100 when p_status = 'Not Started' then 0 else least(greatest(coalesce(p_progress, t.progress), 0), 99) end;
  if p_status = 'On Hold' and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Say why the work is on hold'; end if;
  update public.tasks set status = p_status, progress = prog, done = (p_status = 'Completed'),
    completed_at = case when p_status = 'Completed' then coalesce(t.completed_at, now()) else null end,
    last_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), last_note) where id = p_id;
  insert into public.task_events (task_id, actor, action, detail) values (p_id, auth.uid(),
    case when p_status = 'Completed' and t.status <> 'Completed' then 'completed' when t.status = 'Completed' and p_status <> 'Completed' then 'reopened' else 'progress' end,
    jsonb_build_object('status', p_status, 'progress', prog, 'note', nullif(btrim(coalesce(p_note, '')), '')));
  if p_status = 'Completed' and t.status <> 'Completed' and t.assigned_by is not null then
    perform public.notify(array[t.assigned_by], 'task', 'Work completed: ' || t.title, (select full_name from public.profiles where id = t.assigned_to), 'hr/work');
  elsif p_status = 'On Hold' and t.assigned_by is not null then
    perform public.notify(array[t.assigned_by], 'task', 'Work on hold: ' || t.title, btrim(p_note), 'hr/work');
  end if;
end $$;

create or replace function public.cancel_assignment(p_id text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  select * into t from public.tasks where id = p_id and kind = 'assignment' for update;
  if t.id is null then raise exception 'Assignment not found'; end if;
  if not (t.assigned_by = auth.uid() or public.is_super_admin() or public.is_hr() or public.in_my_team(t.assigned_to)) then
    raise exception 'Only whoever assigned this work, the employee''s manager or HR can cancel it';
  end if;
  if t.status in ('Completed', 'Cancelled') then raise exception 'This assignment is already closed'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Enter a reason'; end if;
  update public.tasks set status = 'Cancelled', done = false, last_note = btrim(p_reason) where id = p_id;
  insert into public.task_events (task_id, actor, action, detail) values (p_id, auth.uid(), 'cancelled', jsonb_build_object('reason', btrim(p_reason)));
  perform public.notify(array[t.assigned_to], 'task', 'Assignment cancelled: ' || t.title, btrim(p_reason), 'work/assigned');
end $$;

revoke all on function public.save_assignment(text, text, text, uuid, text, timestamptz, date) from public, anon;
revoke all on function public.update_assignment_progress(text, text, integer, text) from public, anon;
revoke all on function public.cancel_assignment(text, text) from public, anon;
revoke all on function public.can_assign_to(uuid) from public, anon;
grant execute on function public.save_assignment(text, text, text, uuid, text, timestamptz, date) to authenticated;
grant execute on function public.update_assignment_progress(text, text, integer, text) to authenticated;
grant execute on function public.cancel_assignment(text, text) to authenticated;
grant execute on function public.can_assign_to(uuid) to authenticated;

-- =============================================================== company assets
create table if not exists public.company_assets (
  id             text primary key default gen_random_uuid()::text,
  asset_tag      text not null check (char_length(btrim(asset_tag)) between 2 and 40),
  name           text not null check (char_length(btrim(name)) between 2 and 120),
  category       text not null check (category in ('Laptop', 'Desktop', 'Monitor', 'Mobile Phone', 'Tablet', 'Accessory',
                                                   'Furniture', 'Vehicle', 'Software Licence', 'ID / Access Card', 'Other')),
  serial_number  text check (char_length(serial_number) <= 120),
  status         text not null default 'Available' check (status in ('Available', 'Assigned', 'In Repair', 'Retired', 'Lost')),
  purchase_date  date,
  warranty_until date,
  notes          text check (char_length(notes) <= 1000),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists company_assets_tag_key on public.company_assets (lower(btrim(asset_tag)));

create table if not exists public.asset_assignments (
  id              text primary key default gen_random_uuid()::text,
  asset_id        text not null references public.company_assets (id) on delete cascade,
  employee_id     uuid not null references public.employees (id) on delete cascade,
  issued_on       date not null,
  expected_return date,
  returned_on     date,
  condition_out   text check (char_length(condition_out) <= 300),
  condition_in    text check (char_length(condition_in) <= 300),
  notes           text check (char_length(notes) <= 1000),
  issued_by       uuid,
  returned_by     uuid,
  created_at      timestamptz not null default now(),
  constraint asset_return_order check (returned_on is null or returned_on >= issued_on),
  constraint asset_expected_order check (expected_return is null or expected_return >= issued_on)
);
create unique index if not exists asset_open_key on public.asset_assignments (asset_id) where returned_on is null;
create index if not exists asset_assignments_emp_idx on public.asset_assignments (employee_id, issued_on desc);

alter table public.company_assets enable row level security;
alter table public.asset_assignments enable row level security;
revoke all on public.company_assets, public.asset_assignments from anon, authenticated;
grant select, insert, update on public.company_assets to authenticated;
grant select on public.asset_assignments to authenticated;

create or replace function public.can_manage_assets()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_super_admin() or public.is_hr();
$$;

drop policy if exists "assets: read" on public.company_assets;
drop policy if exists "assets: hr insert" on public.company_assets;
drop policy if exists "assets: hr update" on public.company_assets;
create policy "assets: read" on public.company_assets for select to authenticated using (
  public.can_manage_assets()
  or exists (select 1 from public.asset_assignments a where a.asset_id = company_assets.id and a.employee_id = auth.uid() and a.returned_on is null and public.is_staff()));
create policy "assets: hr insert" on public.company_assets for insert to authenticated with check (public.can_manage_assets());
create policy "assets: hr update" on public.company_assets for update to authenticated using (public.can_manage_assets()) with check (public.can_manage_assets());

drop policy if exists "asset assignments: read" on public.asset_assignments;
create policy "asset assignments: read" on public.asset_assignments for select to authenticated using (
  public.can_manage_assets() or (employee_id = auth.uid() and public.is_staff()));

-- "Assigned" is set and cleared only by assign_asset / return_asset.
create or replace function public.guard_company_asset()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_end_user_request() and coalesce(current_setting('ssi.asset_flow', true), '') <> 'on' then
    if (tg_op = 'INSERT' and new.status = 'Assigned')
       or (tg_op = 'UPDATE' and new.status is distinct from old.status and (new.status = 'Assigned' or old.status = 'Assigned')) then
      raise exception 'Use Assign / Return to change who holds an asset';
    end if;
  end if;
  new.asset_tag := upper(btrim(new.asset_tag));
  new.name := btrim(new.name);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists company_assets_guard on public.company_assets;
create trigger company_assets_guard before insert or update on public.company_assets
  for each row execute function public.guard_company_asset();

create or replace function public.assign_asset(p_asset text, p_emp uuid, p_issued date, p_expected date default null,
                                               p_condition text default null, p_note text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare a record; rid text;
begin
  if not public.can_manage_assets() then raise exception 'Only HR can assign company assets'; end if;
  select * into a from public.company_assets where id = p_asset for update;
  if a.id is null then raise exception 'Asset not found'; end if;
  if a.status <> 'Available' then raise exception 'This asset is %, not available', lower(a.status); end if;
  if not exists (select 1 from public.employees e join public.profiles p on p.id = e.id
                 where e.id = p_emp and p.status = 'active' and e.employment_status <> 'Resigned') then
    raise exception 'Assets can only be issued to current employees';
  end if;
  if p_issued is null or p_issued > public.company_today() + 30 then raise exception 'Choose the issue date'; end if;
  insert into public.asset_assignments (asset_id, employee_id, issued_on, expected_return, condition_out, notes, issued_by)
  values (p_asset, p_emp, p_issued, p_expected, nullif(btrim(coalesce(p_condition, '')), ''), nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into rid;
  perform set_config('ssi.asset_flow', 'on', true);
  update public.company_assets set status = 'Assigned' where id = p_asset;
  perform set_config('ssi.asset_flow', '', true);
  perform public.notify(array[p_emp], 'hr', 'Company asset issued to you', a.name || ' (' || a.asset_tag || ')', 'work/profile');
  return rid;
end $$;

create or replace function public.return_asset(p_asset text, p_returned date, p_condition text default null,
                                               p_note text default null, p_status text default 'Available')
returns void language plpgsql security definer set search_path = '' as $$
declare x record;
begin
  if not public.can_manage_assets() then raise exception 'Only HR can record asset returns'; end if;
  if p_status not in ('Available', 'In Repair', 'Retired', 'Lost') then raise exception 'Unknown asset status'; end if;
  select * into x from public.asset_assignments where asset_id = p_asset and returned_on is null for update;
  if x.id is null then raise exception 'This asset is not issued to anyone'; end if;
  if p_returned is null or p_returned < x.issued_on then raise exception 'The return date is before the issue date'; end if;
  if p_returned > public.company_today() then raise exception 'The return date cannot be in the future'; end if;
  update public.asset_assignments set returned_on = p_returned, condition_in = nullif(btrim(coalesce(p_condition, '')), ''),
    notes = concat_ws(E'\n', notes, nullif(btrim(coalesce(p_note, '')), '')), returned_by = auth.uid() where id = x.id;
  perform set_config('ssi.asset_flow', 'on', true);
  update public.company_assets set status = p_status where id = p_asset;
  perform set_config('ssi.asset_flow', '', true);
end $$;
revoke all on function public.assign_asset(text, uuid, date, date, text, text) from public, anon;
revoke all on function public.return_asset(text, date, text, text, text) from public, anon;
grant execute on function public.assign_asset(text, uuid, date, date, text, text) to authenticated;
grant execute on function public.return_asset(text, date, text, text, text) to authenticated;

-- =============================================================== employee documents
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hr-documents', 'hr-documents', false, 10485760, array[
  'application/pdf', 'image/jpeg', 'image/png',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.employee_documents (
  id                  text primary key default gen_random_uuid()::text,
  employee_id         uuid not null references public.employees (id) on delete cascade,
  category            text not null check (category in ('Identity', 'Address Proof', 'Offer Letter', 'Employment Contract', 'Qualification',
                                                      'Experience Letter', 'Payslip', 'Policy Acknowledgement', 'Medical', 'Other')),
  title               text not null check (char_length(btrim(title)) between 2 and 150),
  file_name           text not null check (char_length(file_name) <= 200),
  size                bigint not null check (size > 0 and size <= 10485760),
  mime                text not null,
  storage_path        text not null unique,
  visible_to_employee boolean not null default false,
  status              text not null default 'Active' check (status in ('Active', 'Archived')),
  expires_on          date,
  uploaded_by         uuid default auth.uid(),
  uploaded_at         timestamptz not null default now(),
  archived_by         uuid,
  archived_at         timestamptz,
  archive_reason      text check (char_length(archive_reason) <= 300),
  updated_at          timestamptz not null default now()
);
create index if not exists employee_documents_emp_idx on public.employee_documents (employee_id, uploaded_at desc);

create table if not exists public.employee_document_events (
  id          bigint generated always as identity primary key,
  document_id text not null references public.employee_documents (id) on delete cascade,
  employee_id uuid not null,
  at          timestamptz not null default now(),
  actor       uuid,
  action      text not null check (action in ('uploaded', 'downloaded', 'shared', 'unshared', 'archived', 'restored', 'edited'))
);
create index if not exists employee_document_events_doc_idx on public.employee_document_events (document_id, at);

alter table public.employee_documents enable row level security;
alter table public.employee_document_events enable row level security;
revoke all on public.employee_documents, public.employee_document_events from anon, authenticated;
grant select, insert, update on public.employee_documents to authenticated;
grant select on public.employee_document_events to authenticated;

create or replace function public.can_manage_hr_documents()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_super_admin() or public.is_hr();
$$;

drop policy if exists "hr documents: read" on public.employee_documents;
drop policy if exists "hr documents: upload" on public.employee_documents;
drop policy if exists "hr documents: update" on public.employee_documents;
drop policy if exists "hr documents: super admin delete" on public.employee_documents;
create policy "hr documents: read" on public.employee_documents for select to authenticated using (
  public.can_manage_hr_documents()
  or (employee_id = auth.uid() and visible_to_employee and status = 'Active' and public.is_staff()));
create policy "hr documents: upload" on public.employee_documents for insert to authenticated with check (
  public.can_manage_hr_documents() and uploaded_by = auth.uid()
  and storage_path like employee_id::text || '/%' and position('..' in storage_path) = 0);
create policy "hr documents: update" on public.employee_documents for update to authenticated
  using (public.can_manage_hr_documents()) with check (public.can_manage_hr_documents());
create policy "hr documents: super admin delete" on public.employee_documents for delete to authenticated using (public.is_super_admin());
grant delete on public.employee_documents to authenticated;

drop policy if exists "hr document events: read" on public.employee_document_events;
create policy "hr document events: read" on public.employee_document_events for select to authenticated using (public.can_manage_hr_documents());

-- The file, owner and upload details never change; sharing, archiving and edits are recorded.
create or replace function public.guard_employee_document()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'Active'; new.archived_by := null; new.archived_at := null; new.archive_reason := null;
    new.uploaded_at := now();
    if public.is_end_user_request() then new.uploaded_by := auth.uid(); end if;
    return new;
  end if;
  if new.employee_id is distinct from old.employee_id or new.storage_path is distinct from old.storage_path
     or new.file_name is distinct from old.file_name or new.size is distinct from old.size or new.mime is distinct from old.mime
     or new.uploaded_by is distinct from old.uploaded_by or new.uploaded_at is distinct from old.uploaded_at then
    raise exception 'A stored document cannot be replaced — upload a new one';
  end if;
  if new.status = 'Archived' and old.status = 'Active' then
    if length(btrim(coalesce(new.archive_reason, ''))) < 3 then raise exception 'Enter a reason to archive this document'; end if;
    new.archived_by := auth.uid(); new.archived_at := now(); new.visible_to_employee := false;
  elsif new.status = 'Active' and old.status = 'Archived' then
    new.archived_by := null; new.archived_at := null; new.archive_reason := null;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists employee_documents_guard on public.employee_documents;
create trigger employee_documents_guard before insert or update on public.employee_documents
  for each row execute function public.guard_employee_document();

create or replace function public.log_employee_document()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.employee_document_events (document_id, employee_id, actor, action) values (new.id, new.employee_id, auth.uid(), 'uploaded');
    if new.visible_to_employee then
      perform public.notify(array[new.employee_id], 'hr', 'New HR document shared with you', new.title, 'work/profile');
    end if;
    return new;
  end if;
  if new.status <> old.status then
    insert into public.employee_document_events (document_id, employee_id, actor, action)
    values (new.id, new.employee_id, auth.uid(), case when new.status = 'Archived' then 'archived' else 'restored' end);
  end if;
  if new.visible_to_employee <> old.visible_to_employee and not (new.status = 'Archived' and old.status = 'Active') then
    insert into public.employee_document_events (document_id, employee_id, actor, action)
    values (new.id, new.employee_id, auth.uid(), case when new.visible_to_employee then 'shared' else 'unshared' end);
    if new.visible_to_employee then
      perform public.notify(array[new.employee_id], 'hr', 'New HR document shared with you', new.title, 'work/profile');
    end if;
  end if;
  if new.title is distinct from old.title or new.category is distinct from old.category or new.expires_on is distinct from old.expires_on then
    insert into public.employee_document_events (document_id, employee_id, actor, action) values (new.id, new.employee_id, auth.uid(), 'edited');
  end if;
  return new;
end $$;
drop trigger if exists employee_documents_log on public.employee_documents;
create trigger employee_documents_log after insert or update on public.employee_documents
  for each row execute function public.log_employee_document();

-- Checks access, records the download and returns the private object path (the app then asks
-- Storage for a 60-second signed URL, which Storage only grants under the policies below).
create or replace function public.authorize_hr_document(p_id text)
returns text language plpgsql security definer set search_path = '' as $$
declare d record;
begin
  select * into d from public.employee_documents where id = p_id;
  if d.id is null or not (public.can_manage_hr_documents()
     or (d.employee_id = auth.uid() and d.visible_to_employee and d.status = 'Active' and public.is_staff())) then
    raise exception 'You do not have access to this document';
  end if;
  insert into public.employee_document_events (document_id, employee_id, actor, action) values (d.id, d.employee_id, auth.uid(), 'downloaded');
  return d.storage_path;
end $$;
revoke all on function public.authorize_hr_document(text) from public, anon;
grant execute on function public.authorize_hr_document(text) to authenticated;

-- Object names are "<employee_id>/<document_id>.<ext>".
drop policy if exists "hr docs storage: read" on storage.objects;
drop policy if exists "hr docs storage: upload" on storage.objects;
drop policy if exists "hr docs storage: delete" on storage.objects;
create policy "hr docs storage: read" on storage.objects for select to authenticated using (
  bucket_id = 'hr-documents' and (
    public.can_manage_hr_documents()
    or exists (select 1 from public.employee_documents d where d.storage_path = objects.name and d.employee_id = auth.uid()
               and d.visible_to_employee and d.status = 'Active' and public.is_staff())));
create policy "hr docs storage: upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'hr-documents' and public.can_manage_hr_documents() and position('..' in name) = 0
  and exists (select 1 from public.employees e where e.id::text = (storage.foldername(name))[1]));
create policy "hr docs storage: delete" on storage.objects for delete to authenticated using (
  bucket_id = 'hr-documents' and (public.is_super_admin()
    -- an upload whose record failed to save may be removed straight away by whoever uploaded it
    or (public.can_manage_hr_documents() and not exists (select 1 from public.employee_documents d where d.storage_path = objects.name))));
-- No update policy: stored files are immutable.

-- =============================================================== audit, realtime
do $$
declare t text;
begin
  foreach t in array array['company_assets', 'asset_assignments', 'employee_documents'] loop
    execute format('drop trigger if exists %1$s_audit on public.%1$I', t);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$I
                    for each row execute function public.audit_row()', t);
  end loop;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['tasks', 'task_events', 'company_assets', 'asset_assignments', 'employee_documents'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
