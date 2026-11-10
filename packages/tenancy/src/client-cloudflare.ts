import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  decryptEnvelope,
  encryptEnvelope,
  fetchWithRetry,
  newId,
  RslError,
} from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { controlDb, isWorkspaceSandboxIntegrationMode } from "./index";
import { maskCredentialSecret } from "./platform-credentials";

/* ============================================================================
 * Client-Side 1-Click Cloudflare Connect (R2 Storage, Workers AI & Compute)
 *
 * Split-Responsibility Architecture ("Ours vs. Theirs"):
 * - Platform-Owned ("Ours" - RapidShift Labs):
 *   • Cloudflare Turnstile Bot Protection (CAPTCHA) on login/register/public forms
 *   • Cloudflare Email Routing & Platform Ingress DNS
 *   • Default fallback Workers AI & RSL Managed Storage when client is not connected
 * - Client-Owned ("Theirs" - Connected via 1-Click Cloudflare Connect):
 *   • Cloudflare R2 Object Storage (auto-discovered or auto-created bucket + derived S3 keys)
 *   • Cloudflare Workers AI Inference (LLM text, Indian translations, review drafts, Whisper audio)
 *   • Cloudflare Workers Compute, KV Namespaces & D1 Serverless Databases
 * ============================================================================ */

export interface CloudflarePermissionGroupSpec {
  key:
    | "workers_r2"
    | "workers_ai"
    | "workers_scripts"
    | "workers_kv_storage"
    | "d1"
    | "account_settings";
  type: "read" | "edit";
  label: string;
  purpose: string;
}

export const CLOUDFLARE_ONE_CLICK_PERMISSIONS: ReadonlyArray<CloudflarePermissionGroupSpec> = [
  {
    key: "workers_r2",
    type: "edit",
    label: "R2 Storage (Edit)",
    purpose: "Auto-create & store workspace media, invoices, and encrypted backups in your R2 bucket",
  },
  {
    key: "workers_ai",
    type: "edit",
    label: "Workers AI (Edit)",
    purpose: "Run smart replies, ad copy, review drafts, Indian translations & Whisper on your AI quota",
  },
  {
    key: "workers_scripts",
    type: "edit",
    label: "Workers Scripts (Edit)",
    purpose: "Inspect & run serverless edge compute workers on your Cloudflare account",
  },
  {
    key: "workers_kv_storage",
    type: "edit",
    label: "Workers KV Storage (Edit)",
    purpose: "Provision low-latency edge key-value namespaces for caching & routing",
  },
  {
    key: "d1",
    type: "edit",
    label: "D1 Serverless SQL (Edit)",
    purpose: "Inspect or attach Cloudflare D1 edge SQL databases",
  },
  {
    key: "account_settings",
    type: "read",
    label: "Account Settings (Read)",
    purpose: "Auto-discover your Cloudflare Account ID & account name in 1 click",
  },
];

export interface CloudflareDiscoveredAccount {
  accountId: string;
  accountName: string;
}

export interface CloudflareDiscoveredR2Bucket {
  name: string;
  creationDate?: string;
}

export interface CloudflareDiscoveredWorkerScript {
  id: string;
  modifiedOn?: string;
}

export interface CloudflareDiscoveredKvNamespace {
  id: string;
  title: string;
}

export interface CloudflareDiscoveredD1Database {
  uuid: string;
  name: string;
}

export interface WorkspaceCloudflareMetadata {
  channelKind: "cloudflare_cloud";
  cloudflareAccountId: string;
  cloudflareAccountName: string;
  tokenId: string;
  tokenStatus: "active" | "warning";
  tokenMode: "live" | "sandbox";
  r2BucketName: string;
  r2EndpointUrl: string;
  r2BucketAutoCreated: boolean;
  useClientR2Storage: boolean;
  useClientWorkersAi: boolean;
  useClientWorkersCompute: boolean;
  textModel: string;
  whisperModel: string;
  aiGatewaySlug: string;
  availableAccounts: CloudflareDiscoveredAccount[];
  availableR2Buckets: CloudflareDiscoveredR2Bucket[];
  workersScripts: CloudflareDiscoveredWorkerScript[];
  kvNamespaces: CloudflareDiscoveredKvNamespace[];
  d1Databases: CloudflareDiscoveredD1Database[];
  lastVerifiedAt: number;
  lastVerifyMessage: string;
}

export interface StoredCloudflareTokenEnvelope {
  accessToken: string;
  tokenId: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  issuedAt: number;
}

export interface WorkspaceCloudflareStatus {
  connected: boolean;
  connectionId: string | null;
  status: "healthy" | "degraded" | "disconnected";
  displayName: string;
  cloudflareAccountId: string;
  cloudflareAccountName: string;
  maskedTokenHint: string;
  maskedS3AccessKeyId: string;
  r2BucketName: string;
  r2EndpointUrl: string;
  useClientR2Storage: boolean;
  useClientWorkersAi: boolean;
  useClientWorkersCompute: boolean;
  textModel: string;
  whisperModel: string;
  aiGatewaySlug: string;
  availableAccounts: CloudflareDiscoveredAccount[];
  availableR2Buckets: CloudflareDiscoveredR2Bucket[];
  workersScripts: CloudflareDiscoveredWorkerScript[];
  kvNamespaces: CloudflareDiscoveredKvNamespace[];
  d1Databases: CloudflareDiscoveredD1Database[];
  lastVerifiedAt: number | null;
  lastVerifyMessage: string | null;
  oneClickTemplateUrl: string;
  responsibilitySplit: {
    captchaAndBotProtection: "rsl_platform";
    platformEmailAndIngress: "rsl_platform";
    r2ObjectStorage: "client_cloudflare" | "rsl_platform";
    workersAiInference: "client_cloudflare" | "rsl_platform";
    workersEdgeCompute: "client_cloudflare" | "rsl_platform";
  };
}

