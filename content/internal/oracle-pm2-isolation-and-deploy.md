# Staff SOP 5 — Server Deployment (`setup.sh` / `update.sh`), Shared Nginx, SSL & PM2

> Staff Reference Only — Follow strictly on shared Ubuntu servers so co-hosted websites and databases are never disrupted.

## 1. Allowed Server Ports (`4500–4600` Only)

Other sites and services run on the same server outside `4500–4600`. Every RapidShift Labs service stays strictly inside `4500–4600`:

| Port | PM2 / Service Name | Role |
| --- | --- | --- |
| `4500` | `rsl-web` | Customer App (`app.rapidshiftlabs.in`), `*.tally` Webhooks & `*.api` REST v1 |
| `4501` | `rsl-admin` | Staff Portal (`admin.rapidshiftlabs.in`) & Setup Hub (`setup.rapidshiftlabs.in`) |
| `4502` | `rsl-docs` | Public Help Center & API Reference (`docs.rapidshiftlabs.in`) |
| `4510` | `rsl-worker` | Background WhatsApp, Tally, SSL (`ssl.provision`) & Scheduled Post Runner |
| `4520` | `rsl-cleanup` | 20-Minute Temp/WAL Maintenance & Health Check |
| `4579` | `redis-rsl` | Optional Isolated Redis Queue (never touch default `6379`) |

---

## 2. First-Time Server Setup & One-Line Updates

1. **First-Time Clone & Setup (2 Lines)**:

```bash
git clone https://github.com/alaqmarr/rsl.git && cd rsl
sudo bash setup.sh
```

   - `setup.sh` generates cryptographic `.env` secrets (`SESSION_SECRET`, `ENCRYPTION_MASTER_KEY`, `SETUP_BOOTSTRAP_TOKEN`), installs `infra/nginx/rsl-marketing.conf` without touching other `/etc/nginx/sites-enabled/*` vhosts or apex `rapidshiftlabs.in`, builds all apps, starts scoped PM2 processes, and prints your one-time `https://setup.rapidshiftlabs.in/?key=...` Super Admin bootstrap URL.
2. **Zero-Hassle Production Update (1 Line)**:

```bash
bash update.sh
```

   - Automatically stashes local changes, pulls `origin/main` with `git pull --rebase`, backfills any newly introduced `.env` defaults without overwriting secrets, installs dependencies, rebuilds `@rsl/web`, `@rsl/admin`, and `@rsl/docs`, reloads Nginx if `infra/nginx/rsl-marketing.conf` changed, reloads scoped PM2 apps with `--update-env`, and runs `pnpm ops:verify` across database, local ports, DNS, HTTP, and SSL certificates!

---

## 3. Cloudflare DNS & Wildcard SSL (`*.tally` & `*.api`) Rules

In Cloudflare DNS for `rapidshiftlabs.in`:

1. **Standard Subdomains (`app`, `admin`, `docs`, `setup`, `tally`, `api`)**: Point `A` records to your server IP (`129.225.91.86`). May use **Proxied (Orange Cloud)** with Cloudflare SSL/TLS mode set to **Full** or **Full (Strict)**.
2. **Multi-Level Wildcards (`*.tally` and `*.api`)**:
   - Cloudflare Free Universal SSL only covers first-level `*.rapidshiftlabs.in`, NOT second-level `*.tally.rapidshiftlabs.in`!
   - **Minute Fix**: Toggle `*.tally` and `*.api` in Cloudflare DNS from **Proxied (Orange Cloud)** to **DNS only (Grey Cloud)**, then issue a Let's Encrypt DNS-01 wildcard cert (`certbot certonly --manual --preferred-challenges dns -d "*.tally.rapidshiftlabs.in" -d "*.api.rapidshiftlabs.in"`) OR let `SSL_PROVIDER_MODE=certbot_webroot` automatically obtain per-client HTTP-01 certs via `/var/www/rsl-certbot` whenever a client workspace is created!

---

## 4. Scoped PM2 Process Management & Zero-Downtime Key Rotation

> **CRITICAL WARNING:** Never run `pm2 kill`, `pm2 restart all`, `pm2 stop all`, or `pm2 delete all` on a shared server!

Always use these workspace-scoped scripts:

```bash
pnpm pm2:status     # Show status of RSL processes only
pnpm pm2:reload     # Reload RSL apps cleanly
pnpm pm2:restart    # Restart RSL apps with --update-env after editing .env
pnpm ops:verify     # Full Super Admin + Port + Subdomain DNS/SSL verification report
```

### Rotating `ENCRYPTION_KEY_CURRENT` Without Breaking Existing Tokens

1. Generate a new 64-hex key: `openssl rand -hex 32`.
2. Open `.env`: move current `ENCRYPTION_KEY_CURRENT` value into `ENCRYPTION_KEY_PREVIOUS`, and paste the new 64-hex value into `ENCRYPTION_KEY_CURRENT`.
3. Run `pnpm pm2:restart` so `rsl-web`, `rsl-admin`, and `rsl-worker` pick up the rotated keyring seamlessly.
