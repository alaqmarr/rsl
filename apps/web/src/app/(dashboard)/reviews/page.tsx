import Link from "next/link";
import { canRoleAccessWebRoute, formatRoleLabel } from "@rsl/rbac";
import {
  AccessRestrictedState,
  EmptyWorkspaceState,
  MetricCard,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@rsl/ui";
import { CopyTextButton } from "@/components/client-utils";
import { FeaturePlanGate } from "@/components/feature-plan-gate";
import { FlashBanner } from "@/components/flash-banner";
import { ConnectToGoogleDriveButton, GoogleGLogo } from "@/components/google-drive-connect-button";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { GoogleSuiteNav } from "@/components/suite-subnav";
import {
  generateReviewDraftAction,
  replyReviewAction,
  syncGoogleReviewsAction,
} from "@/lib/actions";
import { loadReviewsWorkspaceContext } from "@/lib/reviews-data";
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

  const ctx = await loadReviewsWorkspaceContext({
    workspaceId: session.workspace.id,
    workspaceName: session.workspace.name,
    roleSlug: session.roleSlug,
  });

  if (!ctx.hasReviews) {
    return (
      <FeaturePlanGate
        pageTitle="Google Business Profile & Customer Reviews"
        pageSubtitle="Sync Google Maps customer reviews in real time, monitor 1-to-5 star ratings, and reply cleanly."
        plans={ctx.reviewsPlans}
        returnPath="/reviews"
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  const filter = sp.filter || "all";
  const filteredReviews = ctx.allReviews.filter((rev) => {
    if (filter === "unreplied") return rev.replyStatus === "unreplied";
    if (filter === "draft_ready") return rev.replyStatus === "draft_ready";
    if (filter === "replied") return rev.replyStatus === "replied";
    if (filter === "low_rating") return rev.rating <= 3;
    return true;
  });

  const currentReturnPath =
    filter === "all" ? "/reviews" : `/reviews?filter=${encodeURIComponent(filter)}`;

  const unrepliedCount = ctx.allReviews.filter((r) => r.replyStatus === "unreplied").length;
  const draftReadyCount = ctx.allReviews.filter((r) => r.replyStatus === "draft_ready").length;
  const repliedCount = ctx.allReviews.filter((r) => r.replyStatus === "replied").length;
  const lowRatingCount = ctx.allReviews.filter((r) => r.rating <= 3).length;

  const filterTabs = [
    { key: "all", label: `All (${ctx.allReviews.length})` },
    { key: "unreplied", label: `Needs Reply (${unrepliedCount})` },
    { key: "draft_ready", label: `Draft Ready (${draftReadyCount})` },
    { key: "replied", label: `Replied (${repliedCount})` },
    { key: "low_rating", label: `1–3 ★ Attention (${lowRatingCount})` },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Google Services"
        title="Google Business Reviews"
        subtitle="Track live Google Maps ratings, approve AI drafts, and reply publicly to customers"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {ctx.activeGbpConn && (
              <form action={syncGoogleReviewsAction}>
                <input type="hidden" name="connectionId" value={ctx.activeGbpConn.id} />
                <input type="hidden" name="returnPath" value={currentReturnPath} />
                <SubmitButton pendingText="Syncing Google..." className="rsl-btn-primary">
                  Sync Google Reviews
                </SubmitButton>
              </form>
            )}
            <ActionLink href="/reviews/automation" className="rsl-btn-secondary">
              Rating Stats &amp; Manual Entry →
            </ActionLink>
          </div>
        }
      />

      <GoogleSuiteNav active="reviews" reviewsCount={ctx.allReviews.length} />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <MetricCard
          label="Average Star Rating"
          value={
            ctx.analytics.kpis.reviewsCount > 0
              ? `${ctx.analytics.kpis.averageGoogleRating} ★`
              : "—"
          }
          sublabel={`${ctx.analytics.kpis.reviewsCount} total reviews`}
          accent="emerald"
        />
        <MetricCard
          label="Needs Reply"
          value={String(unrepliedCount)}
          sublabel={`${draftReadyCount} smart drafts ready`}
          accent={unrepliedCount > 0 ? "amber" : "default"}
        />
        <MetricCard
          label="Published Replies"
          value={String(repliedCount)}
          sublabel="Visible on Google Maps"
        />
        <MetricCard
          label="Low Rating Alerts"
          value={String(lowRatingCount)}
          sublabel="1–3 star reviews"
          accent={lowRatingCount > 0 ? "ruby" : "default"}
        />
      </div>

      {ctx.activeGbpConn ? (
        <div className="rounded-2xl border border-[var(--brand)]/25 bg-[var(--brand-surface)] p-4 text-[13px]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                <GoogleGLogo className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-[var(--ink)]">{ctx.connectedBusinessName}</span>
                  <StatusPill
                    label={ctx.isVerifiedGbpLocation ? "GBP Verified" : "Google Connected"}
                    tone={ctx.isVerifiedGbpLocation ? "emerald" : "amber"}
                  />
                </div>
                <div className="text-xs text-[var(--ink-secondary)]">
                  {ctx.gbpMeta?.driveEmail || "Connected account"}
                  {ctx.connectedCategory ? ` • ${ctx.connectedCategory}` : ""}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {ctx.gbpMeta?.newReviewUri && (
                <CopyTextButton
                  text={ctx.gbpMeta.newReviewUri}
                  label="Copy Review Link"
                  copiedLabel="Copied Link"
                />
              )}
              {ctx.gbpMeta?.mapsUri && (
                <a
                  href={ctx.gbpMeta.mapsUri}
                  target="_blank"
                  rel="noreferrer"
                  className="rsl-btn-secondary py-1.5 text-xs"
                >
                  Open on Google Maps ↗
                </a>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5 text-[13px]">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-inset)]">
              <GoogleGLogo className="h-4 w-4" />
            </span>
            <div>
              <div className="font-bold text-[var(--ink)]">
                Connect your Google Business Profile for live review sync
              </div>
              <div className="text-xs text-[var(--ink-muted)]">
                Sign in with the Google account managing your Google Maps listing.
              </div>
            </div>
          </div>
          {ctx.canManageConnections ? (
            <ConnectToGoogleDriveButton
              purpose="google_business"
              returnTo="/reviews"
              label="Connect Google Business"
              size="sm"
              configured={ctx.googleOAuth.enableGbpOAuth}
            />
          ) : (
            <Link href="/connections/google-business" className="rsl-btn-secondary py-1.5 text-xs">
              View Connection
            </Link>
          )}
        </div>
      )}

      <SectionCard
        title={`Customer Reviews (${filteredReviews.length})`}
        subtitle="Reply publicly or prepare smart AI response drafts"
        action={
          <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] p-0.5 text-[11.5px]">
            {filterTabs.map((tab) => (
              <ActionLink
                key={tab.key}
                href={tab.key === "all" ? "/reviews" : `/reviews?filter=${tab.key}`}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
                  filter === tab.key
                    ? "bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)]"
                    : "text-[var(--ink-secondary)] hover:text-[var(--ink)]"
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
              ctx.allReviews.length === 0
                ? "No Google Business reviews synced yet"
                : "No reviews match this filter"
            }
            description={
              ctx.allReviews.length === 0
                ? "Connect Google Business Profile or log an offline review on the Stats & Automation tab."
                : "Switch back to All reviews to view your full rating history."
            }
            actionLabel={ctx.allReviews.length === 0 ? "Connect Google Business" : "View All Reviews"}
            actionHref={ctx.allReviews.length === 0 ? "/connections/google-business" : "/reviews"}
          />
        ) : (
          <div className="space-y-4">
            {filteredReviews.map((rev) => {
              const isReplied = rev.replyStatus === "replied";
              const isDraftReady = rev.replyStatus === "draft_ready";
              const isLiveGbpReview = !rev.externalReviewId.startsWith("gbp_");

              return (
                <div
                  key={rev.id}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface-inset)] p-4 text-[13px]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-[var(--ink)]">{rev.reviewerName}</span>
                      <span className="text-[var(--warning)]">{"★".repeat(rev.rating)}</span>
                      <span className="text-xs text-[var(--ink-muted)]">• {rev.locationName}</span>
                      {isLiveGbpReview && <StatusPill label="Google Maps" tone="emerald" />}
                      <span className="text-xs text-[var(--ink-muted)]">
                        •{" "}
                        {new Date(rev.reviewedAt).toLocaleDateString("en-IN", {
                          timeZone: "Asia/Kolkata",
                        })}
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
                  <p className="mt-2 leading-relaxed text-[var(--ink-secondary)]">{rev.comment}</p>

                  {isReplied && rev.publishedReplyText ? (
                    <div className="mt-3 rounded-xl border border-[var(--success)]/30 bg-[var(--success-surface)] p-3.5">
                      <div className="text-xs font-semibold text-[var(--success)]">
                        Your Published Reply
                      </div>
                      <p className="mt-1 text-[var(--ink)]">{rev.publishedReplyText}</p>
                    </div>
                  ) : !ctx.canReplyReviews ? (
                    <div className="mt-3 text-xs text-[var(--ink-muted)]">
                      Read-only view - support executive or manager reply access required.
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-start gap-2.5">
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
                        <SubmitButton pendingText="Publishing..." className="rsl-btn-primary shrink-0">
                          {isDraftReady ? "Approve & Publish Reply" : "Publish Reply"}
                        </SubmitButton>
                      </form>

                      {ctx.hasAutoReply && (
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
