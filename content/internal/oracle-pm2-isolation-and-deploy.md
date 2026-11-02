# Server Ports, Safe Restarts & Key Rotation Guide

> Staff Reference Only — Follow these steps carefully on shared Ubuntu servers.

## Allowed Server Ports (`4500–4600` Only)

Other applications run on the same server outside ports `4500–4600`. All RSL Marketing apps stay strictly inside `4500–4600`:

| Port | Service | Purpose |
| --- | --- | --- |
| `4500` | `rsl-web` | Customer App, Tally Webhook & REST API |
| `4501` | `rsl-admin` | Staff Portal (Payments, Clients & Pricing) |
| `4502` | `rsl-docs` | Public Help Guides & API Reference |
| `4510` – `4512` | `rsl-worker` | Background WhatsApp & Tally Task Runner |
| `4520` | `rsl-cleanup` | 20-Minute Maintenance & Health Check |
| `4579` | `redis-rsl` | Dedicated Queue Service (never touch `6379`) |
| `4580` – `4582` | `nginx` | Web Server Routing (`infra/nginx/rsl-marketing.conf`) |

## Restarting RSL Apps Safely

> Never run `pm2 kill`, `pm2 restart all`, `pm2 stop all`, or `pm2 delete all` — those commands affect other apps hosted on the same server.

Always use these scoped commands from the project folder:

```bash
# Check status of RSL apps only
pnpm pm2:status

# Reload RSL apps with zero downtime
pnpm pm2:reload

# Restart RSL apps after editing .env settings
pnpm pm2:restart

# Run immediate temp-file cleanup
pnpm pm2:cleanup
```

## Updating Security Keys Without Downtime

1. Generate a new 64-character hex key (`openssl rand -hex 32`).
2. Copy the current `ENCRYPTION_KEY_CURRENT` value into `ENCRYPTION_KEY_PREVIOUS` inside `.env`, then paste the new key into `ENCRYPTION_KEY_CURRENT`.
3. Run `pnpm pm2:restart` so only the RSL apps reload the updated settings.
