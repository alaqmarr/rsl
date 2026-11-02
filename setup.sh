#!/usr/bin/env bash
# ==============================================================================
# One-Command Full Setup & Launch for RSL Marketing (GoDaddy + Shared Nginx Safe)
# ==============================================================================
# Usage right after cloning:
#   git clone <REPO_URL> rslmarketing && cd rslmarketing
#   bash setup.sh
#
# SAFETY & SECURITY GUARANTEES:
# 1. ZERO credentials ever stored in Git — first Super Admin is created via
#    https://setup.rapidshiftlabs.in protected by a private one-time Setup Key.
# 2. Existing Nginx sites on ports 80/443 are NEVER modified or interrupted.
# 3. Existing PM2 processes outside `rsl-*` are NEVER touched.
# 4. Existing Redis on 6379 is NEVER touched (RSL runs isolated on 127.0.0.1:4579).

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

RUN_USER="$(id -un)"
RUN_GROUP="$(id -gn)"
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
fi

PRIMARY_DOMAIN="${PRIMARY_DOMAIN:-rapidshiftlabs.in}"

echo "======================================================================"
echo " RapidShift Labs (${PRIMARY_DOMAIN}) — Automated Server Setup"
echo " Directory : ${APP_DIR}"
echo " User      : ${RUN_USER}"
echo "======================================================================"

echo "==> [1/8] Ensuring system packages (leaving existing Nginx sites untouched)..."
$SUDO apt-get update -y
$SUDO apt-get install -y curl git openssl build-essential python3 sqlite3 lsof certbot redis-server
if ! command -v nginx >/dev/null 2>&1; then
  $SUDO apt-get install -y nginx
fi

echo "==> [2/8] Provisioning isolated directories & Redis on 127.0.0.1:4579..."
$SUDO mkdir -p \
  /var/lib/rsl/platform \
  /var/lib/rsl/tenants \
  /var/lib/rsl/staging \
  /var/lib/rsl/ssl \
  /var/lib/rsl/redis \
  /var/log/rsl/pm2 \
  /var/www/rsl-acme/.well-known/acme-challenge \
  /etc/ssl/rsl \
  /etc/nginx/rsl-clients-ssl

$SUDO chown -R "${RUN_USER}:${RUN_GROUP}" \
  /var/lib/rsl/platform \
  /var/lib/rsl/tenants \
  /var/lib/rsl/staging \
  /var/lib/rsl/ssl \
  /var/log/rsl
$SUDO chown -R redis:redis /var/lib/rsl/redis
$SUDO chmod 711 /var/lib/rsl
$SUDO chmod 700 /var/lib/rsl/platform /var/lib/rsl/tenants /var/lib/rsl/staging /var/lib/rsl/ssl /var/lib/rsl/redis /var/log/rsl
$SUDO chmod -R 755 /var/www/rsl-acme

$SUDO tee /etc/redis/redis-rsl.conf >/dev/null <<'EOF'
bind 127.0.0.1
port 4579
supervised systemd
pidfile /run/redis/redis-rsl.pid
logfile /var/log/redis/redis-rsl.log
dir /var/lib/rsl/redis
appendonly yes
maxmemory 256mb
maxmemory-policy noeviction
EOF

$SUDO tee /etc/systemd/system/redis-rsl.service >/dev/null <<'EOF'
[Unit]
Description=Isolated Redis Server for RSL Marketing (127.0.0.1:4579)
After=network.target

[Service]
Type=notify
ExecStart=/usr/bin/redis-server /etc/redis/redis-rsl.conf
ExecStop=/usr/bin/redis-cli -p 4579 shutdown
User=redis
Group=redis
RuntimeDirectory=redis
RuntimeDirectoryMode=2755
Restart=always

[Install]
WantedBy=multi-user.target
EOF

$SUDO systemctl daemon-reload
$SUDO systemctl enable --now redis-rsl.service

echo "==> [3/8] Ensuring Node.js 22+, pnpm@10, and PM2..."
NEED_NODE=0
if ! command -v node >/dev/null 2>&1; then
  NEED_NODE=1
else
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$NODE_MAJOR" -lt 22 ]; then
    NEED_NODE=1
  fi
