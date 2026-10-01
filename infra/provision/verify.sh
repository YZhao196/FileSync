#!/usr/bin/env bash
#
# Check that a provisioned server actually works.
#
# Provisioning reports that its steps succeeded, which is not the same claim.
# A step can exit zero and still leave nothing listening — Nextcloud answers
# 200 on /status.php while refusing every request by name, Immich comes up before
# its database does, the agent builds and then fails to reach the docker socket.
# This asks the questions that matter instead of the one that is easy.
#
# Run it on the server, after provisioning:
#
#     sudo bash infra/provision/verify.sh
#
# Exits non-zero if anything failed, so CI can use it too — the provisioning
# smoke test calls exactly this rather than keeping a second opinion about what
# working means.
#
# It is deliberately read-only. Nothing here changes the machine, so it is safe
# to run on a server that is in use, and safe to run when something is wrong.

set -uo pipefail

# Not set -e: every check should run and report. Stopping at the first failure
# would hide the other four, and a half-list is worse than none when the point
# is to find out what is broken.
#
# No backticks anywhere in this file either, matching provision.sh — the two are
# read together and a reader should not have to remember which rules apply.

FAILED=0
WARNED=0

pass() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
warn() { printf '  warn  %s\n' "$1"; WARNED=$((WARNED + 1)); }

STACK_DIR="${STACK_DIR:-/opt/filesynapse}"
PHOTOS_DIR="${PHOTOS_DIR:-/srv/photos}"
FILES_DIR="${FILES_DIR:-/srv/cloud}"

# "true" when a container with this exact name is running.
running() {
  docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$1"
}

# Poll a URL until it answers, or give up. Services here take minutes.
#
# Takes the URL, then everything else as curl arguments, so callers can add
# headers without a second function.
wait_for() {
  local url="$1"; shift
  local tries="${WAIT_TRIES:-40}"
  local i
  for i in $(seq 1 "$tries"); do
    curl -fsS "$@" "$url" >/dev/null 2>&1 && return 0
    sleep 3
  done
  return 1
}

echo
echo "Verifying the server at $STACK_DIR"
echo

# ── Docker ───────────────────────────────────────────────────────────────

if command -v docker >/dev/null 2>&1; then
  pass "docker is installed"
else
  fail "docker is not installed — nothing below can work"
  echo
  echo "1 check failed."
  exit 1
fi

# ── The libraries ────────────────────────────────────────────────────────

for dir in "$PHOTOS_DIR" "$FILES_DIR"; do
  if [ -d "$dir" ]; then
    pass "$dir exists"
  else
    fail "$dir does not exist"
  fi
done

# Nextcloud writes as uid 33. Provisioning chowns the files library for exactly
# this, and getting it wrong shows up much later as a files browser that cannot
# create anything.
if [ -d "$FILES_DIR" ]; then
  owner="$(stat -c '%u:%g' "$FILES_DIR" 2>/dev/null || echo '?')"
  if [ "$owner" = "33:33" ]; then
    pass "$FILES_DIR is owned by 33:33 (Nextcloud's uid)"
  else
    warn "$FILES_DIR is owned by $owner, not 33:33 — Nextcloud may not be able to write"
  fi
fi

# ── Immich ───────────────────────────────────────────────────────────────

if running immich_server; then
  pass "the Immich container is running"
  # /ping is public — it proves the process is up, not that anyone's key
  # works. That distinction matters here because it was the reason the app
  # reported a bad API key as connected for a long time.
  if wait_for http://localhost:2283/api/server/ping; then
    pass "Immich answers on 2283"
  else
    fail "Immich is running but never answered on 2283"
  fi
  # Immich comes up before PostgreSQL is ready and answers ping throughout,
  # which is why this checks the database separately rather than trusting it.
  if running immich_postgres; then
    pass "Immich's PostgreSQL is running"
  else
    fail "Immich's PostgreSQL is not running — the photo screens will fail"
  fi
else
  fail "the Immich container is not running"
fi

# ── Nextcloud ────────────────────────────────────────────────────────────

