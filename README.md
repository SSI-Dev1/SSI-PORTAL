# SSI GLOBAL — Education CRM

Partner CRM for SSI GLOBAL: a **Super Admin Portal** for SSI GLOBAL management and a **Client Portal** for consultancy partners. React + TypeScript + Tailwind, built as a static site you can host on any server.

## Run

```bash
npm install
cp .env.example .env    # optional — see "Configuration"
npm run dev             # http://localhost:5173
npm run build           # static build in dist/
```

## Sign-in

Users sign in with email and password; the app reads their role and sends admins to the Admin Dashboard and partner users to their own Client Dashboard. There is no role picker.

Two modes, chosen by environment:

| Mode | When | Accounts and roles |
| --- | --- | --- |
| **Supabase** | `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set | Supabase Auth; role and partner from the `profiles` table, enforced by row-level security |
| **Prototype** | Supabase not configured | Built-in accounts in `src/auth/demoAccounts.ts` (passwords stored as SHA-256 hashes) |

Prototype accounts (one admin, one per sample partner) are defined in `src/auth/demoAccounts.ts`; their passwords are shared privately, not in this repository.

> Prototype accounts are checked in the browser and are not secure. Set `VITE_ENABLE_DEMO_ACCOUNTS=false` (the default once Supabase is configured) for any public deployment.

**Continue with Google** uses Supabase's Google provider. Until `VITE_ENABLE_GOOGLE_AUTH=true`, the button tells the user Google sign-in isn't enabled yet — it never fakes a login.

Admins can open **Preview portal** on a partner's profile to see that partner's Client Portal, and return with **Exit preview**.

## Configuration

All settings are `VITE_*` variables (see `.env.example`). They are baked into the build, so only public keys belong there — never a Supabase service-role key.

### Connecting Supabase (project `goiyhrlhczygeweykwqq`)

1. In Supabase → SQL Editor, run `supabase/migrations/0001_crm_auth_and_rls.sql`, then `supabase/seed.sql`.
2. Authentication → Users: create the staff and partner users.
3. Give each user a role (examples at the bottom of `supabase/seed.sql`):
   `insert into public.profiles (id, role, partner_id, full_name) select id, 'partner', 'p1', 'Meera Krishnan' from auth.users where email = 'meera@horizonedu.in';`
4. Project Settings → API: copy the anon/publishable key into `VITE_SUPABASE_ANON_KEY`.
5. Authentication → URL Configuration: add your site URL (e.g. `https://crm.example.com/`) to Redirect URLs.
6. Google (optional): Authentication → Providers → Google, add the Google OAuth client ID/secret, then set `VITE_ENABLE_GOOGLE_AUTH=true`. Google users still need a `profiles` row to get in.

The migration creates every CRM table with partner-scoped RLS: partners only ever read and write rows with their own `partner_id`, payments and announcements are admin-managed, and triggers stop partners from moving applications past *Pending Assessment* or verifying documents.

**Current limitation:** authentication and roles use Supabase when configured, but CRM records (students, applications, …) are still stored in the browser via `src/store/store.tsx`. The tables and policies are ready; the next step is to replace the store actions with Supabase queries — pages read data only through `useScoped()` and won't need changes.

## Themes

Light, Dark and System themes, switchable from the sun/moon button in the top bar and on the login page, or under Settings / My Profile → Appearance. The choice is saved per device. Colours are CSS variables in `src/index.css` (`:root` for light, `.dark` for dark) exposed as Tailwind tokens (`bg-surface`, `bg-canvas`, `text-heading`, `border-line`, …). Charts get their palette from `useChartColors()` in `src/theme/theme.tsx`.

## Deploying to your own server

The build is plain static files with relative paths and hash routing — no Vercel/Netlify required.

```bash
npm ci
npm run build
rsync -a dist/ user@your-server:/var/www/ssi-crm/
```

`deploy/nginx.conf` is an example nginx site. Any static web server works (Apache, Caddy, a CDN bucket).

## Structure

```
src/
  auth/       config.ts (env), auth.ts (Supabase / prototype adapter), demoAccounts.ts
  theme/      theme.tsx (ThemeProvider, useTheme, useChartColors)
  data/       types.ts (domain model), seed.ts (sample data), demo.ts (partner preview)
  store/      store.tsx — data layer; all writes are named actions
  components/ ui kit, charts, forms, theme switcher, application drawer
  layouts/    AppShell (sidebar, top bar, search, notifications)
  pages/      admin/, client/, shared/ (pages mounted in both portals, scoped by role)
supabase/     migrations/ (schema + RLS), seed.sql
deploy/       nginx.conf
```

Data in prototype mode persists in `localStorage`; **Settings → Reset demo data** restores the sample records.
