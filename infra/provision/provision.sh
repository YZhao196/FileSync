#!/usr/bin/env bash
#
# FileSynapse provisioning — turns a fresh Linux box into the server.
#
# This is PLAN.md §11's "Set as server" made real: Docker, the two
# role-separated storage folders, the Immich + Nextcloud stack, Tailscale, and a
# nightly restic backup to Backblaze. Nobody needs to open a terminal.
#
# The app runs this. It is also runnable by hand for debugging:
#
#   sudo PHOTOS_DIR=/srv/photos FILES_DIR=/srv/files \
#        TAILSCALE_NAME=filesynapse ./provision.sh
#
# Output protocol: one line per event, tab-separated —
#
#   step<TAB>start|ok|skipped|failed<TAB>detail
#
# The app parses those lines. Anything else on stdout is ignored, and stderr is
# passed through for the operator.
#
# UNVERIFIED: written against Debian 12/Ubuntu 22.04 without a machine to run it
# on. See for-human.md. Treat the first run as a test, on a machine you can
# rebuild.

set -euo pipefail

PHOTOS_DIR="${PHOTOS_DIR:-/srv/photos}"
FILES_DIR="${FILES_DIR:-/srv/files}"
TAILSCALE_NAME="${TAILSCALE_NAME:-filesynapse}"
TZ_NAME="${TZ_NAME:-UTC}"
B2_BUCKET="${B2_BUCKET:-}"
B2_KEY_ID="${B2_KEY_ID:-}"
B2_APP_KEY="${B2_APP_KEY:-}"
RESTIC_PASSWORD="${RESTIC_PASSWORD:-}"
BACKUP_HOUR="${BACKUP_HOUR:-3}"
STACK_DIR="${STACK_DIR:-/opt/filesynapse}"
# Temporary name used while replacing another server, so the working one keeps
# answering. Empty means "this is a fresh install, take the real name".
TAILSCALE_TEMP_NAME="${TAILSCALE_TEMP_NAME:-}"

emit() { printf '%s\t%s\t%s\n' "$1" "$2" "${3:-}"; }

# A step that fails should stop the run and say which one, rather than leaving
# the machine half-provisioned with no record of where it stopped.
step() {
  local name="$1"; shift
  emit "$name" start
  if "$@" >>/var/log/filesynapse-provision.log 2>&1; then
    emit "$name" ok
  else
    emit "$name" failed "see /var/log/filesynapse-provision.log"
    exit 1
  fi
}

skip() { emit "$1" skipped "$2"; }

log() { echo "[provision] $*" >&2; }

# ── Preflight ────────────────────────────────────────────────────────────
#
# Refuses rather than half-running. Anything the app's own preflight already
# checked is re-checked here, because this script must be safe to run alone.

: >/var/log/filesynapse-provision.log 2>/dev/null || true

if [[ "$(id -u)" -ne 0 ]]; then
  emit "preflight" failed "must run as root (use sudo)"
  exit 1
fi

if [[ ! -f /etc/debian_version ]]; then
  emit "preflight" failed "only Debian and Ubuntu are supported"
  exit 1
fi

if [[ "$PHOTOS_DIR" == "$FILES_DIR" ]]; then
  emit "preflight" failed "the photos and files folders must differ"
  exit 1
fi

emit "preflight" ok "$( . /etc/os-release && echo "${PRETTY_NAME:-Linux}" )"

# ── Packages ─────────────────────────────────────────────────────────────

step "Update package lists" bash -c 'apt-get update -qq'

if command -v docker >/dev/null 2>&1; then
  skip "Install Docker" "already present"
else
  step "Install Docker" bash -c '
    apt-get install -y -qq ca-certificates curl gnupg
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
    systemctl enable --now docker
  '
fi

step "Install utilities" bash -c 'apt-get install -y -qq curl jq openssl'

# ── Storage folders ──────────────────────────────────────────────────────
#
# Two roles, two folders. Different disks are strongly preferred — that is what
# keeps one drive failure to one role — but it is a recommendation, and the app
# warns rather than refuses.

step "Create photos folder" mkdir -p "$PHOTOS_DIR"
# The files folder is chowned to Nextcloud's uid later, once the stack is
# written — see "Set files ownership" below, and why it is 33 and not 1000.
step "Create files folder" mkdir -p "$FILES_DIR"

# ── The stacks ───────────────────────────────────────────────────────────
#
# Two, not one.
#
# The single hand-rolled stack that used to be here pointed Immich at
# Nextcloud's MariaDB. Immich requires PostgreSQL — it could never have started.
# PLAN.md §7 says the same thing the other way round: run Immich's own compose
# for the photo side rather than hand-rolling one.
#
# Separating them also gives each application its own Redis. Nextcloud uses Redis
# for file locking and Immich uses it for job queues, and neither expects to share
# a keyspace.
#
# Immich's compose is *fetched*, as a release asset, exactly as Immich's own
# install guide instructs — never copied into this repository. It is AGPL-3.0,
# and running it unmodified at arm's length is what keeps FileSynapse
# proprietary (PLAN.md §13.4). Override IMMICH_COMPOSE_URL to pin a release.

