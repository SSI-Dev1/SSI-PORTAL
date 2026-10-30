#!/usr/bin/env bash
# Runs the migrations and security tests against a throwaway local PostgreSQL.
# Requires PostgreSQL 15+ binaries (initdb, pg_ctl, psql) on PATH.
set -euo pipefail
# A valid locale for the whole server lifetime (macOS postmaster refuses to start otherwise).
export LC_ALL=C
cd "$(dirname "$0")/.."
DIR="$(mktemp -d)"
PORT="${PGTEST_PORT:-54329}"
trap 'pg_ctl -D "$DIR" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT

initdb -D "$DIR" -U postgres --auth=trust --locale=C -E UTF8 >/dev/null
pg_ctl -D "$DIR" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" start >/dev/null
PGOPTIONS="-c client_min_messages=warning" && export PGOPTIONS
PSQL=(psql -h "$DIR" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -f tests/00_supabase_stub.sql
"${PSQL[@]}" -f migrations/0001_crm_auth_and_rls.sql
"${PSQL[@]}" -f migrations/0002_security_hardening.sql
"${PSQL[@]}" -f migrations/0003_remove_mfa_requirement.sql
"${PSQL[@]}" -f migrations/0004_account_management.sql
"${PSQL[@]}" -f migrations/0005_realtime_notifications.sql
"${PSQL[@]}" -f migrations/0006_realtime_catalogue.sql
"${PSQL[@]}" -f migrations/0007_course_catalogue.sql
"${PSQL[@]}" -f migrations/0008_import_oxford_direct_fy27.sql
"${PSQL[@]}" -f migrations/0009_application_duplicates.sql
"${PSQL[@]}" -f migrations/0010_course_source_fields.sql
"${PSQL[@]}" -f migrations/0011_import_course_finder_uea.sql
"${PSQL[@]}" -f migrations/0012_hr_foundation.sql
"${PSQL[@]}" -f migrations/0013_attendance.sql
"${PSQL[@]}" -f migrations/0014_leave.sql
"${PSQL[@]}" -f migrations/0015_daily_reports.sql
"${PSQL[@]}" -f seed.sql
"${PSQL[@]}" -f tests/10_rls_tests.sql
"${PSQL[@]}" -f tests/20_account_tests.sql
"${PSQL[@]}" -f tests/30_realtime_tests.sql
"${PSQL[@]}" -f tests/40_catalogue_tests.sql
"${PSQL[@]}" -f tests/50_application_tests.sql
"${PSQL[@]}" -f tests/60_course_source_tests.sql
"${PSQL[@]}" -f tests/70_hr_tests.sql
# Optional: dump the imported CourseFinder records for scripts/verify-coursefinder.py.
if [ -n "${CATALOGUE_DUMP:-}" ]; then
  "${PSQL[@]}" -At -c "select jsonb_build_object(
      'university', (select to_jsonb(u) from public.universities u where name = 'University of East Anglia'),
      'courses', (select jsonb_agg(to_jsonb(c) || jsonb_build_object('intake_rows',
          (select coalesce(jsonb_agg(jsonb_build_object('month', i.intake_month, 'year', i.intake_year, 'deadline', i.application_deadline, 'notes', i.notes, 'status', i.status) order by i.intake_year, i.intake_month), '[]')
           from public.course_intakes i where i.course_id = c.id)))
        from public.courses c join public.universities u on u.id = c.university_id where u.name = 'University of East Anglia'))" > "$CATALOGUE_DUMP"
fi
