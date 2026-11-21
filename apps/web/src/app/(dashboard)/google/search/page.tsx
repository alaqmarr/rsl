import { canRoleAccessWebRoute, formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, MetricCard, PageHeader, SectionCard } from "@rsl/ui";
import { AiAdCopywriterCard, GoogleSearchConsoleCard } from "@/components/campaigns-free-ai-bar";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink } from "@/components/ios-feedback";
import { GoogleSuiteNav } from "@/components/suite-subnav";
import { loadCampaignsWorkspaceContext } from "@/lib/campaigns-data";
import { requireWebSession } from "@/lib/session";

export default async function GoogleSearchConsolePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/google/search", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Google Search Console & SEO"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View Google Search Console insights"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  const ctx = await loadCampaignsWorkspaceContext(session.workspace.id, session.roleSlug);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Google Services"
        title="Google Search Console & SEO"
        subtitle="Track 28-day organic Google search queries, rankings, and click-through performance"
        actions={
          <ActionLink href="/connections/google-search-console" className="rsl-btn-secondary">
            {ctx.gscConnected ? "Manage Search Console" : "Connect Search Console"}
          </ActionLink>
        }
      />

      <GoogleSuiteNav active="search" />
      <FlashBanner notice={sp.notice} error={sp.error} />

      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <MetricCard
          label="Organic Clicks (28d)"
          value={ctx.gscTotals.clicks.toLocaleString("en-IN")}
          sublabel={ctx.gscSiteUrl || "Verified Search Property"}
          accent="emerald"
        />
        <MetricCard
          label="Search Impressions"
          value={ctx.gscTotals.impressions.toLocaleString("en-IN")}
          sublabel="Free organic visibility"
          accent="sky"
        />
        <MetricCard
          label="Average CTR"
          value={`${ctx.gscTotals.ctrPct}%`}
          sublabel="Clicks / impressions"
        />
        <MetricCard
          label="Avg Search Rank"
          value={ctx.gscTotals.avgPosition > 0 ? `#${ctx.gscTotals.avgPosition}` : "—"}
          sublabel="Across top queries"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <GoogleSearchConsoleCard
          gscConnected={ctx.gscConnected}
          gscSiteUrl={ctx.gscSiteUrl}
          gscTotals={ctx.gscTotals}
          gscQueries={ctx.gscQueries}
          oauthReturnTo="/google/search"
        />
        <AiAdCopywriterCard defaultPlatform="google" />
      </div>

      <SectionCard
        title={`Top Organic Search Queries (${ctx.gscQueries.length})`}
        subtitle="High-intent search terms bringing organic customers to your site"
        noPadding
      >
        {!ctx.gscConnected ? (
          <div className="p-6 text-[13px] text-[var(--ink-secondary)]">
            Connect Google Search Console in{" "}
            <a
              href="/connections/google-search-console"
              className="font-semibold text-[var(--brand)] hover:underline"
            >
              Google Connections
            </a>{" "}
            to inspect top ranking keywords and impressions here.
          </div>
        ) : ctx.gscQueries.length === 0 ? (
          <div className="p-6 text-[13px] text-[var(--ink-muted)]">
            Search Console is connected for {ctx.gscSiteUrl || "your site"}. Keyword rows appear once
            Google reports clicks and impressions.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-[var(--border)] bg-[var(--surface-inset)] text-[11px] tracking-wider text-[var(--ink-muted)] uppercase">
                <tr>
                  <th className="px-5 py-3 font-semibold sm:px-6">Search Query</th>
                  <th className="px-4 py-3 font-semibold">Clicks</th>
                  <th className="px-4 py-3 font-semibold">Impressions</th>
                  <th className="px-4 py-3 font-semibold">CTR</th>
                  <th className="px-5 py-3 text-right font-semibold sm:px-6">Avg Position</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {ctx.gscQueries.map((q) => (
                  <tr key={q.query} className="hover:bg-[var(--surface-inset)]/60">
                    <td className="px-5 py-3 font-medium text-[var(--ink)] sm:px-6">{q.query}</td>
                    <td className="px-4 py-3 tabular-nums text-[var(--ink)]">
                      {q.clicks.toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-[var(--ink-secondary)]">
                      {q.impressions.toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-[var(--ink-secondary)]">
                      {q.ctrPct}%
                    </td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums text-[var(--brand)] sm:px-6">
                      #{q.avgPosition}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
