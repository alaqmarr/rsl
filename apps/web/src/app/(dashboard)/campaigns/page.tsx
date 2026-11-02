import {
  getWorkspacePlansByKeys,
  hasActiveEntitlement,
  hasAnyActiveEntitlement,
} from "@rsl/billing";
import { formatInr } from "@rsl/core";
import { getMetaWorkspaceSummary } from "@rsl/meta";
import { canRoleAccessWebRoute, canRolePerform, formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, PageHeader, SectionCard, StatusPill } from "@rsl/ui";
import { FeaturePlanGate, InlineAddonPlanBanner } from "@/components/feature-plan-gate";
import { FlashBanner } from "@/components/flash-banner";
import { SubmitButton } from "@/components/ios-feedback";
import {
  createCampaignAction,
  deleteScheduledPostAction,
  publishScheduledPostAction,
  recordCampaignSnapshotAction,
  recordPixelEventAction,
  schedulePostAction,
  toggleCampaignAction,
} from "@/lib/actions";
import { requireWebSession } from "@/lib/session";

const CAMPAIGN_PLAN_KEYS = ["meta.ads", "meta.instagram", "meta.pages", "meta.pixel"];

export default async function CampaignsAndPostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/campaigns", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Ad Campaigns, Social Posts & Website Sales"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View ad campaigns, scheduled posts, or website sales"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  if (!hasAnyActiveEntitlement(session.workspace.id, CAMPAIGN_PLAN_KEYS)) {
    const plans = getWorkspacePlansByKeys(session.workspace.id, CAMPAIGN_PLAN_KEYS);
    return (
      <FeaturePlanGate
        pageTitle="Ad Campaigns, Social Posts & Website Sales"
        pageSubtitle="Track Facebook & Instagram ad spend against real linked sales, schedule social posts, and record website orders without duplicate counting."
        plans={plans}
        returnPath="/campaigns"
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  const canCreateAds = canRolePerform(session.roleSlug, "ads:create", session.workspace.id);
  const canPauseAds = canRolePerform(session.roleSlug, "ads:pause", session.workspace.id);
  const canDraftPosts =
    canRolePerform(session.roleSlug, "posts:create", session.workspace.id) ||
    canRolePerform(session.roleSlug, "posts:schedule", session.workspace.id);
  const canPublishPosts = canRolePerform(session.roleSlug, "posts:publish", session.workspace.id);
  const canManagePixel = canRolePerform(session.roleSlug, "pixel:manage", session.workspace.id);

  const hasAds = hasActiveEntitlement(session.workspace.id, "meta.ads");
  const hasSocial =
    hasActiveEntitlement(session.workspace.id, "meta.instagram") ||
    hasActiveEntitlement(session.workspace.id, "meta.pages");
  const hasPixel = hasActiveEntitlement(session.workspace.id, "meta.pixel");

  const adsPlan = getWorkspacePlansByKeys(session.workspace.id, ["meta.ads"])[0];
  const socialPlan = getWorkspacePlansByKeys(session.workspace.id, ["meta.instagram"])[0];
  const pixelPlan = getWorkspacePlansByKeys(session.workspace.id, ["meta.pixel"])[0];

  const meta = getMetaWorkspaceSummary(session.workspace.id);
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Daily Operations"
        title="Ad Campaigns, Social Posts & Website Sales"
        subtitle="Manage Facebook & Instagram ad budgets, schedule social posts, and track real website orders without duplicate counting."
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard title="Create Ad Campaign" subtitle="Track daily spend and linked sales in INR">
          {!hasAds && adsPlan ? (
            <InlineAddonPlanBanner plan={adsPlan} returnPath="/campaigns" />
          ) : !canCreateAds ? (
            <p className="text-[13px] text-zinc-500">
              Read-only role — your current role can monitor campaign performance and ROI below.
            </p>
          ) : (
            <form action={createCampaignAction} className="space-y-3.5 text-[13px]">
              <div>
                <label className="rsl-label">Campaign Name *</label>
                <input
                  name="name"
                  required
                  placeholder="e.g. Diwali Wholesale Leads"
                  className="rsl-input"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="rsl-label">Ad Channel</label>
                  <select name="channel" defaultValue="meta_ads" className="rsl-input">
                    <option value="meta_ads">Meta Ads (FB + IG)</option>
                    <option value="instagram">Instagram Boost</option>
                    <option value="facebook">Facebook Lead Ads</option>
                  </select>
                </div>
                <div>
                  <label className="rsl-label">Campaign Goal</label>
                  <select name="objective" defaultValue="messages" className="rsl-input">
                    <option value="messages">WhatsApp / DM Inquiries</option>
                    <option value="website_sales">Website Sales</option>
                    <option value="lead_generation">Lead Forms</option>
                    <option value="awareness">Local Reach</option>
                  </select>
                </div>
                <div>
                  <label className="rsl-label">Daily Budget (₹) *</label>
                  <input
                    name="dailyBudgetRupees"
                    type="number"
                    min="0"
                    step="1"
                    required
                    placeholder="1500"
                    className="rsl-input tabular-nums"
                  />
                </div>
              </div>
              <input type="hidden" name="startDateIso" value={todayIso} />
              <SubmitButton pendingText="Launching..." className="rsl-btn-primary">
                Launch Campaign
              </SubmitButton>
            </form>
          )}
        </SectionCard>

        <SectionCard
          title="Record Daily Campaign Performance"
          subtitle="Updates your Detailed Analytics charts and Return per ₹1 Spent"
        >
          {!hasAds && adsPlan ? (
            <p className="text-[13px] text-zinc-500">
              Unlock Facebook &amp; Instagram Ad Campaigns on the left to record daily campaign
              results.
            </p>
          ) : !canCreateAds ? (
            <p className="text-[13px] text-zinc-500">
              Daily metrics can be recorded by Marketing Managers, Admins, or Business Owners.
            </p>
          ) : meta.campaigns.length === 0 ? (
            <p className="text-[13px] text-zinc-500">
              Create an ad campaign first to record daily metrics.
            </p>
          ) : (
            <form action={recordCampaignSnapshotAction} className="space-y-3.5 text-[13px]">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="rsl-label">Campaign *</label>
                  <select name="campaignId" required className="rsl-input">
                    {meta.campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="rsl-label">Date *</label>
                  <input
                    name="dayKey"
                    type="date"
                    defaultValue={todayIso}
                    required
                    className="rsl-input tabular-nums"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                <div>
                  <label className="rsl-label">Spend (₹)</label>
                  <input
                    name="spendRupees"
                    type="number"
                    min="0"
                    placeholder="0"
                    required
                    className="rsl-input tabular-nums"
                  />
                </div>
                <div>
                  <label className="rsl-label">Sales (₹)</label>
                  <input
                    name="revenueRupees"
                    type="number"
                    min="0"
                    placeholder="0"
                    required
                    className="rsl-input tabular-nums"
                  />
                </div>
                <div>
                  <label className="rsl-label">Views</label>
                  <input
                    name="impressions"
                    type="number"
                    min="0"
                    placeholder="0"
                    required
                    className="rsl-input tabular-nums"
                  />
                </div>
                <div>
                  <label className="rsl-label">Clicks</label>
                  <input
                    name="clicks"
                    type="number"
                    min="0"
                    placeholder="0"
                    required
                    className="rsl-input tabular-nums"
                  />
                </div>
                <div>
                  <label className="rsl-label">Orders</label>
                  <input
                    name="conversions"
                    type="number"
                    min="0"
                    placeholder="0"
                    required
                    className="rsl-input tabular-nums"
                  />
                </div>
              </div>
              <SubmitButton pendingText="Saving..." className="rsl-btn-primary">
                Save Daily Metrics
              </SubmitButton>
            </form>
          )}
        </SectionCard>
      </div>

      {hasAds && (
        <SectionCard title={`Campaigns (${meta.campaigns.length})`} noPadding>
          {meta.campaigns.length === 0 ? (
            <div className="p-6 text-[13px] text-zinc-500">No ad campaigns created yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-zinc-200/80 bg-zinc-50/75 text-[11px] tracking-wider text-zinc-500 uppercase">
                  <tr>
                    <th className="px-5 py-3 font-semibold sm:px-6">Campaign</th>
                    <th className="px-4 py-3 font-semibold">Daily Budget</th>
                    <th className="px-4 py-3 font-semibold">Total Spend</th>
                    <th className="px-4 py-3 font-semibold">Sales Linked</th>
                    <th className="px-4 py-3 font-semibold">Return / ₹1</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 text-right font-semibold sm:px-6">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {meta.campaigns.map((c) => {
                    const ratio =
                      c.totalSpendPaise > 0
                        ? (c.attributedRevenuePaise / c.totalSpendPaise).toFixed(2)
                        : "0.00";
                    return (
                      <tr key={c.id}>
                        <td className="px-5 py-3.5 font-semibold text-slate-900 sm:px-6">
                          {c.name}
                        </td>
                        <td className="px-4 py-3.5 text-zinc-700 tabular-nums">
                          {formatInr(c.dailyBudgetPaise)}
                        </td>
                        <td className="px-4 py-3.5 text-zinc-700 tabular-nums">
                          {formatInr(c.totalSpendPaise)}
                        </td>
                        <td className="px-4 py-3.5 font-semibold text-slate-900 tabular-nums">
                          {formatInr(c.attributedRevenuePaise)}
                        </td>
                        <td className="px-4 py-3.5 font-medium text-emerald-700 tabular-nums">
                          ₹{ratio}
                        </td>
                        <td className="px-4 py-3.5">
                          <StatusPill
                            label={c.status}
                            tone={c.status === "active" ? "emerald" : "stone"}
                          />
                        </td>
                        <td className="px-5 py-3.5 text-right sm:px-6">
                          {canPauseAds ? (
                            <form action={toggleCampaignAction} className="inline">
                              <input type="hidden" name="campaignId" value={c.id} />
                              <input
                                type="hidden"
                                name="status"
                                value={c.status === "active" ? "paused" : "active"}
                              />
                              <SubmitButton spinnerSize="xs" className="rsl-btn-secondary">
                                {c.status === "active" ? "Pause" : "Resume"}
                              </SubmitButton>
                            </form>
                          ) : (
                            <span className="text-xs text-zinc-400">Read-only</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard
          title="Schedule Social Post"
          subtitle="Instagram, Facebook Page, or Google Business Update"
        >
          {!hasSocial && socialPlan ? (
            <InlineAddonPlanBanner plan={socialPlan} returnPath="/campaigns" />
          ) : (
            <>
              {canDraftPosts ? (
                <form action={schedulePostAction} className="space-y-3.5 text-[13px]">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="rsl-label">Social Channel</label>
                      <select name="channel" defaultValue="instagram_feed" className="rsl-input">
                        <option value="instagram_feed">Instagram Feed</option>
                        <option value="instagram_reel">Instagram Reel</option>
                        <option value="facebook_page">Facebook Page</option>
                        <option value="google_post">Google Business Post</option>
                      </select>
                    </div>
                    <div>
                      <label className="rsl-label">Scheduled Date *</label>
                      <input
                        name="scheduledForIso"
                        type="date"
                        defaultValue={todayIso}
                        required
                        className="rsl-input tabular-nums"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="rsl-label">Post Caption *</label>
                    <textarea
                      name="caption"
                      rows={2}
                      required
                      placeholder="Write your post caption..."
                      className="rsl-input"
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {canPublishPosts ? (
                      <label className="inline-flex items-center gap-2 text-[12.5px] text-zinc-600">
                        <input
                          type="checkbox"
                          name="publishNow"
                          className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <span>Publish immediately</span>
                      </label>
                    ) : (
                      <span className="text-xs text-zinc-500">Scheduled as draft</span>
                    )}
                    <SubmitButton pendingText="Saving..." className="rsl-btn-primary">
                      Save Post
                    </SubmitButton>
                  </div>
                </form>
              ) : (
                <p className="text-[13px] text-zinc-500">
                  Read-only role — view scheduled and published social posts below.
                </p>
              )}

              {meta.posts.length > 0 && (
                <ul className="mt-4 divide-y divide-zinc-100 text-[13px]">
                  {meta.posts.slice(0, 8).map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-2.5 py-3"
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="truncate font-medium text-slate-900">{p.caption}</div>
                        <div className="mt-0.5 text-xs text-zinc-500 tabular-nums">
                          {p.channel.replace(/_/g, " ")} •{" "}
                          {p.status === "published" && p.publishedAt
                            ? `Published ${new Date(p.publishedAt).toLocaleDateString("en-IN")}`
                            : `Scheduled for ${new Date(p.scheduledFor).toLocaleDateString("en-IN")}`}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill
                          label={p.status}
                          tone={p.status === "published" ? "emerald" : "sky"}
                        />
                        {p.status !== "published" && canPublishPosts && (
                          <form action={publishScheduledPostAction} className="inline">
                            <input type="hidden" name="postId" value={p.id} />
                            <SubmitButton
                              spinnerSize="xs"
                              pendingText="Publishing..."
                              className="rsl-btn-secondary py-1 text-xs"
                            >
                              Publish Now
                            </SubmitButton>
                          </form>
                        )}
                        {canDraftPosts && (
                          <form action={deleteScheduledPostAction} className="inline">
                            <input type="hidden" name="postId" value={p.id} />
                            <SubmitButton
                              spinnerSize="xs"
                              pendingText="Removing..."
                              className="rsl-btn-danger-soft py-1 text-xs"
                            >
                              Remove
                            </SubmitButton>
                          </form>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </SectionCard>

        <SectionCard
          title="Website Sales Tracking"
          subtitle="Automatically prevents duplicate order counting using Order ID"
        >
          {!hasPixel && pixelPlan ? (
            <InlineAddonPlanBanner plan={pixelPlan} returnPath="/campaigns" />
          ) : (
            <>
              {canManagePixel ? (
                <form action={recordPixelEventAction} className="space-y-3.5 text-[13px]">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="rsl-label">Order ID *</label>
                      <input
                        name="eventId"
                        required
                        placeholder="ORD-901"
                        className="rsl-input font-mono"
                      />
                    </div>
                    <div>
                      <label className="rsl-label">Event Type</label>
                      <select name="eventName" defaultValue="Purchase" className="rsl-input">
                        <option value="Purchase">Purchase</option>
                        <option value="Lead">Lead</option>
                        <option value="AddToCart">Add to Cart</option>
                      </select>
                    </div>
                    <div>
                      <label className="rsl-label">Order Value (₹)</label>
                      <input
                        name="valueRupees"
                        type="number"
                        min="0"
                        placeholder="0"
                        className="rsl-input tabular-nums"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="rsl-label">Customer Email or Phone (Optional)</label>
                    <div className="flex gap-2.5">
                      <input
                        name="customerIdentifier"
                        placeholder="Privacy-protected customer identifier"
                        className="rsl-input flex-1"
                      />
                      <SubmitButton pendingText="Recording..." className="rsl-btn-primary shrink-0">
                        Record Order
                      </SubmitButton>
                    </div>
                  </div>
                </form>
              ) : (
                <p className="text-[13px] text-zinc-500">
                  Read-only role — inspect recorded server-side website sales events below.
                </p>
              )}

              {meta.pixelEvents.length > 0 && (
                <ul className="mt-4 divide-y divide-zinc-100 text-[13px]">
                  {meta.pixelEvents.slice(0, 6).map((ev) => (
                    <li key={ev.id} className="flex items-center justify-between py-2.5">
                      <span>
                        <strong className="font-semibold text-slate-900">{ev.eventName}</strong> •{" "}
                        <span className="font-mono text-zinc-600">{ev.eventId}</span>
                      </span>
                      <span className="font-semibold text-slate-900 tabular-nums">
                        {formatInr(ev.valuePaise)} •{" "}
                        <span className="font-normal text-zinc-500">
                          {ev.matchQualityScore}% match
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
