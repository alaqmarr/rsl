import { afterEach, describe, expect, it, vi } from "vitest";
import { registerUserWithWorkspace } from "@rsl/auth";
import { encryptEnvelope } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import {
  ALL_PLATFORM_CREDENTIAL_PROVIDERS,
  clearPlatformCredentialOverride,
  controlDb,
  getPlatformRazorpayConfig,
  getSafePlatformCredentialsAdminSnapshot,
  getStaffClientIntegrationSnapshot,
  probePlatformSystemStatuses,
  recordPlatformCredentialVerification,
  savePlatformBhashiniConfig,
  savePlatformCloudflareAiConfig,
  savePlatformCloudflareEmailConfig,
  savePlatformGoogleAdsConfig,
  savePlatformGoogleOAuthConfig,
  savePlatformManagedR2Config,
  savePlatformMetaAppConfig,
  savePlatformRazorpayConfig,
  savePlatformSmtpConfig,
  savePlatformTurnstileConfig,
  savePlatformVapidConfig,
  verifyAllPlatformCredentials,
  verifyAllStaffClientConnectionsLive,
  verifyPlatformCredentialProvider,
  verifyStaffClientConnectionLive,
  verifyStaffClientStorageVaultLive,
} from "@rsl/tenancy";

function createTestWorkspace(tag: string) {
  const email = `${tag.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 100000)}@rslphase35.in`;
  return registerUserWithWorkspace({
    name: `${tag} Owner`,
    email,
    password: "StrongPassword123!",
    businessName: `${tag} Pvt Ltd`,
    industry: "Manufacturing",
    stateCode: "27",
  });
}

