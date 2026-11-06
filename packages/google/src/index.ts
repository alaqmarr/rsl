import { desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { dispatchWorkspaceWebhookEvent } from "@rsl/api-keys";
import { canDebitWalletUsage, consumeUsage, getWalletBalancePaise } from "@rsl/billing";
import {
  discoverAndHydrateGoogleBusinessProfile,
  listWorkspaceConnections,
  refreshGoogleConnectionIfNeeded,
  updateGoogleBusinessReviewSyncMetadata,
  type GoogleBusinessDiscoveryStatus,
} from "@rsl/connections";
import { newId, RslError } from "@rsl/core";
import { controlSchema, tenantDataSchema } from "@rsl/database";
import { defineAction } from "@rsl/logging";
import { controlDb, tenantDataDb } from "@rsl/tenancy";

export function listGoogleReviews(workspaceId: string) {
  return tenantDataDb({ workspaceId })
    .select()
    .from(tenantDataSchema.reviews)
    .orderBy(desc(tenantDataSchema.reviews.reviewedAt))
    .limit(200)
    .all();
}

interface RawGoogleV4Review {
  name?: string;
  reviewId?: string;
  reviewer?: {
    displayName?: string;
    profilePhotoUrl?: string;
    isAnonymous?: boolean;
  };
  starRating?: "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE" | string | number;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: {
    comment?: string;
    updateTime?: string;
  };
}

function parseGoogleStarRating(raw: RawGoogleV4Review["starRating"]): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.min(5, Math.max(1, Math.round(raw)));
  }
  const normalized = String(raw || "")
    .trim()
    .toUpperCase();
  switch (normalized) {
    case "FIVE":
    case "5":
      return 5;
    case "FOUR":
    case "4":
      return 4;
    case "THREE":
    case "3":
      return 3;
    case "TWO":
    case "2":
      return 2;
    case "ONE":
    case "1":
      return 1;
    default:
      return 5;
  }
}

