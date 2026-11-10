import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { z } from "zod";

function findMonorepoRoot(startDir: string): string {
  let current = path.resolve(startDir);
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(startDir);
}

const REPO_ROOT = findMonorepoRoot(process.cwd());

function loadDotEnvIfNeeded(): void {
  const loaderPath = path.join(REPO_ROOT, "scripts", "load-root-env.cjs");
  if (!fs.existsSync(loaderPath)) return;
  const requireFromRoot = createRequire(path.join(REPO_ROOT, "package.json"));
  const { loadMonorepoRootEnv } = requireFromRoot(loaderPath) as {
    loadMonorepoRootEnv: (opts?: { rootDir?: string }) => Record<string, string>;
  };
  loadMonorepoRootEnv({ rootDir: REPO_ROOT });
}

loadDotEnvIfNeeded();

function resolveStorageDir(raw: string, fallbackRel: string): string {
  const target = raw.trim() || fallbackRel;
  if (path.isAbsolute(target)) {
    return path.normalize(target);
  }
  return path.resolve(REPO_ROOT, target);
}

function deterministicDevSecret(seed: string): string {
  return crypto.createHash("sha256").update(`rsl-dev-${seed}-${REPO_ROOT}`).digest("base64");
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PRIMARY_DOMAIN: z.string().default("rapidshiftlabs.in"),
  APP_SUBDOMAIN: z.string().default("app"),
  ADMIN_SUBDOMAIN: z.string().default("admin"),
  DOCS_SUBDOMAIN: z.string().default("docs"),
  SETUP_SUBDOMAIN: z.string().default("setup"),
  TALLY_SUBDOMAIN: z.string().optional().default(""),
  TALLY_WILDCARD_ZONE: z.string().default("tally"),
  API_WILDCARD_ZONE: z.string().default("api"),
  SSL_CERT_DIR: z.string().default(".rsl-data/ssl"),
  SSL_ACME_EMAIL: z.string().default("app@rapidshiftlabs.in"),
  SSL_PROVISION_MODE: z
    .enum(["auto", "certbot_webroot", "certbot_nginx", "certbot_dns", "caddy_api", "managed_wildcard"])
    .default("auto"),
  SSL_PROVISION_COMMAND: z.string().optional().default(""),
  SETUP_URL: z.string().url().default("http://localhost:4501/setup"),
  SETUP_BOOTSTRAP_TOKEN: z.string().optional().default(""),
  APP_URL: z.string().url().default("http://localhost:4500"),
  ADMIN_URL: z.string().url().default("http://localhost:4501"),
  DOCS_URL: z.string().url().default("http://localhost:4502"),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(4500).max(4600).default(4510),
  CLEANUP_SERVICE_PORT: z.coerce.number().int().min(4500).max(4600).default(4520),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

  DATA_DIR: z.string().default(".rsl-data"),
  LOG_DIR: z.string().default(".rsl-logs"),
  BACKUP_STAGING_DIR: z.string().default(".rsl-data/staging"),
  TENANT_DB_MAX_OPEN: z.coerce.number().int().min(10).max(2000).default(200),
  TENANT_DB_IDLE_CLOSE_MS: z.coerce.number().int().min(5000).default(300000),

  REDIS_URL: z.string().optional().default(""),

  BETTER_AUTH_SECRET: z.string().default(""),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:4500"),
  ADMIN_AUTH_SECRET: z.string().default(""),
  INTERNAL_SERVICE_SECRET: z.string().optional().default(""),
  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),

  KMS_MASTER_KEY: z.string().default(""),
  KMS_KEY_VERSION: z.coerce.number().int().min(1).default(1),
  BACKUP_SIGNING_KEY: z.string().default(""),
  BACKUP_SIGNING_KEY_VERSION: z.coerce.number().int().min(1).default(1),
  API_KEY_PEPPER: z.string().default(""),

  META_APP_ID: z.string().optional().default(""),
  META_APP_SECRET: z.string().optional().default(""),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional().default(""),
  META_GRAPH_VERSION: z.string().default("v21.0"),
  META_CONFIG_ID: z.string().optional().default(""),
  META_MANAGED_AD_ACCOUNT_ID: z.string().optional().default(""),
  META_MANAGED_PAGE_ID: z.string().optional().default(""),
  META_MANAGED_SYSTEM_TOKEN: z.string().optional().default(""),

  GBP_CLIENT_ID: z.string().optional().default(""),
  GBP_CLIENT_SECRET: z.string().optional().default(""),
  GDRIVE_BACKUP_CLIENT_ID: z.string().optional().default(""),
  GDRIVE_BACKUP_CLIENT_SECRET: z.string().optional().default(""),
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional().default(""),
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: z.string().optional().default(""),
  GOOGLE_ADS_MANAGED_CUSTOMER_ID: z.string().optional().default(""),
  GOOGLE_ADS_MANAGED_REFRESH_TOKEN: z.string().optional().default(""),

  RAZORPAY_KEY_ID: z.string().optional().default(""),
  RAZORPAY_KEY_SECRET: z.string().optional().default(""),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(""),

  R2_ACCOUNT_ID: z.string().optional().default(""),
  R2_ACCESS_KEY_ID: z.string().optional().default(""),
  R2_SECRET_ACCESS_KEY: z.string().optional().default(""),
  R2_BUCKET_PRIVATE: z.string().optional().default(""),
  R2_BUCKET_PUBLIC: z.string().optional().default(""),
  R2_BUCKET_PLATFORM_BACKUP: z.string().optional().default(""),
  R2_PUBLIC_BASE_URL: z.string().optional().default(""),

  CF_TURNSTILE_SITE_KEY: z.string().optional().default(""),
  CF_TURNSTILE_SECRET_KEY: z.string().optional().default(""),
  CF_AI_ACCOUNT_ID: z.string().optional().default(""),
  CF_AI_API_TOKEN: z.string().optional().default(""),
  CF_AI_TEXT_MODEL: z.string().default("@cf/meta/llama-3.1-8b-instruct"),
  CF_AI_WHISPER_MODEL: z.string().default("@cf/openai/whisper-tiny-en"),
  CF_EMAIL_INBOUND_DOMAIN: z.string().optional().default(""),
  CF_EMAIL_WEBHOOK_SECRET: z.string().optional().default(""),

  VAPID_PUBLIC_KEY: z.string().optional().default(""),
  VAPID_PRIVATE_KEY: z.string().optional().default(""),
  VAPID_SUBJECT: z.string().optional().default("mailto:app@rapidshiftlabs.in"),

  BHASHINI_USER_ID: z.string().optional().default(""),
  BHASHINI_ULCA_API_KEY: z.string().optional().default(""),
  BHASHINI_INFERENCE_API_KEY: z.string().optional().default(""),

  EMAIL_FROM: z.string().default("RapidShift Labs <app@rapidshiftlabs.in>"),
  SMTP_HOST: z.string().default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().int().default(465),
  SMTP_SECURE: z
    .string()
    .default("true")
    .transform((v) => v !== "false" && v !== "0"),
  GMAIL_SMTP_USER: z.string().optional().default(""),
  GMAIL_SMTP_APP_PASSWORD: z.string().optional().default(""),

  SENTRY_ORG: z.string().optional().default("al-aqmar"),
  SENTRY_DSN_WEB: z.string().optional().default(""),
  SENTRY_DSN_ADMIN: z.string().optional().default(""),
  SENTRY_DSN_DOCS: z.string().optional().default(""),
  SENTRY_DSN_WORKER: z.string().optional().default(""),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional().default(""),
});

