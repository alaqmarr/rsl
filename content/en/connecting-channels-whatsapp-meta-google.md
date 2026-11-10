---
title: Connecting WhatsApp Cloud API, Meta (Instagram, Facebook, Ads) & Google (2026 Guide)
summary: Up-to-date 2026 reference for 1-Click Google Auth Platform, Google Cloud Console Ads API Access Levels (Test, Explorer & Standard without Developer Tokens), Meta Developer Console Use Cases, Facebook Login for Business Configurations, and WhatsApp Embedded Signup.
section: Getting Started
audience: customer
order: 2
lastReviewed: 2026-11-10
---

## 1. Customer 1-Click Connections vs. Platform Setup

In RapidShift Labs (`/connections`), business owners connect every channel in **1 click** using official OAuth 2.0 popups:

- **Google 1-Click Sign-In**: Connects **Google Drive Off-Site Backups** (`drive.file`), **Google Business Profile** (`business.manage`), **Google Sheets**, **Google Search Console**, and **Google Ads** (`adwords`) without creating any GCP project or Service Account JSON key.
- **Meta 1-Click Login for Business & WhatsApp Embedded Signup**: Connects **WhatsApp Business Cloud API**, **Instagram Business**, **Facebook Pages**, and **Meta Ads & Conversions API Pixels** directly from your Meta Business Portfolio.

If you are configuring your own dedicated Google Cloud Project or Meta Business App (or managing the RapidShift Labs Super Admin Vault at `/credentials`), follow the updated **2026 Google Cloud Console** and **2026 Meta Developer Console** instructions below.

---

## 2. Google Cloud Console Setup (2026 Google Auth Platform)

Google replaced the legacy "OAuth consent screen" menu with **Google Auth Platform** (`Overview`, `Branding`, `Audience`, `Data Access`, and `Clients`) and moved **Google Ads API access levels** directly into **Google Cloud Console** (retiring legacy Developer Tokens).

### Step A: Enable Required APIs in Google Cloud Console

1. Sign in to `https://console.cloud.google.com` with `app@rapidshiftlabs.in` and select your project (**RapidShift Labs**).
2. Open **APIs & Services -> Library** and enable:
   - **Google Drive API** (for encrypted `.rslbackup` vault uploads via `drive.file`)
   - **Google Sheets API** (for live financial & campaign sheet exports)
   - **Google Search Console API** (for verified domain search analytics)
   - **My Business Account Management API** and **My Business Business Information API** (for Google Business Profile locations & review replies)
   - **Google Ads API** (for live Google Ads campaign sync and ROAS attribution)

### Step B: Configure Google Auth Platform -> Branding & Audience

1. In the left navigation of Google Cloud Console, open **Google Auth Platform -> Branding**:
   - **App name**: `RapidShift Labs`
   - **User support email**: `app@rapidshiftlabs.in`
   - **App logo**: Upload the official RapidShift Labs square mark (120x120 px PNG).
   - **Application home page**: `https://app.rapidshiftlabs.in`
   - **Application privacy policy link**: `https://app.rapidshiftlabs.in/privacy`
   - **Application terms of service link**: `https://app.rapidshiftlabs.in/terms`
   - **Authorized domains**: Add `rapidshiftlabs.in`
   - **Developer contact information**: `app@rapidshiftlabs.in`
   - Click **Save**.
2. Open **Google Auth Platform -> Audience**:
   - Set **User type** to **External**.
   - Click **Publish App** so **Publishing status** changes from `Testing` to **`In production`**. *(Leaving an app in `Testing` causes Google to expire refresh tokens every 7 days.)*

### Step C: Configure Google Auth Platform -> Data Access (Scopes)

1. Open **Google Auth Platform -> Data Access** and click **Add or remove scopes**.
2. Add the following scopes and click **Update -> Save**:
   - `openid`, `email`, `profile`
   - `https://www.googleapis.com/auth/drive.file` *(Non-sensitive per-file scope; accesses only the `RapidShift Labs Backups` folder created by the app and requires zero CASA security audit)*
   - `https://www.googleapis.com/auth/spreadsheets`
   - `https://www.googleapis.com/auth/webmasters.readonly`
   - `https://www.googleapis.com/auth/business.manage`
   - `https://www.googleapis.com/auth/adwords`

