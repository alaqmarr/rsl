import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { decryptEnvelope, encryptEnvelope, getEnv, RslError } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { controlDb } from "./index";

export type PlatformCredentialProviderKey =
  | "google_oauth"
  | "google_ads"
  | "smtp_email"
  | "cloudflare_r2"
  | "meta_app"
  | "razorpay"
  | "cloudflare_turnstile"
  | "cloudflare_ai"
  | "cloudflare_email_routing"
  | "web_push_vapid"
  | "bhashini";

export type CredentialSource = "database" | "env" | "unconfigured";

export function maskCredentialSecret(raw: string | undefined | null): string {
  const clean = (raw || "").trim();
  if (!clean) return "";
  if (clean.length <= 8) {
    return `${clean.slice(0, 2)}••••${clean.slice(-2)}`;
  }
  return `${clean.slice(0, 6)}••••••••••${clean.slice(-4)}`;
}

function readRow(providerKey: PlatformCredentialProviderKey) {
  return controlDb()
    .select()
    .from(controlSchema.platformCredentials)
    .where(eq(controlSchema.platformCredentials.providerKey, providerKey))
    .get();
}

function parseJsonObject<T extends Record<string, unknown>>(raw: string | null | undefined): Partial<T> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Partial<T>;
    }
  } catch {
    // ignore malformed json
  }
  return {};
}

function decryptSecretObject<T extends Record<string, unknown>>(encrypted: string | null | undefined): Partial<T> {
  if (!encrypted || !encrypted.trim()) return {};
  try {
    const plain = decryptEnvelope(encrypted);
    return parseJsonObject<T>(plain);
  } catch {
    return {};
  }
}

export function parseGoogleOAuthClientJson(rawJson: string): {
  clientId: string;
  clientSecret: string;
  projectId: string;
  redirectUris: string[];
} {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawJson.trim()) as Record<string, unknown>;
  } catch {
    throw new RslError(
      "RSL-VAL-1001",
      "Invalid JSON pasted. Paste the exact contents of the client_secret_*.json file downloaded from Google Cloud Console (APIs & Services → Credentials → OAuth 2.0 Client IDs)."
    );
  }

  if (parsed.type === "service_account" || parsed.private_key || parsed.client_email) {
    throw new RslError(
      "RSL-VAL-1001",
      "That JSON file is a Google Service Account key ('type': 'service_account'), NOT an OAuth 2.0 Web Application Client! Service accounts do not show Google's 'Sign in with Google' consent screen and cannot write to customer personal Google Drives. Go to Google Cloud Console → APIs & Services → Credentials → + Create Credentials → OAuth client ID → Application type: Web application, then download or copy that Client ID & Client Secret."
    );
  }

  if (parsed.installed && !parsed.web) {
    throw new RslError(
      "RSL-VAL-1001",
      "That JSON is a 'Desktop app' ('installed') OAuth client rather than a 'Web application' client. In Google Cloud Console → Credentials → + Create Credentials → OAuth client ID, select Application type: 'Web application' and add the Authorized Redirect URI shown on this page."
    );
  }

  const web = (parsed.web ?? parsed) as Record<string, unknown>;
  const clientId = typeof web.client_id === "string" ? web.client_id.trim() : "";
  const clientSecret = typeof web.client_secret === "string" ? web.client_secret.trim() : "";
  const projectId = typeof web.project_id === "string" ? web.project_id.trim() : "";
  const redirectUris = Array.isArray(web.redirect_uris)
    ? web.redirect_uris.filter((u): u is string => typeof u === "string")
    : [];

  if (!clientId || !clientSecret) {
    throw new RslError(
      "RSL-VAL-1001",
      "JSON did not contain 'web.client_id' and 'web.client_secret'. Make sure you downloaded the OAuth 2.0 Web Application client JSON from Google Cloud Console."
    );
  }

  return { clientId, clientSecret, projectId, redirectUris };
}

/* ============================================================================
 * 1. Google OAuth 2.0 Platform Config (`RapidShift Labs` Consent Screen)
 * ============================================================================ */

export interface PlatformGoogleOAuthConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  projectId: string;
  consentAppName: string;
  publishingStatus: "production" | "testing";
  defaultDriveFolderName: string;
  enableDriveOAuth: boolean;
  enableGbpOAuth: boolean;
  enableGoogleAdsOAuth: boolean;
  source: CredentialSource;
  isReady: boolean;
  maskedClientSecret: string;
  updatedAt: number | null;
  lastVerifiedAt: number | null;
  lastVerifyStatus: string | null;
  lastVerifyMessage: string | null;
}

export interface PublicGoogleOAuthStatus {
  isReady: boolean;
  enableDriveOAuth: boolean;
  enableGbpOAuth: boolean;
  enableGoogleAdsOAuth: boolean;
  consentAppName: string;
  publishingStatus: "production" | "testing";
  defaultDriveFolderName: string;
}

export function getPlatformGoogleOAuthConfig(): PlatformGoogleOAuthConfig {
  const env = getEnv();
  const row = readRow("google_oauth");

  if (row) {
    const pub = parseJsonObject<{
      clientId: string;
      projectId: string;
      consentAppName: string;
      publishingStatus: "production" | "testing";
      defaultDriveFolderName: string;
      enableDriveOAuth: boolean;
      enableGbpOAuth: boolean;
      enableGoogleAdsOAuth: boolean;
    }>(row.publicConfigJson);
    const sec = decryptSecretObject<{ clientSecret: string }>(row.encryptedSecrets);
    const clientId = (pub.clientId || "").trim();
    const clientSecret = (sec.clientSecret || "").trim();
    const isReady = row.enabled && Boolean(clientId && clientSecret);

    return {
      enabled: row.enabled,
      clientId,
      clientSecret,
      projectId: (pub.projectId || "").trim(),
      consentAppName: (pub.consentAppName || "RapidShift Labs").trim(),
      publishingStatus: pub.publishingStatus === "testing" ? "testing" : "production",
      defaultDriveFolderName: (pub.defaultDriveFolderName || "RapidShift Labs Backups").trim(),
      enableDriveOAuth: pub.enableDriveOAuth !== false,
      enableGbpOAuth: pub.enableGbpOAuth !== false,
      enableGoogleAdsOAuth: pub.enableGoogleAdsOAuth !== false,
      source: clientId || clientSecret ? "database" : "unconfigured",
      isReady,
      maskedClientSecret: maskCredentialSecret(clientSecret),
      updatedAt: row.updatedAt,
      lastVerifiedAt: row.lastVerifiedAt,
      lastVerifyStatus: row.lastVerifyStatus,
      lastVerifyMessage: row.lastVerifyMessage,
    };
  }

  const envClientId = (
    env.GOOGLE_CLIENT_ID ||
    env.GDRIVE_BACKUP_CLIENT_ID ||
    env.GBP_CLIENT_ID ||
    ""
  ).trim();
  const envClientSecret = (
    env.GOOGLE_CLIENT_SECRET ||
    env.GDRIVE_BACKUP_CLIENT_SECRET ||
    env.GBP_CLIENT_SECRET ||
    ""
  ).trim();
  const hasEnv = Boolean(envClientId && envClientSecret);

  return {
    enabled: true,
    clientId: envClientId,
    clientSecret: envClientSecret,
    projectId: "",
    consentAppName: "RapidShift Labs",
    publishingStatus: "production",
    defaultDriveFolderName: "RapidShift Labs Backups",
    enableDriveOAuth: true,
    enableGbpOAuth: true,
    enableGoogleAdsOAuth: true,
    source: hasEnv ? "env" : "unconfigured",
    isReady: hasEnv,
    maskedClientSecret: maskCredentialSecret(envClientSecret),
    updatedAt: null,
    lastVerifiedAt: null,
    lastVerifyStatus: null,
    lastVerifyMessage: null,
  };
}

export function getPublicGoogleOAuthStatus(): PublicGoogleOAuthStatus {
  const cfg = getPlatformGoogleOAuthConfig();
  return {
    isReady: cfg.isReady,
    enableDriveOAuth: cfg.isReady && cfg.enableDriveOAuth,
    enableGbpOAuth: cfg.isReady && cfg.enableGbpOAuth,
    enableGoogleAdsOAuth: cfg.isReady && cfg.enableGoogleAdsOAuth,
    consentAppName: cfg.consentAppName,
    publishingStatus: cfg.publishingStatus,
    defaultDriveFolderName: cfg.defaultDriveFolderName,
  };
}

export function savePlatformGoogleOAuthConfig(params: {
  enabled?: boolean;
  oauthJsonRaw?: string;
  clientId?: string;
  clientSecret?: string;
  projectId?: string;
  consentAppName?: string;
  publishingStatus?: "production" | "testing";
  defaultDriveFolderName?: string;
  enableDriveOAuth?: boolean;
  enableGbpOAuth?: boolean;
  enableGoogleAdsOAuth?: boolean;
  staffId: string;
}): PlatformGoogleOAuthConfig {
  const current = getPlatformGoogleOAuthConfig();

  let parsedFromJson: ReturnType<typeof parseGoogleOAuthClientJson> | null = null;
  if (params.oauthJsonRaw && params.oauthJsonRaw.trim().length > 0) {
    parsedFromJson = parseGoogleOAuthClientJson(params.oauthJsonRaw);
  }

  const nextClientId = (parsedFromJson?.clientId || params.clientId || current.clientId).trim();
  const nextClientSecret = (
    parsedFromJson?.clientSecret ||
    (params.clientSecret && params.clientSecret.trim().length > 0
      ? params.clientSecret.trim()
      : current.clientSecret)
  ).trim();

  if (!nextClientId) {
    throw new RslError(
      "RSL-VAL-1001",
      "Enter your Google OAuth 2.0 Client ID (ending in .apps.googleusercontent.com) or paste Google's client_secret_*.json."
    );
  }
  if (nextClientId.includes("gserviceaccount.com")) {
    throw new RslError(
      "RSL-VAL-1001",
      `You entered a Service Account email (${nextClientId}) instead of an OAuth 2.0 Web Client ID! Create an OAuth client ID (Application type: Web application) ending in '.apps.googleusercontent.com'.`
    );
  }
  if (!nextClientSecret) {
    throw new RslError(
      "RSL-VAL-1001",
      "Enter your Google OAuth 2.0 Client Secret (usually starts with GOCSPX-) or paste Google's client_secret_*.json."
    );
  }

  const publicConfig = {
    clientId: nextClientId,
    projectId: (parsedFromJson?.projectId || (params.projectId ?? current.projectId)).trim(),
    consentAppName: (params.consentAppName || current.consentAppName || "RapidShift Labs").trim(),
    publishingStatus:
      params.publishingStatus === "testing" ? ("testing" as const) : ("production" as const),
    defaultDriveFolderName: (
      params.defaultDriveFolderName ||
      current.defaultDriveFolderName ||
      "RapidShift Labs Backups"
    ).trim(),
    enableDriveOAuth: params.enableDriveOAuth ?? current.enableDriveOAuth,
    enableGbpOAuth: params.enableGbpOAuth ?? current.enableGbpOAuth,
    enableGoogleAdsOAuth: params.enableGoogleAdsOAuth ?? current.enableGoogleAdsOAuth,
  };

  const encryptedSecrets = encryptEnvelope(JSON.stringify({ clientSecret: nextClientSecret }));
  const maskedHints = { clientSecret: maskCredentialSecret(nextClientSecret) };
  const now = Date.now();
  const enabled = params.enabled ?? true;

  controlDb()
    .insert(controlSchema.platformCredentials)
    .values({
      providerKey: "google_oauth",
      enabled,
      publicConfigJson: JSON.stringify(publicConfig),
      encryptedSecrets,
      maskedHintsJson: JSON.stringify(maskedHints),
      updatedByStaffId: params.staffId,
      lastVerifiedAt: now,
      lastVerifyStatus: "healthy",
      lastVerifyMessage: "Google OAuth 2.0 Web Client ID & Secret encrypted in control.db.",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: controlSchema.platformCredentials.providerKey,
      set: {
        enabled,
        publicConfigJson: JSON.stringify(publicConfig),
        encryptedSecrets,
        maskedHintsJson: JSON.stringify(maskedHints),
        updatedByStaffId: params.staffId,
        lastVerifiedAt: now,
        lastVerifyStatus: "healthy",
        lastVerifyMessage: "Google OAuth 2.0 Web Client ID & Secret encrypted in control.db.",
        updatedAt: now,
      },
    })
    .run();

  return getPlatformGoogleOAuthConfig();
}

