#!/usr/bin/env bash
# ==============================================================================
# Automated Let's Encrypt HTTP-01 + Shared-Nginx SNI Provisioner (GoDaddy Ready)
# ==============================================================================
# Installed to /usr/local/bin/rsl-provision-client-ssl by setup.sh.
# Modes:
#   1) rsl-provision-client-ssl --core
#      Provisions/links Let's Encrypt certs for setup, app, admin, docs, tally, api
#      subdomains of PRIMARY_DOMAIN whenever GoDaddy DNS resolves.
#   2) rsl-provision-client-ssl <slug>.(tally|api).rapidshiftlabs.in
#      Invoked automatically by the RSL background SSL queue worker to issue a
#      dedicated Let's Encrypt certificate via /var/www/rsl-acme, write an SNI
#      vhost in /etc/nginx/rsl-clients-ssl/, validate `nginx -t`, and reload Nginx.

set -euo pipefail

PRIMARY_DOMAIN="${PRIMARY_DOMAIN:-rapidshiftlabs.in}"
ACME_EMAIL="${SSL_ACME_EMAIL:-ssl-ops@${PRIMARY_DOMAIN}}"
ACME_WEBROOT="/var/www/rsl-acme"
SSL_LINK_DIR="/etc/ssl/rsl"
CLIENT_SNI_DIR="/etc/nginx/rsl-clients-ssl"
CORE_SUBS=(setup app admin docs tally api)

mkdir -p "${ACME_WEBROOT}/.well-known/acme-challenge" "${SSL_LINK_DIR}" "${CLIENT_SNI_DIR}"
chmod -R 755 "${ACME_WEBROOT}"

detect_ipv6_listen_443() {
  if grep -rq "\[::\]:443" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null; then
    echo "listen [::]:443 ssl;"
  else
    echo "# IPv6 not bound on existing 443 vhosts"
  fi
}

link_wildcard_if_available() {
  local le_wild="/etc/letsencrypt/live/${PRIMARY_DOMAIN}"
  if [ -f "${le_wild}/fullchain.pem" ] && [ -f "${le_wild}/privkey.pem" ]; then
    for sub in "${CORE_SUBS[@]}"; do
      ln -sf "${le_wild}/fullchain.pem" "${SSL_LINK_DIR}/${sub}.crt"
      ln -sf "${le_wild}/privkey.pem"   "${SSL_LINK_DIR}/${sub}.key"
    done
    return 0
  fi
  return 1
}

host_resolves() {
  local host="$1"
  getent ahosts "$host" >/dev/null 2>&1
}

provision_core_subdomains() {
  if link_wildcard_if_available; then
    nginx -t && systemctl reload nginx
    echo "[rsl-ssl] Linked existing wildcard certificate for *.${PRIMARY_DOMAIN}."
    return 0
  fi

  local changed=0
  for sub in "${CORE_SUBS[@]}"; do
    local fqdn="${sub}.${PRIMARY_DOMAIN}"
    if [ -f "/etc/letsencrypt/live/${fqdn}/fullchain.pem" ]; then
      ln -sf "/etc/letsencrypt/live/${fqdn}/fullchain.pem" "${SSL_LINK_DIR}/${sub}.crt"
      ln -sf "/etc/letsencrypt/live/${fqdn}/privkey.pem"   "${SSL_LINK_DIR}/${sub}.key"
      changed=1
      continue
    fi

    if ! host_resolves "$fqdn"; then
      echo "[rsl-ssl] Skipping ${fqdn} for now (GoDaddy DNS not propagated yet — using bootstrap TLS)."
      continue
    fi

    echo "[rsl-ssl] Requesting Let's Encrypt certificate for ${fqdn}..."
    if certbot certonly --webroot -w "${ACME_WEBROOT}" \
      --non-interactive --agree-tos --keep-until-expiring \
      -m "${ACME_EMAIL}" -d "${fqdn}"; then
      ln -sf "/etc/letsencrypt/live/${fqdn}/fullchain.pem" "${SSL_LINK_DIR}/${sub}.crt"
      ln -sf "/etc/letsencrypt/live/${fqdn}/privkey.pem"   "${SSL_LINK_DIR}/${sub}.key"
      changed=1
    else
      echo "[rsl-ssl] Warning: Certbot could not yet issue for ${fqdn}; keeping bootstrap TLS until next update."
    fi
  done

  if [ "$changed" -eq 1 ]; then
    nginx -t && systemctl reload nginx
  fi
}

provision_client_hostname() {
  local host
  host="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"

  if [[ ! "$host" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.(tally|api)\.[a-z0-9.-]+\.[a-z]{2,}$ ]]; then
    echo "[rsl-ssl] ERROR: Invalid client subdomain '${host}'." >&2
    exit 1
  fi

  local zone_parent="${host#*.}"
  if [ -f "/etc/letsencrypt/live/${zone_parent}/fullchain.pem" ]; then
    echo "[rsl-ssl] Wildcard cert for *.${zone_parent} already covers ${host}."
    exit 0
  fi

  certbot certonly --webroot -w "${ACME_WEBROOT}" \
    --non-interactive --agree-tos --keep-until-expiring \
    -m "${ACME_EMAIL}" -d "${host}"

  local cert_file="/etc/letsencrypt/live/${host}/fullchain.pem"
  local key_file="/etc/letsencrypt/live/${host}/privkey.pem"
  if [ ! -f "$cert_file" ] || [ ! -f "$key_file" ]; then
    echo "[rsl-ssl] ERROR: Expected certificate files not found for ${host}." >&2
    exit 1
  fi

  local ipv6_line
  ipv6_line="$(detect_ipv6_listen_443)"
  local conf_file="${CLIENT_SNI_DIR}/${host}.conf"

  cat > "$conf_file" <<EOF
server {
    listen 443 ssl;
    ${ipv6_line}
    server_name ${host};

    ssl_certificate     ${cert_file};
    ssl_certificate_key ${key_file};

    client_max_body_size 50M;
    add_header X-Content-Type-Options "nosniff" always;

    location ^~ /.well-known/acme-challenge/ {
        root ${ACME_WEBROOT};
        default_type "text/plain";
        allow all;
    }

    location / {
        proxy_pass http://127.0.0.1:4500;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$rsl_connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 90s;
    }
}
EOF

  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx
    echo "[rsl-ssl] Provisioned & activated HTTPS SNI for ${host}."
  else
    rm -f "$conf_file"
    echo "[rsl-ssl] ERROR: nginx -t failed for ${host}; rolled back ${conf_file}." >&2
    exit 1
  fi
}

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "Usage: rsl-provision-client-ssl --core | <client.tally.rapidshiftlabs.in>" >&2
  exit 1
fi

if [ "$TARGET" = "--core" ]; then
  provision_core_subdomains
else
  provision_client_hostname "$TARGET"
fi
