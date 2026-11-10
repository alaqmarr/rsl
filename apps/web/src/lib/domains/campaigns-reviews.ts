import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { hasActiveEntitlement } from "@rsl/billing";
import {
  formatInr,
  resolveEndpointsFromHeaders,
  RslError,
  signPurposeHmac,
} from "@rsl/core";
import {
  createGoogleAdCampaign,
  generateSmartReviewDraft,
  recordGoogleReview,
  replyToGoogleReview,
  syncGoogleReviews,
} from "@rsl/google";
import {
  createAdCampaign,
  deleteScheduledPost,
  publishScheduledPost,
  recordCampaignDailySnapshot,
  recordWebsiteSalesEvent,
  scheduleSocialPost,
  syncAllWorkspaceAdCampaignsInsights,
  toggleCampaignStatus,
  updateCampaignBudget,
} from "@rsl/meta";
import { putWorkspaceObject } from "@rsl/storage";
import { generateSmartAdCopy } from "@rsl/tenancy";
import { requireWebSession } from "../session";
import {
  enforceFeaturePaidEntitlement,
  friendlyMessage,
  goWithError,
  goWithNotice,
} from "./shared";

const PUBLIC_MEDIA_TTL_MS = 72 * 60 * 60 * 1000;

async function resolveUploadedMediaFromFormData(params: {
  formData: FormData;
  workspaceId: string;
  actorId: string;
}): Promise<{
  mediaUrl?: string;
  mediaType: "none" | "image" | "video";
}> {
  const explicitUrl = String(params.formData.get("mediaUrl") || "").trim();
  const explicitType = String(params.formData.get("mediaType") || "").trim();
  const maybeFile = params.formData.get("mediaFile");

  if (maybeFile instanceof File && maybeFile.size > 0) {
    if (maybeFile.size > 25 * 1024 * 1024) {
      throw new RslError("RSL-VAL-1001", "Uploaded creative file must be 25 MB or smaller.");
    }
    const mime = (maybeFile.type || "image/jpeg").toLowerCase();
    const isVideo = mime.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(maybeFile.name);
    const bytes = Buffer.from(await maybeFile.arrayBuffer());
    const stored = await putWorkspaceObject({
      workspaceId: params.workspaceId,
      category: "media",
      fileName: maybeFile.name || (isVideo ? "creative.mp4" : "creative.jpg"),
      mimeType: mime,
      bytes,
      actorId: params.actorId,
    });
    const ep = resolveEndpointsFromHeaders(await headers());
    const exp = Date.now() + PUBLIC_MEDIA_TTL_MS;
    const sig = signPurposeHmac(
      "public-media-link:v1",
      `media:${params.workspaceId}:${stored.id}:${exp}`
    );
    return {
      mediaUrl: `${ep.effectiveAppBaseUrl}/api/media/${encodeURIComponent(params.workspaceId)}/${encodeURIComponent(stored.id)}?sig=${encodeURIComponent(sig)}&exp=${exp}`,
      mediaType: isVideo ? "video" : "image",
    };
  }

  if (explicitUrl) {
    const inferredVideo =
      explicitType === "video" || /\.(mp4|mov|webm)(\?|$)/i.test(explicitUrl);
    return {
      mediaUrl: explicitUrl,
      mediaType: inferredVideo ? "video" : "image",
    };
  }

  return { mediaType: "none" };
}

