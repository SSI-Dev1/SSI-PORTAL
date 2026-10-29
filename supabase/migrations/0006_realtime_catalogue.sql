-- 0006_realtime_catalogue.sql — run after 0005_realtime_notifications.sql
-- (Supabase SQL Editor: Save this query as "0006_realtime_catalogue")
--
-- Adds the course catalogue (universities, courses) to the supabase_realtime publication.
-- 0005 left them out; the app subscribes to them, and Realtime rejected those
-- subscriptions. Safe to run more than once.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['universities', 'courses'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
