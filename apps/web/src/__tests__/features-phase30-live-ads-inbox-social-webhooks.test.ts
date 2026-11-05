import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { issueApiKey } from "@rsl/api-keys";
import { registerUserWithWorkspace, resolveUserSessionFromToken } from "@rsl/auth";
import {
  allocateAdSpendToCampaign,
  createRazorpayOrderForWallet,
  creditAdSpendVault,
  creditWallet,
  getAdSpendVaultBalancePaise,
  getWalletBalancePaise,
  staffGrantFreeAllToolsAccess,
  verifyRazorpayCheckoutAndCreditWallet,
} from "@rsl/billing";
import {
  completeGoogleOAuthConnection,
  linkExternalConnection,
} from "@rsl/connections";
import { signHmac } from "@rsl/core";
import { tenantDataSchema } from "@rsl/database";
import {
  createGoogleAdCampaign,
  syncGoogleAdCampaignsInsightsForWorkspace,
} from "@rsl/google";
import { listConversationsWithContacts, replyToConversation } from "@rsl/inbox";
import {
  createAdCampaign,
  getMetaWorkspaceSummary,
  scheduleSocialPost,
  sweepDueScheduledPostsAsync,
  syncMetaAdCampaignsInsightsForWorkspace,
  toggleCampaignStatus,
} from "@rsl/meta";
import {
  clearPlatformCredentialOverride,
  savePlatformGoogleAdsConfig,
  savePlatformGoogleOAuthConfig,
  savePlatformMetaAppConfig,
  savePlatformRazorpayConfig,
  tenantDataDb,
} from "@rsl/tenancy";
import {
  installStarterTallyTemplates,
  launchWhatsAppBroadcast,
} from "@rsl/whatsapp";
import { POST as ingestPixelEventPost } from "../app/api/v1/pixel/events/route";
import { POST as metaWebhookPost } from "../app/api/webhooks/meta/route";
import { POST as whatsappWebhookPost } from "../app/api/webhooks/whatsapp/route";

function createTestWorkspace(tag: string, businessName: string) {
  const email = `${tag.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 10000)}@rapidshiftlabs.in`;
  const reg = registerUserWithWorkspace({
    name: "RSL Growth Owner",
    email,
    password: "StrongPassword123!",
    businessName,
    industry: "Industrial Manufacturing",
    stateCode: "27",
  });
  staffGrantFreeAllToolsAccess({
    workspaceId: reg.workspaceId,
    durationDays: 30,
    staffId: "stf_test_p30",
    note: "Phase 30 live ads & integrations test",
  });
  const session = resolveUserSessionFromToken(reg.rawSessionToken)!;
  return { email, reg, session };
}

