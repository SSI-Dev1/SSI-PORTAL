-- 0036_partnership_settings_fix.sql — run after 0035_agency_import.sql
-- (Supabase SQL Editor: Save this query as "0036_partnership_settings_fix")
--
-- Fix: saving "Proposal terms & settings" failed with "UPDATE requires a WHERE clause".
-- Supabase refuses an UPDATE without WHERE; update_partnership_settings() updated its single
-- settings row without one. It now names the row. Safe to run more than once.

create or replace function public.update_partnership_settings(p_auto boolean, p_days integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.agency_manager() then raise exception 'Only administrators can change these settings'; end if;
  if p_days is not null and (p_days < 1 or p_days > 180) then raise exception 'Proposal validity must be 1 to 180 days'; end if;
  insert into public.partnership_settings (id) values (true) on conflict (id) do nothing;
  update public.partnership_settings set auto_registration_link = coalesce(p_auto, auto_registration_link),
    proposal_valid_days = coalesce(p_days, proposal_valid_days), updated_by = auth.uid(), updated_at = now()
  where id;
end $$;
revoke all on function public.update_partnership_settings(boolean, integer) from public, anon;
grant execute on function public.update_partnership_settings(boolean, integer) to authenticated;
