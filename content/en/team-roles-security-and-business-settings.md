---
title: Business GST Settings, Confidentiality Vault, OTP Unmasking & Strict Departmental RBAC
summary: Configure GSTIN and state tax rules, protect supplier and buyer identities with custom auto-deletion, masking, API-only cleartext, and 6-digit OTP reveal, and enforce strict 8-role departmental RBAC between Accounting and Marketing teams.
section: Getting Started
audience: customer
order: 3
lastReviewed: 2026-11-10
---

## 1. Configuring Business Identity & 18% GST Rules (`/settings/business`)

1. Click **Business Settings** (`/settings/business`) in the left sidebar. *(Requires `Business Owner` or `Admin` role.)*
2. Fill in each field carefully:
   - **Registered Business Name**: Your legal GST trade name (prints verbatim on every GST Tax Invoice and statement PDF).
   - **Industry**: Helps organize your workspace profile (e.g., `Wholesale & Distribution`, `Manufacturing`, `Retail`).
   - **Indian State / UT Code**: Select the 2-digit GST state code matching the first two digits of your GSTIN:
     - Selecting **`27 - Maharashtra`** splits 18% GST into **9% CGST + 9% SGST** on invoices.
     - Selecting **any other Indian state** (`01` to `38` except `27`) applies **18% IGST** for inter-state supply under SAC `998314`.
   - **15-Character GSTIN**: Enter in uppercase (e.g. `27AABCU9603R1ZM`). Double-check that the first 2 characters match your selected State Code.
   - **Billing Address, Billing Email & Business Phone**: Used for invoice headers and finance notices.
   - **Default Tally Company Name**: Optional default label when importing CSV files that omit a company column.
3. Click **Save Business Settings**.

---

## 2. Supplier & Buyer Confidentiality Vault, Custom Auto-Deletion & 6-Digit OTP Reveal

Many manufacturers, distributors, and wholesalers face a critical confidentiality risk: if an unauthorized person or competing supplier glimpses your client portal, they could see the exact company names, GSTINs, and phone numbers of the buyers you supply. RapidShift Labs provides a dedicated **Data Confidentiality, Retention & Masking Vault** on both **Business Settings** (`/settings/business`) and **Tally Prime & Bills** (`/tally`):

1. **Save Bills & Party Details Checkbox (`saveBillsAndDetails`)**:
   - **Checked (Default)**: Synchronized Tally bills, party ledgers, and line items are stored in your workspace database according to your retention schedule.
   - **Unchecked (Zero-Persistence Ephemeral Mode)**: RapidShift Labs uses incoming Tally bill events solely to dispatch your immediate WhatsApp invoice/reminder and automatically purges the saved bill, line items, PDF attachment, and party contact record right after dispatch.
2. **Custom Auto-Delete Timer (`autoDeleteRetentionHours`)**:
   - Choose when stored bills, voucher line items, invoice PDFs, and party contacts are automatically deleted:
     - **Immediate (`0 hours`)**: Purge right after outbound WhatsApp dispatch.
     - **Preset Windows**: `1 hour`, `6 hours`, `24 hours`, `72 hours (3 days)`, `168 hours (7 days)`, `720 hours (30 days)`, or `2160 hours (90 days)`.
     - **Custom Hours**: Enter any custom retention window from `1` to `8760` hours (up to 1 year), or select **Never auto-delete (Manual only)**.
   - Click **Purge All Saved Bills & Party Records Now** at any time to wipe stored vouchers and party ledgers on demand.
3. **Mask Company Names & Contact Details in Portal (`maskCompanyAndContactDetails`)**:
   - When enabled, every buyer/supplier company name (`Sh*** Tr***** Pv* Lt*`), GSTIN (`27***********1Z5`), PAN (`AA******9A`), phone number (`+91 ******3210`), and email address is masked across `/tally`, `/tally/parties`, and `/` (Overview).
4. **API-Only Unmasked Access (`allowApiUnmaskedAccessOnly`)**:
   - When enabled, the web portal remains strictly masked at all times while authenticated programmatic calls to `/api/v1/vouchers` using your workspace `Bearer rsl_live_...` API key still receive unmasked cleartext JSON for ERP synchronization.
5. **6-Digit Email OTP Reveal (`requireOtpToUnmask`)**:
   - When an authorized Owner, Admin, or Accountant needs to inspect cleartext company names in the web portal (and `API-Only Unmasked Access` is off), they click **Send 6-Digit OTP** in the confidentiality banner.
   - RapidShift Labs sends a 6-digit verification code to their registered email address (`app@rapidshiftlabs.in` SMTP).
   - Entering the 6-digit code unlocks cleartext party names for **15 minutes** for that user session only, with a 1-click **Lock & Mask Now** button to re-mask immediately.