### Step D: Create Web Application Client in Google Auth Platform -> Clients

1. Open **Google Auth Platform -> Clients** and click **+ Create Client**.
2. Select **Application type**: **`Web application`** *(Never select Service Account; Service Accounts have 0 GB Drive quota and cannot render 1-Click Sign in with Google)*.
3. Enter **Name**: `RapidShift Labs Web OAuth Client`.
4. Under **Authorized JavaScript origins**, add:
   - `https://app.rapidshiftlabs.in`
5. Under **Authorized redirect URIs**, add:
   - `https://app.rapidshiftlabs.in/api/oauth/google/callback`
6. Click **Create**, download the `client_secret_*.json` file, and upload it in **Admin Console -> Credentials -> Section 1 (Google Cloud OAuth 2.0)**.

---

## 3. Google Ads API Access in Google Cloud Console (No Developer Token Required)

In 2025/2026, Google Ads API retired Developer Tokens for new integrations:

- **Developer tokens are no longer required** for calling the Google Ads API.
- **API access levels are managed exclusively in the Google Cloud Console** (`APIs & Services -> Google Ads API`).

### Understanding Google Cloud Console Access Levels

| Access Level | Daily Quota & Scope | When to Use |
| --- | --- | --- |
| **Test** *(Default on enablement)* | **15,000 daily API operations** on Google Ads **Test Accounts**, developer sandboxing, and test environment access | Immediate integration testing against a Google Ads Test Manager account before production approval |
| **Explorer** *(Next upgrade level)* | **2,880 daily API operations** on **Production Google Ads accounts** | Suitable for developing, testing, and operating live production Google Ads accounts |
| **Standard** | **Unlimited daily API operations** on Production Google Ads accounts | High-volume multi-client production agencies and SaaS platforms |

### How to Upgrade from Test to Explorer Access (And Fix "Not Approved" Notices)

If you open **Google Cloud Console -> APIs & Services -> Google Ads API** and see **Current access level: Test** or the banner **"Your application for explorer-level access was not approved"**, complete all four checks below before clicking **Apply for access** under **Upgrade access level -> Next access level: Explorer**:

1. **Verify Your Corporate Contact Email in Google Ads API Center**:
   - Even though access levels moved to Google Cloud Console, open your Google Ads Manager (MCC) account -> **Tools -> API Center** and ensure the **API contact email** is set to your corporate workspace email (`app@rapidshiftlabs.in`, never a personal `@gmail.com` address) and verify any confirmation link sent by Google.
2. **Link an Active Google Cloud Billing Account**:
   - In Google Cloud Console -> **Billing**, verify that your project is linked to an active, valid Billing Account. Google's automated compliance check rejects Explorer applications on unbilled Cloud projects.
3. **Complete Live Branding & Legal URLs in Google Auth Platform**:
   - Confirm that `https://app.rapidshiftlabs.in`, `https://app.rapidshiftlabs.in/privacy`, and `https://app.rapidshiftlabs.in/terms` return HTTP `200 OK` publicly and match the **Authorized domain** (`rapidshiftlabs.in`) in **Google Auth Platform -> Branding**.
4. **Provide Specific Production Use-Case Details on Re-Application**:
   - When clicking **Apply for access** for **Explorer**, clearly describe the integration: *"RapidShift Labs is a multi-tenant business marketing and accounting platform (rapidshiftlabs.in) used by verified Indian SMBs to authenticate their own Google Ads accounts via OAuth 2.0, view daily campaign spend/clicks/conversions, and manage campaign budgets."*

---

## 4. Meta Developer Console Setup (2026 Use Cases & Login for Business)

Meta's 2026 App Dashboard replaces the legacy "Add Product" grid with **Use Cases**, **Facebook Login for Business Configurations**, and **WhatsApp Embedded Signup**.

### Step A: Create Your Meta App with Use Cases

