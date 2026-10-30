#!/bin/sh
# Runs the Pulse SQL tests on a throwaway local Postgres. Never touches the Supabase project.
set -eu
# macOS: postmaster refuses to start with a pt_BR locale it treats as multithreaded.
export LC_ALL=C
here=$(cd "$(dirname "$0")" && pwd); root=$(dirname "$here")
work=$(mktemp -d "${PULSE_TEST_TMP:-${TMPDIR:-/tmp}}/pulse-pg.XXXXXX")
trap 'pg_ctl -D "$work/data" stop -m immediate >/dev/null 2>&1; rm -rf "$work"' EXIT
initdb -D "$work/data" -A trust -U postgres >/dev/null
pg_ctl -D "$work/data" -o "-k '' -c listen_addresses=127.0.0.1 -p 55491" -l "$work/log" -w start >/dev/null
run(){ psql -h 127.0.0.1 -p 55491 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X "$@"; }
for file in "$here/stubs.sql" "$root/schema.sql" "$root/team-access.sql" "$here/seed.sql" \
  "$root/migrations/20261011175910_pulse_publication_accounts.sql" "$root/migrations/20261028150000_pulse_meta_publishing.sql" \
  "$root/migrations/20261028180000_pulse_meta_unified_login.sql" "$root/migrations/20261028190000_pulse_meta_oauth_ttl.sql" "$root/migrations/20261028200000_pulse_meta_pending_token.sql" \
  "$root/migrations/20261028220000_pulse_external_publication.sql" "$root/migrations/20261030222605_pulse_planning_outcomes.sql" "$root/migrations/20261030223148_pulse_agent_commands.sql"; do
 run -f "$file"
done
run -c "insert into public.pulse_editorial_accounts(workspace_id,account_key,name,instagram_handle) values ('33333333-3333-4333-8333-333333333333','principal','Perfil de exemplo','perfil.exemplo'),('33333333-3333-4333-8333-333333333333','secundaria','Segundo perfil',null);"
run -f "$root/publication-access.test.sql"
run -t -f "$root/meta-publishing.test.sql"
