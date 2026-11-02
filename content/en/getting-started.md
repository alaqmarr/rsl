---
title: Complete Workspace Launch Guide — Account Setup to First Automated Bill
summary: Every minute step to register your business, configure GSTIN and SSL subdomains, unlock plans, fund your Prepaid Wallet, connect WhatsApp and Tally Prime, and invite your team without skipping a single click.
section: Getting Started
audience: customer
order: 1
lastReviewed: 2026-11-03
---

## Before You Begin — What to Keep Ready

Gather these five items before starting so you can complete your entire workspace setup in one sitting:

- **Your 15-Character Business GSTIN & Registered State** (optional for unregistered businesses, required if you claim B2B GST Input Tax Credit).
- **UPI App or NetBanking Access** (Google Pay, PhonePe, Paytm, or corporate bank account) to copy the 12-digit UTR / UPI Reference Number when activating plans or topping up your wallet.
- **Meta Business Portfolio Admin Login** (`business.facebook.com`) if you plan to send official WhatsApp Business messages or connect Instagram / Facebook Pages.
- **Windows Office PC Running Tally Prime** (Release 2.0 or newer) if you want automatic WhatsApp GST bill PDFs and payment reminders.
- **Colleague Work Emails** if you want your accountant, support executive, or marketing manager to share the workspace under role-based permissions.

---

## Step 1 — Create Your Account & Verify Personal Security

1. Open `https://app.rapidshiftlabs.in/register` in Chrome or Microsoft Edge.
2. Fill in **Your Full Name**, **Work Email Address**, **Password** (minimum 8 characters), **Registered Business Name**, **Industry**, **Billing State**, and **15-Character GSTIN** (if registered), then click **Create Business Workspace**.
   - As soon as your workspace is created, RapidShift Labs provisions an isolated database exclusively for your business and queues dedicated HTTPS SSL certificates for `<your-slug>.tally.rapidshiftlabs.in` and `<your-slug>.api.rapidshiftlabs.in`.
3. Click **My Profile** (`/settings/profile`) in the left sidebar under **Settings & Account**:
   - Enter your **Job Title** (for example `Proprietor` or `Accounts Head`) and **10-Digit Mobile Number**, then click **Save Profile Details**.
   - Under **Active Browser & Device Sessions**, confirm only your own browser is listed. If you ever sign in on a shared office computer, click **Revoke All Other Sessions** here in one click.

---

## Step 2 — Configure Business GST State, GSTIN & Dedicated SSL Subdomains

1. Click **Business Settings** (`/settings/business`) in the left sidebar.
2. Under **Business Identity & GST Tax Configuration**:
   - Confirm **Registered Business Name** matches your legal trade name (this exact name prints under **Bill To** on your official GST Tax Invoices).
   - Select your exact **Indian State / Union Territory Code** (for example `27 — Maharashtra`, `24 — Gujarat`, `29 — Karnataka`, `07 — Delhi`).
   - Enter your **15-Character GSTIN** in uppercase (for example `27AABCU9603R1ZM`) with no spaces.
   - Enter your **Registered Billing Address**, **Accounts Email**, and **Business Phone**, then click **Save Business Settings**.
   - **Why this step matters:** Same-state Maharashtra (`27`) invoices automatically split tax into **9% CGST + 9% SGST**, while all other states calculate **18% IGST** under SAC `998314`.
3. Scroll down to **Dedicated Wildcard HTTPS Endpoints & SSL Status**:
   - Confirm both `https://<your-slug>.tally.rapidshiftlabs.in` and `https://<your-slug>.api.rapidshiftlabs.in` display **Active** (or click **Provision / Refresh SSL** if queued).

---

## Step 3 — Unlock Your Required Feature Plans or Value Bundle

1. Click **Plans & Wallet** (`/billing`) in the left sidebar.
2. Compare **Value Bundles** at the top (if you need multiple tools at a discounted rate) or scroll to **Individual Modular Plans** (such as **Tally Prime Sync & Reminders**, **WhatsApp Business Messaging**, **Unified Customer Inbox**, **Meta Ads & Social**, or **Google Reviews**).
3. Click **Activate Plan** (or **Request Bundle Activation**) on the card you want:
   - Choose your **Billing Cycle** (`Monthly`, `Quarterly`, or `Yearly`) in the popup modal.
   - Review the **Taxable Subtotal**, **18% GST**, and **Total Payable (₹)** shown in the summary box.
   - Scan the **Dynamic UPI QR Code** using Google Pay / PhonePe / Paytm — or transfer the exact **Total Payable** to the displayed **Bank Account Number & IFSC Code** via IMPS/NEFT.
   - Copy the **12-digit UTR / UPI Transaction ID** from your payment app receipt screen and paste it into **UTR / Payment Reference Number**.
   - Add an optional note (such as `Paid via HDFC Corporate UPI`) and click **Submit Activation Request**.
