import Link from "next/link";
import { formatGoogleAdsCustomerId } from "@rsl/connections";
import { formatInr } from "@rsl/core";
import { GuideDrawerButton, MetricCard, SectionCard, StatusPill } from "@rsl/ui";
import { InlineAddonPlanBanner } from "@/components/feature-plan-gate";
import { SubmitButton } from "@/components/ios-feedback";
import {
  createCampaignAction,
  deleteScheduledPostAction,
  publishScheduledPostAction,
  recordCampaignSnapshotAction,
  recordPixelEventAction,
  schedulePostAction,
  toggleCampaignAction,
  updateCampaignBudgetAction,
} from "@/lib/actions";
import type { CampaignsWorkspaceData } from "@/lib/campaigns-data";
import { filterCampaignsByPlatform } from "@/lib/campaigns-data";

function formatSyncStatusLabel(status: string): {
  label: string;
  tone: "emerald" | "amber" | "sky" | "ruby" | "stone";
} {
  switch (status) {
    case "synced":
      return { label: "Live Synced", tone: "emerald" };
    case "pending":
      return { label: "Pending Sync", tone: "sky" };
    case "sync_error":
      return { label: "Sync Issue", tone: "ruby" };
    case "local_draft":
    default:
      return { label: "Local Draft", tone: "stone" };
  }
}

export function CampaignsPlatformKpis({
  ctx,
  platform,
}: {
  ctx: CampaignsWorkspaceData;
  platform: "facebook" | "instagram" | "google_ads" | "all";
}) {
  const campaigns = filterCampaignsByPlatform(ctx.meta.campaigns, platform);
  const totalSpendPaise = campaigns.reduce((s, c) => s + c.totalSpendPaise, 0);
  const totalRevenuePaise = campaigns.reduce((s, c) => s + c.attributedRevenuePaise, 0);
  const activeCount = campaigns.filter((c) => c.status === "active").length;
  const blendedRoas =
    totalSpendPaise > 0 ? (totalRevenuePaise / totalSpendPaise).toFixed(2) : "0.00";

  return (
    <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
      <MetricCard
        label="Active Campaigns"
        value={String(activeCount)}
        sublabel={`${campaigns.length} total campaigns`}
        accent="emerald"
      />
      <MetricCard
        label="Total Ad Spend"
        value={formatInr(totalSpendPaise)}
        sublabel="Platform spend tracked"
      />
      <MetricCard
        label="Attributed Sales"
        value={formatInr(totalRevenuePaise)}
        sublabel={`ROAS ₹${blendedRoas} / ₹1`}
        accent="sky"
      />
      <MetricCard
        label="Ad Spend Vault"
        value={formatInr(ctx.vault.availablePaise, { showDecimals: true })}
        sublabel="Strict ₹0 overdraft cap"
        accent="amber"
      />
    </div>
  );
}

