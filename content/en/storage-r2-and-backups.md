---
title: Cloud Storage (Cloudflare R2 / S3), Exports & Encrypted Workspace Backups
summary: Complete minute-by-minute instructions to create a Cloudflare R2 or AWS S3 bucket, generate least-privilege S3 API keys, migrate files without loss, download CSV/XML exports, and create or restore password-protected .rslbackup archives.
section: Data & Cloud Storage
audience: both
service: storage.managed
order: 11
lastReviewed: 2026-11-03
---

## Storage & AI Options - 1-Click Client Cloudflare vs. RSL Managed Cloud

Open **Connected Accounts** (`/connections`) or **Backups & Storage** (`/backups`) in your left sidebar. RapidShift Labs uses a clear split-responsibility cloud architecture:

- **Always Managed by RapidShift Labs (Platform Baseline)**:
  - **Cloudflare Turnstile Bot Protection (CAPTCHA)**: Protects login, registration, and public enquiry forms using RapidShift Labs' platform Turnstile keys (and skips automatically when unconfigured).
  - **Platform Email Routing & Ingress Security**: Handled by RapidShift Labs (`app@rapidshiftlabs.in`).
- **Your Own Cloudflare Account via 1-Click Connect (R2 Storage, Workers AI & Compute)**:
  - **1-Click Authorize on Cloudflare**: Click **1-Click Authorize on Cloudflare** on `/connections` or `/backups` to launch Cloudflare's official API Token template (`dash.cloudflare.com/profile/api-tokens`) with `workers_r2:edit`, `workers_ai:edit`, `workers_scripts:edit`, `workers_kv_storage:edit`, `d1:edit`, and `account_settings:read` pre-selected.
  - **Zero Manual S3 Key Hashing**: Paste the single token back into RapidShift Labs. The platform automatically discovers your 32-character **Cloudflare Account ID**, derives your R2 S3 **Access Key ID** (`token.id`) and **Secret Access Key** (`SHA-256(token)`), creates or links your R2 bucket (`rsl-vault-<workspace>`), and routes your workspace's **Workers AI** calls (`@cf/meta/llama-3.1-8b-instruct` and `@cf/openai/whisper`) through your own Cloudflare account.
- **RSL Managed Cloud Storage (`storage.managed` Paid Plan)**: Zero external cloud setup. Unlock the **Managed Cloud File Storage** plan in **Plans & Wallet**, select **RSL Managed Cloud Storage**, and click **Save Storage Settings**.

---

## Step 1 - Creating a Cloudflare R2 Bucket & S3 API Token (Every Cloudflare Click)

1. Sign in to `https://dash.cloudflare.com` and select your Cloudflare account.
2. In the left navigation bar, click **R2 Object Storage** -> **Overview** *(if using R2 for the first time, activate the free 10 GB/month R2 tier)*.
3. Click the blue **Create bucket** button:
   - **Bucket name**: enter lowercase letters, numbers, and hyphens only - e.g. `shree-traders-rsl-vault`.
   - **Location**: choose **Automatic** (or **Asia-Pacific (`APAC`)** for fastest Indian latency).
   - **Default Storage Class**: keep **Standard** -> click **Create bucket**.
4. Return to **R2 Object Storage -> Overview** and copy your **Account ID** (32-character hex string in the right sidebar) - your S3 Endpoint URL is:
   `https://<YOUR_32_CHAR_ACCOUNT_ID>.r2.cloudflarestorage.com`
   *(Important: Do **NOT** include `/shree-traders-rsl-vault` at the end of the Endpoint URL)*
5. Still on **R2 Overview**, click **Manage R2 API Tokens** (top right) -> click **Create Account API token** (or **Create API token**):
   - **Token name**: `RSL Marketing Storage Key`
   - **Permissions**: select **Object Read & Write** (never *Admin Read & Write*).
   - **Specify bucket(s)**: select **Apply to specific buckets only** -> choose `shree-traders-rsl-vault`.
   - **TTL**: leave as **Forever** -> click **Create API Token**.