function parseIsoTimestampSafe(iso: string | undefined, fallback: number): number {
  if (!iso) return fallback;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface GoogleReviewsSyncResult {
  ok: boolean;
  connected: boolean;
  storeName?: string;
  locationId?: string;
  discoveryStatus?: GoogleBusinessDiscoveryStatus;
  syncedCount: number;
  newCount: number;
  updatedCount: number;
  totalReviewsCount: number;
  averageRating?: number;
  message: string;
}

export async function syncGoogleBusinessReviewsForWorkspace(params: {
  workspaceId: string;
  connectionId?: string;
  forceDiscovery?: boolean;
}): Promise<GoogleReviewsSyncResult> {
  const { connections } = listWorkspaceConnections(params.workspaceId);
  const gbpConn = params.connectionId
    ? connections.find((c) => c.id === params.connectionId)
    : connections.find((c) => c.channelKind === "google_business" || c.provider === "google");

  if (!gbpConn) {
    return {
      ok: false,
      connected: false,
      syncedCount: 0,
      newCount: 0,
      updatedCount: 0,
      totalReviewsCount: 0,
      message:
        "Google Business Profile is not connected yet. Click 'Connect Google Business Profile' under Connected Channels first.",
    };
  }

  const accessToken = await refreshGoogleConnectionIfNeeded(params.workspaceId, gbpConn.id);
  if (!accessToken) {
    return {
      ok: false,
      connected: true,
      discoveryStatus: "token_error",
      syncedCount: 0,
      newCount: 0,
      updatedCount: 0,
      totalReviewsCount: 0,
      message:
        "Google OAuth token expired or was revoked. Click 'Reconnect Google' to re-authorize your Google Business Profile.",
    };
  }

  const needsDiscovery =
    Boolean(params.forceDiscovery) ||
    !gbpConn.metadata.locationId ||
    !gbpConn.metadata.lastGbpDiscoveredAt;

  const profile = needsDiscovery
    ? await discoverAndHydrateGoogleBusinessProfile({
        workspaceId: params.workspaceId,
        connectionId: gbpConn.id,
        accessToken,
        preferredLocationId: gbpConn.metadata.locationId,
      })
    : {
        connected: true,
        connectionId: gbpConn.id,
        displayName: gbpConn.displayName,
        storeName: gbpConn.metadata.storeName,
        accountId: gbpConn.metadata.accountId,
        locationId: gbpConn.metadata.locationId,
        gbpDiscoveryStatus: gbpConn.metadata.gbpDiscoveryStatus ?? "verified_locations",
        gbpDiscoveryDetail: gbpConn.metadata.gbpDiscoveryDetail,
      };

  const ws = controlDb()
    .select({ name: controlSchema.workspaces.name })
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, params.workspaceId))
    .get();

  const resolvedLocationName = profile.storeName || ws?.name || gbpConn.displayName;

  // Sandbox mode returns local counts cleanly without outbound HTTP
  if (/^(rsl_sandbox_|sandbox_|test_)/i.test(accessToken)) {
    const existingRows = listGoogleReviews(params.workspaceId);
    updateGoogleBusinessReviewSyncMetadata({
      workspaceId: params.workspaceId,
      connectionId: gbpConn.id,
      totalReviewsCount: existingRows.length,
    });
    return {
      ok: true,
      connected: true,
      storeName: resolvedLocationName,
      locationId: profile.locationId,
      discoveryStatus: "verified_locations",
      syncedCount: existingRows.length,
      newCount: 0,
      updatedCount: 0,
      totalReviewsCount: existingRows.length,
      message: `Sandbox Google Business Profile verified (${existingRows.length} local reviews).`,
    };
  }

  if (!profile.locationId) {
    return {
      ok: false,
      connected: true,
      storeName: resolvedLocationName,
      discoveryStatus: profile.gbpDiscoveryStatus,
      syncedCount: 0,
      newCount: 0,
      updatedCount: 0,
      totalReviewsCount: 0,
      message:
        profile.gbpDiscoveryDetail ||
        "Connected to Google, but no verified Google Business Profile storefront location was returned yet.",
    };
  }

  const normalizedLoc = profile.locationId.startsWith("locations/")
    ? profile.locationId
    : `locations/${profile.locationId}`;
  const candidateParents: string[] = [];
  if (profile.accountId) {
    const normalizedAcc = profile.accountId.startsWith("accounts/")
      ? profile.accountId
      : `accounts/${profile.accountId}`;
    candidateParents.push(`${normalizedAcc}/${normalizedLoc}`);
  }
  candidateParents.push(`accounts/-/${normalizedLoc}`);

  let fetchedReviews: RawGoogleV4Review[] = [];
  let apiTotalReviewCount: number | undefined;
  let apiAverageRating: number | undefined;
  let reviewsFetchSucceeded = false;
  let lastHttpError = "";

  for (const parentPath of candidateParents) {
    try {
      let pageToken = "";
      const collected: RawGoogleV4Review[] = [];
      let pageOk = false;

      for (let page = 0; page < 4; page++) {
        const url = new URL(`https://mybusiness.googleapis.com/v4/${parentPath}/reviews`);
        url.searchParams.set("pageSize", "50");
        if (pageToken) {
          url.searchParams.set("pageToken", pageToken);
        }

        const resp = await fetch(url.toString(), {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(8000),
        });
        const bodyTxt = await resp.text().catch(() => "");

        if (!resp.ok) {
          lastHttpError = `HTTP ${resp.status}${bodyTxt ? `: ${bodyTxt.slice(0, 220)}` : ""}`;
          break;
        }

        pageOk = true;
        const parsed = JSON.parse(bodyTxt || "{}") as {
          reviews?: RawGoogleV4Review[];
          totalReviewCount?: number;
          averageRating?: number;
          nextPageToken?: string;
        };
        if (Array.isArray(parsed.reviews)) {
          collected.push(...parsed.reviews);
        }
        if (typeof parsed.totalReviewCount === "number") {
          apiTotalReviewCount = parsed.totalReviewCount;
        }
        if (typeof parsed.averageRating === "number") {
          apiAverageRating = parsed.averageRating;
        }
        if (parsed.nextPageToken) {
          pageToken = parsed.nextPageToken;
        } else {
          break;
        }
      }

      if (pageOk) {
        fetchedReviews = collected;
        reviewsFetchSucceeded = true;
        break;
      }
    } catch (err) {
      lastHttpError = err instanceof Error ? err.message : String(err);
    }
  }

  if (!reviewsFetchSucceeded) {
    const lowerErr = lastHttpError.toLowerCase();
    const friendlyDiag =
      lowerErr.includes("has not been used in project") ||
      lowerErr.includes("service_disabled") ||
      lowerErr.includes("accessnotconfigured")
        ? `Business location '${resolvedLocationName}' is connected, but 'Google My Business API' (mybusiness.googleapis.com v4) is not enabled yet in Google Cloud Console. Enable it to pull live customer reviews.`
        : lowerErr.includes("429") ||
            lowerErr.includes("quota") ||
            lowerErr.includes("resource_exhausted")
          ? `Business location '${resolvedLocationName}' is connected, and GBP API quota approval is pending on Google Cloud (0 QPM). Reviews will sync automatically once Google enables quota.`
          : `Could not fetch Google reviews for '${resolvedLocationName}' (${lastHttpError || "Google My Business v4 endpoint unreachable"}).`;

    updateGoogleBusinessReviewSyncMetadata({
      workspaceId: params.workspaceId,
      connectionId: gbpConn.id,
      totalReviewsCount: listGoogleReviews(params.workspaceId).length,
      syncDiagnosticNote: friendlyDiag,
    });

    return {
      ok: false,
      connected: true,
      storeName: resolvedLocationName,
      locationId: profile.locationId,
      discoveryStatus: profile.gbpDiscoveryStatus,
      syncedCount: 0,
      newCount: 0,
      updatedCount: 0,
      totalReviewsCount: listGoogleReviews(params.workspaceId).length,
      message: friendlyDiag,
    };
  }

  const db = tenantDataDb({ workspaceId: params.workspaceId });
  const now = Date.now();
  let newCount = 0;
  let updatedCount = 0;

  for (const raw of fetchedReviews) {
    const canonicalExtId = (raw.name || raw.reviewId || "").trim();
    if (!canonicalExtId) continue;
    const shortId = (raw.reviewId || canonicalExtId.split("/").pop() || "").trim();

    const existing = db
      .select()
      .from(tenantDataSchema.reviews)
      .where(
        shortId && shortId !== canonicalExtId
          ? or(
              eq(tenantDataSchema.reviews.externalReviewId, canonicalExtId),
              eq(tenantDataSchema.reviews.externalReviewId, shortId)
            )
          : eq(tenantDataSchema.reviews.externalReviewId, canonicalExtId)
      )
      .get();

    const rating = parseGoogleStarRating(raw.starRating);
    const reviewerName = raw.reviewer?.displayName?.trim() || "Google Maps Customer";
    const comment =
      raw.comment?.trim() || "(Star rating left on Google Maps without written comment)";
    const reviewedAt = parseIsoTimestampSafe(raw.updateTime || raw.createTime, now);
    const googleReplyText = raw.reviewReply?.comment?.trim() || undefined;
    const googleRepliedAt = googleReplyText
      ? parseIsoTimestampSafe(raw.reviewReply?.updateTime, now)
      : undefined;

    if (existing) {
      const nextReplyStatus = googleReplyText
        ? "replied"
        : existing.replyStatus === "draft_ready"
          ? "draft_ready"
          : existing.replyStatus === "replied"
            ? "replied"
            : "unreplied";
      const nextPublishedReply = googleReplyText ?? existing.publishedReplyText;
      const nextRepliedAt = googleRepliedAt ?? existing.repliedAt;

      db.update(tenantDataSchema.reviews)
        .set({
          externalReviewId: canonicalExtId,
          locationName: resolvedLocationName,
          reviewerName,
          rating,
          comment,
          replyStatus: nextReplyStatus,
          publishedReplyText: nextPublishedReply,
          repliedAt: nextRepliedAt,
          reviewedAt,
        })
        .where(eq(tenantDataSchema.reviews.id, existing.id))
        .run();
      updatedCount += 1;
    } else {
      const id = newId();
      db.insert(tenantDataSchema.reviews)
        .values({
          id,
          externalReviewId: canonicalExtId,
          locationName: resolvedLocationName,
          reviewerName,
          rating,
          comment,
          replyStatus: googleReplyText ? "replied" : "unreplied",
          publishedReplyText: googleReplyText ?? null,
          repliedAt: googleRepliedAt ?? null,
          reviewedAt,
          createdAt: now,
        })
        .run();
      newCount += 1;

      void dispatchWorkspaceWebhookEvent(params.workspaceId, "review.created", {
        reviewId: id,
        externalReviewId: canonicalExtId,
        locationName: resolvedLocationName,
        reviewerName,
        rating,
        comment,
      }).catch(() => 0);
    }
  }

  const allLocalReviews = listGoogleReviews(params.workspaceId);
  const totalReviewsCount = apiTotalReviewCount ?? allLocalReviews.length;
  const computedAvg =
    apiAverageRating ??
    (allLocalReviews.length > 0
      ? allLocalReviews.reduce((acc, r) => acc + r.rating, 0) / allLocalReviews.length
      : undefined);

  updateGoogleBusinessReviewSyncMetadata({
    workspaceId: params.workspaceId,
    connectionId: gbpConn.id,
    totalReviewsCount,
    averageRating: computedAvg,
    syncedAt: now,
  });

  return {
    ok: true,
    connected: true,
    storeName: resolvedLocationName,
    locationId: profile.locationId,
    discoveryStatus: "verified_locations",
    syncedCount: fetchedReviews.length,
    newCount,
    updatedCount,
    totalReviewsCount,
    averageRating: computedAvg,
    message:
      fetchedReviews.length === 0
        ? `Connected to ${resolvedLocationName} — 0 customer reviews posted on Google Maps yet.`
        : `Synced ${fetchedReviews.length} Google review${fetchedReviews.length === 1 ? "" : "s"} for ${resolvedLocationName} (${newCount} new, ${updatedCount} updated).`,
  };
}

