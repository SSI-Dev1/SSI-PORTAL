-- Per-user interface preferences: the order of the user's sidebar sections (20 Nov 2026).
--
-- One row per signed-in user, readable and writable only by that user. It stores presentation only:
-- {"<navigation set>": ["section id", ...]} — e.g. {"partner_success": ["ps-workspace", "ps-tools", ...]}.
-- Which sections and items a user may see is decided by their role and permissions in the app and
-- enforced by the database; a saved order can never add, reveal or open anything, it only sorts what
-- the user is already allowed to see. Unknown or no-longer-permitted section ids are simply ignored.
create table if not exists public.user_preferences (
  user_id       uuid primary key references public.profiles (id) on delete cascade,
  sidebar_order jsonb not null default '{}' check (jsonb_typeof(sidebar_order) = 'object' and octet_length(sidebar_order::text) <= 8000),
  updated_at    timestamptz not null default now()
);

alter table public.user_preferences enable row level security;
drop policy if exists "user preferences: own" on public.user_preferences;
create policy "user preferences: own" on public.user_preferences for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.user_preferences to authenticated;

-- Saves one navigation set's order (null or empty = back to the default order).
create or replace function public.save_sidebar_order(p_set text, p_order text[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare me uuid := auth.uid(); clean text[]; res jsonb;
begin
  if me is null then raise exception 'Sign in again'; end if;
  if p_set !~ '^[a-z_]{2,40}$' then raise exception 'Unknown navigation'; end if;
  if coalesce(cardinality(p_order), 0) > 40 then raise exception 'Too many sections'; end if;
  -- valid ids only, each once, in the order given
  clean := array(select x from (select x, min(n) as n from unnest(coalesce(p_order, '{}')) with ordinality u(x, n)
                                where x ~ '^[a-z0-9-]{1,40}$' group by x) t order by n);
  insert into public.user_preferences (user_id, sidebar_order) values (me, '{}') on conflict (user_id) do nothing;
  update public.user_preferences
     set sidebar_order = case when coalesce(cardinality(clean), 0) = 0 then sidebar_order - p_set else sidebar_order || jsonb_build_object(p_set, to_jsonb(clean)) end,
         updated_at = now()
   where user_id = me
  returning sidebar_order into res;
  return res;
end $$;
revoke all on function public.save_sidebar_order(text, text[]) from public, anon;
grant execute on function public.save_sidebar_order(text, text[]) to authenticated;