/* ============================================================================
 * 2. Outbound SMTP / Transactional Email Credentials
 * ============================================================================ */

export interface PlatformSmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  from: string;
  user: string;
  password: string;
  source: CredentialSource;
  isReady: boolean;
  maskedPassword: string;
  updatedAt: number | null;
  lastVerifiedAt: number | null;
  lastVerifyStatus: string | null;
  lastVerifyMessage: string | null;
}

export function getPlatformSmtpConfig(): PlatformSmtpConfig {
  const env = getEnv();
  const row = readRow("smtp_email");

  if (row) {
    const pub = parseJsonObject<{
      host: string;
      port: number;
      secure: boolean;
      from: string;
      user: string;
    }>(row.publicConfigJson);
    const sec = decryptSecretObject<{ password: string }>(row.encryptedSecrets);
    const user = (pub.user || "").trim();
    const password = (sec.password || "").trim();
    const host = (pub.host || env.SMTP_HOST || "smtp.gmail.com").trim();
    const port = Number(pub.port || env.SMTP_PORT || 465);
    const secure = pub.secure ?? port === 465;
    const from = (pub.from || env.EMAIL_FROM || user).trim();

    return {
      enabled: row.enabled,
      host,
      port,
      secure,
      from,
      user,
      password,
      source: user || password ? "database" : "unconfigured",
      isReady: row.enabled && Boolean(host && user && password),
      maskedPassword: maskCredentialSecret(password),
      updatedAt: row.updatedAt,
      lastVerifiedAt: row.lastVerifiedAt,
      lastVerifyStatus: row.lastVerifyStatus,
      lastVerifyMessage: row.lastVerifyMessage,
    };
  }

  const hasEnv = Boolean(env.GMAIL_SMTP_USER && env.GMAIL_SMTP_APP_PASSWORD);
  return {
    enabled: true,
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    from: env.EMAIL_FROM,
    user: env.GMAIL_SMTP_USER,
    password: env.GMAIL_SMTP_APP_PASSWORD,
    source: hasEnv ? "env" : "unconfigured",
    isReady: hasEnv,
    maskedPassword: maskCredentialSecret(env.GMAIL_SMTP_APP_PASSWORD),
    updatedAt: null,
    lastVerifiedAt: null,
    lastVerifyStatus: null,
    lastVerifyMessage: null,
  };
}

export function savePlatformSmtpConfig(params: {
  enabled?: boolean;
  host: string;
  port: number;
  secure: boolean;
  from: string;
  user: string;
  password?: string;
  staffId: string;
}): PlatformSmtpConfig {
  const current = getPlatformSmtpConfig();
  const nextUser = params.user.trim();
  const nextPass =
    params.password && params.password.trim().length > 0
      ? params.password.trim()
      : current.password;

  if (!nextUser || !nextPass) {
    throw new RslError(
      "RSL-VAL-1001",
      "Enter both SMTP Username / Email and SMTP App Password."
    );
  }

  const publicConfig = {
    host: params.host.trim() || "smtp.gmail.com",
    port: Number(params.port) || 465,
    secure: params.secure,
    from: params.from.trim() || `RapidShift Labs <${nextUser}>`,
    user: nextUser,
  };
  const encryptedSecrets = encryptEnvelope(JSON.stringify({ password: nextPass }));
  const maskedHints = { password: maskCredentialSecret(nextPass) };
  const now = Date.now();
  const enabled = params.enabled ?? true;

  controlDb()
    .insert(controlSchema.platformCredentials)
    .values({
      providerKey: "smtp_email",
      enabled,
      publicConfigJson: JSON.stringify(publicConfig),
      encryptedSecrets,
      maskedHintsJson: JSON.stringify(maskedHints),
      updatedByStaffId: params.staffId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: controlSchema.platformCredentials.providerKey,
      set: {
        enabled,
        publicConfigJson: JSON.stringify(publicConfig),
        encryptedSecrets,
        maskedHintsJson: JSON.stringify(maskedHints),
        updatedByStaffId: params.staffId,
        updatedAt: now,
      },
    })
    .run();

  return getPlatformSmtpConfig();
}

/* ============================================================================
 * 3. Platform Managed Storage — Cloudflare R2 / S3
 * ============================================================================ */

export interface PlatformManagedR2Config {
  enabled: boolean;
  accountId: string;
  endpointUrl: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketPrivate: string;
  bucketPublic: string;
  publicBaseUrl: string;
  source: CredentialSource;
  isReady: boolean;
  maskedSecretAccessKey: string;
  updatedAt: number | null;
}

export function getPlatformManagedR2Config(): PlatformManagedR2Config {
  const env = getEnv();
  const row = readRow("cloudflare_r2");

  if (row) {
    const pub = parseJsonObject<{
      accountId: string;
      endpointUrl: string;
      accessKeyId: string;
      bucketPrivate: string;
      bucketPublic: string;
      publicBaseUrl: string;
    }>(row.publicConfigJson);
    const sec = decryptSecretObject<{ secretAccessKey: string }>(row.encryptedSecrets);
    const accountId = (pub.accountId || "").trim();
    const endpointUrl =
      (pub.endpointUrl || "").trim() ||
      (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
    const accessKeyId = (pub.accessKeyId || "").trim();
    const secretAccessKey = (sec.secretAccessKey || "").trim();
    const bucketPrivate = (pub.bucketPrivate || "").trim();

    return {
      enabled: row.enabled,
      accountId,
      endpointUrl,
      accessKeyId,
      secretAccessKey,
      bucketPrivate,
      bucketPublic: (pub.bucketPublic || "").trim(),
      publicBaseUrl: (pub.publicBaseUrl || "").trim(),
      source: accessKeyId || secretAccessKey ? "database" : "unconfigured",
      isReady: row.enabled && Boolean(endpointUrl && accessKeyId && secretAccessKey && bucketPrivate),
      maskedSecretAccessKey: maskCredentialSecret(secretAccessKey),
      updatedAt: row.updatedAt,
    };
  }

  const endpointUrl = env.R2_ACCOUNT_ID
    ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : "";
  const hasEnv = Boolean(
    endpointUrl && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET_PRIVATE
  );

  return {
    enabled: true,
    accountId: env.R2_ACCOUNT_ID,
    endpointUrl,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucketPrivate: env.R2_BUCKET_PRIVATE,
    bucketPublic: env.R2_BUCKET_PUBLIC,
    publicBaseUrl: env.R2_PUBLIC_BASE_URL,
    source: hasEnv ? "env" : "unconfigured",
    isReady: hasEnv,
    maskedSecretAccessKey: maskCredentialSecret(env.R2_SECRET_ACCESS_KEY),
    updatedAt: null,
  };
}

export function savePlatformManagedR2Config(params: {
  enabled?: boolean;
  accountId?: string;
  endpointUrl?: string;
  accessKeyId: string;
  secretAccessKey?: string;
  bucketPrivate: string;
  bucketPublic?: string;
  publicBaseUrl?: string;
  staffId: string;
}): PlatformManagedR2Config {
  const current = getPlatformManagedR2Config();
  const accountId = (params.accountId || "").trim();
  const rawEndpoint = (params.endpointUrl || "").trim().replace(/\/+$/, "");
  const endpointUrl =
    rawEndpoint || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  const accessKeyId = params.accessKeyId.trim();
  const secretAccessKey =
    params.secretAccessKey && params.secretAccessKey.trim().length > 0
      ? params.secretAccessKey.trim()
      : current.secretAccessKey;
  const bucketPrivate = params.bucketPrivate.trim();

  if (!endpointUrl || !accessKeyId || !secretAccessKey || !bucketPrivate) {
    throw new RslError(
      "RSL-VAL-1001",
      "Provide Account ID (or S3 Endpoint URL), Access Key ID, Secret Access Key, and Private Bucket Name."
    );
  }

  const publicConfig = {
    accountId,
    endpointUrl,
    accessKeyId,
    bucketPrivate,
    bucketPublic: (params.bucketPublic || "").trim(),
    publicBaseUrl: (params.publicBaseUrl || "").trim(),
  };
  const encryptedSecrets = encryptEnvelope(JSON.stringify({ secretAccessKey }));
  const maskedHints = { secretAccessKey: maskCredentialSecret(secretAccessKey) };
  const now = Date.now();
  const enabled = params.enabled ?? true;

  controlDb()
    .insert(controlSchema.platformCredentials)
    .values({
      providerKey: "cloudflare_r2",
      enabled,
      publicConfigJson: JSON.stringify(publicConfig),
      encryptedSecrets,
      maskedHintsJson: JSON.stringify(maskedHints),
      updatedByStaffId: params.staffId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: controlSchema.platformCredentials.providerKey,
      set: {
        enabled,
        publicConfigJson: JSON.stringify(publicConfig),
        encryptedSecrets,
        maskedHintsJson: JSON.stringify(maskedHints),
        updatedByStaffId: params.staffId,
        updatedAt: now,
      },
    })
    .run();

  return getPlatformManagedR2Config();
}

/* ============================================================================
 * 4. Meta / WhatsApp Platform App & Managed Business Manager Credentials
 * ============================================================================ */

export interface PlatformMetaAppConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  configId: string;
  webhookVerifyToken: string;
  graphVersion: string;
  enableMetaOAuth: boolean;
  managedAdAccountId: string;
  managedPageId: string;
  managedSystemToken: string;
  source: CredentialSource;
  isReady: boolean;
  isManagedAdsReady: boolean;
  maskedAppSecret: string;
  maskedVerifyToken: string;
  maskedManagedSystemToken: string;
  updatedAt: number | null;
}

