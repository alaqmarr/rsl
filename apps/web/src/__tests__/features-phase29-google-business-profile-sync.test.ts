import { afterEach, describe, expect, it, vi } from "vitest";
import { registerUserWithWorkspace, resolveUserSessionFromToken } from "@rsl/auth";
import { staffGrantFreeAllToolsAccess } from "@rsl/billing";
import {
  completeGoogleOAuthConnection,
  discoverAndHydrateGoogleBusinessProfile,
  listWorkspaceConnections,
  selectGoogleBusinessLocation,
  verifyExternalConnectionHealth,
} from "@rsl/connections";
import { encryptEnvelope, newId } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import {
  listGoogleReviews,
  replyToGoogleReview,
  syncGoogleBusinessReviewsForWorkspace,
} from "@rsl/google";
import {
  clearPlatformCredentialOverride,
  controlDb,
  savePlatformGoogleOAuthConfig,
} from "@rsl/tenancy";

function createTestWorkspace(tag: string, businessName: string) {
  const email = `${tag.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 10000)}@rapidshiftlabs.in`;
  const reg = registerUserWithWorkspace({
    name: "Al Aqmar",
    email,
    password: "StrongPassword123!",
    businessName,
    industry: "Industrial Equipment Supplier",
    stateCode: "27",
  });
  staffGrantFreeAllToolsAccess({
    workspaceId: reg.workspaceId,
    durationDays: 30,
    staffId: "stf_test_p29",
    note: "Phase 29 GBP test entitlement",
  });
  const session = resolveUserSessionFromToken(reg.rawSessionToken)!;
  return { email, reg, session };
}