export type AppEnv = z.infer<typeof EnvSchema> & {
  REPO_ROOT: string;
};

let cachedEnv: AppEnv | null = null;

function isLocalUrlOrHost(urlOrHost: string): boolean {
  const cleaned = String(urlOrHost || "").trim().toLowerCase();
  if (!cleaned) return true;
  try {
    const host = cleaned.includes("://") ? new URL(cleaned).hostname : cleaned.split(":")[0] || "";
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".test")
    );
  } catch {
    return false;
  }
}

export function verifyBootSecurityAssertions(parsed: z.infer<typeof EnvSchema>): void {
  const isProd = parsed.NODE_ENV === "production";
  const isTest = parsed.NODE_ENV === "test";

  // Hard boot guard: never allow deterministic dev secrets when targeting a non-local URL/host
  if (!isProd && !isTest) {
    const nonLocalSurface =
      !isLocalUrlOrHost(parsed.APP_URL) ||
      !isLocalUrlOrHost(parsed.ADMIN_URL) ||
      parsed.DATA_DIR.trim() === "/var/lib/rsl";
    if (nonLocalSurface) {
      throw new Error(
        `Refusing to start with NODE_ENV=${parsed.NODE_ENV} while APP_URL (${parsed.APP_URL}) or DATA_DIR targets a production host (${parsed.PRIMARY_DOMAIN}). Set NODE_ENV=production and configure explicit cryptographic secrets.`
      );
    }
  }

  if (isProd) {
    const requiredInProd: Array<keyof typeof parsed> = [
      "BETTER_AUTH_SECRET",
      "ADMIN_AUTH_SECRET",
      "KMS_MASTER_KEY",
      "BACKUP_SIGNING_KEY",
      "API_KEY_PEPPER",
    ];
    const seenSecrets = new Set<string>();
    for (const key of requiredInProd) {
      const val = String(parsed[key] || "").trim();
      if (!val) {
        throw new Error(`Missing mandatory production environment variable: ${key}`);
      }
      if (val.length < 16) {
        throw new Error(
          `Production environment variable ${key} must be at least 16 characters of high-entropy secret material.`
        );
      }
      if (
        val === deterministicDevSecret("auth") ||
        val === deterministicDevSecret("admin-auth") ||
        val === deterministicDevSecret("kms") ||
        val === deterministicDevSecret("backup") ||
        val === deterministicDevSecret("pepper")
      ) {
        throw new Error(`Production environment variable ${key} must not use deterministic development secrets.`);
      }
      seenSecrets.add(val);
    }
    if (seenSecrets.size < requiredInProd.length) {
      throw new Error(
        "Production cryptographic secrets (BETTER_AUTH_SECRET, ADMIN_AUTH_SECRET, KMS_MASTER_KEY, BACKUP_SIGNING_KEY, API_KEY_PEPPER) must be distinct values."
      );
    }
  }
}