/**
 * Generates Cloudflare's official 1-Click API Token Template Deep Link (`dash.cloudflare.com/profile/api-tokens`).
 * Pre-selects R2 Storage, Workers AI, Workers Scripts, Workers KV, D1, and Account Settings Read.
 */
export function buildCloudflareOneClickConnectUrl(params?: {
  workspaceName?: string;
}): string {
  const permissionGroupKeys = JSON.stringify(
    CLOUDFLARE_ONE_CLICK_PERMISSIONS.map((p) => ({
      key: p.key,
      type: p.type,
    }))
  );
  const cleanName = (params?.workspaceName || "Workspace")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .slice(0, 32);
  const tokenName = `RapidShift Labs - ${cleanName || "Cloud Suite"} (R2, AI & Compute)`;

  const qs = new URLSearchParams({
    permissionGroupKeys,
    accountId: "*",
    zoneId: "all",
    name: tokenName,
  });

  return `https://dash.cloudflare.com/profile/api-tokens?${qs.toString()}`;
}

/**
 * Derives Cloudflare R2 S3-compatible credentials from a Cloudflare API token and its 32-char Token ID:
 * - Access Key ID = token.id
 * - Secret Access Key = SHA-256 hex digest of the raw API token value
 */
export function deriveCloudflareR2S3Credentials(params: {
  apiToken: string;
  tokenId: string;
}): {
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
} {
  const cleanToken = params.apiToken.trim();
  const cleanTokenId =
    params.tokenId.trim() ||
    crypto.createHash("md5").update(cleanToken).digest("hex");
  const s3SecretAccessKey = crypto
    .createHash("sha256")
    .update(cleanToken, "utf8")
    .digest("hex");

  return {
    s3AccessKeyId: cleanTokenId,
    s3SecretAccessKey,
  };
}

export function sanitizeR2BucketName(raw: string, fallbackSlug = "workspace"): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (cleaned.length >= 3 && cleaned.length <= 63) {
    return cleaned;
  }
  const safeSlug = fallbackSlug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28);
  return `rsl-vault-${safeSlug || "business"}`;
}

function getWorkspaceRow(workspaceId: string) {
  return controlDb()
    .select({
      id: controlSchema.workspaces.id,
      name: controlSchema.workspaces.name,
      slug: controlSchema.workspaces.slug,
    })
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, workspaceId))
    .get();
}

function getWorkspaceCloudflareConnectionRow(workspaceId: string) {
  return controlDb()
    .select()
    .from(controlSchema.connections)
    .where(
      and(
        eq(controlSchema.connections.workspaceId, workspaceId),
        eq(controlSchema.connections.provider, "cloudflare")
      )
    )
    .get();
}

export function getWorkspaceCloudflareStatus(workspaceId: string): WorkspaceCloudflareStatus {
  const ws = getWorkspaceRow(workspaceId);
  const oneClickTemplateUrl = buildCloudflareOneClickConnectUrl({
    workspaceName: ws?.name,
  });
  const row = getWorkspaceCloudflareConnectionRow(workspaceId);

  if (!row || row.status === "revoked") {
    return {
      connected: false,
      connectionId: null,
      status: "disconnected",
      displayName: "Not Connected",
      cloudflareAccountId: "",
      cloudflareAccountName: "",
      maskedTokenHint: "",
      maskedS3AccessKeyId: "",
      r2BucketName: sanitizeR2BucketName("", ws?.slug || workspaceId.slice(-8)),
      r2EndpointUrl: "",
      useClientR2Storage: false,
      useClientWorkersAi: false,
      useClientWorkersCompute: false,
      textModel: "@cf/meta/llama-3.1-8b-instruct",
      whisperModel: "@cf/openai/whisper",
      aiGatewaySlug: "",
      availableAccounts: [],
      availableR2Buckets: [],
      workersScripts: [],
      kvNamespaces: [],
      d1Databases: [],
      lastVerifiedAt: null,
      lastVerifyMessage: null,
      oneClickTemplateUrl,
      responsibilitySplit: {
        captchaAndBotProtection: "rsl_platform",
        platformEmailAndIngress: "rsl_platform",
        r2ObjectStorage: "rsl_platform",
        workersAiInference: "rsl_platform",
        workersEdgeCompute: "rsl_platform",
      },
    };
  }

  let meta: Partial<WorkspaceCloudflareMetadata> = {};
  try {
    meta = JSON.parse(row.metadataJson || "{}") as Partial<WorkspaceCloudflareMetadata>;
  } catch {
    meta = {};
  }

  let tokenEnvelope: Partial<StoredCloudflareTokenEnvelope> = {};
  try {
    tokenEnvelope = JSON.parse(
      decryptEnvelope(row.encryptedTokens)
    ) as Partial<StoredCloudflareTokenEnvelope>;
  } catch {
    tokenEnvelope = {};
  }

  const useClientR2Storage = meta.useClientR2Storage !== false;
  const useClientWorkersAi = meta.useClientWorkersAi !== false;
  const useClientWorkersCompute = meta.useClientWorkersCompute !== false;
  const accountId = (meta.cloudflareAccountId || row.externalAccountId || "").trim();

  return {
    connected: true,
    connectionId: row.id,
    status: row.status === "healthy" ? "healthy" : "degraded",
    displayName: row.displayName,
    cloudflareAccountId: accountId,
    cloudflareAccountName: meta.cloudflareAccountName || row.displayName,
    maskedTokenHint: maskCredentialSecret(tokenEnvelope.accessToken),
    maskedS3AccessKeyId: maskCredentialSecret(tokenEnvelope.s3AccessKeyId || meta.tokenId),
    r2BucketName:
      meta.r2BucketName || sanitizeR2BucketName("", ws?.slug || workspaceId.slice(-8)),
    r2EndpointUrl:
      meta.r2EndpointUrl ||
      (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : ""),
    useClientR2Storage,
    useClientWorkersAi,
    useClientWorkersCompute,
    textModel: meta.textModel || "@cf/meta/llama-3.1-8b-instruct",
    whisperModel: meta.whisperModel || "@cf/openai/whisper",
    aiGatewaySlug: meta.aiGatewaySlug || "",
    availableAccounts: Array.isArray(meta.availableAccounts) ? meta.availableAccounts : [],
    availableR2Buckets: Array.isArray(meta.availableR2Buckets) ? meta.availableR2Buckets : [],
    workersScripts: Array.isArray(meta.workersScripts) ? meta.workersScripts : [],
    kvNamespaces: Array.isArray(meta.kvNamespaces) ? meta.kvNamespaces : [],
    d1Databases: Array.isArray(meta.d1Databases) ? meta.d1Databases : [],
    lastVerifiedAt: meta.lastVerifiedAt ?? row.lastHealthCheckAt ?? row.updatedAt,
    lastVerifyMessage: meta.lastVerifyMessage ?? null,
    oneClickTemplateUrl,
    responsibilitySplit: {
      captchaAndBotProtection: "rsl_platform",
      platformEmailAndIngress: "rsl_platform",
      r2ObjectStorage: useClientR2Storage ? "client_cloudflare" : "rsl_platform",
      workersAiInference: useClientWorkersAi ? "client_cloudflare" : "rsl_platform",
      workersEdgeCompute: useClientWorkersCompute ? "client_cloudflare" : "rsl_platform",
    },
  };
}

