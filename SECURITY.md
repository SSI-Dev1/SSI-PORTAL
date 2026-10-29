# SSI GLOBAL CRM — Security architecture & report

This document describes how the CRM protects student and partner data, what was
tested, what you must configure before going live, and the risks that remain.

> **Status:** a secure *foundation*. It is not certified, pen-tested or "fully secure".
> Treat the "Required configuration" and "Remaining risks" sections as release blockers.

## 1. Architecture

```
Browser (static React app, HTTPS only, strict CSP)
   │  publishable anon key + user JWT (never a secret)
   ▼
Supabase (managed Postgres 15 + Auth + Storage, TLS, encrypted at rest)
   ├─ Auth: bcrypt password hashes, PKCE OAuth, rate limits, audit logs
   ├─ Postgres: Row-Level Security on every table → tenant + role isolation
   ├─ Storage: private bucket "student-documents", per-partner folder policies
   └─ Edge Function "admin-users": the only code holding the service-role key
Your VPS (nginx): serves static files only; holds no database credentials
```

Security is enforced **server-side**. The React app's route guards, hidden menus and
form validation are usability features only; every read and write is re-authorised by
Postgres RLS, triggers and storage policies, which were tested directly (section 6).

## 2. Authentication & passwords

Passwords are set by a Super Admin at account creation or reset (typed, or generated in the
browser with the Web Crypto CSPRNG). They are sent once over HTTPS to the `admin-users`
function, which passes them to Supabase Auth (bcrypt). They are never stored by the app,
logged, emailed, written to the audit log or shown again; the creation dialog shows the
password once so the admin can hand it over privately. "Require a password change at first
sign-in" is optional per account (off by default); it is enforced by the app's sign-in flow,
not by RLS.

| Control | Implementation |
| --- | --- |
| Password storage | Supabase Auth (bcrypt, per-password salt). The app never stores, logs or hashes passwords itself. |
| Transport | HTTPS only (HSTS on your server; Supabase is TLS-only). |
| Demo / offline login | **Removed.** No credentials or hashes in the bundle. Without a configured backend, sign-in is refused. |
| Role resolution | Read from `profiles` on every load via a server-validated session (`auth.getUser()`); never from browser storage. |
| Two-step verification | **Not enabled in this base release** (removed by `0003_remove_mfa_requirement.sql`). Sign-in is email + password (or Google). Recommended before storing real data — see §7. |
| Password policy | 12+ chars, upper/lower, digit, symbol, not containing the email name (client hint); enforce the same in Supabase (section 5). |
| Password reset | Supabase single-use, time-limited email links (PKCE); response never reveals whether an email exists; all other sessions revoked after a change. |
| Brute force / stuffing | Supabase Auth rate limits (429 surfaced as a friendly message); generic error messages; add CAPTCHA (section 5). |
| Google OAuth | Supabase OAuth with PKCE + state. Off until `VITE_ENABLE_GOOGLE_AUTH=true`; the button never fakes a login. Google users still need a `profiles` row. |
| Sessions | Short-lived JWT + rotating refresh token. Stored in `sessionStorage` (cleared on browser close) unless "Remember me". Auto sign-out after 30 min idle. Sign-out, "sign out all devices", and suspension revoke access. |
| Account suspension | `profiles.status = 'suspended'` removes all data access immediately (every RLS helper checks it) and the edge function bans the auth user (no new sign-ins/refresh). |

## 3. Authorisation (RBAC + tenant isolation)

Roles (`profiles.role`): employees — `super_admin`, `admin_staff`, `application_manager`,
`assessment_staff`, `finance_staff`, `support_staff`; partner users — `partner_admin`,
`partner_staff`. A user's organisation is `profiles.partner_id`, set only by a Super Admin.

**Employee permissions** (`0004_account_management.sql`). Each employee has module
permissions: `partners`, `students`, `applications`, `assessments`, `documents`, `finance`,
`catalogue`, `tasks`, `updates`, `reports`. They default by role and a Super Admin can
override them per person. Every table policy checks the module (`staff_can()`), so a
Finance Staff account gets no student rows even through the raw API. Account management
and the audit log are Super Admin only.

| Role | Default modules |
| --- | --- |
| Super Admin | everything + account management + audit log |
| Admin Staff | all modules |
| Application Manager | partners, students, applications, documents, catalogue, tasks, reports |
| Assessment Staff | partners, students, assessments, documents, catalogue, tasks |
| Finance Staff | partners, finance, reports, tasks |
| Support Staff | partners, students, updates, tasks |

