---
title: WhatsApp Business Templates, Meta Approval Rules, Variables & Broadcasts
summary: Every minute step to load ready-made Tally PDF templates, design custom WhatsApp templates that pass Meta review on the first try, sync approval statuses, record opt-in consent, and launch broadcasts safely.
section: Daily Operations
audience: customer
service: whatsapp.messaging
order: 6
lastReviewed: 2026-11-03
---

## Understanding WhatsApp's 24-Hour Window vs. Approved Templates

- **Inside 24 Hours of a Customer's Last Message**: You can reply freely with plain text or attachments inside **Customer Messages** (`/inbox`) with zero template approval needed.
- **Outside 24 Hours (or First-Touch Bills & Broadcasts)**: Meta requires an **APPROVED WhatsApp Business Template** — such as a Tally GST invoice PDF (`UTILITY`), payment receipt (`UTILITY`), overdue reminder (`UTILITY`), or seasonal offer (`MARKETING`).

---

## Step 1 — Load Ready-Made Tally Starter Templates in One Click

1. Open **WhatsApp & Templates** (`/whatsapp`) in the left sidebar. *(Ensure **WhatsApp Business Messaging** is unlocked on your account and your WABA is connected in **Connected Channels**.)*
2. Click **Load Ready-Made Tally Templates** at the top of the screen.
3. RapidShift immediately installs pre-mapped templates ready for Meta sync:
   - `tally_tax_invoice_pdf` — **Utility (`DOCUMENT` PDF Header)**: attaches your 100% untouched Tally-printed PDF invoice (`{{1}}` Party Name, `{{2}}` Bill No., `{{3}}` Amount ₹, `{{4}}` Due Date).
   - `tally_sales_bill_created` — **Utility (`TEXT`)**: instant bill summary notification.
   - `tally_payment_receipt_thankyou` — **Utility (`TEXT`)**: instant `F6 Receipt` payment thank-you confirmation.
   - `tally_overdue_payment_reminder` — **Utility (`TEXT`)**: polite balance-due payment reminder.
4. Click **Sync Templates with WhatsApp** to submit them to your connected Meta WhatsApp Business Account (WABA) and pull live approval statuses (`PENDING` -> `APPROVED`).

---

## Step 2 — Building a Custom Template Without Getting Rejected by Meta (Minute-by-Minute)

In the **Visual WhatsApp Template Studio** on `/whatsapp`, fill in each field following Meta's strict formatting rules:

1. **Template Name**:
   - Use **lowercase letters, numbers, and underscores (`_`) only** — never spaces, hyphens, or capital letters (for example `diwali_wholesale_catalogue_2026` or `dispatch_lr_tracking_update`).
2. **Category**:
   - Choose **`UTILITY`** for transactional updates tied to an existing order, Tally invoice, payment receipt, or delivery status.
   - Choose **`MARKETING`** for promotional offers, festive greetings, price lists, or re-engagement broadcasts. *(Tip: Never submit promotional discounts under `UTILITY` — Meta's automated reviewer will either reclassify or reject it.)*
3. **Language Code**:
   - Select `en` / `en_US` (English) or your regional Indian language code (`hi` Hindi, `gu` Gujarati, `mr` Marathi, `ta` Tamil, `te` Telugu) matching your message text.
4. **Header Format**:
   - **None**: Text-only message.
   - **Text Header** (max 60 characters, no emojis/newlines): Short title like `Tax Invoice Generated`.
   - **Document (PDF)**: Required whenever you want to attach Tally Prime's printed PDF invoice or an e-Brochure PDF!
   - **Image**: Attaches a product banner JPEG/PNG at the top of the bubble.
5. **Body Text & Numbered Variables (`{{1}}`, `{{2}}`, `{{3}}`, `{{4}}`)**:
   - Write clear, natural sentences and insert sequential variables starting at `{{1}}` with no skipped numbers (`{{1}}`, then `{{2}}`, then `{{3}}`).
   - **Critical Meta Anti-Rejection Rules**:
     - **Never start or end the body with a variable!** Bad: `{{1}}, your bill is {{2}}` -> Good: `Hello {{1}}, your invoice {{2}} for {{3}} has been generated. Thank you.`
     - **Never place two variables back-to-back** (`{{1}} {{2}}`) without words between them.
     - **Always enter realistic Sample Values** for every variable (`{{1}}` = `Mehta Electricals`, `{{2}}` = `GST/26-27/0108`, `{{3}}` = `₹18,500`, `{{4}}` = `15 Nov 2026`). Meta rejects 100% of templates that omit variable examples!
6. **Optional Footer & Interactive Buttons**:
   - **Footer** (max 60 chars, grey muted text): e.g. `Reply STOP anytime to opt out of updates`.
   - **Buttons** (up to 3 Quick Replies or 2 Call-to-Action URL/Phone buttons): Adding a `Quick Reply` button labeled `STOP` on `MARKETING` templates keeps your Meta phone quality rating **High (Green)**.
7. Check the **Live Mobile Phone Preview** on the right, then click **Save & Submit Template**.
8. Click **Sync Templates with WhatsApp**:
   - Most `UTILITY` and clean `MARKETING` templates move from `PENDING` to `APPROVED` within **1 to 5 minutes** on Meta's side; click **Sync Templates with WhatsApp** again after 2 minutes to refresh the badge to green **APPROVED**.

---

## Step 3 — Recording Customer Opt-In Consent

Before sending promotional broadcasts, record how each customer agreed to receive WhatsApp updates:

1. On `/whatsapp` (under **Opt-In Consent Directory**) or inside **Customer Messages** (`/inbox` -> **Add Contact**):
   - Enter the customer's **Full / Party Name** and **10-Digit Mobile Number** (or `+91...`).
   - Select **Consent Source** (e.g. `Tally Invoice Counter Sign-Up`, `Website Checkout Checkbox`, `Inbound WhatsApp Inquiry`, or `Store Register`).
   - Click **Record Opt-In Consent**.

---

## Step 4 — Launching a Safe Bulk WhatsApp Broadcast

1. Scroll to **Launch Broadcast Campaign** on `/whatsapp`.
2. Enter a **Campaign Name** (for example `November Price List — Regular Dealers`).
3. Select an **`APPROVED`** template from the dropdown.
4. Fill in default/mapped variable values (`{{1}}` automatically substitutes each contact's name when mapped, or enter fixed campaign values).
5. Review the **Pre-Send Cost & Audience Check** shown before clicking launch:
   - Shows exact **Eligible Opted-In Contacts**, **Automatically Excluded Unsubscribed Numbers**, and **Estimated Wallet Deduction (₹)** (remembering your wallet seamlessly supports down to **`-₹200.00` overdraft**).
6. Click **Queue Broadcast Campaign**.
   - Every message is dispatched reliably through the background worker (`rsl-worker`) with idempotent duplicate protection (`SendGuard`), so network hiccups never send or bill the same recipient twice!

---

## Automatic `STOP` / Opt-Out Protection

- Whenever any customer replies `STOP`, `UNSUBSCRIBE`, or `OPT OUT` on WhatsApp, RapidShift immediately adds their E.164 phone number to your **Permanent Unsubscribed List** and sends zero further promotional messages to that number.
- Even if you restore an older `.rslbackup` archive months later, your **Unsubscribed List is never overwritten**, protecting your Meta Business phone number from spam blocks.
