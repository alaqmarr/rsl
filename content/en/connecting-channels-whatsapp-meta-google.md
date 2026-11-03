---
title: Connecting WhatsApp Cloud API, Instagram, Facebook, Meta Pixel & Google
summary: Complete minute-by-minute instructions for Meta App Dashboard, Meta Business Settings System Users, Permanent Tokens, Webhook Verify Tokens, Instagram DM controls, Google Business Profile APIs, and Google Drive backups.
section: Getting Started
audience: customer
order: 2
lastReviewed: 2026-11-03
---

## Overview & Golden Rule Against Expired Tokens

Every external channel connection is managed in **Connected Channels** (`/connections`). Before pasting any token from Meta or Google, keep one critical rule in mind:

> **Never Paste Meta's 24-Hour Temporary Token:** The token shown inside `developers.facebook.com -> WhatsApp -> API Setup` expires automatically after **24 hours** (`OAuthException Code 190`). Always generate a **Permanent System User Token** (`Expiration: Never`) inside `business.facebook.com/settings` using the exact steps below.

---

## Part 1 — Connecting Official WhatsApp Business Cloud API (Every Meta Click)

### A. Create & Configure Your Meta Business App

1. Sign in to `https://developers.facebook.com/apps` using your Facebook account that owns your Meta Business Portfolio.
2. Click **Create App** (top right):
   - Select **Other** -> click **Next**.
   - Select app type **Business** -> click **Next**.
   - Enter **App Name** (for example `Shree Traders WhatsApp Suite`), enter your **App Contact Email**, select your **Business Portfolio** from the dropdown, and click **Create App**.
3. On the **Add products to your app** screen, scroll to **WhatsApp** and click **Set up**.
4. In the left sidebar of Meta App Dashboard, click **App Settings -> Basic**:
   - Under **App Domains**, type `rapidshiftlabs.in` and `app.rapidshiftlabs.in`.
   - Under **Privacy Policy URL**, enter your company's HTTPS privacy policy URL (for example `https://rapidshiftlabs.in/privacy`) and under **Terms of Service URL** enter your terms URL.
   - Choose **Category: Business and Pages**, then click **Save changes** at the bottom right.

### B. Copy Your 15-Digit Phone Number ID & WABA ID