4. Your request status immediately changes to **Pending Verification**. As soon as our finance desk verifies the UTR, your feature unlocks automatically and your paid **Rule 46 GST Tax Invoice** becomes downloadable in **Plans & Wallet -> GST Tax Invoices**.

---

## Step 4 — Fund Your Prepaid Message Wallet (`-₹200.00` Overdraft Included)

1. Stay in **Plans & Wallet** (`/billing?tab=wallet`) and locate the **Recharge Prepaid Wallet** card.
   - **Important:** Monthly plans unlock software screens; the **Prepaid Wallet** pays per-message WhatsApp delivery rates and ₹1.00 Smart Review drafts. Even at `₹0.00`, RapidShift Labs gives every workspace an automatic **`-₹200.00` overdraft buffer** so urgent Tally GST invoices never stop mid-day!
2. Enter the **Recharge Amount (₹)** (for example `1000` or `2500`).
3. Scan the UPI QR code or transfer via Bank NEFT/IMPS, paste your **12-Digit UTR Number**, select **UPI** or **Bank Transfer**, and click **Submit Wallet Recharge**.
4. Once verified, your top-bar green wallet pill updates immediately and every rupee deduction is logged permanently in your **Append-Only Wallet Passbook**.

---

## Step 5 — Connect WhatsApp Cloud API & Load Starter Templates

1. Click **Connected Channels** (`/connections`) in the left sidebar.
2. Select **WhatsApp Cloud API**, follow all 6 on-screen Meta whitelisting steps (or read [Connecting WhatsApp, Instagram, Facebook & Google](/guides/connecting-channels-whatsapp-meta-google) for every Meta console click), paste your **15-Digit Phone Number ID**, **WABA ID**, and **Permanent System User Token**, keep **Run live API check immediately after saving** ticked, and click **Connect WhatsApp Cloud API**.
3. Click **WhatsApp & Templates** (`/whatsapp`) in the left sidebar:
   - Click **Load Ready-Made Tally Templates** to pre-install `tally_tax_invoice_pdf` (for untouched Tally PDF bills), `tally_sales_bill_created`, `tally_payment_receipt_thankyou`, and `tally_overdue_payment_reminder`.
   - Click **Sync Templates with WhatsApp** to submit and pull `APPROVED` status from Meta.

---

## Step 6 — Connect Tally Prime & Invite Your Team

1. Click **Tally Prime & Bills** (`/tally?tab=connect`) in the left sidebar:
   - Click **Run Live Endpoint Check** to verify your `<your-slug>.tally.rapidshiftlabs.in` webhook handshake.
   - Download `rsl-tally-whatsapp.tdl` (`v2.5`), enable Port `9000` in Tally Prime (`F1 -> Settings -> Connectivity -> Client/Server Configuration`), and load the `.tdl` via `F1 -> TDLs & Add-Ons -> F4` (full keystroke walkthrough in [Tally Prime Cloud Sync & Exact PDF Invoices](/guides/tally-sync-and-import)).
2. Click **Team & Roles** (`/settings/team`) in the left sidebar:
   - Enter your colleague's **Email Address**, choose their exact role (`Admin`, `Marketing & Operations Manager`, `Support Executive`, `View-Only Analyst`, or `Accounts & Billing`), click **Create Team Invitation**, and click **Copy Invite Link** to send them their 7-day onboarding URL.

---

## Quick Verification Checklist

| Check | Where to Verify | Expected Result |
| --- | --- | --- |
| **Setup Progress Bar** | Top-left sidebar (`Business Overview`) | Shows `100%` (all setup milestones green) |
| **SSL Subdomains** | `Business Settings` (`/settings/business`) | Both `.tally` and `.api` subdomains show **Active** |
| **WhatsApp Channel** | `Connected Channels` (`/connections`) | Status badge shows **Healthy** after clicking **Test Live API** |
| **Tally Prime Sync** | `Tally Prime & Bills` (`/tally?tab=connect`) | Overall banner shows **Live Connected** or **Endpoint Verified** |
| **Page Guide Anytime** | Top-right **Page Guide** button or inline banner on every screen | Opens minute-by-minute instructions specific to the screen you are viewing |
