import { getEnv } from "./env";

export interface ResolveEndpointsOptions {
  hostHeader?: string | null;
  forwardedHostHeader?: string | null;
  forwardedProtoHeader?: string | null;
  workspaceSlug?: string | null;
  preferLocal?: boolean;
}

export interface ParsedClientSubdomain {
  hostname: string;
  workspaceSlug: string | null;
  zone: "tally" | "api" | "workspace" | "platform" | "local" | "custom";
}

export interface ResolvedPublicEndpoints {
  primaryDomain: string;
  cloudBaseUrl: string;
  tallyCloudBaseUrl: string;
  apiCloudBaseUrl: string;
  clientTallySubdomainHost: string;
  clientApiSubdomainHost: string;
  tallyWildcardPattern: string;
  apiWildcardPattern: string;
  workspaceSubdomainUrl: string;
  adminBaseUrl: string;
  docsBaseUrl: string;
  setupBaseUrl: string;
  localBaseUrl: string | null;
  isLocalDev: boolean;
  effectiveAppBaseUrl: string;
  effectiveTallyBaseUrl: string;
  effectiveApiBaseUrl: string;
  tallyWebhookUrl: string;
  tallyWebhookPingUrl: string;
  tallyBillEventApiUrl: string;
  tallyVouchersApiUrl: string;
  agentPairUrl: string;
  agentHeartbeatUrl: string;
  agentIngestUrl: string;
  agentConfigUrl: string;
  whatsappWebhookUrl: string;
  metaWebhookUrl: string;
  metaOAuthCallbackUrl: string;
  googleOAuthCallbackUrl: string;
  openApiSpecUrl: string;
}

const RESERVED_PLATFORM_SUBDOMAINS = new Set([
  "www",
  "app",
  "admin",
  "docs",
  "setup",
  "tally",
  "api",
  "mail",
  "smtp",
  "status",
]);

function cleanDomain(raw: string, fallback: string): string {
  const trimmed = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^\.+|\.+$/g, "");
  return trimmed || fallback;
}

function cleanSubdomain(raw: string, fallback: string): string {
  const trimmed = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "");
  return trimmed || fallback;
}

