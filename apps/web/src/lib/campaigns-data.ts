import { headers } from "next/headers";
import {
  getAdSpendVaultSummary,
  getWorkspacePlansByKeys,
  hasActiveEntitlement,
} from "@rsl/billing";
import { listWorkspaceConnections } from "@rsl/connections";
import { resolveEndpointsFromHeaders } from "@rsl/core";
import { fetchWorkspaceGoogleSearchConsoleInsights } from "@rsl/google";
import { getMetaWorkspaceSummary } from "@rsl/meta";
import { canRolePerform } from "@rsl/rbac";

export const CAMPAIGN_PLAN_KEYS = [
  "meta.ads",
  "google.ads",
  "meta.instagram",
  "meta.pages",
  "meta.pixel",
];

export type CampaignsWorkspaceData = Awaited<ReturnType<typeof loadCampaignsWorkspaceContext>>;

export async function loadCampaignsWorkspaceContext(workspaceId: string, roleSlug: string) {
  const meta = getMetaWorkspaceSummary(workspaceId);
  const connSnapshot = listWorkspaceConnections(workspaceId);
  const connections = connSnapshot.connections;
  const vault = getAdSpendVaultSummary(workspaceId);
  const ep = resolveEndpointsFromHeaders(await headers());

  const gscInsights = await fetchWorkspaceGoogleSearchConsoleInsights(workspaceId).catch(() => ({
    connected: false as const,
    siteUrl: null,
    queries: [] as Array<{
      query: string;
      clicks: number;
      impressions: number;
      ctrPct: number;
      avgPosition: number;
    }>,
    totals: { clicks: 0, impressions: 0, ctrPct: 0, avgPosition: 0 },
  }));

  const gscTotals =
    "totals" in gscInsights
      ? gscInsights.totals
      : {
          clicks: gscInsights.totalClicks28d,
          impressions: gscInsights.totalImpressions28d,
          ctrPct: gscInsights.avgCtrPercent,
          avgPosition: gscInsights.avgPosition,
        };

  const gscQueries =
    "queries" in gscInsights
      ? gscInsights.queries
      : gscInsights.topQueries.map((q) => ({
          query: q.query,
          clicks: q.clicks,
          impressions: q.impressions,
          ctrPct: q.ctrPercent,
          avgPosition: q.position,
        }));

  const plans = getWorkspacePlansByKeys(workspaceId, CAMPAIGN_PLAN_KEYS);
  const planMap = new Map(plans.map((p) => [p.key, p]));

  const hasMetaAds = hasActiveEntitlement(workspaceId, "meta.ads");
  const hasGoogleAds = hasActiveEntitlement(workspaceId, "google.ads");
  const hasInsta = hasActiveEntitlement(workspaceId, "meta.instagram");
  const hasFbPage = hasActiveEntitlement(workspaceId, "meta.pages");
  const hasPixel = hasActiveEntitlement(workspaceId, "meta.pixel");

  return {
    meta,
    vault,
    ep,
    gscConnected: gscInsights.connected,
    gscSiteUrl: gscInsights.siteUrl,
    gscTotals,
    gscQueries,
    plans,
    metaAdsPlan: planMap.get("meta.ads"),
    googleAdsPlan: planMap.get("google.ads"),
    instagramPlan: planMap.get("meta.instagram"),
    pagesPlan: planMap.get("meta.pages"),
    pixelPlan: planMap.get("meta.pixel"),
    hasMetaAds,
    hasGoogleAds,
    hasAnyAds: hasMetaAds || hasGoogleAds,
    hasInsta,
    hasFbPage,
    hasSocial: hasInsta || hasFbPage,
    hasPixel,
    canCreateAds: canRolePerform(roleSlug, "ads:create", workspaceId),
    canPauseAds: canRolePerform(roleSlug, "ads:pause", workspaceId),
    canDraftPosts: canRolePerform(roleSlug, "posts:create", workspaceId),
    canPublishPosts: canRolePerform(roleSlug, "posts:publish", workspaceId),
    canManagePixel: canRolePerform(roleSlug, "pixel:manage", workspaceId),
    metaAdsConn: connections.find(
      (c) => c.channelKind === "meta_ads_pixel" && c.status === "healthy"
    ),
    googleAdsConn: connections.find(
      (c) => c.channelKind === "google_ads" && c.status === "healthy"
    ),
    fbPageConn: connections.find(
      (c) => c.channelKind === "facebook_page" && c.status === "healthy"
    ),
    igConn: connections.find(
      (c) => c.channelKind === "instagram_business" && c.status === "healthy"
    ),
    gbpConn: connections.find(
      (c) => c.channelKind === "google_business" && c.status === "healthy"
    ),
    todayIso: new Date().toISOString().slice(0, 10),
    defaultDateTimeLocal: new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 16),
  };
}

export function filterCampaignsByPlatform<T extends { channel: string }>(
  campaigns: T[],
  platform: "facebook" | "instagram" | "google_ads" | "all"
): T[] {
  if (platform === "all") return campaigns;
  if (platform === "facebook") {
    return campaigns.filter(
      (c) => c.channel === "facebook" || c.channel === "meta_ads" || c.channel === "meta"
    );
  }
  if (platform === "instagram") {
    return campaigns.filter(
      (c) => c.channel === "instagram" || c.channel === "meta_ads" || c.channel === "meta"
    );
  }
  return campaigns.filter((c) => c.channel === "google_ads");
}
