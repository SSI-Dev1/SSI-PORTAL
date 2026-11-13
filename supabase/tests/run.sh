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
"${PSQL[@]}" -f migrations/0016_attendance_parity.sql
"${PSQL[@]}" -f migrations/0017_work_activities.sql
"${PSQL[@]}" -f migrations/0018_application_chat.sql
"${PSQL[@]}" -f migrations/0019_advanced_course_search.sql
"${PSQL[@]}" -f migrations/0020_application_chat_all_portals.sql
"${PSQL[@]}" -f migrations/0021_attendance_auto_close.sql
"${PSQL[@]}" -f migrations/0022_partner_team.sql
"${PSQL[@]}" -f migrations/0023_half_day_leave_lop.sql
"${PSQL[@]}" -f migrations/0024_account_credentials.sql
"${PSQL[@]}" -f migrations/0025_hr_org_structure.sql
"${PSQL[@]}" -f migrations/0026_hr_leave_record_workforce_calendar.sql
"${PSQL[@]}" -f migrations/0027_hr_work_assets_documents.sql
"${PSQL[@]}" -f migrations/0028_employee_self_service.sql
"${PSQL[@]}" -f migrations/0029_commission_management.sql
"${PSQL[@]}" -f migrations/0030_partner_registration.sql
"${PSQL[@]}" -f migrations/0031_commission_partner_view_bulk.sql
"${PSQL[@]}" -f migrations/0032_partner_commission_preview.sql
"${PSQL[@]}" -f migrations/0033_partner_first_login.sql
"${PSQL[@]}" -f migrations/0034_agency_outreach.sql
"${PSQL[@]}" -f migrations/0035_agency_import.sql
"${PSQL[@]}" -f migrations/0036_partnership_settings_fix.sql
"${PSQL[@]}" -f migrations/0037_hide_commission_tiers.sql
"${PSQL[@]}" -f migrations/0038_proposal_custom_items.sql
"${PSQL[@]}" -f migrations/0039_linkedin_outreach_onboarding.sql
"${PSQL[@]}" -f seed.sql
"${PSQL[@]}" -f tests/10_rls_tests.sql
"${PSQL[@]}" -f tests/20_account_tests.sql
"${PSQL[@]}" -f tests/30_realtime_tests.sql
"${PSQL[@]}" -f tests/40_catalogue_tests.sql
"${PSQL[@]}" -f tests/50_application_tests.sql
"${PSQL[@]}" -f tests/60_course_source_tests.sql
"${PSQL[@]}" -f tests/70_hr_tests.sql
"${PSQL[@]}" -f tests/80_attendance_parity_tests.sql
"${PSQL[@]}" -f tests/90_work_activity_tests.sql
"${PSQL[@]}" -f tests/95_application_chat_tests.sql
"${PSQL[@]}" -f tests/96_course_search_tests.sql
"${PSQL[@]}" -f tests/97_application_chat_portals_tests.sql
"${PSQL[@]}" -f tests/98_attendance_auto_close_tests.sql
"${PSQL[@]}" -f tests/99_partner_team_tests.sql
"${PSQL[@]}" -f tests/100_half_day_leave_tests.sql
"${PSQL[@]}" -f tests/110_account_credentials_tests.sql
"${PSQL[@]}" -f tests/120_hr_org_structure_tests.sql
"${PSQL[@]}" -f tests/130_hr_leave_record_calendar_tests.sql
"${PSQL[@]}" -f tests/140_hr_work_assets_documents_tests.sql
"${PSQL[@]}" -f tests/150_employee_self_service_tests.sql
"${PSQL[@]}" -f tests/160_commission_tests.sql
"${PSQL[@]}" -f tests/170_partner_registration_tests.sql
"${PSQL[@]}" -f tests/180_commission_bulk_tests.sql
"${PSQL[@]}" -f tests/190_commission_tab_tests.sql
"${PSQL[@]}" -f tests/200_partner_first_login_tests.sql
"${PSQL[@]}" -f tests/210_agency_outreach_tests.sql
"${PSQL[@]}" -f tests/220_agency_import_tests.sql
"${PSQL[@]}" -f tests/230_safe_update_tests.sql
"${PSQL[@]}" -f tests/240_hide_tier_tests.sql
"${PSQL[@]}" -f tests/250_proposal_custom_items_tests.sql
"${PSQL[@]}" -f tests/260_linkedin_onboarding_tests.sql
# Optional: an extra local-only SQL file (e.g. a real-data import check that is never committed).
if [ -n "${EXTRA_SQL:-}" ]; then "${PSQL[@]}" -f "$EXTRA_SQL"; fi
# Optional: dump the imported CourseFinder records for scripts/verify-coursefinder.py.
if [ -n "${CATALOGUE_DUMP:-}" ]; then
  "${PSQL[@]}" -At -c "select jsonb_build_object(
      'university', (select to_jsonb(u) from public.universities u where name = 'University of East Anglia'),
      'courses', (select jsonb_agg(to_jsonb(c) || jsonb_build_object('intake_rows',
          (select coalesce(jsonb_agg(jsonb_build_object('month', i.intake_month, 'year', i.intake_year, 'deadline', i.application_deadline, 'notes', i.notes, 'status', i.status) order by i.intake_year, i.intake_month), '[]')
           from public.course_intakes i where i.course_id = c.id)))
        from public.courses c join public.universities u on u.id = c.university_id where u.name = 'University of East Anglia'))" > "$CATALOGUE_DUMP"
fi