export function isLoopbackUrlOrHost(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return false;
  let hostname = trimmed;
  try {
    if (trimmed.includes("://")) {
      hostname = new URL(trimmed).hostname.toLowerCase();
    } else {
      hostname = (trimmed.split("/")[0] ?? "").replace(/:\d+$/, "");
    }
  } catch {
    hostname = (trimmed.split("/")[0] ?? "").replace(/:\d+$/, "");
  }
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function firstHeaderToken(val: string | null | undefined): string {
  if (!val) return "";
  return (val.split(",")[0] ?? "").trim();
}

export function parseClientSubdomainFromHost(
  rawHost: string | null | undefined,
  explicitPrimaryDomain?: string
): ParsedClientSubdomain {
  if (!rawHost) {
    return { hostname: "", workspaceSlug: null, zone: "platform" };
  }
  const env = getEnv();
  const primaryDomain = cleanDomain(
    explicitPrimaryDomain ?? env.PRIMARY_DOMAIN,
    "rapidshiftlabs.in"
  );
  const tallyZone = cleanSubdomain(env.TALLY_WILDCARD_ZONE, "tally");
  const apiZone = cleanSubdomain(env.API_WILDCARD_ZONE, "api");

  const hostname = (rawHost.trim().toLowerCase().split("/")[0] ?? "").replace(/:\d+$/, "");
  if (!hostname) {
    return { hostname: "", workspaceSlug: null, zone: "platform" };
  }
  if (isLoopbackUrlOrHost(hostname)) {
    return { hostname, workspaceSlug: null, zone: "local" };
  }

  const tallySuffix = `.${tallyZone}.${primaryDomain}`;
  if (hostname.endsWith(tallySuffix)) {
    const slug = cleanSubdomain(hostname.slice(0, -tallySuffix.length), "");
    if (slug && !slug.includes(".") && !RESERVED_PLATFORM_SUBDOMAINS.has(slug)) {
      return { hostname, workspaceSlug: slug, zone: "tally" };
    }
  }

  const apiSuffix = `.${apiZone}.${primaryDomain}`;
  if (hostname.endsWith(apiSuffix)) {
    const slug = cleanSubdomain(hostname.slice(0, -apiSuffix.length), "");
    if (slug && !slug.includes(".") && !RESERVED_PLATFORM_SUBDOMAINS.has(slug)) {
      return { hostname, workspaceSlug: slug, zone: "api" };
    }
  }

  const rootSuffix = `.${primaryDomain}`;
  if (hostname === primaryDomain) {
    return { hostname, workspaceSlug: null, zone: "platform" };
  }
  if (hostname.endsWith(rootSuffix)) {
    const sub = hostname.slice(0, -rootSuffix.length);
    if (!sub.includes(".")) {
      const cleaned = cleanSubdomain(sub, "");
      if (!cleaned || RESERVED_PLATFORM_SUBDOMAINS.has(cleaned)) {
        return { hostname, workspaceSlug: null, zone: "platform" };
      }
      return { hostname, workspaceSlug: cleaned, zone: "workspace" };
    }
  }

  return { hostname, workspaceSlug: null, zone: "custom" };
}

export function resolvePublicEndpoints(opts: ResolveEndpointsOptions = {}): ResolvedPublicEndpoints {
  const env = getEnv();
  const primaryDomain = cleanDomain(env.PRIMARY_DOMAIN, "rapidshiftlabs.in");
  const appSubdomain = cleanSubdomain(env.APP_SUBDOMAIN, "app");
  const adminSubdomain = cleanSubdomain(env.ADMIN_SUBDOMAIN, "admin");
  const docsSubdomain = cleanSubdomain(env.DOCS_SUBDOMAIN, "docs");
  const setupSubdomain = cleanSubdomain(env.SETUP_SUBDOMAIN, "setup");
  const tallyZone = cleanSubdomain(env.TALLY_WILDCARD_ZONE, "tally");
  const apiZone = cleanSubdomain(env.API_WILDCARD_ZONE, "api");
  const explicitTallySub = env.TALLY_SUBDOMAIN ? cleanSubdomain(env.TALLY_SUBDOMAIN, "") : "";

  const canonicalAppUrl = `https://${appSubdomain}.${primaryDomain}`;
  const canonicalAdminUrl = `https://${adminSubdomain}.${primaryDomain}`;
  const canonicalDocsUrl = `https://${docsSubdomain}.${primaryDomain}`;
  const canonicalSetupUrl = `https://${setupSubdomain}.${primaryDomain}`;

  const rawIncomingHost =
    firstHeaderToken(opts.forwardedHostHeader) || firstHeaderToken(opts.hostHeader);
  const rawProto = firstHeaderToken(opts.forwardedProtoHeader);
  const incomingIsLocal = rawIncomingHost ? isLoopbackUrlOrHost(rawIncomingHost) : false;
  const parsedHost = parseClientSubdomainFromHost(rawIncomingHost, primaryDomain);

  const effectiveSlug = cleanSubdomain(
    opts.workspaceSlug || parsedHost.workspaceSlug || "",
    ""
  );

  let cloudBaseUrl = canonicalAppUrl;
  if (rawIncomingHost && !incomingIsLocal) {
    const proto = rawProto === "http" || rawProto === "https" ? rawProto : "https";
    if (parsedHost.zone === "tally" || parsedHost.zone === "api") {
      cloudBaseUrl = canonicalAppUrl;
    } else {
      cloudBaseUrl = `${proto}://${rawIncomingHost}`;
    }
  } else if (env.APP_URL && !isLoopbackUrlOrHost(env.APP_URL)) {
    cloudBaseUrl = stripTrailingSlash(env.APP_URL);
  }

  const clientTallySubdomainHost = explicitTallySub
    ? `${explicitTallySub}.${primaryDomain}`
    : effectiveSlug
      ? `${effectiveSlug}.${tallyZone}.${primaryDomain}`
      : `${tallyZone}.${primaryDomain}`;

  const clientApiSubdomainHost = effectiveSlug
    ? `${effectiveSlug}.${apiZone}.${primaryDomain}`
    : `${apiZone}.${primaryDomain}`;

  const tallyCloudBaseUrl = explicitTallySub
    ? `https://${explicitTallySub}.${primaryDomain}`
    : effectiveSlug
      ? `https://${effectiveSlug}.${tallyZone}.${primaryDomain}`
      : parsedHost.zone === "tally" && rawIncomingHost
        ? `https://${rawIncomingHost}`
        : `https://${tallyZone}.${primaryDomain}`;

  const apiCloudBaseUrl = effectiveSlug
    ? `https://${effectiveSlug}.${apiZone}.${primaryDomain}`
    : parsedHost.zone === "api" && rawIncomingHost
      ? `https://${rawIncomingHost}`
      : `https://${apiZone}.${primaryDomain}`;

  const workspaceSubdomainUrl = effectiveSlug
    ? `https://${effectiveSlug}.${primaryDomain}`
    : cloudBaseUrl;

  const adminBaseUrl =
    env.ADMIN_URL && !isLoopbackUrlOrHost(env.ADMIN_URL)
      ? stripTrailingSlash(env.ADMIN_URL)
      : canonicalAdminUrl;

  const docsBaseUrl =
    env.DOCS_URL && !isLoopbackUrlOrHost(env.DOCS_URL)
      ? stripTrailingSlash(env.DOCS_URL)
      : canonicalDocsUrl;

  const setupBaseUrl =
    env.SETUP_URL && !isLoopbackUrlOrHost(env.SETUP_URL)
      ? stripTrailingSlash(env.SETUP_URL)
      : canonicalSetupUrl;

  let localBaseUrl: string | null = null;
  if (rawIncomingHost && incomingIsLocal) {
    const proto = rawProto === "https" ? "https" : "http";
    localBaseUrl = `${proto}://${rawIncomingHost}`;
  } else if (env.APP_URL && isLoopbackUrlOrHost(env.APP_URL)) {
    localBaseUrl = stripTrailingSlash(env.APP_URL);
  }

  const isLocalDev = Boolean(
    (rawIncomingHost && incomingIsLocal) || (!rawIncomingHost && isLoopbackUrlOrHost(env.APP_URL))
  );

  const effectiveAppBaseUrl =
    opts.preferLocal && localBaseUrl ? localBaseUrl : cloudBaseUrl;
  const effectiveTallyBaseUrl =
    opts.preferLocal && localBaseUrl ? localBaseUrl : tallyCloudBaseUrl;
  const effectiveApiBaseUrl =
    opts.preferLocal && localBaseUrl ? localBaseUrl : apiCloudBaseUrl;

  return {
    primaryDomain,
    cloudBaseUrl,
    tallyCloudBaseUrl,
    apiCloudBaseUrl,
    clientTallySubdomainHost,
    clientApiSubdomainHost,
    tallyWildcardPattern: `*.${tallyZone}.${primaryDomain}`,
    apiWildcardPattern: `*.${apiZone}.${primaryDomain}`,
    workspaceSubdomainUrl,
    adminBaseUrl,
    docsBaseUrl,
    setupBaseUrl,
    localBaseUrl,
    isLocalDev,
    effectiveAppBaseUrl,
    effectiveTallyBaseUrl,
    effectiveApiBaseUrl,
    tallyWebhookUrl: `${effectiveTallyBaseUrl}/api/webhooks/tally`,
    tallyWebhookPingUrl: `${effectiveTallyBaseUrl}/api/webhooks/tally?mode=ping`,
    tallyBillEventApiUrl: `${effectiveApiBaseUrl}/api/v1/tally/bill-event`,
    tallyVouchersApiUrl: `${effectiveApiBaseUrl}/api/v1/vouchers`,
    agentPairUrl: `${effectiveTallyBaseUrl}/api/agent/pair`,
    agentHeartbeatUrl: `${effectiveTallyBaseUrl}/api/agent/heartbeat`,
    agentIngestUrl: `${effectiveTallyBaseUrl}/api/agent/ingest`,
    agentConfigUrl: `${effectiveTallyBaseUrl}/api/agent/config`,
    whatsappWebhookUrl: `${effectiveAppBaseUrl}/api/webhooks/whatsapp`,
    metaWebhookUrl: `${effectiveAppBaseUrl}/api/webhooks/meta`,
    metaOAuthCallbackUrl: `${effectiveAppBaseUrl}/api/connections/meta/callback`,
    googleOAuthCallbackUrl: `${effectiveAppBaseUrl}/api/connections/google/callback`,
    openApiSpecUrl: `${effectiveApiBaseUrl}/api/v1/openapi.json`,
  };
}

export function resolveEndpointsFromHeaders(
  hdrs: Pick<Headers, "get">,
  extra: Omit<ResolveEndpointsOptions, "hostHeader" | "forwardedHostHeader" | "forwardedProtoHeader"> = {}
): ResolvedPublicEndpoints {
  return resolvePublicEndpoints({
    hostHeader: hdrs.get("host"),
    forwardedHostHeader: hdrs.get("x-forwarded-host"),
    forwardedProtoHeader: hdrs.get("x-forwarded-proto"),
    ...extra,
  });
}