1. In Meta App Dashboard left sidebar, click **WhatsApp -> API Setup** (or **WhatsApp -> Quickstart -> API Setup**).
2. Under **Step 1: Select phone numbers**, choose your registered business phone number in the **From** dropdown (to add a real SIM/landline number instead of Meta's test number, scroll down and click **Add phone number**, verify your display name, and enter the 6-digit SMS/Voice OTP).
3. Directly below the **From** dropdown, copy two numbers carefully:
   - **Phone number ID** (a 15-digit number like `109283746519283` — **do NOT enter your `+91...` 10-digit mobile number here!**).
   - **WhatsApp Business Account ID (WABA ID)** (a 15-to-16-digit number right next to it, like `118293049581726`).
4. **If testing while Meta App is still in Development Mode:** Under the **To** field, click **Manage phone number list -> Add phone number**, enter up to 5 test mobile numbers with country code `+91`, and verify via OTP. (This prevents Meta Error `#131030: Recipient phone number not in allowed list`.)

### C. Generate a Permanent Never-Expiring System User Token

1. Open `https://business.facebook.com/settings` (Meta Business Settings) in a new browser tab.
2. In the left menu under **Users**, click **System users** -> click the blue **Add** button:
   - If prompted, accept Meta's Non-Discrimination Policy.
   - Enter **System user name**: `RSL Marketing Server`.
   - Select **System user role**: **Admin** (must be Admin, not Employee).
   - Click **Create system user**.
3. Select `RSL Marketing Server` in the list and click **Assign assets**:
   - Click **Apps** in the left column -> tick your Meta App -> toggle ON **Manage app (Full control)**.
   - Click **WhatsApp accounts** in the left column -> tick your WhatsApp Business Account -> toggle ON **Manage WhatsApp account (Full control)**.
   - Click **Save changes** -> **Done**.
4. Click **Generate new token** (top right of the System User panel):
   - **Select app**: pick your Meta App from the dropdown.
   - **Set token expiration**: select **Never** (critical!).
   - Scroll through **Permissions** and tick all three checkboxes:
     - `whatsapp_business_messaging`
     - `whatsapp_business_management`
     - `business_management`
   - Click **Generate token**, copy the entire `EAA...` string immediately, and keep it ready.

### D. Attach a Billing Card in Meta & Switch App to Live Mode

1. Still inside `business.facebook.com/settings`, click **Billing & payments** (or **Accounts -> WhatsApp accounts -> Settings -> Payment Settings**) and attach a valid Visa/Mastercard with international/recurring transactions enabled. (Without a card attached on Meta's side, Meta blocks outbound template messages with Error `#131042: Business eligibility payment issue`.)
2. Return to `developers.facebook.com/apps`, open your app, and flip the top header switch from **App Mode: Development** to **Live**.

### E. Paste Credentials in RapidShift Labs & Verify Meta Webhook

1. Open `https://app.rapidshiftlabs.in/connections` (**Connected Channels**) and select the **WhatsApp Cloud API** tab.
2. Copy the two values shown in the **Inbound Webhook Verification** box on the left:
   - **WhatsApp Callback URL**: `https://app.rapidshiftlabs.in/api/webhooks/whatsapp`
   - **Webhook Verify Token**: `rsl_verify_...` (click **Copy**).
3. In Meta App Dashboard, go to **WhatsApp -> Configuration** -> under **Webhook**, click **Edit**:
   - Paste **Callback URL** (`https://app.rapidshiftlabs.in/api/webhooks/whatsapp`).
   - Paste **Verify token** (`rsl_verify_...`).
   - Click **Verify and save** (Meta immediately sends a `GET` challenge to RapidShift Labs and turns green).
4. Still under **Webhook**, click **Manage** (or **Webhook fields**) and click **Subscribe** next to both:
   - `messages` (delivers incoming customer WhatsApp replies & `STOP` opt-outs to your Shared Inbox)
   - `message_template_status_update` (updates template approval status automatically)
5. Back in RapidShift Labs **Connected Channels**, fill in the right-hand form:
   - **Connection Label**: e.g. `Main Billing WhatsApp (+91 98200 XXXXX)`
   - **Phone Number ID**: paste your 15-digit Phone Number ID
   - **WABA ID**: paste your 15-digit WhatsApp Business Account ID
   - **Permanent Access Token**: paste your `EAA...` System User token
   - Keep **Run live API check immediately after saving** checked and click **Connect WhatsApp Cloud API**.
6. Confirm the connection card appears below with a green **Healthy** pill!

---

## Part 2 — Connecting Instagram Business (DMs, Comments & Scheduled Posts)

1. **Convert to Professional Account & Link Facebook Page**:
   - On your phone's Instagram app, open **Profile -> Edit profile -> Switch to professional account -> Business**.
   - Link it to your company's Facebook Page (`Edit profile -> Page -> Connect or create`).
2. **Turn ON "Allow Access to Messages" on Mobile (Most Skipped Step!)**:
   - Open the **Instagram mobile app** on your phone (this setting does NOT exist on desktop!).
   - Tap the top-right **Menu (☰) -> Settings and activity -> Messages and story replies -> Message controls -> Connected tools**.
   - Toggle **Allow access to messages** to **ON**. *(If left OFF, Meta silently drops 100% of Instagram DM webhooks!)*
3. **Assign Assets & Generate Permanent Token**:
   - In `business.facebook.com/settings -> Users -> System users`, select `RSL Marketing Server` -> **Assign assets**.
   - Under **Pages**, select your linked Facebook Page -> toggle **Full control**.
   - Under **Instagram accounts**, select your Instagram account -> toggle **Full control** -> click **Save changes**.
   - Click **Generate new token** (`Expiration: Never`) with permissions: `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`.
4. **Find Your Numeric 17-Digit Instagram Business Account ID**:
   - Open `https://developers.facebook.com/tools/explorer`, paste your token, and run `GET /v21.0/me/accounts?fields=name,instagram_business_account`.
   - Copy the numeric `instagram_business_account.id` (looks like `17841405822304914` — **never enter `@yourhandle`**).
5. **Verify Meta Webhook & Save in RapidShift Labs**:
   - In Meta App Dashboard -> **Webhooks**, choose **Instagram** from the top dropdown, click **Subscribe to this object**, paste **Meta Callback URL** (`https://app.rapidshiftlabs.in/api/webhooks/meta`) and your **Webhook Verify Token**, and subscribe to `messages`, `messaging_postbacks`, and `comments`.
   - In RapidShift Labs `/connections` -> **Instagram Business**, enter a **Connection Label**, **17-Digit IG Business Account ID**, linked **Facebook Page ID**, and **Permanent Access Token**, then click **Connect Instagram Business**.

---

## Part 3 — Connecting Facebook Page & Messenger

1. Open your Facebook Page -> **About -> Page transparency** and copy your numeric **Page ID**.
2. In `business.facebook.com/settings -> System users -> Assign assets -> Pages`, ensure `RSL Marketing Server` has **Full control** on that Page.
3. Generate a System User token (`Expiration: Never`) with `pages_show_list`, `pages_messaging`, `pages_manage_posts`, `pages_read_engagement`, and `pages_manage_metadata`, then call `GET /v21.0/me/accounts` in Graph API Explorer and copy the **Page-specific `access_token`** returned inside `data[]` for your Page.
4. On your Facebook Page -> **Settings -> New Pages Experience -> Advanced Messaging -> Handover Protocol**, set your Meta App as **Primary Receiver**.
5. In Meta App Dashboard -> **Webhooks -> Page**, verify `https://app.rapidshiftlabs.in/api/webhooks/meta` with your **Verify Token** and subscribe to `messages`, `messaging_postbacks`, and `feed`.
6. Paste the **Page ID** and **Page Access Token** under `/connections -> Facebook Page` and click **Connect Facebook Page**.

---

## Part 4 — Connecting Meta Ads & Conversions API Pixel

1. In `business.facebook.com/settings -> System users -> Assign assets`:
   - Under **Ad accounts**, select your Ad Account -> enable **Manage campaigns**.
   - Under **Datasets / Pixels**, select your Website Pixel -> enable **Manage events**.
2. Generate a System User token (`Expiration: Never`) with `ads_read`, `ads_management`, and `business_management`.
3. Copy your **Ad Account ID** and ensure it starts with `act_` (for example `act_293847561029384`), plus your 15-to-16-digit **Dataset / Pixel ID**.
4. In `/connections -> Meta Ads & Pixel`, paste your `act_...` Ad Account ID, Pixel ID, and token, then click **Connect Meta Ads & Pixel**.

---

## Part 5 — Connecting Google Business Profile (1-Click Google Sign-In)

> **No Google Cloud Console or Service Account JSON Needed!** RapidShift Labs provides a direct **"Sign in with Google"** consent screen so you never have to create GCP projects, Service Account JSON keys, or manual OAuth tokens.

1. Open `https://app.rapidshiftlabs.in/connections` (**Connected Channels**) and click the **Google Business** tab at the top.
2. Click the green **Sign in with Google Business Profile →** button.
3. On Google's official sign-in screen (`accounts.google.com`), pick the Google account that owns or manages your verified **Google Business Profile** store listing.
4. Review the **RapidShift Labs** permission prompt (`business.manage` — to read customer reviews and publish owner replies) and click **Continue / Allow**.
5. You are redirected straight back to RapidShift Labs with a green **Healthy** connection card, auto-renewing refresh token, and your primary Storefront Location ID linked automatically!
   - *Managing multiple store branches?* Click **Rotate Token / Edit** on the connected card below if you want to specify a particular `locations/...` branch ID.

---

## Part 6 — Connecting Google Drive Off-Site Backup Vault (1-Click Google Sign-In)

1. Open either **Backups & Storage** (`/backups`) or **Connected Channels** (`/connections -> Google Drive`).
2. Click **Connect Google Drive with Google →** (do **not** create or upload any Google Service Account JSON file!).
3. Sign in with the Gmail or Google Workspace account where you want encrypted off-site backups stored and click **Allow** on the **RapidShift Labs** consent screen:
   - RapidShift Labs requests **only** Google's privacy-safe `https://www.googleapis.com/auth/drive.file` permission. It can **only** access the backup folder it creates and can **never** see, list, or read any other personal or company files in your Google Drive.
4. RapidShift Labs **automatically creates a `RapidShift Labs Backups` folder** inside your Google Drive (no manual Folder ID copying required!).
5. Every time you click **Create Backup Now** on `/backups`, your encrypted `.rslbackup` snapshot is both downloadable in your browser and **uploaded automatically into your Google Drive folder**!

---

## Rotating or Testing Tokens Later

- You can test any connected channel at any time by clicking **Test Live API** on its card in `/connections` or inside **All API Tokens** (`/settings/tokens`).
- If you rotate your **Webhook Verify Token**, remember to update the matching Verify Token inside Meta App Dashboard -> **Webhooks** immediately afterward.
