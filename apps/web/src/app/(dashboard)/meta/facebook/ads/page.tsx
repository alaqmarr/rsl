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
import { MetaFacebookNav } from "@/components/suite-subnav";
import { syncLiveAdsInsightsAction } from "@/lib/actions";
import { loadCampaignsWorkspaceContext } from "@/lib/campaigns-data";
import { requireWebSession } from "@/lib/session";

export default async function MetaFacebookAdsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/meta/facebook/ads", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Facebook Ads"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View Facebook & Meta Ads"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  const ctx = await loadCampaignsWorkspaceContext(session.workspace.id, session.roleSlug);
  if (!ctx.hasMetaAds && ctx.metaAdsPlan) {
    return (
      <FeaturePlanGate
        pageTitle="Meta -> Facebook Ads Studio"
        pageSubtitle="Run Click-to-WhatsApp, Instant Lead Form, and Website Conversion ads on Facebook with live ROAS metering."
        plans={[ctx.metaAdsPlan]}
        returnPath="/meta/facebook/ads"
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Meta -> Facebook"
        title="Facebook Ads & Lead Generation"
        subtitle="Launch Click-to-WhatsApp and lead campaigns in Direct Mode or RSL Managed Vault"
        actions={
          <form action={syncLiveAdsInsightsAction}>
            <SubmitButton pendingText="Syncing Ads..." className="rsl-btn-secondary">
              Sync Live Meta Insights
            </SubmitButton>
          </form>
        }
      />

      <MetaFacebookNav active="ads" />
      <FlashBanner notice={sp.notice} error={sp.error} />

      <CampaignsPlatformKpis ctx={ctx} platform="facebook" />
      <AdAccountConnectionBar ctx={ctx} focus="meta" />
      <AiAdCopywriterCard defaultPlatform="meta" />
      <AdCampaignLauncherSection
        ctx={ctx}
        scope="facebook"
        returnPath="/meta/facebook/ads"
        workspaceWebsite={session.workspace.website}
        workspacePhone={session.workspace.businessPhone}
      />
      <OfflineSnapshotCollapsible ctx={ctx} platform="facebook" />
      <CampaignsPerformanceTable
        ctx={ctx}
        platform="facebook"
        title="Facebook & Meta Ad Campaigns"
      />
    </div>
  );
}
