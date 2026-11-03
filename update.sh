#!/usr/bin/env bash
# ==============================================================================
# One-Line Zero-Downtime Update & Full Verification Script for RSL Marketing
# ==============================================================================
# Usage:
#   bash update.sh
#
# Automatically performs:
#   1. Safe `git stash` (tracked files only — .env & SQLite DBs are never touched)
#   2. `git pull` latest commits + self re-exec so new update logic runs immediately
#   3. Self-heals `.env` (backfills SETUP_BOOTSTRAP_TOKEN, SETUP_URL, SSL hooks if missing)
#   4. Refreshes shared-Nginx config (`nginx -t` verified) & issues/renews Let's Encrypt
#      SSL certificates across all core subdomains (setup, app, admin, docs, tally, api)
#   5. Installs dependencies, builds docs & Next.js apps, runs SQLite migrations
#   6. Restarts ONLY the 7 `rsl-*` PM2 processes with `--update-env`
#   7. Runs `pnpm ops:verify` — checks DB for Super Admin (prints clickable setup link +
#      Setup Key if none exists yet!) + checks DNS, Origin SSL, Public HTTPS & Wildcards

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

if [ "${1:-}" != "--post-pull" ]; then
  echo "======================================================================"
  echo " RapidShift Labs — One-Line Automated Update & Health Verification"
  echo " Directory : ${APP_DIR}"
  echo "======================================================================"
  echo "==> [1/7] Stashing local tracked edits (preserving .env & databases) & pulling latest Git code..."
  if [ -d "$APP_DIR/.git" ]; then
    if ! git diff --quiet || ! git diff --cached --quiet; then
      git stash push -m "rsl-auto-update-$(date +%Y%m%d-%H%M%S)"
    fi
    CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
    git pull --ff-only origin "$CURRENT_BRANCH" || git pull --rebase origin "$CURRENT_BRANCH"
  fi
  exec bash "$APP_DIR/update.sh" --post-pull
fi

RUN_USER="$(id -un)"
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
fi

echo "==> [2/7] Verifying & self-healing server .env configuration..."
if [ ! -f "$APP_DIR/.env" ]; then
  echo "    No .env found — delegating to setup.sh for full initial provisioning..."
  exec bash "$APP_DIR/setup.sh"
fi

PRIMARY_DOMAIN_EXISTING="$(grep '^PRIMARY_DOMAIN=' "$APP_DIR/.env" | head -n1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
PRIMARY_DOMAIN="${PRIMARY_DOMAIN_EXISTING:-rapidshiftlabs.in}"

ensure_env_key() {
  local key="$1"
  local default_val="$2"
  if ! grep -q "^${key}=" "$APP_DIR/.env"; then
    echo "${key}=${default_val}" >> "$APP_DIR/.env"
    echo "    Added missing ${key} to .env"
  else
    local cur_val
    cur_val="$(grep "^${key}=" "$APP_DIR/.env" | head -n1 | cut -d= -f2-)"
    if [ -z "$cur_val" ] && [ -n "$default_val" ]; then
      sed -i "s|^${key}=.*|${key}=${default_val}|" "$APP_DIR/.env"
      echo "    Populated empty ${key} in .env"
    fi
  fi
}

ensure_env_key "SETUP_SUBDOMAIN" "setup"
ensure_env_key "SETUP_URL" "https://setup.${PRIMARY_DOMAIN}"
ensure_env_key "SETUP_BOOTSTRAP_TOKEN" "$(openssl rand -hex 24)"
ensure_env_key "BETTER_AUTH_SECRET" "$(openssl rand -base64 32)"
ensure_env_key "ADMIN_AUTH_SECRET" "$(openssl rand -base64 32)"
ensure_env_key "KMS_MASTER_KEY" "$(openssl rand -base64 32)"
ensure_env_key "BACKUP_SIGNING_KEY" "$(openssl rand -base64 32)"
ensure_env_key "API_KEY_PEPPER" "$(openssl rand -base64 32)"
ensure_env_key "SSL_ACME_EMAIL" "ssl-ops@${PRIMARY_DOMAIN}"
ensure_env_key "SSL_PROVISION_MODE" "certbot_webroot"
ensure_env_key "SSL_PROVISION_COMMAND" "/usr/local/bin/rsl-provision-client-ssl"
ensure_env_key "REDIS_URL" "redis://127.0.0.1:4579"
chmod 600 "$APP_DIR/.env"

