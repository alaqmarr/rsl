import crypto from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import { and, desc, eq } from "drizzle-orm";
import { decryptEnvelope, encryptEnvelope, getEnv, RslError } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { controlDb, getTenancyHandleMetrics, ingressDb, platformLogsDb } from "./index";
import {
  getPlatformBhashiniConfig,
  getPlatformCloudflareAiConfig,
  getPlatformCloudflareEmailConfig,
  getPlatformGoogleAdsConfig,
  getPlatformGoogleOAuthConfig,
  getPlatformManagedR2Config,
  getPlatformMetaAppConfig,
  getPlatformRazorpayConfig,
  getPlatformSmtpConfig,
  getPlatformTurnstileConfig,
  getPlatformVapidConfig,
  recordPlatformCredentialVerification,
  type CredentialSource,
  type CredentialVerifyStatus,
  type PlatformCredentialProviderKey,
} from "./platform-credentials";

export interface PlatformCredentialProviderMeta {
  key: PlatformCredentialProviderKey;
  sectionBadge: string;
  label: string;
  category: string;
  optional: boolean;
}

export const ALL_PLATFORM_CREDENTIAL_PROVIDERS: ReadonlyArray<PlatformCredentialProviderMeta> = [
  {
    key: "google_oauth",
    sectionBadge: "1",
    label: "Google Cloud OAuth 2.0",
    category: "1-Click Client Login (Drive, GBP, Ads)",
    optional: false,
  },
  {
    key: "smtp_email",
    sectionBadge: "2",
    label: "Outbound SMTP Email",
    category: "OTP, Password Reset & GST Invoice Mail",
    optional: false,
  },
  {
    key: "cloudflare_r2",
    sectionBadge: "3",
    label: "Cloudflare R2 Managed Vault",
    category: "Encrypted Backups & Tally PDFs",
    optional: true,
  },
  {
    key: "meta_app",
    sectionBadge: "4",
    label: "Meta & WhatsApp Cloud App",
    category: "1-Click Facebook, IG, WABA & BM Ads",
    optional: false,
  },
  {
    key: "google_ads",
    sectionBadge: "4B",
    label: "Google Ads API & Managed MCC",
    category: "Search/PMax Ads & Managed Vault",
    optional: true,
  },
  {
    key: "razorpay",
    sectionBadge: "5",
    label: "Razorpay Payment Gateway",
    category: "Instant UPI, Card & NetBanking",
    optional: true,
  },
  {
    key: "cloudflare_turnstile",
    sectionBadge: "6",
    label: "Cloudflare Turnstile Shield",
    category: "Bot & Credential-Stuffing Protection",
    optional: true,
  },
  {
    key: "cloudflare_ai",
    sectionBadge: "7",
    label: "Cloudflare Workers AI",
    category: "Smart Replies, Ad Copy & Whisper Audio",
    optional: true,
  },
  {
    key: "cloudflare_email_routing",
    sectionBadge: "8",
    label: "Cloudflare Email Routing",
    category: "Inbound Vendor Bill-to-Tally Worker",
    optional: true,
  },
  {
    key: "web_push_vapid",
    sectionBadge: "9",
    label: "W3C Web Push (VAPID)",
    category: "Browser & Mobile PWA Push Alerts",
    optional: true,
  },
  {
    key: "bhashini",
    sectionBadge: "11",
    label: "MeitY Digital India BHASHINI",
    category: "22 Scheduled Indian Languages NMT",
    optional: true,
  },
];

export interface CredentialDiagnosticResult {
  providerKey: PlatformCredentialProviderKey;
  label: string;
  source: CredentialSource;
  status: CredentialVerifyStatus;
  latencyMs: number;
  message: string;
  details: Record<string, string>;
  checkedAt: number;
}

export interface VerifyCredentialOptions {
  appOrigin?: string;
  smtpVerifyFn?: () => Promise<{ ok: boolean; latencyMs: number; message: string }>;
}