IMMICH_DIR="$STACK_DIR/immich"
NEXTCLOUD_DIR="$STACK_DIR/nextcloud"
IMMICH_COMPOSE_URL="${IMMICH_COMPOSE_URL:-https://github.com/immich-app/immich/releases/latest/download/docker-compose.yml}"

# Two passwords: these are two different database servers.
DB_PASSWORD="$(openssl rand -hex 24)"
IMMICH_DB_PASSWORD="$(openssl rand -hex 24)"

# Where Immich's PostgreSQL data lives. It is deliberately not inside the photos
# library, and it defaults to the stack directory — which is the OS disk. That is
# fine for a personal library and wrong for a large one: point IMMICH_DB_DIR at a
# data drive if the OS disk is small. Postgres data must not sit on a network
# share.
IMMICH_DB_DIR="${IMMICH_DB_DIR:-$IMMICH_DIR/postgres}"

step "Fetch Immich's compose" bash -c "
  mkdir -p '$IMMICH_DIR'
  # Fetched to a temporary name and moved, so a half-downloaded file is never
  # left where compose would read it.
  curl -fsSL '$IMMICH_COMPOSE_URL' -o '$IMMICH_DIR/docker-compose.yml.new'
  mv '$IMMICH_DIR/docker-compose.yml.new' '$IMMICH_DIR/docker-compose.yml'
"

step "Configure Immich" bash -c "
  mkdir -p '$IMMICH_DB_DIR'
  cat > '$IMMICH_DIR/.env' <<ENV
# Written by FileSynapse provisioning. Keys are Immich's own; values are this
# machine's. Immich reads this file directly — edit it there, not here.
UPLOAD_LOCATION=$PHOTOS_DIR
DB_DATA_LOCATION=$IMMICH_DB_DIR
TZ=$TZ_NAME
DB_PASSWORD=$IMMICH_DB_PASSWORD
DB_USERNAME=postgres
DB_DATABASE_NAME=immich
ENV
  chmod 600 '$IMMICH_DIR/.env'
"

step "Write Nextcloud stack" bash -c "
  mkdir -p '$NEXTCLOUD_DIR'
  cat > '$NEXTCLOUD_DIR/docker-compose.yml' <<'COMPOSE'
name: nextcloud

services:
  app:
    image: nextcloud:apache
    container_name: nextcloud
    restart: unless-stopped
    mem_limit: \${NEXTCLOUD_MEMORY:-1500m}
    # The database has to be *ready*, not merely started. Nextcloud installs its
    # schema on first boot, and a MariaDB that is still initialising turns that
    # into a failed install that looks like a broken image.
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      # The library, on its own disk. Nextcloud's data directory must be a real
      # filesystem, not a network share.
      - \${FILES_DIR}:/var/www/html/data
    environment:
      MYSQL_HOST: db
      MYSQL_DATABASE: nextcloud
      MYSQL_USER: nextcloud
      MYSQL_PASSWORD: \${DB_PASSWORD}
      REDIS_HOST: redis
      NEXTCLOUD_TRUSTED_DOMAINS: \${TAILSCALE_NAME}
    ports: ['8080:80']

  db:
    image: mariadb:11
    container_name: nextcloud-db
    restart: unless-stopped
    mem_limit: \${NEXTCLOUD_DB_MEMORY:-1g}
    command: --transaction-isolation=READ-COMMITTED --binlog-format=ROW
    volumes:
      - db-data:/var/lib/mysql
    environment:
      MYSQL_ROOT_PASSWORD: \${DB_PASSWORD}
      MYSQL_DATABASE: nextcloud
      MYSQL_USER: nextcloud
      MYSQL_PASSWORD: \${DB_PASSWORD}
    healthcheck:
      test: ['CMD', 'healthcheck.sh', '--connect', '--innodb_initialized']
      interval: 20s
      timeout: 10s
      retries: 5
      start_period: 60s

  redis:
    image: redis:7-alpine
    container_name: nextcloud-redis
    restart: unless-stopped
    mem_limit: \${NEXTCLOUD_REDIS_MEMORY:-256m}
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 20s
      timeout: 5s
      retries: 5

volumes:
  db-data:
COMPOSE

  cat > '$NEXTCLOUD_DIR/.env' <<ENV
FILES_DIR=$FILES_DIR
TAILSCALE_NAME=$TAILSCALE_NAME
DB_PASSWORD=$DB_PASSWORD
ENV
  chmod 600 '$NEXTCLOUD_DIR/.env'
"

