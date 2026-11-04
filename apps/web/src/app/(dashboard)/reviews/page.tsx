import Link from "next/link";
import { eq } from "drizzle-orm";
import { getWorkspaceAnalytics } from "@rsl/analytics";
import { getWorkspacePlansByKeys, hasActiveEntitlement } from "@rsl/billing";
import { listWorkspaceConnections } from "@rsl/connections";
import { controlSchema } from "@rsl/database";
import { listGoogleReviews, syncGoogleBusinessReviewsForWorkspace } from "@rsl/google";
import { canRoleAccessWebRoute, canRolePerform, formatRoleLabel } from "@rsl/rbac";
import { controlDb, getPublicGoogleOAuthStatus } from "@rsl/tenancy";
import {
  AccessRestrictedState,
  EmptyWorkspaceState,
  PageHeader,
  SectionCard,
  StarBreakdownCard,
  StatusPill,
} from "@rsl/ui";
import { CopyTextButton } from "@/components/client-utils";
import { FeaturePlanGate, InlineAddonPlanBanner } from "@/components/feature-plan-gate";
import { FlashBanner } from "@/components/flash-banner";
import { ConnectToGoogleDriveButton, GoogleGLogo } from "@/components/google-drive-connect-button";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import {
  generateReviewDraftAction,
  recordReviewAction,
  replyReviewAction,
  syncGoogleReviewsAction,
} from "@/lib/actions";
import { requireWebSession } from "@/lib/session";