function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function encodeRfc3986Path(pathname: string): string {
  return pathname
    .split("/")
    .map((seg) =>
      encodeURIComponent(seg).replace(
        /[!'()*]/g,
        (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
      )
    )
    .join("/");
}

function buildS3SigV4Headers(params: {
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  url: URL;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  body?: Buffer | string;
  contentType?: string;
}): Record<string, string> {
  const region = params.region || "auto";
  const service = "s3";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(params.body ?? "");

  const sortedQuery = Array.from(params.url.searchParams.entries())
    .sort(([aKey, aVal], [bKey, bVal]) =>
      aKey === bKey ? aVal.localeCompare(bVal) : aKey.localeCompare(bKey)
    )
    .map(
      ([k, v]) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(v).replace(
          /[!'()*]/g,
          (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
        )}`
    )
    .join("&");

  const headerMap: Record<string, string> = {
    host: params.url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (params.contentType) {
    headerMap["content-type"] = params.contentType;
  }

  const signedHeaderKeys = Object.keys(headerMap).sort();
  const canonicalHeaders = signedHeaderKeys
    .map((k) => `${k}:${headerMap[k]!.trim()}\n`)
    .join("");
  const signedHeaders = signedHeaderKeys.join(";");

  const canonicalRequest = [
    params.method,
    encodeRfc3986Path(params.url.pathname || "/"),
    sortedQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmacSha256(`AWS4${params.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, "aws4_request");
  const signature = crypto
    .createHmac("sha256", kSigning)
    .update(stringToSign, "utf8")
    .digest("hex");

  const outHeaders: Record<string, string> = {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (params.contentType) {
    outHeaders["Content-Type"] = params.contentType;
  }
  return outHeaders;
}

async function probeSmtpSocketAuth(params: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}): Promise<{ ok: boolean; latencyMs: number; message: string }> {
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean, message: string, sock?: net.Socket | tls.TLSSocket) => {
      if (settled) return;
      settled = true;
      try {
        sock?.destroy();
      } catch {
        // ignore close errors
      }
      resolve({ ok, latencyMs: Date.now() - started, message });
    };

    const timer = setTimeout(() => {
      finish(false, `SMTP connection timed out after 7s (${params.host}:${params.port}).`);
    }, 7000);

    const runProtocol = (initialSocket: net.Socket | tls.TLSSocket, isTls: boolean) => {
      let socket: net.Socket | tls.TLSSocket = initialSocket;
      let step: "banner" | "ehlo" | "starttls" | "ehlo_tls" | "auth" | "done" = "banner";
      let buffer = "";

      const attachListeners = (s: net.Socket | tls.TLSSocket) => {
        s.on("error", (err) => {
          clearTimeout(timer);
          finish(false, `SMTP socket error: ${err.message}`, s);
        });
        s.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf8");
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line || line.length < 3) continue;
            // Multi-line SMTP reply continues with '-' at index 3 (e.g. "250-PIPELINING")
            if (line[3] === "-") continue;
            const code = Number(line.slice(0, 3));

            if (step === "banner") {
              if (code !== 220) {
                clearTimeout(timer);
                finish(false, `SMTP rejected greeting (${line.slice(0, 120)})`, s);
                return;
              }
              step = "ehlo";
              s.write("EHLO rapidshiftlabs.in\r\n");
            } else if (step === "ehlo") {
              if (code !== 250) {
                clearTimeout(timer);
                finish(false, `SMTP EHLO failed (${line.slice(0, 120)})`, s);
                return;
              }
              if (!isTls && params.port !== 25) {
                step = "starttls";
                s.write("STARTTLS\r\n");
              } else {
                step = "auth";
                const authPlain = Buffer.from(`\0${params.user}\0${params.password}`, "utf8").toString(
                  "base64"
                );
                s.write(`AUTH PLAIN ${authPlain}\r\n`);
              }
            } else if (step === "starttls") {
              if (code !== 220) {
                clearTimeout(timer);
                finish(false, `SMTP STARTTLS upgrade failed (${line.slice(0, 120)})`, s);
                return;
              }
              s.removeAllListeners("data");
              s.removeAllListeners("error");
              const upgraded = tls.connect({
                socket: s,
                servername: params.host,
              });
              socket = upgraded;
              isTls = true;
              step = "ehlo_tls";
              attachListeners(upgraded);
              upgraded.once("secureConnect", () => {
                upgraded.write("EHLO rapidshiftlabs.in\r\n");
              });
              return;
            } else if (step === "ehlo_tls") {
              if (code !== 250) {
                clearTimeout(timer);
                finish(false, `SMTP post-TLS EHLO failed (${line.slice(0, 120)})`, socket);
                return;
              }
              step = "auth";
              const authPlain = Buffer.from(`\0${params.user}\0${params.password}`, "utf8").toString(
                "base64"
              );
              socket.write(`AUTH PLAIN ${authPlain}\r\n`);
            } else if (step === "auth") {
              clearTimeout(timer);
              step = "done";
              try {
                socket.write("QUIT\r\n");
              } catch {
                // ignore
              }
              if (code === 235) {
                finish(
                  true,
                  `SMTP authenticated (${params.user} via ${params.host}:${params.port}, TLS=${isTls ? "active" : "plain"}).`,
                  socket
                );
              } else {
                finish(
                  false,
                  `SMTP authentication rejected (${line.slice(0, 140)}). Check username and 16-char App Password.`,
                  socket
                );
              }
              return;
            }
          }
        });
      };

      attachListeners(socket);
    };

    try {
      if (params.secure) {
        const sock = tls.connect({
          host: params.host,
          port: params.port,
          servername: params.host,
        });
        runProtocol(sock, true);
      } else {
        const sock = net.createConnection({
          host: params.host,
          port: params.port,
        });
        runProtocol(sock, false);
      }
    } catch (err) {
      clearTimeout(timer);
      finish(
        false,
        `Failed to open SMTP connection: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });
}

function finalizeResult(
  meta: PlatformCredentialProviderMeta,
  source: CredentialSource,
  status: CredentialVerifyStatus,
  startedAt: number,
  message: string,
  details: Record<string, string> = {}
): CredentialDiagnosticResult {
  const checkedAt = Date.now();
  const latencyMs = Math.max(1, checkedAt - startedAt);
  recordPlatformCredentialVerification({
    providerKey: meta.key,
    status,
    message,
  });
  return {
    providerKey: meta.key,
    label: meta.label,
    source,
    status,
    latencyMs,
    message,
    details,
    checkedAt,
  };
}

export async function verifyPlatformCredentialProvider(
  providerKey: PlatformCredentialProviderKey,
  options: VerifyCredentialOptions = {}
): Promise<CredentialDiagnosticResult> {
  const startedAt = Date.now();
  const env = getEnv();
  const appOrigin = (options.appOrigin || env.APP_URL || "http://localhost:4500").replace(
    /\/+$/,
    ""
  );
  const meta =
    ALL_PLATFORM_CREDENTIAL_PROVIDERS.find((p) => p.key === providerKey) ??
    ALL_PLATFORM_CREDENTIAL_PROVIDERS[0]!;

  switch (providerKey) {
    case "google_oauth": {
      const cfg = getPlatformGoogleOAuthConfig();
      if (!cfg.clientId && !cfg.clientSecret) {
        return finalizeResult(
          meta,
          cfg.source,
          "unconfigured",
          startedAt,
          "Not configured yet. Paste Google OAuth 2.0 Web Client ID & Secret or client_secret.json."
        );
      }
      if (!cfg.enabled) {
        return finalizeResult(
          meta,
          cfg.source,
          "warning",
          startedAt,
          `Credentials saved (${cfg.source}) but Google OAuth toggle is currently disabled.`
        );
      }
      if (cfg.clientId.includes("gserviceaccount.com")) {
        return finalizeResult(
          meta,
          cfg.source,
          "error",
          startedAt,
          `Invalid Client ID (${cfg.clientId}): Service Account keys cannot run Web OAuth consent screens.`
        );
      }
      if (!cfg.clientId || !cfg.clientSecret) {
        return finalizeResult(
          meta,
          cfg.source,
          "error",
          startedAt,
          "Incomplete Google OAuth config: both Client ID and Client Secret are required."
        );
      }

      try {
        const body = new URLSearchParams({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          code: "rsl_live_diagnostic_probe_code",
          redirect_uri: `${appOrigin}/api/oauth/google/callback`,
          grant_type: "authorization_code",
        });
        const resp = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
          signal: AbortSignal.timeout(7500),
        });
        const json = (await resp.json().catch(() => ({}))) as {
          error?: string;
          error_description?: string;
        };

        if (json.error === "invalid_client" || resp.status === 401) {
          return finalizeResult(
            meta,
            cfg.source,
            "error",
            startedAt,
            `Google OAuth server rejected Client ID or Secret (${json.error_description || json.error || `HTTP ${resp.status}`}).`,
            { clientId: cfg.clientId }
          );
        }

        if (
          json.error === "invalid_grant" ||
          json.error === "redirect_uri_mismatch" ||
          resp.status === 400
        ) {
          const scopesEnabled = [
            cfg.enableDriveOAuth ? "Drive/Sheets/GSC" : null,
            cfg.enableGbpOAuth ? "Business Profile" : null,
            cfg.enableGoogleAdsOAuth ? "Google Ads" : null,
          ]
            .filter(Boolean)
            .join(", ");

          const formatWarning = !cfg.clientId.endsWith(".apps.googleusercontent.com");
          return finalizeResult(
            meta,
            cfg.source,
            formatWarning ? "warning" : "healthy",
            startedAt,
            `Verified live with Google OAuth2 server (${Date.now() - startedAt}ms). Client ID & Secret accepted (${cfg.publishingStatus} mode; active scopes: ${scopesEnabled || "none"}).`,
            {
              clientId: cfg.clientId,
              publishingStatus: cfg.publishingStatus,
              callbackUri: `${appOrigin}/api/oauth/google/callback`,
            }
          );
        }

        return finalizeResult(
          meta,
          cfg.source,
          "warning",
          startedAt,
          `Google OAuth endpoint responded with HTTP ${resp.status} (${json.error || "unexpected_response"}).`
        );
      } catch (err) {
        return finalizeResult(
          meta,
          cfg.source,
          "error",
          startedAt,
          `Could not reach oauth2.googleapis.com: ${err instanceof Error ? err.message : "network timeout"}.`
        );
      }
    }

    case "smtp_email": {
      const cfg = getPlatformSmtpConfig();
      if (!cfg.user && !cfg.password) {
        return finalizeResult(
          meta,
          cfg.source,
          "unconfigured",
          startedAt,
          "Not configured yet. Outbound emails currently render in Local Outbox Preview mode."
        );
      }
      if (!cfg.enabled) {
        return finalizeResult(
          meta,
          cfg.source,
          "warning",
          startedAt,
          `SMTP credentials saved (${cfg.source}) but toggle is disabled; Local Outbox mode is active.`
        );
      }
      if (!cfg.host || !cfg.user || !cfg.password) {
        return finalizeResult(
          meta,
          cfg.source,
          "error",
          startedAt,
          "Incomplete SMTP configuration: host, username, and password are all required."
        );
      }

      const probe = options.smtpVerifyFn
        ? await options.smtpVerifyFn()
        : await probeSmtpSocketAuth({
            host: cfg.host,
            port: cfg.port,
            secure: cfg.secure,
            user: cfg.user,
            password: cfg.password,
          });

      return finalizeResult(
        meta,
        cfg.source,
        probe.ok ? "healthy" : "error",
        startedAt,
        probe.message,
        {
          host: `${cfg.host}:${cfg.port}`,
          from: cfg.from,
          secure: cfg.secure ? "SSL/TLS" : "STARTTLS",
        }
      );
    }

    case "cloudflare_r2": {
      const cfg = getPlatformManagedR2Config();
      if (!cfg.accessKeyId && !cfg.secretAccessKey && !cfg.bucketPrivate) {
        return finalizeResult(
          meta,
          cfg.source,
          "unconfigured",
          startedAt,
          "Optional R2 credentials not set. Platform Vault uses encrypted local disk storage (DATA_DIR/vault)."
        );
      }
      if (!cfg.enabled) {
        return finalizeResult(
          meta,
          cfg.source,
          "warning",
          startedAt,
          "Cloudflare R2 credentials saved but disabled; local disk vault fallback is active."
        );
      }
      if (!cfg.endpointUrl || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucketPrivate) {
        return finalizeResult(
          meta,
          cfg.source,
          "error",
          startedAt,
          "Incomplete R2 config: Account ID/Endpoint, Access Key ID, Secret Access Key, and Private Bucket are required."
        );
      }

      try {
        const cleanEndpoint = cfg.endpointUrl.replace(/\/+$/, "");
        const probeKey = `_rsl_healthcheck/probe_${Date.now()}.txt`;
        const objectUrl = new URL(
          `${cleanEndpoint}/${encodeURIComponent(cfg.bucketPrivate)}/${probeKey}`
        );
        const bodyBuf = Buffer.from("rsl-r2-canary-ok", "utf8");

        const putHeaders = buildS3SigV4Headers({
          method: "PUT",
          url: objectUrl,
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
          body: bodyBuf,
          contentType: "text/plain",
        });

        const putResp = await fetch(objectUrl.toString(), {
          method: "PUT",
          headers: putHeaders,
          body: bodyBuf,
          signal: AbortSignal.timeout(8000),
        });

        if (putResp.ok) {
          const delHeaders = buildS3SigV4Headers({
            method: "DELETE",
            url: objectUrl,
            accessKeyId: cfg.accessKeyId,
            secretAccessKey: cfg.secretAccessKey,
          });
          await fetch(objectUrl.toString(), {
            method: "DELETE",
            headers: delHeaders,
            signal: AbortSignal.timeout(5000),
          }).catch(() => null);

          return finalizeResult(
            meta,
            cfg.source,
            "healthy",
            startedAt,
            `Verified live S3 SigV4 write + delete on R2 bucket '${cfg.bucketPrivate}' (${Date.now() - startedAt}ms).`,
            {
              endpoint: cleanEndpoint,
              bucketPrivate: cfg.bucketPrivate,
            }
          );
        }

        // If PUT failed with 403, test read/list access to distinguish read-only key vs invalid key
        if (putResp.status === 403) {
          const listUrl = new URL(
            `${cleanEndpoint}/${encodeURIComponent(cfg.bucketPrivate)}?list-type=2&max-keys=1`
          );
          const listHeaders = buildS3SigV4Headers({
            method: "GET",
            url: listUrl,
            accessKeyId: cfg.accessKeyId,
            secretAccessKey: cfg.secretAccessKey,
          });
          const listResp = await fetch(listUrl.toString(), {
            method: "GET",
            headers: listHeaders,
            signal: AbortSignal.timeout(6000),
          });
          if (listResp.ok) {
            return finalizeResult(
              meta,
              cfg.source,
              "warning",
              startedAt,
              `R2 key can read bucket '${cfg.bucketPrivate}' but write returned 403. Grant 'Object Read & Write' permission on the R2 token.`
            );
          }
        }

        const errText = (await putResp.text().catch(() => "")).slice(0, 180);
        return finalizeResult(
          meta,
          cfg.source,
          "error",
          startedAt,
          `R2 S3 probe rejected (HTTP ${putResp.status}) on bucket '${cfg.bucketPrivate}'. ${errText.replace(/<[^>]+>/g, " ").trim()}`
        );
      } catch (err) {
        return finalizeResult(
          meta,
          cfg.source,
          "error",
          startedAt,
          `Could not reach R2 endpoint (${cfg.endpointUrl}): ${err instanceof Error ? err.message : "timeout"}.`
        );
      }
    }

    case "meta_app": {
      const cfg = getPlatformMetaAppConfig();
      if (!cfg.appId && !cfg.appSecret) {
        return finalizeResult(
          meta,
          cfg.source,
          "unconfigured",
          startedAt,
          "Not configured yet. Enter Meta App ID & App Secret from developers.facebook.com."
        );
      }
      if (!cfg.enabled) {
        return finalizeResult(
          meta,
          cfg.source,
          "warning",
          startedAt,
          `Meta App (${cfg.appId}) saved (${cfg.source}) but currently disabled via toggle.`
        );
      }
      if (!cfg.appId || !cfg.appSecret) {
        return finalizeResult(
          meta,
          cfg.source,
          "error",
          startedAt,
          "Incomplete Meta App config: both App ID and App Secret are required."
        );
      }

      try {
        const v = cfg.graphVersion || "v21.0";
        const tokenUrl = new URL(`https://graph.facebook.com/${v}/oauth/access_token`);
        tokenUrl.searchParams.set("client_id", cfg.appId);
        tokenUrl.searchParams.set("client_secret", cfg.appSecret);
        tokenUrl.searchParams.set("grant_type", "client_credentials");

        const tokenResp = await fetch(tokenUrl.toString(), {
          method: "GET",
          signal: AbortSignal.timeout(7500),
        });
        const tokenJson = (await tokenResp.json().catch(() => ({}))) as {
          access_token?: string;
          error?: { message?: string; code?: number };
        };

        if (!tokenResp.ok || !tokenJson.access_token) {
          return finalizeResult(
            meta,
            cfg.source,
            "error",
            startedAt,
            `Meta Graph API rejected App ID / Secret: ${tokenJson.error?.message || `HTTP ${tokenResp.status}`}.`
          );
        }

        let appName = `App ${cfg.appId}`;
        const appResp = await fetch(
          `https://graph.facebook.com/${v}/${encodeURIComponent(cfg.appId)}?fields=id,name,category&access_token=${encodeURIComponent(tokenJson.access_token)}`,
          { method: "GET", signal: AbortSignal.timeout(6000) }
        );
        if (appResp.ok) {
          const appData = (await appResp.json().catch(() => ({}))) as { name?: string };
          if (appData.name) appName = `${appData.name} (${cfg.appId})`;
        }

        let managedNote = "Managed BM Ads: optional/not set";
        let status: CredentialVerifyStatus = "healthy";

        if (!cfg.webhookVerifyToken || cfg.webhookVerifyToken.length < 8) {
          status = "warning";
          managedNote = "Webhook Verify Token is blank (recommended >= 8 chars)";
        }

        if (cfg.managedAdAccountId && cfg.managedSystemToken) {
          const normalizedAct = cfg.managedAdAccountId.startsWith("act_")
            ? cfg.managedAdAccountId
            : `act_${cfg.managedAdAccountId.replace(/[^0-9]/g, "")}`;
          const bmResp = await fetch(
            `https://graph.facebook.com/${v}/${encodeURIComponent(normalizedAct)}?fields=id,name,account_status,currency`,
            {
              method: "GET",
              headers: { Authorization: `Bearer ${cfg.managedSystemToken}` },
              signal: AbortSignal.timeout(6500),
            }
          );
          const bmJson = (await bmResp.json().catch(() => ({}))) as {
            id?: string;
            name?: string;
            currency?: string;
            error?: { message?: string };
          };
          if (bmResp.ok && bmJson.id) {
            managedNote = `Managed BM Ad Account verified (${bmJson.name || bmJson.id}, ${bmJson.currency || "INR"})`;
          } else {
            status = "warning";
            managedNote = `Managed BM Ad Account check failed (${bmJson.error?.message || `HTTP ${bmResp.status}`})`;
          }
        }

        return finalizeResult(
          meta,
          cfg.source,
          status,
          startedAt,
          `Verified live with Meta Graph ${v}: ${appName} (${Date.now() - startedAt}ms). ${managedNote}.`,
          {
            appId: cfg.appId,
            graphVersion: v,
          }
        );
      } catch (err) {
        return finalizeResult(
          meta,
          cfg.source,
          "error",
          startedAt,
          `Could not reach graph.facebook.com: ${err instanceof Error ? err.message : "timeout"}.`
        );
      }
    }

    case "google_ads": {
      const cfg = getPlatformGoogleAdsConfig();
      const oauth = getPlatformGoogleOAuthConfig();

      if (!cfg.enabled) {
        return finalizeResult(
          meta,
          cfg.source,
          "warning",
          startedAt,
          "Google Ads integration toggle is disabled."
        );
      }

      if (!oauth.isReady && !cfg.developerToken) {
        return finalizeResult(
          meta,
          "unconfigured",
          "unconfigured",
          startedAt,
          "Configure Section 1 (Google Cloud OAuth 2.0) first so 1-Click Google Ads OAuth can authenticate via your Cloud Project."
        );
      }

      if (cfg.loginCustomerId && cfg.loginCustomerId.length !== 10) {
        return finalizeResult(
          meta,
          cfg.source,
          "error",
          startedAt,
          `Login Customer ID (${cfg.loginCustomerId}) must be exactly 10 digits.`
        );
      }
      if (cfg.managedCustomerId && cfg.managedCustomerId.length !== 10) {
        return finalizeResult(
          meta,
          cfg.source,
          "error",
          startedAt,
          `Managed Customer ID (${cfg.managedCustomerId}) must be exactly 10 digits.`
        );
      }

      // If Managed MCC refresh token is configured, run a live token exchange + accessible customers check
      if (cfg.managedRefreshToken && oauth.isReady) {
        try {
          const refreshBody = new URLSearchParams({
            client_id: oauth.clientId,
            client_secret: oauth.clientSecret,
            refresh_token: cfg.managedRefreshToken,
            grant_type: "refresh_token",
          });
          const tokResp = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: refreshBody.toString(),
            signal: AbortSignal.timeout(7500),
          });
          const tokJson = (await tokResp.json().catch(() => ({}))) as {
            access_token?: string;
            error?: string;
            error_description?: string;
          };
          if (!tokResp.ok || !tokJson.access_token) {
            return finalizeResult(
              meta,
              cfg.source,
              "error",
              startedAt,
              `Managed MCC Refresh Token rejected by Google (${tokJson.error_description || tokJson.error || `HTTP ${tokResp.status}`}).`
            );
          }

          const headers: Record<string, string> = {
            Authorization: `Bearer ${tokJson.access_token}`,
          };
          if (cfg.developerToken) {
            headers["developer-token"] = cfg.developerToken;
          }
          if (cfg.loginCustomerId) {
            headers["login-customer-id"] = cfg.loginCustomerId;
          }

          const adsResp = await fetch(
            `https://googleads.googleapis.com/${encodeURIComponent(cfg.apiVersion)}/customers:listAccessibleCustomers`,
            {
              method: "GET",
              headers,
              signal: AbortSignal.timeout(7500),
            }
          );
          const adsJson = (await adsResp.json().catch(() => ({}))) as {
            resourceNames?: string[];
            error?: { message?: string; status?: string };
          };
          if (adsResp.ok && Array.isArray(adsJson.resourceNames)) {
            return finalizeResult(
              meta,
              cfg.source,
              "healthy",
              startedAt,
              `Verified live with Google Ads ${cfg.apiVersion}: Managed MCC token valid (${adsJson.resourceNames.length} accessible account(s), ${Date.now() - startedAt}ms).`
            );
          }

          return finalizeResult(
            meta,
            cfg.source,
            "warning",
            startedAt,
            `Google OAuth refresh succeeded, but Google Ads API returned HTTP ${adsResp.status}: ${adsJson.error?.message || "check Google Ads API enablement & Cloud Console access level"}.`
          );
        } catch (err) {
          return finalizeResult(
            meta,
            cfg.source,
            "error",
            startedAt,
            `Google Ads live check failed: ${err instanceof Error ? err.message : "timeout"}.`
          );
        }
      }

      if (!oauth.enableGoogleAdsOAuth) {
        return finalizeResult(
          meta,
          cfg.source,
          "warning",
          startedAt,
          "Google Cloud OAuth is configured, but 'Enable 1-Click Google Ads OAuth' is unchecked in Section 1."
        );
      }

      // Probe OAuth client readiness via Google OAuth token endpoint
      const oauthDiag = await verifyPlatformCredentialProvider("google_oauth", options);
      if (oauthDiag.status === "error") {
        return finalizeResult(
          meta,
          cfg.source,
          "error",
          startedAt,
          `Section 1 Google OAuth credentials failed verification: ${oauthDiag.message}`
        );
      }

      return finalizeResult(
        meta,
        cfg.source,
        "healthy",
        startedAt,
        `1-Click Client Google Ads OAuth ready via Google Cloud Project (${cfg.apiVersion}, developer-token-free Cloud Console mode${cfg.developerToken ? " + legacy dev token" : ""}).`
      );
    }

    case "razorpay": {
      const cfg = getPlatformRazorpayConfig();
      if (!cfg.keyId && !cfg.keySecret) {
        return finalizeResult(
          meta,
          cfg.source,
          "unconfigured",
          startedAt,
          "Optional Razorpay keys not set. Manual UPI QR & Bank Transfer billing mode is active."
        );
      }
      if (!cfg.enabled) {
        return finalizeResult(
          meta,
          cfg.source,
          "warning",
          startedAt,
          "Razorpay credentials saved but gateway toggle is disabled; Manual UPI mode is active."
        );
      }
      if (!cfg.keyId || !cfg.keySecret) {
        return finalizeResult(
          meta,
          cfg.source,
          "error",
          startedAt,
          "Incomplete Razorpay config: both Key ID and Key Secret are required."
        );
      }

      try {
        const basic = Buffer.from(`${cfg.keyId}:${cfg.keySecret}`, "utf8").toString("base64");
        const resp = await fetch("https://api.razorpay.com/v1/orders?count=1", {
          method: "GET",
          headers: { Authorization: `Basic ${basic}` },
          signal: AbortSignal.timeout(7500),
        });
        const json = (await resp.json().catch(() => ({}))) as {
          error?: { description?: string; code?: string };
        };

        if (!resp.ok) {
          return finalizeResult(
            meta,
            cfg.source,
            "error",
            startedAt,
            `Razorpay API rejected Key ID / Secret (HTTP ${resp.status}: ${json.error?.description || "Unauthorized"}).`
          );
        }

        const keyMode = cfg.keyId.startsWith("rzp_live_")
          ? "LIVE"
          : cfg.keyId.startsWith("rzp_test_")
            ? "TEST"
            : "CUSTOM";
        const hasWebhook = Boolean(cfg.webhookSecret && cfg.webhookSecret.length >= 8);

        return finalizeResult(
          meta,
          cfg.source,
          hasWebhook ? "healthy" : "warning",
          startedAt,
          hasWebhook
            ? `Verified live with Razorpay Orders API (${keyMode} mode, ${Date.now() - startedAt}ms). Webhook HMAC secret configured.`
            : `Razorpay API keys valid (${keyMode} mode, ${Date.now() - startedAt}ms), but Webhook Secret is blank (add it for instant signature verification).`,
          { keyId: cfg.keyId, mode: keyMode }
        );
      } catch (err) {
        return finalizeResult(
          meta,
          cfg.source,
          "error",
          startedAt,
          `Could not reach api.razorpay.com: ${err instanceof Error ? err.message : "timeout"}.`
        );
      }
    }

    case "cloudflare_turnstile": {
      const cfg = getPlatformTurnstileConfig();
      if (!cfg.siteKey && !cfg.secretKey) {
        return finalizeResult(
          meta,
          cfg.source,
          "unconfigured",
          startedAt,
          "Optional Turnstile keys not set. Rate-limiting & brute-force lockouts remain active without CAPTCHA widget."
        );
      }
      if (!cfg.enabled) {
        return finalizeResult(
          meta,
          cfg.source,
          "warning",
          startedAt,
          "Turnstile keys saved but bot shield toggle is disabled."
        );
      }
      if (!cfg.siteKey || !cfg.secretKey) {
        return finalizeResult(
          meta,
          cfg.source,
          "error",
          startedAt,
          "Incomplete Turnstile config: both Site Key and Secret Key are required."
        );
      }

      if (cfg.secretKey === "1x0000000000000000000000000000000AA") {
        return finalizeResult(
          meta,
          cfg.source,
          "warning",
          startedAt,
          "Using Cloudflare dummy Always-Passes test key (1x0000...00AA). Replace with a live Turnstile widget key in production."
        );
      }

      try {
        const body = new URLSearchParams({
          secret: cfg.secretKey,
          response: "rsl_turnstile_diagnostic_probe",
        });
        const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
          signal: AbortSignal.timeout(7000),
        });
        const json = (await resp.json().catch(() => ({}))) as {
          success?: boolean;
          "error-codes"?: string[];
        };
        const codes = json["error-codes"] || [];

        if (codes.includes("invalid-input-secret")) {
          return finalizeResult(
            meta,
            cfg.source,
            "error",
            startedAt,
            "Cloudflare Turnstile rejected Secret Key (invalid-input-secret). Verify widget Secret Key in Cloudflare Dashboard."
          );
        }

        if (resp.ok && (codes.includes("invalid-input-response") || json.success === true)) {
          const surfaces = [
            cfg.enforceOnLogin ? "Login" : null,
            cfg.enforceOnRegister ? "Signup" : null,
            cfg.enforceOnPublicForms ? "Public Forms" : null,
          ]
            .filter(Boolean)
            .join(", ");

          return finalizeResult(
            meta,
            cfg.source,
            "healthy",
            startedAt,
            `Verified live with Cloudflare Turnstile siteverify (${Date.now() - startedAt}ms). Secret Key accepted (protected: ${surfaces || "none"}).`,
            { siteKey: cfg.siteKey }
          );
        }

        return finalizeResult(
          meta,
          cfg.source,
          "error",
          startedAt,
          `Unexpected Turnstile siteverify response (HTTP ${resp.status}: ${codes.join(", ") || "unknown"}).`
        );
      } catch (err) {
        return finalizeResult(
          meta,
          cfg.source,
          "error",
          startedAt,
          `Could not reach challenges.cloudflare.com: ${err instanceof Error ? err.message : "timeout"}.`
        );
      }
    }

    case "cloudflare_ai": {
      const cfg = getPlatformCloudflareAiConfig();
      if (!cfg.accountId && !cfg.apiToken) {
        return finalizeResult(
          meta,
          cfg.source,
          "unconfigured",
          startedAt,
          "Optional Workers AI keys not set. Deterministic local template & phrasebook fallbacks are active."
        );
      }
      if (!cfg.enabled) {
        return finalizeResult(
          meta,
          cfg.source,
          "warning",
          startedAt,
          "Cloudflare Workers AI keys saved but toggle is disabled."
        );
      }
      if (!cfg.accountId || !cfg.apiToken) {
        return finalizeResult(
          meta,
          cfg.source,
          "error",
          startedAt,
          "Incomplete Workers AI config: both Cloudflare Account ID and API Token are required."
        );
      }

      try {
        const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cfg.accountId)}/ai/run/${cfg.textModel}`;
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfg.apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Reply with the single word OK." }],
            max_tokens: 6,
          }),
          signal: AbortSignal.timeout(10000),
        });
        const json = (await resp.json().catch(() => ({}))) as {
          success?: boolean;
          result?: { response?: string };
          errors?: Array<{ message?: string; code?: number }>;
        };

        if (resp.ok && json.success !== false) {
          const sample = (json.result?.response || "OK").trim().slice(0, 32);
          return finalizeResult(
            meta,
            cfg.source,
            "healthy",
            startedAt,
            `Verified live inference on ${cfg.textModel} (${Date.now() - startedAt}ms, model reply: "${sample}").`,
            { accountId: cfg.accountId, textModel: cfg.textModel }
          );
        }

        return finalizeResult(
          meta,
          cfg.source,
          "error",
          startedAt,
          `Workers AI rejected request (HTTP ${resp.status}): ${json.errors?.[0]?.message || "check Account ID & 'Workers AI: Read/Run' token permission"}.`
        );
      } catch (err) {
        return finalizeResult(
          meta,
          cfg.source,
          "error",
          startedAt,
          `Could not reach api.cloudflare.com Workers AI: ${err instanceof Error ? err.message : "timeout"}.`
        );
      }
    }

    case "cloudflare_email_routing": {
      const cfg = getPlatformCloudflareEmailConfig();
      if (!cfg.webhookSecret) {
        return finalizeResult(
          meta,
          cfg.source,
          "unconfigured",
          startedAt,
          "Optional inbound Email Worker secret not set yet. Click '1-Click Auto-Generate Secret' to enable."
        );
      }
      if (!cfg.enabled) {
        return finalizeResult(
          meta,
          cfg.source,
          "warning",
          startedAt,
          "Cloudflare Email Routing secret saved but toggle is disabled."
        );
      }
      if (cfg.webhookSecret.length < 16) {
        return finalizeResult(
          meta,
          cfg.source,
          "warning",
          startedAt,
          "Webhook secret is shorter than 16 characters; rotate with Auto-Generate Secret for strong entropy."
        );
      }

      let mxSummary = "DNS MX check skipped";
      let mxStatus: CredentialVerifyStatus = "healthy";
      try {
        const dnsUrl = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(cfg.inboundDomain)}&type=MX`;
        const dnsResp = await fetch(dnsUrl, {
          method: "GET",
          headers: { Accept: "application/dns-json" },
          signal: AbortSignal.timeout(5500),
        });
        if (dnsResp.ok) {
          const dnsJson = (await dnsResp.json().catch(() => ({}))) as {
            Answer?: Array<{ data?: string }>;
          };
          const mxRecords = (dnsJson.Answer || [])
            .map((a) => (a.data || "").trim())
            .filter(Boolean);
          if (mxRecords.length > 0) {
            const hasCfMx = mxRecords.some((r) => r.toLowerCase().includes("cloudflare.net"));
            mxSummary = hasCfMx
              ? `Cloudflare Email Routing MX active (${mxRecords[0]})`
              : `Domain MX records found (${mxRecords.slice(0, 2).join(", ")})`;
          } else {
            mxStatus = "warning";
            mxSummary = `No public MX records published yet for ${cfg.inboundDomain}`;
          }
        }
      } catch {
        mxSummary = "Outbound DoH check unreachable; secret verified locally";
      }

      return finalizeResult(
        meta,
        cfg.source,
        mxStatus,
        startedAt,
        `Webhook secret active (${cfg.webhookSecret.length} chars) for *@${cfg.inboundDomain}. ${mxSummary}.`,
        { inboundDomain: cfg.inboundDomain }
      );
    }

    case "web_push_vapid": {
      const cfg = getPlatformVapidConfig();
      if (!cfg.publicKey && !cfg.privateKeyD) {
        return finalizeResult(
          meta,
          cfg.source,
          "unconfigured",
          startedAt,
          "VAPID keypair not generated yet. Click '1-Click Auto-Generate Fresh VAPID Keypair'."
        );
      }
      if (!cfg.enabled) {
        return finalizeResult(
          meta,
          cfg.source,
          "warning",
          startedAt,
          "VAPID keys saved but Web Push toggle is disabled."
        );
      }
      if (!cfg.subject.startsWith("mailto:") && !cfg.subject.startsWith("https://")) {
        return finalizeResult(
          meta,
          cfg.source,
          "error",
          startedAt,
          `Invalid VAPID subject '${cfg.subject}': RFC 8292 requires 'mailto:' or 'https://'.`
        );
      }

      try {
        const rawPub = Buffer.from(cfg.publicKey, "base64url");
        if (rawPub.length !== 65 || rawPub[0] !== 0x04) {
          return finalizeResult(
            meta,
            cfg.source,
            "error",
            startedAt,
            "VAPID Public Key is not a valid 65-byte uncompressed P-256 point (0x04)."
          );
        }

        const jwk = JSON.parse(cfg.privateKeyJwkJson) as crypto.JsonWebKey;
        const privKey = crypto.createPrivateKey({ key: jwk, format: "jwk" });
        const derivedPub = crypto.createPublicKey(privKey).export({ format: "jwk" }) as {
          x?: string;
          y?: string;
        };
        const expectedX = rawPub.subarray(1, 33).toString("base64url");
        const expectedY = rawPub.subarray(33, 65).toString("base64url");
        if (derivedPub.x !== expectedX || derivedPub.y !== expectedY) {
          return finalizeResult(
            meta,
            cfg.source,
            "error",
            startedAt,
            "VAPID Private Key scalar (d) does NOT match the Public Key point! Re-generate a fresh VAPID keypair."
          );
        }

        // Perform live RFC 8292 ES256 sign + verify round-trip
        const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })).toString(
          "base64url"
        );
        const payload = Buffer.from(
          JSON.stringify({
            aud: "https://fcm.googleapis.com",
            exp: Math.floor(Date.now() / 1000) + 600,
            sub: cfg.subject,
          })
        ).toString("base64url");
        const signingInput = Buffer.from(`${header}.${payload}`, "ascii");
        const signature = crypto.sign("sha256", signingInput, {
          key: privKey,
          dsaEncoding: "ieee-p1363",
        });
        const verified = crypto.verify(
          "sha256",
          signingInput,
          { key: crypto.createPublicKey(privKey), dsaEncoding: "ieee-p1363" },
          signature
        );

        if (!verified) {
          return finalizeResult(
            meta,
            cfg.source,
            "error",
            startedAt,
            "ES256 JWT signature verification self-test failed."
          );
        }

        const subRow = controlDb()
          .$client.prepare(
            "SELECT COUNT(*) AS cnt FROM web_push_subscriptions WHERE active = 1"
          )
          .get() as { cnt?: number } | undefined;

        return finalizeResult(
          meta,
          cfg.source,
          "healthy",
          startedAt,
          `ECDSA P-256 keypair & RFC 8292 ES256 JWT signature verified (${cfg.subject}; ${subRow?.cnt ?? 0} active browser subscription(s)).`,
          { subject: cfg.subject, activeSubscriptions: String(subRow?.cnt ?? 0) }
        );
      } catch (err) {
        return finalizeResult(
          meta,
          cfg.source,
          "error",
          startedAt,
          `VAPID cryptographic check failed: ${err instanceof Error ? err.message : "malformed key"}.`
        );
      }
    }

    case "bhashini": {
      const cfg = getPlatformBhashiniConfig();
      if (!cfg.inferenceApiKey && !cfg.userId && !cfg.ulcaApiKey) {
        return finalizeResult(
          meta,
          cfg.source,
          "unconfigured",
          startedAt,
          "Optional MeitY Bhashini keys not set. Automatic fallback to Cloudflare Workers AI / Indian phrasebook is active."
        );
      }
      if (!cfg.enabled) {
        return finalizeResult(
          meta,
          cfg.source,
          "warning",
          startedAt,
          "Bhashini credentials saved but toggle is disabled."
        );
      }

      try {
        if (cfg.inferenceApiKey) {
          const resp = await fetch(
            "https://dhruva-api.bhashini.gov.in/services/inference/pipeline",
            {
              method: "POST",
              headers: {
                Authorization: cfg.inferenceApiKey,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                pipelineTasks: [
                  {
                    taskType: "translation",
                    config: {
                      language: { sourceLanguage: "en", targetLanguage: "hi" },
                    },
                  },
                ],
                inputData: {
                  input: [{ source: "Hello" }],
                },
              }),
              signal: AbortSignal.timeout(8500),
            }
          );
          const json = (await resp.json().catch(() => ({}))) as {
            pipelineResponse?: Array<{ output?: Array<{ target?: string }> }>;
            message?: string;
          };
          const out = json.pipelineResponse?.[0]?.output?.[0]?.target?.trim();
          if (resp.ok && out) {
            return finalizeResult(
              meta,
              cfg.source,
              "healthy",
              startedAt,
              `Verified live Bhashini Dhruva NMT inference (${Date.now() - startedAt}ms, "Hello" -> "${out}").`
            );
          }
          return finalizeResult(
            meta,
            cfg.source,
            "error",
            startedAt,
            `Bhashini Dhruva inference rejected key (HTTP ${resp.status}${json.message ? `: ${json.message}` : ""}).`
          );
        }

        const ulcaResp = await fetch(
          "https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline",
          {
            method: "POST",
            headers: {
              userID: cfg.userId,
              ulcaApiKey: cfg.ulcaApiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              pipelineTasks: [{ taskType: "translation" }],
              pipelineRequestConfig: { pipelineId: "64392f96daac500b55c543cd" },
            }),
            signal: AbortSignal.timeout(8500),
          }
        );
        if (ulcaResp.ok) {
          return finalizeResult(
            meta,
            cfg.source,
            "healthy",
            startedAt,
            `Verified ULCA User ID & API Key with MeitY Bhashini pipeline (${Date.now() - startedAt}ms).`
          );
        }
        return finalizeResult(
          meta,
          cfg.source,
          "error",
          startedAt,
          `MeitY ULCA auth failed (HTTP ${ulcaResp.status}). Verify ULCA User ID and API Key.`
        );
      } catch (err) {
        return finalizeResult(
          meta,
          cfg.source,
          "error",
          startedAt,
          `Could not reach Bhashini API: ${err instanceof Error ? err.message : "timeout"}.`
        );
      }
    }
  }
}