---

## 3. Strict 8-Role Departmental RBAC (Zero Cross-Department Leakage)

RapidShift Labs enforces strict server-side Role-Based Access Control (RBAC) across every page, server action, and API endpoint so that **Marketing** staff can never view Tally accounting data and **Accountants** can never view or alter Marketing campaigns:

| Role Name | Slug | Allowed Department Scope | Strictly Blocked From |
| --- | --- | --- | --- |
| **Business Owner** | `owner` | All 41 workspace permissions including GST settings, confidentiality policy, billing plans, wallet recharges, API keys, and `.rslbackup` restores. | None (Primary Owner cannot be removed or downgraded). |
| **Admin** | `admin` | Full operational management across Tally, Marketing, Inbox, Connections, API Keys, and Team invitations. | Cannot cancel workspace subscription or overwrite live database from backup archives. |
| **Operations Manager** | `manager` | Cross-department supervisor with operational access to Inbox, WhatsApp, Campaigns, Reviews, Analytics, and read-only Tally oversight. | Cannot modify workspace billing plans, API keys, or destructive backup restores. |
| **Accountant & Tally Executive** | `accountant` | **Accounting & Tally Only**: Full access to Tally Prime sync (`/tally`), Party Ledgers (`/tally/parties`), Stock & Inventory (`/tally/products`), GST Tax Invoices (`/billing`), and `.rslbackup` exports (`/backups`). | **Zero access** to Meta/Google Ads (`/campaigns`), Social Posts, Google Reviews (`/reviews`), or Shared Customer Inbox (`/inbox`). |
| **Marketing & Campaigns Team** | `marketing` | **Marketing & Growth Only**: Full access to Meta & Google Ads (`/campaigns`), Scheduled Social Posts, Website Pixel Conversions, Google Reviews (`/reviews`), WhatsApp Templates & Broadcasts (`/whatsapp`), and Marketing Analytics. | **Zero access** to Tally Bills (`/tally`), Party Ledgers (`/tally/parties`), Inventory (`/tally/products`), Billing & GST Invoices (`/billing`), Backups (`/backups`), API Keys, or Team Settings. Even on `/` (Overview), Marketing users see a dedicated **Marketing & Campaigns Desk** with zero Tally receivables or party names. |
| **Support & Inbox Executive** | `agent` | Replies to customer chats in Shared Inbox (`/inbox`), adds internal notes, and drafts/publishes Google Review replies (`/reviews`). | Blocked from Tally, Billing, Campaigns, API Keys, and Team Settings. |
| **Billing & Finance Controller** | `billing` | Manages Plans & Prepaid Wallet recharges (`/billing`), downloads GST Tax Invoices, and views Tally bill reconciliation. | Blocked from Ads, Social Posts, Inbox, API Keys, and Team Settings. |
| **Read-Only Auditor / Analyst** | `analyst` | Read-only inspection across Overview, Analytics, Tally, Inbox, Campaigns, Reviews, and Audit Logs without modifying any record. | Blocked from all create, edit, delete, send, and export mutations. |

---

## 4. Inviting Colleagues & Assigning Departmental Roles (`/settings/team`)

1. Click **Team & Roles** (`/settings/team`) in the left sidebar.
2. In the **Invite a Team Member** card:
   - Enter your colleague's **Work Email Address** (for example `ca@mehtaelectricals.in` or `ads@mehtaelectricals.in`).
   - Select their exact departmental **Role** (`Accountant & Tally Executive`, `Marketing & Campaigns Team`, `Operations Manager`, `Support & Inbox Executive`, etc.).
   - Click **Create Team Invitation** and share the generated `/accept-invite?token=...` link.
3. To change a colleague's role or revoke access immediately, use the **Update Role** or **Remove** actions under **Active Team Members**.

---

## 5. Personal Password, Email Verification & Device Security (`/settings/profile`)

1. Open **My Profile** (`/settings/profile`) in the left sidebar.
2. **Change Password**: Enter your **Current Password** and a **New Password** (8+ characters) under **Change Login Password** and click **Update Password**.
3. **Active Device Sessions**: Review IP address, browser User-Agent, and sign-in timestamp of every logged-in browser. Click **Sign Out** next to any individual device or **Revoke All Other Sessions** to keep only your current browser active.
