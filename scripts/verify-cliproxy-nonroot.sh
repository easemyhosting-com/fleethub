#!/usr/bin/env bash
# Disposable proof that the optional gateway runs non-root through compose.yml and
# adopts a credential volume written by the earlier root-run image. Synthetic values only.
# Uses a unique Compose project, publishes no host ports, and removes its volumes on exit.
# VERIFY_DIR must be a host directory the Docker daemon can bind-mount (default: mktemp).
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
cd "$root"
project="fleethub-verify-cliproxy-$$"
work="$(mktemp -d "${VERIFY_DIR:-${TMPDIR:-/tmp}}/cliproxy-verify.XXXXXX")"
uid="$(id -u)" gid="$(id -g)"
[ "$uid" -ne 0 ] || { echo "Run as a non-root user" >&2; exit 2; }
image="$(sed -n 's/^ARG CLIPROXY_IMAGE=//p' cliproxy/Dockerfile)"
cleanup() {
  docker compose -p "$project" -f compose.yml -f "$work/override.yml" --profile cliproxy down -v --rmi local --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

umask 077
printf '%s\n' 'config-version: 8' 'server:' '  host: ""' '  port: 8317' 'management:' '  allow-remote: false' \
  '  secret-key: "synthetic-management-value"' 'access:' '  api-keys:' '    - "synthetic-api-value"' \
  'oauth:' '  auth-dir: /root/.cli-proxy-api' 'observability:' '  logs:' '    logging-to-file: false' > "$work/config.yaml"
printf '%s\n' 'services:' '  cli-proxy-api:' '    ports: !reset []' > "$work/override.yml"
export CLIPROXY_CONFIG_PATH="$work/config.yaml" FLEETHUB_DB_PASSWORD=synthetic FLEETHUB_AUTH_SECRET=synthetic
compose() { docker compose -p "$project" -f compose.yml -f "$work/override.yml" --profile cliproxy "$@"; }
fail() { echo "FAIL: $1" >&2; compose logs --no-color cli-proxy-api-volumes cli-proxy-api 2>&1 | grep -viE 'secret|key' | tail -20 >&2; exit 1; }

# A credential volume as the root-run image left it: root-owned, private file.
docker volume create "${project}_cliproxy_auth" >/dev/null
docker run --rm --network none -v "${project}_cliproxy_auth:/a" --entrypoint sh "$image" \
  -c 'echo "{}" > /a/synthetic-auth.json && chmod 0600 /a/synthetic-auth.json && chmod 0700 /a'

CLIPROXY_UID=0 CLIPROXY_GID=0 compose up -d cli-proxy-api >/dev/null 2>&1 && fail "root runtime IDs were accepted"
[ "$(compose ps -a --format '{{.ExitCode}}' cli-proxy-api-volumes)" = 64 ] || fail "root runtime IDs did not stop the ownership step"
compose down >/dev/null 2>&1

CLIPROXY_UID="$uid" CLIPROXY_GID="$gid" compose up -d --build cli-proxy-api >/dev/null || fail "gateway did not start"
for _ in $(seq 1 30); do compose logs --no-color cli-proxy-api 2>&1 | grep -q 'API server started' && break; sleep 1; done
sleep 3
[ "$(compose ps --format '{{.State}}' cli-proxy-api)" = running ] || fail "gateway is not running"
! compose logs --no-color cli-proxy-api 2>&1 | grep -qi 'permission denied' || fail "gateway hit a permission error"
[ "$(compose exec -T cli-proxy-api id -u)" = "$uid" ] || fail "gateway process is not the config owner"
owner="$(compose exec -T cli-proxy-api stat -c '%u:%g' /root/.cli-proxy-api/synthetic-auth.json)"
[ "$owner" = "$uid:$gid" ] || fail "existing credential file was not adopted"
container="$(compose ps -q cli-proxy-api)"
[ "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.HostConfig.SecurityOpt}}' "$container")" = 'true [ALL] [no-new-privileges:true]' ] || fail "hardening options missing"
echo "CLIProxy non-root verification passed (uid $uid, adopted root-owned credential volume, read-only root filesystem)."
