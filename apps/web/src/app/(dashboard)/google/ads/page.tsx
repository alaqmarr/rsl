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
import { GoogleSuiteNav } from "@/components/suite-subnav";
import { syncLiveAdsInsightsAction } from "@/lib/actions";
import { loadCampaignsWorkspaceContext } from "@/lib/campaigns-data";
import { requireWebSession } from "@/lib/session";

export default async function GoogleAdsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/google/ads", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Google Ads"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View Google Ads"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  const ctx = await loadCampaignsWorkspaceContext(session.workspace.id, session.roleSlug);
  if (!ctx.hasGoogleAds && ctx.googleAdsPlan) {
    return (
      <FeaturePlanGate
        pageTitle="Google Ads Studio"
        pageSubtitle="Launch Google Search, Call, and Performance Max campaigns with exact keyword targeting and INR spend controls."
        plans={[ctx.googleAdsPlan]}
        returnPath="/google/ads"
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Google Services"
        title="Google Ads & Search Campaigns"
        subtitle="Capture high-intent Search, Call, and Google Maps buyers with INR daily caps"
        actions={
          <form action={syncLiveAdsInsightsAction}>
            <SubmitButton pendingText="Syncing Google Ads..." className="rsl-btn-secondary">
              Sync Live Google Insights
            </SubmitButton>
          </form>
        }
      />

      <GoogleSuiteNav active="ads" />
      <FlashBanner notice={sp.notice} error={sp.error} />

      <CampaignsPlatformKpis ctx={ctx} platform="google_ads" />
      <AdAccountConnectionBar ctx={ctx} focus="google" />
      <AiAdCopywriterCard defaultPlatform="google" />
      <AdCampaignLauncherSection
        ctx={ctx}
        scope="google_ads"
        returnPath="/google/ads"
        workspaceWebsite={session.workspace.website}
        workspacePhone={session.workspace.businessPhone}
      />
      <OfflineSnapshotCollapsible ctx={ctx} platform="google_ads" />
      <CampaignsPerformanceTable
        ctx={ctx}
        platform="google_ads"
        title="Google Search & Performance Max Campaigns"
      />
    </div>
  );
}
