#!/usr/bin/env bash
#
# A full provisioning run, on a machine you are willing to lose.
#
# This is the same thing .github/workflows/provision-smoke.yml does, without
# GitHub. That workflow was written because nothing in this project had ever
# executed its own critical path — every claim about it was a reading of the
# script — and then it turned out to be unrunnable for reasons that had nothing
# to do with provisioning. Having the only end-to-end test live behind an
# account setting is a poor arrangement; this is the same test, wherever there
# is Linux.
#
#     sudo bash infra/provision/smoke.sh
#
# It installs packages, starts Docker, fetches Immich's compose, brings up both
# stacks and builds the host agent. Do not run it on a machine you care about.
# A throwaway VM is the right shape.
#
# Exits non-zero if provisioning failed or if verify.sh found anything wrong.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

# ── Preflight ────────────────────────────────────────────────────────────

if [ "$(id -u)" -ne 0 ]; then
  echo "This installs packages and starts services, so it needs root:"
  echo
  echo "    sudo bash $0"
  exit 1
fi

if [ ! -f /etc/debian_version ]; then
  echo "Provisioning targets Debian and Ubuntu; this is neither."
  exit 1
fi

# The tailnet is the one thing that genuinely cannot be exercised here.
#
# Joining a real one has two problems: it needs an auth key, and it would add a
# machine called filesynapse to somebody's actual network — which is a real
# side effect on an account, produced by a test. So the stub is the default and
# a real join has to be asked for.
USE_REAL_TAILSCALE="${SMOKE_REAL_TAILSCALE:-0}"

# ── Stand in for Tailscale ───────────────────────────────────────────────

STUB_DIR="$(mktemp -d)"
cleanup() { rm -rf "$STUB_DIR"; }
trap cleanup EXIT

if [ "$USE_REAL_TAILSCALE" = "1" ] && command -v tailscale >/dev/null 2>&1; then
  echo "Using the real Tailscale, as asked. This machine will join the tailnet."
else
  cat > "$STUB_DIR/tailscale" <<'STUB'
#!/bin/bash
case "$1" in
  status)
    if [ "$2" = "--json" ]; then
      echo '{"Self":{"DNSName":"filesynapse.tailnet.test.","TailscaleIPs":["100.64.0.1"]}}'
    fi
    exit 0
    ;;
  ip) echo "100.64.0.1"; exit 0 ;;
  *) exit 0 ;;
esac
STUB
  chmod +x "$STUB_DIR/tailscale"
  echo "Stood in for Tailscale — the tailnet is the one part this cannot test."
  echo "Set SMOKE_REAL_TAILSCALE=1 to join a real one instead."
fi

echo

# ── Provision ────────────────────────────────────────────────────────────

# The agent files, as the app would supply them: it embeds them and writes them
# beside the script. This passes the repository copy instead, so the deploy path
# is exercised rather than the "no agent files were supplied" skip.
AGENT_DIR="$REPO/infra/agent" \
PATH="$STUB_DIR:$PATH" \
  bash "$HERE/provision.sh"

provisioned=$?

echo
if [ "$provisioned" -ne 0 ]; then
  echo "Provisioning failed. /var/log/filesynapse-provision.log has the steps."
  echo "Treat that as the result rather than retrying blind."
  exit "$provisioned"
fi

# ── Verify ───────────────────────────────────────────────────────────────
#
# The same script somebody runs on their own server afterwards, called rather
# than reimplemented, so there is one definition of what a working server means.

echo
PATH="$STUB_DIR:$PATH" bash "$HERE/verify.sh"
verified=$?

echo
if [ "$verified" -ne 0 ]; then
  echo "Provisioning reported success and the server does not work."
  echo "That gap is the reason verify.sh exists; the output above says where."
  exit 1
fi

echo "Provisioning ran, and the result checks out."
