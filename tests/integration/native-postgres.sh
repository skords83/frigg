#!/usr/bin/env bash
# Never use an inherited DATABASE_URL. Own a fresh, socket-only cluster.
set -euo pipefail
unset DATABASE_URL PGHOSTADDR PGPORT PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSWORD
export PGCONNECT_TIMEOUT=5
pgbin=${FRIGG_TEST_PG_BIN:-$(dirname "$(command -v initdb)")}
: "${FRIGG_BAIKAL_RELEASE:?Set the isolated Baikal release path}"
work=$(mktemp -d /tmp/frigg-native-pg-XXXXXX)
cleanup() { "$pgbin/pg_ctl" -D "$work/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
"$pgbin/initdb" -D "$work/data" -A trust -U frigg_test --no-locale > "$work/init.log"
"$pgbin/pg_ctl" -D "$work/data" -l "$work/server.log" -o "-k $work -c listen_addresses='' -c unix_socket_permissions=0700 -c deadlock_timeout=100ms" start
"$pgbin/createdb" -h "$work" -U frigg_test frigg_synthetic
export PGHOST="$work" PGUSER=frigg_test PGDATABASE=frigg_synthetic
unset DATABASE_URL PGPORT PGSERVICE PGSERVICEFILE
export FRIGG_NATIVE_PG="$work" FRIGG_TEST_PG_BIN="$pgbin"
node --import tsx --test api/test/baikal.integration.ts
