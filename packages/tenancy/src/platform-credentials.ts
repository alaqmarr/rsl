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
  | "razorpay";

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
      source: developerToken ? "database" : "unconfigured",
      isReady: row.enabled && Boolean(developerToken),
      isManagedAdsReady:
        row.enabled && Boolean(developerToken && managedCustomerId && managedRefreshToken),
      maskedDeveloperToken: maskCredentialSecret(developerToken),
      maskedManagedRefreshToken: maskCredentialSecret(managedRefreshToken),
      updatedAt: row.updatedAt,
    };
  }

  const developerToken = (env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim();
  const loginCustomerId = normalizeCustomerIdDigits(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  const managedCustomerId = normalizeCustomerIdDigits(env.GOOGLE_ADS_MANAGED_CUSTOMER_ID);
  const managedRefreshToken = (env.GOOGLE_ADS_MANAGED_REFRESH_TOKEN || "").trim();
  const hasEnv = Boolean(developerToken);

  return {
    enabled: true,
    developerToken,
    loginCustomerId,
    managedCustomerId,
    managedRefreshToken,
    apiVersion: "v18",
    source: hasEnv ? "env" : "unconfigured",
    isReady: hasEnv,
    isManagedAdsReady: Boolean(developerToken && managedCustomerId && managedRefreshToken),
    maskedDeveloperToken: maskCredentialSecret(developerToken),
    maskedManagedRefreshToken: maskCredentialSecret(managedRefreshToken),
    updatedAt: null,
  };
}

export function getPublicGoogleAdsStatus(): PublicGoogleAdsStatus {
  const cfg = getPlatformGoogleAdsConfig();
  const oauth = getPlatformGoogleOAuthConfig();
  return {
    isReady: oauth.isReady && oauth.enableGoogleAdsOAuth,
    isManagedAdsReady: cfg.isManagedAdsReady && oauth.isReady,
    hasDeveloperToken: cfg.isReady,
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
    params.developerToken && params.developerToken.trim().length > 0
      ? params.developerToken.trim()
      : current.developerToken;
  const managedRefreshToken =
    params.managedRefreshToken && params.managedRefreshToken.trim().length > 0
      ? params.managedRefreshToken.trim()
      : current.managedRefreshToken;

  if (!developerToken) {
    throw new RslError(
      "RSL-VAL-1001",
      "Enter your Google Ads API Developer Token (from Google Ads Manager MCC → Tools → API Center)."
    );
  }

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
  };
}
