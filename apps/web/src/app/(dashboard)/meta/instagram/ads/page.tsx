import { canRoleAccessWebRoute, formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, PageHeader } from "@rsl/ui";
import { AiAdCopywriterCard } from "@/components/campaigns-free-ai-bar";
import {
  AdAccountConnectionBar,
  AdCampaignLauncherSection,
  CampaignsPerformanceTable,
  CampaignsPlatformKpis,
  OfflineSnapshotCollapsible,
} from "@/components/campaigns-views";
import { FeaturePlanGate } from "@/components/feature-plan-gate";
import { FlashBanner } from "@/components/flash-banner";
import { SubmitButton } from "@/components/ios-feedback";
import { MetaInstagramNav } from "@/components/suite-subnav";
import { syncLiveAdsInsightsAction } from "@/lib/actions";
import { loadCampaignsWorkspaceContext } from "@/lib/campaigns-data";
import { requireWebSession } from "@/lib/session";

export default async function MetaInstagramAdsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/meta/instagram/ads", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Instagram Ads"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View Instagram Ads"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  const ctx = await loadCampaignsWorkspaceContext(session.workspace.id, session.roleSlug);
  if (!ctx.hasMetaAds && ctx.metaAdsPlan) {
    return (
      <FeaturePlanGate
        pageTitle="Meta -> Instagram Ads"
        pageSubtitle="Promote Reels, Feed carousels, and Click-to-DM offers to local Instagram audiences with INR budget tracking."
        plans={[ctx.metaAdsPlan]}
        returnPath="/meta/instagram/ads"
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Meta -> Instagram"
        title="Instagram Feed & Reels Ads"
        subtitle="Launch Click-to-DM and WhatsApp campaigns tuned for Instagram Reels and Stories"
        actions={
          <form action={syncLiveAdsInsightsAction}>
            <SubmitButton pendingText="Syncing Ads..." className="rsl-btn-secondary">
              Sync Live Meta Insights
            </SubmitButton>
          </form>
        }
      />

      <MetaInstagramNav active="ads" />
      <FlashBanner notice={sp.notice} error={sp.error} />

      <CampaignsPlatformKpis ctx={ctx} platform="instagram" />
      <AdAccountConnectionBar ctx={ctx} focus="meta" />
      <AiAdCopywriterCard defaultPlatform="meta" />
      <AdCampaignLauncherSection
        ctx={ctx}
        scope="instagram"
        returnPath="/meta/instagram/ads"
        workspaceWebsite={session.workspace.website}
        workspacePhone={session.workspace.businessPhone}
      />
      <OfflineSnapshotCollapsible ctx={ctx} platform="instagram" />
      <CampaignsPerformanceTable
        ctx={ctx}
        platform="instagram"
        title="Instagram & Meta Ad Campaigns"
      />
    </div>
  );
}