6. On the confirmation screen, copy all three values immediately (Cloudflare shows the Secret Access Key only once):
   - **Access Key ID**
   - **Secret Access Key**
   - **Use jurisdiction-specific endpoints for S3 clients**: `https://<account_id>.r2.cloudflarestorage.com`

---

## Step 2 - Connecting & Migrating Storage Without Losing a Single File

1. Open **Backups & Storage** (`/backups`) in RapidShift Labs.
2. Under **Cloud Storage Destination**, select **Custom Cloudflare R2 / S3 Bucket**.
3. Fill in the four fields:
   - **S3 Endpoint URL**: `https://<account_id>.r2.cloudflarestorage.com`
   - **Region**: `auto` (for Cloudflare R2) or e.g. `ap-south-1` (for AWS Mumbai S3)
   - **Bucket Name**: `shree-traders-rsl-vault`
   - **Access Key ID & Secret Access Key**: paste the keys copied above (stored encrypted with AES-256-GCM).
4. **Keep "Copy and verify all existing stored files before switching" checked**:
   - RapidShift copies every existing Tally PDF and attachment to your new bucket, verifies byte-length integrity on every object, and only switches the active pointer once 100% of files pass verification.
5. Click **Save Storage Settings**.

---

## Step 3 - One-Click Always-Free Exports (CSV, Tally XML & JSON)

Even without any backup add-on unlocked, you can export your live records at any time from the top action bar of **Backups & Storage** (`/backups`):

1. **Export Contacts CSV**: Clean spreadsheet of all contacts, mobile numbers, emails, and opt-in states.
2. **Export Tally XML**: Tally Prime-compatible XML archive of synced vouchers.
3. **Export Portable JSON**: Complete structured JSON export of contacts, conversations, vouchers, and templates.

---

## Step 4 - Creating & Restoring Password-Protected `.rslbackup` Snapshots

*(Requires **Encrypted Customer Backups & Export** (`backup.export`) unlocked in **Plans & Wallet**.)*

### A. Connecting Google Drive in 1 Click (Automatic Off-Site Sync)

1. Open **Backups & Storage** (`/backups`) - the **Google Drive Automatic Off-Site Backups** card is right at the top of the page (and a **Connect to Google Drive** button also sits in the top-right header).
2. Click **Connect to Google Drive** (you never need Google Cloud Console, Service Account JSON keys, or manual Folder IDs).
3. Sign in on Google's official **RapidShift Labs** consent screen and click **Allow**:
   - Uses Google's strict `drive.file` privacy scope - RapidShift Labs can **only** write to its own backup folder and can **never** read any other files in your Google Drive.
   - Automatically creates a **`RapidShift Labs Backups`** folder in your Google Drive.
4. Once connected, every backup you create below is automatically uploaded into your Google Drive folder - or click **Backup & Upload to Google Drive Now** right on the Google Drive card.

### B. Creating an Encrypted Backup

1. Scroll to **Download Full Workspace Backup (`.rslbackup`)** on `/backups`.
2. Confirm or customize the backup label and click **Create Backup Now**.
3. Once complete, click **Download `.rslbackup`** in the backup list - and if your Google Drive is connected above, a copy is already safely uploaded to your **`RapidShift Labs Backups`** folder in Google Drive.

### C. Restoring Safely Without Overwriting Financial or Opt-Out Ledgers

1. Scroll to **Restore Workspace from `.rslbackup`** on `/backups`.
2. Select your `.rslbackup` file, enter the exact **Backup Encryption Passphrase**, type `RESTORE` in the confirmation box, and click **Verify & Restore Backup**.
3. **Built-In Four-Layer Safety Guarantee**:
   - **Cryptographic Signature Check**: Corrupted or tampered files are rejected before touching your database.
   - **Automatic Pre-Restore Safety Snapshot**: RapidShift saves a 7-day emergency copy of your current live database right before restoring.
   - **Financial Passbook & GST Invoices Protected**: Your **Prepaid Wallet balance** and **paid GST Tax Invoices** live in the platform financial ledger and are **never rolled back** by a backup restore.
   - **Permanent `STOP` Opt-Out List Protected**: Unsubscribed WhatsApp phone numbers are merged and preserved so opted-out customers are never messaged accidentally after a restore.
