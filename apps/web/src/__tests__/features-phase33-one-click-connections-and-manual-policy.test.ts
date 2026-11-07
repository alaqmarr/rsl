import { afterEach, describe, expect, it, vi } from "vitest";
import { registerUserWithWorkspace, resolveUserSessionFromToken } from "@rsl/auth";
import {
  assertManualCredentialsAllowedForWorkspace,
  buildGoogleOAuthAuthorizeUrl,
  buildMetaOAuthAuthorizeUrl,
  completeGoogleOAuthConnection,
  completeMetaOAuthConnection,
  isManualCredentialsEnabledForWorkspace,
  listWorkspaceConnections,
  refreshMetaChannelAssets,
  selectGoogleSearchConsoleSite,
  selectMetaChannelAsset,
  staffSetWorkspaceManualCredentialsPolicy,
} from "@rsl/connections";
import { RslError } from "@rsl/core";
import {
  savePlatformGoogleAdsConfig,
  savePlatformGoogleOAuthConfig,
  savePlatformMetaAppConfig,
} from "@rsl/tenancy";

function createTestOwnerSession(tag: string) {
  const email = `${tag.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 100000)}@rslphase33.in`;
  const reg = registerUserWithWorkspace({
    name: `${tag} Owner`,
    email,
    password: "StrongPassword123!",
    businessName: `${tag} Enterprises`,
    industry: "Retail",
    stateCode: "27",
  });
  const session = resolveUserSessionFromToken(reg.rawSessionToken)!;
  return { email, reg, session };
}