describe("Phase 35 Suite (Staff Live Diagnostics for All 11 Platform Credentials, System Statuses & Client Channels)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    for (const p of ALL_PLATFORM_CREDENTIAL_PROVIDERS) {
      clearPlatformCredentialOverride(p.key);
    }
    // Re-seed clean VAPID keys so web push tests remain ready
    savePlatformVapidConfig({
      enabled: true,
      subject: "mailto:app@rapidshiftlabs.in",
      autoGenerate: true,
      staffId: "stf_phase35_test",
    });
  });

  it("persists verification telemetry on unconfigured/.env providers without overriding .env fallback", () => {
    clearPlatformCredentialOverride("razorpay");
    expect(getPlatformRazorpayConfig().source).not.toBe("database");

    recordPlatformCredentialVerification({
      providerKey: "razorpay",
      status: "unconfigured",
      message: "Optional Razorpay keys not configured; manual UPI QR active.",
    });

    const after = getPlatformRazorpayConfig();
    expect(after.source).not.toBe("database");
    expect(after.lastVerifyStatus).toBe("unconfigured");
    expect(after.lastVerifyMessage).toContain("Optional Razorpay keys not configured");
    expect(after.lastVerifiedAt).toBeTypeOf("number");

    const snap = getSafePlatformCredentialsAdminSnapshot();
    expect(snap.razorpay.lastVerifyStatus).toBe("unconfigured");
    expect(snap.razorpay.lastVerifiedAt).toBe(after.lastVerifiedAt);
  });

  it("verifies all 11 platform credential providers (live OAuth/Turnstile/R2 SigV4/Meta/Razorpay/AI/Email/VAPID/Bhashini/SMTP)", async () => {
    const staffId = "stf_phase35_test";
    savePlatformGoogleOAuthConfig({
      enabled: true,
      clientId: "1234567890-phase35.apps.googleusercontent.com",
      clientSecret: "GOCSPX-phase35_valid_secret",
      projectId: "rapidshift-labs-prod",
      consentAppName: "RapidShift Labs",
      publishingStatus: "production",
      staffId,
    });
    savePlatformGoogleAdsConfig({
      enabled: true,
      staffId,
    });
    savePlatformSmtpConfig({
      enabled: true,
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      from: "RapidShift Labs <app@rapidshiftlabs.in>",
      user: "app@rapidshiftlabs.in",
      password: "abcd efgh ijkl mnop",
      staffId,
    });
    savePlatformManagedR2Config({
      enabled: true,
      accountId: "cf_acc_phase35_1234567890123456",
      accessKeyId: "r2_access_key_phase35",
      secretAccessKey: "r2_secret_access_key_phase35_value",
      bucketPrivate: "rsl-private-vault",
      bucketPublic: "rsl-public-media",
      staffId,
    });
    savePlatformMetaAppConfig({
      enabled: true,
      appId: "887766554433221",
      appSecret: "meta_app_secret_phase35_valid",
      webhookVerifyToken: "rsl_verify_token_phase35_secure",
      staffId,
    });
    savePlatformRazorpayConfig({
      enabled: true,
      keyId: "rzp_test_Phase35KeyId",
      keySecret: "rzp_test_Phase35SecretValue",
      webhookSecret: "rzp_whsec_phase35_1234567890",
      staffId,
    });
    savePlatformTurnstileConfig({
      enabled: true,
      siteKey: "0x4AAAAAA_phase35_site",
      secretKey: "0x4AAAAAA_phase35_secret",
      staffId,
    });
    savePlatformCloudflareAiConfig({
      enabled: true,
      accountId: "cf_acc_phase35_1234567890123456",
      apiToken: "cf_ai_token_phase35_secret_value",
      textModel: "@cf/meta/llama-3.1-8b-instruct",
      staffId,
    });
    savePlatformCloudflareEmailConfig({
      enabled: true,
      inboundDomain: "bills.rapidshiftlabs.in",
      autoGenerateSecret: true,
      staffId,
    });
    savePlatformVapidConfig({
      enabled: true,
      subject: "mailto:app@rapidshiftlabs.in",
      autoGenerate: true,
      staffId,
    });
    savePlatformBhashiniConfig({
      enabled: true,
      userId: "bhashini_user_phase35",
      inferenceApiKey: "bhashini_inference_key_phase35",
      staffId,
    });

    const seenR2AuthHeaders: string[] = [];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      // 1. Google OAuth token endpoint (non-destructive invalid_grant proves clientId + clientSecret valid)
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({ error: "invalid_grant", error_description: "Bad Request" }),
          { status: 400, headers: { "content-type": "application/json" } }
        );
      }

      // 3. Cloudflare R2 S3 SigV4 PUT & DELETE
      if (url.includes(".r2.cloudflarestorage.com/rsl-private-vault/")) {
        const hdrs = new Headers(init?.headers);
        seenR2AuthHeaders.push(hdrs.get("Authorization") || "");
        return new Response("", { status: init?.method === "DELETE" ? 204 : 200 });
      }

      // 4. Meta Graph App Token & App Metadata
      if (url.includes("graph.facebook.com") && url.includes("/oauth/access_token")) {
        return new Response(
          JSON.stringify({ access_token: "887766554433221|app_tok_ok", token_type: "bearer" }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("graph.facebook.com") && url.includes("887766554433221?fields=")) {
        return new Response(
          JSON.stringify({ id: "887766554433221", name: "RapidShift Labs Suite" }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      // 6. Razorpay Orders endpoint
      if (url.startsWith("https://api.razorpay.com/v1/orders")) {
        return new Response(JSON.stringify({ entity: "collection", count: 0, items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      // 7. Cloudflare Turnstile siteverify (invalid-input-response proves secretKey is valid!)
      if (url.startsWith("https://challenges.cloudflare.com/turnstile/v0/siteverify")) {
        return new Response(
          JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      // 8. Cloudflare Workers AI
      if (url.includes("api.cloudflare.com/client/v4/accounts/") && url.includes("/ai/run/")) {
        return new Response(
          JSON.stringify({ success: true, result: { response: "OK" } }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      // 9. Cloudflare DoH MX lookup for Email Routing
      if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
        return new Response(
          JSON.stringify({
            Status: 0,
            Answer: [{ name: "bills.rapidshiftlabs.in", type: 15, data: "10 route1.mx.cloudflare.net." }],
          }),
          { status: 200, headers: { "content-type": "application/dns-json" } }
        );
      }

      // 11. MeitY Bhashini Dhruva NMT
      if (url.startsWith("https://dhruva-api.bhashini.gov.in/services/inference/pipeline")) {
        return new Response(
          JSON.stringify({
            pipelineResponse: [{ output: [{ target: "नमस्ते" }] }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const fullReport = await verifyAllPlatformCredentials({
      appOrigin: "https://app.rapidshiftlabs.in",
      smtpVerifyFn: async () => ({
        ok: true,
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        user: "app@rapidshiftlabs.in",
        latencyMs: 42,
        message: "SMTP TLS & AUTH verified cleanly (42ms).",
      }),
    });

    expect(fullReport.results).toHaveLength(11);
    expect(fullReport.counts.error).toBe(0);
    expect(fullReport.counts.unconfigured).toBe(0);
    expect(fullReport.counts.healthy).toBe(11);
    expect(seenR2AuthHeaders.length).toBeGreaterThanOrEqual(2);
    expect(seenR2AuthHeaders[0]).toContain("AWS4-HMAC-SHA256 Credential=r2_access_key_phase35/");

    // Also verify negative error detection when Google OAuth or Turnstile rejects a bad secret
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({ error: "invalid_client", error_description: "Unauthorized" }),
          { status: 401, headers: { "content-type": "application/json" } }
        );
      }
      if (url.startsWith("https://challenges.cloudflare.com/turnstile/v0/siteverify")) {
        return new Response(
          JSON.stringify({ success: false, "error-codes": ["invalid-input-secret"] }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("{}", { status: 400 });
    }) as typeof fetch;

    const badGoogle = await verifyPlatformCredentialProvider("google_oauth");
    expect(badGoogle.status).toBe("error");
    expect(badGoogle.message).toMatch(/rejected Client ID or Secret/i);

    const badTurnstile = await verifyPlatformCredentialProvider("cloudflare_turnstile");
    expect(badTurnstile.status).toBe("error");
    expect(badTurnstile.message).toMatch(/rejected Secret Key/i);
  });

  it("probes local SQLite WAL databases, KMS AES-256-GCM cipher canary, and SSL certificate queue", async () => {
    globalThis.fetch = vi.fn(async () => new Response("OK", { status: 200 })) as typeof fetch;

    const sys = await probePlatformSystemStatuses({ includeOpenExternalApis: false });
    const byKey = new Map(sys.items.map((item) => [item.key, item]));

    expect(byKey.get("sqlite_control")?.status).toBe("healthy");
    expect(byKey.get("sqlite_ingress")?.status).toBe("healthy");
    expect(byKey.get("sqlite_platform_logs")?.status).toBe("healthy");
    expect(byKey.get("kms_envelope_cipher")?.status).toBe("healthy");
    expect(byKey.get("ssl_queue")).toBeDefined();
    expect(sys.summary.error).toBe(0);
  });

  it("inspects and live-tests client workspace OAuth channels (Meta Graph + Google auto-refresh) & storage vault", async () => {
    const reg = createTestWorkspace("ClientDiag");
    const db = controlDb();
    const now = Date.now();

    savePlatformGoogleOAuthConfig({
      enabled: true,
      clientId: "google-client-phase35.apps.googleusercontent.com",
      clientSecret: "GOCSPX-google-secret-phase35",
      staffId: "stf_phase35_test",
    });

    const metaConnId = `con_meta_${now}`;
    const googleConnId = `con_goog_${now}`;

    db.insert(controlSchema.connections)
      .values([
        {
          id: metaConnId,
          workspaceId: reg.workspaceId,
          provider: "whatsapp",
          displayName: "Acme Official WhatsApp",
          externalAccountId: "991122334455",
          encryptedTokens: encryptEnvelope(
            JSON.stringify({ accessToken: "EAAB_live_meta_token_phase35", issuedAt: now })
          ),
          scopesGrantedJson: "[]",
          status: "healthy",
          expiresAt: now + 30 * 86_400_000,
          lastHealthCheckAt: null,
          metadataJson: JSON.stringify({
            channelKind: "whatsapp",
            wabaId: "991122334455",
            maskedTokenHint: "EAAB_l••••se35",
          }),
          createdAt: now,
          updatedAt: now,
        },
        {
          id: googleConnId,
          workspaceId: reg.workspaceId,
          provider: "google",
          displayName: "Acme Google Business Profile",
          externalAccountId: "gbp_loc_7788",
          encryptedTokens: encryptEnvelope(
            JSON.stringify({
              accessToken: "ya29.expired_google_token",
              refreshToken: "1//0g_valid_google_refresh_token",
              issuedAt: now - 7200_000,
            })
          ),
          scopesGrantedJson: "[]",
          status: "expiring",
          expiresAt: now - 60_000, // expired -> triggers automatic refresh during Staff live test!
          lastHealthCheckAt: null,
          metadataJson: JSON.stringify({
            channelKind: "gbp",
            maskedTokenHint: "ya29.e••••oken",
          }),
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run();

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("graph.facebook.com") && url.includes("991122334455")) {
        return new Response(
          JSON.stringify({ id: "991122334455", name: "Acme Official WABA" }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(
          JSON.stringify({ access_token: "ya29.freshly_refreshed_token", expires_in: 3600 }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
        expect(url).toContain("ya29.freshly_refreshed_token");
        return new Response(
          JSON.stringify({ email: "owner@acme.in", expires_in: "3599" }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const initialSnap = getStaffClientIntegrationSnapshot(reg.workspaceId);
    expect(initialSnap.connections).toHaveLength(2);

    const metaRes = await verifyStaffClientConnectionLive({
      workspaceId: reg.workspaceId,
      connectionId: metaConnId,
    });
    expect(metaRes.status).toBe("healthy");
    expect(metaRes.message).toContain("Acme Official WABA");

    const allRes = await verifyAllStaffClientConnectionsLive(reg.workspaceId);
    expect(allRes.total).toBe(2);
    expect(allRes.healthy).toBe(2);
    expect(allRes.needsAttention).toBe(0);

    const storageRes = await verifyStaffClientStorageVaultLive(reg.workspaceId);
    expect(storageRes.ok).toBe(true);

    const updatedSnap = getStaffClientIntegrationSnapshot(reg.workspaceId);
    const refreshedGoogle = updatedSnap.connections.find((c) => c.id === googleConnId);
    expect(refreshedGoogle?.status).toBe("healthy");
    expect(refreshedGoogle?.lastLiveCheckMessage).toContain("owner@acme.in");
  });
});