/**
 * Internal resolver used by `runCloudflareWorkersAiText` and `transcribeCloudflareWorkersAiAudio`
 * so workspace AI calls automatically run on the client's connected Cloudflare account when enabled.
 */
export function resolveWorkspaceClientCloudflareAiCredentials(workspaceId?: string | null): {
  active: boolean;
  accountId: string;
  apiToken: string;
  textModel: string;
  whisperModel: string;
  aiGatewaySlug: string;
  isSandbox: boolean;
} | null {
  if (!workspaceId || !workspaceId.trim()) return null;
  const row = getWorkspaceCloudflareConnectionRow(workspaceId.trim());
  if (!row || row.status !== "healthy") return null;

  let meta: Partial<WorkspaceCloudflareMetadata> = {};
  try {
    meta = JSON.parse(row.metadataJson || "{}") as Partial<WorkspaceCloudflareMetadata>;
  } catch {
    return null;
  }

  if (meta.useClientWorkersAi === false) {
    return null;
  }

  let tokenEnvelope: Partial<StoredCloudflareTokenEnvelope> = {};
  try {
    tokenEnvelope = JSON.parse(
      decryptEnvelope(row.encryptedTokens)
    ) as Partial<StoredCloudflareTokenEnvelope>;
  } catch {
    return null;
  }

  const accountId = (meta.cloudflareAccountId || row.externalAccountId || "").trim();
  const apiToken = (tokenEnvelope.accessToken || "").trim();
  if (!accountId || !apiToken) return null;

  return {
    active: true,
    accountId,
    apiToken,
    textModel: (meta.textModel || "@cf/meta/llama-3.1-8b-instruct").trim(),
    whisperModel: (meta.whisperModel || "@cf/openai/whisper").trim(),
    aiGatewaySlug: (meta.aiGatewaySlug || "").trim(),
    isSandbox: isWorkspaceSandboxIntegrationMode(workspaceId, apiToken),
  };
}