export function AdAccountConnectionBar({
  ctx,
  focus,
}: {
  ctx: CampaignsWorkspaceData;
  focus: "meta" | "google" | "all";
}) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      {(focus === "meta" || focus === "all") && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[13px]">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold tracking-wider text-[var(--ink-muted)] uppercase">
              Meta Ad Account (FB &amp; IG)
            </div>
            <div className="mt-0.5 truncate font-semibold text-[var(--ink)]">
              {ctx.metaAdsConn
                ? `${ctx.metaAdsConn.displayName} (${ctx.metaAdsConn.metadata.adAccountId || ctx.metaAdsConn.externalAccountId})`
                : "Not connected (Direct Mode)"}
            </div>
          </div>
          <Link
            href="/connections/meta-ads"
            className="shrink-0 text-xs font-semibold text-[var(--brand)] hover:underline"
          >
            {ctx.metaAdsConn ? "Manage" : "Connect →"}
          </Link>
        </div>
      )}

      {(focus === "google" || focus === "all") && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[13px]">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold tracking-wider text-[var(--ink-muted)] uppercase">
              Google Ads Customer ID
            </div>
            <div className="mt-0.5 truncate font-semibold text-[var(--ink)]">
              {ctx.googleAdsConn
                ? `${ctx.googleAdsConn.displayName} (${formatGoogleAdsCustomerId(ctx.googleAdsConn.metadata.customerId || ctx.googleAdsConn.externalAccountId)})`
                : "Not connected (Direct Mode)"}
            </div>
          </div>
          <Link
            href="/connections/google-ads"
            className="shrink-0 text-xs font-semibold text-[var(--brand)] hover:underline"
          >
            {ctx.googleAdsConn ? "Switch / Manage" : "Connect →"}
          </Link>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--brand)]/25 bg-[var(--brand-surface)] px-4 py-3 text-[13px]">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold tracking-wider text-[var(--brand)] uppercase">
            Managed Ad Spend Vault
          </div>
          <div className="mt-0.5 truncate font-semibold text-[var(--ink)]">
            {formatInr(ctx.vault.availablePaise, { showDecimals: true })} available • Strict ₹0 overdraft
          </div>
        </div>
        <Link
          href="/billing/wallet"
          className="shrink-0 text-xs font-semibold text-[var(--brand)] hover:underline"
        >
          Deposit Funds →
        </Link>
      </div>
    </div>
  );
}