if running nextcloud; then
  pass "the Nextcloud container is running"

  if wait_for http://localhost:8080/status.php; then
    pass "Nextcloud answers on 8080"

    # The check this whole script was worth writing for. trusted_domains
    # holding only the short name is invisible from outside — Nextcloud is up,
    # answering, and refusing every request that arrives by another name with
    # "Access through untrusted domain", which reads like a broken install.
    if docker exec -u www-data nextcloud php occ config:list system >/dev/null 2>&1; then
      domains="$(docker exec -u www-data nextcloud php occ config:list system 2>/dev/null)"
      # Just the value, not the key: this line is read by someone debugging a
      # server, and `"overwritehost": "filesynapse"` makes them parse it.
      host="$(printf '%s' "$domains" | grep -o '"overwritehost": *"[^"]*"' | head -1 | sed 's/.*: *"//; s/"$//')"

      if [ -n "$host" ]; then
        pass "Nextcloud knows the host it is reached by ($host)"
      else
        warn "overwritehost is not set — links Nextcloud generates will use whatever host the request arrived on"
      fi

      # The tailnet name, if we can work out what it is.
      if command -v tailscale >/dev/null 2>&1; then
        fqdn="$(tailscale status --json 2>/dev/null | grep -o '"DNSName": *"[^"]*"' | head -1 | sed 's/.*: *"//; s/"$//; s/[.]$//')"
        if [ -n "$fqdn" ]; then
          if printf '%s' "$domains" | grep -q "$fqdn"; then
            pass "Nextcloud trusts the tailnet name ($fqdn)"
          else
            fail "Nextcloud does not trust $fqdn — reaching it by that name answers 'Access through untrusted domain'"
          fi
        fi
      fi
    else
      warn "could not read Nextcloud's configuration with occ"
    fi
  else
    fail "Nextcloud is running but never answered on 8080"
  fi

  if running nextcloud-db; then
    pass "Nextcloud's MariaDB is running"
  else
    fail "Nextcloud's MariaDB is not running"
  fi
else
  fail "the Nextcloud container is not running"
fi

# ── The host agent ───────────────────────────────────────────────────────

if running agent || running filesynapse-agent; then
  pass "the host agent container is running"

  if wait_for http://localhost:8787/health; then
    pass "the agent answers on 8787"
  else
    fail "the agent is running but never answered on 8787"
  fi

  # With a token, ask the question the app actually asks. Without one the agent
  # answers 401, which is correct and worth distinguishing from "broken".
  if [ -s "$STACK_DIR/agent/.env" ]; then
    token="$(grep -s '^AGENT_TOKEN=' "$STACK_DIR/agent/.env" | cut -d= -f2-)"
    if [ -n "$token" ]; then
      if curl -fsS -H "Authorization: Bearer $token" http://localhost:8787/api/status >/dev/null 2>&1; then
        pass "the agent accepts its token and reports status"
      else
        fail "the agent rejected its own token — the app will show an empty status panel"
      fi
    fi
  else
    warn "no agent .env found — the app cannot be given a token"
  fi
else
  warn "the host agent is not running — everything works except the status panel, which is the desktop app's main screen"
fi

# ── Backups ──────────────────────────────────────────────────────────────

if [ -f /etc/filesynapse/backup.env ]; then
  pass "backup credentials are configured"

  if systemctl list-unit-files 2>/dev/null | grep -q '^filesynapse-backup.timer'; then
    pass "the nightly backup timer is installed"
  else
    fail "backup credentials exist but the timer does not — nothing will run"
  fi

  if command -v restic >/dev/null 2>&1; then
    # shellcheck disable=SC1091
    if (set -a; . /etc/filesynapse/backup.env; set +a; restic snapshots >/dev/null 2>&1); then
      pass "the restic repository is reachable"
    else
      warn "restic could not reach the repository — check the Backblaze keys and the repository name"
    fi
  fi
else
  warn "no backup credentials — the nightly backup is not configured, so nothing is being copied off this machine"
fi

# ── Summary ──────────────────────────────────────────────────────────────

echo
if [ "$FAILED" -eq 0 ] && [ "$WARNED" -eq 0 ]; then
  echo "Everything checks out."
  exit 0
fi
if [ "$FAILED" -eq 0 ]; then
  printf '%s warning(s), nothing broken.\n' "$WARNED"
  exit 0
fi
printf '%s check(s) failed, %s warning(s).\n' "$FAILED" "$WARNED"
exit 1
