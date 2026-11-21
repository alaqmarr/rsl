import { eq } from "drizzle-orm";
import { getWorkspaceAnalytics } from "@rsl/analytics";
import { getWorkspacePlansByKeys, hasActiveEntitlement } from "@rsl/billing";
import { listWorkspaceConnections } from "@rsl/connections";
import { controlSchema } from "@rsl/database";
import { listGoogleReviews, syncGoogleBusinessReviewsForWorkspace } from "@rsl/google";
import { canRoleAccessWebRoute, canRolePerform } from "@rsl/rbac";
import { controlDb, getPublicGoogleOAuthStatus } from "@rsl/tenancy";

export async function loadReviewsWorkspaceContext(args: {
  workspaceId: string;
  workspaceName: string;
  roleSlug: string;
}) {
  let connectionsSnapshot = listWorkspaceConnections(args.workspaceId);
  let activeGbpConn = connectionsSnapshot.connections.find(
    (c) => c.channelKind === "google_business"
  );

  if (activeGbpConn) {
    const neverDiscovered = !activeGbpConn.metadata.lastGbpDiscoveredAt;
    const staleReviews =
      Boolean(activeGbpConn.metadata.locationId) &&
      (!activeGbpConn.metadata.lastReviewsSyncedAt ||
        Date.now() - activeGbpConn.metadata.lastReviewsSyncedAt > 5 * 60 * 1000);
    if (neverDiscovered || staleReviews) {
      await syncGoogleBusinessReviewsForWorkspace({
        workspaceId: args.workspaceId,
        connectionId: activeGbpConn.id,
        forceDiscovery: neverDiscovered,
      }).catch(() => null);
      connectionsSnapshot = listWorkspaceConnections(args.workspaceId);
      activeGbpConn = connectionsSnapshot.connections.find(
        (c) => c.channelKind === "google_business"
      );
    }
  }

  const wsDetails = controlDb()
    .select({
      name: controlSchema.workspaces.name,
      industry: controlSchema.workspaces.industry,
      businessPhone: controlSchema.workspaces.businessPhone,
      website: controlSchema.workspaces.website,
      addressLine: controlSchema.workspaces.addressLine,
      city: controlSchema.workspaces.city,
      pincode: controlSchema.workspaces.pincode,
    })
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, args.workspaceId))
    .get();

  const googleOAuth = getPublicGoogleOAuthStatus();
  const hasReviews = hasActiveEntitlement(args.workspaceId, "google.reviews");
  const hasAutoReply = hasActiveEntitlement(args.workspaceId, "google.autoreply");
  const reviewsPlans = getWorkspacePlansByKeys(args.workspaceId, [
    "google.reviews",
    "google.autoreply",
  ]);
  const [autoReplyPlan] = getWorkspacePlansByKeys(args.workspaceId, ["google.autoreply"]);

  const allReviews = listGoogleReviews(args.workspaceId);
  const analytics = getWorkspaceAnalytics(args.workspaceId, "all");

  const gbpMeta = activeGbpConn?.metadata;
  const connectedBusinessName = gbpMeta?.storeName || wsDetails?.name || args.workspaceName;
  const connectedAddress =
    gbpMeta?.storeAddress ||
    [wsDetails?.addressLine, wsDetails?.city, wsDetails?.pincode]
      .map((s) => (s || "").trim())
      .filter(Boolean)
      .join(", ") ||
    undefined;
  const connectedCategory = gbpMeta?.primaryCategory || wsDetails?.industry || undefined;
  const connectedPhone = gbpMeta?.storePhone || wsDetails?.businessPhone || undefined;
  const connectedWebsite = gbpMeta?.websiteUri || wsDetails?.website || undefined;
  const isVerifiedGbpLocation = gbpMeta?.gbpDiscoveryStatus === "verified_locations";

  return {
    activeGbpConn,
    gbpMeta,
    googleOAuth,
    hasReviews,
    hasAutoReply,
    reviewsPlans,
    autoReplyPlan,
    allReviews,
    analytics,
    connectedBusinessName,
    connectedAddress,
    connectedCategory,
    connectedPhone,
    connectedWebsite,
    isVerifiedGbpLocation,
    canReplyReviews: canRolePerform(args.roleSlug, "reviews:reply", args.workspaceId),
    canManageConnections: canRoleAccessWebRoute(
      args.roleSlug,
      "/connections/google-business",
      args.workspaceId
    ),
  };
}