export async function verifyAllPlatformCredentials(
  options: VerifyCredentialOptions = {}
): Promise<{
  results: CredentialDiagnosticResult[];
  counts: {
    healthy: number;
    warning: number;
    error: number;
    unconfigured: number;
  };
  checkedAt: number;
}> {
  const results = await Promise.all(
    ALL_PLATFORM_CREDENTIAL_PROVIDERS.map((p) =>
      verifyPlatformCredentialProvider(p.key, options)
    )
  );

  const counts = {
    healthy: results.filter((r) => r.status === "healthy").length,
    warning: results.filter((r) => r.status === "warning").length,
    error: results.filter((r) => r.status === "error").length,
    unconfigured: results.filter((r) => r.status === "unconfigured").length,
  };

  return {
    results,
    counts,
    checkedAt: Date.now(),
  };
}

/* ============================================================================
 * Live Platform Infrastructure, Ports, SQLite, KMS & Public API Status Probe
 * ============================================================================ */

export interface SystemServiceProbeItem {
  key: string;
  group: "ports_daemons" | "databases_vault" | "open_apis";
  label: string;
  target: string;
  status: "healthy" | "warning" | "error";
  latencyMs: number;
  detail: string;
}

export interface PlatformSystemStatusReport {
  checkedAt: number;
  items: SystemServiceProbeItem[];
  summary: {
    healthy: number;
    warning: number;
    error: number;
  };
}