describe("Phase 30 — Live Meta & Google Ads Studio, 0-Overdraft Ad Spend Vault, Live Social/CAPI, Shared Inbox & Webhooks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearPlatformCredentialOverride("google_oauth");
    clearPlatformCredentialOverride("google_ads");
    clearPlatformCredentialOverride("meta_app");
    clearPlatformCredentialOverride("razorpay");
  });

  it("enforces strict 0-overdraft on Managed Ad Spend Vault (isolated from WhatsApp wallet) and verifies Razorpay HMAC checkouts for both vaults", async () => {
    const { session } = createTestWorkspace("p30vault", "Apex Precision Engineering");

    // Credit ₹5,000 into Prepaid WhatsApp Wallet — Ad Spend Vault must STILL be ₹0!
    creditWallet({
      workspaceId: session.workspace.id,
      amountPaise: 500_000,
      entryType: "credit",
      description: "WhatsApp wallet topup",
      idempotencyKey: `wa_topup_${Date.now()}`,
      actorId: session.user.id,
    });
    expect(getWalletBalancePaise(session.workspace.id)).toBe(500_000);
    expect(getAdSpendVaultBalancePaise(session.workspace.id)).toBe(0);

    // Attempting to allocate even ₹100 from 0-balance Ad Spend Vault MUST fail (zero overdraft!)
    expect(() =>
      allocateAdSpendToCampaign({
        workspaceId: session.workspace.id,
        amountPaise: 10_000,
        provider: "meta_ads",
        campaignId: "camp_zero_test",
        campaignName: "Should Reject Overdraft",
        idempotencyKey: "alloc_reject_1",
        actorId: session.user.id,
      })
    ).toThrow(/Insufficient Ad Spend Vault balance/i);

    // Configure Razorpay platform credentials & verify HMAC checkout popup signature for Ad Spend Vault
    savePlatformRazorpayConfig({
      enabled: true,
      keyId: "rzp_live_P30TestKey",
      keySecret: "rzp_secret_P30SuperSecret99",
      webhookSecret: "whsec_p30",
      staffId: "stf_test_p30",
    });

    const orderId = "order_P30AdVault001";
    const paymentId = "pay_P30AdVault001";

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ id: orderId }), { status: 200 })
    );

    const createdOrder = await createRazorpayOrderForWallet({
      workspaceId: session.workspace.id,
      amountPaise: 250_000, // ₹2,500
      purpose: "ad_spend_topup",
    });
    expect(createdOrder.orderId).toBe(orderId);
    expect(createdOrder.purpose).toBe("ad_spend_topup");

    const validSig = crypto
      .createHmac("sha256", "rzp_secret_P30SuperSecret99")
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    const verified = verifyRazorpayCheckoutAndCreditWallet({
      workspaceId: session.workspace.id,
      actorId: session.user.id,
      orderId,
      paymentId,
      signatureHex: validSig,
    });

    expect(verified.purpose).toBe("ad_spend_topup");
    expect(verified.balancePaise).toBe(250_000);
    expect(getAdSpendVaultBalancePaise(session.workspace.id)).toBe(250_000);
    // WhatsApp wallet remains untouched at ₹5,000
    expect(getWalletBalancePaise(session.workspace.id)).toBe(500_000);

    // Duplicate callback with same paymentId must be idempotent
    const dup = verifyRazorpayCheckoutAndCreditWallet({
      workspaceId: session.workspace.id,
      actorId: session.user.id,
      orderId,
      paymentId,
      signatureHex: validSig,
    });
    expect(dup.balancePaise).toBe(250_000);
    expect(getAdSpendVaultBalancePaise(session.workspace.id)).toBe(250_000);
  });

  it("launches live Meta Marketing API v21.0 campaigns with hard Managed Vault spend_cap, auto-pauses at cap on Insights sync, and refunds unspent funds on completion", async () => {
    const { session } = createTestWorkspace("p30metaads", "Vanguard Fabrics Pvt Ltd");

    savePlatformMetaAppConfig({
      enabled: true,
      appId: "991122334455",
      appSecret: "meta_secret_p30_live",
      webhookVerifyToken: "verify_p30",
      graphVersion: "v21.0",
      enableMetaOAuth: true,
      managedAdAccountId: "act_8877665544",
      managedPageId: "102030405060",
      managedSystemToken: "EAALiveManagedSystemUserTokenP30",
      staffId: "stf_test_p30",
    });

    // Deposit ₹3,000 into Managed Ad Spend Vault
    creditAdSpendVault({
      workspaceId: session.workspace.id,
      amountPaise: 300_000,
      entryType: "deposit",
      description: "Initial Ad Spend Deposit",
      idempotencyKey: `dep_meta_${Date.now()}`,
      actorId: session.user.id,
    });

    const graphCalls: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method || "GET").toUpperCase();
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      graphCalls.push({ url, method, body });

      if (url.endsWith("/act_8877665544/campaigns") && method === "POST") {
        return new Response(JSON.stringify({ id: "camp_meta_live_101" }), { status: 200 });
      }
      if (url.endsWith("/act_8877665544/adsets") && method === "POST") {
        return new Response(JSON.stringify({ id: "adset_meta_live_202" }), { status: 200 });
      }
      if (url.endsWith("/act_8877665544/adcreatives") && method === "POST") {
        return new Response(JSON.stringify({ id: "creative_meta_live_303" }), { status: 200 });
      }
      if (url.endsWith("/act_8877665544/ads") && method === "POST") {
        return new Response(JSON.stringify({ id: "ad_meta_live_404" }), { status: 200 });
      }
      if (url.includes("/act_8877665544/insights") && method === "GET") {
        return new Response(
          JSON.stringify({
            data: [
              {
                campaign_id: "camp_meta_live_101",
                date_start: "2026-11-05",
                spend: "2000.00", // ₹2,000 spent out of ₹2,000 cap -> triggers auto-pause!
                impressions: "18400",
                clicks: "612",
                actions: [{ action_type: "lead", value: "29" }],
                action_values: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "14500" }],
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("/camp_meta_live_101") && method === "POST") {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    // 1. Launch ₹2,000 cap campaign; ₹1,000 remains available in vault
    const createRes = await createAdCampaign(session.ctx, {
      name: "Festive Kurta Wholesale Leads",
      channel: "meta_ads",
      objective: "lead_generation",
      billingMode: "rsl_managed_vault",
      dailyBudgetRupees: 500,
      vaultAllocationRupees: 2000,
      headline: "Direct Mill Wholesale Pricing",
      primaryText: "Order 50+ pcs direct from Surat & Mumbai warehouse.",
      destinationUrl: "https://vanguardfabrics.in/wholesale",
      allowDraftWhenDisconnected: false,
    });

    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;
    expect(createRes.data.syncStatus).toBe("live_synced");
    expect(createRes.data.externalCampaignId).toBe("camp_meta_live_101");
    expect(getAdSpendVaultBalancePaise(session.workspace.id)).toBe(100_000); // ₹1,000 left

    const campPost = graphCalls.find((c) => c.url.endsWith("/act_8877665544/campaigns"));
    expect(campPost?.body.spend_cap).toBe("200000"); // Hard ₹2,000 cap sent to Meta!
    expect(graphCalls.some((c) => c.url.endsWith("/act_8877665544/adcreatives"))).toBe(true);
    expect(graphCalls.some((c) => c.url.endsWith("/act_8877665544/ads"))).toBe(true);

    // 2. Sync Meta Insights -> ₹2,000 spend hits 100% of ₹2,000 Vault Cap -> Auto-pauses live on Meta!
    const syncRes = await syncMetaAdCampaignsInsightsForWorkspace(session.workspace.id);
    expect(syncRes.syncedCampaigns).toBe(1);
    expect(syncRes.autoPausedVaultCampaigns).toBe(1);

    const pauseCall = graphCalls.find(
      (c) => c.url.endsWith("/camp_meta_live_101") && c.body.status === "PAUSED"
    );
    expect(pauseCall).toBeDefined();

    const updatedCamp = getMetaWorkspaceSummary(session.workspace.id).campaigns.find(
      (c) => c.id === createRes.data.campaignId
    )!;
    expect(updatedCamp.status).toBe("paused");
    expect(updatedCamp.syncStatus).toBe("vault_cap_reached");
    expect(updatedCamp.totalSpendPaise).toBe(200_000);
    expect(updatedCamp.conversions).toBe(29);

    // 3. Launch a second ₹1,000 campaign, spend ₹0, mark completed -> ₹1,000 refunded to Vault!
    const secondCamp = await createAdCampaign(session.ctx, {
      name: "Short Promo Burst",
      channel: "instagram",
      objective: "awareness",
      billingMode: "rsl_managed_vault",
      dailyBudgetRupees: 500,
      vaultAllocationRupees: 1000,
      allowDraftWhenDisconnected: false,
    });
    expect(secondCamp.ok).toBe(true);
    if (!secondCamp.ok) return;
    expect(getAdSpendVaultBalancePaise(session.workspace.id)).toBe(0);

    const completeRes = await toggleCampaignStatus(session.ctx, {
      campaignId: secondCamp.data.campaignId,
      status: "completed",
    });
    expect(completeRes.ok).toBe(true);
    expect(getAdSpendVaultBalancePaise(session.workspace.id)).toBe(100_000); // ₹1,000 refunded!
  });

  it("discovers Google Ads Customer IDs via OAuth v18, provisions Search RSA campaigns via googleAds:mutate, and syncs GAQL searchStream spend", async () => {
    const { session } = createTestWorkspace("p30gads", "Radiant Industrial Valves");

    savePlatformGoogleOAuthConfig({
      enabled: true,
      oauthJsonRaw: JSON.stringify({
        web: {
          client_id: "77665544-gads.apps.googleusercontent.com",
          project_id: "rapidshift-labs-prod",
          client_secret: "GOCSPX-GAdsSecretP30",
        },
      }),
      consentAppName: "RapidShift Labs",
      publishingStatus: "production",
      defaultDriveFolderName: "RapidShift Labs Backups",
      enableDriveOAuth: true,
      enableGbpOAuth: true,
      enableGoogleAdsOAuth: true,
      staffId: "stf_test_p30",
    });

    savePlatformGoogleAdsConfig({
      enabled: true,
      developerToken: "DEV_TOK_LIVE_P30_XYZ",
      loginCustomerId: "998-877-6655",
      staffId: "stf_test_p30",
    });

    let capturedMutateHeaders = undefined as HeadersInit | undefined;
    let capturedMutateBody = null as Record<string, unknown> | null;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({
            access_token: "ya29.LiveGoogleAdsTokenP30",
            refresh_token: "1//0gLiveGoogleAdsRefreshP30",
            expires_in: 3600,
            scope: "openid email https://www.googleapis.com/auth/adwords",
          }),
          { status: 200 }
        );
      }
      if (url.startsWith("https://openidconnect.googleapis.com/v1/userinfo")) {
        return new Response(
          JSON.stringify({
            email: "ads@radiantindustrial.in",
            name: "Al Aqmar",
            sub: "9988776655443322",
          }),
          { status: 200 }
        );
      }
      if (url.includes("/customers:listAccessibleCustomers")) {
        return new Response(
          JSON.stringify({ resourceNames: ["customers/4455667788"] }),
          { status: 200 }
        );
      }
      if (url.includes("/customers/4455667788/googleAds:searchStream")) {
        const q = String(JSON.parse(String(init?.body || "{}")).query || "");
        if (q.includes("FROM customer ")) {
          return new Response(
            JSON.stringify([
              {
                results: [
                  {
                    customer: {
                      id: "4455667788",
                      descriptiveName: "Radiant Industrial Search Ads",
                      currencyCode: "INR",
                      manager: false,
                    },
                  },
                ],
              },
            ]),
            { status: 200 }
          );
        }
        // Campaign metrics GAQL query
        return new Response(
          JSON.stringify([
            {
              results: [
                {
                  campaign: {
                    id: "700800900",
                    resourceName: "customers/4455667788/campaigns/700800900",
                    name: "Industrial Ball Valves India",
                    status: "ENABLED",
                  },
                  segments: { date: "2026-11-05" },
                  metrics: {
                    costMicros: "1450000000", // ₹1,450.00 (1,450 * 1,000,000 micros)
                    impressions: "4200",
                    clicks: "310",
                    conversions: "18",
                    conversionsValue: "89000",
                  },
                },
              ],
            },
          ]),
          { status: 200 }
        );
      }
      if (url.includes("/customers/4455667788/googleAds:mutate")) {
        capturedMutateHeaders = init?.headers;
        capturedMutateBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            mutateOperationResponses: [
              { campaignBudgetResult: { resourceName: "customers/4455667788/campaignBudgets/501" } },
              { campaignResult: { resourceName: "customers/4455667788/campaigns/700800900" } },
              { adGroupResult: { resourceName: "customers/4455667788/adGroups/801" } },
              { adGroupAdResult: { resourceName: "customers/4455667788/adGroupAds/801~901" } },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const oauthOut = await completeGoogleOAuthConnection({
      workspaceId: session.workspace.id,
      actorId: session.user.id,
      code: "4/0GoogleAdsAuthCodeP30",
      codeVerifier: "verifier_p30_1234567890",
      redirectUri: "https://app.rapidshiftlabs.in/api/oauth/google/callback",
      purpose: "google_ads",
    });

    expect(oauthOut.customerId).toBe("4455667788");
    expect(oauthOut.adsDiscoveryStatus).toBe("verified_customers");

    const launchRes = await createGoogleAdCampaign(session.ctx, {
      name: "Industrial Ball Valves India",
      objective: "search_leads",
      billingMode: "direct_client",
      dailyBudgetRupees: 1500,
      headline: "SS316 Industrial Valves",
      primaryText: "ISO Certified Ball & Gate Valves — Fast Pan-India Dispatch.",
      destinationUrl: "https://radiantindustrial.in/valves",
      targetLocations: ["Mumbai", "Ahmedabad"],
      targetKeywords: ["ss316 ball valve", "industrial valve supplier"],
      allowDraftWhenDisconnected: false,
    });

    expect(launchRes.ok).toBe(true);
    if (!launchRes.ok) return;
    expect(launchRes.data.externalCampaignId).toBe("customers/4455667788/campaigns/700800900");
    expect((capturedMutateHeaders as Record<string, string>)?.["developer-token"]).toBe(
      "DEV_TOK_LIVE_P30_XYZ"
    );
    expect(Array.isArray(capturedMutateBody?.mutateOperations)).toBe(true);
    expect((capturedMutateBody?.mutateOperations as unknown[]).length).toBeGreaterThanOrEqual(5);

    const gaqlSync = await syncGoogleAdCampaignsInsightsForWorkspace(session.workspace.id);
    expect(gaqlSync.syncedCampaigns).toBe(1);

    const gCamp = getMetaWorkspaceSummary(session.workspace.id).campaigns.find(
      (c) => c.id === launchRes.data.campaignId
    )!;
    expect(gCamp.totalSpendPaise).toBe(145_000); // ₹1,450.00
    expect(gCamp.attributedRevenuePaise).toBe(8_900_000); // ₹89,000.00
    expect(gCamp.clicks).toBe(310);
    expect(gCamp.conversions).toBe(18);
  });

  it("publishes scheduled social posts live to Facebook, Instagram 2-step container, and Google Business Local Posts, and dispatches Meta CAPI via /api/v1/pixel/events", async () => {
    const { session } = createTestWorkspace("p30socialcapi", "bombay Spice Co");

    await linkExternalConnection(session.ctx, {
      provider: "meta",
      assetType: "fb_page",
      displayName: "Bombay Spice Official",
      externalAccountId: "112233445566",
      accessToken: "EAALiveFbPageTokenP30_1234567890",
      scopesGranted: ["pages_manage_posts"],
      metadata: { channelKind: "facebook_page", pageId: "112233445566" },
    });

    await linkExternalConnection(session.ctx, {
      provider: "meta",
      assetType: "ig_account",
      displayName: "@bombayspice",
      externalAccountId: "1784140000001",
      accessToken: "EAALiveIgTokenP30_1234567890",
      scopesGranted: ["instagram_content_publish"],
      metadata: { channelKind: "instagram_business", igUserId: "1784140000001" },
    });

    await linkExternalConnection(session.ctx, {
      provider: "meta",
      assetType: "ad_account",
      displayName: "Bombay Spice Pixel",
      externalAccountId: "act_5544332211",
      accessToken: "EAALivePixelCapiTokenP30_1234567890",
      scopesGranted: ["ads_management"],
      metadata: {
        channelKind: "meta_ads_pixel",
        adAccountId: "act_5544332211",
        pixelId: "909080807070",
      },
    });

    const externalHits: string[] = [];
    let capiPayload = null as Record<string, unknown> | null;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      externalHits.push(url);

      if (url.endsWith("/112233445566/photos")) {
        return new Response(JSON.stringify({ post_id: "112233445566_9001" }), { status: 200 });
      }
      if (url.endsWith("/1784140000001/media")) {
        return new Response(JSON.stringify({ id: "ig_container_777" }), { status: 200 });
      }
      if (url.endsWith("/1784140000001/media_publish")) {
        return new Response(JSON.stringify({ id: "ig_published_888" }), { status: 200 });
      }
      if (url.endsWith("/909080807070/events")) {
        capiPayload = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ events_received: 1, fbtrace_id: "trace_capi_p30" }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ id: "ok" }), { status: 200 });
    });

    // 1. Publish Facebook Photo immediately
    const fbPost = await scheduleSocialPost(session.ctx, {
      channel: "facebook_page",
      caption: "Fresh Kashmiri Saffron batch arrived!",
      scheduledForIso: new Date().toISOString(),
      publishNow: true,
      mediaUrl: "https://cdn.bombayspice.in/saffron.jpg",
      mediaType: "image",
      requireLiveConnection: true,
    });
    expect(fbPost.ok).toBe(true);
    if (fbPost.ok) {
      expect(fbPost.data.externalPostId).toBe("112233445566_9001");
    }

    // 2. Schedule due Instagram post & run worker async sweep (2-step container -> media_publish)
    await scheduleSocialPost(session.ctx, {
      channel: "instagram_feed",
      caption: "Export grade spices ready for dispatch.",
      scheduledForIso: new Date(Date.now() - 60_000).toISOString(),
      publishNow: false,
      mediaUrl: "https://cdn.bombayspice.in/spices.jpg",
      mediaType: "image",
    });

    const swept = await sweepDueScheduledPostsAsync(session.workspace.id);
    expect(swept).toBe(1);
    expect(externalHits.some((u) => u.endsWith("/1784140000001/media"))).toBe(true);
    expect(externalHits.some((u) => u.endsWith("/1784140000001/media_publish"))).toBe(true);

    // 3. Ingest server-side Purchase via REST /api/v1/pixel/events -> Live Meta CAPI
    const keyRes = await issueApiKey(session.ctx, {
      name: "Shopify Checkout CAPI Key",
      mode: "live",
      scopes: ["pixel:write"],
    });
    expect(keyRes.ok).toBe(true);
    if (!keyRes.ok) return;

    const req = new NextRequest("https://app.rapidshiftlabs.in/api/v1/pixel/events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${keyRes.data.rawKey}`,
        "Content-Type": "application/json",
        "x-forwarded-for": "49.36.120.11",
      },
      body: JSON.stringify({
        eventId: "ORD-SHOPIFY-5001",
        eventName: "Purchase",
        valueRupees: 4850,
        customerEmail: "buyer@spicebuyer.in",
        customerPhone: "+919820112233",
        sourceUrl: "https://bombayspice.in/checkout/thank_you",
      }),
    });

    const resp = await ingestPixelEventPost(req);
    const respJson = (await resp.json()) as {
      ok: boolean;
      capiStatus: string;
      deduplicated: boolean;
    };
    expect(resp.status).toBe(201);
    expect(respJson.ok).toBe(true);
    expect(respJson.capiStatus).toBe("sent_live");
    expect(respJson.deduplicated).toBe(false);
    expect(capiPayload).not.toBeNull();
  });

  it("delivers live Shared Inbox WhatsApp replies, updates broadcast counts from statuses[] webhooks, and captures Meta leadgen webhooks into Inbox + Campaign conversions", async () => {
    const { session } = createTestWorkspace("p30webhooks", "Metro Steel & Alloys");
    const appSecret = "wh_secret_meta_p30_hex";

    savePlatformMetaAppConfig({
      enabled: true,
      appId: "8822334455",
      appSecret,
      webhookVerifyToken: "verify_metro_p30",
      graphVersion: "v21.0",
      staffId: "stf_test_p30",
    });

    await linkExternalConnection(session.ctx, {
      provider: "whatsapp",
      assetType: "waba_phone",
      displayName: "Metro Steel WhatsApp",
      externalAccountId: "334455667788",
      accessToken: "EAALiveWhatsAppTokenP30_1234567890",
      scopesGranted: ["whatsapp_business_messaging"],
      metadata: {
        channelKind: "whatsapp_cloud",
        wabaId: "waba_metro_01",
        phoneNumberId: "334455667788",
      },
    });

    await linkExternalConnection(session.ctx, {
      provider: "meta",
      assetType: "fb_page",
      displayName: "Metro Steel Facebook Page",
      externalAccountId: "page_metro_777",
      accessToken: "EAALivePageLeadTokenP30_1234567890",
      scopesGranted: ["pages_manage_ads", "leads_retrieval"],
      metadata: { channelKind: "facebook_page", pageId: "page_metro_777" },
    });

    // Seed an active Meta Lead campaign to verify leadgen conversion attribution
    const db = tenantDataDb({ workspaceId: session.workspace.id });
    db.insert(tenantDataSchema.campaigns)
      .values({
        id: "camp_local_lead_01",
        name: "TMT Bars Lead Form Campaign",
        channel: "facebook",
        objective: "lead_generation",
        billingMode: "direct_client",
        status: "active",
        dailyBudgetPaise: 100_000,
        externalCampaignId: "meta_camp_lead_999",
        syncStatus: "live_synced",
        startDate: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();

    let sentWhatsAppBodies: Array<Record<string, unknown>> = [];
    let broadcastMsgCounter = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes("/334455667788/messages")) {
        const parsedBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
        sentWhatsAppBodies.push(parsedBody);
        broadcastMsgCounter++;
        return new Response(
          JSON.stringify({ messages: [{ id: `wamid.live_p30_${broadcastMsgCounter}` }] }),
          { status: 200 }
        );
      }

      if (url.includes("/lead_id_990011")) {
        return new Response(
          JSON.stringify({
            id: "lead_id_990011",
            campaign_id: "meta_camp_lead_999",
            field_data: [
              { name: "full_name", values: ["Rajesh Sharma"] },
              { name: "phone_number", values: ["+919820998877"] },
              { name: "email", values: ["rajesh@sharmabuilders.in"] },
              { name: "company_name", values: ["Sharma Builders"] },
            ],
          }),
          { status: 200 }
        );
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    // 1. Send Meta leadgen webhook -> fetches Graph lead_id_990011 -> creates Contact + OptIn + Conversation + increments Campaign conversions!
    const leadWebhookPayload = JSON.stringify({
      object: "page",
      entry: [
        {
          id: "page_metro_777",
          changes: [
            {
              field: "leadgen",
              value: {
                leadgen_id: "lead_id_990011",
                page_id: "page_metro_777",
                form_id: "form_555",
              },
            },
          ],
        },
      ],
    });
    const leadSig = `sha256=${signHmac(leadWebhookPayload, appSecret)}`;
    const leadResp = await metaWebhookPost(
      new NextRequest("https://app.rapidshiftlabs.in/api/webhooks/meta", {
        method: "POST",
        headers: { "x-hub-signature-256": leadSig },
        body: leadWebhookPayload,
      })
    );
    expect(leadResp.status).toBe(200);

    const convsAfterLead = listConversationsWithContacts(session.workspace.id);
    expect(convsAfterLead.some((c) => c.contact.name === "Rajesh Sharma")).toBe(true);

    const attributedCamp = db
      .select()
      .from(tenantDataSchema.campaigns)
      .all()
      .find((c) => c.id === "camp_local_lead_01")!;
    expect(attributedCamp.conversions).toBe(1);

    // 2. Reply to Rajesh Sharma from Shared Inbox -> must hit live WhatsApp Cloud API!
    const rajeshConv = convsAfterLead.find((c) => c.contact.name === "Rajesh Sharma")!;
    const replyRes = await replyToConversation(session.ctx, {
      conversationId: rajeshConv.conversation.id,
      body: "Namaste Rajesh ji, sharing our TMT FE550 rate card right away.",
    });
    expect(replyRes.ok).toBe(true);
    if (replyRes.ok) {
      expect(replyRes.data.externalMessageId).toBe("wamid.live_p30_1");
    }
    expect(sentWhatsAppBodies).toHaveLength(1);
    expect(sentWhatsAppBodies[0]?.type).toBe("text");

    // 3. Launch live WhatsApp Broadcast to Rajesh (opted-in via Lead Ad!) & process statuses[] delivered + read webhooks!
    creditWallet({
      workspaceId: session.workspace.id,
      amountPaise: 50_000,
      entryType: "credit",
      description: "Broadcast wallet credit",
      idempotencyKey: `bcast_wa_p30_${Date.now()}`,
      actorId: session.user.id,
    });
    await installStarterTallyTemplates(session.ctx, {});
    const starterTmpl = db.select().from(tenantDataSchema.whatsappTemplates).get()!;

    const bcast = await launchWhatsAppBroadcast(session.ctx, {
      name: "November Steel Rate Update",
      templateId: starterTmpl.id,
    });
    expect(bcast.ok).toBe(true);
    if (!bcast.ok) return;

    // In live WABA mode, deliveredCount starts at 0 until Meta sends statuses[] webhook!
    let bcastRow = db
      .select()
      .from(tenantDataSchema.broadcasts)
      .all()
      .find((b) => b.id === bcast.data.broadcastId)!;
    expect(bcastRow.sentCount).toBe(1);
    expect(bcastRow.deliveredCount).toBe(0);

    // Send WhatsApp statuses[] ("read") + interactive quick-reply button webhook!
    const waWebhookBody = JSON.stringify({
      entry: [
        {
          id: "334455667788",
          changes: [
            {
              value: {
                metadata: { phone_number_id: "334455667788" },
                statuses: [
                  {
                    id: "wamid.live_p30_2",
                    status: "read",
                    recipient_id: "919820998877",
                  },
                ],
                messages: [
                  {
                    from: "919820998877",
                    id: "wamid.inbound_btn_1",
                    type: "button",
                    button: { text: "Confirm Receipt", payload: "CONFIRM_RECEIPT" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const waSig = `sha256=${signHmac(waWebhookBody, appSecret)}`;
    const waResp = await whatsappWebhookPost(
      new NextRequest("https://app.rapidshiftlabs.in/api/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": waSig },
        body: waWebhookBody,
      })
    );
    expect(waResp.status).toBe(200);

    bcastRow = db
      .select()
      .from(tenantDataSchema.broadcasts)
      .all()
      .find((b) => b.id === bcast.data.broadcastId)!;
    expect(bcastRow.deliveredCount).toBe(1);
    expect(bcastRow.readCount).toBe(1);
    expect(bcastRow.repliedCount).toBe(1);

    const allMsgs = db.select().from(tenantDataSchema.messages).all();
    expect(allMsgs.some((m) => m.body === "Confirm Receipt" && m.direction === "inbound")).toBe(
      true
    );
  });
});
