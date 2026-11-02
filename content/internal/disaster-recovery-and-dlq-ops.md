# Staff SOP 4 — Support Inspector, 30-Min Support View, Failed Queues & Backup Recovery

> Staff Reference Only — Never exposed on public documentation (`admin.rapidshiftlabs.in`).

## 1. Running Read-Only Client Diagnostics (`/inspector`)

Before starting an impersonation session, check whether you can diagnose the client's question strictly read-only:

1. Open **Support Check & Log** (`/inspector`) in the left sidebar.
2. Select the **Client Business**, choose the **Diagnostic Query** (e.g. *Account record counts*, *Recent Tally sync runs*, *Latest 20 Tally vouchers*, or *Channel health*), and enter a **Support Ticket / Call Reference** (minimum 3 characters, e.g. `CALL-104`).
3. Click **Run Read-Only Check**:
   - Executes strictly read-only `SELECT` checks (zero client data can be mutated) and writes an immutable entry to the **Permanent Staff Activity Log** below.
4. Need to share redacted diagnostics with engineering? Open `/api/support-bundle?workspaceId=<id>` to export a redacted JSON support bundle (all access tokens, password hashes, and secrets are stripped automatically).

---

## 2. Using 30-Minute Audited Support View (Client Impersonation)

1. Open **Overview & Requests** (`/`) or **Client Directory -> Manage Client** (`/clients/<id>`).
2. Enter a clear **Support Reason** (minimum 5 characters, e.g. `Helping accountant verify Tally .tdl rule`) and click **Support View ↗**.
3. RapidShift opens `app.rapidshiftlabs.in` inside that client's workspace for **max 30 minutes**, displaying an unmistakable **Support Session Active** banner to the client and logging every action under your `impersonatorStaffId`.
4. Click **Exit Support View** in the top banner immediately once finished.

---

## 3. Retrying Failed Background Tasks & Sending Account Notices (`/queues`)

1. Open **Tasks & Emails** (`/queues`) in the Staff Portal sidebar.
2. **Failed / Dead-Letter Tasks**:
   - Inspect the exact `lastError` column on any failed delivery or webhook task.
   - Once the underlying issue is resolved (for example, client recharged wallet or refreshed an expired Meta token), click **Retry Task**.
   - **Zero Double-Charge Guarantee**: Built-in `SendGuard` idempotency keys guarantee retrying a failed task never bills the client twice or sends duplicate WhatsApp messages.
3. **Direct Client Account Email Notices**:
   - Use **Send Client Notification** on `/queues` to email billing reminders, SSL advisories, or onboarding instructions directly to a client's registered owner email, and verify status in the **Outbound Email Log**.

---

## 4. Quick Error Code & Resolution Reference for Support Staff

| Error Code / Message | Meaning | Exact Staff Resolution |
| --- | --- | --- |
| **`RSL-BILL-1003` (Wallet Limit Reached)** | Client used their entire rupee balance plus the `-₹200.00` overdraft buffer | Ask client to submit a Wallet Recharge on `/billing?tab=wallet`, verify UTR on Staff Overview (`/`), then click **Retry Task** on `/queues` |
| **`RSL-BILL-1002` (Entitlement Locked)** | Client's plan expired or module has not been unlocked yet | Verify pending plan request on `/` or grant access on `/clients/<id>` |
| **`Meta #190` / `HTTP 401` on WhatsApp** | Expired Meta access token | Guide client to replace token in `/connections` -> click **Test Live API** -> retry failed tasks on `/queues` |
| **`Cloudflare Error 525 / 526` on `*.tally` or `*.api`** | Second-level wildcard record left Orange-Clouded on Cloudflare Free Universal SSL | Set `*.tally` and `*.api` A records in Cloudflare DNS to **DNS Only (Grey Cloud)** and run `bash update.sh` on server |

---

## 5. Assisting with `.rslbackup` Restores Safely

When guiding a Business Owner through restoring an encrypted `.rslbackup` archive on `/backups`:

1. Confirm they have the exact **Backup Passphrase** used when the snapshot was created (AES-256-GCM archives cannot be decrypted without it).
2. Remind them to type `RESTORE` in uppercase in the confirmation field on `/backups`.
3. Reassure them of the **Four Built-In Safety Protections**:
   - Tamper-checked AES-256-GCM signature verification runs before any table is touched.
   - An automatic 7-day pre-restore safety copy of their current SQLite file is saved on disk first.
   - **Prepaid Wallet balances** and **paid GST Tax Invoices** live in the platform control ledger and are **never overwritten**.
   - **Unsubscribed (`STOP`) WhatsApp numbers** are union-merged and preserved permanently so they stay compliant.
