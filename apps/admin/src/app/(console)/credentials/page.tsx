import { headers } from "next/headers";
import {
  Activity,
  CheckCircle2,
  Database,
  KeyRound,
  MailCheck,
  Play,
  RefreshCw,
  Server,
} from "lucide-react";
import { canStaffAccessAdminRoute, formatStaffRoleLabel } from "@rsl/auth";
import { getEnv, isLoopbackUrlOrHost, resolveEndpointsFromHeaders } from "@rsl/core";
import {
  ALL_PLATFORM_CREDENTIAL_PROVIDERS,
  buildCloudflareEmailWorkerSnippet,
  buildPlatformCredentialsSeedTemplate,
  getSafePlatformCredentialsAdminSnapshot,
  probePlatformSystemStatuses,
  type CredentialSource,
  type PlatformCredentialProviderKey,
} from "@rsl/tenancy";
import {
  AccessRestrictedState,
  FlashBanner,
  GuideDrawerButton,
  MetricCard,
  PageHeader,
  SectionCard,
  StatusPill,
  type GuideDrawerContent,
} from "@rsl/ui";
import { ActionLink, AdminCopyButton, SubmitButton } from "@/components/ios-feedback";
import {
  staffBulkSeedPlatformCredentialsJsonAction,
  staffClearPlatformCredentialAction,
  staffSaveBhashiniCredentialsAction,
  staffSaveCloudflareAiAction,
  staffSaveCloudflareEmailRoutingAction,
  staffSaveCloudflareTurnstileAction,
  staffSaveGoogleAdsCredentialsAction,
  staffSaveGoogleOAuthCredentialsAction,
  staffSaveManagedR2CredentialsAction,
  staffSaveMetaAppCredentialsAction,
  staffSaveRazorpayCredentialsAction,
  staffSaveSmtpCredentialsAction,
  staffSaveWebPushVapidAction,
  staffSendTestSmtpEmailAction,
  staffTestAllPlatformCredentialsAction,
  staffTestPlatformCredentialAction,
} from "@/lib/actions";
import { requireStaffSession } from "@/lib/session";

function sourcePill(source: CredentialSource, isReady: boolean) {
  if (source === "database" && isReady) {
    return <StatusPill label="Database Active (Encrypted)" tone="emerald" />;
  }
  if (source === "database" && !isReady) {
    return <StatusPill label="Paused in Database" tone="amber" />;
  }
  if (source === "env" && isReady) {
    return <StatusPill label="Server .env Fallback" tone="sky" />;
  }
  return <StatusPill label="Not Configured Yet" tone="stone" />;
}

function verifyStatusPill(status: string | null | undefined, isReady: boolean) {
  if (status === "healthy") {
    return <StatusPill label="Verified Healthy" tone="emerald" />;
  }
  if (status === "warning") {
    return <StatusPill label="Warning" tone="amber" />;
  }
  if (status === "error") {
    return <StatusPill label="Test Failed" tone="ruby" />;
  }
  if (status === "unconfigured") {
    return <StatusPill label="Unconfigured" tone="stone" />;
  }
  if (isReady) {
    return <StatusPill label="Configured (Untested)" tone="sky" />;
  }
  return <StatusPill label="Not Configured" tone="stone" />;
}