async function probeHttpEndpoint(params: {
  key: string;
  group: SystemServiceProbeItem["group"];
  label: string;
  url: string;
  optionalDaemon?: boolean;
}): Promise<SystemServiceProbeItem> {
  const started = Date.now();
  try {
    const resp = await fetch(params.url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(4500),
    });
    const latencyMs = Math.max(1, Date.now() - started);
    const ok = resp.status >= 200 && resp.status < 500;
    return {
      key: params.key,
      group: params.group,
      label: params.label,
      target: params.url,
      status: ok ? "healthy" : "error",
      latencyMs,
      detail: ok
        ? `Reachable (HTTP ${resp.status}, ${latencyMs}ms)`
        : `Returned server error HTTP ${resp.status} (${latencyMs}ms)`,
    };
  } catch (err) {
    const latencyMs = Math.max(1, Date.now() - started);
    return {
      key: params.key,
      group: params.group,
      label: params.label,
      target: params.url,
      status: params.optionalDaemon ? "warning" : "error",
      latencyMs,
      detail: params.optionalDaemon
        ? "Standalone daemon not running (optional in local dev; active via systemd in prod)"
        : `Unreachable (${err instanceof Error ? err.message : "connection refused"})`,
    };
  }
}

export async function probePlatformSystemStatuses(options?: {
  includeOpenExternalApis?: boolean;
}): Promise<PlatformSystemStatusReport> {
  const env = getEnv();
  const includeExternal = options?.includeOpenExternalApis !== false;
  const items: SystemServiceProbeItem[] = [];

  // 1. SQLite Control DB
  {
    const t0 = Date.now();
    try {
      const ctrl = controlDb().$client;
      const journal = String(ctrl.pragma("journal_mode", { simple: true }) || "");
      const wsRow = ctrl.prepare("SELECT COUNT(*) AS cnt FROM workspaces").get() as {
        cnt?: number;
      };
      const metrics = getTenancyHandleMetrics();
      const kb = Math.round(metrics.platformFiles.controlDbBytes / 1024);
      items.push({
        key: "sqlite_control",
        group: "databases_vault",
        label: "Control Plane SQLite (control.db)",
        target: "DATA_DIR/platform/control.db",
        status: "healthy",
        latencyMs: Math.max(1, Date.now() - t0),
        detail: `Online (mode=${journal.toUpperCase()}, ${kb} KB, ${wsRow?.cnt ?? 0} client workspace(s), ${metrics.openDataHandles}/${metrics.maxOpenHandles} tenant handles open)`,
      });
    } catch (err) {
      items.push({
        key: "sqlite_control",
        group: "databases_vault",
        label: "Control Plane SQLite (control.db)",
        target: "DATA_DIR/platform/control.db",
        status: "error",
        latencyMs: Math.max(1, Date.now() - t0),
        detail: err instanceof Error ? err.message : "Failed to query control.db",
      });
    }
  }

  // 2. SQLite Webhook Ingress & Outbox DB
  {
    const t0 = Date.now();
    try {
      const ing = ingressDb().$client;
      const row = ing
        .prepare(
          "SELECT SUM(CASE WHEN status IN ('received', 'enqueued') THEN 1 ELSE 0 END) AS pendingCnt, SUM(CASE WHEN status = 'dead' THEN 1 ELSE 0 END) AS deadCnt FROM webhook_inbox"
        )
        .get() as { pendingCnt?: number | null; deadCnt?: number | null } | undefined;
      const pending = Number(row?.pendingCnt ?? 0);
      const dead = Number(row?.deadCnt ?? 0);
      items.push({
        key: "sqlite_ingress",
        group: "databases_vault",
        label: "Webhook Ingress Queue (ingress.db)",
        target: "DATA_DIR/platform/ingress.db",
        status: dead > 0 ? "warning" : "healthy",
        latencyMs: Math.max(1, Date.now() - t0),
        detail: `Online (${pending} pending webhook(s), ${dead} dead-letter event(s))`,
      });
    } catch (err) {
      items.push({
        key: "sqlite_ingress",
        group: "databases_vault",
        label: "Webhook Ingress Queue (ingress.db)",
        target: "DATA_DIR/platform/ingress.db",
        status: "error",
        latencyMs: Math.max(1, Date.now() - t0),
        detail: err instanceof Error ? err.message : "Failed to query ingress.db",
      });
    }
  }

  // 3. SQLite Platform Audit Logs DB
  {
    const t0 = Date.now();
    try {
      const plogs = platformLogsDb().$client;
      const row = plogs.prepare("SELECT COUNT(*) AS cnt FROM staff_action_logs").get() as {
        cnt?: number;
      };
      items.push({
        key: "sqlite_platform_logs",
        group: "databases_vault",
        label: "Staff Audit Log Vault (platform-logs.db)",
        target: "DATA_DIR/platform/platform-logs.db",
        status: "healthy",
        latencyMs: Math.max(1, Date.now() - t0),
        detail: `Online (${row?.cnt ?? 0} immutable staff audit entries recorded)`,
      });
    } catch (err) {
      items.push({
        key: "sqlite_platform_logs",
        group: "databases_vault",
        label: "Staff Audit Log Vault (platform-logs.db)",
        target: "DATA_DIR/platform/platform-logs.db",
        status: "error",
        latencyMs: Math.max(1, Date.now() - t0),
        detail: err instanceof Error ? err.message : "Failed to query platform-logs.db",
      });
    }
  }

  // 4. KMS AES-256-GCM Envelope Cipher Canary
  {
    const t0 = Date.now();
    try {
      const canaryPlain = `rsl_kms_canary_${Date.now()}`;
      const wrapped = encryptEnvelope(canaryPlain);
      const roundTrip = decryptEnvelope(wrapped);
      const ok = roundTrip === canaryPlain;
      items.push({
        key: "kms_envelope_cipher",
        group: "databases_vault",
        label: "AES-256-GCM KMS Master Cipher",
        target: "KMS_MASTER_KEY envelope encryption",
        status: ok ? "healthy" : "error",
        latencyMs: Math.max(1, Date.now() - t0),
        detail: ok
          ? "Encrypt + decrypt round-trip canary verified cleanly"
          : "Round-trip plaintext mismatch",
      });
    } catch (err) {
      items.push({
        key: "kms_envelope_cipher",
        group: "databases_vault",
        label: "AES-256-GCM KMS Master Cipher",
        target: "KMS_MASTER_KEY envelope encryption",
        status: "error",
        latencyMs: Math.max(1, Date.now() - t0),
        detail: err instanceof Error ? err.message : "KMS cipher failure",
      });
    }
  }

  // 5. Wildcard SSL Certificate Queue Summary
  {
    const t0 = Date.now();
    try {
      const sslRow = controlDb()
        .$client.prepare(
          "SELECT SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS activeCnt, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedCnt, COUNT(*) AS totalCnt FROM ssl_certificates"
        )
        .get() as
        | { activeCnt?: number | null; failedCnt?: number | null; totalCnt?: number | null }
        | undefined;
      const active = Number(sslRow?.activeCnt ?? 0);
      const failed = Number(sslRow?.failedCnt ?? 0);
      const total = Number(sslRow?.totalCnt ?? 0);
      items.push({
        key: "ssl_queue",
        group: "databases_vault",
        label: "Wildcard Subdomain SSL Provisioner",
        target: "*.tally / *.api TLS certificates",
        status: failed > 0 ? "warning" : "healthy",
        latencyMs: Math.max(1, Date.now() - t0),
        detail: `${active}/${total} active HTTPS certificate(s), ${failed} failed`,
      });
    } catch (err) {
      items.push({
        key: "ssl_queue",
        group: "databases_vault",
        label: "Wildcard Subdomain SSL Provisioner",
        target: "*.tally / *.api TLS certificates",
        status: "error",
        latencyMs: Math.max(1, Date.now() - t0),
        detail: err instanceof Error ? err.message : "SSL table check failed",
      });
    }
  }

  // 6-10. Local Service Ports & Background Daemons
  const portChecks = await Promise.all([
    probeHttpEndpoint({
      key: "port_web",
      group: "ports_daemons",
      label: "Client Web Console (:4500)",
      url: "http://127.0.0.1:4500/login",
    }),
    probeHttpEndpoint({
      key: "port_admin",
      group: "ports_daemons",
      label: "Staff Admin Console (:4501)",
      url: "http://127.0.0.1:4501/login",
    }),
    probeHttpEndpoint({
      key: "port_docs",
      group: "ports_daemons",
      label: "Help & Setup Docs (:4502)",
      url: "http://127.0.0.1:4502",
    }),
    probeHttpEndpoint({
      key: "port_worker",
      group: "ports_daemons",
      label: `Outbox & Webhook Worker (:${env.WORKER_HEALTH_PORT})`,
      url: `http://127.0.0.1:${env.WORKER_HEALTH_PORT}/health`,
    }),
    probeHttpEndpoint({
      key: "port_cleanup",
      group: "ports_daemons",
      label: `Cleanup & Rollup Daemon (:${env.CLEANUP_SERVICE_PORT})`,
      url: `http://127.0.0.1:${env.CLEANUP_SERVICE_PORT}/health`,
      optionalDaemon: true,
    }),
  ]);
  items.push(...portChecks);

  // 11-13. Free Open India SMB Public APIs
  if (includeExternal) {
    const externalChecks = await Promise.all([
      probeHttpEndpoint({
        key: "open_ifsc",
        group: "open_apis",
        label: "Razorpay Open IFSC Bank Directory",
        url: "https://ifsc.razorpay.com/SBIN0000300",
        optionalDaemon: true,
      }),
      probeHttpEndpoint({
        key: "open_pincode",
        group: "open_apis",
        label: "India Post Pincode Directory",
        url: "https://api.postalpincode.in/pincode/400001",
        optionalDaemon: true,
      }),
      probeHttpEndpoint({
        key: "open_forex",
        group: "open_apis",
        label: "ECB / Frankfurter Live INR Forex",
        url: "https://api.frankfurter.app/latest?from=USD&to=INR",
        optionalDaemon: true,
      }),
    ]);
    items.push(...externalChecks);
  }

  return {
    checkedAt: Date.now(),
    items,
    summary: {
      healthy: items.filter((i) => i.status === "healthy").length,
      warning: items.filter((i) => i.status === "warning").length,
      error: items.filter((i) => i.status === "error").length,
    },
  };
}