export default async function GoogleReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/reviews", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Google Business Profile Reviews"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View Google reviews"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  if (!hasActiveEntitlement(session.workspace.id, "google.reviews")) {
    const plans = getWorkspacePlansByKeys(session.workspace.id, [
      "google.reviews",
      "google.autoreply",
    ]);
    return (
      <FeaturePlanGate
        pageTitle="Google Business Profile Reviews"
        pageSubtitle="Monitor star ratings across store locations and publish timely owner replies that build local customer trust."
        plans={plans}
        returnPath="/reviews"
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  const canReplyReviews = canRolePerform(session.roleSlug, "reviews:reply", session.workspace.id);
  const canManageConnections = canRolePerform(
    session.roleSlug,
    "connections:manage",
    session.workspace.id
  );

  let connectionsSnapshot = listWorkspaceConnections(session.workspace.id);
  let activeGbpConn = connectionsSnapshot.connections.find(
    (c) => c.channelKind === "google_business"
  );

  // Auto-hydrate legacy connections or refresh stale Google reviews (>5 min) automatically
  if (activeGbpConn) {
    const neverDiscovered = !activeGbpConn.metadata.lastGbpDiscoveredAt;
    const staleReviews =
      Boolean(activeGbpConn.metadata.locationId) &&
      (!activeGbpConn.metadata.lastReviewsSyncedAt ||
        Date.now() - activeGbpConn.metadata.lastReviewsSyncedAt > 5 * 60 * 1000);
    if (neverDiscovered || staleReviews) {
      await syncGoogleBusinessReviewsForWorkspace({
        workspaceId: session.workspace.id,
        connectionId: activeGbpConn.id,
        forceDiscovery: neverDiscovered,
      }).catch(() => null);
      connectionsSnapshot = listWorkspaceConnections(session.workspace.id);
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
    .where(eq(controlSchema.workspaces.id, session.workspace.id))
    .get();

  const googleOAuth = getPublicGoogleOAuthStatus();
  const hasAutoReply = hasActiveEntitlement(session.workspace.id, "google.autoreply");
  const [autoReplyPlan] = getWorkspacePlansByKeys(session.workspace.id, ["google.autoreply"]);

  const allReviews = listGoogleReviews(session.workspace.id);
  const analytics = getWorkspaceAnalytics(session.workspace.id, "all");

  const filter = sp.filter || "all";
  const filteredReviews = allReviews.filter((rev) => {
    if (filter === "unreplied") return rev.replyStatus === "unreplied";
    if (filter === "draft_ready") return rev.replyStatus === "draft_ready";
    if (filter === "replied") return rev.replyStatus === "replied";
    if (filter === "low_rating") return rev.rating <= 3;
    return true;
  });

  const currentReturnPath = filter === "all" ? "/reviews" : `/reviews?filter=${encodeURIComponent(filter)}`;

  const filterTabs = [
    { key: "all", label: `All (${allReviews.length})` },
    {
      key: "unreplied",
      label: `Needs Reply (${allReviews.filter((r) => r.replyStatus === "unreplied").length})`,
    },
    {
      key: "draft_ready",
      label: `Draft Ready (${allReviews.filter((r) => r.replyStatus === "draft_ready").length})`,
    },
    {
      key: "replied",
      label: `Replied (${allReviews.filter((r) => r.replyStatus === "replied").length})`,
    },
    {
      key: "low_rating",
      label: `1–3 ★ Attention (${allReviews.filter((r) => r.rating <= 3).length})`,
    },
  ];

  const gbpMeta = activeGbpConn?.metadata;
  const connectedBusinessName =
    gbpMeta?.storeName || wsDetails?.name || session.workspace.name;
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

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Daily Operations"
        title="Google Business Profile Reviews"
        subtitle="Monitor customer ratings across your store locations, prepare tailored reply drafts, and publish live owner responses to Google Maps & Search."
        actions={
          activeGbpConn ? (
            <div className="flex flex-wrap items-center gap-2">
              <form action={syncGoogleReviewsAction}>
                <input type="hidden" name="connectionId" value={activeGbpConn.id} />
                <input type="hidden" name="returnPath" value={currentReturnPath} />
                <SubmitButton
                  spinnerSize="xs"
                  pendingText="Syncing Google..."
                  className="rsl-btn-primary py-1.5 text-xs"
                >
                  Sync Live Reviews Now
                </SubmitButton>
              </form>
              <Link
                href="/connections?tab=google_business"
                className="rsl-btn-secondary py-1.5 text-xs"
              >
                Manage Google Connection
              </Link>
            </div>
          ) : canManageConnections ? (
            <ConnectToGoogleDriveButton
              purpose="google_business"
              returnTo="/reviews"
              label="Connect Google Business Profile"
              size="sm"
              configured={googleOAuth.enableGbpOAuth}
            />
          ) : undefined
        }
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      {/* Connected Google Business Profile Details Card */}
      {activeGbpConn ? (
        <div className="rounded-2xl border border-emerald-200/90 bg-gradient-to-r from-emerald-50/80 via-white to-emerald-50/40 p-4 text-[13px] shadow-2xs">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-2xs ring-1 ring-emerald-200">
                <GoogleGLogo className="h-5 w-5" />
              </span>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-bold text-slate-900">
                    {connectedBusinessName}
                  </span>
                  <StatusPill
                    label={
                      isVerifiedGbpLocation
                        ? "GBP Location Connected"
                        : gbpMeta?.gbpDiscoveryStatus === "quota_pending"
                          ? "Google Connected • GBP Quota Pending"
                          : gbpMeta?.gbpDiscoveryStatus === "api_disabled"
                            ? "Google Connected • Enable GBP API"
                            : "Google Account Connected"
                    }
                    tone={isVerifiedGbpLocation ? "emerald" : "amber"}
                  />
                  {gbpMeta?.locationId && (
                    <span className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
                      {gbpMeta.locationId}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                  {gbpMeta?.driveEmail && (
                    <span>
                      Signed in as:{" "}
                      <strong className="text-slate-900">{gbpMeta.driveEmail}</strong>
                      {gbpMeta.googleUserName ? ` (${gbpMeta.googleUserName})` : ""}
                    </span>
                  )}
                  {connectedCategory && (
                    <span>
                      • Category: <strong className="text-slate-800">{connectedCategory}</strong>
                    </span>
                  )}
                  {connectedPhone && (
                    <span>
                      • Phone: <strong className="text-slate-800">{connectedPhone}</strong>
                    </span>
                  )}
                  {connectedWebsite && (
                    <span>
                      •{" "}
                      <a
                        href={
                          connectedWebsite.startsWith("http")
                            ? connectedWebsite
                            : `https://${connectedWebsite}`
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-emerald-700 hover:underline"
                      >
                        {connectedWebsite} ↗
                      </a>
                    </span>
                  )}
                </div>

                {connectedAddress && (
                  <div className="text-xs text-zinc-600">
                    Address: <span className="font-medium text-slate-800">{connectedAddress}</span>
                  </div>
                )}

                {gbpMeta?.lastReviewsSyncedAt && (
                  <div className="text-[11px] text-zinc-500">
                    Last synced with Google:{" "}
                    {new Date(gbpMeta.lastReviewsSyncedAt).toLocaleString("en-IN")}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {gbpMeta?.newReviewUri && (
                <CopyTextButton
                  text={gbpMeta.newReviewUri}
                  label="Copy Customer Review Link"
                  copiedLabel="Copied Link"
                />
              )}
              {gbpMeta?.mapsUri && (
                <a
                  href={gbpMeta.mapsUri}
                  target="_blank"
                  rel="noreferrer"
                  className="rsl-btn-secondary py-1.5 text-xs"
                >
                  Open on Google Maps ↗
                </a>
              )}
            </div>
          </div>

          {gbpMeta?.gbpDiscoveryDetail && !isVerifiedGbpLocation && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/90 px-3.5 py-2.5 text-xs leading-relaxed text-amber-950">
              <strong className="font-bold">Google Business Sync Status:</strong>{" "}
              {gbpMeta.gbpDiscoveryDetail}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200/90 bg-white px-4 py-3.5 text-[13px]">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 ring-1 ring-emerald-200">
              <GoogleGLogo className="h-4 w-4" />
            </span>
            <div>
              <div className="font-bold text-slate-900">
                Connect your Google Business Profile for automatic review sync &amp; live replies
              </div>
              <div className="text-xs text-zinc-600">
                Sign in with the Google account that manages your Google Maps business listing.
              </div>
            </div>
          </div>
          {canManageConnections ? (
            <ConnectToGoogleDriveButton
              purpose="google_business"
              returnTo="/reviews"
              label="Connect Google Business Profile"
              size="sm"
              configured={googleOAuth.enableGbpOAuth}
            />
          ) : (
            <Link href="/connections?tab=google_business" className="rsl-btn-secondary py-1.5 text-xs">
              View Connection Status
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard title="Rating Distribution" subtitle="Live breakdown across all synced reviews">
          <div className="space-y-4">
            <StarBreakdownCard
              averageRating={analytics.kpis.averageGoogleRating}
              totalReviews={analytics.kpis.reviewsCount}
              stars={analytics.reviewStars}
            />
            {!hasAutoReply && autoReplyPlan && (
              <InlineAddonPlanBanner plan={autoReplyPlan} returnPath={currentReturnPath} />
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Record Manual Review"
          subtitle="Log a walk-in or offline review alongside your synced Google Maps reviews"
        >
          {!canReplyReviews ? (
            <p className="text-[13px] leading-relaxed text-zinc-500">
              Read-only role — your current role can monitor star ratings and published replies across store locations.
            </p>
          ) : (
          <form action={recordReviewAction} className="space-y-3.5 text-[13px]">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="review-location-name" className="rsl-label">Branch / Location *</label>
                <input
                  id="review-location-name"
                  name="locationName"
                  defaultValue={connectedBusinessName}
                  required
                  placeholder="Branch / Location"
                  className="rsl-input"
                />
              </div>
              <div>
                <label htmlFor="review-customer-name" className="rsl-label">Reviewer Name *</label>
                <input
                  id="review-customer-name"
                  name="reviewerName"
                  required
                  placeholder="Customer Name"
                  className="rsl-input"
                />
              </div>
              <div>
                <label htmlFor="review-star-rating" className="rsl-label">Star Rating</label>
                <select id="review-star-rating" name="rating" defaultValue="5" className="rsl-input">
                  <option value="5">5 ★ — Excellent</option>
                  <option value="4">4 ★ — Good</option>
                  <option value="3">3 ★ — Average</option>
                  <option value="2">2 ★ — Below Average</option>
                  <option value="1">1 ★ — Poor</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="review-comment-body" className="rsl-label">Customer Review Comment *</label>
              <textarea
                id="review-comment-body"
                name="comment"
                rows={2}
                required
                placeholder="Customer review text..."
                className="rsl-input"
              />
            </div>
            <SubmitButton pendingText="Saving..." className="rsl-btn-primary">
              Save Review
            </SubmitButton>
          </form>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title={`Customer Reviews (${filteredReviews.length})`}
        action={
          <div className="flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-white p-0.5 text-[11.5px]">
            {filterTabs.map((tab) => (
              <ActionLink
                key={tab.key}
                href={tab.key === "all" ? "/reviews" : `/reviews?filter=${tab.key}`}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
                  filter === tab.key
                    ? "bg-slate-900 text-white"
                    : "text-zinc-600 hover:bg-zinc-50 hover:text-slate-900"
                }`}
              >
                {tab.label}
              </ActionLink>
            ))}
          </div>
        }
      >
        {filteredReviews.length === 0 ? (
          allReviews.length === 0 && activeGbpConn ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/50 px-6 py-10 text-center">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 ring-1 ring-emerald-200">
                <GoogleGLogo className="h-5 w-5" />
              </span>
              <h3 className="mt-3 text-sm font-bold text-slate-900">
                Connected to {connectedBusinessName} — 0 customer reviews synced yet
              </h3>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-zinc-600">
                {isVerifiedGbpLocation
                  ? `Your Google Business Profile (${gbpMeta?.driveEmail || "connected"}) is linked and currently has 0 customer reviews on Google Maps. Share your direct Google review link with customers or click Sync Live Reviews Now to refresh.`
                  : gbpMeta?.gbpDiscoveryDetail ||
                    `Signed in as ${gbpMeta?.driveEmail || "connected account"}. Click Sync Live Reviews Now to refresh your Google Business Profile locations and customer reviews.`}
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                <form action={syncGoogleReviewsAction}>
                  <input type="hidden" name="connectionId" value={activeGbpConn.id} />
                  <input type="hidden" name="returnPath" value={currentReturnPath} />
                  <SubmitButton
                    spinnerSize="xs"
                    pendingText="Syncing from Google..."
                    className="rsl-btn-primary py-2 text-xs"
                  >
                    Sync Live Reviews Now
                  </SubmitButton>
                </form>
                {gbpMeta?.newReviewUri && (
                  <CopyTextButton
                    text={gbpMeta.newReviewUri}
                    label="Copy Direct Review Link"
                    copiedLabel="Copied Link"
                  />
                )}
                <Link
                  href="/connections?tab=google_business"
                  className="rsl-btn-secondary py-2 text-xs"
                >
                  View Google Business Details
                </Link>
              </div>
            </div>
          ) : (
            <EmptyWorkspaceState
              title={
                allReviews.length === 0
                  ? "No Google Business reviews synced yet"
                  : "No reviews match this filter"
              }
              description={
                allReviews.length === 0
                  ? "Connect your Google Business Profile under Connected Channels or record a review above."
                  : "Switch back to All reviews to view your full rating history."
              }
              actionLabel={allReviews.length === 0 ? "Connect Google Profile" : "View All Reviews"}
              actionHref={
                allReviews.length === 0 ? "/connections?tab=google_business" : "/reviews"
              }
            />
          )
        ) : (
          <div className="space-y-4">
            {filteredReviews.map((rev) => {
              const isReplied = rev.replyStatus === "replied";
              const isDraftReady = rev.replyStatus === "draft_ready";
              const isLiveGbpReview = !rev.externalReviewId.startsWith("gbp_");

              return (
                <div
                  key={rev.id}
                  className="rounded-xl border border-zinc-200/90 bg-zinc-50/60 p-4 text-[13px]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">{rev.reviewerName}</span>
                      <span className="text-amber-500">{"★".repeat(rev.rating)}</span>
                      <span className="text-xs text-zinc-500">• {rev.locationName}</span>
                      {isLiveGbpReview && (
                        <span className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                          Google Maps
                        </span>
                      )}
                      <span className="text-xs text-zinc-500">
                        • {new Date(rev.reviewedAt).toLocaleDateString("en-IN")}
                      </span>
                    </div>
                    <StatusPill
                      label={
                        isReplied
                          ? "Owner Replied"
                          : isDraftReady
                            ? "Draft Ready to Approve"
                            : "Needs Reply"
                      }
                      tone={isReplied ? "emerald" : isDraftReady ? "sky" : "amber"}
                    />
                  </div>
                  <p className="mt-2 leading-relaxed text-zinc-700">{rev.comment}</p>

                  {isReplied && rev.publishedReplyText ? (
                    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5">
                      <div className="text-xs font-semibold text-emerald-800">
                        Your Published Reply
                      </div>
                      <p className="mt-1 text-slate-900">{rev.publishedReplyText}</p>
                    </div>
                  ) : !canReplyReviews ? (
                    <div className="mt-3 text-xs text-zinc-500">
                      {isDraftReady
                        ? "Suggested reply draft prepared — awaiting approval from a team member with review reply access."
                        : "Awaiting owner or support executive reply."}
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2.5">
                      {isDraftReady && (
                        <div className="text-xs font-semibold text-sky-800">
                          Suggested Reply Draft Ready — review or edit below before publishing:
                        </div>
                      )}
                      <div className="flex flex-wrap items-start gap-2.5">
                        <form
                          action={replyReviewAction}
                          className="flex min-w-[260px] flex-1 flex-wrap items-start gap-2.5"
                        >
                          <input type="hidden" name="reviewId" value={rev.id} />
                          <input type="hidden" name="returnPath" value={currentReturnPath} />
                          {isDraftReady ? (
                            <textarea
                              name="replyText"
                              rows={2}
                              required
                              defaultValue={rev.publishedReplyText ?? ""}
                              aria-label={`Approve reply to ${rev.reviewerName}`}
                              className="rsl-input min-w-[240px] flex-1"
                            />
                          ) : (
                            <input
                              name="replyText"
                              required
                              aria-label={`Reply to ${rev.reviewerName}`}
                              placeholder="Write a polite public reply..."
                              className="rsl-input min-w-[220px] flex-1"
                            />
                          )}
                          <SubmitButton
                            pendingText="Publishing..."
                            className="rsl-btn-primary shrink-0"
                          >
                            {isDraftReady ? "Approve & Publish Reply" : "Publish Reply"}
                          </SubmitButton>
                        </form>

                        {hasAutoReply && (
                          <form action={generateReviewDraftAction} className="shrink-0">
                            <input type="hidden" name="reviewId" value={rev.id} />
                            <input type="hidden" name="returnPath" value={currentReturnPath} />
                            <SubmitButton
                              spinnerSize="xs"
                              pendingText="Drafting..."
                              className="rsl-btn-secondary"
                            >
                              {isDraftReady ? "Regenerate Draft (₹1)" : "Prepare Smart Draft (₹1)"}
                            </SubmitButton>
                          </form>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