export async function createCampaignActionImpl(formData: FormData) {
  const session = await requireWebSession();
  const channelRaw = String(formData.get("channel") || "meta_ads").trim();
  const billingMode =
    String(formData.get("billingMode") || "direct_client") === "rsl_managed_vault"
      ? "rsl_managed_vault"
      : "direct_client";

  const requiredServiceKey = channelRaw === "google_ads" ? "google.ads" : "meta.ads";
  await enforceFeaturePaidEntitlement(session.workspace.id, requiredServiceKey, "/campaigns");

  let uploadedMedia: { mediaUrl?: string; mediaType: "none" | "image" | "video" };
  try {
    uploadedMedia = await resolveUploadedMediaFromFormData({
      formData,
      workspaceId: session.workspace.id,
      actorId: session.user.id,
    });
  } catch (err) {
    return goWithError(
      "/campaigns",
      err instanceof Error ? err.message : "Could not upload creative file."
    );
  }

  const targetLocationsRaw = String(formData.get("targetLocations") || "").trim();
  const targetLocations = targetLocationsRaw
    ? targetLocationsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : ["India"];

  const targetKeywordsRaw = String(formData.get("targetKeywords") || "").trim();
  const targetKeywords = targetKeywordsRaw
    ? targetKeywordsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const allowDraftWhenDisconnected = formData.get("allowDraftWhenDisconnected") === "on";
  const vaultAllocationRupees = Number(formData.get("vaultAllocationRupees") || 0);

  if (channelRaw === "google_ads") {
    const gObjectiveRaw = String(
      formData.get("googleObjective") || formData.get("objective") || "search_leads"
    );
    const googleObjective = (
      ["search_leads", "performance_max", "call_ads", "website_sales"].includes(gObjectiveRaw)
        ? gObjectiveRaw
        : "search_leads"
    ) as "search_leads" | "performance_max" | "call_ads" | "website_sales";

    const res = await createGoogleAdCampaign(session.ctx, {
      name: String(formData.get("name") || ""),
      objective: googleObjective,
      billingMode,
      dailyBudgetRupees: Number(formData.get("dailyBudgetRupees") || 0),
      vaultAllocationRupees: vaultAllocationRupees > 0 ? vaultAllocationRupees : undefined,
      headline: String(formData.get("headline") || "") || undefined,
      primaryText: String(formData.get("primaryText") || "") || undefined,
      callToAction: String(formData.get("callToAction") || "") || undefined,
      destinationUrl: String(formData.get("destinationUrl") || "") || undefined,
      whatsappPhoneE164: String(formData.get("whatsappPhoneE164") || "") || undefined,
      mediaUrl: uploadedMedia.mediaUrl,
      targetLocations,
      targetKeywords,
      startDateIso: String(
        formData.get("startDateIso") || new Date().toISOString().slice(0, 10)
      ),
      allowDraftWhenDisconnected,
    });
    if (!res.ok) return goWithError("/campaigns", res.error.message);
    return goWithNotice(
      "/campaigns",
      res.data.syncStatus === "local_draft"
        ? "Google Ads campaign saved as local draft - connect Google Ads on Connected Channels to push live."
        : "Google Ads campaign launched!"
    );
  }

  const mObjectiveRaw = String(formData.get("objective") || "messages");
  const metaObjective = (
    ["messages", "website_sales", "lead_generation", "awareness"].includes(mObjectiveRaw)
      ? mObjectiveRaw
      : "messages"
  ) as "messages" | "website_sales" | "lead_generation" | "awareness";

  const res = await createAdCampaign(session.ctx, {
    name: String(formData.get("name") || ""),
    channel: (["meta_ads", "instagram", "facebook"].includes(channelRaw)
      ? channelRaw
      : "meta_ads") as "meta_ads" | "instagram" | "facebook",
    objective: metaObjective,
    billingMode,
    dailyBudgetRupees: Number(formData.get("dailyBudgetRupees") || 0),
    vaultAllocationRupees: vaultAllocationRupees > 0 ? vaultAllocationRupees : undefined,
    headline: String(formData.get("headline") || "") || undefined,
    primaryText: String(formData.get("primaryText") || "") || undefined,
    callToAction: String(formData.get("callToAction") || "") || undefined,
    destinationUrl: String(formData.get("destinationUrl") || "") || undefined,
    whatsappPhoneE164: String(formData.get("whatsappPhoneE164") || "") || undefined,
    mediaUrl: uploadedMedia.mediaUrl,
    targetLocations,
    ageMin: Number(formData.get("ageMin") || 18),
    ageMax: Number(formData.get("ageMax") || 55),
    startDateIso: String(
      formData.get("startDateIso") || new Date().toISOString().slice(0, 10)
    ),
    allowDraftWhenDisconnected,
  });
  if (!res.ok) return goWithError("/campaigns", res.error.message);
  return goWithNotice(
    "/campaigns",
    res.data.syncStatus === "local_draft"
      ? "Meta campaign saved as local draft - connect your Meta Ad Account on Connected Channels to push live."
      : "Meta Ads campaign launched!"
  );
}