export interface PublicMetaOAuthStatus {
  isReady: boolean;
  enableMetaOAuth: boolean;
  isManagedAdsReady: boolean;
  graphVersion: string;
}

export function getPlatformMetaAppConfig(): PlatformMetaAppConfig {
  const env = getEnv();
  const row = readRow("meta_app");

  if (row) {
    const pub = parseJsonObject<{
      appId: string;
      configId: string;
      graphVersion: string;
      enableMetaOAuth: boolean;
      managedAdAccountId: string;
      managedPageId: string;
    }>(row.publicConfigJson);
    const sec = decryptSecretObject<{
      appSecret: string;
      webhookVerifyToken: string;
      managedSystemToken: string;
    }>(row.encryptedSecrets);
    const appId = (pub.appId || "").trim();
    const appSecret = (sec.appSecret || "").trim();
    const webhookVerifyToken = (sec.webhookVerifyToken || "").trim();
    const managedAdAccountId = (pub.managedAdAccountId || env.META_MANAGED_AD_ACCOUNT_ID || "").trim();
    const managedPageId = (pub.managedPageId || env.META_MANAGED_PAGE_ID || "").trim();
    const managedSystemToken = (sec.managedSystemToken || env.META_MANAGED_SYSTEM_TOKEN || "").trim();

    return {
      enabled: row.enabled,
      appId,
      appSecret,
      configId: (pub.configId || "").trim(),
      webhookVerifyToken,
      graphVersion: (pub.graphVersion || env.META_GRAPH_VERSION || "v21.0").trim(),
      enableMetaOAuth: pub.enableMetaOAuth !== false,
      managedAdAccountId,
      managedPageId,
      managedSystemToken,
      source: appId || appSecret ? "database" : "unconfigured",
      isReady: row.enabled && Boolean(appId && appSecret),
      isManagedAdsReady: Boolean(managedAdAccountId && managedSystemToken),
      maskedAppSecret: maskCredentialSecret(appSecret),
      maskedVerifyToken: maskCredentialSecret(webhookVerifyToken),
      maskedManagedSystemToken: maskCredentialSecret(managedSystemToken),
      updatedAt: row.updatedAt,
    };
  }

  const hasEnv = Boolean(env.META_APP_ID && env.META_APP_SECRET);
  const managedAdAccountId = (env.META_MANAGED_AD_ACCOUNT_ID || "").trim();
  const managedPageId = (env.META_MANAGED_PAGE_ID || "").trim();
  const managedSystemToken = (env.META_MANAGED_SYSTEM_TOKEN || "").trim();
  return {
    enabled: true,
    appId: env.META_APP_ID,
    appSecret: env.META_APP_SECRET,
    configId: env.META_CONFIG_ID,
    webhookVerifyToken: env.META_WEBHOOK_VERIFY_TOKEN,
    graphVersion: env.META_GRAPH_VERSION,
    enableMetaOAuth: true,
    managedAdAccountId,
    managedPageId,
    managedSystemToken,
    source: hasEnv ? "env" : "unconfigured",
    isReady: hasEnv,
    isManagedAdsReady: Boolean(managedAdAccountId && managedSystemToken),
    maskedAppSecret: maskCredentialSecret(env.META_APP_SECRET),
    maskedVerifyToken: maskCredentialSecret(env.META_WEBHOOK_VERIFY_TOKEN),
    maskedManagedSystemToken: maskCredentialSecret(managedSystemToken),
    updatedAt: null,
  };
}

export function getPublicMetaOAuthStatus(): PublicMetaOAuthStatus {
  const cfg = getPlatformMetaAppConfig();
  return {
    isReady: cfg.isReady,
    enableMetaOAuth: cfg.isReady && cfg.enableMetaOAuth,
    isManagedAdsReady: cfg.isManagedAdsReady,
    graphVersion: cfg.graphVersion,
  };
}

export function savePlatformMetaAppConfig(params: {
  enabled?: boolean;
  appId: string;
  appSecret?: string;
  configId?: string;
  webhookVerifyToken?: string;
  graphVersion?: string;
  enableMetaOAuth?: boolean;
  managedAdAccountId?: string;
  managedPageId?: string;
  managedSystemToken?: string;
  staffId: string;
}): PlatformMetaAppConfig {
  const current = getPlatformMetaAppConfig();
  const appId = params.appId.trim();
  const appSecret =
    params.appSecret && params.appSecret.trim().length > 0
      ? params.appSecret.trim()
      : current.appSecret;
  const webhookVerifyToken =
    params.webhookVerifyToken && params.webhookVerifyToken.trim().length > 0
      ? params.webhookVerifyToken.trim()
      : current.webhookVerifyToken;
  const managedSystemToken =
    params.managedSystemToken && params.managedSystemToken.trim().length > 0
      ? params.managedSystemToken.trim()
      : current.managedSystemToken;
  const managedAdAccountId =
    params.managedAdAccountId !== undefined
      ? params.managedAdAccountId.trim()
      : current.managedAdAccountId;
  const managedPageId =
    params.managedPageId !== undefined
      ? params.managedPageId.trim()
      : current.managedPageId;

  if (!appId || !appSecret) {
    throw new RslError("RSL-VAL-1001", "Enter both Meta App ID and Meta App Secret.");
  }

  const publicConfig = {
    appId,
    configId: (params.configId || "").trim(),
    graphVersion: (params.graphVersion || "v21.0").trim(),
    enableMetaOAuth: params.enableMetaOAuth ?? current.enableMetaOAuth,
    managedAdAccountId,
    managedPageId,
  };
  const encryptedSecrets = encryptEnvelope(
    JSON.stringify({ appSecret, webhookVerifyToken, managedSystemToken })
  );
  const maskedHints = {
    appSecret: maskCredentialSecret(appSecret),
    webhookVerifyToken: maskCredentialSecret(webhookVerifyToken),
    managedSystemToken: maskCredentialSecret(managedSystemToken),
  };
  const now = Date.now();
  const enabled = params.enabled ?? true;

  controlDb()
    .insert(controlSchema.platformCredentials)
    .values({
      providerKey: "meta_app",
      enabled,
      publicConfigJson: JSON.stringify(publicConfig),
      encryptedSecrets,
      maskedHintsJson: JSON.stringify(maskedHints),
      updatedByStaffId: params.staffId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: controlSchema.platformCredentials.providerKey,
      set: {
        enabled,
        publicConfigJson: JSON.stringify(publicConfig),
        encryptedSecrets,
        maskedHintsJson: JSON.stringify(maskedHints),
        updatedByStaffId: params.staffId,
        updatedAt: now,
      },
    })
    .run();

  return getPlatformMetaAppConfig();
}

/* ============================================================================
 * 4B. Google Ads API Developer Token & Managed MCC Credentials
 * ============================================================================ */

export interface PlatformGoogleAdsConfig {
  enabled: boolean;
  developerToken: string;
  loginCustomerId: string;
  managedCustomerId: string;
  managedRefreshToken: string;
  apiVersion: string;
  source: CredentialSource;
  isReady: boolean;
  isManagedAdsReady: boolean;
  maskedDeveloperToken: string;
  maskedManagedRefreshToken: string;
  updatedAt: number | null;
}

export interface PublicGoogleAdsStatus {
  isReady: boolean;
  isManagedAdsReady: boolean;
  hasDeveloperToken: boolean;
  apiVersion: string;
}

function normalizeCustomerIdDigits(raw: string | undefined | null): string {
  return (raw || "").replace(/[^0-9]/g, "").trim();
}

