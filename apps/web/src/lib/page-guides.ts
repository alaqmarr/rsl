export interface PageWalkthroughStep {
  title: string;
  detail: string;
  tip?: string;
}

export interface WebPageGuide {
  routePrefix: string;
  exact?: boolean;
  title: string;
  summary: string;
  estimatedTime: string;
  guideSlug: string;
  prerequisites: string[];
  steps: PageWalkthroughStep[];
  commonMistakes: string[];
}

export const WEB_PAGE_GUIDES: WebPageGuide[] = [
  {
    routePrefix: "/",
    exact: true,
    title: "How to Use Your Business Overview & Daily Cashflow Pulse",
    summary:
      "Every rupee and message count on this screen comes directly from your real Tally Prime bills, payment receipts, and customer chats — never sample data.",
    estimatedTime: "3 min review",
    guideSlug: "getting-started",
    prerequisites: [
      "Complete your Business GST State & 15-character GSTIN in Business Settings so invoices calculate CGST/SGST vs IGST accurately.",
      "Unlock Tally Prime Sync or WhatsApp Business Messaging in Plans & Wallet to start seeing live automated bills and chats.",
    ],
    steps: [
      {
        title: "Check Your Quick Setup Progress Checklist First",
        detail:
          "Look at the Setup Progress bar in the left sidebar or top card. Click any incomplete milestone (GSTIN, Channel Connection, Approved WhatsApp Template, or Tally Sync) to jump straight to that setup screen.",
      },
      {
        title: "Compare Money Collected vs. Pending Customer Bills",
        detail:
          "Inspect the top KPI cards: 'Money Collected' reflects actual Tally Receipt vouchers and paid Sales bills, while 'Pending Customer Bills' totals unpaid non-cancelled Sales vouchers.",
      },
      {
        title: "Review Overdue Receivable Aging Buckets (0–30 to 90+ Days)",
        detail:
          "Check which unpaid party balances have crossed 31–60, 61–90, or 90+ days so your accounts team prioritizes high-risk collections first.",
      },
      {
        title: "Trigger 1-Click WhatsApp Payment Reminders on Overdue Bills",
        detail:
          "In the Overdue / Unpaid Bills list, click the reminder action next to any bill whose party has a valid +91 mobile number to queue an approved WhatsApp payment reminder immediately.",
        tip: "Your Prepaid Wallet includes an automatic -₹200.00 overdraft buffer so urgent reminders never fail if your wallet dips slightly below ₹0.",
      },
      {
        title: "Jump to Any Screen Instantaneously with Ctrl + K (or Cmd + K)",
        detail:
          "Press Ctrl + K anywhere in the portal (or click the top search bar) and type 'Tally', 'UTR', 'Template', or 'Backup' to jump directly to that workflow.",
      },
    ],
    commonMistakes: [
      "Expecting demo numbers on a brand-new account — figures remain ₹0 until you sync Tally Prime bills, import XML/CSV, or connect WhatsApp.",
      "Sending WhatsApp reminders before syncing at least one APPROVED template in WhatsApp & Templates.",
    ],
  },
  {
    routePrefix: "/analytics",
    title: "Reading Cashflow Analytics, Aging Buckets & Downloading Reports",
    summary:
      "Compare 7-day, 30-day, 90-day, 365-day, or All-Time collections, team response speed, conversion funnel stages, and return per ₹1 spent on ads.",
    estimatedTime: "4 min walkthrough",
    guideSlug: "analytics-cashflow-and-aging-reports",
    prerequisites: [
      "Synced or imported Tally Prime vouchers populate Cashflow & Aging metrics.",
      "Logged campaign spend and attributed sales in Ads & Social Posts populate ROAS metrics.",
    ],
    steps: [
      {
        title: "Select Your Time Window in the Top-Right Filter Bar",
        detail:
          "Click 7d (weekly check), 30d (monthly review), 90d (quarterly GST review), 365d, or All Time. Every KPI card, chart, and export button updates to match that exact window.",
      },
      {
        title: "Inspect Pending Tally Receivables Across Four Aging Buckets",
        detail:
          "Scroll to Pending Receivables Aging to see exact rupee totals and bill counts in 0–30 days (current), 31–60 days, 61–90 days, and 90+ days overdue.",
      },
      {
        title: "Audit Channel-by-Channel ROI & Conversion Funnel",
        detail:
          "Compare WhatsApp, Meta (Facebook/Instagram), and Google rows to verify how much actual revenue came back per ₹1 of ad spend (ROAS), and see where contacts drop off between Opted-In -> Engaged -> Billed -> Paid.",
      },
      {
        title: "Export UTF-8 CSV for Excel or Printable Management PDF",
        detail:
          "Click 'Download CSV Report' at the top right for Excel / Google Sheets analysis, or click 'Download PDF Report' to save a formatted A4 executive summary PDF.",
      },
    ],
    commonMistakes: [
      "Viewing the 7d window when looking for bills dated last month — switch to 90d, 365d, or All Time to include older Tally voucher dates.",
    ],
  },
  {
    routePrefix: "/inbox",
    title: "Using the Shared Team Inbox, 24-Hour Reply Window & Internal Notes",
    summary:
      "Reply to WhatsApp, Instagram, and Facebook inquiries in one shared workspace with automatic Meta 24-hour window enforcement and private team notes.",
    estimatedTime: "5 min setup",
    guideSlug: "shared-inbox-and-customer-messages",
    prerequisites: [
      "Unlock 'Unified Customer Inbox' in Plans & Wallet.",
      "Connect WhatsApp Cloud API, Instagram Business, or Facebook Page in Connected Channels and verify the Meta Webhook Callback URL.",
    ],
    steps: [
      {
        title: "Add a Customer Contact with Full +91 Mobile Number & Consent",
        detail:
          "Use 'Add Contact' to enter the customer's Party Name (matching Tally Prime if applicable), 10-digit Indian mobile (+9198XXXXXXXX), and keep WhatsApp Opt-In ticked if they consented.",
      },
      {
        title: "Filter Conversations by Channel, Status (Open / Resolved) or Label",
        detail:
          "Use the filter controls above the thread list to isolate unread WhatsApp billing replies, Instagram DMs, or threads tagged 'Payment Follow-Up'.",
      },
      {
        title: "Check the 24-Hour Customer Service Window Indicator Before Replying",
        detail:
          "When green ('24-Hour Window Open'), type any free-form reply and click Send. When amber ('24-Hour Window Closed'), Meta blocks plain text — switch to 'Send Approved Template', pick an APPROVED template, fill {{1}}..{{4}}, and send.",
        tip: "Use Saved Quick Replies in the composer to insert your bank details, GSTIN, or store address in 1 click.",
      },
      {
        title: "Switch to 'Internal Team Note' for Private Staff Hand-Offs",
        detail:
          "Toggle the composer to 'Internal Team Note' (amber mode) to leave notes like 'Customer promised NEFT by Friday'. Internal notes are 100% invisible to the customer and never leave your workspace.",
      },
      {
        title: "Tag Labels & Mark Threads Resolved When Settled",
        detail:
          "Apply a label (e.g. 'Awaiting UTR' or 'VIP Dealer') and mark completed threads 'Resolved'. If the customer messages again later, the thread automatically reopens.",
      },
    ],
    commonMistakes: [
      "Trying to send plain-text WhatsApp messages when more than 24 hours have passed since the customer's last incoming reply — always select an APPROVED template instead.",
      "Forgetting to subscribe to the 'messages' webhook field in Meta App Dashboard -> WhatsApp -> Configuration (required for incoming replies to appear).",
    ],
  },
  {
    routePrefix: "/tally",
    title: "Connecting Tally Prime (.tdl v2.6 + Port 9000) & Sending Exact Tally PDFs",
    summary:
      "Sync Tally Prime live without overwriting past bills, preserve your 100% untouched Tally-printed PDF invoice byte-for-byte, update stock automatically, and automate WhatsApp bills & reminders.",
    estimatedTime: "8 min setup",
    guideSlug: "tally-sync-and-import",
    prerequisites: [
      "Unlock 'Tally Prime Sync & Payment Reminders' (and 'WhatsApp Business Messaging' for automated WhatsApp delivery) in Plans & Wallet.",
      "Save each customer's 10-digit Mobile No. inside their Tally Prime Party Ledger (Gateway of Tally -> Alter -> Ledger -> press F12 -> Provide Contact Details: Yes -> Mobile no. -> Ctrl + A).",
    ],
    steps: [
      {
        title: "Step 1 — Verify Your Dedicated *.tally.rapidshiftlabs.in Endpoint",
        detail:
          "Open the 'Connect Tally Prime' tab on this page, confirm SSL Status shows Active, and click 'Run Live Endpoint Check' to send a safe test ping without adding fake bills.",
      },
      {
        title: "Step 2 — Enable Local XML Server Port 9000 Inside Tally Prime",
        detail:
          "In Tally Prime on your Windows PC, press F1 (Help) -> Settings -> Connectivity -> Client/Server Configuration. Set 'TallyPrime acts as' = Both, 'Enable ODBC' = Yes, and 'Port' = 9000, then press Ctrl + A (restart Tally if prompted). Test http://127.0.0.1:9000 in Chrome.",
        tip: "Port 9000 lets RapidShift export Tally Prime's exact native printed Voucher PDF (%PDF-1.x) AND sync your Stock Items, Godowns, and Batch balances automatically!",
      },
      {
        title: "Step 3 — Download .tdl v2.6 Without Windows Renaming It to (1) or .txt",
        detail:
          "In Windows File Explorer, enable View -> Show -> File name extensions. Click 'Download Pre-Configured .tdl v2.6' and save/overwrite C:\\TallyPrime\\rsl-tally-whatsapp.tdl (never let Chrome rename it to 'rsl-tally-whatsapp (1).tdl').",
      },
      {
        title: "Step 4 — Load .tdl v2.6 in Tally Prime (F1 -> TDLs & Add-Ons -> F4)",
        detail:
          "In Tally Prime, press F1 -> TDLs & Add-Ons -> F4 (Manage Local TDLs). Set 'Load selected TDL files on startup' = Yes, enter C:\\TallyPrime\\rsl-tally-whatsapp.tdl, set 'Load TDL' = Yes, and press Ctrl + A. Confirm status says 'Loaded'.",
      },
      {
        title: "Step 5 — Click 'RSL Cloud Connection Test' & 'RSL Sync All Bills Now'",
        detail:
          "On Gateway of Tally, click 'RSL Cloud Connection Test' (confirm Connected popup), then click 'RSL Sync All Bills Now' once. Optionally also pair the Windows Connector (rsl-tally-connector.mjs v2.4) for background native PDF + Stock Item sync and OTA .tdl auto-updates.",
      },
      {
        title: "Step 6 — Create Your 'tally_tax_invoice_pdf' Instant WhatsApp Rule",
        detail:
          "Load & sync starter templates in WhatsApp & Templates first, then on this page create an Instant Rule: Trigger = 'Sales', Template = 'tally_tax_invoice_pdf' (DOCUMENT PDF header), and click Create Rule. Add Overdue Reminder rules (e.g. 3 days before / 7 days overdue) below!",
      },
    ],
    commonMistakes: [
      "Leaving 'Mobile no.' blank inside the customer's Party Ledger in Tally Prime — without a mobile number on the party ledger, Tally syncs the bill to your dashboard but WhatsApp has no phone number to message.",
      "Letting Windows save a second download as 'rsl-tally-whatsapp (1).tdl' while Tally Prime F4 still points to the old file.",
      "Selecting a text-only template instead of 'tally_tax_invoice_pdf' when you want Tally's printed PDF attached.",
    ],
  },
  {
    routePrefix: "/inventory",
    title: "Using Tally Inventory, Godown Stock, Batch Expiry & Reorder Intelligence",
    summary:
      "Track live closing stock, stock valuation, godown & batch expiry balances, fast vs. non-moving dead stock (30/60/90+ days), and share 1-click WhatsApp item quotes.",
    estimatedTime: "5 min walkthrough",
    guideSlug: "tally-sync-and-import",
    prerequisites: [
      "Unlock 'Tally Prime Sync & Payment Reminders' in Plans & Wallet.",
      "Pair Windows Connector v2.4 (or sync Port 9000 / upload Tally Masters XML or CSV) to populate opening stock items, godowns, and standard selling/cost rates.",
    ],
    steps: [
      {
        title: "Sync Stock Items & Godowns from Tally Prime or Upload Masters XML / CSV",
        detail:
          "Open 'Add SKU / Sync & Import' (or run Windows Connector v2.4) to import Tally StockItem, Godown, and Party Credit Limit masters in seconds.",
      },
      {
        title: "Automatic Stock Updates Whenever Bills Are Created, Edited, or Cancelled",
        detail:
          "Every Sales invoice deducts stock, Credit Note or Purchase voucher adds stock, and cancelling/deleting a bill automatically restores exact quantities across your Stock Summary and Godowns!",
      },
      {
        title: "Check Reorder Shortfalls & 60+ Day Dead Stock Capital Lock",
        detail:
          "Switch to 'Reorder & Dead Stock' to see items below reorder level alongside slow/inactive inventory tying up working capital for 30, 60, or 90+ days.",
      },
      {
        title: "Share Instant WhatsApp Price Quotes from Your Live Stock Register",
        detail:
          "Use the search bar in 'Stock Summary & Price List' to check available stock, HSN, and GST rate on phone calls, and click 'Quote on WhatsApp' to share instant availability & pricing.",
      },
    ],
    commonMistakes: [
      "Importing only Sales Vouchers without Opening Balances — import Tally StockItem masters (or set Opening Qty on the item) so Closing Qty = Opening + Inward - Outward matches Tally's Stock Summary.",
    ],
  },
  {
    routePrefix: "/whatsapp",
    title: "Building Approved WhatsApp Templates & Launching Safe Broadcasts",
    summary:
      "Load ready-made Tally PDF templates in 1 click, build custom templates that pass Meta review without rejection, record opt-in consent, and send broadcasts.",
    estimatedTime: "6 min setup",
    guideSlug: "whatsapp-and-broadcasts",
    prerequisites: [
      "Unlock 'WhatsApp Business Messaging' in Plans & Wallet.",
      "Connect your official Meta WABA ID, 15-digit Phone Number ID, and Permanent System User Token in Connected Channels.",
    ],
    steps: [
      {
        title: "Click 'Load Ready-Made Tally Templates' First",
        detail:
          "Instantly pre-installs tally_tax_invoice_pdf (PDF header for untouched Tally invoices), tally_sales_bill_created, tally_payment_receipt_thankyou, and tally_overdue_payment_reminder.",
      },
      {
        title: "Follow Meta's Formatting Rules When Creating Custom Templates",
        detail:
          "Use lowercase letters, numbers, and underscores only for Template Name (e.g. festival_dealer_offer). Pick UTILITY for bill/order updates or MARKETING for promotions. Choose Header = Document (PDF) if attaching PDFs.",
      },
      {
        title: "Add Sequential Variables {{1}}, {{2}} & Mandatory Sample Values",
        detail:
          "Never place {{1}} as the very first or very last word of your message body, never put {{1}} {{2}} side-by-side without text between them, and ALWAYS fill realistic Sample Values (e.g. Mehta Electricals, ₹18,500) so Meta's automated review approves it.",
        tip: "On MARKETING templates, add a Quick Reply button labeled 'STOP' to keep your Meta quality rating High (Green).",
      },
      {
        title: "Click 'Sync Templates with WhatsApp' to Submit & Refresh Status",
        detail:
          "Submits local draft templates to Meta Graph API and refreshes PENDING templates to green APPROVED (usually 1–5 minutes on Meta's side).",
      },
      {
        title: "Record Customer Opt-In Consent & Launch Broadcasts",
        detail:
          "Add opted-in contacts with their consent source, select an APPROVED template in Launch Broadcast, verify the audience count & estimated rupee wallet deduction, and queue the broadcast. Unsubscribed ('STOP') numbers are skipped automatically.",
      },
    ],
    commonMistakes: [
      "Using capital letters, spaces, or hyphens in Template Name (Meta strictly requires lowercase_with_underscores).",
      "Submitting discount/promotional copy under the UTILITY category instead of MARKETING.",
      "Leaving Sample Variable examples empty — Meta rejects templates without sample values.",
    ],
  },
  {
    routePrefix: "/campaigns",
    title: "Managing Meta Ad Campaigns, Scheduled Social Posts & Website Pixel Sales",
    summary:
      "Track real rupee Return on Ad Spend (ROAS), schedule Facebook Page & Instagram Business posts, and log deduplicated checkout conversions.",
    estimatedTime: "5 min setup",
    guideSlug: "ads-social-posts-and-website-conversions",
    prerequisites: [
      "Unlock 'Meta Ads & Campaign Attribution' and/or 'Social Media Post Scheduler' in Plans & Wallet.",
      "Connect Facebook Page, Instagram Business, or Meta Ads & Pixel in Connected Channels.",
    ],
    steps: [
      {
        title: "Create an Ad Campaign with Your Daily Rupee Budget",
        detail:
          "Enter Campaign Name, select Meta (Facebook & Instagram) or Google, pick your objective, set Daily Budget (₹), and click Create Campaign.",
      },
      {
        title: "Record Ad Spend & Linked Sales Revenue to Track Real ROAS",
        detail:
          "Log daily or weekly rupee spend alongside attributed sales revenue so RapidShift computes exact Return per ₹1 Spent (e.g. 4.2x ROAS) here and in Detailed Analytics.",
      },
      {
        title: "Schedule Facebook Page & Instagram Business Posts",
        detail:
          "Choose your connected page/profile, write your caption, paste a public HTTPS image/video URL (mandatory for Instagram Graph API publishing), pick the IST date & time, and click Schedule Post.",
      },
      {
        title: "Log Website Checkout Conversions with a Unique Order ID",
        detail:
          "Under Website Conversion / Pixel Events, enter Event Type (Purchase / Lead), your unique Order ID (e.g. ORD-2026-8841), and Order Amount (₹). Submitting the same Order ID twice is automatically deduplicated so sales are never double-counted.",
      },
    ],
    commonMistakes: [
      "Scheduling an Instagram post without a publicly reachable HTTPS JPEG/PNG/MP4 media URL.",
      "Omitting a unique Order ID on Website Sales Events (needed for browser + server pixel deduplication).",
    ],
  },
  {
    routePrefix: "/reviews",
    title: "Monitoring Google Business Reviews & Publishing Smart Owner Replies",
    summary:
      "Track 1-star to 5-star customer ratings across store locations, draft ₹1.00 context-aware owner replies, edit before approval, and publish.",
    estimatedTime: "4 min setup",
    guideSlug: "google-reviews-and-smart-replies",
    prerequisites: [
      "Unlock 'Google Business Profile Reviews' (and optional 'Smart Review Reply Drafts' add-on) in Plans & Wallet.",
      "Connect Google Business Profile with 'business.manage' OAuth scope and your 'locations/...' ID in Connected Channels.",
    ],
    steps: [
      {
        title: "Sync or Import Store Reviews & Filter Unreplied 1–3 Star Ratings First",
        detail:
          "Click Sync Reviews (or log a test store review during setup) and filter by 'Needs Reply' or '1–2 Stars' so critical customer feedback is addressed within hours.",
      },
      {
        title: "Click 'Generate Smart Reply Draft (₹1.00)' for Instant Polite Copy",
        detail:
          "With the Smart Review Reply Drafts add-on active, click Generate Draft to create a polite response tailored to the reviewer's exact comment and star rating (debits ₹1.00 from your Prepaid Wallet).",
      },
      {
        title: "Review, Personalize & Click 'Approve & Publish Owner Reply'",
        detail:
          "Smart drafts NEVER auto-post blindly. Edit any store-specific detail inside the reply box, then click 'Approve & Publish Owner Reply' to push your verified response live.",
      },
    ],
    commonMistakes: [
      "Sharing private customer invoice numbers or phone numbers inside a public Google Maps review reply — invite them to message your WhatsApp support number instead.",
    ],
  },
  {
    routePrefix: "/connections",
    title: "Connecting WhatsApp Cloud API, Instagram, Facebook, Meta Pixel & Google",
    summary:
      "Follow exact console whitelisting checklists, paste permanent System User / OAuth tokens, verify webhook callback URLs, and run live API health checks.",
    estimatedTime: "10 min one-time setup",
    guideSlug: "connecting-channels-whatsapp-meta-google",
    prerequisites: [
      "Requires Business Owner or Admin workspace role.",
      "For Meta / WhatsApp / Instagram: have business.facebook.com/settings + developers.facebook.com/apps open. For Google Drive or Google Business Profile: just click the 1-click 'Connect with Google' button (no Google Cloud Console or Service Account JSON needed!).",
    ],
    steps: [
      {
        title: "Select the Channel Tab You Want to Connect",
        detail:
          "Click WhatsApp Cloud API, Instagram Business, Facebook Page, Meta Ads & Pixel, Google Business, or Google Drive at the top of the hub. For Google Drive & Google Business, click the green 1-click Google Sign-In button to authorize via RapidShift Labs's official Google screen!",
      },
      {
        title: "Create an Admin System User & Generate a 'Never' Expiring Token (Meta)",
        detail:
          "In business.facebook.com/settings -> Users -> System Users, create an Admin System User, click 'Assign Assets' (grant Full Control on your App + WABA / Page / IG Account), and click 'Generate New Token' with Expiration = 'Never' and all listed scopes.",
        tip: "Never paste the 24-hour temporary token from Meta's 'API Setup' page — it expires the next day with OAuth Error 190!",
      },
      {
        title: "Copy & Verify the Inbound Webhook Callback URL + Verify Token",
        detail:
          "Copy the Callback URL (https://app.rapidshiftlabs.in/api/webhooks/whatsapp or /meta) and Verify Token shown on the left, paste them into Meta App Dashboard -> Webhooks, click 'Verify and save', and subscribe to 'messages' & 'message_template_status_update'.",
      },
      {
        title: "Enter Numeric Asset IDs (Never +91 Phone Numbers or @Handles)",
        detail:
          "For WhatsApp, paste the 15-digit Phone Number ID & WABA ID. For Instagram, turn ON 'Allow access to messages' inside the Instagram mobile app (Settings -> Messages -> Connected tools) and paste your 17-digit IG Business Account ID. For Meta Ads, include the 'act_' prefix.",
      },
      {
        title: "Keep 'Run Live API Check After Saving' Enabled & Save",
        detail:
          "Click Connect. RapidShift encrypts your token with AES-256-GCM, runs a live Graph/Google API ping immediately, and marks the connection card green ('Healthy').",
      },
    ],
    commonMistakes: [
      "Pasting your 10-digit +91 mobile number into 'Phone Number ID' instead of Meta's 15-digit Phone Number ID.",
      "Leaving 'Allow access to messages' turned OFF in the Instagram mobile app (Meta silently drops all Instagram DM webhooks until enabled).",
      "Forgetting to attach a payment card in Meta Business Settings -> Billing & Payments (causes Meta Error #131042).",
    ],
  },
  {
    routePrefix: "/settings/tokens",
    title: "Managing All Channel Tokens, Tally Webhook Secrets & REST API Keys",
    summary:
      "Single high-security vault to inspect, test, rotate, or revoke external channel tokens, Tally tlwh_ tokens, Meta verify tokens, REST API keys, and signed outbound webhooks.",
    estimatedTime: "4 min setup",
    guideSlug: "developer-api",
    prerequisites: [
      "Requires Business Owner or Admin role (Developer REST API keys & Outbound Webhooks also require 'Developer REST API & Webhooks' plan unlocked).",
    ],
    steps: [
      {
        title: "Audit & Rotate External Channel or Meta Webhook Verify Tokens",
        detail:
          "Review masked token hints and last health check timestamps. If you click 'Rotate Meta Verify Token', immediately paste the new token into Meta App Dashboard -> Webhooks -> Verify Token.",
      },
      {
        title: "Inspect or Rotate Your Workspace Tally Webhook Token (tlwh_...)",
        detail:
          "View live Tally event/ping counters. Only rotate the Tally token if compromised — after rotating, re-download .tdl v2.5 in Tally Prime -> F4 so Tally uses the new token.",
      },
      {
        title: "Issue Scoped Live (rsl_live_) or Test (rsl_test_) REST API Keys",
        detail:
          "Enter a key label, select Live or Test mode, tick only the minimum required scopes (e.g. vouchers:write, whatsapp:write), click Create API Key, and copy the one-time secret immediately.",
      },
      {
        title: "Register Signed Outbound Webhooks to Your ERP / Website",
        detail:
          "Enter your HTTPS receiver URL, pick event types (tally.bill.created, whatsapp.message.received, etc.), save the 'whsec_...' secret to verify 'X-RSL-Signature', and click 'Send Test Ping'.",
      },
    ],
    commonMistakes: [
      "Closing the page before copying a newly created 'rsl_live_...' API key — for security only its SHA-256 hash is stored, so generate a fresh key if missed.",
    ],
  },
  {
    routePrefix: "/developers",
    title: "Testing REST API v1 Endpoints Live in the Interactive Sandbox",
    summary:
      "Send live authenticated requests against your workspace API routes, test Idempotency-Key deduplication, and copy cURL / Node.js / Python snippets.",
    estimatedTime: "5 min walkthrough",
    guideSlug: "webhooks-and-api-sandbox",
    prerequisites: [
      "Unlock 'Developer REST API & Webhooks' in Plans & Wallet.",
      "Generate a scoped rsl_live_... or rsl_test_... key in All API Tokens (/settings/tokens).",
    ],
    steps: [
      {
        title: "Pick an Endpoint Preset (Contacts, Vouchers, Tally Bill-Event, WhatsApp, Analytics)",
        detail:
          "Choose the REST v1 route you want to test so the HTTP method, path, and sample JSON payload populate automatically.",
      },
      {
        title: "Paste Your Bearer API Key & Optional Idempotency-Key",
        detail:
          "Paste your 'rsl_live_...' or 'rsl_test_...' key. On POST routes (/api/v1/contacts, /api/v1/vouchers, /api/v1/tally/bill-event), set an Idempotency-Key so retries never create duplicates.",
      },
      {
        title: "Click 'Send Request' & Inspect Status Code, Timing & JSON Response",
        detail:
          "Verify HTTP 200 OK and inspect the returned entity IDs (cnt_..., tvch_..., out_...). Copy the ready-to-paste cURL or language code sample for your backend.",
      },
    ],
    commonMistakes: [
      "Getting RSL-API-1002 (Insufficient Scope) because the API key was created with 'read' scope only while calling a POST 'write' endpoint.",
    ],
  },
  {
    routePrefix: "/billing/invoices",
    title: "Printing or Saving Your Official Rule 46 GST Tax Invoice PDF",
    summary:
      "Inspect itemized SAC 998314 tax breakdown (9% CGST + 9% SGST for Maharashtra State 27, or 18% IGST inter-state) and save a clean A4 PDF.",
    estimatedTime: "1 min",
    guideSlug: "plans-wallet-and-gst",
    prerequisites: [
      "Verify your Registered Business Name, 15-character GSTIN, and State Code in Business Settings if you claim B2B GST Input Tax Credit.",
    ],
    steps: [
      {
        title: "Verify Supplier & Recipient GSTIN, SAC 998314 & Tax Split",
        detail:
          "Confirm your trade name, 15-character GSTIN, place of supply state code (27 Maharashtra = 9% CGST + 9% SGST; other states = 18% IGST), and UTR reference.",
      },
      {
        title: "Click 'Download Official PDF' or 'Print / Save PDF'",
        detail:
          "Click 'Download Official PDF' for an instant generated PDF file, or click 'Print' -> Destination 'Save as PDF' (all sidebars and guide banners hide automatically in print mode).",
      },
      {
        title: "Share With Your CA / File Under GSTR-2B Input Tax Credit Records",
        detail:
          "Forward the downloaded PDF or export your full invoice register CSV from Plans & Wallet (/billing) for monthly GST reconciliation.",
      },
    ],
    commonMistakes: [
      "Leaving Browser Print 'Headers and footers' ticked in Chrome's print dialog — uncheck 'Headers and footers' for the cleanest A4 layout.",
    ],
  },
  {
    routePrefix: "/billing",
    title: "Unlocking Plans / Bundles, Finding Your 12-Digit UTR & Using the -₹200 Wallet Overdraft",
    summary:
      "Request Monthly/Quarterly/Yearly features or Value Bundles, pay via dynamic UPI QR or NEFT/IMPS, top up your Prepaid Wallet, and download GST invoices.",
    estimatedTime: "4 min",
    guideSlug: "plans-wallet-and-gst",
    prerequisites: [
      "Requires Business Owner or Accounts & Billing role to submit plan activations or wallet recharges.",
      "Set your GST State & 15-character GSTIN in Business Settings first so issued GST invoices carry your GSTIN.",
    ],
    steps: [
      {
        title: "Compare Value Bundles vs. Individual Modular Plans",
        detail:
          "If you need multiple capabilities (e.g. Tally Sync + WhatsApp + Inbox), pick a Value Bundle at the top for combined savings; otherwise click 'Activate Plan' on any individual module.",
      },
      {
        title: "Choose Cycle (Monthly / Quarterly / Yearly) & Scan the Dynamic UPI QR",
        detail:
          "Inside the payment modal, select your billing cycle to see exact Subtotal + 18% GST = Total Payable. Scan the QR code in GPay / PhonePe / Paytm or transfer to the displayed Bank Account + IFSC.",
      },
      {
        title: "Copy the 12-Digit UTR / UPI Ref No. from Your Payment App & Submit",
        detail:
          "In Google Pay copy 'UPI transaction ID' (12 digits); in PhonePe copy 'UTR'; in Paytm copy 'UPI Ref No'; in NetBanking copy the IMPS/NEFT UTR. Paste it into the reference box and click Submit.",
        tip: "Once our finance team verifies the UTR in our bank statement, your tools unlock automatically and your paid GST Tax Invoice appears below!",
      },
      {
        title: "Fund Your Prepaid Message Wallet (Seamless -₹200.00 Overdraft Built In)",
        detail:
          "Use 'Recharge Prepaid Wallet' to add rupee balance for per-message WhatsApp template sends and ₹1.00 Smart Review drafts. During busy hours, sends continue uninterrupted down to -₹200.00 and auto-settle on your next recharge.",
      },
    ],
    commonMistakes: [
      "Pasting your own UPI ID (name@okaxis) or mobile number instead of the 12-digit numeric UTR / UPI Transaction ID.",
      "Confusing Plan Subscriptions (unlocks software screens) with Prepaid Wallet Balance (funds per-message WhatsApp usage).",
    ],
  },
  {
    routePrefix: "/settings/business",
    title: "Configuring Business Identity, GSTIN, State Tax Split & SSL Subdomains",
    summary:
      "Set your legal GST trade name, 2-digit State Code (CGST+SGST vs IGST), 15-character GSTIN, and verify *.tally / *.api HTTPS certificates.",
    estimatedTime: "3 min",
    guideSlug: "team-roles-security-and-business-settings",
    prerequisites: ["Requires Business Owner or Admin role."],
    steps: [
      {
        title: "Enter Legal Trade Name & Match State Code to Your 15-Digit GSTIN",
        detail:
          "Select the exact Indian State Code matching the first 2 digits of your GSTIN (e.g. '27 — Maharashtra' for 9% CGST + 9% SGST; any other state applies 18% IGST). Enter your 15-character GSTIN in uppercase with no spaces.",
      },
      {
        title: "Set Billing Address, Accounts Email & Optional Default Tally Company",
        detail:
          "Fill in your full registered address for Rule 46 GST invoices and click 'Save Business Settings'.",
      },
      {
        title: "Verify Dedicated *.tally.rapidshiftlabs.in & *.api.rapidshiftlabs.in SSL",
        detail:
          "Confirm both dedicated workspace subdomains show 'Active' SSL status (or click 'Provision / Refresh SSL' if newly created).",
      },
    ],
    commonMistakes: [
      "Selecting State Code 27 while entering a GSTIN starting with 24 (Gujarat) — always match the first 2 digits of your GSTIN.",
    ],
  },
  {
    routePrefix: "/settings/team",
    title: "Inviting Colleagues, Sharing 7-Day Invite Links & Managing Role Permissions",
    summary:
      "Add your accountant, support agents, or marketing manager with granular role permissions — without ever sharing your owner password.",
    estimatedTime: "3 min",
    guideSlug: "team-roles-security-and-business-settings",
    prerequisites: ["Requires Business Owner or Admin role."],
    steps: [
      {
        title: "Enter Colleague Email & Pick Their Exact Job Role",
        detail:
          "Choose Admin (full ops), Marketing & Operations Manager (Inbox, WhatsApp, Ads, Reviews), Support Executive (Inbox & Reviews only), Accounts & Billing (Plans, Wallet, Invoices & Tally), or View-Only Analyst, then click 'Create Team Invitation'.",
      },
      {
        title: "Click 'Copy Invite Link' & Send It Directly to Your Colleague",
        detail:
          "Copy the '/accept-invite?token=...' URL from Pending Invitations and share it via WhatsApp or email. Links stay valid for 7 days (click 'Regenerate Link' anytime if expired).",
      },
      {
        title: "Update Roles or Remove Former Staff Instantly",
        detail:
          "In Active Team Members, change any member's role dropdown and click 'Update Role', or click 'Remove' to revoke workspace access on their very next click.",
      },
    ],
    commonMistakes: [
      "Sharing your personal Owner email/password across multiple office computers instead of issuing individual role-scoped team accounts.",
    ],
  },
  {
    routePrefix: "/settings/profile",
    title: "Managing Your Personal Profile, Password & Active Browser Sessions",
    summary:
      "Keep your personal contact details current, rotate your login password, and sign out unfamiliar browsers or shared office PCs.",
    estimatedTime: "2 min",
    guideSlug: "team-roles-security-and-business-settings",
    prerequisites: ["Available to every signed-in team member."],
    steps: [
      {
        title: "Update Your Full Name, Job Title & Mobile Number",
        detail:
          "Edit your personal identity fields and click 'Save Profile Details' so audit logs and internal inbox notes show your clear name and role.",
      },
      {
        title: "Rotate Your Login Password Periodically",
        detail:
          "Enter your Current Password and a strong New Password (8+ characters) under Change Password and click 'Update Password'.",
      },
      {
        title: "Audit Active Browser Sessions & Revoke Shared Devices",
        detail:
          "Inspect every signed-in browser's IP address and timestamp. Click 'Sign Out' on any unfamiliar row or 'Revoke All Other Sessions' to keep only your current browser logged in.",
      },
    ],
    commonMistakes: [
      "Staying logged in on a cybercafe or shared warehouse PC — use 'Revoke All Other Sessions' from your phone or main laptop anytime.",
    ],
  },
  {
    routePrefix: "/backups",
    title: "Setting Up Cloudflare R2 / S3 Storage, CSV/XML Exports & .rslbackup Restores",
    summary:
      "Connect Managed Storage or your own Cloudflare R2 / S3 bucket, migrate files with byte-verified integrity, and download or restore encrypted backups.",
    estimatedTime: "6 min setup",
    guideSlug: "storage-r2-and-backups",
    prerequisites: [
      "CSV, Tally XML, and JSON exports are always available; encrypted '.rslbackup' snapshots require 'Encrypted Customer Backups & Export' unlocked.",
    ],
    steps: [
      {
        title: "Choose Managed Cloud Storage or Connect Your Cloudflare R2 / S3 Bucket",
        detail:
          "For Cloudflare R2: create a bucket in dash.cloudflare.com -> R2, create an 'Object Read & Write' R2 API Token scoped to that bucket, and enter Endpoint 'https://<account_id>.r2.cloudflarestorage.com' (do NOT append bucket name to endpoint URL!), Region 'auto', Bucket Name, Access Key ID, and Secret Access Key.",
      },
      {
        title: "Keep 'Copy and Verify Existing Stored Files' Checked When Switching",
        detail:
          "RapidShift copies every existing Tally PDF and media file to your new bucket and verifies byte sizes before switching active storage.",
      },
      {
        title: "Connect Google Drive in 1 Click for Automatic Off-Site Backups",
        detail:
          "Click 'Connect Google Drive with Google' on the Google Drive card (no Service Account JSON or Folder ID required!). Approve on Google's official RapidShift Labs screen — we automatically create 'RapidShift Labs Backups' using the privacy-safe drive.file scope and upload every .rslbackup snapshot automatically.",
      },
      {
        title: "Download Instant CSV / Tally XML / JSON Exports or Encrypted .rslbackup",
        detail:
          "Use the top export buttons anytime, or click 'Create Backup Now' to generate a signed AES-256-GCM '.rslbackup' snapshot (downloaded locally and mirrored to Google Drive if connected).",
      },
      {
        title: "Restore Safely Without Losing Wallet Balance, GST Invoices or STOP Lists",
        detail:
          "Upload your '.rslbackup', enter the exact passphrase, type RESTORE, and submit. RapidShift saves a 7-day pre-restore safety copy automatically and never overwrites your Wallet passbook, GST invoices, or unsubscribed phone numbers.",
      },
    ],
    commonMistakes: [
      "Adding '/bucket-name' at the end of the Cloudflare R2 Endpoint URL — keep the endpoint strictly as 'https://<32_char_account_id>.r2.cloudflarestorage.com' and put the bucket name in 'Bucket Name'.",
      "Forgetting your backup passphrase — AES-256-GCM archives cannot be decrypted without the passphrase used at creation.",
    ],
  },
  {
    routePrefix: "/activity",
    title: "Reviewing & Exporting Your Immutable Business Activity Audit Log",
    summary:
      "Inspect every action performed by team members, Tally Prime syncs, automated WhatsApp rules, and support sessions with redacted CSV export.",
    estimatedTime: "2 min",
    guideSlug: "team-roles-security-and-business-settings",
    prerequisites: ["Requires audit log view permission (Owner, Admin, Manager, or Analyst)."],
    steps: [
      {
        title: "Filter by Category, Outcome (Success / Blocked / Error) or Search Term",
        detail:
          "Use the filter bar to isolate billing events, Tally voucher syncs, WhatsApp dispatches, or team permission updates.",
      },
      {
        title: "Inspect Actor Type (User, Tally Webhook, Background Worker, Staff Support)",
        detail:
          "Every row records exact timestamp, actor identity, IP/correlation ID, and human-readable summary. Past audit records are append-only and can never be edited or deleted.",
      },
      {
        title: "Export Redacted Audit CSV for Compliance Reviews",
        detail:
          "Click 'Export Audit CSV' to download the filtered timeline with sensitive credentials automatically redacted.",
      },
    ],
    commonMistakes: [],
  },
  {
    routePrefix: "/status",
    title: "Checking Live Workspace Health, SSL Certificates & Background Queues",
    summary:
      "Verify real-time operational readiness of your isolated workspace database, wildcard SSL subdomains, channel tokens, and background delivery worker.",
    estimatedTime: "2 min",
    guideSlug: "getting-started",
    prerequisites: ["Available to all workspace members."],
    steps: [
      {
        title: "Confirm Workspace Database, Worker Queue & Storage Show Green ('Online')",
        detail:
          "Verify each subsystem badge is green. If any channel connection shows 'Needs Re-Auth', click through to Connected Channels (/connections) and run 'Test Live API'.",
      },
      {
        title: "Check Dedicated *.tally & *.api Subdomain SSL Readiness",
        detail:
          "Ensure both HTTPS ingress hostnames are Active before configuring external ERP webhooks or Tally Prime .tdl v2.5.",
      },
      {
        title: "Inspect Recent Tally Sync & Delivery Queue Heartbeats",
        detail:
          "If background tasks show queued retries, open Activity History (/activity) to see the exact provider error code and resolution step.",
      },
    ],
    commonMistakes: [],
  },
];

export function resolveWebPageGuide(pathname: string): WebPageGuide | null {
  const clean = (pathname.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  if (clean === "/help" || clean.startsWith("/help/")) {
    return null;
  }
  for (const guide of WEB_PAGE_GUIDES) {
    if (guide.exact) {
      if (clean === guide.routePrefix) return guide;
    } else if (clean === guide.routePrefix || clean.startsWith(`${guide.routePrefix}/`)) {
      return guide;
    }
  }
  return WEB_PAGE_GUIDES[0] ?? null;
}