function ProviderLiveTestFooter({
  providerKey,
  label,
  source,
  isReady,
  lastVerifiedAt,
  lastVerifyStatus,
  lastVerifyMessage,
}: {
  providerKey: PlatformCredentialProviderKey;
  label: string;
  source: CredentialSource;
  isReady: boolean;
  lastVerifiedAt: number | null | undefined;
  lastVerifyStatus: string | null | undefined;
  lastVerifyMessage: string | null | undefined;
}) {
  const toneClasses =
    lastVerifyStatus === "healthy"
      ? "border-emerald-200/90 bg-emerald-50/55 text-emerald-950"
      : lastVerifyStatus === "error"
        ? "border-rose-200 bg-rose-50/70 text-rose-950"
        : lastVerifyStatus === "warning"
          ? "border-amber-200 bg-amber-50/70 text-amber-950"
          : "border-zinc-200/90 bg-zinc-50/75 text-slate-800";

  return (
    <div className={`mt-4 rounded-xl border p-3.5 text-xs ${toneClasses}`}>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {verifyStatusPill(lastVerifyStatus, isReady)}
            <span className="text-[11px] font-medium text-zinc-500">
              {lastVerifiedAt
                ? `Last tested ${new Date(lastVerifiedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`
                : "No live test recorded yet"}
            </span>
          </div>
          <p className="text-[11.5px] leading-relaxed font-medium">
            {lastVerifyMessage ||
              `Click "Test ${label}" to run a live authentication & endpoint health check.`}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <form action={staffTestPlatformCredentialAction}>
            <input type="hidden" name="providerKey" value={providerKey} />
            <input type="hidden" name="returnTo" value={`/credentials#cred-${providerKey}`} />
            <SubmitButton
              className="adm-btn-secondary bg-white py-1.5 text-xs"
              spinnerSize="xs"
              pendingText={`Testing ${label}...`}
            >
              <Play className="h-3 w-3 text-indigo-600" />
              <span>Test {label}</span>
            </SubmitButton>
          </form>

          {source === "database" && (
            <form action={staffClearPlatformCredentialAction}>
              <input type="hidden" name="providerKey" value={providerKey} />
              <SubmitButton
                className="adm-btn-secondary bg-white py-1.5 text-[11px]"
                spinnerSize="xs"
                pendingText="Clearing..."
              >
                Remove DB Override
              </SubmitButton>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default async function AdminPlatformCredentialsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { staff } = await requireStaffSession();
  if (!canStaffAccessAdminRoute(staff.staffRole, "/credentials")) {
    return (
      <AccessRestrictedState
        pageTitle="OAuth & API Credentials"
        roleLabel={formatStaffRoleLabel(staff.staffRole)}
        requiredPermissionLabel="Manage platform-wide credentials"
        description="Only Super Admins can view or update encrypted platform OAuth & API credentials."
      />
    );
  }

  const sp = await searchParams;
  const hdrs = await headers();
  const env = getEnv();
  const endpoints = resolveEndpointsFromHeaders(hdrs);
  const snap = getSafePlatformCredentialsAdminSnapshot();
  const systemReport =
    sp.probeSystem === "1" ? await probePlatformSystemStatuses() : null;

  const googleOrigin =
    env.APP_URL && !isLoopbackUrlOrHost(env.APP_URL)
      ? env.APP_URL.replace(/\/+$/, "")
      : `https://app.${endpoints.primaryDomain}`;
  const googleRedirectUri = `${googleOrigin}/api/oauth/google/callback`;
  const googleScopesText =
    "openid, email, profile, https://www.googleapis.com/auth/drive.file, https://www.googleapis.com/auth/spreadsheets, https://www.googleapis.com/auth/webmasters.readonly, https://www.googleapis.com/auth/business.manage, https://www.googleapis.com/auth/adwords";

  const metaRedirectUri = `${googleOrigin}/api/oauth/meta/callback`;
  const metaWebhookUri = `${googleOrigin}/api/webhooks/meta`;
  const whatsappWebhookUri = `${googleOrigin}/api/webhooks/whatsapp`;
  const metaLegalUrlsText = `Privacy: ${googleOrigin}/privacy | Terms: ${googleOrigin}/terms | Data Deletion: ${googleOrigin}/data-deletion`;
  const metaScopesText =
    "public_profile, business_management, ads_management, ads_read, pages_show_list, pages_read_engagement, pages_manage_posts, pages_manage_ads, pages_messaging, leads_retrieval, instagram_basic, instagram_content_publish, instagram_manage_messages, whatsapp_business_management, whatsapp_business_messaging";

  const cfEmailWorkerCode = buildCloudflareEmailWorkerSnippet(googleOrigin);
  const seedTemplateJson = JSON.stringify(buildPlatformCredentialsSeedTemplate(), null, 2);

  const credentialsGuideContent: GuideDrawerContent = {
    eyebrow: "Platform Vault • 2026 Setup Guides",
    title: "Google Auth Platform, Cloud Ads Access Levels, Meta Use Cases & Cloudflare Workers",
    summary:
      "Select a provider tab below to copy exact Redirect URIs, Webhook URLs, Scopes, and Worker scripts.",
    roleNote: "Super Admin Vault",
    tabs: [
      {
        id: "google",
        label: "1. Google Auth Platform & Ads",
        summary:
          "Configure ONE Google OAuth 2.0 Web Application Client in the 2026 Google Auth Platform so every customer can connect Google Drive (drive.file, zero CASA audit), Google Business Profile, Google Sheets, Search Console, and Google Ads in 1 click.",
        copyValues: [
          { label: "Authorized JavaScript Origin", value: googleOrigin },
          { label: "Authorized Redirect URI", value: googleRedirectUri },
          { label: "Authorized Domain", value: endpoints.primaryDomain },
          { label: "Developer Contact Email", value: "app@rapidshiftlabs.in" },
          { label: "Required OAuth Scopes", value: googleScopesText },
        ],
        steps: [
          {
            title: "Enable Required APIs in Google Cloud Console",
            detail:
              "Open console.cloud.google.com -> Select your project ('RapidShift Labs') -> APIs & Services -> Library -> Enable Google Drive API, Google Sheets API, Google Search Console API, My Business Account Management API, My Business Business Information API, and Google Ads API.",
          },
          {
            title: "Configure Google Auth Platform -> Branding & Audience",
            detail: `Open Google Auth Platform -> Branding -> App Information: set App name 'RapidShift Labs', User support email 'app@rapidshiftlabs.in', App home page '${googleOrigin}', Privacy policy '${googleOrigin}/privacy', Terms of service '${googleOrigin}/terms', and Authorized domain '${endpoints.primaryDomain}'. Then open Audience -> select External -> click Publish App so status moves from Testing to In production (prevents 7-day refresh-token expiry).`,
          },
          {
            title: "Configure Google Auth Platform -> Data Access & Clients",
            detail:
              "Open Google Auth Platform -> Data Access -> Add or remove scopes -> paste the Required OAuth Scopes above and Save. Next, open Google Auth Platform -> Clients -> + Create Client -> Application type: Web application -> paste the Authorized JavaScript Origin and Redirect URI above -> download client_secret_*.json and upload it in Section 1.",
          },
          {
            title: "Google Cloud Console -> Google Ads API Access Levels (No Developer Token Needed)",
            detail:
              "Google Ads API retired legacy Developer Tokens. API access levels are managed exclusively in Google Cloud Console -> APIs & Services -> Google Ads API. New projects start at Test access (15,000 daily API operations on test accounts + developer sandboxing). Click 'Upgrade access level' -> 'Apply for access' under Next access level: Explorer (allows 2,880 daily operations on production accounts), and later upgrade to Standard when scaling.",
          },
          {
            title: "Fixing 'Your application for explorer-level access was not approved'",
            detail:
              "If Google Cloud Console displays the red banner 'Your application for explorer-level access was not approved', fix these 4 items before clicking 'Apply for access' again: (1) In Google Ads Manager (MCC) -> Tools -> API Center, set your API contact email to your verified corporate domain email (app@rapidshiftlabs.in, never a free @gmail.com address) and verify that email; (2) Ensure an active Google Cloud Billing Account is linked to this Cloud project; (3) Ensure Google Auth Platform -> Branding has live, publicly reachable Privacy Policy (/privacy) and Terms (/terms) URLs matching your Authorized Domain; (4) In the Explorer re-application form, clearly state that RapidShift Labs is an authorized multi-tenant marketing & accounting SaaS platform syncing campaign metrics and budgets for verified business owners.",
          },
        ],
        cautions: [
          "Never create a Google 'Service account' JSON key. Service accounts have 0 GB personal Drive quota and cannot display Sign in with Google. Our form automatically rejects Service Account JSON files.",
          "Until Explorer access is approved in Google Cloud Console -> Google Ads API, your project remains on Test access (works immediately with Google Ads Test Manager accounts).",
        ],
      },
      {
        id: "meta",
        label: "2. Meta Use Cases & Webhooks",
        summary:
          "Configure ONE Meta App using the 2026 Meta Developer Console Use Cases & Facebook Login for Business Configurations so customers can connect WhatsApp Cloud API, Instagram Business, Facebook Pages, and Meta Ads/Pixels in 1 click.",
        copyValues: [
          { label: "Valid OAuth Redirect URI", value: metaRedirectUri },
          { label: "Meta Pages / IG Webhook URL", value: metaWebhookUri },
          { label: "WhatsApp Cloud Webhook URL", value: whatsappWebhookUri },
          { label: "Login for Business Scopes", value: metaScopesText },
          { label: "App Basic Legal URLs", value: metaLegalUrlsText },
        ],
        steps: [
          {
            title: "Create App with 2026 Meta Use Cases & Basic Settings",
            detail: `Open developers.facebook.com/apps -> Create App -> connect your verified Meta Business Portfolio -> under Use Cases select 'Authenticate and request data from users with Facebook Login' + 'Other' -> Business ('RapidShift Labs'). Under App Settings -> Basic, set Contact Email 'app@rapidshiftlabs.in', App Domain 'app.${endpoints.primaryDomain}', and paste the Privacy, Terms, and Data Deletion URLs above.`,
          },
          {
            title: "Attach Required Use Cases (WhatsApp, Marketing API, Pages & Instagram)",
            detail:
              "In the left sidebar click Use Cases -> Add use cases -> enable Facebook Login for Business, WhatsApp (Cloud API), Marketing API (Ads & Pixels), Manage messaging & content on Instagram, and Manage everything on your Page. Under Facebook Login for Business -> Settings, enable Client OAuth Login + Web OAuth Login + Embedded Browser OAuth Login and paste the Valid OAuth Redirect URI above.",
          },
          {
            title: "Create Facebook Login for Business Configuration IDs",
            detail:
              "Open Facebook Login for Business -> Configurations -> + Create configuration. Create a General Business Login configuration (System User access token, non-expiring, with the Login for Business Scopes above) and optionally a second configuration using the 'WhatsApp Embedded Signup' variation (60-day token + whatsapp_business_management + whatsapp_business_messaging). Paste the Configuration ID into Section 4.",
          },
          {
            title: "Configure Webhooks & System User Token",
            detail:
              "Under Webhooks, subscribe Page/Instagram (messages, messaging_postbacks, feed, leadgen) to /api/webhooks/meta and WhatsApp Business Account (messages, message_template_status_update, account_update) to /api/webhooks/whatsapp using your Global Verify Token. Switch App Mode from Development to Live once Business Verification is complete.",
          },
        ],
      },
      {
        id: "cloudflare",
        label: "3. Cloudflare Email Worker",
        summary:
          "Route supplier GST invoices emailed to bills+<workspace-slug>@<domain> straight into each client's Tally Purchase Draft Inbox using $0 Cloudflare Email Routing + Email Workers.",
        copyValues: [
          {
            label: "Inbound Webhook Endpoint",
            value: `${googleOrigin}/api/webhooks/cloudflare-email`,
          },
          {
            label: "Recommended Inbound Subdomain",
            value: snap.cloudflareEmail.inboundDomain || `bills.${endpoints.primaryDomain}`,
          },
        ],
        steps: [
          {
            title: "Save Inbound Domain & HMAC Secret in Section 9",
            detail:
              "Save your inbound subdomain in Section 9 on this page (leave the secret blank to auto-generate a 48-character HMAC key).",
          },
          {
            title: "Deploy the Cloudflare Email Worker Script",
            detail:
              "In dash.cloudflare.com → Email → Email Routing → Email Workers, create a Worker, set environment variable RSL_EMAIL_WEBHOOK_SECRET to your saved secret, and paste the script below:",
            code: cfEmailWorkerCode,
            codeLanguage: "javascript",
          },
          {
            title: "Enable Catch-All Rule to Worker",
            detail:
              "Under Email Routing → Routing Rules, route Catch-All addresses on your bills subdomain to this Email Worker.",
          },
        ],
      },
      {
        id: "seeder",
        label: "4. JSON & CLI Seeder",
        summary:
          "Seed or rotate all 11 encrypted providers at once from a single JSON bundle via the paste/upload box on this page or from an SSH terminal.",
        copyValues: [
          {
            label: "CLI Seed Command",
            value: "pnpm db:seed-credentials --file ./credentials.seed.json",
          },
        ],
        steps: [
          {
            title: "Copy the JSON Seed Template",
            detail:
              "Any omitted or blank provider key is left untouched. Setting web_push_vapid.autoGenerate to true generates fresh P-256 ECDSA keys automatically:",
            code: seedTemplateJson,
            codeLanguage: "json",
          },
          {
            title: "Paste in 'Bulk JSON Seed' or run CLI",
            detail:
              "Expand 'Bulk Seed Credentials (JSON)' on this page to encrypt into control.db immediately, or run the CLI command above on your server.",
          },
        ],
      },
    ],
    fullGuideHref: "/runbooks",
    fullGuideLabel: "All Staff SOP Runbooks →",
  };

  const matrixRows: Array<{
    key: PlatformCredentialProviderKey;
    badge: string;
    label: string;
    category: string;
    source: CredentialSource;
    isReady: boolean;
    lastVerifiedAt: number | null;
    lastVerifyStatus: string | null;
    lastVerifyMessage: string | null;
  }> = [
    {
      key: "google_oauth",
      badge: "1",
      label: "Google Cloud OAuth 2.0",
      category: "1-Click Drive, GBP & Ads Sign-In",
      source: snap.google.source,
      isReady: snap.google.isReady,
      lastVerifiedAt: snap.google.lastVerifiedAt,
      lastVerifyStatus: snap.google.lastVerifyStatus,
      lastVerifyMessage: snap.google.lastVerifyMessage,
    },
    {
      key: "smtp_email",
      badge: "2",
      label: "Outbound SMTP Email",
      category: `${snap.smtp.host || "smtp.gmail.com"}:${snap.smtp.port || 465}`,
      source: snap.smtp.source,
      isReady: snap.smtp.isReady,
      lastVerifiedAt: snap.smtp.lastVerifiedAt,
      lastVerifyStatus: snap.smtp.lastVerifyStatus,
      lastVerifyMessage: snap.smtp.lastVerifyMessage,
    },
    {
      key: "cloudflare_r2",
      badge: "3",
      label: "Cloudflare R2 Vault",
      category: snap.r2.bucketPrivate ? `Bucket: ${snap.r2.bucketPrivate}` : "Encrypted S3/R2 Vault",
      source: snap.r2.source,
      isReady: snap.r2.isReady,
      lastVerifiedAt: snap.r2.lastVerifiedAt,
      lastVerifyStatus: snap.r2.lastVerifyStatus,
      lastVerifyMessage: snap.r2.lastVerifyMessage,
    },
    {
      key: "meta_app",
      badge: "4",
      label: "Meta & WhatsApp App",
      category: `Graph ${snap.meta.graphVersion || "v21.0"} • OAuth & Webhooks`,
      source: snap.meta.source,
      isReady: snap.meta.isReady,
      lastVerifiedAt: snap.meta.lastVerifiedAt,
      lastVerifyStatus: snap.meta.lastVerifyStatus,
      lastVerifyMessage: snap.meta.lastVerifyMessage,
    },
    {
      key: "google_ads",
      badge: "5",
      label: "Google Ads & Managed MCC",
      category: `API ${snap.googleAds.apiVersion || "v18"} • Cloud Console Mode`,
      source: snap.googleAds.source,
      isReady: snap.googleAds.isReady,
      lastVerifiedAt: snap.googleAds.lastVerifiedAt,
      lastVerifyStatus: snap.googleAds.lastVerifyStatus,
      lastVerifyMessage: snap.googleAds.lastVerifyMessage,
    },
    {
      key: "razorpay",
      badge: "6",
      label: "Razorpay Checkout Gateway",
      category: snap.razorpay.keyId || "Optional Instant UPI/Card Gateway",
      source: snap.razorpay.source,
      isReady: snap.razorpay.isReady,
      lastVerifiedAt: snap.razorpay.lastVerifiedAt,
      lastVerifyStatus: snap.razorpay.lastVerifyStatus,
      lastVerifyMessage: snap.razorpay.lastVerifyMessage,
    },
    {
      key: "cloudflare_turnstile",
      badge: "7",
      label: "Cloudflare Turnstile",
      category: "Login, Signup & Public Form Shield",
      source: snap.turnstile.source,
      isReady: snap.turnstile.isReady,
      lastVerifiedAt: snap.turnstile.lastVerifiedAt,
      lastVerifyStatus: snap.turnstile.lastVerifyStatus,
      lastVerifyMessage: snap.turnstile.lastVerifyMessage,
    },
    {
      key: "cloudflare_ai",
      badge: "8",
      label: "Cloudflare Workers AI",
      category: snap.cloudflareAi.textModel,
      source: snap.cloudflareAi.source,
      isReady: snap.cloudflareAi.isReady,
      lastVerifiedAt: snap.cloudflareAi.lastVerifiedAt,
      lastVerifyStatus: snap.cloudflareAi.lastVerifyStatus,
      lastVerifyMessage: snap.cloudflareAi.lastVerifyMessage,
    },
    {
      key: "cloudflare_email_routing",
      badge: "9",
      label: "Cloudflare Email Routing",
      category: `*@${snap.cloudflareEmail.inboundDomain}`,
      source: snap.cloudflareEmail.source,
      isReady: snap.cloudflareEmail.isReady,
      lastVerifiedAt: snap.cloudflareEmail.lastVerifiedAt,
      lastVerifyStatus: snap.cloudflareEmail.lastVerifyStatus,
      lastVerifyMessage: snap.cloudflareEmail.lastVerifyMessage,
    },
    {
      key: "web_push_vapid",
      badge: "10",
      label: "W3C Web Push (VAPID)",
      category: snap.vapid.subject,
      source: snap.vapid.source,
      isReady: snap.vapid.isReady,
      lastVerifiedAt: snap.vapid.lastVerifiedAt,
      lastVerifyStatus: snap.vapid.lastVerifyStatus,
      lastVerifyMessage: snap.vapid.lastVerifyMessage,
    },
    {
      key: "bhashini",
      badge: "11",
      label: "MeitY Digital India BHASHINI",
      category: "22 Indian Languages NMT",
      source: snap.bhashini.source,
      isReady: snap.bhashini.isReady,
      lastVerifiedAt: snap.bhashini.lastVerifiedAt,
      lastVerifyStatus: snap.bhashini.lastVerifyStatus,
      lastVerifyMessage: snap.bhashini.lastVerifyMessage,
    },
  ];

  const dbActiveCount = matrixRows.filter((r) => r.source === "database").length;
  const verifiedHealthyCount = matrixRows.filter((r) => r.lastVerifyStatus === "healthy").length;
  const failedVerifyCount = matrixRows.filter((r) => r.lastVerifyStatus === "error").length;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Database-Controlled Platform Vault (AES-256-GCM)"
        title="OAuth & API Credentials"
        subtitle="Configure, encrypt, and live-test all 11 platform credential providers plus runtime ports, SQLite databases, KMS ciphers, and open SMB APIs directly from the staff console."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <GuideDrawerButton
              drawerId="admin-credentials-setup-guide"
              label="Need help? • Setup Guides"
              badgeText="4 guides"
              guide={credentialsGuideContent}
            />
            <ActionLink
              href={
                sp.probeSystem === "1"
                  ? "/credentials"
                  : "/credentials?probeSystem=1#system-status-probe"
              }
              className="adm-btn-secondary text-xs"
            >
              <Server className="h-3.5 w-3.5 text-indigo-600" />
              <span>
                {sp.probeSystem === "1"
                  ? "Hide Runtime Port & DB Probe"
                  : "Test Server Ports, DBs & APIs"}
              </span>
            </ActionLink>
            <form action={staffTestAllPlatformCredentialsAction}>
              <input type="hidden" name="returnTo" value="/credentials?probeSystem=1" />
              <SubmitButton
                className="adm-btn-primary text-xs"
                spinnerSize="xs"
                pendingText="Testing All 11 Providers..."
              >
                <Activity className="h-3.5 w-3.5" />
                <span>Test All 11 Credentials &amp; Statuses</span>
              </SubmitButton>
            </form>
          </div>
        }
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      {/* Top Readiness Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Verified Healthy"
          value={`${verifiedHealthyCount} / ${ALL_PLATFORM_CREDENTIAL_PROVIDERS.length}`}
          sublabel={
            failedVerifyCount > 0
              ? `${failedVerifyCount} provider(s) reported errors on last test`
              : "Click 'Test All 11 Credentials' anytime"
          }
          accent={failedVerifyCount > 0 ? "ruby" : verifiedHealthyCount > 0 ? "emerald" : "sky"}
        />
        <MetricCard
          label="Google OAuth Consent Screen"
          value={snap.google.isReady ? "1-Click Ready" : "Setup Needed"}
          sublabel={
            snap.google.isReady
              ? `${snap.google.consentAppName} (${snap.google.source === "database" ? "DB Vault" : ".env"})`
              : "Add Web Client ID & Secret below"
          }
          accent={snap.google.isReady ? "emerald" : "amber"}
        />
        <MetricCard
          label="Outbound Transactional SMTP"
          value={snap.smtp.isReady ? "Live SMTP" : "Local Queue"}
          sublabel={
            snap.smtp.isReady
              ? `${snap.smtp.host}:${snap.smtp.port} (${snap.smtp.user})`
              : "Configure Gmail / SMTP App Password"
          }
          accent={snap.smtp.isReady ? "emerald" : "amber"}
        />
        <MetricCard
          label="DB-Controlled Providers"
          value={`${dbActiveCount} / 11`}
          sublabel="Encrypted with KMS envelope keys in control.db"
          accent="emerald"
        />
      </div>

      {/* Live Server Ports, SQLite, KMS & Open API Status Probe */}
      {systemReport && (
        <div id="system-status-probe" className="scroll-mt-24">
          <SectionCard
            title={`Live Platform Runtime, Ports, Databases & Open API Status (${systemReport.summary.healthy}/${systemReport.items.length} Healthy)`}
            subtitle={`Probed live at ${new Date(systemReport.checkedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} across ports 4500-4520, SQLite WAL files, KMS AES-256-GCM cipher, and public Indian SMB directories`}
            action={
              <ActionLink
                href={`/credentials?probeSystem=1&ts=${Date.now()}#system-status-probe`}
                className="adm-btn-secondary py-1.5 text-xs"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Re-Run Runtime Probe</span>
              </ActionLink>
            }
            noPadding
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-200/80 bg-zinc-50/80 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                  <tr>
                    <th className="px-5 py-2.5">Component / Endpoint</th>
                    <th className="px-4 py-2.5">Target</th>
                    <th className="px-4 py-2.5">Live Status</th>
                    <th className="px-4 py-2.5">Latency</th>
                    <th className="px-5 py-2.5">Diagnostic Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {systemReport.items.map((item) => (
                    <tr key={item.key} className="hover:bg-zinc-50/60">
                      <td className="px-5 py-2.5 font-semibold text-slate-900 whitespace-nowrap">
                        {item.label}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-500 whitespace-nowrap">
                        {item.target}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <StatusPill
                          label={
                            item.status === "healthy"
                              ? "Healthy"
                              : item.status === "warning"
                                ? "Standby / Warning"
                                : "Unreachable"
                          }
                          tone={
                            item.status === "healthy"
                              ? "emerald"
                              : item.status === "warning"
                                ? "amber"
                                : "ruby"
                          }
                        />
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-600 tabular-nums whitespace-nowrap">
                        {item.latencyMs} ms
                      </td>
                      <td className="px-5 py-2.5 text-zinc-700">{item.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      )}

      {/* Unified 11-Provider Credential & Live Verification Matrix */}
      <SectionCard
        title="11-Provider Credential & Live Status Matrix"
        subtitle="Test any single credential provider in one click or run all 11 checks in parallel. Click any provider name to jump directly to its configuration form."
        action={
          <form action={staffTestAllPlatformCredentialsAction}>
            <input type="hidden" name="returnTo" value="/credentials" />
            <SubmitButton
              className="adm-btn-secondary py-1.5 text-xs"
              spinnerSize="xs"
              pendingText="Running 11 Live Checks..."
            >
              <RefreshCw className="h-3.5 w-3.5 text-emerald-600" />
              <span>Test All 11 Providers</span>
            </SubmitButton>
          </form>
        }
        noPadding
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-zinc-200/80 bg-zinc-50/80 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
              <tr>
                <th className="px-5 py-2.5">Provider</th>
                <th className="px-4 py-2.5">Source</th>
                <th className="px-4 py-2.5">Verification Status</th>
                <th className="px-4 py-2.5">Last Diagnostic Message</th>
                <th className="px-5 py-2.5 text-right">Live Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {matrixRows.map((row) => (
                <tr key={row.key} className="hover:bg-zinc-50/60">
                  <td className="px-5 py-3 whitespace-nowrap">
                    <a
                      href={`#cred-${row.key}`}
                      className="group inline-flex items-center gap-2 font-bold text-slate-900 hover:text-indigo-700"
                    >
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-slate-100 px-1.5 font-mono text-[10px] font-bold text-slate-700 group-hover:bg-indigo-100 group-hover:text-indigo-800">
                        {row.badge}
                      </span>
                      <span>{row.label}</span>
                    </a>
                    <div className="mt-0.5 pl-7 text-[11px] text-zinc-500">{row.category}</div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {sourcePill(row.source, row.isReady)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex flex-col items-start gap-1">
                      {verifyStatusPill(row.lastVerifyStatus, row.isReady)}
                      {row.lastVerifiedAt && (
                        <span className="text-[10.5px] text-zinc-400 tabular-nums">
                          {new Date(row.lastVerifiedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="max-w-md px-4 py-3 text-[11.5px] leading-relaxed text-zinc-700">
                    {row.lastVerifyMessage || (
                      <span className="text-zinc-400">
                        Not tested yet. Click Test to verify live credentials.
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <form action={staffTestPlatformCredentialAction} className="inline-block">
                      <input type="hidden" name="providerKey" value={row.key} />
                      <input type="hidden" name="returnTo" value="/credentials" />
                      <SubmitButton
                        className="adm-btn-secondary py-1.5 text-xs"
                        spinnerSize="xs"
                        pendingText="Testing..."
                      >
                        <Play className="h-3 w-3 text-emerald-600" />
                        <span>Test</span>
                      </SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Bulk Database Credential Seeder (1-Click JSON Seed) */}
      <details className="rsl-frost-card group rounded-2xl">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-6 py-4 select-none">
          <div className="flex items-center gap-2.5">
            <Database className="h-4 w-4 text-emerald-700" />
            <div>
              <div className="text-sm font-bold text-slate-900">
                Bulk Seed Credentials into Database (JSON Bundle)
              </div>
              <div className="text-xs text-zinc-600">
                Paste or upload a JSON bundle to encrypt up to all 11 providers in one step.
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <GuideDrawerButton
              drawerId="admin-credentials-seeder-guide"
              label="Need help? • CLI & Template"
              initialTabId="seeder"
              guide={credentialsGuideContent}
            />
            <AdminCopyButton text={seedTemplateJson} label="Copy JSON Seed Template" />
          </div>
        </summary>
        <div className="space-y-3 border-t border-zinc-200/70 p-6 text-xs">
          <form action={staffBulkSeedPlatformCredentialsJsonAction} className="space-y-3">
            <textarea
              name="credentialsJson"
              rows={6}
              placeholder={seedTemplateJson}
              className="adm-input font-mono text-[11px]"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <input
                type="file"
                name="credentialsJsonFile"
                accept="application/json,.json"
                className="text-xs text-zinc-600"
              />
              <SubmitButton className="adm-btn-primary" pendingText="Seeding into control.db...">
                <Database className="h-3.5 w-3.5" />
                <span>Encrypt &amp; Seed Bundle into Database</span>
              </SubmitButton>
            </div>
          </form>
        </div>
      </details>

      {/* 1. Google OAuth 2.0 Web Client Vault */}
      <div id="cred-google_oauth" className="scroll-mt-24">
      <SectionCard
        title="1. Google OAuth 2.0 Web Application Credentials (RapidShift Labs Consent Screen)"
        subtitle="Powers 1-click 'Connect Google Drive with Google' on /backups & /connections, plus 1-click Google Business Profile & Google Ads sign-in"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <GuideDrawerButton
              drawerId="admin-credentials-google-guide"
              label="Setup Guide"
              initialTabId="google"
              guide={credentialsGuideContent}
            />
            {sourcePill(snap.google.source, snap.google.isReady)}
          </div>
        }
      >
        <form action={staffSaveGoogleOAuthCredentialsAction} className="space-y-4 text-xs">
          <div className="rounded-xl border border-emerald-200/90 bg-emerald-50/50 p-4">
            <label className="mb-1.5 block font-bold text-slate-900">
              Quick Import (Optional): Upload or Paste Google&apos;s Downloaded{" "}
              <code className="font-mono">client_secret_*.json</code>
            </label>
            <p className="mb-2.5 text-[11px] text-zinc-600">
              If you clicked &ldquo;Download JSON&rdquo; after creating your <strong>Web application</strong> OAuth Client ID, upload or paste it here - we auto-extract{" "}
              <code className="font-mono">web.client_id</code>, <code className="font-mono">web.client_secret</code>, and{" "}
              <code className="font-mono">web.project_id</code> (and automatically warn you if it is a Service Account JSON!). Or leave this blank and fill Client ID + Secret directly below.
            </p>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-zinc-700">
                  Upload client_secret_*.json File
                </label>
                <input
                  name="oauthJsonFile"
                  type="file"
                  accept=".json,application/json"
                  className="adm-input bg-white text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-zinc-700">
                  Or Paste client_secret_*.json Contents
                </label>
                <textarea
                  name="oauthJsonRaw"
                  rows={2}
                  placeholder={'{"web":{"client_id":"...apps.googleusercontent.com","client_secret":"GOCSPX-..."}}'}
                  className="adm-input bg-white font-mono text-[11px]"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block font-semibold text-zinc-700">
                OAuth 2.0 Web Client ID (<code className="font-mono">*.apps.googleusercontent.com</code>)
              </label>
              <input
                name="clientId"
                defaultValue={snap.google.clientId}
                placeholder="123456789012-abcxyz.apps.googleusercontent.com"
                className="adm-input font-mono text-xs"
              />
            </div>
            <div>
              <label className="mb-1.5 block font-semibold text-zinc-700">
                OAuth 2.0 Client Secret{" "}
                {snap.google.maskedClientSecret ? (
                  <span className="font-mono text-[11px] font-normal text-emerald-700">
                    (Saved: {snap.google.maskedClientSecret} - leave blank to keep)
                  </span>
                ) : (
                  <span>(Starts with GOCSPX-...)</span>
                )}
              </label>
              <input
                name="clientSecret"
                type="password"
                placeholder={
                  snap.google.maskedClientSecret
                    ? "Leave blank to keep encrypted secret, or paste new GOCSPX-..."
                    : "GOCSPX-..."
                }
                className="adm-input font-mono text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1.5 block font-semibold text-zinc-700">
                Consent Screen App Name
              </label>
              <input
                name="consentAppName"
                defaultValue={snap.google.consentAppName || "RapidShift Labs"}
                placeholder="RapidShift Labs"
                className="adm-input"
              />
            </div>
            <div>
              <label className="mb-1.5 block font-semibold text-zinc-700">
                Auto-Created Drive Folder Name
              </label>
              <input
                name="defaultDriveFolderName"
                defaultValue={snap.google.defaultDriveFolderName || "RapidShift Labs Backups"}
                placeholder="RapidShift Labs Backups"
                className="adm-input"
              />
            </div>
            <div>
              <label className="mb-1.5 block font-semibold text-zinc-700">
                Google Cloud Project ID (Optional)
              </label>
              <input
                name="projectId"
                defaultValue={snap.google.projectId}
                placeholder="rapidshift-labs-prod"
                className="adm-input font-mono text-xs"
              />
            </div>
            <div>
              <label className="mb-1.5 block font-semibold text-zinc-700">
                Google Auth Publishing Status
              </label>
              <select
                name="publishingStatus"
                defaultValue={snap.google.publishingStatus}
                className="adm-input"
              >
                <option value="production">In Production (Published - Recommended)</option>
                <option value="testing">Testing Mode (Only whitelisted test emails)</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-5 rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-4 py-3">
            <label className="inline-flex items-center gap-2 font-semibold text-slate-800">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={snap.google.enabled}
                className="h-4 w-4 rounded border-zinc-300 text-emerald-600"
              />
              <span>Master Google OAuth Enabled</span>
            </label>
            <label className="inline-flex items-center gap-2 font-medium text-slate-700">
              <input
                type="checkbox"
                name="enableDriveOAuth"
                defaultChecked={snap.google.enableDriveOAuth}
                className="h-4 w-4 rounded border-zinc-300 text-emerald-600"
              />
              <span>Enable 1-Click Customer Google Drive Backups (<code className="font-mono">drive.file</code>)</span>
            </label>
            <label className="inline-flex items-center gap-2 font-medium text-slate-700">
              <input
                type="checkbox"
                name="enableGbpOAuth"
                defaultChecked={snap.google.enableGbpOAuth}
                className="h-4 w-4 rounded border-zinc-300 text-emerald-600"
              />
              <span>Enable 1-Click Google Business Profile Sign-In (<code className="font-mono">business.manage</code>)</span>
            </label>
            <label className="inline-flex items-center gap-2 font-medium text-slate-700">
              <input
                type="checkbox"
                name="enableGoogleAdsOAuth"
                defaultChecked={snap.google.enableGoogleAdsOAuth}
                className="h-4 w-4 rounded border-zinc-300 text-emerald-600"
              />
              <span>Enable 1-Click Google Ads OAuth (<code className="font-mono">adwords</code>)</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <span className="text-[11px] text-zinc-500">
              {snap.google.updatedAt
                ? `Last updated in control.db: ${new Date(snap.google.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`
                : "Not saved in database yet - save above to enable 1-click Google Sign-In."}
            </span>
            <SubmitButton
              className="adm-btn-primary"
              pendingText="Encrypting & Saving Google OAuth..."
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>Save Google OAuth Credentials in Database</span>
            </SubmitButton>
          </div>
        </form>

        <ProviderLiveTestFooter
          providerKey="google_oauth"
          label="Google OAuth"
          source={snap.google.source}
          isReady={snap.google.isReady}
          lastVerifiedAt={snap.google.lastVerifiedAt}
          lastVerifyStatus={snap.google.lastVerifyStatus}
          lastVerifyMessage={snap.google.lastVerifyMessage}
        />
      </SectionCard>
      </div>

      {/* 2. Outbound SMTP / Transactional Email Credentials */}
      <div id="cred-smtp_email" className="scroll-mt-24">
      <SectionCard
        title="2. Outbound SMTP / Transactional Email (OTP, Password Resets, Team Invites & GST Notices)"
        subtitle="Use Gmail / Google Workspace (smtp.gmail.com:465 with a 16-character Google App Password) or any transactional SMTP relay (AWS SES, Brevo, Resend, Zoho)"
        action={sourcePill(snap.smtp.source, snap.smtp.isReady)}
      >
        <div className="space-y-4 text-xs">
          <form action={staffSaveSmtpCredentialsAction} className="space-y-4">
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1.5 block font-semibold text-zinc-700">SMTP Host *</label>
                <input
                  name="host"
                  required
                  defaultValue={snap.smtp.host || "smtp.gmail.com"}
                  placeholder="smtp.gmail.com"
                  className="adm-input font-mono text-xs"
                />
              </div>
              <div>
                <label className="mb-1.5 block font-semibold text-zinc-700">SMTP Port *</label>
                <input
                  name="port"
                  type="number"
                  required
                  defaultValue={snap.smtp.port || 465}
                  className="adm-input font-mono text-xs"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1.5 block font-semibold text-zinc-700">
                  Sender From Header *
                </label>
                <input
                  name="from"
                  required
                  defaultValue={snap.smtp.from || "RapidShift Labs <app@rapidshiftlabs.in>"}
                  placeholder="RapidShift Labs <app@rapidshiftlabs.in>"
                  className="adm-input"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block font-semibold text-zinc-700">
                  SMTP Login / Email Username *
                </label>
                <input
                  name="user"
                  required
                  defaultValue={snap.smtp.user || "app@rapidshiftlabs.in"}
                  placeholder="app@rapidshiftlabs.in"
                  className="adm-input font-mono text-xs"
                />
              </div>
              <div>
                <label className="mb-1.5 block font-semibold text-zinc-700">
                  SMTP App Password / API Key{" "}
                  {snap.smtp.maskedPassword ? (
                    <span className="font-mono text-[11px] font-normal text-emerald-700">
                      (Saved: {snap.smtp.maskedPassword} - leave blank to keep)
                    </span>
                  ) : (
                    <span>*</span>
                  )}
                </label>
                <input
                  name="password"
                  type="password"
                  placeholder={
                    snap.smtp.maskedPassword
                      ? "Leave blank to keep saved password, or enter new 16-char App Password"
                      : "16-character Google App Password (no spaces)"
                  }
                  className="adm-input font-mono text-xs"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-5">
                <label className="inline-flex items-center gap-2 font-semibold text-slate-800">
                  <input
                    type="checkbox"
                    name="enabled"
                    defaultChecked={snap.smtp.enabled}
                    className="h-4 w-4 rounded border-zinc-300 text-emerald-600"
                  />
                  <span>Enable Live SMTP Delivery</span>
                </label>
                <label className="inline-flex items-center gap-2 font-medium text-slate-700">
                  <input
                    type="checkbox"
                    name="secure"
                    defaultChecked={snap.smtp.secure}
                    className="h-4 w-4 rounded border-zinc-300 text-emerald-600"
                  />
                  <span>Implicit TLS / SSL (Tick ON for port 465; OFF for STARTTLS port 587)</span>
                </label>
              </div>

              <SubmitButton className="adm-btn-primary" pendingText="Saving SMTP...">
                <Database className="h-3.5 w-3.5" />
                <span>Save SMTP Credentials</span>
              </SubmitButton>
            </div>
          </form>

          {/* Live Test Email Verification Bar */}
          <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/80 p-3.5">
            <form
              action={staffSendTestSmtpEmailAction}
              className="flex flex-wrap items-end justify-between gap-3"
            >
              <div className="min-w-[240px] flex-1">
                <label className="mb-1 block font-semibold text-slate-900">
                  Send Live Verification Email (Full Branded HTML + Inline Logos)
                </label>
                <input
                  name="recipientEmail"
                  type="email"
                  required
                  defaultValue={staff.email}
                  placeholder="app@rapidshiftlabs.in"
                  className="adm-input bg-white"
                />
              </div>
              <SubmitButton className="adm-btn-secondary bg-white" pendingText="Sending Live Email...">
                <MailCheck className="h-3.5 w-3.5 text-emerald-600" />
                <span>Send Live Test Email</span>
              </SubmitButton>
            </form>
          </div>

          <ProviderLiveTestFooter
            providerKey="smtp_email"
            label="SMTP Handshake"
            source={snap.smtp.source}
            isReady={snap.smtp.isReady}
            lastVerifiedAt={snap.smtp.lastVerifiedAt}
            lastVerifyStatus={snap.smtp.lastVerifyStatus}
            lastVerifyMessage={snap.smtp.lastVerifyMessage}
          />
        </div>
      </SectionCard>
      </div>

      {/* 3. Managed Cloud Storage - Cloudflare R2 & 4. Meta / Razorpay Grid */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* 3. Managed Cloudflare R2 */}
        <div id="cred-cloudflare_r2" className="scroll-mt-24">
        <SectionCard
          title="3. Managed Cloud Storage - Cloudflare R2 / S3"
          subtitle="Powers the 'RSL Managed Cloud Storage' plan for customer invoice PDFs, media, and workspace archives"
          action={sourcePill(snap.r2.source, snap.r2.isReady)}
        >
          <form action={staffSaveManagedR2CredentialsAction} className="space-y-3.5 text-xs">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">
                  Cloudflare Account ID
                </label>
                <input
                  name="accountId"
                  defaultValue={snap.r2.accountId}
                  placeholder="8f92a1b4c..."
                  className="adm-input font-mono text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">
                  Custom S3 Endpoint (Optional)
                </label>
                <input
                  name="endpointUrl"
                  defaultValue={snap.r2.endpointUrl}
                  placeholder="https://<account>.r2.cloudflarestorage.com"
                  className="adm-input font-mono text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">
                  R2 Access Key ID *
                </label>
                <input
                  name="accessKeyId"
                  required
                  defaultValue={snap.r2.accessKeyId}
                  placeholder="R2 S3 Access Key ID"
                  className="adm-input font-mono text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">
                  R2 Secret Access Key{" "}
                  {snap.r2.maskedSecretAccessKey ? `(${snap.r2.maskedSecretAccessKey})` : "*"}
                </label>
                <input
                  name="secretAccessKey"
                  type="password"
                  placeholder={
                    snap.r2.maskedSecretAccessKey
                      ? "Leave blank to keep saved secret"
                      : "R2 S3 Secret Access Key"
                  }
                  className="adm-input font-mono text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">
                  Private Bucket *
                </label>
                <input
                  name="bucketPrivate"
                  required
                  defaultValue={snap.r2.bucketPrivate || "rsl-private"}
                  placeholder="rsl-private"
                  className="adm-input font-mono text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">
                  Public Bucket
                </label>
                <input
                  name="bucketPublic"
                  defaultValue={snap.r2.bucketPublic || "rsl"}
                  placeholder="rsl"
                  className="adm-input font-mono text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">
                  Public CDN URL
                </label>
                <input
                  name="publicBaseUrl"
                  defaultValue={snap.r2.publicBaseUrl || `https://storage.${endpoints.primaryDomain}`}
                  placeholder={`https://storage.${endpoints.primaryDomain}`}
                  className="adm-input font-mono text-xs"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <label className="inline-flex items-center gap-2 font-semibold text-slate-800">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={snap.r2.enabled}
                  className="h-4 w-4 rounded border-zinc-300 text-emerald-600"
                />
                <span>Enable Managed R2 Backend</span>
              </label>
              <SubmitButton className="adm-btn-primary" pendingText="Saving R2...">
                Save Managed R2 Credentials
              </SubmitButton>
            </div>
          </form>

          <ProviderLiveTestFooter
            providerKey="cloudflare_r2"
            label="R2 Bucket"
            source={snap.r2.source}
            isReady={snap.r2.isReady}
            lastVerifiedAt={snap.r2.lastVerifiedAt}
            lastVerifyStatus={snap.r2.lastVerifyStatus}
            lastVerifyMessage={snap.r2.lastVerifyMessage}
          />
        </SectionCard>
        </div>

        {/* 4. Meta / WhatsApp Platform App & Managed BM */}
        <div id="cred-meta_app" className="scroll-mt-24">
        <SectionCard
          title="4. Meta / WhatsApp Platform App & Managed BM"
          subtitle="Powers 1-Click Facebook/Meta OAuth, X-Hub-Signature-256 webhooks, and optional RSL Managed Ad Spend Vault"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <GuideDrawerButton
                drawerId="admin-credentials-meta-guide"
                label="Setup Guide"
                initialTabId="meta"
                guide={credentialsGuideContent}
              />
              {sourcePill(snap.meta.source, snap.meta.isReady)}
            </div>
          }
        >
          <form action={staffSaveMetaAppCredentialsAction} className="space-y-3.5 text-xs">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Meta App ID *</label>
                <input
                  name="appId"
                  required
                  defaultValue={snap.meta.appId}
                  placeholder="827364519283746"
                  className="adm-input font-mono text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">
                  Meta App Secret {snap.meta.maskedAppSecret ? `(${snap.meta.maskedAppSecret})` : "*"}
                </label>
                <input
                  name="appSecret"
                  type="password"
                  placeholder={
                    snap.meta.maskedAppSecret
                      ? "Leave blank to keep saved App Secret"
                      : "Meta App Basic Settings → App Secret"
                  }
                  className="adm-input font-mono text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">
                  Embedded Config ID
                </label>
                <input
                  name="configId"
                  defaultValue={snap.meta.configId}
                  placeholder="Optional WABA Config ID"
                  className="adm-input font-mono text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">
                  Global Verify Token
                </label>
                <input
                  name="webhookVerifyToken"
                  type="password"
                  placeholder={
                    snap.meta.maskedVerifyToken
                      ? `Saved: ${snap.meta.maskedVerifyToken}`
                      : "Optional global verify token"
                  }
                  className="adm-input font-mono text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Graph Version</label>
                <input
                  name="graphVersion"
                  defaultValue={snap.meta.graphVersion || "v21.0"}
                  placeholder="v21.0"
                  className="adm-input font-mono text-xs"
                />
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3 space-y-2.5">
              <div className="font-bold text-slate-900">
                Optional - RSL Managed Ad Spend Vault (Master Business Manager Account)
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">
                    Master Ad Account (<code className="font-mono">act_...</code>)
                  </label>
                  <input
                    name="managedAdAccountId"
                    defaultValue={snap.meta.managedAdAccountId}
                    placeholder="act_1234567890"
                    className="adm-input bg-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">
                    Default Master Page ID
                  </label>
                  <input
                    name="managedPageId"
                    defaultValue={snap.meta.managedPageId}
                    placeholder="Optional Page ID"
                    className="adm-input bg-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">
                    BM System User Token{" "}
                    {snap.meta.maskedManagedSystemToken ? `(${snap.meta.maskedManagedSystemToken})` : ""}
                  </label>
                  <input
                    name="managedSystemToken"
                    type="password"
                    placeholder={
                      snap.meta.maskedManagedSystemToken
                        ? "Leave blank to keep saved token"
                        : "EAAG... System User Token"
                    }
                    className="adm-input bg-white font-mono text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-2 font-semibold text-slate-800">
                  <input
                    type="checkbox"
                    name="enabled"
                    defaultChecked={snap.meta.enabled}
                    className="h-4 w-4 rounded border-zinc-300 text-emerald-600"
                  />
                  <span>Verify Webhook HMAC</span>
                </label>
                <label className="inline-flex items-center gap-2 font-medium text-slate-700">
                  <input
                    type="checkbox"
                    name="enableMetaOAuth"
                    defaultChecked={snap.meta.enableMetaOAuth}
                    className="h-4 w-4 rounded border-zinc-300 text-emerald-600"
                  />
                  <span>Enable 1-Click Facebook / Meta OAuth</span>
                </label>
              </div>
              <SubmitButton className="adm-btn-primary" pendingText="Saving Meta App...">
                Save Meta App Credentials
              </SubmitButton>
            </div>
          </form>

          <ProviderLiveTestFooter
            providerKey="meta_app"
            label="Meta Graph"
            source={snap.meta.source}
            isReady={snap.meta.isReady}
            lastVerifiedAt={snap.meta.lastVerifiedAt}
            lastVerifyStatus={snap.meta.lastVerifyStatus}
            lastVerifyMessage={snap.meta.lastVerifyMessage}
          />
        </SectionCard>
        </div>
      </div>

      {/* 4B. Google Ads Cloud Project Access & Optional Managed MCC */}
      <div id="cred-google_ads" className="scroll-mt-24">
      <SectionCard
        title="5. Google Ads API & Managed Ad Vault (Cloud Project Access - No Developer Token Required)"
        subtitle="Google sunset Developer Tokens - Direct Client 1-Click Google Ads works automatically via your Google Cloud OAuth Client ID above once Google Ads API is enabled & upgraded to Explorer/Basic Access in Google Cloud Console. Fill the optional Managed MCC fields below only if running RSL-funded Managed Vault campaigns."
        action={sourcePill(snap.googleAds.source, snap.googleAds.isReady)}
      >
        <form action={staffSaveGoogleAdsCredentialsAction} className="space-y-3.5 text-xs">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block font-semibold text-zinc-700">
                Legacy Developer Token{" "}
                {snap.googleAds.maskedDeveloperToken
                  ? `(${snap.googleAds.maskedDeveloperToken})`
                  : "(Not Required - Sunset)"}
              </label>
              <input
                name="developerToken"
                type="password"
                placeholder={
                  snap.googleAds.maskedDeveloperToken
                    ? "Leave blank to keep saved legacy token"
                    : "Leave blank (managed in Google Cloud Console)"
                }
                className="adm-input font-mono text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-zinc-700">
                RSL Manager MCC ID (<code className="font-mono">login-customer-id</code>)
              </label>
              <input
                name="loginCustomerId"
                defaultValue={snap.googleAds.loginCustomerId}
                placeholder="123-456-7890"
                className="adm-input font-mono text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-zinc-700">
                Managed Vault Customer ID (Optional)
              </label>
              <input
                name="managedCustomerId"
                defaultValue={snap.googleAds.managedCustomerId}
                placeholder="987-654-3210"
                className="adm-input font-mono text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-zinc-700">
                Managed MCC Refresh Token{" "}
                {snap.googleAds.maskedManagedRefreshToken
                  ? `(${snap.googleAds.maskedManagedRefreshToken})`
                  : "(Optional)"}
              </label>
              <input
                name="managedRefreshToken"
                type="password"
                placeholder={
                  snap.googleAds.maskedManagedRefreshToken
                    ? "Leave blank to keep saved token"
                    : "1//0g... MCC OAuth Refresh Token"
                }
                className="adm-input font-mono text-xs"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <label className="inline-flex items-center gap-2 font-semibold text-slate-800">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={snap.googleAds.enabled}
                className="h-4 w-4 rounded border-zinc-300 text-emerald-600"
              />
              <span>Enable Live Google Ads REST API (v18)</span>
            </label>
            <SubmitButton className="adm-btn-primary" pendingText="Saving Google Ads...">
              Save Google Ads API Credentials
            </SubmitButton>
          </div>
        </form>

        <ProviderLiveTestFooter
          providerKey="google_ads"
          label="Google Ads"
          source={snap.googleAds.source}
          isReady={snap.googleAds.isReady}
          lastVerifiedAt={snap.googleAds.lastVerifiedAt}
          lastVerifyStatus={snap.googleAds.lastVerifyStatus}
          lastVerifyMessage={snap.googleAds.lastVerifyMessage}
        />
      </SectionCard>
      </div>

      {/* 6. Razorpay Automated Gateway */}
      <div id="cred-razorpay" className="scroll-mt-24">
      <SectionCard
        title="6. Razorpay Automated Checkout Gateway (Optional - Alongside Manual UPI QR / UTR)"
        subtitle="Leave unconfigured if collecting zero-fee UPI QR & NEFT UTR transfers; add Razorpay keys anytime to unlock instant automated wallet top-up checkout"
        action={sourcePill(snap.razorpay.source, snap.razorpay.isReady)}
      >
        <form action={staffSaveRazorpayCredentialsAction} className="space-y-3.5 text-xs">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <div>
              <label className="mb-1 block font-semibold text-zinc-700">
                Razorpay Key ID *
              </label>
              <input
                name="keyId"
                required
                defaultValue={snap.razorpay.keyId}
                placeholder="rzp_live_..."
                className="adm-input font-mono text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-zinc-700">
                Razorpay Key Secret{" "}
                {snap.razorpay.maskedKeySecret ? `(${snap.razorpay.maskedKeySecret})` : "*"}
              </label>
              <input
                name="keySecret"
                type="password"
                placeholder={
                  snap.razorpay.maskedKeySecret
                    ? "Leave blank to keep saved Key Secret"
                    : "Razorpay Key Secret"
                }
                className="adm-input font-mono text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-zinc-700">
                Razorpay Webhook Secret{" "}
                {snap.razorpay.maskedWebhookSecret ? `(${snap.razorpay.maskedWebhookSecret})` : ""}
              </label>
              <input
                name="webhookSecret"
                type="password"
                placeholder={
                  snap.razorpay.maskedWebhookSecret
                    ? "Leave blank to keep saved Webhook Secret"
                    : "Optional Razorpay Webhook Secret"
                }
                className="adm-input font-mono text-xs"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <label className="inline-flex items-center gap-2 font-semibold text-slate-800">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={snap.razorpay.enabled}
                className="h-4 w-4 rounded border-zinc-300 text-emerald-600"
              />
              <span>Enable Instant Razorpay Checkout</span>
            </label>
            <SubmitButton className="adm-btn-primary" pendingText="Saving Razorpay...">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Save Razorpay Credentials</span>
            </SubmitButton>
          </div>
        </form>

        <ProviderLiveTestFooter
          providerKey="razorpay"
          label="Razorpay API"
          source={snap.razorpay.source}
          isReady={snap.razorpay.isReady}
          lastVerifiedAt={snap.razorpay.lastVerifiedAt}
          lastVerifyStatus={snap.razorpay.lastVerifyStatus}
          lastVerifyMessage={snap.razorpay.lastVerifyMessage}
        />
      </SectionCard>
      </div>

      {/* 7. Cloudflare Turnstile Bot Protection ($0 Free Unlimited) */}
      <div id="cred-cloudflare_turnstile" className="scroll-mt-24">
      <SectionCard
        title="7. Cloudflare Turnstile Bot Protection ($0 Unlimited Free - Login, Signup & Password Reset)"
        subtitle="Invisible privacy-preserving CAPTCHA replacement from dash.cloudflare.com -> Turnstile -> Add Widget"
        action={sourcePill(snap.turnstile.source, snap.turnstile.isReady)}
      >
        <form action={staffSaveCloudflareTurnstileAction} className="space-y-3.5 text-xs">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div>
              <label className="mb-1 block font-semibold text-zinc-700">Turnstile Site Key *</label>
              <input
                name="siteKey"
                required
                defaultValue={snap.turnstile.siteKey}
                placeholder="0x4AAAAAA..."
                className="adm-input font-mono text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-zinc-700">
                Turnstile Secret Key{" "}
                {snap.turnstile.maskedSecretKey ? `(${snap.turnstile.maskedSecretKey})` : "*"}
              </label>
              <input
                name="secretKey"
                type="password"
                placeholder={
                  snap.turnstile.maskedSecretKey
                    ? "Leave blank to keep saved Secret Key"
                    : "0x4AAAAAA..."
                }
                className="adm-input font-mono text-xs"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <label className="inline-flex items-center gap-2 font-semibold text-slate-800">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={snap.turnstile.enabled}
                className="h-4 w-4 rounded border-zinc-300 text-emerald-600"
              />
              <span>Enable Turnstile on Login, Register &amp; Password Reset</span>
            </label>
            <SubmitButton className="adm-btn-primary" pendingText="Saving Turnstile...">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Save Turnstile Keys</span>
            </SubmitButton>
          </div>
        </form>
        <ProviderLiveTestFooter
          providerKey="cloudflare_turnstile"
          label="Turnstile Secret"
          source={snap.turnstile.source}
          isReady={snap.turnstile.isReady}
          lastVerifiedAt={snap.turnstile.lastVerifiedAt}
          lastVerifyStatus={snap.turnstile.lastVerifyStatus}
          lastVerifyMessage={snap.turnstile.lastVerifyMessage}
        />
      </SectionCard>
      </div>

      {/* 8. Cloudflare Workers AI (10,000 Free Neurons / Day) */}
      <div id="cred-cloudflare_ai" className="scroll-mt-24">
      <SectionCard
        title="8. Cloudflare Workers AI (10,000 Free Neurons/Day - Smart Reviews, Ad Copy, Meta Risk Linter & Whisper)"
        subtitle="Create an API Token at dash.cloudflare.com -> My Profile -> API Tokens with 'Workers AI: Read' permission"
        action={sourcePill(snap.cloudflareAi.source, snap.cloudflareAi.isReady)}
      >
        <form action={staffSaveCloudflareAiAction} className="space-y-3.5 text-xs">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block font-semibold text-zinc-700">
                Cloudflare Account ID *
              </label>
              <input
                name="accountId"
                required
                defaultValue={snap.cloudflareAi.accountId || snap.r2.accountId}
                placeholder="32-char Cloudflare Account ID"
                className="adm-input font-mono text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-zinc-700">
                Workers AI API Token{" "}
                {snap.cloudflareAi.maskedApiToken ? `(${snap.cloudflareAi.maskedApiToken})` : "*"}
              </label>
              <input
                name="apiToken"
                type="password"
                placeholder={
                  snap.cloudflareAi.maskedApiToken
                    ? "Leave blank to keep saved API Token"
                    : "Cloudflare Workers AI Token"
                }
                className="adm-input font-mono text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-zinc-700">Text LLM Model</label>
              <input
                name="textModel"
                defaultValue={snap.cloudflareAi.textModel}
                className="adm-input font-mono text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-zinc-700">Audio Whisper Model</label>
              <input
                name="whisperModel"
                defaultValue={snap.cloudflareAi.whisperModel}
                className="adm-input font-mono text-xs"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <label className="inline-flex items-center gap-2 font-semibold text-slate-800">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={snap.cloudflareAi.enabled}
                className="h-4 w-4 rounded border-zinc-300 text-emerald-600"
              />
              <span>Enable Cloudflare Workers AI across Reviews, Ads, WhatsApp &amp; Vendor Bills</span>
            </label>
            <SubmitButton className="adm-btn-primary" pendingText="Saving Workers AI...">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Save Workers AI Credentials</span>
            </SubmitButton>
          </div>
        </form>
        <ProviderLiveTestFooter
          providerKey="cloudflare_ai"
          label="Workers AI"
          source={snap.cloudflareAi.source}
          isReady={snap.cloudflareAi.isReady}
          lastVerifiedAt={snap.cloudflareAi.lastVerifiedAt}
          lastVerifyStatus={snap.cloudflareAi.lastVerifyStatus}
          lastVerifyMessage={snap.cloudflareAi.lastVerifyMessage}
        />
      </SectionCard>
      </div>

      {/* 9. Cloudflare Email Routing + Workers (Supplier Bill-to-Tally Inbox) */}
      <div id="cred-cloudflare_email_routing" className="scroll-mt-24">
      <SectionCard
        title="9. Cloudflare Email Routing + Workers ($0 Inbound Vendor Bill-to-Tally Inbox)"
        subtitle="Routes bills+<workspace-slug>@<domain> straight into each client's Tally Purchase Draft Inbox"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <GuideDrawerButton
              drawerId="admin-credentials-cloudflare-email-guide"
              label="Worker Script & Guide"
              initialTabId="cloudflare"
              guide={credentialsGuideContent}
            />
            {sourcePill(snap.cloudflareEmail.source, snap.cloudflareEmail.isReady)}
          </div>
        }
      >
        <form action={staffSaveCloudflareEmailRoutingAction} className="space-y-3.5 text-xs">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div>
              <label className="mb-1 block font-semibold text-zinc-700">
                Inbound Email Subdomain / Domain *
              </label>
              <input
                name="inboundDomain"
                required
                defaultValue={snap.cloudflareEmail.inboundDomain || `bills.${endpoints.primaryDomain}`}
                placeholder="bills.rapidshiftlabs.in"
                className="adm-input font-mono text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-zinc-700">
                Webhook Shared Secret{" "}
                {snap.cloudflareEmail.maskedWebhookSecret
                  ? `(${snap.cloudflareEmail.maskedWebhookSecret})`
                  : "(Leave blank to auto-generate)"}
              </label>
              <input
                name="webhookSecret"
                type="password"
                placeholder="Leave blank to auto-generate a 48-char HMAC secret"
                className="adm-input font-mono text-xs"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <label className="inline-flex items-center gap-2 font-semibold text-slate-800">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={snap.cloudflareEmail.enabled}
                className="h-4 w-4 rounded border-zinc-300 text-emerald-600"
              />
              <span>Enable Inbound Supplier Bill Webhook (/api/webhooks/cloudflare-email)</span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <AdminCopyButton text={cfEmailWorkerCode} label="Copy Worker Script" />
              <SubmitButton className="adm-btn-primary" pendingText="Saving Email Routing...">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Save Email Routing Config</span>
              </SubmitButton>
            </div>
          </div>
        </form>

        <ProviderLiveTestFooter
          providerKey="cloudflare_email_routing"
          label="Email Routing & MX"
          source={snap.cloudflareEmail.source}
          isReady={snap.cloudflareEmail.isReady}
          lastVerifiedAt={snap.cloudflareEmail.lastVerifiedAt}
          lastVerifyStatus={snap.cloudflareEmail.lastVerifyStatus}
          lastVerifyMessage={snap.cloudflareEmail.lastVerifyMessage}
        />
      </SectionCard>
      </div>

      {/* 10. W3C Web Push VAPID Keys ($0 Zero External Account Needed) */}
      <div id="cred-web_push_vapid" className="scroll-mt-24">
      <SectionCard
        title="10. W3C Web Push Notifications - VAPID Keys ($0 Forever • Zero Third-Party Account Required)"
        subtitle="RFC 8292 P-256 ECDSA keys for instant desktop & Android Chrome alerts on WhatsApp chats, Tally payments & Google reviews"
        action={sourcePill(snap.vapid.source, snap.vapid.isReady)}
      >
        <form action={staffSaveWebPushVapidAction} className="space-y-3.5 text-xs">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <div>
              <label className="mb-1 block font-semibold text-zinc-700">VAPID Subject (mailto:) *</label>
              <input
                name="subject"
                required
                defaultValue={snap.vapid.subject}
                placeholder="mailto:app@rapidshiftlabs.in"
                className="adm-input font-mono text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-zinc-700">VAPID Public Key</label>
              <input
                name="publicKey"
                defaultValue={snap.vapid.publicKey}
                placeholder="Auto-generated P-256 base64url public key"
                className="adm-input font-mono text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-zinc-700">
                VAPID Private Key{" "}
                {snap.vapid.maskedPrivateKey ? `(${snap.vapid.maskedPrivateKey})` : ""}
              </label>
              <input
                name="privateKey"
                type="password"
                placeholder={
                  snap.vapid.maskedPrivateKey
                    ? "Leave blank to keep saved Private Key"
                    : "Click 'Auto-Generate Keys' below or paste key"
                }
                className="adm-input font-mono text-xs"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <label className="inline-flex items-center gap-2 font-semibold text-slate-800">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={snap.vapid.enabled}
                className="h-4 w-4 rounded border-zinc-300 text-emerald-600"
              />
              <span>Enable Browser &amp; Mobile Web Push Alerts</span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <SubmitButton className="adm-btn-primary" pendingText="Saving VAPID...">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Save VAPID Config</span>
              </SubmitButton>
            </div>
          </div>
        </form>
        <form action={staffSaveWebPushVapidAction} className="mt-2.5">
          <input type="hidden" name="autoGenerate" value="1" />
          <input type="hidden" name="subject" value={snap.vapid.subject} />
          <SubmitButton className="adm-btn-secondary py-1.5 text-xs" pendingText="Generating P-256 Keys...">
            <KeyRound className="h-3.5 w-3.5" />
            <span>1-Click Auto-Generate Fresh VAPID Keypair in Database</span>
          </SubmitButton>
        </form>
        <ProviderLiveTestFooter
          providerKey="web_push_vapid"
          label="VAPID ECDSA Keys"
          source={snap.vapid.source}
          isReady={snap.vapid.isReady}
          lastVerifiedAt={snap.vapid.lastVerifiedAt}
          lastVerifyStatus={snap.vapid.lastVerifyStatus}
          lastVerifyMessage={snap.vapid.lastVerifyMessage}
        />
      </SectionCard>
      </div>

      {/* 11. MeitY Digital India BHASHINI ($0 Regional Indian Language Translation) */}
      <div id="cred-bhashini" className="scroll-mt-24">
      <SectionCard
        title="11. MeitY Digital India BHASHINI ($0 Government AI - 22 Indian Languages)"
        subtitle="Optional: Register free at bhashini.gov.in/ulca for official NMT translation (Hindi, Gujarati, Marathi, Tamil, Telugu, Kannada, Bengali...). Falls back automatically to Cloudflare Workers AI when unconfigured."
        action={sourcePill(snap.bhashini.source, snap.bhashini.isReady)}
      >
        <form action={staffSaveBhashiniCredentialsAction} className="space-y-3.5 text-xs">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <div>
              <label className="mb-1 block font-semibold text-zinc-700">ULCA User ID *</label>
              <input
                name="userId"
                required
                defaultValue={snap.bhashini.userId}
                placeholder="Your Bhashini ULCA userId"
                className="adm-input font-mono text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-zinc-700">
                ULCA API Key{" "}
                {snap.bhashini.maskedUlcaApiKey ? `(${snap.bhashini.maskedUlcaApiKey})` : ""}
              </label>
              <input
                name="ulcaApiKey"
                type="password"
                placeholder={
                  snap.bhashini.maskedUlcaApiKey
                    ? "Leave blank to keep saved ULCA Key"
                    : "Optional ULCA API Key"
                }
                className="adm-input font-mono text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-zinc-700">
                UDYAT Inference API Key{" "}
                {snap.bhashini.maskedInferenceApiKey
                  ? `(${snap.bhashini.maskedInferenceApiKey})`
                  : "*"}
              </label>
              <input
                name="inferenceApiKey"
                type="password"
                placeholder={
                  snap.bhashini.maskedInferenceApiKey
                    ? "Leave blank to keep saved Inference Key"
                    : "Bhashini Inference Authorization Key"
                }
                className="adm-input font-mono text-xs"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <label className="inline-flex items-center gap-2 font-semibold text-slate-800">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={snap.bhashini.enabled}
                className="h-4 w-4 rounded border-zinc-300 text-emerald-600"
              />
              <span>Enable Official Bhashini Regional Indian Translation</span>
            </label>
            <SubmitButton className="adm-btn-primary" pendingText="Saving Bhashini...">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Save Bhashini Credentials</span>
            </SubmitButton>
          </div>
        </form>
        <ProviderLiveTestFooter
          providerKey="bhashini"
          label="Bhashini NMT"
          source={snap.bhashini.source}
          isReady={snap.bhashini.isReady}
          lastVerifiedAt={snap.bhashini.lastVerifiedAt}
          lastVerifyStatus={snap.bhashini.lastVerifyStatus}
          lastVerifyMessage={snap.bhashini.lastVerifyMessage}
        />
      </SectionCard>
      </div>
    </div>
  );
}