export async function toggleCampaignActionImpl(formData: FormData) {
  const session = await requireWebSession();
  const campaignId = String(formData.get("campaignId") || "");
  const channelHint = String(formData.get("channel") || "");
  const requiredKey = channelHint === "google_ads" ? "google.ads" : "meta.ads";
  if (
    !hasActiveEntitlement(session.workspace.id, "meta.ads") &&
    !hasActiveEntitlement(session.workspace.id, "google.ads")
  ) {
    await enforceFeaturePaidEntitlement(session.workspace.id, requiredKey, "/campaigns");
  }
  const statusRaw = String(formData.get("status") || "paused");
  const status = (
    ["active", "paused", "completed"].includes(statusRaw) ? statusRaw : "paused"
  ) as "active" | "paused" | "completed";
  const res = await toggleCampaignStatus(session.ctx, {
    campaignId,
    status,
  });
  if (!res.ok) return goWithError("/campaigns", res.error.message);
  const released = (res.data as { releasedPaise?: number }).releasedPaise ?? 0;
  return goWithNotice(
    "/campaigns",
    released > 0
      ? `Campaign completed and ${formatInr(released, { showDecimals: true })} unspent funds refunded to your Ad Spend Vault.`
      : "Updated campaign status."
  );
}

export async function updateCampaignBudgetActionImpl(formData: FormData) {
  const session = await requireWebSession();
  if (
    !hasActiveEntitlement(session.workspace.id, "meta.ads") &&
    !hasActiveEntitlement(session.workspace.id, "google.ads")
  ) {
    await enforceFeaturePaidEntitlement(session.workspace.id, "meta.ads", "/campaigns");
  }
  const extraVault = Number(formData.get("additionalVaultAllocationRupees") || 0);
  const res = await updateCampaignBudget(session.ctx, {
    campaignId: String(formData.get("campaignId") || ""),
    dailyBudgetRupees: Number(formData.get("dailyBudgetRupees") || 0),
    additionalVaultAllocationRupees: extraVault > 0 ? extraVault : undefined,
  });
  if (!res.ok) return goWithError("/campaigns", res.error.message);
  return goWithNotice("/campaigns", "Updated campaign budget.");
}

export async function syncLiveAdsInsightsActionImpl() {
  const session = await requireWebSession();
  if (
    !hasActiveEntitlement(session.workspace.id, "meta.ads") &&
    !hasActiveEntitlement(session.workspace.id, "google.ads")
  ) {
    await enforceFeaturePaidEntitlement(session.workspace.id, "meta.ads", "/campaigns");
  }
  const res = await syncAllWorkspaceAdCampaignsInsights(session.workspace.id);
  revalidatePath("/campaigns");
  revalidatePath("/analytics");
  return goWithNotice(
    "/campaigns",
    res.syncedCampaigns > 0
      ? `Synced live ad metrics for ${res.syncedCampaigns} campaign(s)${res.autoPausedVaultCampaigns > 0 ? ` (${res.autoPausedVaultCampaigns} auto-paused at Vault cap)` : ""}.`
      : "Checked Meta & Google Ads APIs - no new live campaign snapshots reported yet."
  );
}

export async function recordCampaignSnapshotActionImpl(formData: FormData) {
  const session = await requireWebSession();
  if (
    !hasActiveEntitlement(session.workspace.id, "meta.ads") &&
    !hasActiveEntitlement(session.workspace.id, "google.ads")
  ) {
    await enforceFeaturePaidEntitlement(session.workspace.id, "meta.ads", "/campaigns");
  }
  const res = await recordCampaignDailySnapshot(session.ctx, {
    campaignId: String(formData.get("campaignId") || ""),
    dayKey: String(formData.get("dayKey") || new Date().toISOString().slice(0, 10)),
    spendRupees: Number(formData.get("spendRupees") || 0),
    revenueRupees: Number(formData.get("revenueRupees") || 0),
    impressions: Number(formData.get("impressions") || 0),
    clicks: Number(formData.get("clicks") || 0),
    conversions: Number(formData.get("conversions") || 0),
  });
  if (!res.ok) return goWithError("/campaigns", res.error.message);
  return goWithNotice(
    "/campaigns",
    res.data.capReached
      ? "Daily metrics saved - campaign auto-paused at 100% of Managed Ad Spend Vault cap."
      : "Daily campaign results saved."
  );
}

