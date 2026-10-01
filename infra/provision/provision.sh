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
#   sudo PHOTOS_DIR=/srv/photos FILES_DIR=/srv/cloud \
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
# on. See filesynapsetodo.md. Treat the first run as a test, on a machine you can
# rebuild.

set -euo pipefail

PHOTOS_DIR="${PHOTOS_DIR:-/srv/photos}"
FILES_DIR="${FILES_DIR:-/srv/cloud}"
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

# A multi-command step body, run fail-fast.
#
# A step body runs in a child shell, and a child does **not** inherit set -e or
# set -u from this script. A body of several commands therefore reported success
# as long as its *last* command succeeded, so a failed write in the middle was
# invisible: the step went green and the run ended with a success summary. That
# is the worst way to lose data — the nightly backup job is written by such a
# body.
#
# Every body of more than one command goes through here. A bare single command
# (mkdir -p, say) needs no wrapper.
#
# Nothing in this file may contain a backtick, comments included — CI greps for
# one and refuses the build. That is not pedantry: step bodies below are written
# inside double-quoted strings, where a backtick is command substitution and
# runs at provision time. One in a comment about pulling images would have
# pulled them. Keep the names above unquoted; that is why.
run() { bash -euo pipefail -c "$1"; }

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

step "Update package lists" run 'apt-get update -qq'

if command -v docker >/dev/null 2>&1; then
  skip "Install Docker" "already present"
else
  step "Install Docker" run '
    apt-get install -y -qq ca-certificates curl gnupg
    # Both directories are created rather than assumed. Stock Debian ships
    # sources.list.d, but a stripped or container-derived image may not, and this
    # script has no business depending on a directory it writes into.
    install -m 0755 -d /etc/apt/keyrings /etc/apt/sources.list.d
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

step "Install utilities" run 'apt-get install -y -qq curl jq openssl'

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

step "Fetch Immich's compose" run "
  mkdir -p '$IMMICH_DIR'
  # Fetched to a temporary name and moved, so a half-downloaded file is never
  # left where compose would read it.
  curl -fsSL '$IMMICH_COMPOSE_URL' -o '$IMMICH_DIR/docker-compose.yml.new'
  mv '$IMMICH_DIR/docker-compose.yml.new' '$IMMICH_DIR/docker-compose.yml'
"

step "Configure Immich" run "
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

step "Write Nextcloud stack" run "
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
      # Nextcloud generates its config, its installed apps and its themes inside
      # the application directory on first run. None of that is in the image, so
      # without these the container's writable layer holds the only copy of
      # config.php — which holds the database password and the instance identity.
      # Recreate the container and Nextcloud asks to be installed again, over a
      # data directory full of files it no longer knows how to read.
      #
      # Three directories rather than all of /var/www/html, deliberately: a volume
      # over the whole application directory would pin the code at whatever
      # version first ran, and a later image pull would stop upgrading
      # Nextcloud. PLAN.md §7's sketch mounts the whole thing and inherits that.
      #
      # No backticks anywhere in this file: it is a double-quoted shell string,
      # so they are command substitution, not punctuation.
      - nextcloud-config:/var/www/html/config
      - nextcloud-apps:/var/www/html/custom_apps
      - nextcloud-themes:/var/www/html/themes
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
  nextcloud-config:
  nextcloud-apps:
  nextcloud-themes:
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
step "Set files ownership" run "chown -R 33:33 '$FILES_DIR'"

step "Start Immich" run "cd '$IMMICH_DIR' && docker compose up -d"
step "Start Nextcloud" run "cd '$NEXTCLOUD_DIR' && docker compose up -d"

# ── Tailscale ────────────────────────────────────────────────────────────
#
# Everything reaches this machine by its Tailscale name, so the name is the
# thing that actually gets replaced later. While replacing, the machine joins
# under a temporary name and only takes the real one once the copy is verified.

if command -v tailscale >/dev/null 2>&1; then
  skip "Install Tailscale" "already present"
else
  step "Install Tailscale" run 'curl -fsSL https://tailscale.com/install.sh | sh'
fi

JOIN_NAME="${TAILSCALE_TEMP_NAME:-$TAILSCALE_NAME}"
if tailscale status >/dev/null 2>&1; then
  skip "Join the tailnet" "already joined"
