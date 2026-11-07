import { headers } from "next/headers";
import { AlertTriangle, CheckCircle2, Database, KeyRound, MailCheck, ShieldCheck } from "lucide-react";
import { canStaffAccessAdminRoute, formatStaffRoleLabel } from "@rsl/auth";
import { getEnv, isLoopbackUrlOrHost, resolveEndpointsFromHeaders } from "@rsl/core";
import {
  buildCloudflareEmailWorkerSnippet,
  buildPlatformCredentialsSeedTemplate,
  getPlatformCloudflareEmailConfig,
  getSafePlatformCredentialsAdminSnapshot,
  type CredentialSource,
} from "@rsl/tenancy";
import {
  AccessRestrictedState,
  FlashBanner,
  MetricCard,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@rsl/ui";
import { AdminCopyButton, SubmitButton } from "@/components/ios-feedback";
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

  const cfEmailFull = getPlatformCloudflareEmailConfig();
  const cfEmailWorkerCode = buildCloudflareEmailWorkerSnippet(googleOrigin);
  const seedTemplateJson = JSON.stringify(buildPlatformCredentialsSeedTemplate(), null, 2);

  const dbActiveCount = [
    snap.google.source,
    snap.googleAds.source,
    snap.smtp.source,
    snap.r2.source,
    snap.meta.source,
    snap.razorpay.source,
    snap.turnstile.source,
    snap.cloudflareAi.source,
    snap.cloudflareEmail.source,
    snap.vapid.source,
    snap.bhashini.source,
  ].filter((s) => s === "database").length;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Database-Controlled Platform Vault (AES-256-GCM)"
        title="OAuth & API Credentials"
        subtitle="Configure the official RapidShift Labs Google OAuth Consent Screen (for 1-click customer Google Drive & Business Profile connections), SMTP email, Cloudflare R2, Meta App, and Razorpay — stored encrypted in control.db with zero SSH or .env restarts needed."
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      {/* Top Readiness Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
          label="Managed Cloudflare R2"
          value={snap.r2.isReady ? "R2 Active" : "Local Disk"}
          sublabel={
            snap.r2.isReady
              ? `Bucket: ${snap.r2.bucketPrivate}`
              : "Optional S3/R2 cloud object tier"
          }
          accent={snap.r2.isReady ? "emerald" : "default"}
        />
        <MetricCard
          label="DB-Controlled Providers"
          value={`${dbActiveCount} / 11`}
          sublabel="Encrypted with KMS envelope keys in control.db"
          accent="emerald"
        />
      </div>

      {/* Bulk Database Credential Seeder (1-Click JSON Seed or CLI Command) */}
      <details className="group rounded-2xl border border-emerald-200/90 bg-emerald-50/35 shadow-2xs">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-6 py-4 select-none">
          <div className="flex items-center gap-2.5">
            <Database className="h-4 w-4 text-emerald-700" />
            <div>
              <div className="text-sm font-bold text-slate-900">
                Bulk Seed Credentials Directly into Database (JSON Bundle or CLI Seeder)
              </div>
              <div className="text-xs text-zinc-600">
                Seed all 11 providers at once via encrypted JSON paste/upload here, or via CLI:{" "}
                <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-900">
                  pnpm db:seed-credentials --file ./credentials.seed.json
                </code>
              </div>
            </div>
          </div>
          <AdminCopyButton text={seedTemplateJson} label="Copy JSON Seed Template" />
        </summary>
        <div className="space-y-3.5 border-t border-emerald-200/60 bg-white p-6 text-xs">
          <p className="text-zinc-600">
            Paste a partial or complete JSON object matching the template (any blank or omitted provider is untouched;{" "}
            <code className="font-mono">web_push_vapid.autoGenerate: true</code> generates fresh P-256 keys automatically).
          </p>
          <form action={staffBulkSeedPlatformCredentialsJsonAction} className="space-y-3">
            <textarea
              name="credentialsJson"
              rows={7}
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

      {/* Complete Minute-by-Minute Admin Guide for Google OAuth Consent Screen (Auto-expands until Google OAuth is Ready) */}
      <details
        open={!snap.google.isReady}
        className="group rounded-2xl border border-zinc-200/90 bg-white shadow-2xs"
      >
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-6 py-4 select-none">
          <div>
            <div className="text-sm font-bold text-slate-900">
              Complete Admin Setup Guide — RapidShift Labs Google OAuth Screen (1-Click Customer Drive)
            </div>
            <div className="text-xs text-zinc-500">
              {snap.google.isReady
                ? "Google OAuth is active — click to review the 6 Google Cloud Console setup steps or copy Authorized Callback URLs"
                : "Do this ONCE on the Admin side so every RapidShift Labs customer can connect their own Google Drive in 2 clicks"}
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-800">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            <span>Zero CASA Audit Needed (drive.file)</span>
          </span>
        </summary>
        <div className="space-y-5 border-t border-zinc-100 p-6 text-xs">
          {/* Why Service Account JSON Fails Callout */}
          <div className="rounded-2xl border border-amber-300/90 bg-amber-50/85 p-4 text-amber-950">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div className="space-y-1">
                <div className="text-[13px] font-bold">
                  Why Google&apos;s &ldquo;Service Account&rdquo; JSON Confused Everyone (Do NOT Create a Service Account!)
                </div>
                <p className="leading-relaxed text-amber-950/90">
                  In Google Cloud Console, clicking{" "}
                  <code className="rounded bg-white/80 px-1.5 py-0.5 font-mono text-[11px]">
                    Create Credentials → Service account
                  </code>{" "}
                  generates a robot JSON key (<code className="font-mono">&quot;type&quot;: &quot;service_account&quot;</code>). Service accounts have{" "}
                  <strong>0 GB personal Google Drive storage quota</strong> and{" "}
                  <strong>cannot show Google&apos;s &ldquo;Sign in with Google&rdquo; screen</strong>! Instead, follow the 6 exact steps below to create{" "}
                  <strong>ONE OAuth 2.0 Web Application Client</strong> for <strong>RapidShift Labs</strong>. Our form below automatically blocks accidental Service Account JSONs so you can never paste the wrong file.
                </p>
              </div>
            </div>
          </div>

          {/* Exact Copy-Paste URLs for Google Cloud Console */}
          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
            <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/80 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-900">
                  1. Authorized JavaScript Origin (Copy into Google Cloud)
                </span>
                <AdminCopyButton text={googleOrigin} label="Copy Origin" />
              </div>
              <div className="mt-1.5 break-all rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-[11px] font-semibold text-emerald-800">
                {googleOrigin}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/80 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-900">
                  2. Authorized Redirect URI (Exact Callback URL)
                </span>
                <AdminCopyButton text={googleRedirectUri} label="Copy Redirect URI" />
              </div>
              <div className="mt-1.5 break-all rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-[11px] font-semibold text-emerald-800">
                {googleRedirectUri}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/80 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-900">
                  3. Authorized Domain (OAuth Consent Branding)
                </span>
                <AdminCopyButton text={endpoints.primaryDomain} label="Copy Domain" />
              </div>
              <div className="mt-1.5 break-all rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-[11px] font-semibold text-slate-900">
                {endpoints.primaryDomain}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/80 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-900">
                  4. Required OAuth Scopes (Non-Sensitive drive.file)
                </span>
                <AdminCopyButton text={googleScopesText} label="Copy Scopes" />
              </div>
              <div className="mt-1.5 break-all rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-[11px] text-slate-800">
                {googleScopesText}
              </div>
            </div>
          </div>

          {/* 6 Minute-by-Minute Steps */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-xl border border-zinc-200/90 bg-white p-3.5">
              <div className="font-bold text-slate-900">
                Step 1 • Create Google Cloud Project
              </div>
              <p className="mt-1 leading-relaxed text-zinc-600">
                Open <code className="font-mono">console.cloud.google.com</code>, sign in with your founder Google account, click the project dropdown at top-left → <strong>New Project</strong> → Name it{" "}
                <strong>RapidShift Labs</strong> → click <strong>Create</strong> and make sure it is selected at top-left.
              </p>
            </div>

            <div className="rounded-xl border border-zinc-200/90 bg-white p-3.5">
              <div className="font-bold text-slate-900">
                Step 2 • Enable Google Drive API
              </div>
              <p className="mt-1 leading-relaxed text-zinc-600">
                In the left sidebar, open <strong>APIs &amp; Services → Library</strong>. Search for{" "}
                <strong>Google Drive API</strong>, click it, and click the blue <strong>Enable</strong> button.{" "}
                <em>(Optional for Google Reviews: also enable My Business Account Management API &amp; My Business Business Information API.)</em>
              </p>
            </div>

            <div className="rounded-xl border border-zinc-200/90 bg-white p-3.5">
              <div className="font-bold text-slate-900">
                Step 3 • Configure Consent Screen Branding
              </div>
              <p className="mt-1 leading-relaxed text-zinc-600">
                Open <strong>APIs &amp; Services → OAuth consent screen</strong> (or <strong>Google Auth Platform → Branding</strong>). Select{" "}
                <strong>External</strong> user type → App name: <strong>RapidShift Labs</strong> → Support email: your email →{" "}
                <strong>Authorized domains</strong>: add <code className="font-mono">{endpoints.primaryDomain}</code> → Save.
              </p>
            </div>

            <div className="rounded-xl border border-zinc-200/90 bg-white p-3.5">
              <div className="font-bold text-slate-900">
                Step 4 • Add Non-Sensitive drive.file Scope
              </div>
              <p className="mt-1 leading-relaxed text-zinc-600">
                Open <strong>Data Access / Scopes → Add or remove scopes</strong>. Tick <code className="font-mono">openid</code>,{" "}
                <code className="font-mono">userinfo.email</code>, <code className="font-mono">userinfo.profile</code>, and{" "}
                <code className="font-mono">https://www.googleapis.com/auth/drive.file</code>. Because <code className="font-mono">drive.file</code> only touches RapidShift Labs&apos;s own backup folder, Google classifies it as <strong>non-sensitive</strong> (no paid CASA audit!).
              </p>
            </div>

            <div className="rounded-xl border border-zinc-200/90 bg-white p-3.5">
              <div className="font-bold text-slate-900">
                Step 5 • Click &ldquo;PUBLISH APP&rdquo; (Critical!)
              </div>
              <p className="mt-1 leading-relaxed text-zinc-600">
                Open <strong>Audience</strong> (under Google Auth Platform) and click <strong>PUBLISH APP → Confirm</strong> so status changes from{" "}
                <em>Testing</em> to <strong>In production</strong>. If left in Testing, only manually listed test emails can sign in AND Google expires refresh tokens after 7 days!
              </p>
            </div>

            <div className="rounded-xl border border-zinc-200/90 bg-white p-3.5">
              <div className="font-bold text-slate-900">
                Step 6 • Create &ldquo;Web application&rdquo; OAuth Client
              </div>
              <p className="mt-1 leading-relaxed text-zinc-600">
                Go to <strong>APIs &amp; Services → Credentials → + Create Credentials → OAuth client ID</strong>. Choose{" "}
                <strong>Application type: Web application</strong> (NEVER Service Account!). Paste the{" "}
                <strong>Authorized JavaScript Origin</strong> and <strong>Authorized Redirect URI</strong> above, click{" "}
                <strong>Create</strong>, and paste the Client ID &amp; Secret (or <code className="font-mono">client_secret_*.json</code>) below!
              </p>
            </div>
          </div>
        </div>
      </details>

      {/* Complete Step-by-Step Admin Guide for Meta / Facebook Login for Business & Webhooks */}
      <details
        open={!snap.meta.isReady}
        className="group rounded-2xl border border-zinc-200/90 bg-white shadow-2xs"
      >
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-6 py-4 select-none">
          <div>
            <div className="text-sm font-bold text-slate-900">
              Complete Admin Setup Guide — Meta / Facebook Login for Business, Ads &amp; WhatsApp OAuth Screen
            </div>
            <div className="text-xs text-zinc-500">
              {snap.meta.isReady
                ? "Meta App credentials are saved — click to copy Valid OAuth Redirect URIs, Webhook URLs, Legal URLs, or Login for Business Scopes"
                : "Do this ONCE in developers.facebook.com so clients can connect Facebook Pages, Instagram, Meta Ads, Pixels & WhatsApp in 1 click"}
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-bold text-sky-800">
            <ShieldCheck className="h-3.5 w-3.5 text-sky-600" />
            <span>Business App + Login Configuration Ready</span>
          </span>
        </summary>
        <div className="space-y-5 border-t border-zinc-100 p-6 text-xs">
          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
            <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/80 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-900">
                  1. Valid OAuth Redirect URI (Facebook Login → Settings)
                </span>
                <AdminCopyButton text={metaRedirectUri} label="Copy OAuth URI" />
              </div>
              <div className="mt-1.5 break-all rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-[11px] font-semibold text-emerald-800">
                {metaRedirectUri}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/80 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-900">
                  2. Meta Pages / Instagram / Lead Ads Webhook URL
                </span>
                <AdminCopyButton text={metaWebhookUri} label="Copy Meta Webhook" />
              </div>
              <div className="mt-1.5 break-all rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-[11px] font-semibold text-emerald-800">
                {metaWebhookUri}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/80 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-900">
                  3. WhatsApp Cloud API Webhook Callback URL
                </span>
                <AdminCopyButton text={whatsappWebhookUri} label="Copy WA Webhook" />
              </div>
              <div className="mt-1.5 break-all rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-[11px] font-semibold text-emerald-800">
                {whatsappWebhookUri}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/80 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-900">
                  4. Required Permissions (Login for Business Configuration)
                </span>
                <AdminCopyButton text={metaScopesText} label="Copy Scopes" />
              </div>
              <div className="mt-1.5 break-all rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-[11px] text-slate-800">
                {metaScopesText}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/80 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-slate-900">
                App Basic Settings — Required Legal URLs (Already Live on Your App!)
              </span>
              <AdminCopyButton text={metaLegalUrlsText} label="Copy All 3 URLs" />
            </div>
            <div className="mt-1.5 break-all rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-[11px] text-slate-800">
              {metaLegalUrlsText}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-xl border border-zinc-200/90 bg-white p-3.5">
              <div className="font-bold text-slate-900">Step 1 • Create &ldquo;Business&rdquo; Meta App</div>
              <p className="mt-1 leading-relaxed text-zinc-600">
                Open <code className="font-mono">developers.facebook.com/apps</code> → <strong>Create App</strong> → Choose{" "}
                <strong>Other → Business</strong> → App Name: <strong>RapidShift Labs</strong> → attach your Meta Business Portfolio.
              </p>
            </div>
            <div className="rounded-xl border border-zinc-200/90 bg-white p-3.5">
              <div className="font-bold text-slate-900">Step 2 • App Settings → Basic</div>
              <p className="mt-1 leading-relaxed text-zinc-600">
                Add App Domain <code className="font-mono">app.{endpoints.primaryDomain}</code>, upload your square app icon, and paste the{" "}
                <strong>Privacy Policy</strong>, <strong>Terms of Service</strong>, and <strong>User Data Deletion</strong> URLs above. Copy{" "}
                <strong>App ID</strong> &amp; <strong>App Secret</strong> into Section 4 below.
              </p>
            </div>
            <div className="rounded-xl border border-zinc-200/90 bg-white p-3.5">
              <div className="font-bold text-slate-900">Step 3 • Facebook Login for Business</div>
              <p className="mt-1 leading-relaxed text-zinc-600">
                Add product <strong>Facebook Login for Business</strong>. Under <strong>Settings</strong>, enable{" "}
                <em>Client OAuth Login</em> + <em>Web OAuth Login</em> and paste <code className="font-mono">{metaRedirectUri}</code> into{" "}
                <strong>Valid OAuth Redirect URIs</strong>.
              </p>
            </div>
            <div className="rounded-xl border border-zinc-200/90 bg-white p-3.5">
              <div className="font-bold text-slate-900">Step 4 • Create Login Configuration ID</div>
              <p className="mt-1 leading-relaxed text-zinc-600">
                Open <strong>Facebook Login for Business → Configurations → + Create Configuration</strong> → Token type:{" "}
                <strong>System user access token</strong> (or User access token) → select Assets &amp; Permissions above → paste the resulting{" "}
                <strong>Configuration ID</strong> into <em>Embedded Config ID</em> in Section 4 below.
              </p>
            </div>
            <div className="rounded-xl border border-zinc-200/90 bg-white p-3.5">
              <div className="font-bold text-slate-900">Step 5 • Add Webhooks (Pages, IG, WhatsApp)</div>
              <p className="mt-1 leading-relaxed text-zinc-600">
                Add products <strong>Webhooks</strong>, <strong>Marketing API</strong>, <strong>Instagram</strong>, and <strong>WhatsApp</strong>. Point Page/Instagram webhooks (<code className="font-mono">messages, feed, leadgen</code>) to{" "}
                <code className="font-mono">/api/webhooks/meta</code> and WhatsApp (<code className="font-mono">messages</code>) to{" "}
                <code className="font-mono">/api/webhooks/whatsapp</code> using your <strong>Global Verify Token</strong>.
              </p>
            </div>
            <div className="rounded-xl border border-zinc-200/90 bg-white p-3.5">
              <div className="font-bold text-slate-900">Step 6 • Business Verification &amp; Live Mode</div>
              <p className="mt-1 leading-relaxed text-zinc-600">
                While in <strong>Development Mode</strong>, your own admin/tester accounts work immediately. To let external clients sign in, complete{" "}
                <strong>Business Verification</strong> (GST/MSME certificate) + request <strong>Advanced Access</strong> in{" "}
                <em>App Review → Permissions and Features</em>, then toggle top bar to <strong>Live</strong>.
              </p>
            </div>
          </div>
        </div>
      </details>

      {/* 1. Google OAuth 2.0 Web Client Vault */}
      <SectionCard
        title="1. Google OAuth 2.0 Web Application Credentials (RapidShift Labs Consent Screen)"
        subtitle="Powers 1-click 'Connect Google Drive with Google' on /backups & /connections, plus 1-click Google Business Profile sign-in"
        action={sourcePill(snap.google.source, snap.google.isReady)}
      >
        <form action={staffSaveGoogleOAuthCredentialsAction} className="space-y-4 text-xs">
          <div className="rounded-xl border border-emerald-200/90 bg-emerald-50/50 p-4">
            <label className="mb-1.5 block font-bold text-slate-900">
              Quick Import (Optional): Upload or Paste Google&apos;s Downloaded{" "}
              <code className="font-mono">client_secret_*.json</code>
            </label>
            <p className="mb-2.5 text-[11px] text-zinc-600">
              If you clicked &ldquo;Download JSON&rdquo; after creating your <strong>Web application</strong> OAuth Client ID, upload or paste it here — we auto-extract{" "}
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
                    (Saved: {snap.google.maskedClientSecret} — leave blank to keep)
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
                <option value="production">In Production (Published — Recommended)</option>
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
                ? `Last updated in control.db: ${new Date(snap.google.updatedAt).toLocaleString("en-IN")}`
                : "Not saved in database yet — save above to enable 1-click Google Sign-In."}
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

        {snap.google.source === "database" && (
          <form action={staffClearPlatformCredentialAction} className="mt-3 border-t border-zinc-100 pt-3">
            <input type="hidden" name="providerKey" value="google_oauth" />
            <SubmitButton className="adm-btn-secondary py-1 text-[11px]" pendingText="Clearing...">
              Remove Database Override (Revert to Server .env)
            </SubmitButton>
          </form>
        )}
      </SectionCard>

      {/* 2. Outbound SMTP / Transactional Email Credentials */}
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
                      (Saved: {snap.smtp.maskedPassword} — leave blank to keep)
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
                  Send Live Verification Email
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
              <SubmitButton className="adm-btn-secondary" pendingText="Sending Live Email...">
                <MailCheck className="h-3.5 w-3.5 text-emerald-600" />
                <span>Send Live Test Email</span>
              </SubmitButton>
            </form>
            {snap.smtp.lastVerifyMessage && (
              <p
                className={`mt-2 text-[11px] font-medium ${
                  snap.smtp.lastVerifyStatus === "healthy" ? "text-emerald-700" : "text-rose-700"
                }`}
              >
                {snap.smtp.lastVerifyStatus === "healthy" ? "✓ " : "⚠ "}
                {snap.smtp.lastVerifyMessage}
              </p>
            )}
          </div>

          {snap.smtp.source === "database" && (
            <form action={staffClearPlatformCredentialAction}>
              <input type="hidden" name="providerKey" value="smtp_email" />
              <SubmitButton className="adm-btn-secondary py-1 text-[11px]" pendingText="Clearing...">
                Remove Database Override (Revert to Server .env)
              </SubmitButton>
            </form>
          )}
        </div>
      </SectionCard>

      {/* 3. Managed Cloud Storage — Cloudflare R2 & 4. Meta / Razorpay Grid */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* 3. Managed Cloudflare R2 */}
        <SectionCard
          title="3. Managed Cloud Storage — Cloudflare R2 / S3"
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

          {snap.r2.source === "database" && (
            <form action={staffClearPlatformCredentialAction} className="mt-3 border-t border-zinc-100 pt-3">
              <input type="hidden" name="providerKey" value="cloudflare_r2" />
              <SubmitButton className="adm-btn-secondary py-1 text-[11px]" pendingText="Clearing...">
                Remove Database Override
              </SubmitButton>
            </form>
          )}
        </SectionCard>

        {/* 4. Meta / WhatsApp Platform App & Managed BM */}
        <SectionCard
          title="4. Meta / WhatsApp Platform App & Managed BM"
          subtitle="Powers 1-Click Facebook/Meta OAuth, X-Hub-Signature-256 webhooks, and optional RSL Managed Ad Spend Vault"
          action={sourcePill(snap.meta.source, snap.meta.isReady)}
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
                Optional — RSL Managed Ad Spend Vault (Master Business Manager Account)
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

          {snap.meta.source === "database" && (
            <form action={staffClearPlatformCredentialAction} className="mt-3 border-t border-zinc-100 pt-3">
              <input type="hidden" name="providerKey" value="meta_app" />
              <SubmitButton className="adm-btn-secondary py-1 text-[11px]" pendingText="Clearing...">
                Remove Database Override
              </SubmitButton>
            </form>
          )}
        </SectionCard>
      </div>

      {/* 4B. Google Ads Cloud Project Access & Optional Managed MCC */}
      <SectionCard
        title="5. Google Ads API & Managed Ad Vault (Cloud Project Access — No Developer Token Required)"
        subtitle="Google sunset Developer Tokens — Direct Client 1-Click Google Ads works automatically via your Google Cloud OAuth Client ID above once Google Ads API is enabled & upgraded to Explorer/Basic Access in Google Cloud Console. Fill the optional Managed MCC fields below only if running RSL-funded Managed Vault campaigns."
        action={sourcePill(snap.googleAds.source, snap.googleAds.isReady)}
      >
        <form action={staffSaveGoogleAdsCredentialsAction} className="space-y-3.5 text-xs">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block font-semibold text-zinc-700">
                Legacy Developer Token{" "}
                {snap.googleAds.maskedDeveloperToken
                  ? `(${snap.googleAds.maskedDeveloperToken})`
                  : "(Not Required — Sunset)"}
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

        {snap.googleAds.source === "database" && (
          <form action={staffClearPlatformCredentialAction} className="mt-3 border-t border-zinc-100 pt-3">
            <input type="hidden" name="providerKey" value="google_ads" />
            <SubmitButton className="adm-btn-secondary py-1 text-[11px]" pendingText="Clearing...">
              Remove Database Override
            </SubmitButton>
          </form>
        )}
      </SectionCard>

      {/* 6. Razorpay Automated Gateway */}
      <SectionCard
        title="6. Razorpay Automated Checkout Gateway (Optional — Alongside Manual UPI QR / UTR)"
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

        {snap.razorpay.source === "database" && (
          <form action={staffClearPlatformCredentialAction} className="mt-3 border-t border-zinc-100 pt-3">
            <input type="hidden" name="providerKey" value="razorpay" />
            <SubmitButton className="adm-btn-secondary py-1 text-[11px]" pendingText="Clearing...">
              Remove Database Override
            </SubmitButton>
          </form>
        )}
      </SectionCard>

      {/* 7. Cloudflare Turnstile Bot Protection ($0 Free Unlimited) */}
      <SectionCard
        title="7. Cloudflare Turnstile Bot Protection ($0 Unlimited Free — Login, Signup & Password Reset)"
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
        {snap.turnstile.source === "database" && (
          <form action={staffClearPlatformCredentialAction} className="mt-3 border-t border-zinc-100 pt-3">
            <input type="hidden" name="providerKey" value="cloudflare_turnstile" />
            <SubmitButton className="adm-btn-secondary py-1 text-[11px]" pendingText="Clearing...">
              Remove Database Override
            </SubmitButton>
          </form>
        )}
      </SectionCard>

      {/* 8. Cloudflare Workers AI (10,000 Free Neurons / Day) */}
      <SectionCard
        title="8. Cloudflare Workers AI (10,000 Free Neurons/Day — Smart Reviews, Ad Copy, Meta Risk Linter & Whisper)"
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
        {snap.cloudflareAi.source === "database" && (
          <form action={staffClearPlatformCredentialAction} className="mt-3 border-t border-zinc-100 pt-3">
            <input type="hidden" name="providerKey" value="cloudflare_ai" />
            <SubmitButton className="adm-btn-secondary py-1 text-[11px]" pendingText="Clearing...">
              Remove Database Override
            </SubmitButton>
          </form>
        )}
      </SectionCard>

      {/* 9. Cloudflare Email Routing + Workers (Supplier Bill-to-Tally Inbox) */}
      <SectionCard
        title="9. Cloudflare Email Routing + Workers ($0 Inbound Vendor Bill-to-Tally Inbox)"
        subtitle="Routes bills+<workspace-slug>@<domain> straight into each client's Tally Purchase Draft Inbox"
        action={sourcePill(snap.cloudflareEmail.source, snap.cloudflareEmail.isReady)}
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
            <SubmitButton className="adm-btn-primary" pendingText="Saving Email Routing...">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Save Email Routing Config</span>
            </SubmitButton>
          </div>
        </form>

        <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-slate-900">
              Copy-Paste Cloudflare Email Worker Script (Email -&gt; Email Routing -&gt; Email Workers)
            </span>
            <AdminCopyButton text={cfEmailWorkerCode} label="Copy Worker Script" />
          </div>
          <pre className="mt-2 max-h-44 overflow-x-auto rounded-lg border border-zinc-200 bg-white p-3 font-mono text-[11px] text-slate-800">
            {cfEmailWorkerCode}
          </pre>
        </div>

        {snap.cloudflareEmail.source === "database" && (
          <form action={staffClearPlatformCredentialAction} className="mt-3 border-t border-zinc-100 pt-3">
            <input type="hidden" name="providerKey" value="cloudflare_email_routing" />
            <SubmitButton className="adm-btn-secondary py-1 text-[11px]" pendingText="Clearing...">
              Remove Database Override
            </SubmitButton>
          </form>
        )}
      </SectionCard>

      {/* 10. W3C Web Push VAPID Keys ($0 Zero External Account Needed) */}
      <SectionCard
        title="10. W3C Web Push Notifications — VAPID Keys ($0 Forever • Zero Third-Party Account Required)"
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
      </SectionCard>

      {/* 11. MeitY Digital India BHASHINI ($0 Regional Indian Language Translation) */}
      <SectionCard
        title="11. MeitY Digital India BHASHINI ($0 Government AI — 22 Indian Languages)"
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
        {snap.bhashini.source === "database" && (
          <form action={staffClearPlatformCredentialAction} className="mt-3 border-t border-zinc-100 pt-3">
            <input type="hidden" name="providerKey" value="bhashini" />
            <SubmitButton className="adm-btn-secondary py-1 text-[11px]" pendingText="Clearing...">
              Remove Database Override
            </SubmitButton>
          </form>
        )}
      </SectionCard>
    </div>
  );
}
