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
"${PSQL[@]}" -f seed.sql
"${PSQL[@]}" -f tests/10_rls_tests.sql
"${PSQL[@]}" -f tests/20_account_tests.sql
"${PSQL[@]}" -f tests/30_realtime_tests.sql
