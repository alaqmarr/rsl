import Link from "next/link";
import { redirect } from "next/navigation";
import { canRoleAccessWebRoute, formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, PageHeader, SectionCard } from "@rsl/ui";
import {
  CampaignsPerformanceTable,
  CampaignsPlatformKpis,
} from "@/components/campaigns-views";
import { FlashBanner } from "@/components/flash-banner";
import { SubmitButton } from "@/components/ios-feedback";
import {
  FacebookBrandIcon,
  GoogleAdsBrandIcon,
  InstagramBrandIcon,
  MetaBrandIcon,
} from "@/components/service-brand-icons";
import { syncLiveAdsInsightsAction } from "@/lib/actions";
import { loadCampaignsWorkspaceContext } from "@/lib/campaigns-data";
import { requireWebSession } from "@/lib/session";

export default async function CampaignsHubPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  if (sp.platform === "facebook") {
    redirect("/meta/facebook/ads");
  }
  if (sp.platform === "instagram") {
    redirect("/meta/instagram/ads");
  }
  if (sp.platform === "google_ads") {
    redirect("/google/ads");
  }

  const session = await requireWebSession();

  if (!canRoleAccessWebRoute(session.roleSlug, "/campaigns", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Ads & Social Performance"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View Paid Ads & Social"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  const ctx = await loadCampaignsWorkspaceContext(session.workspace.id, session.roleSlug);

  const studios = [
    {
      title: "Facebook Ads Studio",
      desc: "Click-to-WhatsApp, Instant Lead Forms & Website Conversion campaigns",
      href: "/meta/facebook/ads",
      icon: <FacebookBrandIcon className="h-5 w-5" />,
    },
    {
      title: "Facebook Posts & Pixel",
      desc: "Schedule Page offers & inspect server-side Meta CAPI events",
      href: "/meta/facebook/posts",
      icon: <MetaBrandIcon className="h-5 w-5" />,
    },
    {
      title: "Instagram Posts, Reels & Ads",
      desc: "Schedule Reels & promote Feed offers directly to Instagram",
      href: "/meta/instagram/posts",
      icon: <InstagramBrandIcon className="h-5 w-5" />,
    },
    {
      title: "Google Ads & Search Console",
      desc: "High-intent Search campaigns, Performance Max & 28d organic keywords",
      href: "/google/ads",
      icon: <GoogleAdsBrandIcon className="h-5 w-5" />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Cross-Channel Marketing"
        title="All Campaigns Overview"
        subtitle="Combined ROAS across Meta and Google - open any service studio below to create or edit"
        actions={
          <form action={syncLiveAdsInsightsAction}>
            <SubmitButton pendingText="Syncing All Ads..." className="rsl-btn-secondary">
              Sync All Platform Insights
            </SubmitButton>
          </form>
        }
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <CampaignsPlatformKpis ctx={ctx} platform="all" />

      <SectionCard
        title="Dedicated Service Studios"
        subtitle="Each channel now lives in its own focused workspace to eliminate screen clutter"
      >
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          {studios.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="group flex flex-col justify-between rounded-xl border border-[var(--border)] bg-[var(--surface-inset)] p-4 transition-all hover:border-[var(--brand)] hover:bg-[var(--surface)]"
            >
              <div>
                <div className="mb-2.5 flex items-center gap-2.5">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                    {s.icon}
                  </span>
                  <span className="text-sm font-semibold text-[var(--ink)] group-hover:text-[var(--brand)]">
                    {s.title}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-[var(--ink-muted)]">{s.desc}</p>
              </div>
              <div className="mt-3 text-xs font-semibold text-[var(--brand)]">Open Studio →</div>
            </Link>
          ))}
        </div>
      </SectionCard>

      <CampaignsPerformanceTable
        ctx={ctx}
        platform="all"
        title="All Active & Historical Campaigns"
      />
    </div>
  );
}
