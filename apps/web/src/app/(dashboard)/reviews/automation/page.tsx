import { canRoleAccessWebRoute, formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, PageHeader, SectionCard, StarBreakdownCard } from "@rsl/ui";
import { FeaturePlanGate, InlineAddonPlanBanner } from "@/components/feature-plan-gate";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { GoogleSuiteNav } from "@/components/suite-subnav";
import { recordReviewAction } from "@/lib/actions";
import { loadReviewsWorkspaceContext } from "@/lib/reviews-data";
import { requireWebSession } from "@/lib/session";

export default async function ReviewsAutomationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/reviews/automation", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Google Reviews Breakdown & Auto-Reply"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View Google reviews"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  const ctx = await loadReviewsWorkspaceContext({
    workspaceId: session.workspace.id,
    workspaceName: session.workspace.name,
    roleSlug: session.roleSlug,
  });

  if (!ctx.hasReviews) {
    return (
      <FeaturePlanGate
        pageTitle="Google Reviews Breakdown & Auto-Reply"
        pageSubtitle="Inspect 1-to-5 star distributions, enable AI smart reply drafting, and record offline customer reviews."
        plans={ctx.reviewsPlans}
        returnPath="/reviews/automation"
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Google Services"
        title="Rating Breakdown, Auto-Reply & Manual Entry"
        subtitle="Inspect star distribution, unlock AI Smart Drafts, or log in-store reviews"
        actions={
          <ActionLink href="/reviews" className="rsl-btn-secondary">
            ← Back to Review Inbox
          </ActionLink>
        }
      />

      <GoogleSuiteNav active="reviews-automation" reviewsCount={ctx.allReviews.length} />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard title="Rating Distribution" subtitle="Live breakdown across all synced reviews">
          <div className="space-y-4">
            <StarBreakdownCard
              averageRating={ctx.analytics.kpis.averageGoogleRating}
              totalReviews={ctx.analytics.kpis.reviewsCount}
              stars={ctx.analytics.reviewStars}
            />
            {!ctx.hasAutoReply && ctx.autoReplyPlan && (
              <InlineAddonPlanBanner plan={ctx.autoReplyPlan} returnPath="/reviews/automation" />
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Record Manual Review"
          subtitle="Log a walk-in or offline customer feedback entry alongside Google Maps reviews"
        >
          {!ctx.canReplyReviews ? (
            <p className="text-[13px] leading-relaxed text-[var(--ink-secondary)]">
              Read-only role - your current role can monitor star ratings across store locations.
            </p>
          ) : (
            <form action={recordReviewAction} className="space-y-3.5 text-[13px]">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="review-location-name" className="rsl-label">
                    Branch / Location *
                  </label>
                  <input
                    id="review-location-name"
                    name="locationName"
                    defaultValue={ctx.connectedBusinessName}
                    required
                    placeholder="Branch / Location"
                    className="rsl-input"
                  />
                </div>
                <div>
                  <label htmlFor="review-customer-name" className="rsl-label">
                    Reviewer Name *
                  </label>
                  <input
                    id="review-customer-name"
                    name="reviewerName"
                    required
                    placeholder="Customer Name"
                    className="rsl-input"
                  />
                </div>
                <div>
                  <label htmlFor="review-star-rating" className="rsl-label">
                    Star Rating
                  </label>
                  <select id="review-star-rating" name="rating" defaultValue="5" className="rsl-input">
                    <option value="5">5 ★ - Excellent</option>
                    <option value="4">4 ★ - Good</option>
                    <option value="3">3 ★ - Average</option>
                    <option value="2">2 ★ - Below Average</option>
                    <option value="1">1 ★ - Poor</option>
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="review-comment-body" className="rsl-label">
                  Customer Review Comment *
                </label>
                <textarea
                  id="review-comment-body"
                  name="comment"
                  rows={3}
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
    </div>
  );
}
