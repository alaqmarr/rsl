---
title: Business Analytics, Tally Receivable Aging, ROI & Management PDF/CSV Reports
summary: Minute-by-minute guide to reading cashflow KPIs, switching 7d/30d/90d/365d windows, acting on Tally Prime receivable aging buckets (0-30 to 90+ days), comparing channel ROI, and downloading CSV or PDF reports.
section: Daily Operations
audience: customer
order: 10
lastReviewed: 2026-11-03
---

## Zero Sample Numbers — Where Every Figure Comes From

Every metric on **Business Overview** (`/`) and **Detailed Analytics** (`/analytics`) is computed live from your workspace's actual database records:

- **Money Collected (₹)**: Paid Tally `Receipt` vouchers + paid Portion of `Sales` bills recorded inside the selected date window.
- **Pending Customer Bills (₹)**: Unpaid & partially paid non-cancelled Tally `Sales` vouchers (`amountPaise - paidAmountPaise`).
- **Messages Sent & Received**: Real inbound/outbound messages across WhatsApp, Instagram, and Facebook.
- **Ad Spend & Attributed Revenue**: Real rupee figures recorded in **Ads & Social Posts** (`/campaigns`).

---

## Step 1 — Choosing Your Comparison Time Window (`/analytics`)

1. Open **Detailed Analytics** (`/analytics`) in the left sidebar.
2. In the top-right period selector, click the window you want to inspect:
   - **`7d`** — Weekly operational pulse (collections & team reply speed this week).
   - **`30d`** — Monthly cashflow & marketing ROAS review (default).
   - **`90d`** — Quarterly GST & seasonal comparison.
   - **`365d` / `All`** — Full financial year overview.
3. All KPI cards, daily trend bars, channel breakdowns, and export links immediately update to match your selected window.

---

## Step 2 — Acting on Tally Prime Receivable Aging Buckets

Scroll to **Pending Tally Receivables Aging** on `/analytics` (or `/` **Business Overview**):

1. Review how unpaid customer bills split across the four standard accounting aging buckets:
   - **`0 – 30 Days` (Current)**: Newly issued bills within normal credit period.
   - **`31 – 60 Days` (Follow-Up Needed)**: Send a polite 1st WhatsApp payment reminder.
   - **`61 – 90 Days` (Escalated)**: Call the party's accounts team and attach the exact Tally PDF invoice on WhatsApp.
   - **`90+ Days` (Critical Overdue)**: High-priority recovery — review party credit limit in Tally Prime before dispatching new credit orders.
2. To send instant reminders on overdue bills: click **Tally Prime & Bills** (`/tally`) or use the **1-Click Send WhatsApp Reminder** action directly in the Overdue Bills list on **Business Overview** (`/`).

---

## Step 3 — Reading the Customer Funnel & Channel ROI Table

1. **Customer Conversion Funnel**: Shows how contacts progress from **Total Contacts -> Opted-In Audience -> Engaged Conversations -> Billed Customers -> Collected Receipts**, highlighting where leads drop off.
2. **Channel-by-Channel Breakdown**: Compares message volume, ad spend (`₹`), linked sales (`₹`), and **Return per ₹1 Spent (`ROAS`)** across WhatsApp, Meta (Facebook/Instagram), Google, and Direct/Tally so you invest marketing budget only where real collections happen.

---

## Step 4 — Downloading Excel CSV & Printable Management PDF Reports

At the top right of **Detailed Analytics** (`/analytics`):

1. Click **Download CSV Report** to save a clean UTF-8 spreadsheet compatible with Microsoft Excel, Google Sheets, and CA audit workpapers.
2. Click **Download PDF Report** (`/api/pdf/analytics?range=30d`) to generate an executive A4 management summary PDF with your business name, date range, cashflow KPIs, and receivable aging table ready to share on WhatsApp or email with partners.
   - *(Tip: You can also download a dedicated **Tally Pending Receivables PDF** from **Tally Prime & Bills** and a **Wallet Passbook Statement PDF** from **Plans & Wallet**)*
