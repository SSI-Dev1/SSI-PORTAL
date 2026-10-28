// Environment-driven auth configuration (see .env.example).
// Vite exposes only VITE_* variables to the browser; never put secrets here.

const env = import.meta.env;
const flag = (v: string | undefined, fallback: boolean) => (v === undefined || v === '' ? fallback : v === 'true' || v === '1');

export const SUPABASE_URL = (env.VITE_SUPABASE_URL ?? '').trim();
export const SUPABASE_ANON_KEY = (env.VITE_SUPABASE_ANON_KEY ?? '').trim();

/** True when a Supabase project is configured; auth and roles then come from the server. */
export const supabaseEnabled = !!SUPABASE_URL && !!SUPABASE_ANON_KEY;

/**
 * Built-in prototype accounts. On by default only when no backend is configured,
 * so a production build that points at Supabase never accepts them.
 */
export const demoAccountsEnabled = flag(env.VITE_ENABLE_DEMO_ACCOUNTS, !supabaseEnabled);

/** Set to true after enabling the Google provider in Supabase → Authentication → Providers. */
export const googleEnabled = supabaseEnabled && flag(env.VITE_ENABLE_GOOGLE_AUTH, false);

/** Where OAuth providers send the user back to. Defaults to the current site root. */
export const authRedirectUrl = () => (env.VITE_AUTH_REDIRECT_URL || `${window.location.origin}${window.location.pathname}`).trim();
