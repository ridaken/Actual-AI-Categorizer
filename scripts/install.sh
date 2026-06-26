#!/usr/bin/env bash
#
# One-command Debian installer for actual-ai-categorizer.
#
#   curl -fsSL https://raw.githubusercontent.com/ridaken/Actual-AI-Categorizer/main/scripts/install.sh | sudo bash
#
# or, from a checkout:   sudo ./scripts/install.sh
#
# Idempotent: safe to re-run to update an existing install. Everything lives in
# a single directory ($APP_DIR), owned by a dedicated service user, and runs on
# a systemd timer. Override any path/setting via the environment, e.g.
#   sudo INTERVAL=15min APP_DIR=/srv/aac ./scripts/install.sh
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/ridaken/Actual-AI-Categorizer.git}"
APP_DIR="${APP_DIR:-/opt/actual-ai-categorizer}"
SERVICE_USER="${SERVICE_USER:-actual}"
INTERVAL="${INTERVAL:-}" # e.g. 15min, 1h; blank keeps the unit default (30min)

log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
die() {
  printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || die "please run as root (e.g. sudo $0)"
for bin in node npm git; do
  command -v "$bin" >/dev/null 2>&1 || die "$bin is required but not found in PATH"
done

# 1. Get the code to $APP_DIR (clone fresh, or update an existing checkout).
script_root="$(cd "$(dirname "${BASH_SOURCE[0]:-}")/.." 2>/dev/null && pwd || true)"
if [ -d "$APP_DIR/.git" ]; then
  log "updating existing checkout at $APP_DIR"
  git -C "$APP_DIR" pull --ff-only
elif [ -n "$script_root" ] && [ -f "$script_root/package.json" ] && [ "$script_root" != "$APP_DIR" ]; then
  log "copying source from $script_root to $APP_DIR"
  mkdir -p "$APP_DIR"
  cp -a "$script_root/." "$APP_DIR/"
elif [ "$script_root" != "$APP_DIR" ]; then
  log "cloning $REPO_URL into $APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR" || die "cannot enter $APP_DIR"

# 2. Build.
log "installing dependencies (npm ci)"
npm ci
log "building"
npm run build

# 3. Service user.
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  log "creating service user '$SERVICE_USER'"
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

# 4. Config scaffolding (idempotent; never overwrites existing config).
log "scaffolding config in $APP_DIR"
node dist/index.js init --dir "$APP_DIR"
if [ ! -f "$APP_DIR/secrets.env" ]; then
  cp systemd/secrets.env.example "$APP_DIR/secrets.env"
fi
chmod 600 "$APP_DIR/secrets.env"

# 5. systemd units.
log "installing systemd units"
cp systemd/actual-ai-categorizer.service /etc/systemd/system/
cp systemd/actual-ai-categorizer.timer /etc/systemd/system/
if [ -n "$INTERVAL" ]; then
  sed -i "s/^OnUnitActiveSec=.*/OnUnitActiveSec=$INTERVAL/" \
    /etc/systemd/system/actual-ai-categorizer.timer
fi

# 6. Ownership + enable.
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"
systemctl daemon-reload
systemctl enable --now actual-ai-categorizer.timer

log "installation complete."
cat <<EOF

  Edit these two files, then you're done:
    1. $APP_DIR/config.yaml   - actual.server_url, actual.sync_id, ai.base_url, ai.model
    2. $APP_DIR/secrets.env   - ACTUAL_PASSWORD (+ optional ACTUAL_E2E_PASSWORD, AI_API_KEY)

  Run once now:   sudo systemctl start actual-ai-categorizer.service
  Watch logs:     journalctl -u actual-ai-categorizer.service -f
  Next runs:      systemctl list-timers actual-ai-categorizer.timer

  The timer is enabled and runs every 30min by default. Change the cadence with
  OnUnitActiveSec in /etc/systemd/system/actual-ai-categorizer.timer (or re-run
  this script with INTERVAL=15min).
EOF