fi
if [ "$NEED_NODE" -eq 1 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
fi

if ! command -v pnpm >/dev/null 2>&1; then
  $SUDO corepack enable || true
  $SUDO corepack prepare pnpm@10.0.0 --activate || $SUDO npm install -g pnpm@10.0.0
fi

if ! command -v pm2 >/dev/null 2>&1; then
  $SUDO npm install -g pm2
fi

echo "==> [4/8] Creating production .env (if not already present)..."
if [ ! -f "$APP_DIR/.env" ]; then
  GENERATED_SETUP_TOKEN="$(openssl rand -hex 24)"
  cat > "$APP_DIR/.env" <<EOF
NODE_ENV=production
PRIMARY_DOMAIN=${PRIMARY_DOMAIN}
APP_SUBDOMAIN=app
ADMIN_SUBDOMAIN=admin
DOCS_SUBDOMAIN=docs
SETUP_SUBDOMAIN=setup
TALLY_WILDCARD_ZONE=tally
API_WILDCARD_ZONE=api

APP_URL=https://app.${PRIMARY_DOMAIN}
ADMIN_URL=https://admin.${PRIMARY_DOMAIN}
DOCS_URL=https://docs.${PRIMARY_DOMAIN}
SETUP_URL=https://setup.${PRIMARY_DOMAIN}
BETTER_AUTH_URL=https://app.${PRIMARY_DOMAIN}

# One-Time Cryptographic Setup Key for https://setup.${PRIMARY_DOMAIN}
SETUP_BOOTSTRAP_TOKEN=${GENERATED_SETUP_TOKEN}

# Storage, Logs, Queue & Automated Per-Client SSL
DATA_DIR=/var/lib/rsl
LOG_DIR=/var/log/rsl
BACKUP_STAGING_DIR=/var/lib/rsl/staging
SSL_CERT_DIR=/var/lib/rsl/ssl
SSL_ACME_EMAIL=ssl-ops@${PRIMARY_DOMAIN}
SSL_PROVISION_MODE=certbot_webroot
SSL_PROVISION_COMMAND=/usr/local/bin/rsl-provision-client-ssl
REDIS_URL=redis://127.0.0.1:4579

# Auto-Generated 32-Byte Cryptographic Keys
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
ADMIN_AUTH_SECRET=$(openssl rand -base64 32)
KMS_MASTER_KEY=$(openssl rand -base64 32)
KMS_KEY_VERSION=1
BACKUP_SIGNING_KEY=$(openssl rand -base64 32)
BACKUP_SIGNING_KEY_VERSION=1
API_KEY_PEPPER=$(openssl rand -base64 32)
META_WEBHOOK_VERIFY_TOKEN=$(openssl rand -hex 16)

# Optional External Integrations (populate anytime & run: bash update.sh)
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
META_APP_ID=
META_APP_SECRET=
META_GRAPH_VERSION=v21.0
META_CONFIG_ID=
EMAIL_FROM="RapidShift Labs <noreply@${PRIMARY_DOMAIN}>"
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
GMAIL_SMTP_USER=
GMAIL_SMTP_APP_PASSWORD=
EOF
  chmod 600 "$APP_DIR/.env"
  echo "    Generated fresh $APP_DIR/.env with cryptographic keys & one-time Setup Key."
else
  if ! grep -q "^SETUP_BOOTSTRAP_TOKEN=" "$APP_DIR/.env"; then
    echo "SETUP_BOOTSTRAP_TOKEN=$(openssl rand -hex 24)" >> "$APP_DIR/.env"
  fi
  echo "    Existing $APP_DIR/.env found — keeping your configured keys & settings."
fi

set -a
# shellcheck disable=SC1091
. "$APP_DIR/.env"
set +a

echo "==> [5/8] Installing automated SSL helper & configuring shared Nginx safely..."
$SUDO cp "$APP_DIR/infra/scripts/provision-client-ssl.sh" /usr/local/bin/rsl-provision-client-ssl
$SUDO chown root:root /usr/local/bin/rsl-provision-client-ssl
$SUDO chmod 755 /usr/local/bin/rsl-provision-client-ssl

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

if grep -rq "sites-enabled" /etc/nginx/nginx.conf 2>/dev/null && [ -d /etc/nginx/sites-enabled ]; then
  NGINX_CONF_DEST="/etc/nginx/sites-available/rsl-marketing.conf"
  NGINX_CONF_LINK="/etc/nginx/sites-enabled/rsl-marketing.conf"
  $SUDO mkdir -p /etc/nginx/sites-available
  $SUDO cp "$RENDERED_NGINX" "$NGINX_CONF_DEST"
  $SUDO ln -sf "$NGINX_CONF_DEST" "$NGINX_CONF_LINK"
else
  NGINX_CONF_DEST="/etc/nginx/conf.d/rsl-marketing.conf"
  NGINX_CONF_LINK="$NGINX_CONF_DEST"
  $SUDO cp "$RENDERED_NGINX" "$NGINX_CONF_DEST"
fi
rm -f "$RENDERED_NGINX"

if $SUDO nginx -t; then
  $SUDO systemctl enable --now nginx >/dev/null 2>&1 || true
  $SUDO systemctl reload nginx
else
  $SUDO rm -f "$NGINX_CONF_LINK"
  echo "ERROR: Nginx configuration check failed; removed $NGINX_CONF_LINK so existing sites remain untouched." >&2
  exit 1
fi

$SUDO PRIMARY_DOMAIN="${PRIMARY_DOMAIN}" SSL_ACME_EMAIL="${SSL_ACME_EMAIL:-ssl-ops@${PRIMARY_DOMAIN}}" /usr/local/bin/rsl-provision-client-ssl --core || true

echo "==> [6/8] Installing workspace dependencies & building production bundles..."
pnpm install --frozen-lockfile || pnpm install
pnpm docs:lint
pnpm docs:build
pnpm typecheck
pnpm build

echo "==> [7/8] Creating SQLite databases from scratch..."
pnpm db:migrate:control
pnpm db:migrate:tenants

echo "==> [8/8] Launching scoped RSL PM2 services (leaving all other PM2 apps untouched)..."
RSL_APP_DIR="$APP_DIR" node infra/pm2/pm2-manager.mjs start

echo ""
echo "======================================================================"
echo " RSL Marketing Platform Is LIVE!"
echo "----------------------------------------------------------------------"
echo " 1. FIRST-TIME SUPER ADMIN SETUP WIZARD (One-Click Key Included):"
echo "    https://setup.${PRIMARY_DOMAIN}/?key=${SETUP_BOOTSTRAP_TOKEN}"
echo "----------------------------------------------------------------------"
echo " Customer App   : https://app.${PRIMARY_DOMAIN}"
echo " Staff Console  : https://admin.${PRIMARY_DOMAIN}"
echo " Help & API Docs: https://docs.${PRIMARY_DOMAIN}"
echo " Client Tally   : https://<client>.tally.${PRIMARY_DOMAIN}"
echo " Client API     : https://<client>.api.${PRIMARY_DOMAIN}"
echo "----------------------------------------------------------------------"
echo " Future Updates : bash update.sh"
echo "======================================================================"