export async function schedulePostActionImpl(formData: FormData) {
  const session = await requireWebSession();
  const channelRaw = String(formData.get("channel") || "instagram_feed");
  const channel = (
    ["instagram_feed", "instagram_reel", "facebook_page", "google_post"].includes(channelRaw)
      ? channelRaw
      : "instagram_feed"
  ) as "instagram_feed" | "instagram_reel" | "facebook_page" | "google_post";
  const requiredKey =
    channel === "facebook_page"
      ? "meta.pages"
      : channel === "google_post"
        ? "google.reviews"
        : "meta.instagram";
  await enforceFeaturePaidEntitlement(session.workspace.id, requiredKey, "/campaigns");

  let uploadedMedia: { mediaUrl?: string; mediaType: "none" | "image" | "video" };
  try {
    uploadedMedia = await resolveUploadedMediaFromFormData({
      formData,
      workspaceId: session.workspace.id,
      actorId: session.user.id,
    });
  } catch (err) {
    return goWithError(
      "/campaigns",
      err instanceof Error ? err.message : "Could not upload social post media."
    );
  }

  const publishNow = formData.get("publishNow") === "on";
  const res = await scheduleSocialPost(session.ctx, {
    channel,
    caption: String(formData.get("caption") || ""),
    scheduledForIso: String(formData.get("scheduledForIso") || new Date().toISOString()),
    publishNow,
    mediaUrl: uploadedMedia.mediaUrl,
    mediaType: uploadedMedia.mediaType,
    ctaUrl: String(formData.get("ctaUrl") || "") || undefined,
    ctaType: String(formData.get("ctaType") || "") || undefined,
    requireLiveConnection: publishNow && formData.get("requireLiveConnection") === "on",
  });
  if (!res.ok) return goWithError("/campaigns", res.error.message);
  return goWithNotice(
    "/campaigns",
    publishNow
      ? res.data.externalPostId
        ? `Published live to ${channel.replace(/_/g, " ")}!`
        : "Social post saved as published (connect channel on Connected Channels for live external posting)."
      : "Social post scheduled - background publisher will post automatically at scheduled time."
  );
}

export async function publishScheduledPostActionImpl(formData: FormData) {
  const session = await requireWebSession();
  const res = await publishScheduledPost(session.ctx, {
    postId: String(formData.get("postId") || ""),
  });
  if (!res.ok) return goWithError("/campaigns", res.error.message);
  return goWithNotice(
    "/campaigns",
    res.data.externalPostId
      ? "Published live to connected channel!"
      : "Scheduled post marked published."
  );
}

export async function deleteScheduledPostActionImpl(formData: FormData) {
  const session = await requireWebSession();
  const res = await deleteScheduledPost(session.ctx, {
    postId: String(formData.get("postId") || ""),
  });
  if (!res.ok) return goWithError("/campaigns", res.error.message);
  return goWithNotice("/campaigns", "Scheduled post removed.");
}

export async function recordPixelEventActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "meta.pixel", "/campaigns");
  const eventNameRaw = String(formData.get("eventName") || "Purchase");
  const eventName = (
    ["Purchase", "Lead", "AddToCart", "ViewContent"].includes(eventNameRaw)
      ? eventNameRaw
      : "Purchase"
  ) as "Purchase" | "Lead" | "AddToCart" | "ViewContent";
  const res = await recordWebsiteSalesEvent(session.ctx, {
    eventId: String(formData.get("eventId") || ""),
    eventName,
    valueRupees: Number(formData.get("valueRupees") || 0),
    customerIdentifier: String(formData.get("customerIdentifier") || "") || undefined,
    sourceUrl: String(formData.get("sourceUrl") || "") || undefined,
    orderRef: String(formData.get("orderRef") || "") || undefined,
  });
  if (!res.ok) return goWithError("/campaigns", res.error.message);
  return goWithNotice(
    "/campaigns",
    res.data.deduplicated
      ? "Order ID already recorded - duplicate entry skipped."
      : res.data.capiStatus === "sent_live"
        ? "Website conversion recorded and dispatched live to Meta Conversions API (CAPI)!"
        : "Website conversion event recorded."
  );
}