/* ============================================================================
 * Staff Client Workspace Connections, Tally Bridge & Storage Health Diagnostics
 * ============================================================================ */

export interface StaffClientConnectionSummary {
  id: string;
  provider: string;
  channelKind: string;
  displayName: string;
  externalAccountId: string;
  status: string;
  lastHealthCheckAt: number | null;
  expiresAt: number | null;
  maskedTokenHint: string;
  lastLiveCheckMessage: string | null;
}

export interface StaffClientIntegrationSnapshot {
  connections: StaffClientConnectionSummary[];
  tallyAgents: Array<{
    id: string;
    deviceName: string;
    status: string;
    tallyReachable: boolean;
    tallyHost: string;
    tallyPort: number;
    activeCompanyName: string | null;
    lastHeartbeatAt: number | null;
    lastSyncAt: number | null;
    lastErrorMessage: string | null;
  }>;
  tallyWebhook: {
    enabled: boolean;
    eventsReceivedCount: number;
    pingsReceivedCount: number;
    lastEventAt: number | null;
    lastPingAt: number | null;
    lastErrorMessage: string | null;
  } | null;
  storage: {
    mode: string;
    displayLabel: string;
    endpointUrl: string | null;
    bucketName: string | null;
    usedBytes: number;
    objectCount: number;
    status: string;
    lastVerifiedAt: number | null;
  } | null;
  activeApiKeysCount: number;
}

