# Staff SOP 3 — RapidShift Labs Google OAuth Consent Screen & Database-Controlled API Credentials

> Staff Reference Only — Super Admin Standard Operating Procedure (`admin.rapidshiftlabs.in/credentials`).

## 1. Why RapidShift Labs Uses One Central OAuth Consent Screen (NEVER Service Account JSONs!)

When setting up Google integrations inside `console.cloud.google.com`, Google displays two very different credential options:

- **WRONG — Service Account (`"type": "service_account"`)**:
  - Creates a headless robot email (`...@....iam.gserviceaccount.com`) with **0 GB personal Google Drive storage quota**.
  - Cannot display Google's **"Sign in with Google"** consent screen to customers.
  - Forces customers to manually create folders, share permissions with a robot email, and copy obscure Folder IDs — causing constant errors.
- **RIGHT — OAuth 2.0 Client ID (`Application type: Web application`)**:
  - Configured **once** by RapidShift Labs Super Admin in `Staff Portal -> OAuth & API Credentials` (`/credentials`).
  - Displays Google's official **"Sign in with Google — Continue to RapidShift Labs"** screen to every customer.
  - Requests only the **non-sensitive** `https://www.googleapis.com/auth/drive.file` scope (only accesses the `RapidShift Labs Backups` folder created by the app — **no paid Google CASA security audit required!**).
  - Automatically creates `RapidShift Labs Backups` inside each customer's own Google Drive and uploads encrypted `.rslbackup` snapshots automatically!

---

## 2. Minute-by-Minute Admin Setup in Google Cloud Console (One-Time Setup)

Open `https://console.cloud.google.com` in one tab and `https://admin.rapidshiftlabs.in/credentials` in another tab:

1. **Create or Select the Platform GCP Project**:
   - Click the project dropdown in the top-left bar of Google Cloud Console -> click **New Project**.
   - Enter **Project name**: `RapidShift Labs` -> click **Create** -> select `RapidShift Labs` in the project dropdown.
2. **Enable Google Drive API (Mandatory)**:
   - Left menu -> **APIs & Services -> Library**.
   - Search **`Google Drive API`** -> click **Google Drive API** -> click the blue **Enable** button.
   - *(Optional — if also enabling 1-click Google Business Profile Reviews)*: Also search and enable **My Business Account Management API**, **My Business Business Information API**, and **Google My Business API** (and submit Google's GBP API quota form so QPM > 0).
3. **Configure the "RapidShift Labs" OAuth Consent Screen Branding**:
   - Left menu -> **APIs & Services -> OAuth consent screen** (or **Google Auth Platform -> Branding**).
   - Select **User Type: External** -> click **Create / Get started**.
   - **App Information**:
     - **App name**: `RapidShift Labs`
     - **User support email**: select your founder/support email.
   - **App Domain**:
     - **Application home page**: `https://rapidshiftlabs.in` (or `https://app.rapidshiftlabs.in`)
     - **Application privacy policy link**: `https://rapidshiftlabs.in/privacy`
     - **Application terms of service link**: `https://rapidshiftlabs.in/terms`
   - **Authorized domains**: click **+ Add domain** and enter `rapidshiftlabs.in`.
   - **Developer contact information**: enter your founder email -> click **Save and continue**.
4. **Add the Non-Sensitive `drive.file` Scope**:
   - Open **Data Access / Scopes -> Add or remove scopes**.
   - Tick:
     - `openid`
     - `.../auth/userinfo.email`
     - `.../auth/userinfo.profile`
     - `https://www.googleapis.com/auth/drive.file` (*"See, edit, create, and delete only the specific Google Drive files you use with this app"*)
   - Click **Update** -> **Save and continue**.
5. **Click "PUBLISH APP" to Move from Testing to Production (Critical!)**:
   - Open **Audience** (under Google Auth Platform / OAuth consent screen).
   - Under **Publishing status**, click **PUBLISH APP -> Confirm** so status reads **In production**.
   - *Why this matters*: Apps left in **Testing** mode block any customer email not manually typed into Test Users AND force Google refresh tokens to expire every **7 days**! Because `drive.file` is a non-sensitive scope, publishing to **In production** works immediately without a paid security audit.
6. **Create the Web Application OAuth Client ID & Save in Admin Portal**:
   - Left menu -> **APIs & Services -> Credentials -> + Create Credentials -> OAuth client ID**.
   - **Application type**: choose **`Web application`** *(never Service account or Desktop app!)*.
   - **Name**: `RapidShift Labs Web Portal`.
   - Under **Authorized JavaScript origins**, click **+ Add URI** and paste:
     `https://app.rapidshiftlabs.in`
   - Under **Authorized redirect URIs**, click **+ Add URI** and paste the exact callback URL:
     `https://app.rapidshiftlabs.in/api/oauth/google/callback`
   - Click **Create**.
   - Either click **Download JSON** (`client_secret_*.json`) and upload/paste it into **Section 1** of `https://admin.rapidshiftlabs.in/credentials`, OR copy the **Client ID** (`...apps.googleusercontent.com`) and **Client Secret** (`GOCSPX-...`) directly into Section 1 and click **Save Google OAuth Credentials in Database**.

---

## 3. Managing All Other Platform Credentials in `control.db` (`/credentials`)

All five platform-level credential vaults on `/credentials` are encrypted at rest using AES-256-GCM envelope keys (`KMS_MASTER_KEY`) inside `control.db` (`platform_credentials` table) and take effect across all PM2 services immediately without editing `.env` over SSH:

1. **Google OAuth 2.0 Web Client (`google_oauth`)**: Powers 1-click Google Drive backups (`/backups` & `/connections`) and 1-click Google Business Profile sign-in.
2. **Outbound Transactional SMTP (`smtp_email`)**: Powers OTP verification codes, password resets, 7-day team invites, and billing emails. For Gmail / Google Workspace:
   - Enable 2-Step Verification on your Google account -> open `myaccount.google.com/apppasswords` -> generate a 16-character App Password -> enter Host `smtp.gmail.com`, Port `465`, Implicit TLS `ON`, and click **Send Live Test Email** to verify delivery.
3. **Managed Cloud Storage — Cloudflare R2 (`cloudflare_r2`)**: Powers the `RSL Managed Cloud Storage` paid plan tier (`rsl_managed`). Enter Account ID, R2 Access Key ID, Secret Access Key, and Private Bucket Name.
4. **Meta / WhatsApp Cloud Platform App (`meta_app`)**: Stores the platform Meta App ID & App Secret used to verify `X-Hub-Signature-256` HMAC headers on incoming WhatsApp, Instagram, and Facebook webhooks.
5. **Razorpay Automated Checkout (`razorpay`)**: Optional Key ID, Key Secret, and Webhook Secret for instant automated wallet checkout alongside zero-fee manual UPI QR / UTR verification.