export const syncGoogleReviews = defineAction({
  key: "reviews.synced",
  permission: "reviews:view",
  input: z.object({
    connectionId: z.string().optional(),
    forceDiscovery: z.boolean().default(true),
  }),
  summarize: () => "Synced Google Business Profile details and live customer reviews",
  handler: async (ctx, input) => {
    return syncGoogleBusinessReviewsForWorkspace({
      workspaceId: ctx.workspaceId,
      connectionId: input.connectionId,
      forceDiscovery: input.forceDiscovery,
    });
  },
});

function buildSmartReplyDraftText(params: {
  reviewerName: string;
  locationName: string;
  rating: number;
  comment: string;
}): string {
  const firstName = params.reviewerName.trim().split(/\s+/)[0] || "Customer";
  const branch = params.locationName.trim() || "our store";
  const lower = params.comment.toLowerCase();

  const highlights: string[] = [];
  if (/(delivery|timely|fast|quick|on time)/.test(lower)) highlights.push("timely delivery");
  if (/(staff|team|service|polite|helpful|support)/.test(lower)) highlights.push("helpful service");
  if (/(quality|product|genuine|fresh|stock)/.test(lower)) highlights.push("product quality");
  if (/(price|pricing|rate|value|reasonable)/.test(lower)) highlights.push("fair pricing");

  if (params.rating >= 5) {
    const detail =
      highlights.length > 0
        ? ` We are especially glad you appreciated our ${highlights.slice(0, 2).join(" and ")}.`
        : "";
    return `Thank you so much for your 5-star review, ${firstName}!${detail} Everyone at ${branch} truly appreciates your support, and we look forward to serving you again soon.`;
  }

  if (params.rating === 4) {
    const detail =
      highlights.length > 0
        ? ` We are glad our ${highlights[0]} stood out during your visit.`
        : "";
    return `Thank you for your 4-star feedback, ${firstName}!${detail} We are always working to make every experience at ${branch} a full 5-star visit and hope to welcome you back soon.`;
  }

  if (params.rating === 3) {
    return `Thank you for sharing your honest feedback with ${branch}, ${firstName}. We want every customer experience to be smooth and reliable — please reach out to our team directly so we can understand what we could have done better for you.`;
  }

  return `Dear ${firstName}, thank you for bringing this to our attention, and please accept our sincere apologies that your experience with ${branch} fell short of expectations. Our manager would like to resolve this for you right away — please message or call our desk directly with your order or visit details so we can make things right.`;
}

