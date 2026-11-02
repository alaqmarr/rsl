import { getWorkspaceAnalytics } from "@rsl/analytics";
import { getWorkspacePlansByKeys, hasActiveEntitlement } from "@rsl/billing";
import { listGoogleReviews } from "@rsl/google";
import { canRoleAccessWebRoute, canRolePerform, formatRoleLabel } from "@rsl/rbac";
import {
  AccessRestrictedState,
  EmptyWorkspaceState,
  PageHeader,
  SectionCard,
  StarBreakdownCard,
  StatusPill,
} from "@rsl/ui";
import { FeaturePlanGate, InlineAddonPlanBanner } from "@/components/feature-plan-gate";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import {
  generateReviewDraftAction,
  recordReviewAction,
  replyReviewAction,
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

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Daily Operations"
        title="Google Business Profile Reviews"
        subtitle="Monitor customer ratings across your store locations, prepare tailored reply drafts, and publish owner responses."
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

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
          title="Record / Sync Google Review"
          subtitle="Log a review from your Google Business location"
        >
          {!canReplyReviews ? (
            <p className="text-[13px] leading-relaxed text-zinc-500">
              Read-only role — your current role can monitor star ratings and published replies across store locations.
            </p>
          ) : (
          <form action={recordReviewAction} className="space-y-3.5 text-[13px]">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="rsl-label">Branch / Location *</label>
                <input
                  name="locationName"
                  defaultValue={session.workspace.name}
                  required
                  placeholder="Branch / Location"
                  className="rsl-input"
                />
              </div>
              <div>
                <label className="rsl-label">Reviewer Name *</label>
                <input
                  name="reviewerName"
                  required
                  placeholder="Customer Name"
                  className="rsl-input"
                />
              </div>
              <div>
                <label className="rsl-label">Star Rating</label>
                <select name="rating" defaultValue="5" className="rsl-input">
                  <option value="5">5 ★ — Excellent</option>
                  <option value="4">4 ★ — Good</option>
                  <option value="3">3 ★ — Average</option>
                  <option value="2">2 ★ — Below Average</option>
                  <option value="1">1 ★ — Poor</option>
                </select>
              </div>
            </div>
            <div>
              <label className="rsl-label">Customer Review Comment *</label>
              <textarea
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
          <EmptyWorkspaceState
            title={
              allReviews.length === 0
                ? "No Google Business reviews synced yet"
                : "No reviews match this filter"
            }
            description={
              allReviews.length === 0
                ? "Connect your Google Business Profile under Connected Accounts or record a review above."
                : "Switch back to All reviews to view your full rating history."
            }
            actionLabel={allReviews.length === 0 ? "Connect Google Profile" : "View All Reviews"}
            actionHref={allReviews.length === 0 ? "/connections" : "/reviews"}
          />
        ) : (
          <div className="space-y-4">
            {filteredReviews.map((rev) => {
              const isReplied = rev.replyStatus === "replied";
              const isDraftReady = rev.replyStatus === "draft_ready";

              return (
                <div
                  key={rev.id}
                  className="rounded-xl border border-zinc-200/90 bg-zinc-50/60 p-4 text-[13px]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold text-slate-900">{rev.reviewerName}</span>
                      <span className="ml-2 text-amber-500">{"★".repeat(rev.rating)}</span>
                      <span className="ml-2 text-xs text-zinc-500">• {rev.locationName}</span>
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