# Nextcloud writes as www-data, which is uid 33 in its image. This used to chown
# to 1000:1000, which left the library unwritable and would have shown up as a
# files browser that could not create anything. PLAN.md §7 records the same trap.
step "Set files ownership" bash -c "chown -R 33:33 '$FILES_DIR'"

step "Start Immich" bash -c "cd '$IMMICH_DIR' && docker compose up -d"
step "Start Nextcloud" bash -c "cd '$NEXTCLOUD_DIR' && docker compose up -d"

# ── Tailscale ────────────────────────────────────────────────────────────
#
# Everything reaches this machine by its Tailscale name, so the name is the
# thing that actually gets replaced later. While replacing, the machine joins
# under a temporary name and only takes the real one once the copy is verified.

if command -v tailscale >/dev/null 2>&1; then
  skip "Install Tailscale" "already present"
else
  step "Install Tailscale" bash -c 'curl -fsSL https://tailscale.com/install.sh | sh'
fi

JOIN_NAME="${TAILSCALE_TEMP_NAME:-$TAILSCALE_NAME}"
if tailscale status >/dev/null 2>&1; then
  skip "Join the tailnet" "already joined"
else
  step "Join the tailnet" bash -c "tailscale up --hostname '$JOIN_NAME' --accept-routes"
fi

# ── Backup ───────────────────────────────────────────────────────────────
#
# restic to Backblaze B2, nightly, with a systemd timer. The timer writes a
# status file so the host agent can report certainty rather than inferring
# success from snapshot age.

if [[ -n "$B2_BUCKET" && -n "$B2_KEY_ID" && -n "$B2_APP_KEY" && -n "$RESTIC_PASSWORD" ]]; then
  step "Install restic" bash -c 'apt-get install -y -qq restic'

  step "Write backup job" bash -c "
    mkdir -p /etc/filesynapse
    cat > /etc/filesynapse/backup.env <<ENV
RESTIC_REPOSITORY=b2:$B2_BUCKET:/filesynapse
B2_ACCOUNT_ID=$B2_KEY_ID
B2_ACCOUNT_KEY=$B2_APP_KEY
RESTIC_PASSWORD=$RESTIC_PASSWORD
ENV
    chmod 600 /etc/filesynapse/backup.env

    cat > /usr/local/bin/filesynapse-backup <<'BACKUP'
#!/usr/bin/env bash
set -uo pipefail
. /etc/filesynapse/backup.env
STATUS=/var/lib/filesynapse/last-backup
mkdir -p \"\$(dirname \"\$STATUS\")\"
if restic snapshots >/dev/null 2>&1 || restic init; then
  if restic backup '$PHOTOS_DIR' '$FILES_DIR' --exclude-caches; then
    printf 'ok %s\\n' \"\$(date -Is)\" > \"\$STATUS\"
    exit 0
  fi
fi
printf 'failed %s\\n' \"\$(date -Is)\" > \"\$STATUS\"
exit 1
BACKUP
    chmod 755 /usr/local/bin/filesynapse-backup

    cat > /etc/systemd/system/filesynapse-backup.service <<'UNIT'
[Unit]
Description=FileSynapse restic backup

[Service]
Type=oneshot
ExecStart=/usr/local/bin/filesynapse-backup
UNIT

    cat > /etc/systemd/system/filesynapse-backup.timer <<'UNIT'
[Unit]
Description=Nightly FileSynapse backup

[Timer]
OnCalendar=*-*-* $BACKUP_HOUR:00:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT

    systemctl daemon-reload
    systemctl enable --now filesynapse-backup.timer
  "
else
  skip "Configure backup" "no Backblaze credentials supplied"
fi

# ── Transfer, when replacing another server ──────────────────────────────

if [[ -n "${SOURCE_ADDRESS:-}" && "${TRANSFER:-fresh}" != "fresh" ]]; then
  step "Install transfer tools" bash -c 'apt-get install -y -qq rsync'

  if [[ "${TRANSFER}" == "sync" ]]; then
    # Copy the current state exactly. The old server must stay up until this
    # finishes and is verified — that is why it is a step and not a background
    # job nobody watches.
    step "Sync from the old server" bash -c "
      rsync -aH --info=progress2 'root@${SOURCE_ADDRESS}:${PHOTOS_DIR}/' '$PHOTOS_DIR/' &&
      rsync -aH --info=progress2 'root@${SOURCE_ADDRESS}:${FILES_DIR}/' '$FILES_DIR/'
    "
  elif [[ "${TRANSFER}" == "restore" ]]; then
    step "Restore the latest snapshot" bash -c "
      . /etc/filesynapse/backup.env
      restic restore latest --target /
    "
  fi
fi

# ── Done ─────────────────────────────────────────────────────────────────

emit "summary" ok "https://${JOIN_NAME}  · photos :2283 · files :8080"
log "Provisioning finished. Deploy the host agent next — see infra/agent/README.md."