export const recordGoogleReview = defineAction({
  key: "reviews.recorded",
  permission: "reviews:reply",
  input: z.object({
    locationName: z.string().min(2).max(120),
    reviewerName: z.string().min(1).max(120),
    rating: z.coerce.number().int().min(1).max(5),
    comment: z.string().min(1).max(2000),
  }),
  summarize: (input) => `Recorded ${input.rating}-star Google review for '${input.locationName}'`,
  handler: (ctx, input) => {
    const now = Date.now();
    const id = newId();
    tenantDataDb(ctx)
      .insert(tenantDataSchema.reviews)
      .values({
        id,
        externalReviewId: `gbp_${id}`,
        locationName: input.locationName.trim(),
        reviewerName: input.reviewerName.trim(),
        rating: input.rating,
        comment: input.comment.trim(),
        replyStatus: "unreplied",
        reviewedAt: now,
        createdAt: now,
      })
      .run();

    void dispatchWorkspaceWebhookEvent(ctx.workspaceId, "review.created", {
      reviewId: id,
      locationName: input.locationName.trim(),
      reviewerName: input.reviewerName.trim(),
      rating: input.rating,
      comment: input.comment.trim(),
    }).catch(() => 0);

    return { reviewId: id };
  },
});

export const generateSmartReviewDraft = defineAction({
  key: "reviews.draft_generated",
  permission: "reviews:reply",
  service: "google.autoreply",
  input: z.object({
    reviewId: z.string().min(10),
  }),
  summarize: () => "Prepared smart reply draft for Google Business review",
  handler: (ctx, input) => {
    const db = tenantDataDb(ctx);
    const review = db
      .select()
      .from(tenantDataSchema.reviews)
      .where(eq(tenantDataSchema.reviews.id, input.reviewId))
      .get();

    if (!review) {
      throw new RslError("RSL-VAL-1001", "Google review not found.");
    }
    if (review.replyStatus === "replied") {
      throw new RslError("RSL-VAL-1001", "This review already has a published owner reply.");
    }

    const unitCostPaise = 100; // ₹1.00 per smart draft
    const currentBalance = getWalletBalancePaise(ctx.workspaceId);
    if (!canDebitWalletUsage(currentBalance, unitCostPaise)) {
      throw new RslError(
        "RSL-BILL-1003",
        "Your prepaid wallet has reached the -₹200.00 overdraft limit. Recharge your wallet to prepare smart review reply drafts."
      );
    }

    const draftText = buildSmartReplyDraftText({
      reviewerName: review.reviewerName,
      locationName: review.locationName,
      rating: review.rating,
      comment: review.comment,
    });

    db.update(tenantDataSchema.reviews)
      .set({
        replyStatus: "draft_ready",
        publishedReplyText: draftText,
      })
      .where(eq(tenantDataSchema.reviews.id, review.id))
      .run();

    consumeUsage({
      workspaceId: ctx.workspaceId,
      serviceKey: "google.autoreply",
      quantity: 1,
      unitCostPaise,
      dedupeKey: `review_draft:${review.id}:${Math.floor(Date.now() / 3000)}`,
      description: `Smart reply draft for ${review.reviewerName} (${review.rating}★)`,
      actorId: ctx.actorId,
    });

    return { reviewId: review.id, draftText };
  },
});

