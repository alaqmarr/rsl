---
title: Business GST Settings, SSL Subdomains, Team Invitations & Role Permissions
summary: Minute-by-minute instructions to configure GSTIN and state tax rules, verify dedicated *.tally and *.api SSL subdomains, invite colleagues, assign granular roles, and secure active browser sessions.
section: Getting Started
audience: customer
order: 3
lastReviewed: 2026-11-03
---

## 1. Configuring Business Identity & 18% GST Rules (`/settings/business`)

1. Click **Business Settings** (`/settings/business`) in the left sidebar. *(Requires `Business Owner` or `Admin` role.)*
2. Fill in each field carefully:
   - **Registered Business Name**: Your legal GST trade name (prints verbatim on every GST Tax Invoice and statement PDF).
   - **Industry**: Helps organize your workspace profile (e.g., `Wholesale & Distribution`, `Manufacturing`, `Retail`).
   - **Indian State / UT Code**: Select the 2-digit GST state code matching the first two digits of your GSTIN:
     - Selecting **`27 — Maharashtra`** splits 18% GST into **9% CGST + 9% SGST** on invoices.
     - Selecting **any other Indian state** (`01` to `38` except `27`) applies **18% IGST** for inter-state supply under SAC `998314`.
   - **15-Character GSTIN**: Enter in uppercase (e.g. `27AABCU9603R1ZM`). Double-check that the first 2 characters match your selected State Code.
   - **Billing Address, Billing Email & Business Phone**: Used for invoice headers and finance notices.
   - **Default Tally Company Name**: Optional default label when importing CSV files that omit a company column.
3. Click **Save Business Settings**.

---

## 2. Verifying Your Dedicated Wildcard SSL Subdomains

Every workspace gets two dedicated HTTPS subdomains on `rapidshiftlabs.in`:

- **Tally Prime Ingress**: `https://<workspace-slug>.tally.rapidshiftlabs.in`
- **Public REST API Ingress**: `https://<workspace-slug>.api.rapidshiftlabs.in`

To verify or refresh SSL certificates:

1. Open **Business Settings** (`/settings/business`) or **Tally Prime & Bills -> Connect Tally Prime** (`/tally?tab=connect`).
2. Check the **SSL Status** pill next to both hostnames:
   - **Active** (green): TLS certificate is live and ready for Tally Prime `.tdl v2.5` and REST API traffic.
   - **Queued / Provisioning** (amber): Backend SSL worker (`ssl.provision`) is completing certificate verification. Click **Provision / Refresh SSL** to trigger an immediate check.

---

## 3. Inviting Colleagues & Sharing Invite Links (`/settings/team`)

1. Click **Team & Roles** (`/settings/team`) in the left sidebar.
2. In the **Invite a Team Member** card:
   - Enter your colleague's **Work Email Address** (for example `accounts@mehtaelectricals.in`).
   - Choose the **Role** that matches their daily job (see the exact permission matrix below).
   - Click **Create Team Invitation**.
3. Locate the newly created row under **Pending Team Invitations**:
   - Click **Copy Invite Link** next to their email address.
   - Send that link (`https://app.rapidshiftlabs.in/accept-invite?token=...`) to your colleague over WhatsApp or email.
   - *(Note: If SMTP email is configured on the server, an invitation email is also sent automatically. Invitation links stay valid for **7 days**; if expired, click **Regenerate Link** in one click)*

### How Your Colleague Accepts the Invitation

1. Your colleague opens the `/accept-invite?token=...` link in their browser.
2. **If they are new to RapidShift Labs:** They enter their **Full Name** and choose a **Password** (minimum 8 characters), then click **Create Account & Join Workspace**.
3. **If they already have a RapidShift Labs login** (for example an external CA managing multiple client businesses): They sign in with their existing password, click **Accept Invitation**, and can switch between businesses anytime using the **Switch Business** dropdown in the top-left sidebar.

---

## 4. Choosing the Right Team Role (Permission Breakdown)

| Role Name | Best For | What Screens & Actions Are Allowed |
| --- | --- | --- |
| **Business Owner** (`owner`) | Founder / Proprietor | All 41 permissions, including billing plans, wallet top-ups, team management, API keys, and encrypted `.rslbackup` restores. Primary Owner cannot be removed or downgraded. |
| **Admin** (`admin`) | Operations Head / IT | All operational screens (Inbox, Tally, WhatsApp, Ads, Reviews, Connections, API Tokens, Team) except changing billing subscriptions or overwriting live data from backups. |
| **Marketing & Operations Manager** (`manager`) | Marketing Lead | Customer Inbox, WhatsApp templates & broadcasts, Meta Ads & scheduled social posts, Google Reviews, Analytics, and read-only Tally bill visibility. |
| **Support Executive** (`agent`) | Customer Support / Reception | Replies to customer chats in Shared Inbox, leaves internal team notes, and drafts/publishes Google Review replies. Cannot view billing, API keys, or edit Tally settings. |
| **Accounts & Billing** (`billing`) | Accountant / CA | Manages Plans & Prepaid Wallet recharges, downloads GST Tax Invoices, and views/manages Tally Prime bills & payment reminders. |
| **View-Only Analyst** (`analyst`) | Auditor / Management | Read-only access across Overview, Analytics, Tally bills, Inbox, Campaigns, Reviews, and Activity History without modifying any record. |

### Changing a Colleague's Role or Removing Access

1. Open **Team & Roles** (`/settings/team`) -> **Active Team Members**.
2. To change permissions immediately: select a new role in the **Role** dropdown on their row and click **Update Role**.
3. To revoke access when someone leaves your company: click **Remove** on their row. Their access to your workspace stops on their very next click.

---

## 5. Personal Password, Email Verification & Device Security (`/settings/profile`)

1. Open **My Profile** (`/settings/profile`) in the left sidebar.
2. **Change Password**: Enter your **Current Password** and a **New Password** (8+ characters) under **Change Login Password** and click **Update Password**.
3. **Active Device Sessions**: Review IP address, browser User-Agent, and sign-in timestamp of every logged-in browser. Click **Sign Out** next to any individual device or **Revoke All Other Sessions** to keep only your current browser active.