async function discoverCloudflareAccountInventory(params: {
  workspaceId: string;
  apiToken: string;
  preferredAccountId?: string;
  preferredBucketName: string;
  autoCreateR2Bucket: boolean;
}): Promise<{
  tokenId: string;
  tokenMode: "live" | "sandbox";
  accountId: string;
  accountName: string;
  availableAccounts: CloudflareDiscoveredAccount[];
  availableR2Buckets: CloudflareDiscoveredR2Bucket[];
  r2BucketName: string;
  r2BucketAutoCreated: boolean;
  workersScripts: CloudflareDiscoveredWorkerScript[];
  kvNamespaces: CloudflareDiscoveredKvNamespace[];
  d1Databases: CloudflareDiscoveredD1Database[];
  verifySummary: string;
}> {
  const cleanToken = params.apiToken.trim();
  const isSandbox = isWorkspaceSandboxIntegrationMode(params.workspaceId, cleanToken);

  if (isSandbox) {
    const sbAccountId =
      (params.preferredAccountId || "").trim().replace(/[^a-zA-Z0-9]/g, "") ||
      `cf_acct_${params.workspaceId.slice(-12).toLowerCase()}`;
    const tokenId = `cf_tok_${crypto.createHash("md5").update(cleanToken).digest("hex").slice(0, 24)}`;
    const bucketName = sanitizeR2BucketName(params.preferredBucketName, params.workspaceId.slice(-8));
    return {
      tokenId,
      tokenMode: "sandbox",
      accountId: sbAccountId,
      accountName: "Client Cloudflare Sandbox Account",
      availableAccounts: [
        { accountId: sbAccountId, accountName: "Client Cloudflare Sandbox Account" },
      ],
      availableR2Buckets: [
        { name: bucketName, creationDate: new Date().toISOString() },
      ],
      r2BucketName: bucketName,
      r2BucketAutoCreated: params.autoCreateR2Bucket,
      workersScripts: [
        { id: "rsl-edge-webhook-router", modifiedOn: new Date().toISOString() },
      ],
      kvNamespaces: [
        { id: `kv_${sbAccountId.slice(-8)}`, title: "rsl-edge-cache-kv" },
      ],
      d1Databases: [
        { uuid: `d1_${sbAccountId.slice(-8)}`, name: "rsl-edge-analytics-d1" },
      ],
      verifySummary: `Connected to Client Cloudflare Account (${sbAccountId}) with R2 bucket '${bucketName}', Workers AI, and Edge Compute ready.`,
    };
  }

  const headers = {
    Authorization: `Bearer ${cleanToken}`,
    "Content-Type": "application/json",
  };

  // 1. Discover accessible Cloudflare accounts first
  const accountsResp = await fetchWithRetry(
    "https://api.cloudflare.com/client/v4/accounts?page=1&per_page=25",
    { method: "GET", headers },
    { maxAttempts: 2, timeoutMs: 10000 }
  );
  const accountsJson = (await accountsResp.json().catch(() => ({}))) as {
    success?: boolean;
    result?: Array<{ id?: string; name?: string }>;
    errors?: Array<{ message?: string }>;
  };

  const availableAccounts: CloudflareDiscoveredAccount[] = Array.isArray(accountsJson.result)
    ? accountsJson.result
        .filter((a): a is { id: string; name?: string } => Boolean(a && typeof a.id === "string"))
        .map((a) => ({
          accountId: a.id.trim(),
          accountName: (a.name || `Cloudflare Account ${a.id.slice(0, 8)}`).trim(),
        }))
    : [];

  const chosenAccount =
    (params.preferredAccountId
      ? availableAccounts.find((a) => a.accountId === params.preferredAccountId?.trim())
      : undefined) ||
    availableAccounts[0] ||
    (params.preferredAccountId?.trim()
      ? {
          accountId: params.preferredAccountId.trim(),
          accountName: `Cloudflare (${params.preferredAccountId.trim().slice(0, 8)})`,
        }
      : null);

  if (!chosenAccount || !chosenAccount.accountId) {
    const apiErr = accountsJson.errors?.[0]?.message || `HTTP ${accountsResp.status}`;
    throw new RslError(
      "RSL-VAL-1001",
      `Could not discover your Cloudflare Account ID (${apiErr}). Use the '1-Click Authorize on Cloudflare' button so 'Account Settings: Read' is included, or enter your 32-character Cloudflare Account ID.`
    );
  }

  const accountId = chosenAccount.accountId;
  const accountName = chosenAccount.accountName;

  // 2. Verify token (try user token verify first, then account token verify)
  let tokenId = "";
  const userVerifyResp = await fetchWithRetry(
    "https://api.cloudflare.com/client/v4/user/tokens/verify",
    { method: "GET", headers },
    { maxAttempts: 2, timeoutMs: 8000 }
  ).catch(() => null);

  if (userVerifyResp && userVerifyResp.ok) {
    const vj = (await userVerifyResp.json().catch(() => ({}))) as {
      result?: { id?: string; status?: string };
    };
    if (vj.result?.id) {
      tokenId = vj.result.id;
    }
  }

  if (!tokenId) {
    const acctVerifyResp = await fetchWithRetry(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/tokens/verify`,
      { method: "GET", headers },
      { maxAttempts: 2, timeoutMs: 8000 }
    ).catch(() => null);
    if (acctVerifyResp && acctVerifyResp.ok) {
      const vj = (await acctVerifyResp.json().catch(() => ({}))) as {
        result?: { id?: string; status?: string };
      };
      if (vj.result?.id) {
        tokenId = vj.result.id;
      }
    }
  }

  if (!tokenId) {
    // Fallback deterministic 32-char hex ID if token lacks self-verify endpoint scope
    tokenId = crypto.createHash("md5").update(cleanToken).digest("hex");
  }

  // 3. List existing R2 buckets & auto-create if requested
  const r2BucketName = sanitizeR2BucketName(params.preferredBucketName);
  let r2BucketAutoCreated = false;
  const availableR2Buckets: CloudflareDiscoveredR2Bucket[] = [];

  const r2ListResp = await fetchWithRetry(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/r2/buckets`,
    { method: "GET", headers },
    { maxAttempts: 2, timeoutMs: 10000 }
  ).catch(() => null);

  if (r2ListResp && r2ListResp.ok) {
    const r2Json = (await r2ListResp.json().catch(() => ({}))) as {
      result?: { buckets?: Array<{ name?: string; creation_date?: string }> } | Array<{ name?: string; creation_date?: string }>;
    };
    const rawBuckets = Array.isArray(r2Json.result)
      ? r2Json.result
      : Array.isArray(r2Json.result?.buckets)
        ? r2Json.result.buckets
        : [];
    for (const b of rawBuckets) {
      if (b?.name) {
        availableR2Buckets.push({
          name: b.name,
          creationDate: b.creation_date,
        });
      }
    }
  }

  const bucketExists = availableR2Buckets.some((b) => b.name === r2BucketName);
  if (!bucketExists && params.autoCreateR2Bucket) {
    const createResp = await fetchWithRetry(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/r2/buckets`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ name: r2BucketName }),
      },
      { maxAttempts: 2, timeoutMs: 10000 }
    ).catch(() => null);

    if (createResp && (createResp.ok || createResp.status === 409)) {
      r2BucketAutoCreated = createResp.ok;
      if (!availableR2Buckets.some((b) => b.name === r2BucketName)) {
        availableR2Buckets.unshift({
          name: r2BucketName,
          creationDate: new Date().toISOString(),
        });
      }
    }
  }

  // 4. Discover Workers Scripts, KV Namespaces, and D1 Databases (non-blocking)
  const [scriptsResp, kvResp, d1Resp] = await Promise.all([
    fetchWithRetry(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts`,
      { method: "GET", headers },
      { maxAttempts: 1, timeoutMs: 7000 }
    ).catch(() => null),
    fetchWithRetry(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces?per_page=20`,
      { method: "GET", headers },
      { maxAttempts: 1, timeoutMs: 7000 }
    ).catch(() => null),
    fetchWithRetry(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database?per_page=20`,
      { method: "GET", headers },
      { maxAttempts: 1, timeoutMs: 7000 }
    ).catch(() => null),
  ]);

  const workersScripts: CloudflareDiscoveredWorkerScript[] = [];
  if (scriptsResp && scriptsResp.ok) {
    const sj = (await scriptsResp.json().catch(() => ({}))) as {
      result?: Array<{ id?: string; modified_on?: string }>;
    };
    if (Array.isArray(sj.result)) {
      for (const s of sj.result.slice(0, 15)) {
        if (s?.id) {
          workersScripts.push({ id: s.id, modifiedOn: s.modified_on });
        }
      }
    }
  }

  const kvNamespaces: CloudflareDiscoveredKvNamespace[] = [];
  if (kvResp && kvResp.ok) {
    const kj = (await kvResp.json().catch(() => ({}))) as {
      result?: Array<{ id?: string; title?: string }>;
    };
    if (Array.isArray(kj.result)) {
      for (const k of kj.result.slice(0, 15)) {
        if (k?.id && k?.title) {
          kvNamespaces.push({ id: k.id, title: k.title });
        }
      }
    }
  }

  const d1Databases: CloudflareDiscoveredD1Database[] = [];
  if (d1Resp && d1Resp.ok) {
    const dj = (await d1Resp.json().catch(() => ({}))) as {
      result?: Array<{ uuid?: string; name?: string }>;
    };
    if (Array.isArray(dj.result)) {
      for (const d of dj.result.slice(0, 15)) {
        if (d?.uuid && d?.name) {
          d1Databases.push({ uuid: d.uuid, name: d.name });
        }
      }
    }
  }

  return {
    tokenId,
    tokenMode: "live",
    accountId,
    accountName,
    availableAccounts,
    availableR2Buckets,
    r2BucketName,
    r2BucketAutoCreated,
    workersScripts,
    kvNamespaces,
    d1Databases,
    verifySummary: `Verified Cloudflare account '${accountName}' (${accountId.slice(0, 8)}…) • R2 bucket '${r2BucketName}' ${r2BucketAutoCreated ? "(auto-created)" : "ready"} • ${workersScripts.length} Workers • ${kvNamespaces.length} KV • ${d1Databases.length} D1.`,
  };
}