export const replyToGoogleReview = defineAction({
  key: "reviews.replied",
  permission: "reviews:reply",
  input: z.object({
    reviewId: z.string().min(10),
    replyText: z.string().min(2).max(2000),
  }),
  summarize: () => "Published owner reply to Google Business review",
  handler: async (ctx, input) => {
    const db = tenantDataDb(ctx);
    const review = db
      .select()
      .from(tenantDataSchema.reviews)
      .where(eq(tenantDataSchema.reviews.id, input.reviewId))
      .get();

    if (!review) {
      throw new RslError("RSL-VAL-1001", "Google review not found.");
    }

    const cleanReply = input.replyText.trim();
    const isManualLocalReview = review.externalReviewId.startsWith("gbp_");
    let publishedToGoogleLive = false;

    if (!isManualLocalReview) {
      const { connections } = listWorkspaceConnections(ctx.workspaceId);
      const gbpConn = connections.find(
        (c) => c.channelKind === "google_business" || c.provider === "google"
      );

      if (gbpConn && gbpConn.metadata.tokenMode !== "sandbox") {
        const accessToken = await refreshGoogleConnectionIfNeeded(ctx.workspaceId, gbpConn.id);
        if (!accessToken) {
          throw new RslError(
            "RSL-VAL-1001",
            "Google OAuth session expired. Reconnect Google Business Profile under Connected Channels to publish live replies."
          );
        }

        if (!/^(rsl_sandbox_|sandbox_|test_)/i.test(accessToken)) {
          let reviewResourcePath = review.externalReviewId.trim();
          if (!reviewResourcePath.startsWith("accounts/")) {
            const locPart = gbpConn.metadata.locationId?.startsWith("locations/")
              ? gbpConn.metadata.locationId
              : gbpConn.metadata.locationId
                ? `locations/${gbpConn.metadata.locationId}`
                : "";
            const accPart = gbpConn.metadata.accountId?.startsWith("accounts/")
              ? gbpConn.metadata.accountId
              : gbpConn.metadata.accountId
                ? `accounts/${gbpConn.metadata.accountId}`
                : "accounts/-";
            if (!locPart) {
              throw new RslError(
                "RSL-VAL-1001",
                "Cannot publish live reply because no Google Business Location ID is active on this connection."
              );
            }
            reviewResourcePath = `${accPart}/${locPart}/reviews/${reviewResourcePath}`;
          }

          const putResp = await fetch(
            `https://mybusiness.googleapis.com/v4/${reviewResourcePath}/reply`,
            {
              method: "PUT",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ comment: cleanReply }),
              signal: AbortSignal.timeout(8000),
            }
          );

          if (!putResp.ok) {
            const errTxt = await putResp.text().catch(() => "");
            throw new RslError(
              "RSL-VAL-1001",
              `Google Business API rejected publishing this reply (HTTP ${putResp.status}${errTxt ? `: ${errTxt.slice(0, 180)}` : ""}).`
            );
          }

          publishedToGoogleLive = true;
        }
      }
    }

    db.update(tenantDataSchema.reviews)
      .set({
        replyStatus: "replied",
        publishedReplyText: cleanReply,
        repliedAt: Date.now(),
      })
      .where(eq(tenantDataSchema.reviews.id, input.reviewId))
      .run();

    return { replied: true, publishedToGoogleLive };
  },
});