**Partner portal control.** Each partner organisation has `portal_enabled`, a status
(Active / Onboarding / Inactive), `archived_at` and a module list (students, applications,
course finder, assessments, documents, finance, updates). If the portal is off, the partner
is Inactive or archived, `my_partner_id()` returns nothing and every partner user loses all
data access at once. Only a Super Admin can change these (database trigger); partners cannot
grant themselves anything. Course Finder is a menu switch — the catalogue itself stays readable
because applications reference it.

**Accounts and sessions.** Accounts are created by a Super Admin through the `admin-users`
Edge Function (service role) with an admin-chosen initial password — no invitations or
self-registration. Statuses: active / suspended / deactivated. Leaving "active", or an
administrative password reset, sets `sessions_revoked_at` and deletes the user's
`auth.sessions`; RLS rejects any access token issued before that time, so revocation is
immediate, not at token expiry. Suspended/deactivated users are also banned in Supabase Auth.
The last active Super Admin cannot be demoted or suspended.

| Data (employees: if the module is permitted) | Super Admin | Other employees | Partner Admin | Partner Staff |
| --- | --- | --- | --- | --- |
| Students, applications, documents, assessments | all | all, per module | own org, per enabled module | own org, per enabled module |
| Application offer/visa stages, document verification, assessment review | ✔ | ✔ | — | — |
| Invoices / finance | all | all, with `finance` | own org, read (if enabled) | — |
| Partner records | all; access, archive, delete | create/update details (portal closed until a Super Admin opens it) | own contact details | read own |
| Announcements | manage | manage | published + addressed only | same |
| Accounts, passwords, roles, permissions, suspension | ✔ | — | — | — |
| Audit log | read | — | — | — |

IDOR/BOLA defences: rows are filtered by RLS, so guessing another record's id returns
nothing. `partner_id` is **derived on the server** (from the user's profile, or from the
student for child records); a browser-supplied value is ignored. Records cannot be
re-parented to another organisation. Application refs, timelines and dates are
server-managed. No user can change their own role, organisation or status.

## 3b. Portals and real-time sync

**Three portals, one database.** Super Admins and Admin Staff use the Admin Portal (`/admin`),
the other employee roles use the Staff Portal (`/staff`: dashboard, assigned work, students,
applications, assessments, document verification, tasks, updates — filtered by permission),
and partner users use the Client Portal (`/client`). The portal is chosen from the role
returned by `my_access()`; the database enforces the same rules whichever URL is opened.

**Realtime** (`0005_realtime_notifications.sql`). The CRM tables, `activities`,
`notifications` and `profiles` are in the `supabase_realtime` publication. Supabase Realtime
evaluates each subscriber's RLS SELECT policy before delivering a change, so a partner never
receives another organisation's events (delete events carry only the primary key). The app
does not trust event payloads: an event only marks a table as changed, and the app re-fetches
that table through RLS (batched over 250 ms). On reconnect, tab focus or `online`, everything
is re-fetched, so missed events are reconciled. When a user's own profile or organisation
changes (permissions, suspension, portal switch) their access is re-resolved immediately.

**Notifications** are rows in `notifications`, written only by triggers after the change
commits, to recipients the database selects: partner users of the affected organisation (only
if the module is enabled and the portal open), employees whose permissions cover the module,
and assignees. Users can read, mark read and delete only their own rows; the actor is never
notified of their own action.

**Live Activity** entries are written by triggers (and by `admin-users` for account events)
and stamped server-side with the actor's name, role and organisation/department. Account
events are visible to Super Admins only.

**Concurrent edits.** Editable tables carry `updated_at`; the app sends the version it loaded
with each update. If someone else saved first, nothing is overwritten — the user sees "Updated
by someone else" and the latest version.

## 4. Data & documents

* **Database:** Supabase Postgres (AES-256 encryption at rest, TLS in transit). Anonymous
  role has no table privileges. All access is via PostgREST (parameterised; no SQL
  string building in the app). Security-definer functions use an empty `search_path`.
