---
title: Developer REST API (v1), Scoped Bearer Keys, Idempotency & Live Sandbox
summary: Complete minute-by-minute instructions to generate scoped rsl_live_ and rsl_test_ API keys, copy one-time secrets safely, test endpoints in the built-in API Sandbox, send Idempotency-Key headers, and integrate ERP or website workflows.
section: Developers
audience: developer
service: api.access
order: 13
lastReviewed: 2026-11-03
---

## Step 1 — Unlock API Access & Generate a Scoped Bearer Key

1. Ensure the **Developer REST API & Webhooks** (`api.access`) plan is unlocked in **Plans & Wallet** (`/billing`).
2. Click **All API Tokens** (`/settings/tokens`) in the left sidebar *(or open `/developers`)*.
3. Scroll to the **Issue Scoped Developer REST API Key** card:
   - **Key Label**: Enter a descriptive service name (e.g. `Shopify Order Sync Production` or `Custom ERP Connector`).
   - **Environment Mode**: Select **`Live` (`rsl_live_...`)** for production data or **`Test` (`rsl_test_...`)** for staging verification.
   - **Least-Privilege Scopes**: Tick **only** the scopes this integration needs:
     - `contacts:read` / `contacts:write` — Read or upsert customer contacts
     - `vouchers:read` / `vouchers:write` — Read Tally bills or push bills/receipts (`/api/v1/vouchers` & `/api/v1/tally/bill-event`)
     - `whatsapp:read` / `whatsapp:write` — List templates or queue WhatsApp template sends
     - `analytics:read` — Fetch KPIs, receivable aging, and time-series reports
   - Click **Create API Key**.
4. **Copy the Full Key Immediately**:
   - A green banner reveals the full secret (`rsl_live_<slug>_<random>`) **one time only**. RapidShift stores only its SHA-256 hash on disk, so copy it into your server `.env` (`RSL_API_KEY=...`) right away!
   - If a key is ever leaked or an engineer leaves, click **Revoke Key** on its row in `/settings/tokens` for instant invalidation.

---

## Step 2 — Choose Your Dedicated HTTPS API Base URL

Every workspace supports two authenticated HTTPS base URLs:

- **Dedicated Client SSL API Subdomain (Recommended)**: `https://<workspace-slug>.api.rapidshiftlabs.in`
- **Primary Platform Origin**: `https://app.rapidshiftlabs.in`

Always pass your key in the HTTP `Authorization` header:

```bash
Authorization: Bearer rsl_live_yourbiz_xxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: application/json
```

---

## Step 3 — Testing Live Calls Inside the Built-In API Sandbox (`/developers`)

Before writing code, test your payload directly in your browser:

1. Open `/developers` (or click **Open Interactive API Sandbox** from **All API Tokens**).
2. Select an endpoint preset (`GET /api/v1/contacts`, `POST /api/v1/tally/bill-event`, `POST /api/v1/whatsapp/send-template`, or `GET /api/v1/analytics?range=30d`).
3. Paste your `rsl_live_...` or `rsl_test_...` Bearer token into the **Bearer API Key** field.
4. Edit the JSON request body if testing a `POST` route, then click **Send Live Request** to inspect the exact HTTP status code, latency (`ms`), and formatted JSON response!

---

## Step 4 — Complete v1 Endpoint Reference & Idempotency Rules

| Method & Path | Required Scope | Idempotent? | What It Does |
| --- | --- | --- | --- |
| `GET /api/v1/contacts` | `contacts:read` | — | Lists workspace customer contacts (`cnt_...`) |
| `POST /api/v1/contacts` | `contacts:write` | `Idempotency-Key` | Creates or updates contact by E.164 phone |
| `GET /api/v1/vouchers` | `vouchers:read` | — | Lists synced Tally bills & receipts (`tvch_...`) |
| `POST /api/v1/vouchers` | `vouchers:write` | `Idempotency-Key` | Upserts a Sales bill or Receipt voucher |
| `POST /api/v1/tally/bill-event` | `vouchers:write` | `Idempotency-Key` | Upserts bill AND triggers matching WhatsApp rules |
| `GET /api/v1/whatsapp/templates` | `whatsapp:read` | — | Lists templates (`tmpl_...`) and approval status |
| `POST /api/v1/whatsapp/send-template` | `whatsapp:write` | `Idempotency-Key` | Queues an `APPROVED` WhatsApp template message |
| `GET /api/v1/analytics?range=30d` | `analytics:read` | — | Returns KPIs, aging buckets, and daily series |

### Preventing Duplicate Bills or Duplicate WhatsApp Charges on Retries

Whenever your ERP or backend retries a `POST` request after a network timeout, include a deterministic `Idempotency-Key` header (for example `bill-GST-26-27-0412`):

```bash
curl -X POST "https://your-workspace.api.rapidshiftlabs.in/api/v1/tally/bill-event" \
  -H "Authorization: Bearer $RSL_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: bill-GST-26-27-0412" \
  -d '{
    "companyName": "Shree Traders",
    "voucherNumber": "GST/26-27/0412",
    "voucherType": "Sales",
    "partyName": "Mehta Electricals",
    "partyPhone": "+919820011223",
    "amountRupees": 18500,
    "dueDate": "2026-11-15"
  }'
```

---

## Readable Entity IDs & Structured Error Codes

- **Entity ID Prefixes**: `biz_` (Workspace), `cnt_` (Contact), `tvch_` (Tally Voucher), `tmpl_` (WhatsApp Template), `cnv_` (Conversation), `msg_` (Message), `out_` (Queued Outbound Job).
- **Rate Limits & Error Codes**: Standard keys allow `120 requests/minute`. Every non-2xx response returns `{ "ok": false, "code": "RSL-...", "message": "..." }` — look up every `RSL-*` code on `https://docs.rapidshiftlabs.in/errors`.
