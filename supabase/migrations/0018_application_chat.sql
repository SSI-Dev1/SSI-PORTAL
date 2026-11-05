-- 0018_application_chat.sql — run after 0017_work_activities.sql
-- (Supabase SQL Editor: Save this query as "0018_application_chat")
--
-- Private, real-time text conversation for each application.
-- * application_messages: one conversation per application. Text only. Nothing writes to this
--   table directly: send_application_message() validates, rate-limits and stamps the sender
--   and time on the server. A repeated send with the same client id returns the first message.
-- * application_chat_reads: how far each participant has read (unread counts, "seen by").
-- * can_access_application_chat(): the single access rule, used by every read and write.
--     Super Admin · Admin Staff with the Applications permission
--     · the employee assigned to the application · the partner's Partnership Officer
--     · users of the partner organisation that owns it (portal open, Applications module on).
--   Suspended users, revoked sessions and closed partner portals lose access immediately.
-- * Notifications carry the sender and application reference, never the message text. Message
--   bodies are not written to the activity feed, the audit log or work activities.
-- * partners.partnership_officer_id: the employee responsible for a partner organisation.
-- Safe to run more than once.

-- =============================================================== partnership officer
alter table public.partners add column if not exists partnership_officer_id uuid references public.profiles (id) on delete set null;
create index if not exists partners_officer_idx on public.partners (partnership_officer_id) where partnership_officer_id is not null;
create index if not exists applications_assigned_idx on public.applications (assigned_to) where assigned_to is not null;

create or replace function public.guard_partner_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_end_user_request() then
    if not public.is_staff()
       and (new.name, new.code, new.status, new.tier, new.branches, new.commission_rate, new.country, new.id, new.partnership_officer_id)
           is distinct from (old.name, old.code, old.status, old.tier, old.branches, old.commission_rate, old.country, old.id, old.partnership_officer_id) then
      raise exception 'Only SSI GLOBAL staff can change these partner details';
    end if;
    if not public.is_super_admin()
       and (new.portal_enabled, new.modules, new.archived_at, new.status)
           is distinct from (old.portal_enabled, old.modules, old.archived_at, old.status) then
      raise exception 'Only a Super Admin can change partner access';
    end if;
  end if;
  if not (new.modules <@ public.partner_modules()) then raise exception 'Unknown partner module'; end if;
  if new.partnership_officer_id is not null and new.partnership_officer_id is distinct from old.partnership_officer_id
     and not exists (select 1 from public.profiles p where p.id = new.partnership_officer_id and p.role = any (public.staff_roles())) then
    raise exception 'The Partnership Officer must be an SSI GLOBAL employee';
  end if;
  return new;
end $$;

-- =============================================================== tables
create table if not exists public.application_messages (
  id             bigint generated always as identity primary key,
  application_id text not null references public.applications (id) on delete cascade,
  sender_id      uuid references public.profiles (id) on delete set null,
  -- Stamped when sent, so history stays correct if the account later changes.
  sender_name    text not null,
  sender_role    text not null,
  sender_org     text not null,
  body           text not null check (char_length(body) between 1 and 4000),
  client_id      uuid not null,
  created_at     timestamptz not null default now(),
  unique (sender_id, client_id)
);
create index if not exists application_messages_app_idx on public.application_messages (application_id, id desc);
create index if not exists application_messages_sender_idx on public.application_messages (sender_id, created_at desc);