export async function publishGoogleBusinessLocalPost(params: {
  workspaceId: string;
  summary: string;
  mediaUrl?: string;
  ctaType?: "LEARN_MORE" | "BOOK" | "ORDER" | "SHOP" | "SIGN_UP" | "CALL";
  ctaUrl?: string;
}): Promise<{
  ok: boolean;
  mode: "live" | "sandbox" | "disconnected";
  externalPostId?: string;
  externalPermalink?: string;
  error?: string;
}> {
  const { connections } = listWorkspaceConnections(params.workspaceId);
  const gbpConn = connections.find((c) => c.channelKind === "google_business");
  if (!gbpConn) {
    return {
      ok: false,
      mode: "disconnected",
      error: "Connect your Google Business Profile on Connected Channels first.",
    };
  }

  const accessToken = await refreshGoogleConnectionIfNeeded(params.workspaceId, gbpConn.id);
  if (!accessToken) {
    return {
      ok: false,
      mode: "live",
      error: "Google Business OAuth token expired or was revoked. Reconnect Google Business Profile.",
    };
  }

  if (/^(rsl_sandbox_|sandbox_|test_)/i.test(accessToken)) {
    const sbId = `accounts/sandbox/locations/sandbox/localPosts/${newId()}`;
    return {
      ok: true,
      mode: "sandbox",
      externalPostId: sbId,
      externalPermalink: `https://maps.google.com/?cid=sandbox_${Date.now()}`,
    };
  }

  let locationId = gbpConn.metadata.locationId || "";
  let accountId = gbpConn.metadata.accountId || "";

  if (!locationId) {
    const hydrated = await discoverAndHydrateGoogleBusinessProfile({
      workspaceId: params.workspaceId,
      connectionId: gbpConn.id,
      accessToken,
    });
    locationId = hydrated.locationId || "";
  }

  if (!locationId) {
    return {
      ok: false,
      mode: "live",
      error: "No Google Business Location ID is active on this connection. Select your Storefront Location on Connected Channels.",
    };
  }

  const locPart = locationId.startsWith("locations/") ? locationId : `locations/${locationId}`;
  const accPart = accountId
    ? accountId.startsWith("accounts/")
      ? accountId
      : `accounts/${accountId}`
    : "accounts/-";
  const parentPath = locationId.startsWith("accounts/") ? locationId : `${accPart}/${locPart}`;

  const payload: Record<string, unknown> = {
    languageCode: "en-IN",
    summary: params.summary.trim().slice(0, 1500),
    topicType: "STANDARD",
  };

  if (params.ctaUrl?.trim()) {
    const actionType = params.ctaType && params.ctaType !== "CALL" ? params.ctaType : "LEARN_MORE";
    payload.callToAction = {
      actionType,
      url: params.ctaUrl.trim(),
    };
  } else if (params.ctaType === "CALL") {
    payload.callToAction = { actionType: "CALL" };
  }

  if (params.mediaUrl?.trim()) {
    payload.media = [
      {
        mediaFormat: "PHOTO",
        sourceUrl: params.mediaUrl.trim(),
      },
    ];
  }

  try {
    const resp = await fetch(`https://mybusiness.googleapis.com/v4/${parentPath}/localPosts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    const body = (await resp.json().catch(() => ({}))) as {
      name?: string;
      searchUrl?: string;
      error?: { message?: string };
    };

    if (!resp.ok) {
      return {
        ok: false,
        mode: "live",
        error: `Google Business Local Post API error (HTTP ${resp.status}): ${body.error?.message || "Verify GBP API quota & storefront verification."}`,
      };
    }

    return {
      ok: true,
      mode: "live",
      externalPostId: body.name || `${parentPath}/localPosts/${Date.now()}`,
      externalPermalink: body.searchUrl || gbpConn.metadata.mapsUri,
    };
  } catch (err) {
    return {
      ok: false,
      mode: "live",
      error: err instanceof Error ? err.message : "Network error calling Google Business Local Posts API.",
    };
  }
}

export * from "./ads";