export async function recordReviewActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "google.reviews", "/reviews");
  const res = await recordGoogleReview(session.ctx, {
    locationName: String(formData.get("locationName") || session.workspace.name),
    reviewerName: String(formData.get("reviewerName") || ""),
    rating: Number(formData.get("rating") || 5),
    comment: String(formData.get("comment") || ""),
  });
  if (!res.ok) return goWithError("/reviews", res.error.message);
  return goWithNotice("/reviews", "Google Business review saved.");
}

export async function replyReviewActionImpl(formData: FormData) {
  const session = await requireWebSession();
  const rawReturn = String(formData.get("returnPath") || "/reviews");
  const returnPath = rawReturn.startsWith("/reviews") ? rawReturn : "/reviews";
  await enforceFeaturePaidEntitlement(session.workspace.id, "google.reviews", returnPath);
  const res = await replyToGoogleReview(session.ctx, {
    reviewId: String(formData.get("reviewId") || ""),
    replyText: String(formData.get("replyText") || ""),
  });
  if (!res.ok) return goWithError(returnPath, res.error.message);
  return goWithNotice(
    returnPath,
    res.data.publishedToGoogleLive
      ? "Published owner reply live to Google Maps & Search."
      : "Published owner reply to Google review."
  );
}

export async function syncGoogleReviewsActionImpl(formData: FormData) {
  const session = await requireWebSession();
  const rawReturn = String(formData.get("returnPath") || "/reviews");
  const returnPath =
    rawReturn.startsWith("/reviews") || rawReturn.startsWith("/connections")
      ? rawReturn
      : "/reviews";
  const connectionId = String(formData.get("connectionId") || "").trim() || undefined;
  const res = await syncGoogleReviews(session.ctx, {
    connectionId,
    forceDiscovery: true,
  });
  revalidatePath("/reviews");
  revalidatePath("/connections");
  if (!res.ok) return goWithError(returnPath, res.error.message);
  if (!res.data.ok) {
    return goWithError(returnPath, res.data.message);
  }
  return goWithNotice(returnPath, res.data.message);
}

export async function generateReviewDraftActionImpl(formData: FormData) {
  const session = await requireWebSession();
  const rawReturn = String(formData.get("returnPath") || "/reviews");
  const returnPath = rawReturn.startsWith("/reviews") ? rawReturn : "/reviews";
  await enforceFeaturePaidEntitlement(session.workspace.id, "google.reviews", returnPath);
  await enforceFeaturePaidEntitlement(session.workspace.id, "google.autoreply", returnPath);
  const res = await generateSmartReviewDraft(session.ctx, {
    reviewId: String(formData.get("reviewId") || ""),
  });
  if (!res.ok) return goWithError(returnPath, res.error.message);
  return goWithNotice(
    returnPath,
    res.data.isAiGenerated
      ? "AI reply draft ready below - review or edit the text and click Approve & Publish Reply."
      : "Template reply draft ready below (Cloudflare Workers AI not configured - edit before publishing)."
  );
}

export async function generateSmartAdCopyJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  isAiGenerated?: boolean;
  headline?: string;
  primaryText?: string;
  description?: string;
  provider?: string;
  message?: string;
}> {
  try {
    const session = await requireWebSession();
    const productOrOffer = String(formData.get("productOrOffer") || "").trim();
    const platform = String(formData.get("platform") || "meta") === "google" ? "google" : "meta";
    const targetCity = String(formData.get("targetCity") || session.workspace.city || "").trim();
    if (!productOrOffer) {
      return { ok: false, message: "Enter your product, service, or offer first." };
    }
    const res = await generateSmartAdCopy({
      workspaceId: session.workspace.id,
      businessName: session.workspace.name,
      offerSummary: targetCity ? `${productOrOffer} (${targetCity})` : productOrOffer,
      channel: platform === "google" ? "google_ads" : "meta_ads",
    });
    return {
      ok: true,
      isAiGenerated: res.isAiGenerated,
      headline: res.headline,
      primaryText: res.primaryText,
      description: `${session.workspace.name}${targetCity ? ` • ${targetCity}` : ""} • Verified GST Billing`,
      provider: res.provider,
      message: res.isAiGenerated
        ? undefined
        : "Starter draft prepared locally because Cloudflare Workers AI credentials are not configured on this server.",
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}