else
  step "Join the tailnet" run "tailscale up --hostname '$JOIN_NAME' --accept-routes"
fi

# ── The names Nextcloud answers to ───────────────────────────────────────
#
# This is the first thing anyone hits, and it is an ordering problem rather
# than a mistake: Nextcloud's compose is written and the container started
# *before* this machine joins the tailnet, so NEXTCLOUD_TRUSTED_DOMAINS can
# only carry the short name at that point. Reach the server by anything else —
# the MagicDNS FQDN, or the 100.x address — and Nextcloud answers "Access
# through untrusted domain", which reads like a broken install rather than a
# setting.
#
# Both of those are knowable only now, so they are added here. occ rather than
# editing config.php: it is the supported path, it is idempotent, and it needs
# no restart. Index 0 belongs to the name the compose file set, so this starts
# at 1 and adds to it.
#
# No backticks in this block, like the rest of the file — it is a double-quoted
# shell string and they would be command substitution.
if docker ps --format '{{.Names}}' | grep -qx nextcloud; then
  step "Trust the tailnet names" run "
    # A running container is not an installed Nextcloud. It takes minutes to
    # create its schema on first boot, and occ answers 'Nextcloud is not
    # installed yet' until it has finished — so this waits for occ to work
    # rather than for the container to exist. Bounded at three minutes, because
    # a wait with no ceiling is a hang, and a hang here would look like the
    # provisioning freezing rather than like this step.
    for attempt in \$(seq 1 36); do
      docker exec -u www-data nextcloud php occ status >/dev/null 2>&1 && break
      sleep 5
    done

    FQDN=\$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/[.]\$//')
    IP=\$(tailscale ip -4 | head -1)
    index=1
    for name in \"\$FQDN\" \"\$IP\"; do
      [ -n \"\$name\" ] || continue
      docker exec -u www-data nextcloud php occ config:system:set \
        trusted_domains \"\$index\" --value=\"\$name\" >/dev/null
      index=\$((index + 1))
    done
  "
else
  skip "Trust the tailnet names" "no Nextcloud container is running"
fi

# ── Backup ───────────────────────────────────────────────────────────────
#
# restic to Backblaze B2, nightly, with a systemd timer. The timer writes a
# status file so the host agent can report certainty rather than inferring
# success from snapshot age.

if [[ -n "$B2_BUCKET" && -n "$B2_KEY_ID" && -n "$B2_APP_KEY" && -n "$RESTIC_PASSWORD" ]]; then
  step "Install restic" run 'apt-get install -y -qq restic'

  step "Write backup job" run "
    mkdir -p /etc/filesynapse
    cat > /etc/filesynapse/backup.env <<ENV
RESTIC_REPOSITORY=b2:$B2_BUCKET:/filesynapse
B2_ACCOUNT_ID=$B2_KEY_ID
B2_ACCOUNT_KEY=$B2_APP_KEY
RESTIC_PASSWORD=$RESTIC_PASSWORD
ENV
    chmod 600 /etc/filesynapse/backup.env

    # ── The database dump ────────────────────────────────────────────────────
    #
    # The two folders are not the whole library. Immich's PostgreSQL holds the
    # asset index, albums, favourites and users; Nextcloud's MariaDB holds
    # accounts, shares and version history. Backing up only the folders restores
    # a pile of files neither application knows anything about — and the run
    # still reports success, which is the worst possible way to lose data.
    #
    # A logical dump rather than the data directory: copying a running database's
    # files can capture a torn state that will not start again. The trailer each
    # tool writes is checked, because a dump that stopped halfway is more
    # dangerous than none — it looks restorable.
    cat > /usr/local/bin/filesynapse-dump <<'DUMP'
#!/usr/bin/env bash
set -uo pipefail
DUMP_DIR=/var/lib/filesynapse/dumps
mkdir -p \"\$DUMP_DIR\"

# Immich's PostgreSQL, all databases and roles.
docker exec immich_postgres pg_dumpall --clean --if-exists -U postgres \\
  > \"\$DUMP_DIR/immich.sql\" || exit 1
grep -q 'PostgreSQL database dump complete' \"\$DUMP_DIR/immich.sql\" || exit 1

# Nextcloud's MariaDB. --single-transaction keeps it consistent while running.
#
# The stack directory is baked in here rather than hardcoded: it is configurable,
# and a dump that cannot find its .env cannot get the database password.
# shellcheck disable=SC1091
. \"$STACK_DIR/nextcloud/.env\"
docker exec nextcloud-db mariadb-dump --all-databases --single-transaction --quick \\
  -uroot -p\"\$DB_PASSWORD\" > \"\$DUMP_DIR/nextcloud.sql\" || exit 1
grep -q 'Dump completed' \"\$DUMP_DIR/nextcloud.sql\" || exit 1

# The passwords sit in the dumps. They are read by root only.
chmod 600 \"\$DUMP_DIR\"/*.sql
DUMP
    chmod 700 /usr/local/bin/filesynapse-dump

    cat > /usr/local/bin/filesynapse-backup <<'BACKUP'
#!/usr/bin/env bash
set -uo pipefail
. /etc/filesynapse/backup.env
STATUS=/var/lib/filesynapse/last-backup
mkdir -p \"\$(dirname \"\$STATUS\")\"

# No database, no backup. A snapshot of the folders alone would report ok while
# restoring nothing usable, so the whole run fails instead — loudly, in the app,
# where it will be noticed.
if ! /usr/local/bin/filesynapse-dump; then
  printf 'failed %s\\n' \"\$(date -Is)\" > \"\$STATUS\"
  exit 1
fi

if restic snapshots >/dev/null 2>&1 || restic init; then
  # The stack configuration is part of the backup, not an afterthought: restoring
  # data into a machine with no compose files and no generated database passwords
  # is not a restore. /etc/filesynapse holds the B2 credentials and the restic
  # password itself — which is circular but not a weakness, since reading this
  # repository already requires that password.
  #
  # $STACK_DIR is expanded here, at generation time, rather than left for the
  # script to resolve — this path used to be the literal /opt/filesynapse, which
  # meant a custom STACK_DIR was silently left out of the backup while the run
  # still reported ok.
  #
  # The Postgres data directory is excluded on purpose. It is a running database's
  # files, and it is already covered properly by the logical dump above; copying
  # it would add gigabytes of torn state and could restore into a database that
  # will not start.
  if restic backup '$PHOTOS_DIR' '$FILES_DIR' /var/lib/filesynapse/dumps \\
       \"$STACK_DIR\" /etc/filesynapse \\
       --exclude-caches --exclude '$IMMICH_DB_DIR'; then
    # Retention, not just accumulation. PLAN.md §9 chose seven daily snapshots
    # deliberately; without this the repository grows for ever and the retention
    # the documentation describes does not exist. A prune failure leaves the
    # snapshot in place, so it does not fail the run.
    restic forget --keep-daily 7 --prune || true
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
  step "Install transfer tools" run 'apt-get install -y -qq rsync openssh-client'

  if [[ "${TRANSFER}" == "sync" ]]; then
    # Access first, as a step of its own.
    #
    # Nothing sets up a key for the old server, so this routinely is the thing
    # that is missing — and without this check the failure arrives from rsync as a
    # password prompt nobody is watching, which the app can only report as "Sync
    # from the old server: failed". That names the symptom. This names the cause,
    # before an hour of copying has been attempted.
    step "Check access to the old server" run "
      ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 \\
          'root@${SOURCE_ADDRESS}' true
    "

    # Copy the current state exactly. The old server must stay up until this
    # finishes and is verified — that is why it is a step and not a background
    # job nobody watches.
    step "Sync from the old server" run "
      rsync -aH --info=progress2 'root@${SOURCE_ADDRESS}:${PHOTOS_DIR}/' '$PHOTOS_DIR/' &&
      rsync -aH --info=progress2 'root@${SOURCE_ADDRESS}:${FILES_DIR}/' '$FILES_DIR/'
    "
  elif [[ "${TRANSFER}" == "restore" ]]; then
    step "Restore the latest snapshot" run "
      . /etc/filesynapse/backup.env
      restic restore latest --target /
    "
  fi
fi

# ── Done ─────────────────────────────────────────────────────────────────

emit "summary" ok "https://${JOIN_NAME}  · photos :2283 · files :8080"
log "Provisioning finished. Deploy the host agent next — see infra/agent/README.md."
