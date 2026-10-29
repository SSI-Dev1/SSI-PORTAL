# SSI GLOBAL — Education CRM

Partner CRM for SSI GLOBAL: a **Super Admin Portal** for SSI GLOBAL management and a **Client Portal** for consultancy partners. React + TypeScript + Tailwind, built as a static site you can host on any server.

## Run

```bash
npm install
cp .env.example .env    # optional — see "Configuration"
npm run dev             # http://localhost:5173
npm run build           # static build in dist/
```

## Security

Read **[SECURITY.md](SECURITY.md)** before going live. In short: sign-in, roles and data
access are enforced by Supabase (Auth + Postgres row-level security + private Storage).
Partners only ever see their own organisation's data. Two-step verification is not
enabled in this base release. There is no offline or demo login.

```bash
npm run test:security   # database authorisation tests (needs PostgreSQL 15+ locally)
npm run audit           # production dependency audit
```

## Sign-in

Users sign in with email and password (or Google, once enabled). The app reads their
role from the server and sends SSI GLOBAL staff to the Admin Portal and partner users to
their own Client Portal. There is no self-registration and no invitation: a Super Admin
creates every account in **User Management** (partners with their login, partner staff and
employees), sets the initial password, roles, permissions and portal access, and can reset
passwords, suspend or deactivate accounts.

## Configuration

All settings are `VITE_*` variables (see `.env.example`). They are baked into the public
build, so only public values belong there — never the service-role key.

### Connecting Supabase (project `goiyhrlhczygeweykwqq`)

1. SQL Editor: run `supabase/migrations/0001_crm_auth_and_rls.sql` (already applied), then `0002_security_hardening.sql`, then `0003_remove_mfa_requirement.sql`, `0004_account_management.sql`, `0005_realtime_notifications.sql`, `0006_realtime_catalogue.sql`, then `supabase/seed.sql`.
2. For a demo/staging project only: `npm run demo:sql` and run `supabase/demo_data.sql`.
3. Deploy the admin edge function: `supabase functions deploy admin-users`.
4. Create the first Super Admin and complete the dashboard settings in SECURITY.md §5.

## Themes

Light, Dark and System themes, switchable from the sun/moon button in the top bar and on the login page, or under Settings / My Profile → Appearance. The choice is saved per device. Colours are CSS variables in `src/index.css` (`:root` for light, `.dark` for dark) exposed as Tailwind tokens (`bg-surface`, `bg-canvas`, `text-heading`, `border-line`, …). Charts get their palette from `useChartColors()` in `src/theme/theme.tsx`.

## Live site (GitHub Pages)

`.github/workflows/deploy-pages.yml` builds and publishes `main` to https://ssi-dev1.github.io/SSI-PORTAL/ on every push. One-time setup in the GitHub repo:

1. Settings → Pages → Source: **GitHub Actions**.
2. Settings → Secrets and variables → Actions → New repository secret: `VITE_SUPABASE_ANON_KEY` = your anon key.
3. Supabase → Authentication → URL Configuration: add `https://ssi-dev1.github.io/SSI-PORTAL/` to Redirect URLs (needed for password reset and Google).

GitHub Pages cannot send security headers (HSTS, clickjacking protection), so use it for demos only and host production on your own server.

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
  auth/       config.ts (env), auth.ts (Supabase Auth, passwords), AuthProvider.tsx (session, idle timeout)
  theme/      theme.tsx (ThemeProvider, useTheme, useChartColors)
  data/       types.ts (domain model), seed.ts (sample data), demo.ts (partner preview)
  store/      store.tsx — Supabase data layer (RLS-scoped reads, server-checked writes)
  lib/files.ts upload validation (content sniffing, size, safe names)
  components/ ui kit, charts, forms, theme switcher, application drawer
  layouts/    AppShell (sidebar, top bar, search, notifications)
  pages/      admin/, client/, shared/ (pages mounted in both portals, scoped by role)
supabase/     migrations/ (schema, RLS, audit, storage), functions/admin-users, tests/ (security tests), seed.sql
deploy/       nginx.conf (hardened), SERVER-HARDENING.md, backup.sh (encrypted backups)
```

All CRM data lives in Supabase; the browser keeps only theme and notification-read preferences.