create table if not exists public.application_chat_reads (
  application_id text not null references public.applications (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  last_read_id   bigint not null default 0,
  read_at        timestamptz not null default now(),
  primary key (application_id, user_id)
);
create index if not exists application_chat_reads_user_idx on public.application_chat_reads (user_id);

-- =============================================================== access
create or replace function public.can_access_application_chat(p_application text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.my_profile_ok() and exists (
    select 1 from public.applications a
    left join public.partners o on o.id = a.partner_id
    where a.id = p_application and (
      public.is_super_admin()
      or (public.my_role() = 'admin_staff' and public.staff_can('applications'))
      or (public.is_staff() and auth.uid() in (a.assigned_to, o.partnership_officer_id))
      or (a.partner_id = public.my_partner_id() and public.partner_can('applications'))
    ));
$$;
revoke all on function public.can_access_application_chat(text) from public, anon;
grant execute on function public.can_access_application_chat(text) to authenticated;

alter table public.application_messages enable row level security;
alter table public.application_chat_reads enable row level security;
revoke all on public.application_messages from anon, authenticated;
revoke all on public.application_chat_reads from anon, authenticated;
grant select on public.application_messages to authenticated;
grant select on public.application_chat_reads to authenticated;

drop policy if exists "application messages: participants read" on public.application_messages;
create policy "application messages: participants read" on public.application_messages for select to authenticated
  using (public.can_access_application_chat(application_id));
drop policy if exists "chat reads: participants read" on public.application_chat_reads;
create policy "chat reads: participants read" on public.application_chat_reads for select to authenticated
  using (public.can_access_application_chat(application_id));

-- =============================================================== send
create or replace function public.send_application_message(p_application text, p_body text, p_client_id uuid)
returns public.application_messages language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  clean text;
  sender record;
  saved public.application_messages;
begin
  if not public.can_access_application_chat(p_application) then
    raise exception 'CHAT_DENIED' using errcode = '42501';
  end if;
  if p_client_id is null then raise exception 'CHAT_INVALID'; end if;

  -- A retry of a message that was already saved returns that message.
  select * into saved from public.application_messages m where m.sender_id = me and m.client_id = p_client_id;
  if found then
    if saved.application_id <> p_application then raise exception 'CHAT_INVALID'; end if;
    return saved;
  end if;

  -- Plain text: control characters other than new lines and tabs are removed.
  clean := btrim(regexp_replace(coalesce(p_body, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'), E' \t\r\n');
  if clean = '' then raise exception 'CHAT_EMPTY'; end if;
  if char_length(clean) > 4000 then raise exception 'CHAT_TOO_LONG'; end if;
  if (select count(*) from public.application_messages m where m.sender_id = me and m.created_at > now() - interval '1 minute') >= 30 then
    raise exception 'CHAT_RATE_LIMIT';
  end if;

  select p.full_name, p.role, coalesce(o.name, 'SSI GLOBAL') as org into sender
  from public.profiles p left join public.partners o on o.id = p.partner_id
  where p.id = me;

  insert into public.application_messages (application_id, sender_id, sender_name, sender_role, sender_org, body, client_id)
  values (p_application, me, coalesce(nullif(btrim(sender.full_name), ''), 'User'), sender.role, sender.org, clean, p_client_id)
  on conflict (sender_id, client_id) do nothing
  returning * into saved;
  if saved.id is null then  -- the same request arrived twice at once
    select * into saved from public.application_messages m where m.sender_id = me and m.client_id = p_client_id;
    return saved;
  end if;

  insert into public.application_chat_reads (application_id, user_id, last_read_id)
  values (p_application, me, saved.id)
  on conflict (application_id, user_id) do update
    set last_read_id = greatest(public.application_chat_reads.last_read_id, excluded.last_read_id), read_at = now();
  return saved;
end $$;
revoke all on function public.send_application_message(text, text, uuid) from public, anon;
grant execute on function public.send_application_message(text, text, uuid) to authenticated;

-- =============================================================== read state
create or replace function public.mark_application_chat_read(p_application text, p_upto bigint default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  newest bigint;
  upto bigint;
begin
  if not public.can_access_application_chat(p_application) then
    raise exception 'CHAT_DENIED' using errcode = '42501';
  end if;
  select max(m.id) into newest from public.application_messages m where m.application_id = p_application;
  upto := least(coalesce(p_upto, newest, 0), coalesce(newest, 0));
  if upto > 0 then
    insert into public.application_chat_reads (application_id, user_id, last_read_id)
    values (p_application, auth.uid(), upto)
    on conflict (application_id, user_id) do update
      set last_read_id = greatest(public.application_chat_reads.last_read_id, excluded.last_read_id), read_at = now()
      where public.application_chat_reads.last_read_id < excluded.last_read_id;
  end if;
  update public.notifications n set read_at = now()
  where n.user_id = auth.uid() and n.kind = 'chat' and n.read_at is null and n.link = 'applications?chat=' || p_application;
end $$;
revoke all on function public.mark_application_chat_read(text, bigint) from public, anon;
grant execute on function public.mark_application_chat_read(text, bigint) to authenticated;

-- Every conversation this user may open, with their unread count. An application that is not
-- listed here has no chat for this user, so the app hides its Messages action.
create or replace function public.my_application_chats()
returns table (application_id text, unread bigint, total bigint, last_message_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with me as (
    select auth.uid() as uid, public.my_profile_ok() as ok,
           public.is_super_admin() or (public.my_role() = 'admin_staff' and public.staff_can('applications')) as all_apps,
           public.is_staff() as staff, public.my_partner_id() as partner, public.partner_can('applications') as partner_ok
  )
  select a.id,
         count(m.id) filter (where m.sender_id is distinct from me.uid and m.id > coalesce(r.last_read_id, 0)),
         count(m.id),
         max(m.created_at)
  from me
  join public.applications a on me.ok and (
    me.all_apps
    or (me.staff and a.assigned_to = me.uid)
    or (me.staff and exists (select 1 from public.partners o where o.id = a.partner_id and o.partnership_officer_id = me.uid))
    or (a.partner_id = me.partner and me.partner_ok))
  left join public.application_chat_reads r on r.application_id = a.id and r.user_id = me.uid
  left join public.application_messages m on m.application_id = a.id
  group by a.id;
$$;
revoke all on function public.my_application_chats() from public, anon;
grant execute on function public.my_application_chats() to authenticated;

-- Chat header and read receipts. An employee who is assigned to an application may not have the
-- Applications module, so the header comes from here rather than from the application tables.
create or replace function public.application_chat_context(p_application text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  res jsonb;
begin
  if not public.can_access_application_chat(p_application) then
    raise exception 'CHAT_DENIED' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'id', a.id, 'ref', a.ref, 'status', a.status, 'intake', a.intake,
    'student', s.first_name || ' ' || s.last_name, 'university', u.name, 'course', c.name, 'partner', o.name,
    'myLastReadId', coalesce((select r.last_read_id from public.application_chat_reads r
                              where r.application_id = a.id and r.user_id = auth.uid()), 0),
    'reads', coalesce((select jsonb_agg(jsonb_build_object('userId', r.user_id, 'name', p.full_name, 'lastReadId', r.last_read_id))
                       from public.application_chat_reads r join public.profiles p on p.id = r.user_id
                       where r.application_id = a.id), '[]'::jsonb))
  into res
  from public.applications a
  join public.students s on s.id = a.student_id
  left join public.universities u on u.id = a.university_id
  left join public.courses c on c.id = a.course_id
  left join public.partners o on o.id = a.partner_id
  where a.id = p_application;
  return res;
end $$;
revoke all on function public.application_chat_context(text) from public, anon;
grant execute on function public.application_chat_context(text) to authenticated;

-- =============================================================== notifications
-- Recipients in the same rule as can_access_application_chat(). A person with an unread chat
-- notification for this application is not notified again until they have read it.
create or replace function public.notify_application_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  app record;
  v_link text := 'applications?chat=' || new.application_id;
  people uuid[];
begin
  select a.ref, a.partner_id, a.assigned_to, o.partnership_officer_id as officer, s.first_name || ' ' || s.last_name as student
  into app
  from public.applications a
  join public.students s on s.id = a.student_id
  left join public.partners o on o.id = a.partner_id
  where a.id = new.application_id;

  select array_agg(distinct u) into people from (
    select r as u from public.partner_recipients(app.partner_id, 'applications') r
    union select p.id from public.profiles p
      where p.status = 'active' and (p.role = 'super_admin'
        or (p.role = 'admin_staff' and 'applications' = any (coalesce(p.permissions, public.role_default_permissions(p.role)))))
    union select p.id from public.profiles p
      where p.status = 'active' and p.role = any (public.staff_roles()) and p.id in (app.assigned_to, app.officer)
  ) x
  where u is distinct from new.sender_id
    and not exists (select 1 from public.notifications n where n.user_id = u and n.kind = 'chat' and n.link = v_link and n.read_at is null);

  if people is not null then
    perform public.notify(people, 'chat', 'New message · ' || app.ref, new.sender_name || ' · ' || coalesce(app.student, ''), v_link);
  end if;
  return null;
end $$;
drop trigger if exists application_messages_notify on public.application_messages;
create trigger application_messages_notify after insert on public.application_messages
  for each row execute function public.notify_application_message();

-- =============================================================== realtime
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['application_messages', 'application_chat_reads'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
