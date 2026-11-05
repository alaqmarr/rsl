import Link from "next/link";
import { headers } from "next/headers";
import {
  getAdSpendVaultSummary,
  getWorkspacePlansByKeys,
  hasActiveEntitlement,
  hasAnyActiveEntitlement,
} from "@rsl/billing";
import {
  formatGoogleAdsCustomerId,
  listWorkspaceConnections,
} from "@rsl/connections";
import { formatInr, resolveEndpointsFromHeaders } from "@rsl/core";
import { getMetaWorkspaceSummary } from "@rsl/meta";
import { canRoleAccessWebRoute, canRolePerform, formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, MetricCard, PageHeader, SectionCard, StatusPill } from "@rsl/ui";
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
  syncLiveAdsInsightsAction,
  toggleCampaignAction,
  updateCampaignBudgetAction,
} from "@/lib/actions";
import { requireWebSession } from "@/lib/session";

const CAMPAIGN_PLAN_KEYS = [
  "meta.ads",
  "google.ads",
  "meta.instagram",
  "meta.pages",
  "meta.pixel",
];

function formatSyncStatusLabel(status: string): {
  label: string;
  tone: "emerald" | "amber" | "sky" | "ruby" | "stone";
} {
  switch (status) {
    case "live_synced":
      return { label: "Live API Active", tone: "emerald" };
    case "sandbox_simulated":
      return { label: "Sandbox Verified", tone: "sky" };
    case "vault_cap_reached":
      return { label: "Vault Cap Reached", tone: "amber" };
    case "sync_error":
      return { label: "Sync Attention", tone: "ruby" };
    default:
      return { label: "Local Draft", tone: "stone" };
  }
}

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
        pageTitle="Meta & Google Ads Studio, Social Posts & Conversions"
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
        pageTitle="Meta & Google Ads Studio, Social Posts & Conversions"
        pageSubtitle="Launch live Facebook, Instagram, and Google Search & Performance Max ad campaigns in INR, publish scheduled social posts, and dispatch server-side Meta CAPI conversions."
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

  const hasMetaAds = hasActiveEntitlement(session.workspace.id, "meta.ads");
  const hasGoogleAds = hasActiveEntitlement(session.workspace.id, "google.ads");
  const hasAnyAds = hasMetaAds || hasGoogleAds;
  const hasSocial =
    hasActiveEntitlement(session.workspace.id, "meta.instagram") ||
    hasActiveEntitlement(session.workspace.id, "meta.pages") ||
    hasActiveEntitlement(session.workspace.id, "google.reviews");
  const hasPixel = hasActiveEntitlement(session.workspace.id, "meta.pixel");

  const metaAdsPlan = getWorkspacePlansByKeys(session.workspace.id, ["meta.ads"])[0];
  const googleAdsPlan = getWorkspacePlansByKeys(session.workspace.id, ["google.ads"])[0];
  const socialPlan = getWorkspacePlansByKeys(session.workspace.id, ["meta.instagram"])[0];
  const pixelPlan = getWorkspacePlansByKeys(session.workspace.id, ["meta.pixel"])[0];

  const meta = getMetaWorkspaceSummary(session.workspace.id);
  const vault = getAdSpendVaultSummary(session.workspace.id);
  const { connections } = listWorkspaceConnections(session.workspace.id);
  const ep = resolveEndpointsFromHeaders(await headers());

  const metaAdsConn = connections.find((c) => c.channelKind === "meta_ads_pixel");
  const googleAdsConn = connections.find((c) => c.channelKind === "google_ads");
  const fbPageConn = connections.find((c) => c.channelKind === "facebook_page");
  const igConn = connections.find((c) => c.channelKind === "instagram_business");
  const gbpConn = connections.find((c) => c.channelKind === "google_business");

  const totalSpendPaise = meta.campaigns.reduce((s, c) => s + c.totalSpendPaise, 0);
  const totalRevenuePaise = meta.campaigns.reduce((s, c) => s + c.attributedRevenuePaise, 0);
  const activeCount = meta.campaigns.filter((c) => c.status === "active").length;
  const blendedRoas =
    totalSpendPaise > 0 ? (totalRevenuePaise / totalSpendPaise).toFixed(2) : "0.00";

  const todayIso = new Date().toISOString().slice(0, 10);
  const defaultDateTimeLocal = new Date(Date.now() + 3600_000).toISOString().slice(0, 16);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Growth & Ad Spend Studio"
        title="Meta & Google Ads Studio, Social Posts & Conversions"
        subtitle="Launch live Facebook, Instagram, and Google Search & Performance Max ads using your own connected ad account or the 0-overdraft Managed Ad Spend Vault."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {hasAnyAds && (
              <form action={syncLiveAdsInsightsAction}>
                <SubmitButton
                  spinnerSize="xs"
                  pendingText="Syncing Live APIs..."
                  className="rsl-btn-secondary"
                >
                  Sync Live Ad Spend &amp; Insights
                </SubmitButton>
              </form>
            )}
            <Link href="/connections?tab=meta_ads_pixel" className="rsl-btn-secondary">
              Connected Ad Accounts
            </Link>
            <Link href="/billing?tab=wallet" className="rsl-btn-primary">
              Fund Ad Spend Vault ({formatInr(vault.availablePaise)})
            </Link>
          </div>
        }
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      {/* Live Metrics & Vault Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Active Campaigns"
          value={`${activeCount} / ${meta.campaigns.length}`}
          sublabel="Live across Meta & Google Ads"
        />
        <MetricCard
          label="Total Tracked Ad Spend"
          value={formatInr(totalSpendPaise)}
          sublabel="Synced from Insights & GAQL"
        />
        <MetricCard
          label="Attributed Sales"
          value={formatInr(totalRevenuePaise)}
          sublabel="Linked revenue in INR"
        />
        <MetricCard
          label="Return per ₹1 Spent"
          value={`₹${blendedRoas}`}
          sublabel="Blended ROAS across channels"
        />
        <MetricCard
          label="Ad Spend Vault (0-Overdraft)"
          value={formatInr(vault.availablePaise, { showDecimals: true })}
          sublabel={`Allocated to ads: ${formatInr(vault.netAllocatedToCampaignsPaise)}`}
        />
      </div>

      {/* Connected Ad Accounts Status Strip */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200/90 bg-white px-4 py-3 text-[13px]">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">
              Meta Ads Account (FB + IG)
            </div>
            <div className="mt-0.5 truncate font-semibold text-slate-900">
              {metaAdsConn
                ? `${metaAdsConn.displayName} (${metaAdsConn.metadata.adAccountId || metaAdsConn.externalAccountId})`
                : "Not connected (Direct Mode)"}
            </div>
          </div>
          <Link
            href="/connections?tab=meta_ads_pixel"
            className="shrink-0 text-xs font-semibold text-emerald-700 hover:underline"
          >
            {metaAdsConn ? "Manage" : "Connect →"}
          </Link>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200/90 bg-white px-4 py-3 text-[13px]">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">
              Google Ads Customer ID
            </div>
            <div className="mt-0.5 truncate font-semibold text-slate-900">
              {googleAdsConn
                ? `${googleAdsConn.displayName} (${formatGoogleAdsCustomerId(googleAdsConn.metadata.customerId || googleAdsConn.externalAccountId)})`
                : "Not connected (Direct Mode)"}
            </div>
          </div>
          <Link
            href="/connections?tab=google_ads"
            className="shrink-0 text-xs font-semibold text-emerald-700 hover:underline"
          >
            {googleAdsConn ? "Switch / Manage" : "Connect →"}
          </Link>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-200/90 bg-emerald-50/60 px-4 py-3 text-[13px]">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold tracking-wider text-emerald-800 uppercase">
              Managed Ad Spend Vault
            </div>
            <div className="mt-0.5 truncate font-semibold text-slate-900">
              {formatInr(vault.availablePaise, { showDecimals: true })} available • Strict ₹0 overdraft
            </div>
          </div>
          <Link
            href="/billing?tab=wallet"
            className="shrink-0 text-xs font-semibold text-emerald-800 hover:underline"
          >
            Deposit Funds →
          </Link>
        </div>
      </div>

      {/* Unified Ads Studio Launcher + Manual/Offline Snapshot */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="xl:col-span-8">
          <SectionCard
            title="Launch Live Meta or Google Ad Campaign"
            subtitle="Creates real Campaigns, Ad Sets / Ad Groups, Creatives, and Responsive Search Ads in INR"
          >
            {!hasAnyAds ? (
              <div className="space-y-3">
                {metaAdsPlan && (
                  <InlineAddonPlanBanner plan={metaAdsPlan} returnPath="/campaigns" />
                )}
                {googleAdsPlan && (
                  <InlineAddonPlanBanner plan={googleAdsPlan} returnPath="/campaigns" />
                )}
              </div>
            ) : !canCreateAds ? (
              <p className="text-[13px] text-zinc-500">
                Read-only role — your current role can monitor campaign spend, conversions, and ROAS below.
              </p>
            ) : (
              <form
                action={createCampaignAction}
                encType="multipart/form-data"
                className="space-y-4 text-[13px]"
              >
                {!hasGoogleAds && googleAdsPlan && (
                  <div className="rounded-xl border border-sky-200/80 bg-sky-50/60 px-3.5 py-2.5 text-xs text-slate-700">
                    Meta Ads is active. Want to run Google Search &amp; Performance Max campaigns too?{" "}
                    <Link
                      href="/billing"
                      className="font-semibold text-sky-800 underline hover:text-sky-900"
                    >
                      Unlock {googleAdsPlan.name} on Plans &amp; Wallet →
                    </Link>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="sm:col-span-2">
                    <label className="rsl-label">Campaign Name *</label>
                    <input
                      name="name"
                      required
                      placeholder="e.g. Mumbai Industrial Valves — Search & WhatsApp Leads"
                      className="rsl-input"
                    />
                  </div>

                  <div>
                    <label className="rsl-label">Ad Platform *</label>
                    <select
                      name="channel"
                      defaultValue={hasMetaAds ? "meta_ads" : "google_ads"}
                      className="rsl-input"
                    >
                      {hasMetaAds && (
                        <>
                          <option value="meta_ads">Meta Ads (Facebook + Instagram)</option>
                          <option value="instagram">Instagram Feed &amp; Reels Ads</option>
                          <option value="facebook">Facebook Lead &amp; Traffic Ads</option>
                        </>
                      )}
                      {hasGoogleAds && (
                        <option value="google_ads">Google Ads (Search &amp; Performance Max)</option>
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="rsl-label">Ad Spend Billing Mode *</label>
                    <select name="billingMode" defaultValue="direct_client" className="rsl-input">
                      <option value="direct_client">
                        Mode A: My Connected Ad Account (Direct UPI/Card)
                      </option>
                      <option value="rsl_managed_vault">
                        Mode B: RSL Managed Vault ({formatInr(vault.availablePaise)} avail • 0 Overdraft)
                      </option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className="rsl-label">Meta Objective (FB / IG)</label>
                    <select name="objective" defaultValue="messages" className="rsl-input">
                      <option value="messages">Click-to-WhatsApp / DM Inquiries</option>
                      <option value="lead_generation">Instant Lead Forms</option>
                      <option value="website_sales">Website Sales &amp; Conversions</option>
                      <option value="awareness">Local Brand Reach</option>
                    </select>
                  </div>

                  <div>
                    <label className="rsl-label">Google Ads Type (If Google)</label>
                    <select name="googleObjective" defaultValue="search_leads" className="rsl-input">
                      <option value="search_leads">Google Search — High-Intent Leads</option>
                      <option value="performance_max">Performance Max (Search + Maps + YouTube)</option>
                      <option value="call_ads">Search Call &amp; Store Visit Ads</option>
                      <option value="website_sales">Google Search — Website Sales</option>
                    </select>
                  </div>

                  <div>
                    <label className="rsl-label">Daily Budget (₹) *</label>
                    <input
                      name="dailyBudgetRupees"
                      type="number"
                      min="100"
                      step="1"
                      required
                      defaultValue={500}
                      className="rsl-input tabular-nums"
                    />
                  </div>

                  <div>
                    <label className="rsl-label">Vault Spend Cap (₹, Mode B Only)</label>
                    <input
                      name="vaultAllocationRupees"
                      type="number"
                      min="0"
                      step="1"
                      placeholder="e.g. 2500 (hard cutoff)"
                      className="rsl-input tabular-nums"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <label className="rsl-label">Ad Headline (30–60 chars)</label>
                    <input
                      name="headline"
                      maxLength={90}
                      placeholder="e.g. Authorised Industrial Supplier — Instant GST Quote"
                      className="rsl-input"
                    />
                  </div>

                  <div>
                    <label className="rsl-label">Landing URL (Website / Catalogue)</label>
                    <input
                      name="destinationUrl"
                      placeholder={session.workspace.website || "https://yourbusiness.in/enquiry"}
                      className="rsl-input"
                    />
                  </div>

                  <div>
                    <label className="rsl-label">Click-to-WhatsApp Number (Optional)</label>
                    <input
                      name="whatsappPhoneE164"
                      placeholder={session.workspace.businessPhone || "+919820000000"}
                      className="rsl-input font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="rsl-label">Primary Ad Copy / Search Description</label>
                  <textarea
                    name="primaryText"
                    rows={2}
                    maxLength={500}
                    placeholder="Highlight your offer, pricing advantage, delivery speed, and call to action..."
                    className="rsl-input"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className="rsl-label">Target Cities / States</label>
                    <input
                      name="targetLocations"
                      defaultValue="India"
                      placeholder="Mumbai, Pune, Gujarat"
                      className="rsl-input"
                    />
                  </div>

                  <div>
                    <label className="rsl-label">Google Search Keywords (Comma-sep)</label>
                    <input
                      name="targetKeywords"
                      placeholder="industrial valves, wholesale steel, buy pipes"
                      className="rsl-input"
                    />
                  </div>

                  <div>
                    <label className="rsl-label">Upload Creative Image / Video</label>
                    <input
                      name="mediaFile"
                      type="file"
                      accept="image/*,video/mp4,video/quicktime"
                      className="rsl-input py-1.5 text-xs"
                    />
                  </div>

                  <div>
                    <label className="rsl-label">Or Creative Media URL</label>
                    <input
                      name="mediaUrl"
                      placeholder="https://..."
                      className="rsl-input text-xs"
                    />
                  </div>
                </div>

                <input type="hidden" name="startDateIso" value={todayIso} />

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-3">
                  <label className="inline-flex items-center gap-2 text-xs text-zinc-600">
                    <input
                      type="checkbox"
                      name="allowDraftWhenDisconnected"
                      className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>
                      Save as local workspace draft if ad account is not connected yet (Direct Mode only)
                    </span>
                  </label>

                  <SubmitButton pendingText="Provisioning Live Ad..." className="rsl-btn-primary">
                    Launch Live Ad Campaign
                  </SubmitButton>
                </div>
              </form>
            )}
          </SectionCard>
        </div>

        <div className="xl:col-span-4">
          <SectionCard
            title="Log Offline Sales / Manual Daily Snapshot"
            subtitle="Link offline showroom or phone orders against any campaign for exact ROAS"
          >
            {!hasAnyAds ? (
              <p className="text-[13px] text-zinc-500">
                Activate Meta Ads or Google Ads to record campaign attribution snapshots.
              </p>
            ) : !canCreateAds ? (
              <p className="text-[13px] text-zinc-500">
                Daily metrics can be recorded by Marketing Managers, Admins, or Business Owners.
              </p>
            ) : meta.campaigns.length === 0 ? (
              <p className="text-[13px] text-zinc-500">
                Launch your first Meta or Google ad campaign on the left to record linked offline revenue.
              </p>
            ) : (
              <form action={recordCampaignSnapshotAction} className="space-y-3.5 text-[13px]">
                <div>
                  <label className="rsl-label">Campaign *</label>
                  <select name="campaignId" required className="rsl-input">
                    {meta.campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        [{c.channel === "google_ads" ? "GOOGLE" : "META"}] {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="rsl-label">Snapshot Date *</label>
                  <input
                    name="dayKey"
                    type="date"
                    defaultValue={todayIso}
                    required
                    className="rsl-input tabular-nums"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="rsl-label">Day Spend (₹)</label>
                    <input
                      name="spendRupees"
                      type="number"
                      min="0"
                      defaultValue={0}
                      required
                      className="rsl-input tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="rsl-label">Linked Sales (₹)</label>
                    <input
                      name="revenueRupees"
                      type="number"
                      min="0"
                      defaultValue={0}
                      required
                      className="rsl-input tabular-nums"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className="rsl-label">Impressions</label>
                    <input
                      name="impressions"
                      type="number"
                      min="0"
                      defaultValue={0}
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
                      defaultValue={0}
                      required
                      className="rsl-input tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="rsl-label">Conversions</label>
                    <input
                      name="conversions"
                      type="number"
                      min="0"
                      defaultValue={0}
                      required
                      className="rsl-input tabular-nums"
                    />
                  </div>
                </div>

                <SubmitButton pendingText="Saving..." className="rsl-btn-secondary w-full">
                  Save Attribution Snapshot
                </SubmitButton>
              </form>
            )}
          </SectionCard>
        </div>
      </div>

      {/* Active & Historical Campaigns Table */}
      {hasAnyAds && (
        <SectionCard
          title={`Ad Campaigns (${meta.campaigns.length})`}
          subtitle="Live status, billing mode, spend vs Managed Vault allocation, and inline budget controls"
          noPadding
        >
          {meta.campaigns.length === 0 ? (
            <div className="p-6 text-[13px] text-zinc-500">
              No Meta or Google ad campaigns launched yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-zinc-200/80 bg-zinc-50/75 text-[11px] tracking-wider text-zinc-500 uppercase">
                  <tr>
                    <th className="px-5 py-3 font-semibold sm:px-6">Campaign &amp; Creative</th>
                    <th className="px-3.5 py-3 font-semibold">Platform &amp; Billing</th>
                    <th className="px-3.5 py-3 font-semibold">Daily Budget</th>
                    <th className="px-3.5 py-3 font-semibold">Spend / Vault Cap</th>
                    <th className="px-3.5 py-3 font-semibold">Views / Clicks / Conv</th>
                    <th className="px-3.5 py-3 font-semibold">Sales &amp; ROAS</th>
                    <th className="px-3.5 py-3 font-semibold">Live Sync</th>
                    <th className="px-5 py-3 text-right font-semibold sm:px-6">Controls</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {meta.campaigns.map((c) => {
                    const ratio =
                      c.totalSpendPaise > 0
                        ? (c.attributedRevenuePaise / c.totalSpendPaise).toFixed(2)
                        : "0.00";
                    const syncMeta = formatSyncStatusLabel(c.syncStatus);
                    const isVault = c.billingMode === "rsl_managed_vault";
                    const vaultPct =
                      isVault && c.vaultAllocatedPaise > 0
                        ? Math.min(100, Math.round((c.totalSpendPaise / c.vaultAllocatedPaise) * 100))
                        : 0;

                    return (
                      <tr key={c.id} className="align-top">
                        <td className="px-5 py-3.5 sm:px-6">
                          <div className="font-semibold text-slate-900">{c.name}</div>
                          {c.headline && c.headline !== c.name && (
                            <div className="mt-0.5 text-xs text-zinc-600">{c.headline}</div>
                          )}
                          <div className="mt-1 text-[11px] text-zinc-400">
                            Goal: {c.objective.replace(/_/g, " ")}
                            {c.externalCampaignId ? ` • ID: ${c.externalCampaignId.slice(-18)}` : ""}
                          </div>
                        </td>

                        <td className="px-3.5 py-3.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusPill
                              label={
                                c.channel === "google_ads"
                                  ? "Google Ads"
                                  : c.channel === "instagram"
                                    ? "Instagram"
                                    : c.channel === "facebook"
                                      ? "Facebook"
                                      : "Meta Ads"
                              }
                              tone={c.channel === "google_ads" ? "sky" : "emerald"}
                            />
                            <StatusPill
                              label={isVault ? "Managed Vault" : "Direct Account"}
                              tone={isVault ? "amber" : "stone"}
                            />
                          </div>
                        </td>

                        <td className="px-3.5 py-3.5 tabular-nums">
                          <div className="font-semibold text-slate-900">
                            {formatInr(c.dailyBudgetPaise)}/day
                          </div>
                          {canCreateAds && c.status !== "completed" && (
                            <details className="mt-1 text-xs">
                              <summary className="cursor-pointer font-medium text-emerald-700 hover:underline">
                                Edit Budget
                              </summary>
                              <form
                                action={updateCampaignBudgetAction}
                                className="mt-2 flex flex-col gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 p-2"
                              >
                                <input type="hidden" name="campaignId" value={c.id} />
                                <input
                                  name="dailyBudgetRupees"
                                  type="number"
                                  min="50"
                                  defaultValue={Math.round(c.dailyBudgetPaise / 100)}
                                  placeholder="Daily ₹"
                                  className="rsl-input py-1 text-xs tabular-nums"
                                />
                                {isVault && (
                                  <input
                                    name="additionalVaultAllocationRupees"
                                    type="number"
                                    min="0"
                                    placeholder="+ Add Vault ₹"
                                    className="rsl-input py-1 text-xs tabular-nums"
                                  />
                                )}
                                <SubmitButton
                                  spinnerSize="xs"
                                  pendingText="..."
                                  className="rsl-btn-primary py-1 text-[11px]"
                                >
                                  Update Live
                                </SubmitButton>
                              </form>
                            </details>
                          )}
                        </td>

                        <td className="px-3.5 py-3.5 tabular-nums">
                          <div className="font-semibold text-slate-900">
                            {formatInr(c.totalSpendPaise)}
                          </div>
                          {isVault && c.vaultAllocatedPaise > 0 && (
                            <div className="mt-1 w-32">
                              <div className="flex justify-between text-[10px] text-zinc-500">
                                <span>{vaultPct}% of cap</span>
                                <span>{formatInr(c.vaultAllocatedPaise)}</span>
                              </div>
                              <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
                                <div
                                  className={`h-full rounded-full ${vaultPct >= 100 ? "bg-amber-600" : "bg-emerald-600"}`}
                                  style={{ width: `${vaultPct}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </td>

                        <td className="px-3.5 py-3.5 text-xs text-zinc-700 tabular-nums">
                          <div>{c.impressions.toLocaleString("en-IN")} views</div>
                          <div>
                            {c.clicks.toLocaleString("en-IN")} clicks •{" "}
                            <strong className="text-slate-900">{c.conversions}</strong> conv
                          </div>
                        </td>

                        <td className="px-3.5 py-3.5 tabular-nums">
                          <div className="font-semibold text-slate-900">
                            {formatInr(c.attributedRevenuePaise)}
                          </div>
                          <div className="text-xs font-medium text-emerald-700">₹{ratio} / ₹1</div>
                        </td>

                        <td className="px-3.5 py-3.5">
                          <div className="flex flex-col items-start gap-1">
                            <StatusPill
                              label={c.status}
                              tone={
                                c.status === "active"
                                  ? "emerald"
                                  : c.status === "completed"
                                    ? "stone"
                                    : "amber"
                              }
                            />
                            <StatusPill label={syncMeta.label} tone={syncMeta.tone} />
                          </div>
                          {c.lastSyncMessage && (
                            <div
                              className="mt-1 max-w-[210px] truncate text-[11px] text-zinc-500"
                              title={c.lastSyncMessage}
                            >
                              {c.lastSyncMessage}
                            </div>
                          )}
                        </td>

                        <td className="px-5 py-3.5 text-right sm:px-6">
                          {canPauseAds && c.status !== "completed" ? (
                            <div className="flex flex-wrap justify-end gap-1.5">
                              <form action={toggleCampaignAction} className="inline">
                                <input type="hidden" name="campaignId" value={c.id} />
                                <input type="hidden" name="channel" value={c.channel} />
                                <input
                                  type="hidden"
                                  name="status"
                                  value={c.status === "active" ? "paused" : "active"}
                                />
                                <SubmitButton
                                  spinnerSize="xs"
                                  className="rsl-btn-secondary py-1 text-xs"
                                >
                                  {c.status === "active" ? "Pause" : "Resume"}
                                </SubmitButton>
                              </form>

                              {isVault && c.vaultAllocatedPaise > c.totalSpendPaise && (
                                <form action={toggleCampaignAction} className="inline">
                                  <input type="hidden" name="campaignId" value={c.id} />
                                  <input type="hidden" name="channel" value={c.channel} />
                                  <input type="hidden" name="status" value="completed" />
                                  <SubmitButton
                                    spinnerSize="xs"
                                    className="rsl-btn-secondary py-1 text-xs"
                                  >
                                    End &amp; Refund Unspent
                                  </SubmitButton>
                                </form>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-zinc-400">
                              {c.status === "completed" ? "Completed" : "Read-only"}
                            </span>
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

      {/* Live Social Post Composer + Website Sales Pixel & Meta CAPI */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard
          title="Live Social Post Composer & Scheduler"
          subtitle="Publishes directly to Facebook Pages, Instagram Feed & Reels, and Google Business Profile"
        >
          {!hasSocial && socialPlan ? (
            <InlineAddonPlanBanner plan={socialPlan} returnPath="/campaigns" />
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-zinc-600">
                <span>Connected channels:</span>
                <StatusPill
                  label={fbPageConn ? `FB: ${fbPageConn.displayName}` : "FB Page Not Linked"}
                  tone={fbPageConn ? "emerald" : "stone"}
                />
                <StatusPill
                  label={igConn ? `IG: ${igConn.displayName}` : "IG Not Linked"}
                  tone={igConn ? "emerald" : "stone"}
                />
                <StatusPill
                  label={gbpConn ? `GBP: ${gbpConn.displayName}` : "GBP Not Linked"}
                  tone={gbpConn ? "emerald" : "stone"}
                />
              </div>

              {canDraftPosts ? (
                <form
                  action={schedulePostAction}
                  encType="multipart/form-data"
                  className="space-y-3.5 text-[13px]"
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="rsl-label">Social Channel *</label>
                      <select name="channel" defaultValue="facebook_page" className="rsl-input">
                        <option value="facebook_page">Facebook Page (Feed / Photo)</option>
                        <option value="instagram_feed">Instagram Feed (Image Required)</option>
                        <option value="instagram_reel">Instagram Reel (MP4 Video Required)</option>
                        <option value="google_post">Google Business Local Post (Maps &amp; Search)</option>
                      </select>
                    </div>
                    <div>
                      <label className="rsl-label">Scheduled Date &amp; Time *</label>
                      <input
                        name="scheduledForIso"
                        type="datetime-local"
                        defaultValue={defaultDateTimeLocal}
                        required
                        className="rsl-input tabular-nums"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="rsl-label">Post Caption / Update Summary *</label>
                    <textarea
                      name="caption"
                      rows={3}
                      required
                      placeholder="Write your post caption, festive offer, or Google Maps store update..."
                      className="rsl-input"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="rsl-label">Upload Image / MP4 Reel</label>
                      <input
                        name="mediaFile"
                        type="file"
                        accept="image/*,video/mp4,video/quicktime"
                        className="rsl-input py-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="rsl-label">Or Public Media URL</label>
                      <input
                        name="mediaUrl"
                        placeholder="https://..."
                        className="rsl-input text-xs"
                      />
                    </div>
                    <div>
                      <label className="rsl-label">CTA Link (FB / Google Post)</label>
                      <input
                        name="ctaUrl"
                        placeholder="https://yourstore.in/offer"
                        className="rsl-input text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    {canPublishPosts ? (
                      <label className="inline-flex items-center gap-2 text-[12.5px] text-zinc-700">
                        <input
                          type="checkbox"
                          name="publishNow"
                          className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <span>Publish live immediately right now</span>
                      </label>
                    ) : (
                      <span className="text-xs text-zinc-500">Scheduled for automatic publishing</span>
                    )}
                    <SubmitButton pendingText="Publishing / Saving..." className="rsl-btn-primary">
                      Save / Publish Post
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
                  {meta.posts.slice(0, 10).map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-start justify-between gap-2.5 py-3"
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="truncate font-medium text-slate-900">{p.caption}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500 tabular-nums">
                          <span className="font-semibold text-zinc-700 uppercase">
                            {p.channel.replace(/_/g, " ")}
                          </span>
                          <span>•</span>
                          <span>
                            {p.status === "published" && p.publishedAt
                              ? `Published ${new Date(p.publishedAt).toLocaleString("en-IN")}`
                              : `Scheduled ${new Date(p.scheduledFor).toLocaleString("en-IN")}`}
                          </span>
                          {p.externalPermalink && (
                            <a
                              href={p.externalPermalink}
                              target="_blank"
                              rel="noreferrer"
                              className="font-semibold text-emerald-700 hover:underline"
                            >
                              View Live Post ↗
                            </a>
                          )}
                        </div>
                        {p.lastError && (
                          <div className="mt-1 text-[11px] text-amber-800">{p.lastError}</div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill
                          label={p.status}
                          tone={
                            p.status === "published"
                              ? "emerald"
                              : p.status === "failed"
                                ? "ruby"
                                : "sky"
                          }
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
          title="Website Sales Pixel & Live Meta Conversions API (CAPI)"
          subtitle="Deduplicates orders by Event ID and dispatches SHA-256 hashed conversions directly to Meta Pixel"
        >
          {!hasPixel && pixelPlan ? (
            <InlineAddonPlanBanner plan={pixelPlan} returnPath="/campaigns" />
          ) : (
            <>
              <div className="mb-3 rounded-xl border border-zinc-200/80 bg-zinc-50/80 p-3 text-xs text-zinc-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">
                    Server-Side REST Ingest Endpoint (Shopify / WooCommerce / Custom Checkout)
                  </span>
                  <StatusPill
                    label={
                      metaAdsConn?.metadata.pixelId
                        ? `Meta Pixel ${metaAdsConn.metadata.pixelId} Linked`
                        : "Connect Meta Pixel for Live CAPI"
                    }
                    tone={metaAdsConn?.metadata.pixelId ? "emerald" : "amber"}
                  />
                </div>
                <code className="mt-1.5 block overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 font-mono text-[11px] text-emerald-300">
                  {`POST ${ep.effectiveAppBaseUrl}/api/v1/pixel/events  (Authorization: Bearer rsl_live_...)`}
                </code>
              </div>

              {canManagePixel ? (
                <form action={recordPixelEventAction} className="space-y-3.5 text-[13px]">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="rsl-label">Order / Event ID *</label>
                      <input
                        name="eventId"
                        required
                        placeholder="ORD-2026-901"
                        className="rsl-input font-mono"
                      />
                    </div>
                    <div>
                      <label className="rsl-label">Conversion Event</label>
                      <select name="eventName" defaultValue="Purchase" className="rsl-input">
                        <option value="Purchase">Purchase</option>
                        <option value="Lead">Lead</option>
                        <option value="AddToCart">Add to Cart</option>
                        <option value="ViewContent">View Content</option>
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

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="rsl-label">Customer Email or +91 Phone (SHA-256 Hashed)</label>
                      <input
                        name="customerIdentifier"
                        placeholder="buyer@company.in or +919820000000"
                        className="rsl-input"
                      />
                    </div>
                    <div>
                      <label className="rsl-label">Checkout Page URL (Optional)</label>
                      <div className="flex gap-2">
                        <input
                          name="sourceUrl"
                          placeholder="https://yourstore.in/thank-you"
                          className="rsl-input flex-1"
                        />
                        <SubmitButton
                          pendingText="Sending..."
                          className="rsl-btn-primary shrink-0"
                        >
                          Record &amp; Send CAPI
                        </SubmitButton>
                      </div>
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
                  {meta.pixelEvents.slice(0, 8).map((ev) => (
                    <li
                      key={ev.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                    >
                      <div className="min-w-0">
                        <div>
                          <strong className="font-semibold text-slate-900">{ev.eventName}</strong> •{" "}
                          <span className="font-mono text-zinc-600">{ev.eventId}</span>
                        </div>
                        {ev.capiResponseDetail && (
                          <div className="truncate text-[11px] text-zinc-500">
                            {ev.capiResponseDetail}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 tabular-nums">
                        <span className="font-semibold text-slate-900">
                          {formatInr(ev.valuePaise)}
                        </span>
                        <StatusPill
                          label={
                            ev.capiStatus === "sent_live"
                              ? "Meta CAPI Sent"
                              : ev.capiStatus === "sandbox_simulated"
                                ? "Sandbox CAPI"
                                : ev.capiStatus === "failed"
                                  ? "CAPI Error"
                                  : `${ev.matchQualityScore}% Match`
                          }
                          tone={
                            ev.capiStatus === "sent_live"
                              ? "emerald"
                              : ev.capiStatus === "sandbox_simulated"
                                ? "sky"
                                : ev.capiStatus === "failed"
                                  ? "ruby"
                                  : "stone"
                          }
                        />
                      </div>
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
