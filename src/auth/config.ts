// Environment-driven auth configuration (see .env.example).
// Vite embeds VITE_* variables in the public bundle: only browser-safe values belong
// here (project URL and publishable/anon key). Never put a service-role key, database
// password or OAuth client secret in a VITE_* variable.

const env = import.meta.env;
const flag = (v: string | undefined) => v === 'true' || v === '1';

export const SUPABASE_URL = (env.VITE_SUPABASE_URL ?? '').trim();
export const SUPABASE_ANON_KEY = (env.VITE_SUPABASE_ANON_KEY ?? '').trim();

/** Sign-in requires a configured backend. There is no client-side fallback. */
export const authConfigured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 20;

/** Set to true after enabling the Google provider in Supabase → Authentication → Providers. */
export const googleEnabled = authConfigured && flag(env.VITE_ENABLE_GOOGLE_AUTH);

/** Signed-in users are signed out after this many minutes without activity. */
export const IDLE_TIMEOUT_MINUTES = Math.max(5, Number(env.VITE_IDLE_TIMEOUT_MINUTES) || 30);

/** Site root that auth emails and OAuth providers redirect back to. */
export const siteUrl = () => (env.VITE_AUTH_REDIRECT_URL || `${window.location.origin}${window.location.pathname}`).trim();