export function getEnv(): AppEnv {
  if (cachedEnv) return cachedEnv;

  const parsed = EnvSchema.parse(process.env);
  verifyBootSecurityAssertions(parsed);

  const resolvedAdminSecret = parsed.ADMIN_AUTH_SECRET || deterministicDevSecret("admin-auth");
  const resolvedInternalSecret =
    parsed.INTERNAL_SERVICE_SECRET ||
    crypto.createHmac("sha256", resolvedAdminSecret).update("rsl-internal-probe-v1").digest("base64url");

  cachedEnv = {
    ...parsed,
    REPO_ROOT,
    DATA_DIR: resolveStorageDir(parsed.DATA_DIR, ".rsl-data"),
    LOG_DIR: resolveStorageDir(parsed.LOG_DIR, ".rsl-logs"),
    BACKUP_STAGING_DIR: resolveStorageDir(parsed.BACKUP_STAGING_DIR, ".rsl-data/staging"),
    SSL_CERT_DIR: resolveStorageDir(parsed.SSL_CERT_DIR, ".rsl-data/ssl"),
    BETTER_AUTH_SECRET: parsed.BETTER_AUTH_SECRET || deterministicDevSecret("auth"),
    ADMIN_AUTH_SECRET: resolvedAdminSecret,
    INTERNAL_SERVICE_SECRET: resolvedInternalSecret,
    KMS_MASTER_KEY: parsed.KMS_MASTER_KEY || deterministicDevSecret("kms"),
    BACKUP_SIGNING_KEY: parsed.BACKUP_SIGNING_KEY || deterministicDevSecret("backup"),
    API_KEY_PEPPER: parsed.API_KEY_PEPPER || deterministicDevSecret("pepper"),
  };

  return cachedEnv;
}

export function resetEnvCacheForTests(): void {
  cachedEnv = null;
}
