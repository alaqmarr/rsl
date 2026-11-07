/**
 * RapidShift Labs — Database-Controlled Platform Credentials Seeder (`control.db`)
 *
 * Usage examples:
 *   pnpm db:seed-credentials --status
 *   pnpm db:seed-credentials --auto-free
 *   pnpm db:seed-credentials --generate-template credentials.seed.json
 *   pnpm db:seed-credentials --file credentials.seed.json
 *   pnpm db:seed-credentials --from-env
 */

import fs from "node:fs";
import path from "node:path";
import { getEnv } from "@rsl/core";
import {
  buildPlatformCredentialsSeedTemplate,
  ensurePlatformVapidConfig,
  getSafePlatformCredentialsAdminSnapshot,
  savePlatformCloudflareEmailConfig,
  savePlatformVapidConfig,
  seedPlatformCredentialsBundle,
  type PlatformCredentialsSeedBundle,
} from "@rsl/tenancy";

function printStatusTable() {
  const snap = getSafePlatformCredentialsAdminSnapshot();
  const rows = [
    { provider: "google_oauth", ready: snap.google.isReady, source: snap.google.source, detail: snap.google.clientId || "—" },
    {
      provider: "google_ads",
      ready: snap.googleAds.isReady,
      source: snap.googleAds.source,
      detail:
        snap.googleAds.managedCustomerId
          ? `Managed Vault: ${snap.googleAds.managedCustomerId}`
          : snap.googleAds.loginCustomerId
            ? `MCC: ${snap.googleAds.loginCustomerId}`
            : snap.google.isReady
              ? "Cloud Project OAuth (Tokenless)"
              : snap.googleAds.maskedDeveloperToken || "—",
    },
    { provider: "smtp_email", ready: snap.smtp.isReady, source: snap.smtp.source, detail: snap.smtp.user || "—" },
    { provider: "cloudflare_r2", ready: snap.r2.isReady, source: snap.r2.source, detail: snap.r2.bucketPrivate || "—" },
    { provider: "meta_app", ready: snap.meta.isReady, source: snap.meta.source, detail: snap.meta.appId || "—" },
    { provider: "razorpay", ready: snap.razorpay.isReady, source: snap.razorpay.source, detail: snap.razorpay.keyId || "—" },
    { provider: "cloudflare_turnstile", ready: snap.turnstile.isReady, source: snap.turnstile.source, detail: snap.turnstile.siteKey || "—" },
    { provider: "cloudflare_ai", ready: snap.cloudflareAi.isReady, source: snap.cloudflareAi.source, detail: snap.cloudflareAi.textModel || "—" },
    { provider: "cloudflare_email_routing", ready: snap.cloudflareEmail.isReady, source: snap.cloudflareEmail.source, detail: snap.cloudflareEmail.inboundDomain || "—" },
    { provider: "web_push_vapid", ready: snap.vapid.isReady, source: snap.vapid.source, detail: snap.vapid.publicKey ? `${snap.vapid.publicKey.slice(0, 18)}...` : "—" },
    { provider: "bhashini", ready: snap.bhashini.isReady, source: snap.bhashini.source, detail: snap.bhashini.userId || snap.bhashini.maskedInferenceApiKey || "—" },
  ];

  console.log("\n=== RapidShift Labs — Encrypted control.db Credential Vault Status ===");
  console.table(rows);
}