1. Sign in to `https://developers.facebook.com/apps` and click **Create App**.
2. Select your verified **Meta Business Portfolio** (Business Manager).
3. On the **Use cases** step, select **Authenticate and request data from users with Facebook Login** (or **Other -> Business**) and name the app **`RapidShift Labs`**, with contact email `app@rapidshiftlabs.in`.
4. In the left sidebar, click **Use cases -> Add use cases** and attach:
   - **Facebook Login for Business** (OAuth 2.0 onboarding & System User token issuance)
   - **WhatsApp** (Official WhatsApp Business Cloud API & Embedded Signup)
   - **Marketing API** (Meta Ads, Ad Accounts `act_...`, and Conversions API Pixels)
   - **Manage messaging & content on Instagram** (Instagram Business DMs, comments, and scheduled Reels/posts)
   - **Manage everything on your Page** (Facebook Page posts, Messenger inbox, and Lead Ads `leadgen`)

### Step B: Configure App Settings -> Basic & OAuth Redirect URIs

1. Open **App Settings -> Basic**:
   - **App Domains**: `rapidshiftlabs.in` and `app.rapidshiftlabs.in`
   - **Contact Email**: `app@rapidshiftlabs.in`
   - **Privacy Policy URL**: `https://app.rapidshiftlabs.in/privacy`
   - **Terms of Service URL**: `https://app.rapidshiftlabs.in/terms`
   - **User Data Deletion**: `https://app.rapidshiftlabs.in/data-deletion`
   - Click **Save changes**.
2. Open **Use cases -> Facebook Login for Business -> Settings**:
   - Toggle ON **Client OAuth login**, **Web OAuth login**, **Enforce HTTPS**, and **Embedded Browser OAuth Login**.
   - Under **Valid OAuth Redirect URIs**, add:
     - `https://app.rapidshiftlabs.in/api/oauth/meta/callback`
   - Under **Allowed Domains for the JavaScript SDK**, add:
     - `https://app.rapidshiftlabs.in`
   - Click **Save changes**.

### Step C: Create Facebook Login for Business Configurations (`config_id`)

1. Open **Facebook Login for Business -> Configurations** and click **+ Create configuration**:
   - **Configuration 1 (Full Business Suite OAuth)**:
     - **Name**: `RapidShift Labs Business Suite`
     - **Login variation**: `General`
     - **Access token**: `System-user access token` (Never expires)
     - **Assets & Permissions**: Select `public_profile`, `business_management`, `ads_management`, `ads_read`, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_ads`, `pages_messaging`, `leads_retrieval`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_messages`, `whatsapp_business_management`, `whatsapp_business_messaging`.
   - **Configuration 2 (WhatsApp Embedded Signup)**:
     - **Name**: `RapidShift Labs WhatsApp Embedded Signup`
     - **Login variation**: `WhatsApp Embedded Signup`
     - **Permissions**: `whatsapp_business_management`, `whatsapp_business_messaging`, `business_management`.
2. Copy the generated numeric **Configuration IDs** and paste them into **Admin Console -> Credentials -> Section 4 (Meta & WhatsApp App)**.

### Step D: Subscribe Meta & WhatsApp Webhooks

1. **Meta Pages, Instagram & Lead Ads Webhook**:
   - Callback URL: `https://app.rapidshiftlabs.in/api/webhooks/meta`
   - Verify Token: Your workspace or global Verify Token (`rsl_verify_...`)
   - Subscribed fields:
     - **Page**: `messages`, `messaging_postbacks`, `feed`, `leadgen`
     - **Instagram**: `messages`, `messaging_postbacks`, `comments`
2. **WhatsApp Business Account Webhook**:
   - Callback URL: `https://app.rapidshiftlabs.in/api/webhooks/whatsapp`
   - Verify Token: `rsl_verify_...`
   - Subscribed fields: `messages`, `message_template_status_update`, `account_update`
3. **Instagram Mobile Message Control Check**:
   - In the Instagram mobile app on your phone, open **Settings and activity -> Messages and story replies -> Message controls -> Connected tools** and toggle **Allow access to messages** to **ON** so Instagram DM webhooks are delivered.