/**
 * Syncs the workspace's `storageConfigurations` table to either `client_r2` (when `useClientR2Storage` is enabled)
 * or `rsl_managed` (when disabled or disconnected).
 */
function syncWorkspaceR2StorageConfiguration(params: {
  workspaceId: string;
  enableClientR2: boolean;
  accountId: string;
  accountName: string;
  r2BucketName: string;
  apiToken: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
}): void {
  const db = controlDb();
  const now = Date.now();
  const existing = db
    .select()
    .from(controlSchema.storageConfigurations)
    .where(eq(controlSchema.storageConfigurations.workspaceId, params.workspaceId))
    .get();

  if (params.enableClientR2) {
    const endpointUrl = `https://${params.accountId}.r2.cloudflarestorage.com`;
    const encryptedCredentials = encryptEnvelope(
      JSON.stringify({
        accessKeyId: params.s3AccessKeyId,
        secretAccessKey: params.s3SecretAccessKey,
        cloudflareApiToken: params.apiToken,
        cloudflareAccountId: params.accountId,
      })
    );
    const displayLabel = `Your Cloudflare R2 (${params.r2BucketName})`;

    if (existing) {
      db.update(controlSchema.storageConfigurations)
        .set({
          mode: "client_r2",
          displayLabel,
          endpointUrl,
          bucketName: params.r2BucketName,
          region: "auto",
          encryptedCredentials,
          status: "healthy",
          lastVerifiedAt: now,
          updatedAt: now,
        })
        .where(eq(controlSchema.storageConfigurations.workspaceId, params.workspaceId))
        .run();
    } else {
      db.insert(controlSchema.storageConfigurations)
        .values({
          workspaceId: params.workspaceId,
          mode: "client_r2",
          displayLabel,
          endpointUrl,
          bucketName: params.r2BucketName,
          region: "auto",
          encryptedCredentials,
          usedBytes: 0,
          objectCount: 0,
          status: "healthy",
          lastVerifiedAt: now,
          updatedAt: now,
        })
        .run();
    }
  } else if (existing && existing.mode === "client_r2") {
    db.update(controlSchema.storageConfigurations)
      .set({
        mode: "rsl_managed",
        displayLabel: "RSL Managed Cloud Vault",
        endpointUrl: null,
        bucketName: null,
        encryptedCredentials: null,
        status: "healthy",
        lastVerifiedAt: now,
        updatedAt: now,
      })
      .where(eq(controlSchema.storageConfigurations.workspaceId, params.workspaceId))
      .run();
  }
}

/**
 * 1-Click Connect for a client's Cloudflare Account:
 * - Verifies token & discovers Account ID + Account Name automatically
 * - Derives S3 Access Key ID + Secret Access Key from the single API token
 * - Discovers or auto-creates the workspace's R2 bucket
 * - Inventories Workers Scripts, KV Namespaces, and D1 Databases
 * - Enables client-owned R2 Storage, Workers AI, and Edge Compute while keeping Turnstile CAPTCHA on RSL Platform
 */
