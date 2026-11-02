---
title: Webhooks, Wildcard SSL Subdomains & Live API Sandbox
summary: Connect inbound Tally Prime & REST integrations on *.tally.rapidshiftlabs.in and *.api.rapidshiftlabs.in with queued backend SSL provisioning, run non-destructive endpoint checks, and verify signatures.
section: Developers
audience: developer
service: api.access
order: 8
lastReviewed: 2026-11-02
---

## Dedicated Wildcard Subdomain Endpoints (`rapidshiftlabs.in`)

Every workspace on **RapidShift Labs (`rapidshiftlabs.in`)** is automatically assigned dedicated HTTPS ingress hostnames under our whitelisted wildcard zones, with SSL certificate provisioning queued and managed automatically on the backend (`ssl.provision` queue):

- **Tally Ingress Subdomain**: `https://<workspace-slug>.tally.rapidshiftlabs.in`
- **Public REST API Subdomain**: `https://<workspace-slug>.api.rapidshiftlabs.in`
- **Primary Dashboard**: `https://app.rapidshiftlabs.in`

| Service | Method & HTTPS Endpoint | Authentication |
| --- | --- | --- |
| Tally Prime Cloud Webhook | `POST https://<slug>.tally.rapidshiftlabs.in/api/webhooks/tally` | Header `X-Tally-Webhook-Token: tlwh_...` or `?token=tlwh_...` |
| Tally Handshake Check (No Side Effects) | `GET/POST https://<slug>.tally.rapidshiftlabs.in/api/webhooks/tally?mode=ping` | Header `X-Tally-Webhook-Token: tlwh_...` or `?token=tlwh_...` |
| Tally OTA `.tdl` Manifest & Latest File | `GET https://<slug>.tally.rapidshiftlabs.in/api/webhooks/tally?mode=tdl-manifest` | Header `X-Tally-Webhook-Token: tlwh_...` or `?token=tlwh_...` |
| Tally Native PDF Upload | `POST https://<slug>.tally.rapidshiftlabs.in/api/webhooks/tally?mode=voucher-pdf` | Header `X-Tally-Webhook-Token: tlwh_...` (`%PDF-1.x` binary or base64 JSON) |
| Tally Bill Event REST v1 | `POST https://<slug>.api.rapidshiftlabs.in/api/v1/tally/bill-event` | Header `Authorization: Bearer rsl_live_...` (`vouchers:write`) |
| Windows Tally Connector | `POST https://<slug>.tally.rapidshiftlabs.in/api/agent/{pair,heartbeat,ingest}` | HMAC-SHA256 (`X-RSL-Device-Id`, `X-RSL-Timestamp`, `X-RSL-Signature`) |
| WhatsApp Business Cloud Webhook | `GET/POST https://app.rapidshiftlabs.in/api/webhooks/whatsapp` | Meta `hub.verify_token` + `X-Hub-Signature-256` |

## Testing Tally Endpoints Without Polluting Real Books

Use `?mode=ping` (or click **Run Live Endpoint Check** in **Tally Prime & Bills -> Connect Tally Prime**) to verify HTTPS routing, SSL readiness, token validity, and plan entitlement without creating test vouchers:

```bash
curl -X POST "https://your-workspace.tally.rapidshiftlabs.in/api/webhooks/tally?mode=ping" \
  -H "X-Tally-Webhook-Token: tlwh_your_workspace_token" \
  -H "Content-Type: application/json" \
  -d '{"mode":"ping"}'
```

## Verifying Outbound Webhooks on Your Server

When you register your own HTTPS endpoint in **Unified API Tokens & Webhook Vault**, every outbound JSON event (`tally.bill.created`, `tally.payment.received`, `tally.bill.cancelled`, `tally.bill.deleted`, `whatsapp.message.received`, etc.) includes an `X-RSL-Signature` header (`t=<timestamp_ms>,v1=<hmac_sha256>`) signed with your endpoint secret.