export function getPlatformGoogleAdsConfig(): PlatformGoogleAdsConfig {
  const env = getEnv();
  const oauth = getPlatformGoogleOAuthConfig();
  const row = readRow("google_ads");

  if (row) {
    const pub = parseJsonObject<{
      loginCustomerId: string;
      managedCustomerId: string;
      apiVersion: string;
    }>(row.publicConfigJson);
    const sec = decryptSecretObject<{
      developerToken: string;
      managedRefreshToken: string;
    }>(row.encryptedSecrets);

    const developerToken = (sec.developerToken || env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim();
    const loginCustomerId = normalizeCustomerIdDigits(
      pub.loginCustomerId || env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
    );
    const managedCustomerId = normalizeCustomerIdDigits(
      pub.managedCustomerId || env.GOOGLE_ADS_MANAGED_CUSTOMER_ID
    );
    const managedRefreshToken = (
      sec.managedRefreshToken ||
      env.GOOGLE_ADS_MANAGED_REFRESH_TOKEN ||
      ""
    ).trim();

    return {
      enabled: row.enabled,
      developerToken,
      loginCustomerId,
      managedCustomerId,
      managedRefreshToken,
      apiVersion: (pub.apiVersion || "v18").trim(),
      source: "database",
      isReady: row.enabled && ((oauth.isReady && oauth.enableGoogleAdsOAuth) || Boolean(developerToken)),
      isManagedAdsReady:
        row.enabled && oauth.isReady && Boolean(managedCustomerId && managedRefreshToken),
      maskedDeveloperToken: maskCredentialSecret(developerToken),
      maskedManagedRefreshToken: maskCredentialSecret(managedRefreshToken),
      updatedAt: row.updatedAt,
    };
  }

  const developerToken = (env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim();
  const loginCustomerId = normalizeCustomerIdDigits(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  const managedCustomerId = normalizeCustomerIdDigits(env.GOOGLE_ADS_MANAGED_CUSTOMER_ID);
  const managedRefreshToken = (env.GOOGLE_ADS_MANAGED_REFRESH_TOKEN || "").trim();
  const hasAnyAdsEnv = Boolean(
    developerToken || loginCustomerId || managedCustomerId || managedRefreshToken
  );

  return {
    enabled: true,
    developerToken,
    loginCustomerId,
    managedCustomerId,
    managedRefreshToken,
    apiVersion: "v18",
    source: hasAnyAdsEnv ? "env" : oauth.isReady ? oauth.source : "unconfigured",
    isReady: (oauth.isReady && oauth.enableGoogleAdsOAuth) || Boolean(developerToken),
    isManagedAdsReady: oauth.isReady && Boolean(managedCustomerId && managedRefreshToken),
    maskedDeveloperToken: maskCredentialSecret(developerToken),
    maskedManagedRefreshToken: maskCredentialSecret(managedRefreshToken),
    updatedAt: null,
  };
}

export function getPublicGoogleAdsStatus(): PublicGoogleAdsStatus {
  const cfg = getPlatformGoogleAdsConfig();
  const oauth = getPlatformGoogleOAuthConfig();
  return {
    isReady: cfg.enabled && oauth.isReady && oauth.enableGoogleAdsOAuth,
    isManagedAdsReady: cfg.isManagedAdsReady && oauth.isReady,
    hasDeveloperToken: Boolean(cfg.developerToken) || (oauth.isReady && oauth.enableGoogleAdsOAuth),
    apiVersion: cfg.apiVersion,
  };
}

export function savePlatformGoogleAdsConfig(params: {
  enabled?: boolean;
  developerToken?: string;
  loginCustomerId?: string;
  managedCustomerId?: string;
  managedRefreshToken?: string;
  apiVersion?: string;
  staffId: string;
}): PlatformGoogleAdsConfig {
  const current = getPlatformGoogleAdsConfig();
  const developerToken =
    params.developerToken !== undefined
      ? params.developerToken.trim() || current.developerToken
      : current.developerToken;
  const managedRefreshToken =
    params.managedRefreshToken && params.managedRefreshToken.trim().length > 0
      ? params.managedRefreshToken.trim()
      : current.managedRefreshToken;

  const publicConfig = {
    loginCustomerId: normalizeCustomerIdDigits(
      params.loginCustomerId ?? current.loginCustomerId
    ),
    managedCustomerId: normalizeCustomerIdDigits(
      params.managedCustomerId ?? current.managedCustomerId
    ),
    apiVersion: (params.apiVersion || current.apiVersion || "v18").trim(),
  };
  const encryptedSecrets = encryptEnvelope(
    JSON.stringify({ developerToken, managedRefreshToken })
  );
  const maskedHints = {
    developerToken: maskCredentialSecret(developerToken),
    managedRefreshToken: maskCredentialSecret(managedRefreshToken),
  };
  const now = Date.now();
  const enabled = params.enabled ?? true;

  controlDb()
    .insert(controlSchema.platformCredentials)
    .values({
      providerKey: "google_ads",
      enabled,
      publicConfigJson: JSON.stringify(publicConfig),
      encryptedSecrets,
      maskedHintsJson: JSON.stringify(maskedHints),
      updatedByStaffId: params.staffId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: controlSchema.platformCredentials.providerKey,
      set: {
        enabled,
        publicConfigJson: JSON.stringify(publicConfig),
        encryptedSecrets,
        maskedHintsJson: JSON.stringify(maskedHints),
        updatedByStaffId: params.staffId,
        updatedAt: now,
      },
    })
    .run();

  return getPlatformGoogleAdsConfig();
}

/* ============================================================================
 * 5. Razorpay Automated Payment Gateway Credentials
 * ============================================================================ */

export interface PlatformRazorpayConfig {
  enabled: boolean;
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  source: CredentialSource;
  isReady: boolean;
  maskedKeySecret: string;
  maskedWebhookSecret: string;
  updatedAt: number | null;
}

export function getPlatformRazorpayConfig(): PlatformRazorpayConfig {
  const env = getEnv();
  const row = readRow("razorpay");

  if (row) {
    const pub = parseJsonObject<{ keyId: string }>(row.publicConfigJson);
    const sec = decryptSecretObject<{ keySecret: string; webhookSecret: string }>(
      row.encryptedSecrets
    );
    const keyId = (pub.keyId || "").trim();
    const keySecret = (sec.keySecret || "").trim();
    const webhookSecret = (sec.webhookSecret || "").trim();

    return {
      enabled: row.enabled,
      keyId,
      keySecret,
      webhookSecret,
      source: keyId || keySecret ? "database" : "unconfigured",
      isReady: row.enabled && Boolean(keyId && keySecret),
      maskedKeySecret: maskCredentialSecret(keySecret),
      maskedWebhookSecret: maskCredentialSecret(webhookSecret),
      updatedAt: row.updatedAt,
    };
  }

  const hasEnv = Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
  return {
    enabled: true,
    keyId: env.RAZORPAY_KEY_ID,
    keySecret: env.RAZORPAY_KEY_SECRET,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    source: hasEnv ? "env" : "unconfigured",
    isReady: hasEnv,
    maskedKeySecret: maskCredentialSecret(env.RAZORPAY_KEY_SECRET),
    maskedWebhookSecret: maskCredentialSecret(env.RAZORPAY_WEBHOOK_SECRET),
    updatedAt: null,
  };
}

export function savePlatformRazorpayConfig(params: {
  enabled?: boolean;
  keyId: string;
  keySecret?: string;
  webhookSecret?: string;
  staffId: string;
}): PlatformRazorpayConfig {
  const current = getPlatformRazorpayConfig();
  const keyId = params.keyId.trim();
  const keySecret =
    params.keySecret && params.keySecret.trim().length > 0
      ? params.keySecret.trim()
      : current.keySecret;
  const webhookSecret =
    params.webhookSecret && params.webhookSecret.trim().length > 0
      ? params.webhookSecret.trim()
      : current.webhookSecret;

  if (!keyId || !keySecret) {
    throw new RslError("RSL-VAL-1001", "Enter both Razorpay Key ID and Key Secret.");
  }

  const publicConfig = { keyId };
  const encryptedSecrets = encryptEnvelope(JSON.stringify({ keySecret, webhookSecret }));
  const maskedHints = {
    keySecret: maskCredentialSecret(keySecret),
    webhookSecret: maskCredentialSecret(webhookSecret),
  };
  const now = Date.now();
  const enabled = params.enabled ?? true;

  controlDb()
    .insert(controlSchema.platformCredentials)
    .values({
      providerKey: "razorpay",
      enabled,
      publicConfigJson: JSON.stringify(publicConfig),
      encryptedSecrets,
      maskedHintsJson: JSON.stringify(maskedHints),
      updatedByStaffId: params.staffId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: controlSchema.platformCredentials.providerKey,
      set: {
        enabled,
        publicConfigJson: JSON.stringify(publicConfig),
        encryptedSecrets,
        maskedHintsJson: JSON.stringify(maskedHints),
        updatedByStaffId: params.staffId,
        updatedAt: now,
      },
    })
    .run();

  return getPlatformRazorpayConfig();
}

/* ============================================================================
 * 6. Cloudflare Turnstile (100% Free Unlimited Bot & Credential-Stuffing Shield)
 * ============================================================================ */

export interface PlatformTurnstileConfig {
  enabled: boolean;
  siteKey: string;
  secretKey: string;
  enforceOnLogin: boolean;
  enforceOnRegister: boolean;
  enforceOnPublicForms: boolean;
  source: CredentialSource;
  isReady: boolean;
  maskedSecretKey: string;
  updatedAt: number | null;
}

export interface PublicTurnstileConfig {
  isReady: boolean;
  siteKey: string;
  enforceOnLogin: boolean;
  enforceOnRegister: boolean;
  enforceOnPublicForms: boolean;
}

export function getPlatformTurnstileConfig(): PlatformTurnstileConfig {
  const env = getEnv();
  const row = readRow("cloudflare_turnstile");

  if (row) {
    const pub = parseJsonObject<{
      siteKey: string;
      enforceOnLogin: boolean;
      enforceOnRegister: boolean;
      enforceOnPublicForms: boolean;
    }>(row.publicConfigJson);
    const sec = decryptSecretObject<{ secretKey: string }>(row.encryptedSecrets);
    const siteKey = (pub.siteKey || "").trim();
    const secretKey = (sec.secretKey || "").trim();
    const isReady = row.enabled && Boolean(siteKey && secretKey);

    return {
      enabled: row.enabled,
      siteKey,
      secretKey,
      enforceOnLogin: pub.enforceOnLogin !== false,
      enforceOnRegister: pub.enforceOnRegister !== false,
      enforceOnPublicForms: pub.enforceOnPublicForms !== false,
      source: siteKey || secretKey ? "database" : "unconfigured",
      isReady,
      maskedSecretKey: maskCredentialSecret(secretKey),
      updatedAt: row.updatedAt,
    };
  }

  const hasEnv = Boolean(env.CF_TURNSTILE_SITE_KEY && env.CF_TURNSTILE_SECRET_KEY);
  return {
    enabled: true,
    siteKey: env.CF_TURNSTILE_SITE_KEY,
    secretKey: env.CF_TURNSTILE_SECRET_KEY,
    enforceOnLogin: true,
    enforceOnRegister: true,
    enforceOnPublicForms: true,
    source: hasEnv ? "env" : "unconfigured",
    isReady: hasEnv,
    maskedSecretKey: maskCredentialSecret(env.CF_TURNSTILE_SECRET_KEY),
    updatedAt: null,
  };
}

export function getPublicTurnstileConfig(): PublicTurnstileConfig {
  const cfg = getPlatformTurnstileConfig();
  return {
    isReady: cfg.isReady,
    siteKey: cfg.isReady ? cfg.siteKey : "",
    enforceOnLogin: cfg.isReady && cfg.enforceOnLogin,
    enforceOnRegister: cfg.isReady && cfg.enforceOnRegister,
    enforceOnPublicForms: cfg.isReady && cfg.enforceOnPublicForms,
  };
}

export const getPlatformCloudflareTurnstileConfig = getPlatformTurnstileConfig;
export const savePlatformCloudflareTurnstileConfig = savePlatformTurnstileConfig;

export function savePlatformTurnstileConfig(params: {
  enabled?: boolean;
  siteKey: string;
  secretKey?: string;
  enforceOnLogin?: boolean;
  enforceOnRegister?: boolean;
  enforceOnPublicForms?: boolean;
  staffId: string;
}): PlatformTurnstileConfig {
  const current = getPlatformTurnstileConfig();
  const siteKey = params.siteKey.trim();
  const secretKey =
    params.secretKey && params.secretKey.trim().length > 0
      ? params.secretKey.trim()
      : current.secretKey;

  if (!siteKey || !secretKey) {
    throw new RslError(
      "RSL-VAL-1001",
      "Enter both Cloudflare Turnstile Site Key and Secret Key (from Cloudflare Dashboard → Turnstile → Add Widget)."
    );
  }

  const publicConfig = {
    siteKey,
    enforceOnLogin: params.enforceOnLogin ?? current.enforceOnLogin,
    enforceOnRegister: params.enforceOnRegister ?? current.enforceOnRegister,
    enforceOnPublicForms: params.enforceOnPublicForms ?? current.enforceOnPublicForms,
  };
  const encryptedSecrets = encryptEnvelope(JSON.stringify({ secretKey }));
  const maskedHints = { secretKey: maskCredentialSecret(secretKey) };
  const now = Date.now();
  const enabled = params.enabled ?? true;

  controlDb()
    .insert(controlSchema.platformCredentials)
    .values({
      providerKey: "cloudflare_turnstile",
      enabled,
      publicConfigJson: JSON.stringify(publicConfig),
      encryptedSecrets,
      maskedHintsJson: JSON.stringify(maskedHints),
      updatedByStaffId: params.staffId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: controlSchema.platformCredentials.providerKey,
      set: {
        enabled,
        publicConfigJson: JSON.stringify(publicConfig),
        encryptedSecrets,
        maskedHintsJson: JSON.stringify(maskedHints),
        updatedByStaffId: params.staffId,
        updatedAt: now,
      },
    })
    .run();

  return getPlatformTurnstileConfig();
}

/* ============================================================================
 * 7. Cloudflare Workers AI (10,000 Free Neurons/Day — Smart Replies, Ad Copy, Whisper)
 * ============================================================================ */

export interface PlatformCloudflareAiConfig {
  enabled: boolean;
  accountId: string;
  apiToken: string;
  textModel: string;
  whisperModel: string;
  source: CredentialSource;
  isReady: boolean;
  maskedApiToken: string;
  updatedAt: number | null;
}

export function getPlatformCloudflareAiConfig(): PlatformCloudflareAiConfig {
  const env = getEnv();
  const r2FallbackAccountId = getPlatformManagedR2Config().accountId;
  const row = readRow("cloudflare_ai");

  if (row) {
    const pub = parseJsonObject<{
      accountId: string;
      textModel: string;
      whisperModel: string;
    }>(row.publicConfigJson);
    const sec = decryptSecretObject<{ apiToken: string }>(row.encryptedSecrets);
    const accountId = (pub.accountId || r2FallbackAccountId || "").trim();
    const apiToken = (sec.apiToken || "").trim();
    const isReady = row.enabled && Boolean(accountId && apiToken);

    return {
      enabled: row.enabled,
      accountId,
      apiToken,
      textModel: (pub.textModel || "@cf/meta/llama-3.1-8b-instruct").trim(),
      whisperModel: (pub.whisperModel || "@cf/openai/whisper-tiny-en").trim(),
      source: accountId || apiToken ? "database" : "unconfigured",
      isReady,
      maskedApiToken: maskCredentialSecret(apiToken),
      updatedAt: row.updatedAt,
    };
  }

  const envAccountId = (env.CF_AI_ACCOUNT_ID || env.R2_ACCOUNT_ID || r2FallbackAccountId || "").trim();
  const envToken = env.CF_AI_API_TOKEN.trim();
  const hasEnv = Boolean(envAccountId && envToken);

  return {
    enabled: true,
    accountId: envAccountId,
    apiToken: envToken,
    textModel: env.CF_AI_TEXT_MODEL || "@cf/meta/llama-3.1-8b-instruct",
    whisperModel: env.CF_AI_WHISPER_MODEL || "@cf/openai/whisper-tiny-en",
    source: hasEnv ? "env" : "unconfigured",
    isReady: hasEnv,
    maskedApiToken: maskCredentialSecret(envToken),
    updatedAt: null,
  };
}

export function savePlatformCloudflareAiConfig(params: {
  enabled?: boolean;
  accountId?: string;
  apiToken?: string;
  textModel?: string;
  whisperModel?: string;
  staffId: string;
}): PlatformCloudflareAiConfig {
  const current = getPlatformCloudflareAiConfig();
  const r2AccountId = getPlatformManagedR2Config().accountId;
  const accountId = (params.accountId || current.accountId || r2AccountId || "").trim();
  const apiToken =
    params.apiToken && params.apiToken.trim().length > 0
      ? params.apiToken.trim()
      : current.apiToken;

  if (!accountId || !apiToken) {
    throw new RslError(
      "RSL-VAL-1001",
      "Enter your Cloudflare Account ID and Workers AI API Token (My Profile → API Tokens → Create Token → Workers AI Read/Run)."
    );
  }

  const publicConfig = {
    accountId,
    textModel: (params.textModel || current.textModel || "@cf/meta/llama-3.1-8b-instruct").trim(),
    whisperModel: (params.whisperModel || current.whisperModel || "@cf/openai/whisper-tiny-en").trim(),
  };
  const encryptedSecrets = encryptEnvelope(JSON.stringify({ apiToken }));
  const maskedHints = { apiToken: maskCredentialSecret(apiToken) };
  const now = Date.now();
  const enabled = params.enabled ?? true;

  controlDb()
    .insert(controlSchema.platformCredentials)
    .values({
      providerKey: "cloudflare_ai",
      enabled,
      publicConfigJson: JSON.stringify(publicConfig),
      encryptedSecrets,
      maskedHintsJson: JSON.stringify(maskedHints),
      updatedByStaffId: params.staffId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: controlSchema.platformCredentials.providerKey,
      set: {
        enabled,
        publicConfigJson: JSON.stringify(publicConfig),
        encryptedSecrets,
        maskedHintsJson: JSON.stringify(maskedHints),
        updatedByStaffId: params.staffId,
        updatedAt: now,
      },
    })
    .run();

  return getPlatformCloudflareAiConfig();
}

/* ============================================================================
 * 8. Cloudflare Email Routing + Workers (Inbound Vendor Bill-to-Tally Inbox)
 * ============================================================================ */

export interface PlatformCloudflareEmailConfig {
  enabled: boolean;
  inboundDomain: string;
  webhookSecret: string;
  source: CredentialSource;
  isReady: boolean;
  maskedWebhookSecret: string;
  updatedAt: number | null;
}

export function getPlatformCloudflareEmailConfig(): PlatformCloudflareEmailConfig {
  const env = getEnv();
  const row = readRow("cloudflare_email_routing");

  if (row) {
    const pub = parseJsonObject<{ inboundDomain: string }>(row.publicConfigJson);
    const sec = decryptSecretObject<{ webhookSecret: string }>(row.encryptedSecrets);
    const inboundDomain = (pub.inboundDomain || env.PRIMARY_DOMAIN || "rapidshiftlabs.in").trim();
    const webhookSecret = (sec.webhookSecret || "").trim();

    return {
      enabled: row.enabled,
      inboundDomain,
      webhookSecret,
      source: webhookSecret ? "database" : "unconfigured",
      isReady: row.enabled && Boolean(inboundDomain && webhookSecret),
      maskedWebhookSecret: maskCredentialSecret(webhookSecret),
      updatedAt: row.updatedAt,
    };
  }

  const hasEnv = Boolean(env.CF_EMAIL_WEBHOOK_SECRET);
  return {
    enabled: true,
    inboundDomain: (env.CF_EMAIL_INBOUND_DOMAIN || env.PRIMARY_DOMAIN || "rapidshiftlabs.in").trim(),
    webhookSecret: env.CF_EMAIL_WEBHOOK_SECRET.trim(),
    source: hasEnv ? "env" : "unconfigured",
    isReady: hasEnv,
    maskedWebhookSecret: maskCredentialSecret(env.CF_EMAIL_WEBHOOK_SECRET),
    updatedAt: null,
  };
}

export function savePlatformCloudflareEmailConfig(params: {
  enabled?: boolean;
  inboundDomain?: string;
  webhookSecret?: string;
  autoGenerateSecret?: boolean;
  staffId: string;
}): PlatformCloudflareEmailConfig {
  const current = getPlatformCloudflareEmailConfig();
  const env = getEnv();
  const inboundDomain = (
    params.inboundDomain ||
    current.inboundDomain ||
    env.PRIMARY_DOMAIN ||
    "rapidshiftlabs.in"
  ).trim();
  const webhookSecret = params.autoGenerateSecret
    ? `rsl_cf_eml_${crypto.randomBytes(20).toString("hex")}`
    : params.webhookSecret && params.webhookSecret.trim().length > 0
      ? params.webhookSecret.trim()
      : current.webhookSecret;

  if (!webhookSecret) {
    throw new RslError(
      "RSL-VAL-1001",
      "Provide a Cloudflare Email Worker Webhook Secret or click Auto-Generate Secret."
    );
  }

  const publicConfig = { inboundDomain };
  const encryptedSecrets = encryptEnvelope(JSON.stringify({ webhookSecret }));
  const maskedHints = { webhookSecret: maskCredentialSecret(webhookSecret) };
  const now = Date.now();
  const enabled = params.enabled ?? true;

  controlDb()
    .insert(controlSchema.platformCredentials)
    .values({
      providerKey: "cloudflare_email_routing",
      enabled,
      publicConfigJson: JSON.stringify(publicConfig),
      encryptedSecrets,
      maskedHintsJson: JSON.stringify(maskedHints),
      updatedByStaffId: params.staffId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: controlSchema.platformCredentials.providerKey,
      set: {
        enabled,
        publicConfigJson: JSON.stringify(publicConfig),
        encryptedSecrets,
        maskedHintsJson: JSON.stringify(maskedHints),
        updatedByStaffId: params.staffId,
        updatedAt: now,
      },
    })
    .run();

  return getPlatformCloudflareEmailConfig();
}

export function buildCloudflareEmailWorkerSnippet(appOrigin: string): string {
  const cleanOrigin = appOrigin.replace(/\/+$/, "");
  return `// Cloudflare Email Worker (100% Free — Deploy in Cloudflare Dashboard → Email → Email Routing → Email Workers)
// Route catch-all or bills+*@yourdomain to this Worker, and set Worker secret RSL_EMAIL_WEBHOOK_SECRET.
export default {
  async email(message, env, ctx) {
    const rawEmail = await new Response(message.raw).text();
    const subject = message.headers.get("subject") || "Vendor Tax Invoice";
    await fetch("${cleanOrigin}/api/webhooks/cloudflare-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-RSL-Email-Secret": env.RSL_EMAIL_WEBHOOK_SECRET
      },
      body: JSON.stringify({
        to: message.to,
        from: message.from,
        subject,
        rawText: rawEmail.slice(0, 65000)
      })
    });
  }
};`;
}

/* ============================================================================
 * 9. W3C Web Push VAPID Keys (Auto-Generatable Free Browser & Mobile Push)
 * ============================================================================ */

export interface PlatformVapidConfig {
  enabled: boolean;
  subject: string;
  publicKey: string;
  privateKeyJwkJson: string;
  privateKeyD: string;
  source: CredentialSource;
  isReady: boolean;
  maskedPrivateKey: string;
  updatedAt: number | null;
}

export function generateFreshVapidKeyPair(): {
  publicKey: string;
  privateKeyD: string;
  privateKeyJwkJson: string;
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const pubJwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const privJwk = privateKey.export({ format: "jwk" }) as {
    kty: string;
    crv: string;
    x: string;
    y: string;
    d: string;
  };
  const xBuf = Buffer.from(pubJwk.x, "base64url");
  const yBuf = Buffer.from(pubJwk.y, "base64url");
  const uncompressed = Buffer.concat([Buffer.from([0x04]), xBuf, yBuf]);
  return {
    publicKey: uncompressed.toString("base64url"),
    privateKeyD: privJwk.d,
    privateKeyJwkJson: JSON.stringify(privJwk),
  };
}

export function getPlatformVapidConfig(): PlatformVapidConfig {
  const env = getEnv();
  const row = readRow("web_push_vapid");
  const defaultSubject = `mailto:notifications@${env.PRIMARY_DOMAIN || "rapidshiftlabs.in"}`;

  if (row) {
    const pub = parseJsonObject<{ subject: string; publicKey: string }>(row.publicConfigJson);
    const sec = decryptSecretObject<{ privateKeyD: string; privateKeyJwkJson: string }>(
      row.encryptedSecrets
    );
    const publicKey = (pub.publicKey || "").trim();
    const privateKeyD = (sec.privateKeyD || "").trim();
    const privateKeyJwkJson = (sec.privateKeyJwkJson || "").trim();
    const isReady = row.enabled && Boolean(publicKey && privateKeyD);

    return {
      enabled: row.enabled,
      subject: (pub.subject || defaultSubject).trim(),
      publicKey,
      privateKeyD,
      privateKeyJwkJson,
      source: publicKey ? "database" : "unconfigured",
      isReady,
      maskedPrivateKey: maskCredentialSecret(privateKeyD),
      updatedAt: row.updatedAt,
    };
  }

  const hasEnv = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
  let reconstructedJwk = "";
  if (hasEnv) {
    try {
      const rawPub = Buffer.from(env.VAPID_PUBLIC_KEY.trim(), "base64url");
      if (rawPub.length === 65 && rawPub[0] === 0x04) {
        reconstructedJwk = JSON.stringify({
          kty: "EC",
          crv: "P-256",
          x: rawPub.subarray(1, 33).toString("base64url"),
          y: rawPub.subarray(33, 65).toString("base64url"),
          d: env.VAPID_PRIVATE_KEY.trim(),
        });
      }
    } catch {
      // ignore malformed env key
    }
  }

  return {
    enabled: true,
    subject: (env.VAPID_SUBJECT || defaultSubject).trim(),
    publicKey: env.VAPID_PUBLIC_KEY.trim(),
    privateKeyD: env.VAPID_PRIVATE_KEY.trim(),
    privateKeyJwkJson: reconstructedJwk,
    source: hasEnv ? "env" : "unconfigured",
    isReady: hasEnv && Boolean(reconstructedJwk),
    maskedPrivateKey: maskCredentialSecret(env.VAPID_PRIVATE_KEY),
    updatedAt: null,
  };
}

export function savePlatformVapidConfig(params: {
  enabled?: boolean;
  subject?: string;
  publicKey?: string;
  privateKeyD?: string;
  autoGenerate?: boolean;
  staffId: string;
}): PlatformVapidConfig {
  const current = getPlatformVapidConfig();
  const env = getEnv();
  const subject = (
    params.subject ||
    current.subject ||
    `mailto:notifications@${env.PRIMARY_DOMAIN || "rapidshiftlabs.in"}`
  ).trim();

  let publicKey = (params.publicKey || current.publicKey || "").trim();
  let privateKeyD = (params.privateKeyD || current.privateKeyD || "").trim();
  let privateKeyJwkJson = current.privateKeyJwkJson;

  if (params.autoGenerate || (!publicKey && !privateKeyD)) {
    const fresh = generateFreshVapidKeyPair();
    publicKey = fresh.publicKey;
    privateKeyD = fresh.privateKeyD;
    privateKeyJwkJson = fresh.privateKeyJwkJson;
  } else if (publicKey && privateKeyD) {
    const rawPub = Buffer.from(publicKey, "base64url");
    if (rawPub.length !== 65 || rawPub[0] !== 0x04) {
      throw new RslError(
        "RSL-VAL-1001",
        "VAPID Public Key must be a 65-byte uncompressed P-256 point in base64url (or click Auto-Generate Free VAPID Keys)."
      );
    }
    privateKeyJwkJson = JSON.stringify({
      kty: "EC",
      crv: "P-256",
      x: rawPub.subarray(1, 33).toString("base64url"),
      y: rawPub.subarray(33, 65).toString("base64url"),
      d: privateKeyD,
    });
  }

  const publicConfig = { subject, publicKey };
  const encryptedSecrets = encryptEnvelope(JSON.stringify({ privateKeyD, privateKeyJwkJson }));
  const maskedHints = { privateKeyD: maskCredentialSecret(privateKeyD) };
  const now = Date.now();
  const enabled = params.enabled ?? true;

  controlDb()
    .insert(controlSchema.platformCredentials)
    .values({
      providerKey: "web_push_vapid",
      enabled,
      publicConfigJson: JSON.stringify(publicConfig),
      encryptedSecrets,
      maskedHintsJson: JSON.stringify(maskedHints),
      updatedByStaffId: params.staffId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: controlSchema.platformCredentials.providerKey,
      set: {
        enabled,
        publicConfigJson: JSON.stringify(publicConfig),
        encryptedSecrets,
        maskedHintsJson: JSON.stringify(maskedHints),
        updatedByStaffId: params.staffId,
        updatedAt: now,
      },
    })
    .run();

  return getPlatformVapidConfig();
}

export function ensurePlatformVapidConfig(): PlatformVapidConfig {
  const existing = getPlatformVapidConfig();
  if (existing.isReady) return existing;
  return savePlatformVapidConfig({
    autoGenerate: true,
    staffId: "system_auto_vapid",
  });
}

/* ============================================================================
 * 10. MeitY Digital India BHASHINI (22 Scheduled Indian Languages API)
 * ============================================================================ */

export interface PlatformBhashiniConfig {
  enabled: boolean;
  userId: string;
  ulcaApiKey: string;
  inferenceApiKey: string;
  source: CredentialSource;
  isReady: boolean;
  maskedUlcaApiKey: string;
  maskedInferenceApiKey: string;
  updatedAt: number | null;
}

export function getPlatformBhashiniConfig(): PlatformBhashiniConfig {
  const env = getEnv();
  const row = readRow("bhashini");

  if (row) {
    const pub = parseJsonObject<{ userId: string }>(row.publicConfigJson);
    const sec = decryptSecretObject<{ ulcaApiKey: string; inferenceApiKey: string }>(
      row.encryptedSecrets
    );
    const userId = (pub.userId || "").trim();
    const ulcaApiKey = (sec.ulcaApiKey || "").trim();
    const inferenceApiKey = (sec.inferenceApiKey || "").trim();

    return {
      enabled: row.enabled,
      userId,
      ulcaApiKey,
      inferenceApiKey,
      source: userId || inferenceApiKey ? "database" : "unconfigured",
      isReady: row.enabled && Boolean(inferenceApiKey || (userId && ulcaApiKey)),
      maskedUlcaApiKey: maskCredentialSecret(ulcaApiKey),
      maskedInferenceApiKey: maskCredentialSecret(inferenceApiKey),
      updatedAt: row.updatedAt,
    };
  }

  const hasEnv = Boolean(
    env.BHASHINI_INFERENCE_API_KEY || (env.BHASHINI_USER_ID && env.BHASHINI_ULCA_API_KEY)
  );
  return {
    enabled: true,
    userId: env.BHASHINI_USER_ID.trim(),
    ulcaApiKey: env.BHASHINI_ULCA_API_KEY.trim(),
    inferenceApiKey: env.BHASHINI_INFERENCE_API_KEY.trim(),
    source: hasEnv ? "env" : "unconfigured",
    isReady: hasEnv,
    maskedUlcaApiKey: maskCredentialSecret(env.BHASHINI_ULCA_API_KEY),
    maskedInferenceApiKey: maskCredentialSecret(env.BHASHINI_INFERENCE_API_KEY),
    updatedAt: null,
  };
}

export function savePlatformBhashiniConfig(params: {
  enabled?: boolean;
  userId?: string;
  ulcaApiKey?: string;
  inferenceApiKey?: string;
  staffId: string;
}): PlatformBhashiniConfig {
  const current = getPlatformBhashiniConfig();
  const userId = (params.userId ?? current.userId).trim();
  const ulcaApiKey =
    params.ulcaApiKey && params.ulcaApiKey.trim().length > 0
      ? params.ulcaApiKey.trim()
      : current.ulcaApiKey;
  const inferenceApiKey =
    params.inferenceApiKey && params.inferenceApiKey.trim().length > 0
      ? params.inferenceApiKey.trim()
      : current.inferenceApiKey;

  if (!inferenceApiKey && !(userId && ulcaApiKey)) {
    throw new RslError(
      "RSL-VAL-1001",
      "Enter Bhashini Inference API Key (or ULCA User ID + ULCA API Key from bhashini.gov.in)."
    );
  }

  const publicConfig = { userId };
  const encryptedSecrets = encryptEnvelope(JSON.stringify({ ulcaApiKey, inferenceApiKey }));
  const maskedHints = {
    ulcaApiKey: maskCredentialSecret(ulcaApiKey),
    inferenceApiKey: maskCredentialSecret(inferenceApiKey),
  };
  const now = Date.now();
  const enabled = params.enabled ?? true;

  controlDb()
    .insert(controlSchema.platformCredentials)
    .values({
      providerKey: "bhashini",
      enabled,
      publicConfigJson: JSON.stringify(publicConfig),
      encryptedSecrets,
      maskedHintsJson: JSON.stringify(maskedHints),
      updatedByStaffId: params.staffId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: controlSchema.platformCredentials.providerKey,
      set: {
        enabled,
        publicConfigJson: JSON.stringify(publicConfig),
        encryptedSecrets,
        maskedHintsJson: JSON.stringify(maskedHints),
        updatedByStaffId: params.staffId,
        updatedAt: now,
      },
    })
    .run();

  return getPlatformBhashiniConfig();
}

/* ============================================================================
 * 11. Bulk JSON / CLI Database Seeder (`seedPlatformCredentialsBundle`)
 * ============================================================================ */

export type PlatformCredentialsSeedInput = PlatformCredentialsSeedBundle;

export interface PlatformCredentialsSeedBundle {
  google_oauth?: {
    enabled?: boolean;
    clientId?: string;
    clientSecret?: string;
    projectId?: string;
    consentAppName?: string;
    publishingStatus?: "production" | "testing";
  };
  google_ads?: {
    enabled?: boolean;
    developerToken?: string;
    loginCustomerId?: string;
    managedCustomerId?: string;
    managedRefreshToken?: string;
  };
  smtp_email?: {
    enabled?: boolean;
    host?: string;
    port?: number;
    secure?: boolean;
    from?: string;
    user?: string;
    password?: string;
  };
  cloudflare_r2?: {
    enabled?: boolean;
    accountId?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    bucketPrivate?: string;
    bucketPublic?: string;
    publicBaseUrl?: string;
  };
  meta_app?: {
    enabled?: boolean;
    appId?: string;
    appSecret?: string;
    webhookVerifyToken?: string;
    verifyToken?: string;
    configId?: string;
    managedAdAccountId?: string;
    managedPageId?: string;
    managedSystemToken?: string;
  };
  razorpay?: {
    enabled?: boolean;
    keyId?: string;
    keySecret?: string;
    webhookSecret?: string;
  };
  cloudflare_turnstile?: {
    enabled?: boolean;
    siteKey?: string;
    secretKey?: string;
    enforceOnLogin?: boolean;
    enforceOnRegister?: boolean;
    enforceOnPublicForms?: boolean;
  };
  cloudflare_ai?: {
    enabled?: boolean;
    accountId?: string;
    apiToken?: string;
    textModel?: string;
    whisperModel?: string;
  };
  cloudflare_email_routing?: {
    enabled?: boolean;
    inboundDomain?: string;
    webhookSecret?: string;
    autoGenerateSecret?: boolean;
  };
  web_push_vapid?: {
    enabled?: boolean;
    subject?: string;
    publicKey?: string;
    privateKeyD?: string;
    autoGenerate?: boolean;
  };
  bhashini?: {
    enabled?: boolean;
    userId?: string;
    ulcaApiKey?: string;
    inferenceApiKey?: string;
  };
}

export function buildPlatformCredentialsSeedTemplate(): PlatformCredentialsSeedBundle {
  return {
    google_oauth: {
      enabled: true,
      clientId: "YOUR_GOOGLE_WEB_CLIENT_ID.apps.googleusercontent.com",
      clientSecret: "GOCSPX-YOUR_GOOGLE_CLIENT_SECRET",
      projectId: "rapidshift-labs",
      consentAppName: "RapidShift Labs",
      publishingStatus: "production",
    },
    google_ads: {
      enabled: false,
      developerToken: "",
      loginCustomerId: "",
      managedCustomerId: "",
      managedRefreshToken: "",
    },
    smtp_email: {
      enabled: true,
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      from: "RapidShift Labs <info@thewebsensei.email>",
      user: "info@thewebsensei.email",
      password: "YOUR_16_CHAR_GOOGLE_APP_PASSWORD",
    },
    cloudflare_r2: {
      enabled: false,
      accountId: "",
      accessKeyId: "",
      secretAccessKey: "",
      bucketPrivate: "rsl-private-vault",
      bucketPublic: "rsl-public-media",
      publicBaseUrl: "",
    },
    meta_app: {
      enabled: true,
      appId: "YOUR_META_APP_ID",
      appSecret: "YOUR_META_APP_SECRET",
      verifyToken: "rsl_meta_verify_token",
      configId: "",
      managedAdAccountId: "",
      managedPageId: "",
      managedSystemToken: "",
    },
    razorpay: {
      enabled: false,
      keyId: "",
      keySecret: "",
      webhookSecret: "",
    },
    cloudflare_turnstile: {
      enabled: false,
      siteKey: "YOUR_CF_TURNSTILE_SITE_KEY",
      secretKey: "YOUR_CF_TURNSTILE_SECRET_KEY",
      enforceOnLogin: true,
      enforceOnRegister: true,
      enforceOnPublicForms: true,
    },
    cloudflare_ai: {
      enabled: false,
      accountId: "YOUR_CLOUDFLARE_ACCOUNT_ID",
      apiToken: "YOUR_CF_WORKERS_AI_API_TOKEN",
      textModel: "@cf/meta/llama-3.1-8b-instruct",
      whisperModel: "@cf/openai/whisper-tiny-en",
    },
    cloudflare_email_routing: {
      enabled: true,
      inboundDomain: "rapidshiftlabs.in",
      autoGenerateSecret: true,
    },
    web_push_vapid: {
      enabled: true,
      subject: "mailto:info@thewebsensei.email",
      autoGenerate: true,
    },
    bhashini: {
      enabled: false,
      userId: "",
      ulcaApiKey: "",
      inferenceApiKey: "",
    },
  };
}

function isPlaceholderValue(val: string | undefined): boolean {
  if (!val) return true;
  const trimmed = val.trim();
  if (!trimmed) return true;
  return (
    trimmed.startsWith("YOUR_") ||
    trimmed.startsWith("GOCSPX-YOUR_") ||
    trimmed === "YOUR_16_CHAR_GOOGLE_APP_PASSWORD"
  );
}

export function seedPlatformCredentialsBundle(
  bundleOrOpts:
    | PlatformCredentialsSeedBundle
    | { bundle: PlatformCredentialsSeedBundle; staffId?: string },
  maybeStaffId = "db_seed_cli"
): { seeded: PlatformCredentialProviderKey[]; skipped: string[] } {
  const isWrapped =
    typeof bundleOrOpts === "object" &&
    bundleOrOpts !== null &&
    "bundle" in bundleOrOpts &&
    Boolean((bundleOrOpts as { bundle?: unknown }).bundle);
  const bundle: PlatformCredentialsSeedBundle = isWrapped
    ? (bundleOrOpts as { bundle: PlatformCredentialsSeedBundle }).bundle
    : (bundleOrOpts as PlatformCredentialsSeedBundle);
  const staffId = isWrapped
    ? (bundleOrOpts as { staffId?: string }).staffId || maybeStaffId
    : maybeStaffId;

  const seeded: PlatformCredentialProviderKey[] = [];
  const skipped: string[] = [];

  if (
    bundle.google_oauth &&
    !isPlaceholderValue(bundle.google_oauth.clientId) &&
    !isPlaceholderValue(bundle.google_oauth.clientSecret)
  ) {
    savePlatformGoogleOAuthConfig({ ...bundle.google_oauth, staffId });
    seeded.push("google_oauth");
  } else if (bundle.google_oauth) {
    skipped.push("google_oauth (empty/placeholder)");
  }

  if (
    bundle.google_ads &&
    (!isPlaceholderValue(bundle.google_ads.developerToken) ||
      !isPlaceholderValue(bundle.google_ads.loginCustomerId) ||
      !isPlaceholderValue(bundle.google_ads.managedCustomerId) ||
      bundle.google_ads.enabled === true)
  ) {
    savePlatformGoogleAdsConfig({ ...bundle.google_ads, staffId });
    seeded.push("google_ads");
  } else if (bundle.google_ads) {
    skipped.push("google_ads (optional — uses google_oauth Cloud Project automatically)");
  }

  if (
    bundle.smtp_email &&
    !isPlaceholderValue(bundle.smtp_email.user) &&
    !isPlaceholderValue(bundle.smtp_email.password)
  ) {
    savePlatformSmtpConfig({
      enabled: bundle.smtp_email.enabled,
      host: bundle.smtp_email.host || "smtp.gmail.com",
      port: bundle.smtp_email.port ?? 465,
      secure: bundle.smtp_email.secure ?? true,
      from: bundle.smtp_email.from || `RapidShift Labs <${bundle.smtp_email.user}>`,
      user: bundle.smtp_email.user!,
      password: bundle.smtp_email.password,
      staffId,
    });
    seeded.push("smtp_email");
  } else if (bundle.smtp_email) {
    skipped.push("smtp_email (empty/placeholder)");
  }

  if (
    bundle.cloudflare_r2 &&
    !isPlaceholderValue(bundle.cloudflare_r2.accountId) &&
    !isPlaceholderValue(bundle.cloudflare_r2.accessKeyId) &&
    !isPlaceholderValue(bundle.cloudflare_r2.secretAccessKey) &&
    bundle.cloudflare_r2.bucketPrivate
  ) {
    savePlatformManagedR2Config({
      enabled: bundle.cloudflare_r2.enabled,
      accountId: bundle.cloudflare_r2.accountId!,
      accessKeyId: bundle.cloudflare_r2.accessKeyId!,
      secretAccessKey: bundle.cloudflare_r2.secretAccessKey,
      bucketPrivate: bundle.cloudflare_r2.bucketPrivate,
      bucketPublic: bundle.cloudflare_r2.bucketPublic,
      publicBaseUrl: bundle.cloudflare_r2.publicBaseUrl,
      staffId,
    });
    seeded.push("cloudflare_r2");
  } else if (bundle.cloudflare_r2) {
    skipped.push("cloudflare_r2 (empty)");
  }

  if (
    bundle.meta_app &&
    !isPlaceholderValue(bundle.meta_app.appId) &&
    !isPlaceholderValue(bundle.meta_app.appSecret)
  ) {
    savePlatformMetaAppConfig({
      enabled: bundle.meta_app.enabled,
      appId: bundle.meta_app.appId!,
      appSecret: bundle.meta_app.appSecret,
      webhookVerifyToken: bundle.meta_app.webhookVerifyToken || bundle.meta_app.verifyToken,
      configId: bundle.meta_app.configId,
      managedAdAccountId: bundle.meta_app.managedAdAccountId,
      managedPageId: bundle.meta_app.managedPageId,
      managedSystemToken: bundle.meta_app.managedSystemToken,
      staffId,
    });
    seeded.push("meta_app");
  } else if (bundle.meta_app) {
    skipped.push("meta_app (empty/placeholder)");
  }

  if (
    bundle.razorpay &&
    !isPlaceholderValue(bundle.razorpay.keyId) &&
    !isPlaceholderValue(bundle.razorpay.keySecret)
  ) {
    savePlatformRazorpayConfig({
      enabled: bundle.razorpay.enabled,
      keyId: bundle.razorpay.keyId!,
      keySecret: bundle.razorpay.keySecret,
      webhookSecret: bundle.razorpay.webhookSecret,
      staffId,
    });
    seeded.push("razorpay");
  } else if (bundle.razorpay) {
    skipped.push("razorpay (empty)");
  }

  if (
    bundle.cloudflare_turnstile &&
    !isPlaceholderValue(bundle.cloudflare_turnstile.siteKey) &&
    !isPlaceholderValue(bundle.cloudflare_turnstile.secretKey)
  ) {
    savePlatformTurnstileConfig({
      enabled: bundle.cloudflare_turnstile.enabled,
      siteKey: bundle.cloudflare_turnstile.siteKey!,
      secretKey: bundle.cloudflare_turnstile.secretKey,
      enforceOnLogin: bundle.cloudflare_turnstile.enforceOnLogin,
      enforceOnRegister: bundle.cloudflare_turnstile.enforceOnRegister,
      enforceOnPublicForms: bundle.cloudflare_turnstile.enforceOnPublicForms,
      staffId,
    });
    seeded.push("cloudflare_turnstile");
  } else if (bundle.cloudflare_turnstile) {
    skipped.push("cloudflare_turnstile (empty/placeholder)");
  }

  if (
    bundle.cloudflare_ai &&
    !isPlaceholderValue(bundle.cloudflare_ai.accountId) &&
    !isPlaceholderValue(bundle.cloudflare_ai.apiToken)
  ) {
    savePlatformCloudflareAiConfig({
      enabled: bundle.cloudflare_ai.enabled,
      accountId: bundle.cloudflare_ai.accountId,
      apiToken: bundle.cloudflare_ai.apiToken,
      textModel: bundle.cloudflare_ai.textModel,
      whisperModel: bundle.cloudflare_ai.whisperModel,
      staffId,
    });
    seeded.push("cloudflare_ai");
  } else if (bundle.cloudflare_ai) {
    skipped.push("cloudflare_ai (empty/placeholder)");
  }

  if (
    bundle.cloudflare_email_routing &&
    (bundle.cloudflare_email_routing.autoGenerateSecret ||
      !isPlaceholderValue(bundle.cloudflare_email_routing.webhookSecret))
  ) {
    savePlatformCloudflareEmailConfig({
      enabled: bundle.cloudflare_email_routing.enabled,
      inboundDomain: bundle.cloudflare_email_routing.inboundDomain,
      webhookSecret: bundle.cloudflare_email_routing.webhookSecret,
      autoGenerateSecret: bundle.cloudflare_email_routing.autoGenerateSecret,
      staffId,
    });
    seeded.push("cloudflare_email_routing");
  } else if (bundle.cloudflare_email_routing) {
    skipped.push("cloudflare_email_routing (empty)");
  }

  if (
    bundle.web_push_vapid &&
    (bundle.web_push_vapid.autoGenerate ||
      (!isPlaceholderValue(bundle.web_push_vapid.publicKey) &&
        !isPlaceholderValue(bundle.web_push_vapid.privateKeyD)))
  ) {
    savePlatformVapidConfig({
      enabled: bundle.web_push_vapid.enabled,
      subject: bundle.web_push_vapid.subject,
      publicKey: bundle.web_push_vapid.publicKey,
      privateKeyD: bundle.web_push_vapid.privateKeyD,
      autoGenerate: bundle.web_push_vapid.autoGenerate,
      staffId,
    });
    seeded.push("web_push_vapid");
  } else if (bundle.web_push_vapid) {
    skipped.push("web_push_vapid (empty)");
  }

  if (
    bundle.bhashini &&
    (!isPlaceholderValue(bundle.bhashini.inferenceApiKey) ||
      (!isPlaceholderValue(bundle.bhashini.userId) &&
        !isPlaceholderValue(bundle.bhashini.ulcaApiKey)))
  ) {
    savePlatformBhashiniConfig({
      enabled: bundle.bhashini.enabled,
      userId: bundle.bhashini.userId,
      ulcaApiKey: bundle.bhashini.ulcaApiKey,
      inferenceApiKey: bundle.bhashini.inferenceApiKey,
      staffId,
    });
    seeded.push("bhashini");
  } else if (bundle.bhashini) {
    skipped.push("bhashini (empty)");
  }

  return { seeded, skipped };
}

export function clearPlatformCredentialOverride(providerKey: PlatformCredentialProviderKey): void {
  controlDb()
    .delete(controlSchema.platformCredentials)
    .where(eq(controlSchema.platformCredentials.providerKey, providerKey))
    .run();
}

export function recordPlatformCredentialVerification(params: {
  providerKey: PlatformCredentialProviderKey;
  status: "healthy" | "error";
  message: string;
}): void {
  controlDb()
    .update(controlSchema.platformCredentials)
    .set({
      lastVerifiedAt: Date.now(),
      lastVerifyStatus: params.status,
      lastVerifyMessage: params.message,
    })
    .where(eq(controlSchema.platformCredentials.providerKey, params.providerKey))
    .run();
}

/**
 * Safe summary stripped of raw plaintext secrets for Admin UI rendering.
 */
export function getSafePlatformCredentialsAdminSnapshot() {
  const google = getPlatformGoogleOAuthConfig();
  const googleAds = getPlatformGoogleAdsConfig();
  const smtp = getPlatformSmtpConfig();
  const r2 = getPlatformManagedR2Config();
  const meta = getPlatformMetaAppConfig();
  const razorpay = getPlatformRazorpayConfig();
  const turnstile = getPlatformTurnstileConfig();
  const cloudflareAi = getPlatformCloudflareAiConfig();
  const cloudflareEmail = getPlatformCloudflareEmailConfig();
  const vapid = getPlatformVapidConfig();
  const bhashini = getPlatformBhashiniConfig();

  return {
    google: {
      enabled: google.enabled,
      clientId: google.clientId,
      projectId: google.projectId,
      consentAppName: google.consentAppName,
      publishingStatus: google.publishingStatus,
      defaultDriveFolderName: google.defaultDriveFolderName,
      enableDriveOAuth: google.enableDriveOAuth,
      enableGbpOAuth: google.enableGbpOAuth,
      enableGoogleAdsOAuth: google.enableGoogleAdsOAuth,
      source: google.source,
      isReady: google.isReady,
      maskedClientSecret: google.maskedClientSecret,
      updatedAt: google.updatedAt,
      lastVerifiedAt: google.lastVerifiedAt,
      lastVerifyStatus: google.lastVerifyStatus,
      lastVerifyMessage: google.lastVerifyMessage,
    },
    googleAds: {
      enabled: googleAds.enabled,
      loginCustomerId: googleAds.loginCustomerId,
      managedCustomerId: googleAds.managedCustomerId,
      apiVersion: googleAds.apiVersion,
      source: googleAds.source,
      isReady: googleAds.isReady,
      isManagedAdsReady: googleAds.isManagedAdsReady,
      maskedDeveloperToken: googleAds.maskedDeveloperToken,
      maskedManagedRefreshToken: googleAds.maskedManagedRefreshToken,
      updatedAt: googleAds.updatedAt,
    },
    smtp: {
      enabled: smtp.enabled,
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      from: smtp.from,
      user: smtp.user,
      source: smtp.source,
      isReady: smtp.isReady,
      maskedPassword: smtp.maskedPassword,
      updatedAt: smtp.updatedAt,
      lastVerifiedAt: smtp.lastVerifiedAt,
      lastVerifyStatus: smtp.lastVerifyStatus,
      lastVerifyMessage: smtp.lastVerifyMessage,
    },
    r2: {
      enabled: r2.enabled,
      accountId: r2.accountId,
      endpointUrl: r2.endpointUrl,
      accessKeyId: r2.accessKeyId,
      bucketPrivate: r2.bucketPrivate,
      bucketPublic: r2.bucketPublic,
      publicBaseUrl: r2.publicBaseUrl,
      source: r2.source,
      isReady: r2.isReady,
      maskedSecretAccessKey: r2.maskedSecretAccessKey,
      updatedAt: r2.updatedAt,
    },
    meta: {
      enabled: meta.enabled,
      appId: meta.appId,
      configId: meta.configId,
      graphVersion: meta.graphVersion,
      enableMetaOAuth: meta.enableMetaOAuth,
      managedAdAccountId: meta.managedAdAccountId,
      managedPageId: meta.managedPageId,
      source: meta.source,
      isReady: meta.isReady,
      isManagedAdsReady: meta.isManagedAdsReady,
      maskedAppSecret: meta.maskedAppSecret,
      maskedVerifyToken: meta.maskedVerifyToken,
      maskedManagedSystemToken: meta.maskedManagedSystemToken,
      updatedAt: meta.updatedAt,
    },
    razorpay: {
      enabled: razorpay.enabled,
      keyId: razorpay.keyId,
      source: razorpay.source,
      isReady: razorpay.isReady,
      maskedKeySecret: razorpay.maskedKeySecret,
      maskedWebhookSecret: razorpay.maskedWebhookSecret,
      updatedAt: razorpay.updatedAt,
    },
    turnstile: {
      enabled: turnstile.enabled,
      siteKey: turnstile.siteKey,
      enforceOnLogin: turnstile.enforceOnLogin,
      enforceOnRegister: turnstile.enforceOnRegister,
      enforceOnPublicForms: turnstile.enforceOnPublicForms,
      source: turnstile.source,
      isReady: turnstile.isReady,
      maskedSecretKey: turnstile.maskedSecretKey,
      updatedAt: turnstile.updatedAt,
    },
    cloudflareAi: {
      enabled: cloudflareAi.enabled,
      accountId: cloudflareAi.accountId,
      textModel: cloudflareAi.textModel,
      whisperModel: cloudflareAi.whisperModel,
      source: cloudflareAi.source,
      isReady: cloudflareAi.isReady,
      maskedApiToken: cloudflareAi.maskedApiToken,
      updatedAt: cloudflareAi.updatedAt,
    },
    cloudflareEmail: {
      enabled: cloudflareEmail.enabled,
      inboundDomain: cloudflareEmail.inboundDomain,
      source: cloudflareEmail.source,
      isReady: cloudflareEmail.isReady,
      maskedWebhookSecret: cloudflareEmail.maskedWebhookSecret,
      updatedAt: cloudflareEmail.updatedAt,
    },
    vapid: {
      enabled: vapid.enabled,
      subject: vapid.subject,
      publicKey: vapid.publicKey,
      source: vapid.source,
      isReady: vapid.isReady,
      maskedPrivateKey: vapid.maskedPrivateKey,
      updatedAt: vapid.updatedAt,
    },
    bhashini: {
      enabled: bhashini.enabled,
      userId: bhashini.userId,
      source: bhashini.source,
      isReady: bhashini.isReady,
      maskedUlcaApiKey: bhashini.maskedUlcaApiKey,
      maskedInferenceApiKey: bhashini.maskedInferenceApiKey,
      updatedAt: bhashini.updatedAt,
    },
  };
}