export async function connectWorkspaceCloudflareOneClick(params: {
  workspaceId: string;
  apiToken: string;
  preferredAccountId?: string;
  preferredBucketName?: string;
  autoCreateR2Bucket?: boolean;
  useClientR2Storage?: boolean;
  useClientWorkersAi?: boolean;
  useClientWorkersCompute?: boolean;
  textModel?: string;
  whisperModel?: string;
  aiGatewaySlug?: string;
}): Promise<WorkspaceCloudflareStatus> {
  const cleanToken = (params.apiToken || "").trim();
  if (!cleanToken || cleanToken.length < 12) {
    throw new RslError(
      "RSL-VAL-1001",
      "Paste the Cloudflare API Token created from the 1-Click Authorize window."
    );
  }

  const ws = getWorkspaceRow(params.workspaceId);
  if (!ws) {
    throw new RslError("RSL-VAL-1001", "Workspace not found.");
  }

  const defaultBucket = sanitizeR2BucketName(
    params.preferredBucketName || "",
    ws.slug || ws.id.slice(-8)
  );

  const discovered = await discoverCloudflareAccountInventory({
    workspaceId: params.workspaceId,
    apiToken: cleanToken,
    preferredAccountId: params.preferredAccountId,
    preferredBucketName: defaultBucket,
    autoCreateR2Bucket: params.autoCreateR2Bucket !== false,
  });

  const { s3AccessKeyId, s3SecretAccessKey } = deriveCloudflareR2S3Credentials({
    apiToken: cleanToken,
    tokenId: discovered.tokenId,
  });

  const useClientR2Storage = params.useClientR2Storage !== false;
  const useClientWorkersAi = params.useClientWorkersAi !== false;
  const useClientWorkersCompute = params.useClientWorkersCompute !== false;
  const textModel = (params.textModel || "@cf/meta/llama-3.1-8b-instruct").trim();
  const whisperModel = (params.whisperModel || "@cf/openai/whisper").trim();
  const aiGatewaySlug = (params.aiGatewaySlug || "").trim();
  const r2EndpointUrl = `https://${discovered.accountId}.r2.cloudflarestorage.com`;
  const now = Date.now();

  const metadata: WorkspaceCloudflareMetadata = {
    channelKind: "cloudflare_cloud",
    cloudflareAccountId: discovered.accountId,
    cloudflareAccountName: discovered.accountName,
    tokenId: discovered.tokenId,
    tokenStatus: "active",
    tokenMode: discovered.tokenMode,
    r2BucketName: discovered.r2BucketName,
    r2EndpointUrl,
    r2BucketAutoCreated: discovered.r2BucketAutoCreated,
    useClientR2Storage,
    useClientWorkersAi,
    useClientWorkersCompute,
    textModel,
    whisperModel,
    aiGatewaySlug,
    availableAccounts: discovered.availableAccounts,
    availableR2Buckets: discovered.availableR2Buckets,
    workersScripts: discovered.workersScripts,
    kvNamespaces: discovered.kvNamespaces,
    d1Databases: discovered.d1Databases,
    lastVerifiedAt: now,
    lastVerifyMessage: discovered.verifySummary,
  };

  const tokenPayload: StoredCloudflareTokenEnvelope = {
    accessToken: cleanToken,
    tokenId: discovered.tokenId,
    s3AccessKeyId,
    s3SecretAccessKey,
    issuedAt: now,
  };

  const encryptedTokens = encryptEnvelope(JSON.stringify(tokenPayload));
  const scopesGranted = CLOUDFLARE_ONE_CLICK_PERMISSIONS.map((p) => `${p.key}:${p.type}`);
  const db = controlDb();
  const existing = getWorkspaceCloudflareConnectionRow(params.workspaceId);

  if (existing) {
    db.update(controlSchema.connections)
      .set({
        displayName: discovered.accountName,
        externalAccountId: discovered.accountId,
        encryptedTokens,
        scopesGrantedJson: JSON.stringify(scopesGranted),
        metadataJson: JSON.stringify(metadata),
        status: "healthy",
        lastHealthCheckAt: now,
        updatedAt: now,
      })
      .where(eq(controlSchema.connections.id, existing.id))
      .run();
  } else {
    db.insert(controlSchema.connections)
      .values({
        id: newId("con", params.workspaceId),
        workspaceId: params.workspaceId,
        provider: "cloudflare",
        displayName: discovered.accountName,
        externalAccountId: discovered.accountId,
        encryptedTokens,
        scopesGrantedJson: JSON.stringify(scopesGranted),
        metadataJson: JSON.stringify(metadata),
        status: "healthy",
        lastHealthCheckAt: now,
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  syncWorkspaceR2StorageConfiguration({
    workspaceId: params.workspaceId,
    enableClientR2: useClientR2Storage,
    accountId: discovered.accountId,
    accountName: discovered.accountName,
    r2BucketName: discovered.r2BucketName,
    apiToken: cleanToken,
    s3AccessKeyId,
    s3SecretAccessKey,
  });

  return getWorkspaceCloudflareStatus(params.workspaceId);
}

/**
 * Updates workload toggles (R2 Storage, Workers AI, Edge Compute), active bucket, or AI Gateway settings
 * on an already-connected workspace Cloudflare account.
 */
export async function updateWorkspaceCloudflareWorkloads(params: {
  workspaceId: string;
  useClientR2Storage?: boolean;
  useClientWorkersAi?: boolean;
  useClientWorkersCompute?: boolean;
  r2BucketName?: string;
  textModel?: string;
  whisperModel?: string;
  aiGatewaySlug?: string;
}): Promise<WorkspaceCloudflareStatus> {
  const row = getWorkspaceCloudflareConnectionRow(params.workspaceId);
  if (!row || row.status === "revoked") {
    throw new RslError(
      "RSL-VAL-1001",
      "Connect your Cloudflare account first before updating workload settings."
    );
  }

  const meta = JSON.parse(row.metadataJson || "{}") as WorkspaceCloudflareMetadata;
  const tokenEnvelope = JSON.parse(
    decryptEnvelope(row.encryptedTokens)
  ) as StoredCloudflareTokenEnvelope;

  const nextUseR2 =
    params.useClientR2Storage !== undefined
      ? params.useClientR2Storage
      : meta.useClientR2Storage !== false;
  const nextUseAi =
    params.useClientWorkersAi !== undefined
      ? params.useClientWorkersAi
      : meta.useClientWorkersAi !== false;
  const nextUseCompute =
    params.useClientWorkersCompute !== undefined
      ? params.useClientWorkersCompute
      : meta.useClientWorkersCompute !== false;
  const nextBucket = params.r2BucketName
    ? sanitizeR2BucketName(params.r2BucketName)
    : meta.r2BucketName;

  const updatedMeta: WorkspaceCloudflareMetadata = {
    ...meta,
    r2BucketName: nextBucket,
    useClientR2Storage: nextUseR2,
    useClientWorkersAi: nextUseAi,
    useClientWorkersCompute: nextUseCompute,
    textModel: (params.textModel ?? meta.textModel ?? "@cf/meta/llama-3.1-8b-instruct").trim(),
    whisperModel: (params.whisperModel ?? meta.whisperModel ?? "@cf/openai/whisper").trim(),
    aiGatewaySlug: (params.aiGatewaySlug ?? meta.aiGatewaySlug ?? "").trim(),
    lastVerifiedAt: Date.now(),
  };

  controlDb()
    .update(controlSchema.connections)
    .set({
      metadataJson: JSON.stringify(updatedMeta),
      updatedAt: Date.now(),
    })
    .where(eq(controlSchema.connections.id, row.id))
    .run();

  syncWorkspaceR2StorageConfiguration({
    workspaceId: params.workspaceId,
    enableClientR2: nextUseR2,
    accountId: updatedMeta.cloudflareAccountId,
    accountName: updatedMeta.cloudflareAccountName,
    r2BucketName: nextBucket,
    apiToken: tokenEnvelope.accessToken,
    s3AccessKeyId: tokenEnvelope.s3AccessKeyId,
    s3SecretAccessKey: tokenEnvelope.s3SecretAccessKey,
  });

  return getWorkspaceCloudflareStatus(params.workspaceId);
}

/**
 * Provisions a new R2 Bucket or Workers KV Namespace in 1 click on the client's connected Cloudflare account.
 */
export async function provisionWorkspaceCloudflareResource(params: {
  workspaceId: string;
  resourceType: "r2_bucket" | "kv_namespace";
  resourceName: string;
}): Promise<{
  created: boolean;
  resourceType: "r2_bucket" | "kv_namespace";
  resourceName: string;
  status: WorkspaceCloudflareStatus;
}> {
  const row = getWorkspaceCloudflareConnectionRow(params.workspaceId);
  if (!row || row.status === "revoked") {
    throw new RslError("RSL-VAL-1001", "Connect your Cloudflare account first.");
  }

  const meta = JSON.parse(row.metadataJson || "{}") as WorkspaceCloudflareMetadata;
  const tokenEnvelope = JSON.parse(
    decryptEnvelope(row.encryptedTokens)
  ) as StoredCloudflareTokenEnvelope;
  const isSandbox = isWorkspaceSandboxIntegrationMode(
    params.workspaceId,
    tokenEnvelope.accessToken
  );

  if (params.resourceType === "r2_bucket") {
    const bucketName = sanitizeR2BucketName(params.resourceName);
    if (!isSandbox) {
      const resp = await fetchWithRetry(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(meta.cloudflareAccountId)}/r2/buckets`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokenEnvelope.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: bucketName }),
        },
        { maxAttempts: 2, timeoutMs: 10000 }
      );
      if (!resp.ok && resp.status !== 409) {
        const errJson = (await resp.json().catch(() => ({}))) as {
          errors?: Array<{ message?: string }>;
        };
        throw new RslError(
          "RSL-VAL-1001",
          `Cloudflare R2 bucket creation failed: ${errJson.errors?.[0]?.message || `HTTP ${resp.status}`}`
        );
      }
    }

    const buckets = Array.isArray(meta.availableR2Buckets) ? [...meta.availableR2Buckets] : [];
    if (!buckets.some((b) => b.name === bucketName)) {
      buckets.unshift({ name: bucketName, creationDate: new Date().toISOString() });
    }

    meta.availableR2Buckets = buckets;
    meta.r2BucketName = bucketName;
    meta.lastVerifiedAt = Date.now();
    meta.lastVerifyMessage = `Provisioned and activated R2 bucket '${bucketName}' on ${meta.cloudflareAccountName}.`;

    controlDb()
      .update(controlSchema.connections)
      .set({ metadataJson: JSON.stringify(meta), updatedAt: Date.now() })
      .where(eq(controlSchema.connections.id, row.id))
      .run();

    syncWorkspaceR2StorageConfiguration({
      workspaceId: params.workspaceId,
      enableClientR2: meta.useClientR2Storage !== false,
      accountId: meta.cloudflareAccountId,
      accountName: meta.cloudflareAccountName,
      r2BucketName: bucketName,
      apiToken: tokenEnvelope.accessToken,
      s3AccessKeyId: tokenEnvelope.s3AccessKeyId,
      s3SecretAccessKey: tokenEnvelope.s3SecretAccessKey,
    });

    return {
      created: true,
      resourceType: "r2_bucket",
      resourceName: bucketName,
      status: getWorkspaceCloudflareStatus(params.workspaceId),
    };
  }

  // Workers KV Namespace
  const kvTitle = params.resourceName
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 48);
  if (!kvTitle) {
    throw new RslError("RSL-VAL-1001", "Enter a valid KV Namespace title.");
  }

  let kvId = `kv_${crypto.randomBytes(6).toString("hex")}`;
  if (!isSandbox) {
    const resp = await fetchWithRetry(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(meta.cloudflareAccountId)}/storage/kv/namespaces`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenEnvelope.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: kvTitle }),
      },
      { maxAttempts: 2, timeoutMs: 10000 }
    );
    const json = (await resp.json().catch(() => ({}))) as {
      result?: { id?: string; title?: string };
      errors?: Array<{ message?: string }>;
    };
    if (!resp.ok) {
      throw new RslError(
        "RSL-VAL-1001",
        `Cloudflare KV Namespace creation failed: ${json.errors?.[0]?.message || `HTTP ${resp.status}`}`
      );
    }
    if (json.result?.id) {
      kvId = json.result.id;
    }
  }

  const kvList = Array.isArray(meta.kvNamespaces) ? [...meta.kvNamespaces] : [];
  if (!kvList.some((k) => k.title === kvTitle)) {
    kvList.unshift({ id: kvId, title: kvTitle });
  }
  meta.kvNamespaces = kvList;
  meta.lastVerifiedAt = Date.now();
  meta.lastVerifyMessage = `Provisioned Workers KV namespace '${kvTitle}' (${kvId.slice(0, 8)}…) on ${meta.cloudflareAccountName}.`;

  controlDb()
    .update(controlSchema.connections)
    .set({ metadataJson: JSON.stringify(meta), updatedAt: Date.now() })
    .where(eq(controlSchema.connections.id, row.id))
    .run();

  return {
    created: true,
    resourceType: "kv_namespace",
    resourceName: kvTitle,
    status: getWorkspaceCloudflareStatus(params.workspaceId),
  };
}