async function main() {
  const args = process.argv.slice(2);
  const env = getEnv();

  if (args.includes("--generate-template")) {
    const idx = args.indexOf("--generate-template");
    const targetFile = args[idx + 1] && !args[idx + 1]!.startsWith("--")
      ? args[idx + 1]!
      : "credentials.seed.json";
    const resolved = path.resolve(process.cwd(), targetFile);
    const tpl = buildPlatformCredentialsSeedTemplate();
    fs.writeFileSync(resolved, JSON.stringify(tpl, null, 2) + "\n", "utf8");
    console.log(`[db:seed-credentials] Wrote template to ${resolved}`);
    console.log(`Fill in your keys and run: pnpm db:seed-credentials --file ${targetFile}`);
    return;
  }

  if (args.includes("--auto-free")) {
    let vapid = ensurePlatformVapidConfig();
    if (
      vapid.subject.includes("thewebsensei.email") ||
      vapid.subject.includes("notifications@")
    ) {
      vapid = savePlatformVapidConfig({
        enabled: true,
        subject: `mailto:app@${env.PRIMARY_DOMAIN || "rapidshiftlabs.in"}`,
        staffId: "cli_auto_free",
      });
    }
    const eml = savePlatformCloudflareEmailConfig({
      enabled: true,
      inboundDomain: env.CF_EMAIL_INBOUND_DOMAIN || env.PRIMARY_DOMAIN || "rapidshiftlabs.in",
      autoGenerateSecret: true,
      staffId: "cli_auto_free",
    });
    console.log(`[db:seed-credentials] Auto-generated & encrypted free VAPID Public Key: ${vapid.publicKey}`);
    console.log(`[db:seed-credentials] Auto-generated & encrypted Inbound Email Domain: bills+<slug>@${eml.inboundDomain}`);
  }

  if (args.includes("--from-env")) {
    const envBundle: PlatformCredentialsSeedBundle = {
      google_oauth:
        env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
          ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
          : undefined,
      google_ads: env.GOOGLE_ADS_DEVELOPER_TOKEN
        ? {
            developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN,
            loginCustomerId: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
            managedCustomerId: env.GOOGLE_ADS_MANAGED_CUSTOMER_ID,
            managedRefreshToken: env.GOOGLE_ADS_MANAGED_REFRESH_TOKEN,
          }
        : undefined,
      smtp_email:
        env.GMAIL_SMTP_USER && env.GMAIL_SMTP_APP_PASSWORD
          ? {
              host: env.SMTP_HOST,
              port: env.SMTP_PORT,
              secure: env.SMTP_SECURE,
              from: env.EMAIL_FROM,
              user: env.GMAIL_SMTP_USER,
              password: env.GMAIL_SMTP_APP_PASSWORD,
            }
          : undefined,
      cloudflare_r2:
        env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET_PRIVATE
          ? {
              accountId: env.R2_ACCOUNT_ID,
              accessKeyId: env.R2_ACCESS_KEY_ID,
              secretAccessKey: env.R2_SECRET_ACCESS_KEY,
              bucketPrivate: env.R2_BUCKET_PRIVATE,
              bucketPublic: env.R2_BUCKET_PUBLIC,
              publicBaseUrl: env.R2_PUBLIC_BASE_URL,
            }
          : undefined,
      meta_app:
        env.META_APP_ID && env.META_APP_SECRET
          ? {
              appId: env.META_APP_ID,
              appSecret: env.META_APP_SECRET,
              verifyToken: env.META_WEBHOOK_VERIFY_TOKEN,
              configId: env.META_CONFIG_ID,
              managedAdAccountId: env.META_MANAGED_AD_ACCOUNT_ID,
              managedPageId: env.META_MANAGED_PAGE_ID,
              managedSystemToken: env.META_MANAGED_SYSTEM_TOKEN,
            }
          : undefined,
      razorpay:
        env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET
          ? {
              keyId: env.RAZORPAY_KEY_ID,
              keySecret: env.RAZORPAY_KEY_SECRET,
              webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
            }
          : undefined,
      cloudflare_turnstile:
        env.CF_TURNSTILE_SITE_KEY && env.CF_TURNSTILE_SECRET_KEY
          ? { siteKey: env.CF_TURNSTILE_SITE_KEY, secretKey: env.CF_TURNSTILE_SECRET_KEY }
          : undefined,
      cloudflare_ai:
        (env.CF_AI_ACCOUNT_ID || env.R2_ACCOUNT_ID) && env.CF_AI_API_TOKEN
          ? {
              accountId: env.CF_AI_ACCOUNT_ID || env.R2_ACCOUNT_ID,
              apiToken: env.CF_AI_API_TOKEN,
              textModel: env.CF_AI_TEXT_MODEL,
              whisperModel: env.CF_AI_WHISPER_MODEL,
            }
          : undefined,
      cloudflare_email_routing: env.CF_EMAIL_WEBHOOK_SECRET
        ? {
            inboundDomain: env.CF_EMAIL_INBOUND_DOMAIN || env.PRIMARY_DOMAIN,
            webhookSecret: env.CF_EMAIL_WEBHOOK_SECRET,
          }
        : undefined,
      web_push_vapid:
        env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
          ? {
              subject: env.VAPID_SUBJECT,
              publicKey: env.VAPID_PUBLIC_KEY,
              privateKeyD: env.VAPID_PRIVATE_KEY,
            }
          : undefined,
      bhashini:
        env.BHASHINI_INFERENCE_API_KEY || (env.BHASHINI_USER_ID && env.BHASHINI_ULCA_API_KEY)
          ? {
              userId: env.BHASHINI_USER_ID,
              ulcaApiKey: env.BHASHINI_ULCA_API_KEY,
              inferenceApiKey: env.BHASHINI_INFERENCE_API_KEY,
            }
          : undefined,
    };
    const res = seedPlatformCredentialsBundle(envBundle, "cli_from_env");
    console.log(`[db:seed-credentials] Imported from .env into control.db -> Seeded: [${res.seeded.join(", ") || "none"}]`);
  }

  if (args.includes("--file")) {
    const idx = args.indexOf("--file");
    const fileArg = args[idx + 1];
    if (!fileArg) {
      throw new Error("Provide a JSON path after --file, e.g. pnpm db:seed-credentials --file credentials.seed.json");
    }
    const resolved = path.resolve(process.cwd(), fileArg);
    const raw = fs.readFileSync(resolved, "utf8");
    const parsed = JSON.parse(raw) as PlatformCredentialsSeedBundle;
    const res = seedPlatformCredentialsBundle(parsed, "cli_json_seed");
    console.log(`[db:seed-credentials] Seeded into control.db (${res.seeded.length}): ${res.seeded.join(", ") || "none"}`);
    if (res.skipped.length > 0) {
      console.log(`[db:seed-credentials] Skipped placeholders (${res.skipped.length}): ${res.skipped.join(", ")}`);
    }
  }

  printStatusTable();
}

main().catch((err) => {
  console.error("[db:seed-credentials] Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