export function AdCampaignLauncherSection({
  ctx,
  scope,
  returnPath,
  workspaceWebsite,
  workspacePhone,
}: {
  ctx: CampaignsWorkspaceData;
  scope: "facebook" | "instagram" | "google_ads";
  returnPath: string;
  workspaceWebsite?: string | null;
  workspacePhone?: string | null;
}) {
  const isGoogle = scope === "google_ads";
  const hasEntitlement = isGoogle ? ctx.hasGoogleAds : ctx.hasMetaAds;
  const requiredPlan = isGoogle ? ctx.googleAdsPlan : ctx.metaAdsPlan;
  const defaultChannel =
    scope === "google_ads" ? "google_ads" : scope === "instagram" ? "instagram" : "facebook";

  return (
    <details
      open={filterCampaignsByPlatform(ctx.meta.campaigns, scope).length === 0}
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-semibold text-[var(--ink)] select-none sm:px-6">
        <div>
          <div>
            + Launch{" "}
            {scope === "google_ads"
              ? "Google Search / Performance Max Campaign"
              : scope === "instagram"
                ? "Instagram Feed & Reels Ad Campaign"
                : "Facebook & Meta Lead Ad Campaign"}
          </div>
          <div className="mt-0.5 text-xs font-normal text-[var(--ink-muted)]">
            Provision INR campaigns in Direct Ad Account Mode or Prepaid RSL Managed Vault
          </div>
        </div>
        <span className="rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-1 text-xs font-medium text-[var(--ink-secondary)]">
          Toggle Launcher
        </span>
      </summary>

      <div className="border-t border-[var(--border-subtle)] px-5 py-5 sm:px-6">
        {!hasEntitlement && requiredPlan ? (
          <InlineAddonPlanBanner plan={requiredPlan} returnPath={returnPath} />
        ) : !ctx.canCreateAds ? (
          <p className="text-[13px] text-[var(--ink-secondary)]">
            Read-only role - your current role can monitor campaign spend, conversions, and ROAS
            below.
          </p>
        ) : (
          <form
            action={createCampaignAction}
            encType="multipart/form-data"
            className="space-y-4 text-[13px]"
          >
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2">
                <label className="rsl-label">Campaign Name *</label>
                <input
                  name="name"
                  required
                  placeholder={
                    isGoogle
                      ? "e.g. Industrial Valves - High Intent Search"
                      : "e.g. Mumbai Showroom Festive WhatsApp Leads"
                  }
                  className="rsl-input"
                />
              </div>

              <div>
                <label className="rsl-label">Ad Platform *</label>
                <select name="channel" defaultValue={defaultChannel} className="rsl-input">
                  {scope === "facebook" && (
                    <>
                      <option value="facebook">Facebook Lead &amp; Traffic Ads</option>
                      <option value="meta_ads">Meta Advantage+ (FB + IG)</option>
                    </>
                  )}
                  {scope === "instagram" && (
                    <>
                      <option value="instagram">Instagram Feed &amp; Reels Ads</option>
                      <option value="meta_ads">Meta Advantage+ (IG + FB)</option>
                    </>
                  )}
                  {scope === "google_ads" && (
                    <option value="google_ads">Google Ads (Search &amp; Performance Max)</option>
                  )}
                </select>
              </div>

              <div>
                <label className="rsl-label">Ad Spend Billing Mode *</label>
                <select name="billingMode" defaultValue="direct_client" className="rsl-input">
                  <option value="direct_client">Mode A: My Connected Ad Account</option>
                  <option value="rsl_managed_vault">
                    Mode B: RSL Managed Vault ({formatInr(ctx.vault.availablePaise)} avail)
                  </option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
              {isGoogle ? (
                <div>
                  <label className="rsl-label">Google Ads Type</label>
                  <select name="googleObjective" defaultValue="search_leads" className="rsl-input">
                    <option value="search_leads">Google Search - High-Intent Leads</option>
                    <option value="performance_max">Performance Max (Search + Maps + YouTube)</option>
                    <option value="call_ads">Search Call &amp; Store Visit Ads</option>
                    <option value="website_sales">Google Search - Website Sales</option>
                  </select>
                </div>
              ) : (
                <div>
                  <label className="rsl-label">Meta Objective</label>
                  <select name="objective" defaultValue="messages" className="rsl-input">
                    <option value="messages">Click-to-WhatsApp / DM Inquiries</option>
                    <option value="lead_generation">Instant Lead Forms</option>
                    <option value="website_sales">Website Sales &amp; Conversions</option>
                    <option value="awareness">Local Brand Reach</option>
                  </select>
                </div>
              )}

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
                  placeholder="e.g. 2500"
                  className="rsl-input tabular-nums"
                />
              </div>

              <div>
                <label className="rsl-label">Target Cities / States</label>
                <input
                  name="targetLocations"
                  defaultValue="India"
                  placeholder="Mumbai, Pune, Gujarat"
                  className="rsl-input"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
              <div>
                <label className="rsl-label">Ad Headline (30–60 chars)</label>
                <input
                  name="headline"
                  maxLength={90}
                  placeholder="Authorised Supplier - Instant GST Quote"
                  className="rsl-input"
                />
              </div>
              <div>
                <label className="rsl-label">Landing URL</label>
                <input
                  name="destinationUrl"
                  placeholder={workspaceWebsite || "https://yourbusiness.in/enquiry"}
                  className="rsl-input"
                />
              </div>
              {isGoogle ? (
                <div>
                  <label className="rsl-label">Search Keywords (Comma-sep)</label>
                  <input
                    name="targetKeywords"
                    placeholder="industrial valves, wholesale steel"
                    className="rsl-input"
                  />
                </div>
              ) : (
                <div>
                  <label className="rsl-label">Click-to-WhatsApp Number (Optional)</label>
                  <input
                    name="whatsappPhoneE164"
                    placeholder={workspacePhone || "+919820000000"}
                    className="rsl-input font-mono"
                  />
                </div>
              )}
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

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
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
                <input name="mediaUrl" placeholder="https://..." className="rsl-input text-xs" />
              </div>
            </div>

            <input type="hidden" name="startDateIso" value={ctx.todayIso} />

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-3">
              <label className="inline-flex items-center gap-2 text-xs text-[var(--ink-secondary)]">
                <input
                  type="checkbox"
                  name="allowDraftWhenDisconnected"
                  className="h-4 w-4 rounded border-[var(--border)] text-[var(--brand)] focus:ring-[var(--brand)]"
                />
                <span>
                  Save as local draft if ad account is not connected yet (Direct Mode only)
                </span>
              </label>

              <SubmitButton pendingText="Provisioning Live Ad..." className="rsl-btn-primary">
                Launch Live Ad Campaign
              </SubmitButton>
            </div>
          </form>
        )}
      </div>
    </details>
  );
}