* **Documents:** private bucket, 10 MB limit, MIME allow-list (PDF, JPG, PNG, DOC/DOCX),
  path `partner/student/uuid.ext` (user file names never become paths). Upload type is
  verified from file content (magic bytes) before upload. Download: server checks access
  (`authorize_document_download`, RLS), logs it, then issues a **60-second signed URL**.
  Files are immutable; deleting a student deletes their files.
* **Audit log:** append-only (`audit_log`, no update/delete for anyone); records actor,
  role, action, record id, organisation, and *names* of changed fields (plus status/role
  transitions) — never field values, passwords or tokens. Covers sign-in/out,
  password change, idle timeout, document downloads, invites/suspensions, and every
  insert/update/delete on CRM tables. Failed sign-ins are in Supabase Auth logs.
* **Privacy (DPDP Act 2023):** data minimisation (no analytics, no third-party fonts or
  CDNs — zero third-party requests), generic error messages, retention function
  `purge_audit_log()`, secure deletion of documents. You remain the Data Fiduciary:
  publish a privacy notice, record consent, define retention per record type, and
  handle access/correction/erasure requests (Super Admin can delete student records).

## 5. Required production configuration (you must do this)

**Supabase dashboard**
1. SQL Editor: run `supabase/migrations/0002_security_hardening.sql` (0001 is already applied), then `supabase/seed.sql`. Never run `demo_data.sql` on production.
2. Authentication → Sign In / Providers → Email: **disable "Allow new users to sign up"** (accounts are created only by a Super Admin). Enable "Secure email change".
3. Authentication → Policies (Passwords): minimum length 12; require lower, upper, digits, symbols. Enable leaked-password protection (Pro plan).
4. SQL Editor: run `supabase/migrations/0003_remove_mfa_requirement.sql`, then `0004_account_management.sql`, then `0005_realtime_notifications.sql`, then `0006_realtime_catalogue.sql` — **together with this frontend and the new `admin-users` function** (the new app expects `my_access()`; the old function cannot create accounts).
5. Authentication → Sessions: JWT expiry 15–60 min; refresh-token rotation on (reuse interval ≤10 s); inactivity timeout/time-box (Pro plan).
6. Authentication → Rate Limits: review sign-in/OTP limits. Attack Protection → enable CAPTCHA (Cloudflare Turnstile/hCaptcha) — requires a small app change to pass the token.
7. Authentication → URL Configuration: Site URL and Redirect URLs = your exact production URL only.
8. Authentication → SMTP: your own SMTP (default is heavily rate-limited).
9. Database → Settings: **Enforce SSL**; Network Restrictions to your backup host IP.
10. Edge Function: `supabase functions deploy admin-users --project-ref goiyhrlhczygeweykwqq` and `supabase secrets set ALLOWED_ORIGINS=https://ssi-dev1.github.io` (your exact site origin).
11. First Super Admin: create the user in Authentication → Users, then
    `insert into public.profiles (id, role, full_name, email) select id, 'super_admin', 'Name', email from auth.users where email = '…';`
    Create everyone else from **User Management** (Add partner / Add employee / Add partner user).
12. Backups: Pro plan daily backups / PITR, or `deploy/backup.sh` (encrypted) — test restores.
13. Run Advisors → Security after applying migrations; resolve findings.

**Your server:** follow `deploy/SERVER-HARDENING.md` and `deploy/nginx.conf`
(TLS, HSTS, CSP header incl. `frame-ancestors 'none'`, firewall, SSH keys, fail2ban,
unattended upgrades, rate limiting, CDN/WAF for DDoS).

**GitHub Pages** cannot send security headers (no HSTS, no `frame-ancestors`/clickjacking
protection). Use it for demos only; host production on your server.

## 6. Security tests performed

