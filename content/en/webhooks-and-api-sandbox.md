---
title: Wildcard SSL Subdomains, Inbound Webhooks & Outbound HMAC Verification
summary: Minute-by-minute guide to *.tally.rapidshiftlabs.in and *.api.rapidshiftlabs.in SSL endpoints, non-destructive ping tests, native PDF webhook uploads, outbound webhook registration, and X-RSL-Signature HMAC-SHA256 verification in Node.js and Python.
section: Developers
audience: developer
service: api.access
order: 14
lastReviewed: 2026-11-03
---

## 1. Dedicated Workspace Wildcard Subdomains (`rapidshiftlabs.in`)

Every workspace automatically receives two isolated HTTPS subdomains routed to RapidShift Labs and backed by automated SSL management (`ssl.provision` queue):

- **Tally Ingress Subdomain**: `https://<workspace-slug>.tally.rapidshiftlabs.in`
- **Public REST API Subdomain**: `https://<workspace-slug>.api.rapidshiftlabs.in`

| Integration Flow | Method & URL | Required Auth Header |
| --- | --- | --- |
| **Tally Prime Voucher / XML Sync** | `POST https://<slug>.tally.rapidshiftlabs.in/api/webhooks/tally` | `X-Tally-Webhook-Token: tlwh_...` (or `?token=tlwh_...`) |
| **Non-Destructive Handshake Ping** | `POST https://<slug>.tally.rapidshiftlabs.in/api/webhooks/tally?mode=ping` | `X-Tally-Webhook-Token: tlwh_...` |
| **OTA `.tdl` Version Manifest** | `GET https://<slug>.tally.rapidshiftlabs.in/api/webhooks/tally?mode=tdl-manifest` | `X-Tally-Webhook-Token: tlwh_...` |
| **Native Tally Printed PDF Upload** | `POST https://<slug>.tally.rapidshiftlabs.in/api/webhooks/tally?mode=voucher-pdf` | `X-Tally-Webhook-Token: tlwh_...` + `%PDF-1.x` bytes |
| **Windows Connector Agent** | `POST https://<slug>.tally.rapidshiftlabs.in/api/agent/{pair,heartbeat,ingest}` | `X-RSL-Device-Id`, `X-RSL-Timestamp`, `X-RSL-Signature` |
| **Meta WhatsApp Cloud Webhook** | `GET/POST https://app.rapidshiftlabs.in/api/webhooks/whatsapp` | `hub.verify_token` + `X-Hub-Signature-256` |

---

## 2. Step-by-Step: Testing Inbound Tally Webhooks Without Polluting Books

1. Open **All API Tokens** (`/settings/tokens`) or **Tally Prime & Bills -> Connect Tally Prime** (`/tally?tab=connect`) and copy your workspace's **`tlwh_...` Tally Webhook Token**.
2. Run this safe `?mode=ping` request from any terminal or server — it validates DNS, TLS/SSL, workspace slug matching, and token validity **without creating any voucher**:

```bash
curl -i -X POST "https://your-workspace.tally.rapidshiftlabs.in/api/webhooks/tally?mode=ping" \
  -H "X-Tally-Webhook-Token: tlwh_your_workspace_token" \
  -H "Content-Type: application/json" \
  -d '{"mode":"ping"}'
```

3. Confirm HTTP `200 OK` with `"ok": true` and check `/settings/tokens` — **Pings Received** increments immediately.

---

## 3. Step-by-Step: Registering Outbound Webhooks to Your Own Server

Want your ERP, CRM, or Slack bot notified the instant a Tally bill is saved, paid, cancelled, or a customer replies on WhatsApp?

1. Open **All API Tokens** (`/settings/tokens`) in the left sidebar.
2. Scroll to **Outbound Signed Webhooks**:
   - **Destination HTTPS URL**: Enter your server's public HTTPS endpoint (for example `https://erp.yourcompany.in/webhooks/rapidshift`).
   - **Events to Subscribe**: Tick the exact events you want (or `*` for all events):
     - `tally.bill.created` / `tally.bill.updated`
     - `tally.payment.received`
     - `tally.bill.cancelled` / `tally.bill.deleted`
     - `whatsapp.message.received` / `whatsapp.message.sent`
   - Click **Register Webhook Endpoint**.
3. Copy the generated **`whsec_...` Signing Secret** immediately and store it as `RSL_WEBHOOK_SECRET` on your server.
4. Click **Send Test Ping** on the webhook row to dispatch a live signed `webhook.test` payload and inspect the HTTP response status recorded in your delivery log.

---

## 4. Verifying `X-RSL-Signature` HMAC-SHA256 on Your Receiver

Every outbound webhook `POST` includes:

- `X-RSL-Signature: t=<unix_ms>,v1=<hex_hmac_sha256>`
- `X-RSL-Event: <event_name>`

The HMAC-SHA256 is computed over the exact string `${timestamp}.${rawRequestBody}` using your `whsec_...` secret. Always reject timestamps older than 5 minutes (`300_000 ms`) to prevent replay attacks:

### Node.js / Express Raw-Body Verification

```javascript
import crypto from "node:crypto";

export function verifyRslWebhook(rawBodyString, signatureHeader, signingSecret) {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((kv) => kv.split("=", 2))
  );
  const ts = Number(parts.t);
  const v1 = parts.v1;
  if (!ts || !v1 || Math.abs(Date.now() - ts) > 5 * 60 * 1000) return false;

  const expected = crypto
    .createHmac("sha256", signingSecret)
    .update(`${ts}.${rawBodyString}`, "utf8")
    .digest("hex");

  return (
    expected.length === v1.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1))
  );
}
```

### Python / FastAPI Verification

```python
import hmac, hashlib, time

def verify_rsl_webhook(raw_body: bytes, sig_header: str, secret: str) -> bool:
    parts = dict(item.split("=", 1) for item in sig_header.split(",") if "=" in item)
    ts = int(parts.get("t", "0"))
    v1 = parts.get("v1", "")
    if abs(int(time.time() * 1000) - ts) > 300_000:
        return False
    signed_payload = f"{ts}.".encode() + raw_body
    expected = hmac.new(secret.encode(), signed_payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, v1)
```
