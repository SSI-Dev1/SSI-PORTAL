-- 0020_application_chat_all_portals.sql — run after 0019_advanced_course_search.sql
-- (Supabase SQL Editor: Save this query as "0020_application_chat_all_portals")
--
-- The application chat from 0018 in every portal that shows applications. Same tables, same
-- send/read functions; only who may open a conversation, who is notified and a conversation
-- list change.
-- * Access now follows the employee's real permissions: anyone whose permissions include
--   Applications can already read every application row (the "applications: tenant access"
--   policy), so they may open its conversation too. Application Team, Senior International
--   Recruitment Manager, Partner Success Officer and other employees with the Applications
--   module therefore get the chat on every application they can see. Employees without it keep
--   access only where they are the assigned employee or the partner's Partnership Officer.
--   Partners are unchanged: their own organisation only, portal open, Applications module on.
-- * Notifications: as before (partner users, Super Admins, Admin Staff with Applications, the
--   assigned employee, the Partnership Officer), plus any other employee who has taken part in
--   that conversation (sent or opened it) and still has access. Never the sender.
-- * my_application_chat_inbox(): the conversation list behind the Messages page, for people
--   who reach their chats without an Applications page (a Partnership Officer, for example).
--   It returns application header fields only; never message text.
-- Safe to run more than once.

-- =============================================================== access
create or replace function public.can_access_application_chat(p_application text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.my_profile_ok() and exists (
    select 1 from public.applications a
    left join public.partners o on o.id = a.partner_id
    where a.id = p_application and (
      public.is_super_admin()
      or (public.is_staff() and public.staff_can('applications'))
      or (public.is_staff() and auth.uid() in (a.assigned_to, o.partnership_officer_id))
      or (a.partner_id = public.my_partner_id() and public.partner_can('applications'))
    ));
$$;
revoke all on function public.can_access_application_chat(text) from public, anon;
grant execute on function public.can_access_application_chat(text) to authenticated;

create or replace function public.my_application_chats()
returns table (application_id text, unread bigint, total bigint, last_message_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with me as (
    select auth.uid() as uid, public.my_profile_ok() as ok,
           public.is_super_admin() or (public.is_staff() and public.staff_can('applications')) as all_apps,
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

-- =============================================================== conversation list
-- p_all = false: conversations with at least one message. p_all = true: every application the
-- user may open (to start a conversation), filtered by p_search (reference, student, university,
-- course or partner name). Newest activity first.
create or replace function public.my_application_chat_inbox(p_search text default null, p_all boolean default false, p_limit int default 100)
returns table (application_id text, ref text, student text, university text, course text, partner text, status text, intake text,
               unread bigint, total bigint, last_message_at timestamptz, last_sender text)
language sql stable security definer set search_path = '' as $$
  with mine as (select * from public.my_application_chats()),
  q as (select nullif(btrim(coalesce(p_search, '')), '') as s)
  select a.id, a.ref, s.first_name || ' ' || s.last_name, u.name, c.name, o.name, a.status::text, a.intake,
         mine.unread, mine.total, mine.last_message_at,
         (select m.sender_name from public.application_messages m where m.application_id = a.id order by m.id desc limit 1)
  from mine
  join public.applications a on a.id = mine.application_id
  join public.students s on s.id = a.student_id
  left join public.universities u on u.id = a.university_id
  left join public.courses c on c.id = a.course_id
  left join public.partners o on o.id = a.partner_id
  cross join q
  where (p_all or mine.total > 0)
    and (q.s is null or concat_ws(' ', a.ref, s.first_name, s.last_name, u.name, c.name, o.name) ilike '%' || replace(replace(replace(q.s, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  order by mine.last_message_at desc nulls last, a.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;
revoke all on function public.my_application_chat_inbox(text, boolean, int) from public, anon;
grant execute on function public.my_application_chat_inbox(text, boolean, int) to authenticated;

-- =============================================================== notifications
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
    -- Other employees who have taken part, while they still hold the Applications permission.
    union select p.id from public.application_chat_reads r join public.profiles p on p.id = r.user_id
      where r.application_id = new.application_id and p.status = 'active' and p.role = any (public.staff_roles())
        and 'applications' = any (coalesce(p.permissions, public.role_default_permissions(p.role)))
  ) x
  where u is distinct from new.sender_id
    and not exists (select 1 from public.notifications n where n.user_id = u and n.kind = 'chat' and n.link = v_link and n.read_at is null);

  if people is not null then
    perform public.notify(people, 'chat', 'New message · ' || app.ref, new.sender_name || ' · ' || coalesce(app.student, ''), v_link);
  end if;
  return null;
end $$;
