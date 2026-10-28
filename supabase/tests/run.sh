#!/usr/bin/env bash
# Runs the migrations and security tests against a throwaway local PostgreSQL.
# Requires PostgreSQL 15+ binaries (initdb, pg_ctl, psql) on PATH.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="$(mktemp -d)"
PORT="${PGTEST_PORT:-54329}"
trap 'pg_ctl -D "$DIR" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT

LC_ALL=C initdb -D "$DIR" -U postgres --auth=trust --locale=C -E UTF8 >/dev/null
pg_ctl -D "$DIR" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" start >/dev/null
PGOPTIONS="-c client_min_messages=warning" && export PGOPTIONS
PSQL=(psql -h "$DIR" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -f tests/00_supabase_stub.sql
"${PSQL[@]}" -f migrations/0001_crm_auth_and_rls.sql
"${PSQL[@]}" -f migrations/0002_security_hardening.sql
"${PSQL[@]}" -f seed.sql
"${PSQL[@]}" -f tests/10_rls_tests.sql