describe("Phase 33 Suite (1-Click Connection Suite Revamp, Multi-Asset Switching & Staff Manual Credential Policy)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("enforces 1-click-only policy by default (allowManualCredentials = false) and allows Staff backend toggle per client", () => {
    const { reg } = createTestOwnerSession("PolicyDefault");

    expect(isManualCredentialsEnabledForWorkspace(reg.workspaceId)).toBe(false);
    const initialList = listWorkspaceConnections(reg.workspaceId);
    expect(initialList.allowManualCredentials).toBe(false);

    let caught: unknown;
    try {
      assertManualCredentialsAllowedForWorkspace(reg.workspaceId);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RslError);
    expect((caught as RslError).code).toBe("RSL-AUTH-1003");

    // Staff enables manual credentials for this specific client from Admin backend
    const enabledRes = staffSetWorkspaceManualCredentialsPolicy({
      workspaceId: reg.workspaceId,
      enabled: true,
    });
    expect(enabledRes.enabled).toBe(true);
    expect(isManualCredentialsEnabledForWorkspace(reg.workspaceId)).toBe(true);
    expect(listWorkspaceConnections(reg.workspaceId).allowManualCredentials).toBe(true);
    expect(() => assertManualCredentialsAllowedForWorkspace(reg.workspaceId)).not.toThrow();

    // Staff revokes manual credentials -> returns immediately to strict 1-click mode
    const disabledRes = staffSetWorkspaceManualCredentialsPolicy({
      workspaceId: reg.workspaceId,
      enabled: false,
    });
    expect(disabledRes.enabled).toBe(false);
    expect(isManualCredentialsEnabledForWorkspace(reg.workspaceId)).toBe(false);
    expect(() => assertManualCredentialsAllowedForWorkspace(reg.workspaceId)).toThrowError(
      /Manual credential entry is disabled/i
    );
  });

  it("completes 1-Click Meta Suite OAuth with multi-asset + Embedded Signup discovery, auto-subscribes webhooks, and switches assets in 1 click", async () => {
    const { reg } = createTestOwnerSession("MetaOneClick");

    savePlatformMetaAppConfig({
      enabled: true,
      appId: "998877665544332",
      appSecret: "meta_secret_phase33_test_value",
      graphVersion: "v21.0",
      enableMetaOAuth: true,
      staffId: "staff_phase33",
    });

    const authUrl = buildMetaOAuthAuthorizeUrl({
      redirectUri: "http://localhost:4500/api/oauth/meta/callback",
      state: "state_meta_all_test",
      purpose: "meta_all",
    });
    expect(authUrl).toContain("facebook.com/v21.0/dialog/oauth");
    expect(authUrl).toContain("whatsapp_business_messaging");
    expect(authUrl).toContain("instagram_manage_messages");
    expect(authUrl).toContain("ads_management");

    const subscribedTargets: string[] = [];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method || "GET").toUpperCase();

      if (url.includes("/oauth/access_token") && url.includes("fb_exchange_token")) {
        return new Response(
          JSON.stringify({ access_token: "meta_long_user_tok_33", expires_in: 5184000 }),
          { status: 200 }
        );
      }
      if (url.includes("/oauth/access_token")) {
        return new Response(
          JSON.stringify({ access_token: "meta_short_user_tok_33", expires_in: 3600 }),
          { status: 200 }
        );
      }
      if (url.includes("/debug_token")) {
        return new Response(
          JSON.stringify({
            data: {
              is_valid: true,
              granular_scopes: [
                {
                  scope: "whatsapp_business_management",
                  target_ids: ["waba_embedded_999"],
                },
              ],
            },
          }),
          { status: 200 }
        );
      }
      if (method === "POST" && url.includes("/subscribed_apps")) {
        subscribedTargets.push(url);
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (url.includes("/me/accounts")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "page_101",
                name: "Radiant Flagship Mumbai",
                category: "Industrial Company",
                access_token: "perm_page_tok_101",
                instagram_business_account: {
                  id: "ig_201",
                  username: "radiant_mumbai",
                  name: "Radiant Mumbai",
                },
              },
              {
                id: "page_102",
                name: "Radiant Pune Branch",
                category: "Wholesale Supply",
                access_token: "perm_page_tok_102",
                instagram_business_account: {
                  id: "ig_202",
                  username: "radiant_pune",
                  name: "Radiant Pune",
                },
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("/page_102?fields=access_token")) {
        return new Response(
          JSON.stringify({ id: "page_102", name: "Radiant Pune Branch", access_token: "perm_page_tok_102_fresh" }),
          { status: 200 }
        );
      }
      if (url.includes("/me/adaccounts")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "act_301",
                account_id: "301",
                name: "Radiant India INR Ads",
                currency: "INR",
                account_status: 1,
              },
              {
                id: "act_302",
                account_id: "302",
                name: "Radiant Export USD Ads",
                currency: "USD",
                account_status: 1,
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("/act_301/adspixels")) {
        return new Response(
          JSON.stringify({
            data: [
              { id: "px_401", name: "Main Store Pixel" },
              { id: "px_402", name: "B2B Lead Pixel" },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("/act_302/adspixels")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url.includes("/me/businesses")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "biz_1",
                name: "Radiant Group",
                owned_whatsapp_business_accounts: {
                  data: [{ id: "waba_501", name: "Radiant HQ WABA" }],
                },
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("/waba_embedded_999/phone_numbers")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "ph_602",
                display_phone_number: "+91 98200 22222",
                verified_name: "Radiant Support Desk",
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("/waba_501/phone_numbers")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "ph_601",
                display_phone_number: "+91 98200 11111",
                verified_name: "Radiant Billing Desk",
              },
            ],
          }),
          { status: 200 }
        );
      }

      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    const result = await completeMetaOAuthConnection({
      workspaceId: reg.workspaceId,
      actorId: reg.userId,
      code: "oauth_code_meta_all_33",
      redirectUri: "http://localhost:4500/api/oauth/meta/callback",
      purpose: "meta_all",
    });

    expect(result.connectedLabels.length).toBe(4);
    expect(subscribedTargets.some((u) => u.includes("/page_101/subscribed_apps"))).toBe(true);
    expect(
      subscribedTargets.some(
        (u) =>
          u.includes("/waba_embedded_999/subscribed_apps") ||
          u.includes("/waba_501/subscribed_apps")
      )
    ).toBe(true);

    const afterOAuth = listWorkspaceConnections(reg.workspaceId);
    expect(afterOAuth.connections.length).toBe(4);

    const fbConn = afterOAuth.connections.find((c) => c.channelKind === "facebook_page")!;
    const igConn = afterOAuth.connections.find((c) => c.channelKind === "instagram_business")!;
    const adsConn = afterOAuth.connections.find((c) => c.channelKind === "meta_ads_pixel")!;
    const waConn = afterOAuth.connections.find((c) => c.channelKind === "whatsapp_cloud")!;

    expect(fbConn.metadata.availableMetaPages?.length).toBe(2);
    expect(fbConn.metadata.webhookAutoSubscribed).toBe(true);
    expect(igConn.metadata.availableInstagramAccounts?.length).toBe(2);
    expect(adsConn.metadata.availableMetaAdAccounts?.length).toBe(2);
    expect(adsConn.metadata.pixelId).toBe("px_401");
    // Both Owned WABA phone and Embedded Signup /debug_token WABA phone discovered!
    expect(waConn.metadata.availableWabaPhones?.length).toBe(2);

    // 1-Click Post-Login Switch: Switch Facebook Page to Pune Branch (page_102)
    const switchedFb = await selectMetaChannelAsset({
      workspaceId: reg.workspaceId,
      actorId: reg.userId,
      connectionId: fbConn.id,
      assetId: "page_102",
    });
    expect(switchedFb.externalAccountId).toBe("page_102");
    expect(switchedFb.displayName).toBe("Radiant Pune Branch");
    expect(subscribedTargets.some((u) => u.includes("/page_102/subscribed_apps"))).toBe(true);

    // 1-Click Post-Login Switch: Switch Pixel on act_301 from px_401 -> px_402
    await selectMetaChannelAsset({
      workspaceId: reg.workspaceId,
      actorId: reg.userId,
      connectionId: adsConn.id,
      assetId: "act_301",
      secondaryPixelId: "px_402",
    });

    // 1-Click Post-Login Switch: Switch WhatsApp Number to ph_601
    const switchedWa = await selectMetaChannelAsset({
      workspaceId: reg.workspaceId,
      actorId: reg.userId,
      connectionId: waConn.id,
      assetId: "ph_601",
    });
    expect(switchedWa.externalAccountId).toBe("ph_601");
    expect(switchedWa.displayName).toBe("Radiant Billing Desk");

    // Refresh assets without re-login
    const refreshed = await refreshMetaChannelAssets({
      workspaceId: reg.workspaceId,
      actorId: reg.userId,
      connectionId: waConn.id,
    });
    expect(refreshed.discoveredCount).toBe(2);

    const updatedList = listWorkspaceConnections(reg.workspaceId);
    const updatedAds = updatedList.connections.find((c) => c.id === adsConn.id)!;
    expect(updatedAds.metadata.pixelId).toBe("px_402");
  });

  it("completes 1-Click Google Suite OAuth (purpose = google_all) across all 5 Google channels and switches Search Console sites", async () => {
    const { reg } = createTestOwnerSession("GoogleAllOneClick");

    savePlatformGoogleOAuthConfig({
      enabled: true,
      clientId: "1234567890-phase33.apps.googleusercontent.com",
      clientSecret: "GOCSPX-phase33_secret_value",
      consentAppName: "RapidShift Labs",
      publishingStatus: "production",
      enableDriveOAuth: true,
      enableGbpOAuth: true,
      enableGoogleAdsOAuth: true,
      defaultDriveFolderName: "RapidShift Backups",
      staffId: "staff_phase33",
    });
    savePlatformGoogleAdsConfig({
      enabled: true,
      developerToken: "gads_dev_tok_phase33",
      staffId: "staff_phase33",
    });

    const googleAuthUrl = buildGoogleOAuthAuthorizeUrl({
      redirectUri: "http://localhost:4500/api/oauth/google/callback",
      state: "state_google_all_33",
      purpose: "google_all",
    });
    expect(googleAuthUrl).toContain("drive.file");
    expect(googleAuthUrl).toContain("spreadsheets");
    expect(googleAuthUrl).toContain("webmasters.readonly");
    expect(googleAuthUrl).toContain("business.manage");
    expect(googleAuthUrl).toContain("adwords");

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({
            access_token: "ya29.google_all_phase33_access",
            refresh_token: "1//google_all_phase33_refresh",
            expires_in: 3600,
            scope:
              "openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/business.manage https://www.googleapis.com/auth/adwords",
          }),
          { status: 200 }
        );
      }
      if (url.includes("openidconnect.googleapis.com/v1/userinfo")) {
        return new Response(
          JSON.stringify({
            email: "founder@radiantindustrial.in",
            name: "Radiant Founder",
            sub: "google_sub_phase33",
          }),
          { status: 200 }
        );
      }
      if (url.includes("googleapis.com/drive/v3/files")) {
        return new Response(
          JSON.stringify({
            files: [
              {
                id: "drive_folder_33",
                name: "RapidShift Backups",
                webViewLink: "https://drive.google.com/drive/folders/drive_folder_33",
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("googleapis.com/webmasters/v3/sites")) {
        return new Response(
          JSON.stringify({
            siteEntry: [
              { siteUrl: "https://radiantindustrial.in/", permissionLevel: "siteOwner" },
              { siteUrl: "sc-domain:radiantgroup.co.in", permissionLevel: "siteOwner" },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("mybusinessaccountmanagement.googleapis.com/v1/accounts")) {
        return new Response(
          JSON.stringify({
            accounts: [
              {
                name: "accounts/777111",
                accountName: "Radiant Industrial",
                type: "PERSONAL",
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("mybusinessbusinessinformation.googleapis.com/v1/accounts/777111/locations")) {
        return new Response(
          JSON.stringify({
            locations: [
              {
                name: "locations/888222",
                title: "Radiant Industrial Company",
                storefrontAddress: {
                  addressLines: ["MIDC Andheri East"],
                  locality: "Mumbai",
                  postalCode: "400093",
                },
                metadata: { hasVoiceOfMerchant: true },
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("customers:listAccessibleCustomers")) {
        return new Response(
          JSON.stringify({ resourceNames: ["customers/5556667770"] }),
          { status: 200 }
        );
      }
      if (url.includes("googleAds:search")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                customer: {
                  id: "5556667770",
                  descriptiveName: "Radiant Search Ads",
                  currencyCode: "INR",
                  timeZone: "Asia/Kolkata",
                  manager: false,
                },
              },
            ],
          }),
          { status: 200 }
        );
      }

      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    const allRes = await completeGoogleOAuthConnection({
      workspaceId: reg.workspaceId,
      actorId: reg.userId,
      code: "google_code_all_33",
      redirectUri: "http://localhost:4500/api/oauth/google/callback",
      purpose: "google_all",
    });

    expect(allRes.connectedLabels?.length).toBe(5);
    expect(allRes.summaryMessage).toContain("Connected 5 Google channel(s)");

    const listed = listWorkspaceConnections(reg.workspaceId);
    const kinds = new Set(listed.connections.map((c) => c.channelKind));
    expect(kinds.has("google_drive")).toBe(true);
    expect(kinds.has("google_sheets")).toBe(true);
    expect(kinds.has("google_search_console")).toBe(true);
    expect(kinds.has("google_business")).toBe(true);
    expect(kinds.has("google_ads")).toBe(true);

    const gscConn = listed.connections.find((c) => c.channelKind === "google_search_console")!;
    expect(gscConn.metadata.availableSearchConsoleSites).toEqual([
      "https://radiantindustrial.in/",
      "sc-domain:radiantgroup.co.in",
    ]);

    const switchedSite = selectGoogleSearchConsoleSite({
      workspaceId: reg.workspaceId,
      connectionId: gscConn.id,
      siteUrl: "sc-domain:radiantgroup.co.in",
    });
    expect(switchedSite.siteUrl).toBe("sc-domain:radiantgroup.co.in");
  });
});
