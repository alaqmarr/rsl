# Staff SOP 6 — Production Operations, DPDP Act 2023 Compliance & Security Incident Playbook

> Staff & Engineering Reference Only — Never exposed on public documentation (`admin.rapidshiftlabs.in`).
> Official Security, Grievance & Privacy Contact: `app@rapidshiftlabs.in`

---

## 1. Offsite Backup Verification & Rollback Drill Cadence

RapidShift Labs stores per-tenant operational data in isolated SQLite WAL files (`DATA_DIR/tenants/<tenantId>/data.db` and `logs/current.db`) alongside `platform/control.db`, `platform/ingress.db`, and `platform/platform-logs.db`.

1. **Automated Nightly Encrypted Backups (`02:30 IST`, `bulk` worker lane)**:
   - Creates AES-256-GCM signed `.rslbackup` bundles per active tenant without blocking realtime webhook/WhatsApp workers.
   - Uploads offsite copies to connected Google Drive folders or R2/object storage when configured.
2. **Weekly Rollback & Hash-Chain Verification Drill**:
   - Run `pnpm ops:rollback-drill` (`node scripts/db-rollback-drill.mjs`) on staging/ops hosts before major releases and weekly on Mondays.
   - Confirm output reports `PASS — integrity_check=ok`, STOP opt-out union-merge preservation, and intact SHA-256 hash chain verification.
3. **Platform Pre-Deploy Health & Load Verification**:
   - Run `pnpm ops:verify` to validate environment posture (`NODE_ENV=production`, non-local `PRIMARY_DOMAIN`, `MASTER_KEY` entropy, Turnstile keys, SMTP pool).
   - Run `pnpm loadtest` (`node scripts/load-test-local.mjs --base=http://127.0.0.1:4500 --concurrency=25 --requests=250`) to confirm `sqlite_busy=0` and `5xx=0`.

---

## 2. CERT-In (6-Hour) & DPDP Act 2023 (72-Hour) Incident Response Playbook

Under **CERT-In Directions (2022)** and India's **Digital Personal Data Protection (DPDP) Act, 2023**, security incidents involving unauthorized access to personal data, credential compromise, or widespread service disruption follow strict statutory clocks:

### T + 0 to 30 Minutes — Containment & Evidence Preservation
1. **Isolate Affected Credentials / Sessions**:
   - If a platform staff account is suspected: revoke all staff sessions in `/staff`, reset password, and rotate TOTP MFA immediately.
   - If a client workspace token or public bill link is exposed: open `/tally` -> click **Rotate Public Bill Links** (increments `publicLinkEpoch` immediately invalidating all prior links) and revoke compromised API keys in `/settings/tokens`.
   - If a provider webhook secret or OAuth credential is leaked: rotate the secret in `/credentials` (requires 15-minute Staff Step-Up verification) and run **Test Credential** to confirm live handshake.
2. **Snapshot Forensic Logs Before Any Remediation Restart**:
   - Copy `DATA_DIR/platform/platform-logs.db` and affected `DATA_DIR/tenants/<id>/logs/current.db` to an immutable incident folder with SHA-256 checksums.

### T + 6 Hours — Mandatory CERT-In Notification
- For qualifying cyber incidents (unauthorized access to customer databases, targeted exploitation, key compromise), submit the structured incident report to `incident@cert-in.org.in` within **6 hours of detection**, attaching:
  - Timestamp of detection (IST), affected domains/IPs, attack vector, containment actions taken, and point of contact (`app@rapidshiftlabs.in`).

### T + 72 Hours — DPDP Data Protection Board & Affected Data Principals Notice
- Notify the **Data Protection Board of India** and affected Workspace Owners (`owner` role email) in clear, plain language covering:
  - Nature and categories of personal data affected (e.g. contact phone numbers, invoice metadata).
  - Likely impact and protective actions already completed (e.g. token rotation, session revocation).
  - Steps the customer can take and direct contact for our Data Protection & Grievance Officer (`app@rapidshiftlabs.in`).

---

## 3. DPDP Data Portability, Right to Erasure & Sub-Processor Register

1. **Self-Serve Data Portability (`/settings/business`)**:
   - Workspace Owners can export a complete machine-readable JSON snapshot (`exportWorkspaceDataPortabilitySnapshot`) containing workspace profile, contacts, conversations, Tally vouchers, wallet ledger, GST invoices, and audit metadata at any time.
2. **Cryptographic Erasure / Right to be Forgotten (`/settings/business`)**:
   - Workspace Owners can execute **Permanently Delete & Crypto-Shred Workspace** (requires Owner password re-entry + `DELETE MY WORKSPACE` confirmation + zero unsettled negative overdraft).
   - `eraseAndCryptoShredWorkspace` revokes sessions/API keys/webhooks, wipes encrypted channel secrets, increments `publicLinkEpoch` by `+1000`, deletes physical per-tenant SQLite & media files on disk, and records a minimal compliance tombstone (`tenant_deletion_tombstones`) in `platform-logs.db` while retaining statutory GST tax invoice records required under the CGST Act (8-year statutory retention).
3. **Authorized Sub-Processors (DPA Schedule)**:
   - **Meta Platforms, Inc.** — WhatsApp Cloud API, Facebook/Instagram Publishing & Marketing APIs (when connected by workspace).
   - **Google LLC** — Google Business Profile, Google Ads, Google Analytics 4, Search Console, YouTube, and optional Google Drive encrypted backup folder (when connected by workspace).
   - **Razorpay Software Pvt. Ltd.** — Optional INR payment gateway processing & webhook verification.
   - **Cloudflare, Inc.** — Turnstile bot protection, DNS/TLS edge routing, and optional Workers AI inference (explicitly badged in UI).
   - **Bhashini (Digital India Bhashini Division)** — Optional Indian-language translation API when configured.

---

## 4. Cryptographic Key Hierarchy & HKDF Subkey Rotation

`MASTER_KEY` is never used raw as a multi-purpose HMAC secret. `@rsl/core` derives domain-separated 256-bit subkeys via **RFC 5869 HKDF-SHA256** (`derivePurposeKey(purpose)`):

- `rsl:tally-public-bill:v1` — 72-hour public Tally bill payment links (paired with per-workspace `publicLinkEpoch`).
- `rsl:tally-voucher-pdf:v1` — Signed native Tally PDF download URLs.
- `rsl:media-signed-url:v1` — Private workspace media object URLs (`/api/media/...`).
- `rsl:flash-toast:v1` — Tamper-evident `sig1.` flash toast cookies (`rsl_toast`, `rsl_admin_toast`).
- `rsl:password-reset-handoff:v1` — Short-lived `HttpOnly` password reset handoff cookies.
- `rsl:tally-webhook-replay:v1` — 5-minute Tally Connector webhook HMAC signature verification.

When rotating `MASTER_KEY` during a scheduled maintenance window:
1. Stop PM2 services cleanly (`pnpm pm2:stop`) so `instrumentation.node.ts` and `@rsl/worker` flush WAL checkpoints and close all SQLite handles.
2. Back up `DATA_DIR` in full, re-encrypt stored envelope ciphertexts (`workspaces`, `channel_connections`, `platform_credentials`, `staff_users.totp_secret_encrypted`) with the new key, update `.env`, and run `pnpm ops:verify` before `pnpm pm2:start`.