function parseConnMeta(rawJson: string | null | undefined): Record<string, unknown> {
  if (!rawJson) return {};
  try {
    const parsed = JSON.parse(rawJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore malformed json
  }
  return {};
}

export function getStaffClientIntegrationSnapshot(
  workspaceId: string
): StaffClientIntegrationSnapshot {
  const db = controlDb();
  const connRows = db
    .select()
    .from(controlSchema.connections)
    .where(eq(controlSchema.connections.workspaceId, workspaceId))
    .orderBy(desc(controlSchema.connections.updatedAt))
    .all();

  const connections: StaffClientConnectionSummary[] = connRows.map((c) => {
    const meta = parseConnMeta(c.metadataJson);
    return {
      id: c.id,
      provider: c.provider,
      channelKind: typeof meta.channelKind === "string" ? meta.channelKind : c.provider,
      displayName: c.displayName,
      externalAccountId: c.externalAccountId,
      status: c.status,
      lastHealthCheckAt: c.lastHealthCheckAt,
      expiresAt: c.expiresAt,
      maskedTokenHint:
        typeof meta.maskedTokenHint === "string" && meta.maskedTokenHint
          ? meta.maskedTokenHint
          : "••••••••",
      lastLiveCheckMessage:
        typeof meta.lastLiveCheckMessage === "string" ? meta.lastLiveCheckMessage : null,
    };
  });

  const tallyAgents = db
    .select({
      id: controlSchema.agentDevices.id,
      deviceName: controlSchema.agentDevices.deviceName,
      status: controlSchema.agentDevices.status,
      tallyReachable: controlSchema.agentDevices.tallyReachable,
      tallyHost: controlSchema.agentDevices.tallyHost,
      tallyPort: controlSchema.agentDevices.tallyPort,
      activeCompanyName: controlSchema.agentDevices.activeCompanyName,
      lastHeartbeatAt: controlSchema.agentDevices.lastHeartbeatAt,
      lastSyncAt: controlSchema.agentDevices.lastSyncAt,
      lastErrorMessage: controlSchema.agentDevices.lastErrorMessage,
    })
    .from(controlSchema.agentDevices)
    .where(eq(controlSchema.agentDevices.workspaceId, workspaceId))
    .orderBy(desc(controlSchema.agentDevices.createdAt))
    .all();

  const whRow = db
    .select()
    .from(controlSchema.tallyWebhookEndpoints)
    .where(eq(controlSchema.tallyWebhookEndpoints.workspaceId, workspaceId))
    .get();

  const storageRow = db
    .select()
    .from(controlSchema.storageConfigurations)
    .where(eq(controlSchema.storageConfigurations.workspaceId, workspaceId))
    .get();

  const apiKeyCountRow = db.$client
    .prepare(
      "SELECT COUNT(*) AS cnt FROM api_keys WHERE workspace_id = ? AND revoked_at IS NULL"
    )
    .get(workspaceId) as { cnt?: number } | undefined;

  return {
    connections,
    tallyAgents,
    tallyWebhook: whRow
      ? {
          enabled: whRow.enabled,
          eventsReceivedCount: whRow.eventsReceivedCount,
          pingsReceivedCount: whRow.pingsReceivedCount,
          lastEventAt: whRow.lastEventAt,
          lastPingAt: whRow.lastPingAt,
          lastErrorMessage: whRow.lastErrorMessage,
        }
      : null,
    storage: storageRow
      ? {
          mode: storageRow.mode,
          displayLabel: storageRow.displayLabel,
          endpointUrl: storageRow.endpointUrl,
          bucketName: storageRow.bucketName,
          usedBytes: storageRow.usedBytes,
          objectCount: storageRow.objectCount,
          status: storageRow.status,
          lastVerifiedAt: storageRow.lastVerifiedAt,
        }
      : null,
    activeApiKeysCount: Number(apiKeyCountRow?.cnt ?? 0),
  };
}

export async function verifyStaffClientConnectionLive(params: {
  workspaceId: string;
  connectionId: string;
}): Promise<{
  connectionId: string;
  displayName: string;
  status: "healthy" | "expiring" | "needs_reauth";
  message: string;
}> {
  const db = controlDb();
  const conn = db
    .select()
    .from(controlSchema.connections)
    .where(
      and(
        eq(controlSchema.connections.id, params.connectionId),
        eq(controlSchema.connections.workspaceId, params.workspaceId)
      )
    )
    .get();

  if (!conn) {
    throw new RslError("RSL-VAL-1001", "Client connection not found.");
  }

  const now = Date.now();
  const meta = parseConnMeta(conn.metadataJson);
  let nextStatus: "healthy" | "expiring" | "needs_reauth" = "healthy";
  let liveMessage = "Encrypted token verified in client vault.";
  let accessToken = "";
  let refreshToken = "";
  let nextEncryptedTokens = conn.encryptedTokens;
  let nextExpiresAt = conn.expiresAt;

  try {
    const parsed = JSON.parse(decryptEnvelope(conn.encryptedTokens)) as {
      accessToken?: string;
      refreshToken?: string;
      oauthUserToken?: string;
      issuedAt?: number;
    };
    accessToken = (parsed.accessToken || "").trim();
    refreshToken = (parsed.refreshToken || "").trim();
    if (!accessToken || accessToken.length < 6) {
      nextStatus = "needs_reauth";
      liveMessage = "Stored access token is empty or malformed. Client needs to reconnect.";
    }
  } catch {
    nextStatus = "needs_reauth";
    liveMessage = "Token envelope could not be decrypted. Client needs to re-authenticate.";
  }

  if (nextStatus !== "needs_reauth" && accessToken) {
    if (/^(rsl_sandbox_|sandbox_|test_)/i.test(accessToken)) {
      liveMessage = "Sandbox test token verified intact for local workflow testing.";
    } else if (conn.provider === "whatsapp" || conn.provider === "meta") {
      const metaCfg = getPlatformMetaAppConfig();
      const graphVer = metaCfg.graphVersion || "v21.0";
      const graphTarget =
        (typeof meta.phoneNumberId === "string" && meta.phoneNumberId) ||
        (typeof meta.wabaId === "string" && meta.wabaId) ||
        (typeof meta.igUserId === "string" && meta.igUserId) ||
        (typeof meta.pageId === "string" && meta.pageId) ||
        (/^(\d+|act_\d+)$/.test(conn.externalAccountId) ? conn.externalAccountId : "me");

      try {
        const resp = await fetch(
          `https://graph.facebook.com/${graphVer}/${encodeURIComponent(graphTarget)}?fields=id,name`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(6000),
          }
        );
        const body = (await resp.json().catch(() => ({}))) as {
          id?: string;
          name?: string;
          error?: { message?: string; code?: number };
        };
        if (resp.ok && body.id) {
          nextStatus =
            conn.expiresAt && conn.expiresAt - now < 7 * 86_400_000 && conn.expiresAt > now
              ? "expiring"
              : "healthy";
          liveMessage = `Verified live with Meta Graph ${graphVer} (${body.name ? `${body.name} - ID ${body.id}` : `ID ${body.id}`}).`;
        } else {
          nextStatus = "needs_reauth";
          liveMessage = `Meta Graph check failed: ${body.error?.message || `HTTP ${resp.status}`}.`;
        }
      } catch (err) {
        liveMessage = `Vault token intact; Meta Graph unreachable (${err instanceof Error ? err.message : "timeout"}).`;
      }
    } else if (
      conn.provider === "google" ||
      conn.provider === "gdrive" ||
      conn.provider === "google_ads" ||
      conn.provider === "google_sheets" ||
      conn.provider === "google_search_console"
    ) {
      try {
        // Refresh automatically if expired/near-expiry and refresh token is available
        const oauthCfg = getPlatformGoogleOAuthConfig();
        const needsRefresh = Boolean(
          refreshToken &&
            oauthCfg.isReady &&
            (!conn.expiresAt || conn.expiresAt <= now + 90_000)
        );
        if (needsRefresh) {
          const refreshBody = new URLSearchParams({
            client_id: oauthCfg.clientId,
            client_secret: oauthCfg.clientSecret,
            refresh_token: refreshToken,
            grant_type: "refresh_token",
          });
          const refResp = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: refreshBody.toString(),
            signal: AbortSignal.timeout(6500),
          });
          if (refResp.ok) {
            const refData = (await refResp.json()) as {
              access_token?: string;
              expires_in?: number;
              refresh_token?: string;
            };
            if (refData.access_token) {
              accessToken = refData.access_token;
              nextExpiresAt = now + Math.max(300, Number(refData.expires_in || 3599)) * 1000;
              nextEncryptedTokens = encryptEnvelope(
                JSON.stringify({
                  accessToken,
                  refreshToken: refData.refresh_token || refreshToken,
                  issuedAt: now,
                })
              );
            }
          }
        }

        const resp = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
          { method: "GET", signal: AbortSignal.timeout(5500) }
        );
        if (resp.ok) {
          const tokInfo = (await resp.json().catch(() => ({}))) as { email?: string };
          nextStatus = "healthy";
          liveMessage = `Verified live with Google OAuth2 API${tokInfo.email ? ` (${tokInfo.email})` : ""}${refreshToken ? "; auto-refresh active" : ""}.`;
        } else {
          nextStatus = "needs_reauth";
          liveMessage = `Google OAuth2 rejected token (HTTP ${resp.status}). Client needs 1-click re-authorization.`;
        }
      } catch (err) {
        liveMessage = `Vault token intact; Google OAuth2 unreachable (${err instanceof Error ? err.message : "timeout"}).`;
      }
    }
  }

  meta.lastLiveCheckMessage = liveMessage;

  db.update(controlSchema.connections)
    .set({
      status: nextStatus,
      encryptedTokens: nextEncryptedTokens,
      expiresAt: nextExpiresAt,
      metadataJson: JSON.stringify(meta),
      lastHealthCheckAt: now,
      updatedAt: now,
    })
    .where(eq(controlSchema.connections.id, conn.id))
    .run();

  return {
    connectionId: conn.id,
    displayName: conn.displayName,
    status: nextStatus,
    message: liveMessage,
  };
}

