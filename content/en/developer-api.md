---
title: Developer REST API, Tally Webhooks & Record IDs
summary: Authenticate with scoped rsl_live_ keys, automate Tally Prime bill WhatsApp messages via API, and integrate your ERP or website.
section: Developers
audience: developer
service: api.access
order: 7
lastReviewed: 2026-11-01
---

## Getting Started with Scoped API Keys

Once the **Developer REST API & Webhooks** plan is unlocked on your business account, open **API & Tally Webhooks** in your sidebar to generate scoped Bearer keys:

- **Live keys**: `rsl_live_<business>_<secret>`
- **Sandbox / Test keys**: `rsl_test_<business>_<secret>`

> **Save Your Key Immediately:** For security, the full API key is shown **only once** at the moment you create it. You can revoke any key in one click if a developer leaves your team.

## Key REST Endpoints (`v1`)

| Method & Endpoint | Scope Required | Purpose |
| --- | --- | --- |
| `GET /api/v1/contacts` | `contacts:read` | List customer contacts in your workspace |
| `POST /api/v1/contacts` | `contacts:write` | Create or update a customer contact by phone number |
| `GET /api/v1/vouchers` | `vouchers:read` | List synced Tally Prime sales bills and receipts |
| `POST /api/v1/tally/bill-event` | `vouchers:write` | Push a Tally bill/receipt and send automated WhatsApp templates |
| `GET /api/v1/whatsapp/templates` | `whatsapp:read` | List approved WhatsApp Business templates and variable slots |
| `POST /api/v1/whatsapp/send-template` | `whatsapp:write` | Send an approved WhatsApp template message immediately |

## Readable Record Identifiers

Every record returned by the API uses a clean, human-readable prefix so your developers can recognize record types immediately:

- `biz_...` — Business workspace
- `cnt_...` — Customer contact
- `tvch_...` — Tally Prime bill or payment receipt
- `tmpl_...` — WhatsApp Business message template
- `cnv_...` / `msg_...` — Customer conversation & message

## Safe Network Retries

Include an `Idempotency-Key` header on `POST` requests to `/api/v1/contacts`, `/api/v1/vouchers`, and `/api/v1/tally/bill-event` so network retries never create duplicate bills or send duplicate WhatsApp messages.