export function CampaignsPerformanceTable({
  ctx,
  platform,
  title,
}: {
  ctx: CampaignsWorkspaceData;
  platform: "facebook" | "instagram" | "google_ads" | "all";
  title?: string;
}) {
  const visibleCampaigns = filterCampaignsByPlatform(ctx.meta.campaigns, platform);

  return (
    <SectionCard
      title={title || `Campaign Performance (${visibleCampaigns.length})`}
      subtitle="Live spend, daily INR budgets, Vault limits, conversions, and ROAS"
      noPadding
    >
      {visibleCampaigns.length === 0 ? (
        <div className="p-6 text-[13px] text-[var(--ink-muted)]">
          No campaigns found in this channel yet. Open the launcher above to create your first live
          campaign or local draft.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-[var(--border)] bg-[var(--surface-inset)] text-[11px] tracking-wider text-[var(--ink-muted)] uppercase">
              <tr>
                <th className="px-5 py-3 font-semibold sm:px-6">Campaign &amp; Billing Mode</th>
                <th className="px-3.5 py-3 font-semibold">Daily Budget &amp; Spend</th>
                <th className="px-3.5 py-3 font-semibold">Views / Clicks / Conv</th>
                <th className="px-3.5 py-3 font-semibold">Sales &amp; ROAS</th>
                <th className="px-3.5 py-3 font-semibold">Sync Status</th>
                <th className="px-5 py-3 text-right font-semibold sm:px-6">Controls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {visibleCampaigns.map((c) => {
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
                  <tr key={c.id} className="hover:bg-[var(--surface-inset)]/60">
                    <td className="px-5 py-4 align-top sm:px-6">
                      <div className="font-semibold text-[var(--ink)]">{c.name}</div>
                      {c.headline && c.headline !== c.name && (
                        <div className="mt-0.5 text-xs text-[var(--ink-secondary)]">{c.headline}</div>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--ink-muted)]">
                        <span className="uppercase">{c.channel.replace(/_/g, " ")}</span>
                        {c.externalCampaignId && (
                          <span className="font-mono">• {c.externalCampaignId.slice(-14)}</span>
                        )}
                        <StatusPill
                          label={isVault ? "Managed Vault" : "Direct Account"}
                          tone={isVault ? "amber" : "stone"}
                        />
                      </div>
                    </td>
                    <td className="px-3.5 py-4 align-top tabular-nums">
                      <div className="font-semibold text-[var(--ink)]">
                        {formatInr(c.dailyBudgetPaise)}/day
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--ink-secondary)]">
                        Spent: {formatInr(c.totalSpendPaise)}
                      </div>
                      {isVault && c.vaultAllocatedPaise > 0 && (
                        <div className="mt-1 text-[11px] text-[var(--ink-muted)]">
                          Vault {vaultPct}% of {formatInr(c.vaultAllocatedPaise)}
                        </div>
                      )}
                      {ctx.canCreateAds && c.status !== "completed" && (
                        <details className="mt-1.5 text-xs">
                          <summary className="cursor-pointer font-medium text-[var(--brand)] hover:underline">
                            Edit Budget
                          </summary>
                          <form
                            action={updateCampaignBudgetAction}
                            className="mt-2 flex flex-col gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-inset)] p-2"
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
                            <SubmitButton spinnerSize="xs" className="rsl-btn-primary py-1 text-xs">
                              Save
                            </SubmitButton>
                          </form>
                        </details>
                      )}
                    </td>
                    <td className="px-3.5 py-4 align-top text-xs text-[var(--ink-secondary)] tabular-nums">
                      <div>{c.impressions.toLocaleString("en-IN")} views</div>
                      <div>
                        {c.clicks.toLocaleString("en-IN")} clicks •{" "}
                        <strong className="text-[var(--ink)]">{c.conversions}</strong> conv
                      </div>
                    </td>
                    <td className="px-3.5 py-4 align-top tabular-nums">
                      <div className="font-semibold text-[var(--ink)]">
                        {formatInr(c.attributedRevenuePaise)}
                      </div>
                      <div className="text-xs font-medium text-[var(--brand)]">₹{ratio} / ₹1</div>
                    </td>
                    <td className="px-3.5 py-4 align-top">
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
                        <StatusPill label={syncMeta.label} tone={syncMeta.tone} showDot={false} />
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right align-top sm:px-6">
                      {ctx.canPauseAds && c.status !== "completed" ? (
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
                                End &amp; Refund
                              </SubmitButton>
                            </form>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--ink-muted)]">
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
  );
}

export function OfflineSnapshotCollapsible({
  ctx,
  platform,
}: {
  ctx: CampaignsWorkspaceData;
  platform: "facebook" | "instagram" | "google_ads" | "all";
}) {
  const campaigns = filterCampaignsByPlatform(ctx.meta.campaigns, platform);
  if (!ctx.hasAnyAds || !ctx.canCreateAds || campaigns.length === 0) return null;

  return (
    <details className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-semibold text-[var(--ink)] select-none sm:px-6">
        <div>
          <div>Log Offline Showroom / Phone Order Revenue Snapshot</div>
          <div className="mt-0.5 text-xs font-normal text-[var(--ink-muted)]">
            Attribute walk-in or phone conversions to any campaign for exact blended ROAS
          </div>
        </div>
        <span className="rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-1 text-xs font-medium text-[var(--ink-secondary)]">
          Log Revenue
        </span>
      </summary>
      <div className="border-t border-[var(--border-subtle)] px-5 py-5 sm:px-6">
        <form action={recordCampaignSnapshotAction} className="grid grid-cols-1 gap-3.5 text-[13px] sm:grid-cols-3 lg:grid-cols-6">
          <div className="sm:col-span-2">
            <label className="rsl-label">Campaign *</label>
            <select name="campaignId" required className="rsl-input">
              {campaigns.map((c) => (
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
              defaultValue={ctx.todayIso}
              required
              className="rsl-input tabular-nums"
            />
          </div>
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
          <div className="flex items-end">
            <SubmitButton pendingText="Saving..." className="rsl-btn-secondary w-full">
              Save Snapshot
            </SubmitButton>
          </div>
          <input type="hidden" name="impressions" value={0} />
          <input type="hidden" name="clicks" value={0} />
          <input type="hidden" name="conversions" value={1} />
        </form>
      </div>
    </details>
  );
}

export function SocialPostsWorkspaceCard({
  ctx,
  scope,
  returnPath,
}: {
  ctx: CampaignsWorkspaceData;
  scope: "facebook" | "instagram";
  returnPath: string;
}) {
  const isInsta = scope === "instagram";
  const hasEntitlement = isInsta ? ctx.hasInsta : ctx.hasFbPage;
  const requiredPlan = isInsta ? ctx.instagramPlan : ctx.pagesPlan;
  const filteredPosts = ctx.meta.posts.filter((p) =>
    isInsta
      ? p.channel === "instagram_feed" || p.channel === "instagram_reel"
      : p.channel === "facebook_page"
  );

  return (
    <div className="space-y-6">
      <SectionCard
        title={isInsta ? "Schedule or Publish Instagram Post / Reel" : "Schedule or Publish Facebook Page Post"}
        subtitle={
          isInsta
            ? "Publish Photos or MP4 Reels directly to your linked Instagram Business account"
            : "Publish offers, showroom updates, and CTA links directly to your Facebook Page"
        }
        action={
          <StatusPill
            label={
              isInsta
                ? ctx.igConn
                  ? `IG: ${ctx.igConn.displayName}`
                  : "Instagram Not Connected"
                : ctx.fbPageConn
                  ? `FB Page: ${ctx.fbPageConn.displayName}`
                  : "Facebook Page Not Connected"
            }
            tone={(isInsta ? ctx.igConn : ctx.fbPageConn) ? "emerald" : "amber"}
          />
        }
      >
        {!hasEntitlement && requiredPlan ? (
          <InlineAddonPlanBanner plan={requiredPlan} returnPath={returnPath} />
        ) : !ctx.canDraftPosts ? (
          <p className="text-[13px] text-[var(--ink-secondary)]">
            Read-only role - view scheduled and published posts below.
          </p>
        ) : (
          <form
            action={schedulePostAction}
            encType="multipart/form-data"
            className="space-y-3.5 text-[13px]"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="rsl-label">Publishing Format *</label>
                <select
                  name="channel"
                  defaultValue={isInsta ? "instagram_feed" : "facebook_page"}
                  className="rsl-input"
                >
                  {isInsta ? (
                    <>
                      <option value="instagram_feed">Instagram Feed (Image Required)</option>
                      <option value="instagram_reel">Instagram Reel (MP4 Video Required)</option>
                    </>
                  ) : (
                    <option value="facebook_page">Facebook Page (Feed / Photo / Offer)</option>
                  )}
                </select>
              </div>
              <div>
                <label className="rsl-label">Scheduled Date &amp; Time *</label>
                <input
                  name="scheduledForIso"
                  type="datetime-local"
                  defaultValue={ctx.defaultDateTimeLocal}
                  required
                  className="rsl-input tabular-nums"
                />
              </div>
            </div>

            <div>
              <label className="rsl-label">Caption &amp; Hashtags *</label>
              <textarea
                name="caption"
                rows={3}
                required
                placeholder="Write your post caption, festive offer, or product announcement..."
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
                <input name="mediaUrl" placeholder="https://..." className="rsl-input text-xs" />
              </div>
              {!isInsta && (
                <div>
                  <label className="rsl-label">CTA Link</label>
                  <input
                    name="ctaUrl"
                    placeholder="https://yourstore.in/offer"
                    className="rsl-input text-xs"
                  />
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              {ctx.canPublishPosts ? (
                <label className="inline-flex items-center gap-2 text-[12.5px] text-[var(--ink-secondary)]">
                  <input
                    type="checkbox"
                    name="publishNow"
                    className="h-4 w-4 rounded border-[var(--border)] text-[var(--brand)] focus:ring-[var(--brand)]"
                  />
                  <span>Publish live immediately right now</span>
                </label>
              ) : (
                <span className="text-xs text-[var(--ink-muted)]">
                  Scheduled for automatic publishing
                </span>
              )}
              <SubmitButton pendingText="Publishing / Saving..." className="rsl-btn-primary">
                Save / Publish Post
              </SubmitButton>
            </div>
          </form>
        )}
      </SectionCard>

      <SectionCard
        title={isInsta ? `Instagram Posts & Reels (${filteredPosts.length})` : `Facebook Page Posts (${filteredPosts.length})`}
        subtitle="Scheduled queue and published permalinks"
        noPadding
      >
        {filteredPosts.length === 0 ? (
          <div className="p-6 text-[13px] text-[var(--ink-muted)]">
            No posts scheduled or published on this channel yet.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)] text-[13px]">
            {filteredPosts.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5 sm:px-6"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-[var(--ink)]">{p.caption}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)] tabular-nums">
                    <span className="font-semibold text-[var(--ink-secondary)] uppercase">
                      {p.channel.replace(/_/g, " ")}
                    </span>
                    <span>•</span>
                    <span>
                      {p.status === "published" && p.publishedAt
                        ? `Published ${new Date(p.publishedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`
                        : `Scheduled ${new Date(p.scheduledFor).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`}
                    </span>
                    {p.externalPermalink && (
                      <a
                        href={p.externalPermalink}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-[var(--brand)] hover:underline"
                      >
                        View Live Post ↗
                      </a>
                    )}
                  </div>
                  {p.lastError && (
                    <div className="mt-1 text-[11px] text-[var(--warning)]">{p.lastError}</div>
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
                  {p.status !== "published" && ctx.canPublishPosts && (
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
                  {ctx.canDraftPosts && (
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
      </SectionCard>
    </div>
  );
}

export function PixelConversionsWorkspace({
  ctx,
  returnPath,
}: {
  ctx: CampaignsWorkspaceData;
  returnPath: string;
}) {
  return (
    <div className="space-y-6">
      <SectionCard
        title="Website Sales Pixel & Meta Conversions API (CAPI)"
        subtitle="Deduplicates orders by Event ID and dispatches SHA-256 hashed conversions directly to Meta Pixel"
        action={
          ctx.hasPixel ? (
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill
                label={
                  ctx.metaAdsConn?.metadata.pixelId
                    ? `Pixel ${ctx.metaAdsConn.metadata.pixelId}`
                    : "Connect Meta Pixel"
                }
                tone={ctx.metaAdsConn?.metadata.pixelId ? "emerald" : "amber"}
              />
              <GuideDrawerButton
                label="Server CAPI Setup"
                badgeText="REST API"
                guide={{
                  eyebrow: "Server-Side Conversions API",
                  title: "Connect Shopify, WooCommerce, or Custom Checkouts",
                  summary:
                    "Post server-side order completions so RapidShift deduplicates by Event ID and forwards SHA-256 hashed conversions to Meta CAPI.",
                  steps: [
                    {
                      title: "Issue a Scoped Pixel API Key",
                      detail: "Open REST API Keys (/settings/api-keys) and issue a key with the pixel:write scope.",
                    },
                    {
                      title: "Send Order Events to Your REST Endpoint",
                      detail:
                        "POST each checkout event with a unique eventId, customer phone/email, and order total.",
                      code: `curl -X POST "${ctx.ep.effectiveAppBaseUrl}/api/v1/pixel/events" \\\n  -H "Authorization: Bearer rsl_live_YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"eventId":"ORD-2026-901","eventName":"Purchase","amountRupees":2450,"phone":"+919876543210"}'`,
                      codeLanguage: "bash",
                    },
                  ],
                  fullGuideHref: "/help?slug=ads-social-posts-and-website-conversions",
                  fullGuideLabel: "Open Full CAPI Guide",
                }}
              />
            </div>
          ) : undefined
        }
      >
        {!ctx.hasPixel && ctx.pixelPlan ? (
          <InlineAddonPlanBanner plan={ctx.pixelPlan} returnPath={returnPath} />
        ) : ctx.canManagePixel ? (
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
                  <SubmitButton pendingText="Sending..." className="rsl-btn-primary shrink-0">
                    Record &amp; Send CAPI
                  </SubmitButton>
                </div>
              </div>
            </div>
          </form>
        ) : (
          <p className="text-[13px] text-[var(--ink-secondary)]">
            Read-only role - inspect recorded server-side website sales events below.
          </p>
        )}
      </SectionCard>

      {ctx.hasPixel && (
        <SectionCard
          title={`Conversion Event Log (${ctx.meta.pixelEvents.length})`}
          subtitle="Recent server-side events dispatched to Meta CAPI"
          noPadding
        >
          {ctx.meta.pixelEvents.length === 0 ? (
            <div className="p-6 text-[13px] text-[var(--ink-muted)]">
              No conversion events recorded yet. Send an event above or connect your store via REST
              API.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)] text-[13px]">
              {ctx.meta.pixelEvents.map((ev) => (
                <li
                  key={ev.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 sm:px-6"
                >
                  <div className="min-w-0">
                    <div>
                      <strong className="font-semibold text-[var(--ink)]">{ev.eventName}</strong> •{" "}
                      <span className="font-mono text-[var(--ink-secondary)]">{ev.eventId}</span>
                    </div>
                    {ev.capiResponseDetail && (
                      <div className="truncate text-[11px] text-[var(--ink-muted)]">
                        {ev.capiResponseDetail}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 tabular-nums">
                    <span className="font-semibold text-[var(--ink)]">
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
        </SectionCard>
      )}
    </div>
  );
}