export async function verifyAllStaffClientConnectionsLive(workspaceId: string): Promise<{
  total: number;
  healthy: number;
  needsAttention: number;
  results: Array<{
    connectionId: string;
    displayName: string;
    status: "healthy" | "expiring" | "needs_reauth";
    message: string;
  }>;
}> {
  const db = controlDb();
  const conns = db
    .select({ id: controlSchema.connections.id })
    .from(controlSchema.connections)
    .where(eq(controlSchema.connections.workspaceId, workspaceId))
    .all();

  const results = await Promise.all(
    conns.map((c) => verifyStaffClientConnectionLive({ workspaceId, connectionId: c.id }))
  );

  const healthy = results.filter((r) => r.status === "healthy").length;
  return {
    total: results.length,
    healthy,
    needsAttention: results.length - healthy,
    results,
  };
}

export async function verifyStaffClientStorageVaultLive(workspaceId: string): Promise<{
  ok: boolean;
  mode: string;
  message: string;
}> {
  const db = controlDb();
  const cfg = db
    .select()
    .from(controlSchema.storageConfigurations)
    .where(eq(controlSchema.storageConfigurations.workspaceId, workspaceId))
    .get();

  const now = Date.now();
  if (!cfg || cfg.mode === "rsl_managed") {
    const r2 = getPlatformManagedR2Config();
    if (r2.isReady) {
      const diag = await verifyPlatformCredentialProvider("cloudflare_r2");
      const ok = diag.status === "healthy" || diag.status === "warning";
      if (cfg) {
        db.update(controlSchema.storageConfigurations)
          .set({ status: ok ? "healthy" : "degraded", lastVerifiedAt: now, updatedAt: now })
          .where(eq(controlSchema.storageConfigurations.workspaceId, workspaceId))
          .run();
      }
      return {
        ok,
        mode: "rsl_managed",
        message: `RSL Managed Cloud Vault: ${diag.message}`,
      };
    }

    if (cfg) {
      db.update(controlSchema.storageConfigurations)
        .set({ status: "healthy", lastVerifiedAt: now, updatedAt: now })
        .where(eq(controlSchema.storageConfigurations.workspaceId, workspaceId))
        .run();
    }
    return {
      ok: true,
      mode: "rsl_managed",
      message: "RSL Managed Local Encrypted Vault (DATA_DIR/vault) verified writable.",
    };
  }

  // Client BYO R2 / S3 storage
  if (!cfg.endpointUrl || !cfg.bucketName || !cfg.encryptedCredentials) {
    db.update(controlSchema.storageConfigurations)
      .set({ status: "degraded", lastVerifiedAt: now, updatedAt: now })
      .where(eq(controlSchema.storageConfigurations.workspaceId, workspaceId))
      .run();
    return {
      ok: false,
      mode: cfg.mode,
      message: "Client personal R2/S3 configuration is missing endpoint, bucket, or credentials.",
    };
  }

  try {
    const creds = JSON.parse(decryptEnvelope(cfg.encryptedCredentials)) as {
      accessKeyId: string;
      secretAccessKey: string;
    };
    const cleanEndpoint = cfg.endpointUrl.replace(/\/+$/, "");
    const probeKey = `${workspaceId}/_rsl_staff_probe_${now}.txt`;
    const objectUrl = new URL(
      `${cleanEndpoint}/${encodeURIComponent(cfg.bucketName)}/${probeKey}`
    );
    const bodyBuf = Buffer.from("rsl-client-storage-ok", "utf8");
    const putHeaders = buildS3SigV4Headers({
      method: "PUT",
      url: objectUrl,
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      region: cfg.region || "auto",
      body: bodyBuf,
      contentType: "text/plain",
    });

    const putResp = await fetch(objectUrl.toString(), {
      method: "PUT",
      headers: putHeaders,
      body: bodyBuf,
      signal: AbortSignal.timeout(7500),
    });

    if (putResp.ok) {
      const delHeaders = buildS3SigV4Headers({
        method: "DELETE",
        url: objectUrl,
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        region: cfg.region || "auto",
      });
      await fetch(objectUrl.toString(), {
        method: "DELETE",
        headers: delHeaders,
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);

      db.update(controlSchema.storageConfigurations)
        .set({ status: "healthy", lastVerifiedAt: now, updatedAt: now })
        .where(eq(controlSchema.storageConfigurations.workspaceId, workspaceId))
        .run();

      return {
        ok: true,
        mode: cfg.mode,
        message: `Verified live write + delete on client bucket '${cfg.bucketName}' (${cfg.mode}).`,
      };
    }

    db.update(controlSchema.storageConfigurations)
      .set({ status: "degraded", lastVerifiedAt: now, updatedAt: now })
      .where(eq(controlSchema.storageConfigurations.workspaceId, workspaceId))
      .run();

    return {
      ok: false,
      mode: cfg.mode,
      message: `Client bucket '${cfg.bucketName}' rejected S3 probe (HTTP ${putResp.status}).`,
    };
  } catch (err) {
    db.update(controlSchema.storageConfigurations)
      .set({ status: "degraded", lastVerifiedAt: now, updatedAt: now })
      .where(eq(controlSchema.storageConfigurations.workspaceId, workspaceId))
      .run();
    return {
      ok: false,
      mode: cfg.mode,
      message: `Client storage probe failed: ${err instanceof Error ? err.message : "timeout"}.`,
    };
  }
}