| Test | Result |
| --- | --- |
| `npm run test:security` — 163 automated DB tests on PostgreSQL 16 with Supabase auth/storage stand-ins: anon lockout; cross-org read/write/delete (IDOR); tenant spoofing; cross-org linking; finance per role; role escalation; self-unsuspend; suspended user lockout; partner workflow guards; server-managed ref/timeline; audit log append-only and PII-free; storage cross-org upload/list/delete and path traversal; private bucket; **accounts (`20_account_tests.sql`)**: per-role module access for Finance Staff / Application Manager, permission grant/revoke takes effect immediately, employees cannot change their own or others' permissions, partner module switches, portal off / Inactive / archived removes access, partners cannot change their own access, new partners from non-super staff start closed, cross-partner read/write denied, suspension and deactivation lock-out, tokens issued before a reset or suspension rejected, `admin_revoke_sessions` service-role only, duplicate email rejected, user directory Super Admin only; **realtime (`30_realtime_tests.sql`)**: tables in the `supabase_realtime` publication (audit log excluded), notification targeting (right staff by permission, right partner users, not the actor, not suspended users, not other partners, not partners without the module), inbox isolation (no reading/forging/rewriting others' notifications), server-stamped activity actor/role/organisation, account events Super-Admin only, stale edits rejected via `updated_at`, assignment only to employees and only by staff, tasks visible to their assignee | **All pass** (also runs in CI: `.github/workflows/security.yml`) |
| Secret scan (source + built bundle) for service keys, private keys, JWTs, demo passwords | Clean. Anon key is only in git-ignored `.env` / CI secret |
| Removed client-side auth: demo account hashes deleted; role no longer stored in browser | Verified in `dist/` |
| Browser test of production build under CSP: no violations, 0 third-party requests, wrong-password sign-in returns generic error, only `ssi-remember` flag in storage, protected routes redirect to sign-in | Pass |
| Upload validation (magic bytes vs extension, size, safe names) | Implemented; storage policy also enforces |
| XSS review: no `dangerouslySetInnerHTML`, `eval`, `innerHTML`; React escapes output; strict CSP with hashed inline script | Pass |
| CSRF: no cookie-based auth (bearer tokens in headers), so classic CSRF does not apply; edge function checks Origin | Pass |
| SQL injection: no raw SQL from the client; PostgREST parameterises; DB functions take typed args | Pass |
| `npm audit --omit=dev` | No high/critical in production deps (see risks) |
| Edge function type-check (`deno check`) and input/password-policy unit tests (`deno test supabase/functions/admin-users/lib.test.ts`) | Pass |
| Real-time delivery across separate signed-in browser sessions (Admin / Partner / Staff) | **Not run** — needs migration 0005 on your project and three real accounts; the database side (publication, RLS on every streamed table, notification targeting) is covered by the tests above |
| End-to-end account flows (create employee/partner → sign in, reset → old sessions out, suspend, permission change) against your live project | **Not run** — needs migration 0004 and the new `admin-users` function deployed; the database rules behind each flow are covered by the tests above |

**Not tested (requires your live project):** end-to-end sign-in with real users, Google OAuth, the edge function deployed, and the
migration on your actual database. Run `supabase/tests/run.sh` logic again after any
schema change, and ideally commission an external penetration test before storing real
passports and financial documents.

## 7. Remaining risks & recommendations

1. **Tokens in browser storage.** Supabase JS keeps the session in session/localStorage,
   so a successful XSS could steal it. Mitigated by strict CSP, no HTML injection sinks,
   no third-party scripts, short JWT lifetime. Stronger option: a small backend-for-frontend
   on your VPS using HttpOnly, Secure, SameSite=Strict cookies.
2. **Malware scanning** of uploads is not available on Supabase Storage. Add a scanning
   step (e.g. ClamAV via an edge function/worker) before staff open files.
3. **Field-level encryption** for passport numbers is not implemented (disk encryption
   only). Consider pgsodium/Vault column encryption if required by your policy.
4. **Dev-only advisories:** `vite` 5 dev server (path traversal) and `react-router` 6
   (open redirect via `<Link>` backslashes; SSR hydration). The dev server is bound to
   localhost and not used in production; the app only navigates to fixed internal
   paths. Upgrade to vite 8 / react-router 7 when convenient.
5. **Client-reported events** (`log_event`) are recorded with the verified user id but
   their occurrence is reported by the client; authoritative sign-in records are in
   Supabase Auth logs.
6. **Partner admins cannot manage their own staff** — by design, a Super Admin creates every account.
7. **CAPTCHA, leaked-password protection, session time-box** need dashboard
   configuration (some require a paid Supabase plan).
8. **Git history** still contains the removed prototype account hashes (weak demo
   passwords). They never worked against Supabase; do not reuse those passwords.
9. **No second factor.** A stolen or phished password gives full access to that account's
   data. Add two-step verification (email code, authenticator app or passkeys) before
   storing real student documents, at least for Super Admin and Admin Staff.
10. **Alerting:** Supabase/nginx logs are available but no automated alerting is wired
   up. Add log drains or a SIEM and alert on repeated failures, role changes, and bulk downloads.
