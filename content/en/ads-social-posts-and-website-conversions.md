---
title: Meta Ad Campaigns, Scheduled Social Posts & Website Sales Tracking
summary: Minute-by-minute instructions to track Facebook and Instagram ad budgets against real sales, schedule social media posts with media attachments, and log deduplicated Website Pixel checkout conversions.
section: Daily Operations
audience: customer
service: meta.ads
order: 8
lastReviewed: 2026-11-03
---

## Overview — Real Rupee ROAS Instead of Vanity Likes

Open **Ads & Social Posts** (`/campaigns`) in your left sidebar to manage three connected growth workflows in one screen:

1. **Paid Ad Campaigns & ROAS Tracking** (Facebook Ads, Instagram Ads, Google Ads)
2. **Scheduled Organic Social Posts** (Facebook Business Page & Instagram Business Account)
3. **Deduplicated Website Conversion / Pixel Events** (Server-side Conversions API tracking)

---

## Part 1 — Creating Ad Campaigns & Tracking Return per ₹1 Spent (ROAS)

1. Open **Ads & Social Posts** (`/campaigns`). *(Requires **Meta Ads & Campaign Attribution** unlocked in **Plans & Wallet**.)*
2. Locate the **Create Ad Campaign** card:
   - **Campaign Name**: Enter a clear title (for example `Diwali Wholesale Dealers Lead Ad — Gujarat`).
   - **Channel / Platform**: Select `Meta (Facebook & Instagram)` or `Google`.
   - **Objective**: Select `Leads / WhatsApp Inquiries`, `Website Sales`, or `Catalog Traffic`.
   - **Daily Budget (₹)**: Enter your daily rupee spend limit (e.g. `1500`).
   - Click **Create Campaign**.
3. **Logging Spend & Linked Sales to Compute Exact ROAS**:
   - In the **Active Campaigns** table (or **Record Campaign Performance** form), select your campaign, enter **Ad Spend (₹)**, **Impressions / Clicks / Leads**, and **Attributed Sales Revenue (₹)**, then click **Record Metrics**.
   - RapidShift automatically calculates **Return on Ad Spend (ROAS)** — e.g. `4.2x` (`₹4.20` collected for every `₹1.00` spent) — and feeds it directly into **Detailed Analytics** (`/analytics`).
4. **Pausing or Completing a Campaign**: Use the status action on any campaign row to switch between `Active` and `Paused` as budgets change.

---

## Part 2 — Scheduling Facebook Page & Instagram Business Posts

*(Requires **Social Media Post Scheduler** unlocked and your Facebook Page / Instagram Business account connected in **Connected Channels**.)*

1. Scroll to **Schedule a Social Post** on `/campaigns`.
2. **Select Destination Channel(s)**: Choose your connected **Facebook Page** or **Instagram Business** profile.
3. **Post Caption**: Write your post copy including hashtags, offer details, or WhatsApp contact CTA.
4. **Media Attachment URL**:
   - For **Instagram Business**, Meta's Graph API requires a publicly reachable HTTPS image/video URL (JPEG/PNG/MP4) — paste your product image URL in **Media URL**.
   - For **Facebook Pages**, you can publish either text posts or image/link posts.
5. **Publish Timing**:
   - Pick the exact **Scheduled Date & Time (IST)** in the date-time picker (or set the current time to queue immediate publishing).
6. Click **Schedule Post**:
   - Your post appears in the **Scheduled & Published Posts** queue with status **`Scheduled`**.
   - At the scheduled minute, `rsl-worker` publishes it via Meta Graph API and updates the badge to **`Published`** (along with the external Meta post ID).

---

## Part 3 — Recording Website Checkout / Pixel Sales Without Double Counting

When a customer buys on your website (Shopify, WooCommerce, or custom checkout), both browser pixels and server webhooks can fire for the same order. RapidShift prevents duplicate revenue counting using unique **Event / Order IDs**:

1. Scroll to **Record Website Conversion / Pixel Event** on `/campaigns`.
2. Fill in the order details:
   - **Event Type**: Select `Purchase`, `Lead`, or `InitiateCheckout`.
   - **Unique Event / Order ID**: Enter your store's exact order number (for example `ORD-2026-8841`). **If the same `ORD-2026-8841` is submitted twice, RapidShift automatically deduplicates it so revenue is never counted twice.**
   - **Order Amount (₹)**: Enter the rupee value (e.g. `4250`).
   - **Customer Phone / Email**: Optional (hashed with SHA-256 when forwarding to Meta Conversions API for ad attribution matching).
   - **Linked Campaign (Optional)**: Attribute this order directly to a specific ad campaign.
3. Click **Record Conversion Event**.