set -a
# shellcheck disable=SC1091
. "$APP_DIR/.env"
set +a

echo "==> [3/7] Refreshing SSL provisioner, shared Nginx rules & subdomain SSL certificates..."
$SUDO mkdir -p /var/www/rsl-acme/.well-known/acme-challenge /etc/ssl/rsl /etc/nginx/rsl-clients-ssl
$SUDO chmod -R 755 /var/www/rsl-acme

if [ -f "$APP_DIR/infra/scripts/provision-client-ssl.sh" ]; then
  $SUDO cp "$APP_DIR/infra/scripts/provision-client-ssl.sh" /usr/local/bin/rsl-provision-client-ssl
  $SUDO chown root:root /usr/local/bin/rsl-provision-client-ssl
  $SUDO chmod 755 /usr/local/bin/rsl-provision-client-ssl
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "${RUN_USER} ALL=(root) NOPASSWD: /usr/local/bin/rsl-provision-client-ssl *" | $SUDO tee /etc/sudoers.d/rsl-ssl >/dev/null
  $SUDO chmod 440 /etc/sudoers.d/rsl-ssl
fi

if [ ! -f /etc/ssl/rsl/bootstrap.crt ] || [ ! -f /etc/ssl/rsl/bootstrap.key ]; then
  $SUDO openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -subj "/CN=*.${PRIMARY_DOMAIN}" \
    -keyout /etc/ssl/rsl/bootstrap.key \
    -out /etc/ssl/rsl/bootstrap.crt >/dev/null 2>&1
  $SUDO chmod 600 /etc/ssl/rsl/bootstrap.key
fi

for sub in setup app admin docs tally api; do
  if [ ! -e "/etc/ssl/rsl/${sub}.crt" ]; then
    $SUDO ln -sf /etc/ssl/rsl/bootstrap.crt "/etc/ssl/rsl/${sub}.crt"
    $SUDO ln -sf /etc/ssl/rsl/bootstrap.key "/etc/ssl/rsl/${sub}.key"
  fi
done

if command -v nginx >/dev/null 2>&1 && [ -f "$APP_DIR/infra/nginx/rsl-marketing.conf" ]; then
  if ! grep -rq "^[[:space:]]*server_names_hash_bucket_size" /etc/nginx/nginx.conf /etc/nginx/conf.d/ 2>/dev/null; then
    echo "server_names_hash_bucket_size 128;" | $SUDO tee /etc/nginx/conf.d/rsl-hash-bucket.conf >/dev/null
  fi

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

echo "==> [4/7] Installing workspace dependencies..."
NODE_ENV=development pnpm install --prod=false --frozen-lockfile || NODE_ENV=development pnpm install --prod=false

echo "==> [5/7] Building docs search index, runtime workers, typechecking & building Next.js apps..."
pnpm docs:lint
pnpm docs:build
pnpm typecheck
pnpm build

for app_name in web admin docs; do
  if [ ! -f "$APP_DIR/apps/${app_name}/.next/BUILD_ID" ]; then
    echo "ERROR: Build verification failed — missing apps/${app_name}/.next/BUILD_ID. Aborting PM2 reload to keep running services safe."
    exit 1
  fi
done

for bundle_name in worker.cjs cleanup.cjs; do
  if [ ! -f "$APP_DIR/apps/worker/dist/${bundle_name}" ]; then
    echo "ERROR: Build verification failed — missing apps/worker/dist/${bundle_name}. Aborting PM2 reload."
    exit 1
  fi
done

echo "==> [6/7] Running SQLite control & tenant migrations + reloading RSL PM2 services..."
pnpm db:migrate:control
pnpm db:migrate:tenants
RSL_APP_DIR="$APP_DIR" node infra/pm2/pm2-manager.mjs reload

echo "==> [7/7] Auditing Super Admin DB state, Subdomains, DNS & SSL Certificates..."
pnpm ops:verify