describe("Phase 29 — Live Google Business Profile Discovery, Business Details Hydration, Two-Way Reviews Sync & Live Reply Publishing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearPlatformCredentialOverride("google_oauth");
  });

  it("discovers storefronts inside non-first LOCATION_GROUP accounts, stores full business profile metadata, syncs live v4 reviews, and publishes owner replies via PUT .../reply", async () => {
    const { session } = createTestWorkspace("p29gbp1", "RADIANT INDUSTRIAL COMPANY");

    savePlatformGoogleOAuthConfig({
      enabled: true,
      oauthJsonRaw: JSON.stringify({
        web: {
          client_id: "5544332211-rslgbp.apps.googleusercontent.com",
          project_id: "rapidshift-labs-prod",
          client_secret: "GOCSPX-TestSecretP29",
        },
      }),
      consentAppName: "RapidShift Labs",
      publishingStatus: "production",
      defaultDriveFolderName: "RapidShift Labs Backups",
      enableDriveOAuth: true,
      enableGbpOAuth: true,
      staffId: "stf_test_p29",
    });

    const putReplyCalls: Array<{ url: string; body: string }> = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method || "GET").toUpperCase();

      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({
            access_token: "ya29.a0LiveGbpAccessTokenRadiant9988",
            refresh_token: "1//0gLiveRefreshTokenRadiant9988",
            expires_in: 3600,
            scope: "openid email profile https://www.googleapis.com/auth/business.manage",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.startsWith("https://openidconnect.googleapis.com/v1/userinfo")) {
        return new Response(
          JSON.stringify({
            email: "info@radiantindustrial.in",
            name: "AL AQMAR",
            sub: "116265574937662666329",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // First account is PERSONAL with 0 locations; second account is LOCATION_GROUP with 2 locations!
      if (url.startsWith("https://mybusinessaccountmanagement.googleapis.com/v1/accounts")) {
        return new Response(
          JSON.stringify({
            accounts: [
              {
                name: "accounts/10001111",
                accountName: "AL AQMAR",
                type: "PERSONAL",
              },
              {
                name: "accounts/20002222",
                accountName: "Radiant Industrial Group",
                type: "LOCATION_GROUP",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (
        url.startsWith(
          "https://mybusinessbusinessinformation.googleapis.com/v1/accounts/-/locations"
        )
      ) {
        return new Response(JSON.stringify({ locations: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (
        url.startsWith(
          "https://mybusinessbusinessinformation.googleapis.com/v1/accounts/10001111/locations"
        )
      ) {
        return new Response(JSON.stringify({ locations: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (
        url.startsWith(
          "https://mybusinessbusinessinformation.googleapis.com/v1/accounts/20002222/locations"
        )
      ) {
        return new Response(
          JSON.stringify({
            locations: [
              {
                name: "locations/9876543210123456",
                title: "RADIANT INDUSTRIAL COMPANY",
                storeCode: "RAD-MUM-01",
                websiteUri: "https://radiantindustrial.in",
                phoneNumbers: { primaryPhone: "+91 98200 55443" },
                categories: {
                  primaryCategory: { displayName: "Industrial Equipment Supplier" },
                },
                storefrontAddress: {
                  addressLines: ["Plot 14, Nagdevi Cross Lane"],
                  locality: "Mumbai",
                  administrativeArea: "Maharashtra",
                  postalCode: "400003",
                },
                metadata: {
                  mapsUri: "https://maps.google.com/?cid=9876543210123456",
                  newReviewUri: "https://search.google.com/local/writereview?placeid=ChIJTestRadiant",
                  placeId: "ChIJTestRadiant",
                  hasVoiceOfMerchant: true,
                },
              },
              {
                name: "locations/9876543210999999",
                title: "RADIANT INDUSTRIAL — PUNE WAREHOUSE",
                storeCode: "RAD-PUN-02",
                phoneNumbers: { primaryPhone: "+91 98200 55444" },
                storefrontAddress: {
                  addressLines: ["Bhosari MIDC Sector 7"],
                  locality: "Pune",
                  administrativeArea: "Maharashtra",
                  postalCode: "411026",
                },
                metadata: {
                  hasVoiceOfMerchant: true,
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (
        method === "GET" &&
        url.startsWith(
          "https://mybusiness.googleapis.com/v4/accounts/20002222/locations/9876543210123456/reviews"
        )
      ) {
        return new Response(
          JSON.stringify({
            averageRating: 4.7,
            totalReviewCount: 3,
            reviews: [
              {
                name: "accounts/20002222/locations/9876543210123456/reviews/rev_live_001",
                reviewId: "rev_live_001",
                reviewer: { displayName: "Vikram Kulkarni" },
                starRating: "FIVE",
                comment: "Prompt industrial valve dispatch and genuine GST billing.",
                createTime: "2026-11-02T10:15:00Z",
                updateTime: "2026-11-02T10:15:00Z",
              },
              {
                name: "accounts/20002222/locations/9876543210123456/reviews/rev_live_002",
                reviewId: "rev_live_002",
                reviewer: { displayName: "Mehta Engineering Works" },
                starRating: "FIVE",
                // Rating-only review without written text
                createTime: "2026-11-01T08:00:00Z",
              },
              {
                name: "accounts/20002222/locations/9876543210123456/reviews/rev_live_003",
                reviewId: "rev_live_003",
                reviewer: { displayName: "Sanjay Traders" },
                starRating: "FOUR",
                comment: "Good stock availability.",
                createTime: "2026-10-29T12:00:00Z",
                reviewReply: {
                  comment: "Thank you Sanjay Ji for your continued business!",
                  updateTime: "2026-10-30T09:00:00Z",
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (
        method === "GET" &&
        url.startsWith(
          "https://mybusiness.googleapis.com/v4/accounts/20002222/locations/9876543210999999/reviews"
        )
      ) {
        return new Response(
          JSON.stringify({
            averageRating: 5.0,
            totalReviewCount: 1,
            reviews: [
              {
                name: "accounts/20002222/locations/9876543210999999/reviews/rev_pune_001",
                reviewId: "rev_pune_001",
                reviewer: { displayName: "Pune Auto Ancillaries" },
                starRating: "FIVE",
                comment: "Fast pickup at Bhosari warehouse.",
                createTime: "2026-11-03T11:00:00Z",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (
        method === "PUT" &&
        url ===
          "https://mybusiness.googleapis.com/v4/accounts/20002222/locations/9876543210123456/reviews/rev_live_001/reply"
      ) {
        putReplyCalls.push({ url, body: String(init?.body || "") });
        return new Response(
          JSON.stringify({
            comment: JSON.parse(String(init?.body || "{}")).comment,
            updateTime: new Date().toISOString(),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({}), { status: 404 });
    });

    const oauthOut = await completeGoogleOAuthConnection({
      workspaceId: session.workspace.id,
      actorId: session.user.id,
      code: "4/0AeanS0TestAuthCodeRadiant",
      redirectUri: "https://app.rapidshiftlabs.in/api/oauth/google/callback",
      purpose: "google_business",
    });

    expect(oauthOut.storeName).toBe("RADIANT INDUSTRIAL COMPANY");
    expect(oauthOut.displayName).toBe("RADIANT INDUSTRIAL COMPANY");
    expect(oauthOut.locationId).toBe("locations/9876543210123456");
    expect(oauthOut.gbpDiscoveryStatus).toBe("verified_locations");

    const listed = listWorkspaceConnections(session.workspace.id);
    const gbpConn = listed.connections.find((c) => c.channelKind === "google_business")!;
    expect(gbpConn.displayName).toBe("RADIANT INDUSTRIAL COMPANY");
    // Must NEVER store the 21-digit OAuth `sub` ID `116265574937662666329` as Primary ID!
    expect(gbpConn.externalAccountId).toBe("locations/9876543210123456");
    expect(gbpConn.metadata.accountId).toBe("accounts/20002222");
    expect(gbpConn.metadata.primaryCategory).toBe("Industrial Equipment Supplier");
    expect(gbpConn.metadata.storePhone).toBe("+91 98200 55443");
    expect(gbpConn.metadata.storeAddress).toContain("Plot 14, Nagdevi Cross Lane");
    expect(gbpConn.metadata.websiteUri).toBe("https://radiantindustrial.in");
    expect(gbpConn.metadata.newReviewUri).toContain("ChIJTestRadiant");
    expect(gbpConn.metadata.availableLocations).toHaveLength(2);
    expect(gbpConn.assets).toHaveLength(2);

    // Sync live reviews from Google My Business v4
    const syncRes = await syncGoogleBusinessReviewsForWorkspace({
      workspaceId: session.workspace.id,
      connectionId: gbpConn.id,
    });
    expect(syncRes.ok).toBe(true);
    expect(syncRes.syncedCount).toBe(3);
    expect(syncRes.newCount).toBe(3);

    const reviews = listGoogleReviews(session.workspace.id);
    expect(reviews).toHaveLength(3);

    const vikramRev = reviews.find((r) => r.reviewerName === "Vikram Kulkarni")!;
    expect(vikramRev.rating).toBe(5);
    expect(vikramRev.replyStatus).toBe("unreplied");
    expect(vikramRev.locationName).toBe("RADIANT INDUSTRIAL COMPANY");

    const ratingOnlyRev = reviews.find((r) => r.reviewerName === "Mehta Engineering Works")!;
    expect(ratingOnlyRev.rating).toBe(5);
    expect(ratingOnlyRev.comment).toContain("without written comment");

    const alreadyRepliedRev = reviews.find((r) => r.reviewerName === "Sanjay Traders")!;
    expect(alreadyRepliedRev.replyStatus).toBe("replied");
    expect(alreadyRepliedRev.publishedReplyText).toBe(
      "Thank you Sanjay Ji for your continued business!"
    );

    // Re-syncing must be idempotent (0 duplicates)
    const secondSync = await syncGoogleBusinessReviewsForWorkspace({
      workspaceId: session.workspace.id,
      connectionId: gbpConn.id,
    });
    expect(secondSync.newCount).toBe(0);
    expect(secondSync.updatedCount).toBe(3);
    expect(listGoogleReviews(session.workspace.id)).toHaveLength(3);

    // Publish owner reply live to Google Maps via PUT .../reply
    const replyRes = await replyToGoogleReview(session.ctx, {
      reviewId: vikramRev.id,
      replyText: "Thank you Vikram Ji! Glad the valves reached your plant on schedule.",
    });
    expect(replyRes.ok).toBe(true);
    if (replyRes.ok) {
      expect(replyRes.data.publishedToGoogleLive).toBe(true);
    }
    expect(putReplyCalls).toHaveLength(1);
    expect(JSON.parse(putReplyCalls[0]!.body).comment).toContain("Thank you Vikram Ji!");

    // Switch active branch to Pune Warehouse and verify location switcher updates metadata
    const switched = await selectGoogleBusinessLocation(session.ctx, {
      connectionId: gbpConn.id,
      locationId: "locations/9876543210999999",
    });
    expect(switched.ok).toBe(true);
    if (switched.ok) {
      expect(switched.data.storeName).toBe("RADIANT INDUSTRIAL — PUNE WAREHOUSE");
    }
  });

  it("upgrades existing legacy connected rows (OAuth sub 116265574937662666329 / generic label) in-place on Test Live API and surfaces clear 429/403 Google Cloud diagnostics", async () => {
    const { session } = createTestWorkspace("p29legacy", "RADIANT INDUSTRIAL COMPANY");

    const now = Date.now();
    const legacyConnId = newId();
    controlDb()
      .insert(controlSchema.connections)
      .values({
        id: legacyConnId,
        workspaceId: session.workspace.id,
        provider: "google",
        displayName: "Google Business (info@radiantindustrial.in)",
        externalAccountId: "116265574937662666329",
        encryptedTokens: encryptEnvelope(
          JSON.stringify({
            accessToken: "ya29.a0LegacyTokenRadiant1234",
            refreshToken: "1//0gLegacyRefreshRadiant1234",
            issuedAt: now,
          })
        ),
        scopesGrantedJson: JSON.stringify(["https://www.googleapis.com/auth/business.manage"]),
        metadataJson: JSON.stringify({
          channelKind: "google_business",
          driveEmail: "info@radiantindustrial.in",
          googleUserName: "AL AQMAR",
          oauthConnected: true,
          tokenMode: "live",
        }),
        status: "healthy",
        lastHealthCheckAt: now,
        expiresAt: now + 3_600_000,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // Case A: Google Cloud has GBP API at 0 QPM pending quota approval (HTTP 429)
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
        return new Response(JSON.stringify({ email: "info@radiantindustrial.in" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("mybusiness")) {
        return new Response(
          JSON.stringify({
            error: {
              code: 429,
              status: "RESOURCE_EXHAUSTED",
              message:
                "Quota exceeded for quota metric 'Requests' and limit 'Requests per minute' of service 'mybusinessaccountmanagement.googleapis.com'.",
            },
          }),
          { status: 429, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    const healthCheck = await verifyExternalConnectionHealth(session.ctx, {
      connectionId: legacyConnId,
      checkLiveProvider: true,
    });
    expect(healthCheck.ok).toBe(true);
    if (healthCheck.ok) {
      expect(healthCheck.data.displayName).toBe("RADIANT INDUSTRIAL COMPANY");
      expect(healthCheck.data.liveMessage).toContain("0 QPM quota");
    }

    let updatedConn = listWorkspaceConnections(session.workspace.id).connections[0]!;
    expect(updatedConn.displayName).toBe("RADIANT INDUSTRIAL COMPANY");
    // Numeric OAuth sub `116265574937662666329` must be replaced cleanly!
    expect(updatedConn.externalAccountId).toBe("info@radiantindustrial.in");
    expect(updatedConn.metadata.gbpDiscoveryStatus).toBe("quota_pending");

    // Case B: Once Google Cloud enables GBP APIs & quota, re-running discovery upgrades straight to verified storefront!
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith("https://mybusinessaccountmanagement.googleapis.com/v1/accounts")) {
        return new Response(
          JSON.stringify({
            accounts: [{ name: "accounts/777888", accountName: "Radiant Industrial", type: "PERSONAL" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.startsWith("https://mybusinessbusinessinformation.googleapis.com/v1/")) {
        return new Response(
          JSON.stringify({
            locations: [
              {
                name: "locations/555666777",
                title: "RADIANT INDUSTRIAL COMPANY",
                phoneNumbers: { primaryPhone: "+91 22 2342 8899" },
                storefrontAddress: {
                  addressLines: ["Nagdevi Street"],
                  locality: "Mumbai",
                  postalCode: "400003",
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    const hydrated = await discoverAndHydrateGoogleBusinessProfile({
      workspaceId: session.workspace.id,
      connectionId: legacyConnId,
    });
    expect(hydrated.gbpDiscoveryStatus).toBe("verified_locations");
    expect(hydrated.locationId).toBe("locations/555666777");
    expect(hydrated.storeName).toBe("RADIANT INDUSTRIAL COMPANY");

    updatedConn = listWorkspaceConnections(session.workspace.id).connections[0]!;
    expect(updatedConn.externalAccountId).toBe("locations/555666777");
    expect(updatedConn.metadata.storePhone).toBe("+91 22 2342 8899");
  });
});