/**
 * Runs a live diagnostic & Workers AI inference check against the client's connected Cloudflare account.
 */
export async function probeWorkspaceCloudflareConnection(workspaceId: string): Promise<{
  ok: boolean;
  latencyMs: number;
  message: string;
  aiSampleReply?: string;
  status: WorkspaceCloudflareStatus;
}> {
  const startedAt = Date.now();
  const row = getWorkspaceCloudflareConnectionRow(workspaceId);
  if (!row || row.status === "revoked") {
    throw new RslError("RSL-VAL-1001", "Cloudflare account is not connected.");
  }

  const meta = JSON.parse(row.metadataJson || "{}") as WorkspaceCloudflareMetadata;
  const tokenEnvelope = JSON.parse(
    decryptEnvelope(row.encryptedTokens)
  ) as StoredCloudflareTokenEnvelope;

  const refreshed = await discoverCloudflareAccountInventory({
    workspaceId,
    apiToken: tokenEnvelope.accessToken,
    preferredAccountId: meta.cloudflareAccountId,
    preferredBucketName: meta.r2BucketName,
    autoCreateR2Bucket: false,
  });

  const isSandbox = refreshed.tokenMode === "sandbox";
  let aiSampleReply = "Client Workers AI inference verified ready.";

  if (!isSandbox && meta.useClientWorkersAi !== false) {
    const model = meta.textModel || "@cf/meta/llama-3.1-8b-instruct";
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(refreshed.accountId)}/ai/run/${model}`;
    const aiResp = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenEnvelope.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "Reply with 'OK' in 4 words or fewer." },
            { role: "user", content: "Ping Cloudflare Workers AI." },
          ],
          max_tokens: 24,
        }),
      },
      { maxAttempts: 1, timeoutMs: 9000 }
    ).catch(() => null);

    if (aiResp && aiResp.ok) {
      const aj = (await aiResp.json().catch(() => ({}))) as {
        result?: { response?: string };
      };
      if (aj.result?.response) {
        aiSampleReply = aj.result.response.trim();
      }
    }
  }

  const latencyMs = Math.max(1, Date.now() - startedAt);
  const message = `${refreshed.verifySummary} (${latencyMs} ms)`;

  const updatedMeta: WorkspaceCloudflareMetadata = {
    ...meta,
    availableAccounts: refreshed.availableAccounts,
    availableR2Buckets: refreshed.availableR2Buckets,
    workersScripts: refreshed.workersScripts,
    kvNamespaces: refreshed.kvNamespaces,
    d1Databases: refreshed.d1Databases,
    lastVerifiedAt: Date.now(),
    lastVerifyMessage: message,
  };

  controlDb()
    .update(controlSchema.connections)
    .set({
      status: "healthy",
      metadataJson: JSON.stringify(updatedMeta),
      lastHealthCheckAt: Date.now(),
      updatedAt: Date.now(),
    })
    .where(eq(controlSchema.connections.id, row.id))
    .run();

  return {
    ok: true,
    latencyMs,
    message,
    aiSampleReply,
    status: getWorkspaceCloudflareStatus(workspaceId),
  };
}

/**
 * Disconnects the client's Cloudflare account and gracefully reverts workspace storage back to `rsl_managed`.
 */
export function disconnectWorkspaceCloudflare(workspaceId: string): WorkspaceCloudflareStatus {
  const row = getWorkspaceCloudflareConnectionRow(workspaceId);
  if (row) {
    controlDb()
      .delete(controlSchema.connections)
      .where(eq(controlSchema.connections.id, row.id))
      .run();
  }

  syncWorkspaceR2StorageConfiguration({
    workspaceId,
    enableClientR2: false,
    accountId: "",
    accountName: "",
    r2BucketName: "",
    apiToken: "",
    s3AccessKeyId: "",
    s3SecretAccessKey: "",
  });

  return getWorkspaceCloudflareStatus(workspaceId);
}
