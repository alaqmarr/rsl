#!/usr/bin/env bash
# ==============================================================================
# One-Line Zero-Downtime Update Script for RSL Marketing
# ==============================================================================
# Usage:
#   bash update.sh
#
# Automatically runs:
#   1. Safe `git stash` (tracked files only — .env & SQLite DBs are never touched)
#   2. `git pull` latest commits + self re-exec so updated script logic takes effect immediately
#   3. Refreshes SSL provisioner & shared Nginx config safely (`nginx -t` verified)
#   4. Installs dependencies, rebuilds docs & Next.js apps, runs SQLite migrations
#   5. Gracefully reloads ONLY the 7 `rsl-*` PM2 processes (other PM2 apps untouched)

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

if [ "${1:-}" != "--post-pull" ]; then
  echo "======================================================================"
  echo " RapidShift Labs — One-Line Automated Update"
  echo " Directory : ${APP_DIR}"
  echo "======================================================================"
  echo "==> [1/6] Stashing local tracked edits (preserving .env & databases) & pulling latest Git code..."
  if [ -d "$APP_DIR/.git" ]; then
    if ! git diff --quiet || ! git diff --cached --quiet; then
      git stash push -m "rsl-auto-update-$(date +%Y%m%d-%H%M%S)"
    fi
    CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
    git pull --ff-only origin "$CURRENT_BRANCH" || git pull --rebase origin "$CURRENT_BRANCH"
  fi
  exec bash "$APP_DIR/update.sh" --post-pull
fi

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
fi

if [ -f "$APP_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$APP_DIR/.env"
  set +a
fi

PRIMARY_DOMAIN="${PRIMARY_DOMAIN:-rapidshiftlabs.in}"

echo "==> [2/6] Refreshing SSL helper & shared Nginx rules (existing sites untouched)..."
if [ -f "$APP_DIR/infra/scripts/provision-client-ssl.sh" ]; then
  $SUDO cp "$APP_DIR/infra/scripts/provision-client-ssl.sh" /usr/local/bin/rsl-provision-client-ssl
  $SUDO chmod 755 /usr/local/bin/rsl-provision-client-ssl
fi

if [ -f /etc/ssl/rsl/bootstrap.crt ] && [ ! -e /etc/ssl/rsl/setup.crt ]; then
  $SUDO ln -sf /etc/ssl/rsl/bootstrap.crt /etc/ssl/rsl/setup.crt
  $SUDO ln -sf /etc/ssl/rsl/bootstrap.key /etc/ssl/rsl/setup.key
fi

if command -v nginx >/dev/null 2>&1 && [ -f "$APP_DIR/infra/nginx/rsl-marketing.conf" ]; then
  RENDERED_NGINX="/tmp/rsl-marketing.nginx.conf"
  cp "$APP_DIR/infra/nginx/rsl-marketing.conf" "$RENDERED_NGINX"
  if grep -rq "\[::\]:80" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null; then
    sed -i 's/# __IPV6_LISTEN_80__/listen [::]:80;/g' "$RENDERED_NGINX"
  fi
  if grep -rq "\[::\]:443" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null; then
    sed -i 's/# __IPV6_LISTEN_443__/listen [::]:443 ssl;/g' "$RENDERED_NGINX"
  fi

  if [ -d /etc/nginx/sites-enabled ] && grep -rq "sites-enabled" /etc/nginx/nginx.conf 2>/dev/null; then
    $SUDO cp "$RENDERED_NGINX" /etc/nginx/sites-available/rsl-marketing.conf
    $SUDO ln -sf /etc/nginx/sites-available/rsl-marketing.conf /etc/nginx/sites-enabled/rsl-marketing.conf
  else
    $SUDO cp "$RENDERED_NGINX" /etc/nginx/conf.d/rsl-marketing.conf
  fi
  rm -f "$RENDERED_NGINX"

  if $SUDO nginx -t; then
    $SUDO systemctl reload nginx
  fi

  $SUDO PRIMARY_DOMAIN="${PRIMARY_DOMAIN}" SSL_ACME_EMAIL="${SSL_ACME_EMAIL:-ssl-ops@${PRIMARY_DOMAIN}}" /usr/local/bin/rsl-provision-client-ssl --core || true
fi

echo "==> [3/6] Installing workspace dependencies..."
pnpm install --frozen-lockfile || pnpm install

echo "==> [4/6] Building docs search index, typechecking & building Next.js apps..."
pnpm docs:lint
pnpm docs:build
pnpm typecheck
pnpm build

echo "==> [5/6] Running SQLite control & tenant migrations..."
pnpm db:migrate:control
pnpm db:migrate:tenants

echo "==> [6/6] Gracefully reloading ONLY RSL PM2 services..."
RSL_APP_DIR="$APP_DIR" node infra/pm2/pm2-manager.mjs reload

echo "======================================================================"
echo " Update Complete! All RSL services reloaded with zero downtime."
echo "======================================================================"
