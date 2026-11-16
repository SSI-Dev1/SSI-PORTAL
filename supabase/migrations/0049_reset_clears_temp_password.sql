-- A password reset by email must finish even when the account still holds an old, expired temporary
-- password from an administrator. Before this, password_change_done() raised TEMP_PASSWORD_EXPIRED
-- after supabase.auth.updateUser had already changed the password, so the reset page reported
-- "reset link expired" and must_change_password stayed on.
--
-- The expiry rule only protects sign-ins made WITH the temporary password. A session opened from an
-- emailed link (JWT amr method otp / recovery / magiclink, and no password method) has proved control
-- of the mailbox, so the stale temporary credential is simply removed.
create or replace function public.password_change_done()
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  t record;
  amr jsonb := coalesce(auth.jwt() -> 'amr', '[]'::jsonb);
  via_email_link boolean;
begin
  via_email_link := jsonb_typeof(amr) = 'array'
    and exists (select 1 from jsonb_array_elements(amr) e where e ->> 'method' in ('otp', 'recovery', 'magiclink'))
    and not exists (select 1 from jsonb_array_elements(amr) e where e ->> 'method' = 'password');
  select c.password_hash, c.expires_at into t from public.account_temp_credentials c where c.user_id = auth.uid();
  if found then
    if t.expires_at < now() and not via_email_link then raise exception 'TEMP_PASSWORD_EXPIRED'; end if;
    if exists (select 1 from auth.users u where u.id = auth.uid() and u.encrypted_password is not distinct from t.password_hash) then
      raise exception 'PASSWORD_NOT_CHANGED';
    end if;
    delete from public.account_temp_credentials where user_id = auth.uid();
  end if;
  perform set_config('ssi.password_change_done', 'on', true);
  update public.profiles set must_change_password = false where id = auth.uid();
end $function$;
revoke all on function public.password_change_done() from public, anon;
grant execute on function public.password_change_done() to authenticated;
