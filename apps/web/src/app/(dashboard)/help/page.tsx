import Form from "next/form";
import { Search } from "lucide-react";
import { getWorkspaceDatabaseManagementInfo } from "@rsl/backup";
import {
  getWalletBalancePaise,
  hasActiveEntitlement,
  listServicesWithWorkspaceState,
} from "@rsl/billing";
import { listWorkspaceConnections } from "@rsl/connections";
import { formatInr } from "@rsl/core";
import { loadAllDocArticles, searchDocs } from "@rsl/docs";
import { getTallyWorkspaceSummary } from "@rsl/tally";
import { FormattedGuideBody, PageHeader, SectionCard, StatusPill } from "@rsl/ui";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { submitHelpFeedbackAction } from "@/lib/actions";
import { requireWebSession } from "@/lib/session";

export default async function PersonalizedHelpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;
  const q = sp.q?.trim() || "";
  const hits = q ? searchDocs(q, "help") : [];
  const articles = loadAllDocArticles();
  const selectedSlug = sp.slug || articles[0]?.slug || "";
  const activeArticle = articles.find((a) => a.slug === selectedSlug) ?? articles[0];
  const walletPaise = getWalletBalancePaise(session.workspace.id);
  const workspaceServices = listServicesWithWorkspaceState(session.workspace.id);
  const unlockedToolsCount = workspaceServices.filter((s) => s.isUnlocked).length;
  const connData = listWorkspaceConnections(session.workspace.id);
  const tallySummary = getTallyWorkspaceSummary(session.workspace.id);
  const dbInfo = getWorkspaceDatabaseManagementInfo(session.workspace.id);

  const healthyConnsCount = connData.connections.filter((c) => c.status === "healthy").length;
  const approvedTemplatesCount = tallySummary.templates.filter(
    (t) => t.approvalStatus === "APPROVED"
  ).length;
  const readinessChecks: Array<{
    title: string;
    detail: string;
    statusLabel: string;
    tone: "emerald" | "amber" | "stone";
    href: string;
    cta: string;
  }> = [
    {
      title: "Platform Tools",
      detail:
        unlockedToolsCount === workspaceServices.length
          ? `All ${workspaceServices.length} RSL Marketing tools are active and ready to use`
          : unlockedToolsCount > 0
            ? `${unlockedToolsCount} of ${workspaceServices.length} platform tools active`
            : "No paid plans unlocked yet — choose individual tools or a value bundle",
      statusLabel:
        unlockedToolsCount === workspaceServices.length
          ? "All Active"
          : unlockedToolsCount > 0
            ? `${unlockedToolsCount}/${workspaceServices.length} Active`
            : "View Plans",
      tone: unlockedToolsCount > 0 ? "emerald" : "stone",
      href: "/billing",
      cta: unlockedToolsCount === workspaceServices.length ? "View Active Tools" : "Open Plans & Bundles",
    },
    {
      title: "Business GST Details",
      detail: session.workspace.gstin
        ? `GSTIN ${session.workspace.gstin} (State ${session.workspace.stateCode})`
        : `State ${session.workspace.stateCode} set — add GSTIN for B2B tax credit`,
      statusLabel: session.workspace.gstin ? "Ready" : "Optional",
      tone: session.workspace.gstin ? "emerald" : "stone",
      href: "/settings/business",
      cta: session.workspace.gstin ? "View Business Settings" : "Add GSTIN",
    },
    {
      title: "Prepaid Message Wallet",
      detail:
        walletPaise > 0
          ? `${formatInr(walletPaise, { showDecimals: true })} available (+ ₹200 overdraft buffer down to -₹200.00)`
          : walletPaise < 0
            ? `${formatInr(walletPaise, { showDecimals: true })} negative balance (using ₹200 overdraft credit — recharge soon)`
            : "₹0.00 balance — up to -₹200.00 overdraft buffer available for urgent WhatsApp sends",
      statusLabel:
        walletPaise > 0 ? "Funded" : walletPaise > -20_000 ? "Overdraft Ready" : "Limit Reached",
      tone: walletPaise > 0 ? "emerald" : walletPaise > -20_000 ? "amber" : "stone",
      href: "/billing?tab=wallet",
      cta: walletPaise > 0 ? "View Passbook" : "Recharge Wallet",
    },
    {
      title: "Connected Channels",
      detail:
        connData.connections.length > 0
          ? `${healthyConnsCount}/${connData.connections.length} channel connection(s) healthy`
          : "Connect WhatsApp Business, Meta, or Google Business Profile",
      statusLabel: healthyConnsCount > 0 ? "Connected" : "Setup Needed",
      tone: healthyConnsCount > 0 ? "emerald" : "amber",
      href: "/connections",
      cta: healthyConnsCount > 0 ? "Manage Channels" : "Connect Channel",
    },
    {
      title: "WhatsApp Templates",
      detail:
        approvedTemplatesCount > 0
          ? `${approvedTemplatesCount} approved template(s) ready to send`
          : "Load ready-made Tally templates or create your first template",
      statusLabel: approvedTemplatesCount > 0 ? "Ready" : "Setup Needed",
      tone: approvedTemplatesCount > 0 ? "emerald" : "stone",
      href: "/whatsapp",
      cta: approvedTemplatesCount > 0 ? "Manage Templates" : "Load Starter Templates",
    },
    {
      title: "Tally Prime Live Sync & Backups",
      detail:
        tallySummary.connectionOverview.overallState === "live_connected"
          ? `${tallySummary.connectionOverview.overallLabel} • ${tallySummary.vouchers.length.toLocaleString("en-IN")} bill(s) • ${dbInfo.backupRuns.length} backup(s)`
          : tallySummary.connectionOverview.overallState === "handshake_ready"
            ? `${tallySummary.connectionOverview.overallLabel} • ${dbInfo.backupRuns.length} backup(s)`
            : `Verify your ${session.workspace.slug}.tally.rapidshiftlabs.in Tally webhook endpoint, load the .tdl add-on, or pair your Windows PC`,
      statusLabel:
        tallySummary.connectionOverview.overallState === "live_connected"
          ? "Live Connected"
          : tallySummary.connectionOverview.overallState === "handshake_ready"
            ? "Endpoint Verified"
            : tallySummary.vouchers.length > 0
              ? `${tallySummary.vouchers.length} Imported`
              : "Setup Needed",
      tone:
        tallySummary.connectionOverview.overallState === "live_connected"
          ? "emerald"
          : tallySummary.connectionOverview.overallState === "handshake_ready"
            ? "emerald"
            : "amber",
      href: "/tally?tab=connect",
      cta:
        tallySummary.connectionOverview.overallState === "live_connected"
          ? "Open Tally Connection"
          : "Connect Tally Prime",
    },
  ];

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Step-by-Step Setup & Troubleshooting"
        title="Guides & Help Center"
        subtitle="Plain-English instructions for Tally Prime, WhatsApp templates, verified billing, and daily operations."
        actions={
          <Form action="/help" className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                name="q"
                defaultValue={q}
                placeholder="Search Tally, WhatsApp, bills, or wallet..."
                className="rsl-input w-72 pl-8"
              />
            </div>
            <SubmitButton className="rsl-btn-primary" pendingText="Searching...">
              Search
            </SubmitButton>
          </Form>
        }
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <SectionCard
        title="Live Account Setup & Readiness Check"
        subtitle="Personalized live status of your business workspace so you know what is ready and what to set up next"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {readinessChecks.map((item) => (
            <div
              key={item.title}
              className="flex flex-col justify-between gap-3 rounded-xl border border-zinc-200/85 bg-zinc-50/65 p-3.5 text-xs"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{item.title}</span>
                  <StatusPill label={item.statusLabel} tone={item.tone} showDot={false} />
                </div>
                <p className="mt-1.5 leading-relaxed text-zinc-600">{item.detail}</p>
              </div>
              <div>
                <ActionLink
                  href={item.href}
                  className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 hover:underline"
                >
                  <span>{item.cta} →</span>
                </ActionLink>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {q && (
        <SectionCard title={`Search Results for "${q}" (${hits.length})`}>
          {hits.length === 0 ? (
            <p className="text-xs text-zinc-500">
              No matching guides found. Try searching a simpler word like &ldquo;Tally&rdquo;, &ldquo;WhatsApp&rdquo;, or &ldquo;Wallet&rdquo;.
            </p>
          ) : (
            <ul className="space-y-2.5 text-xs">
              {hits.map((h, i) => {
                const targetHref = h.href.startsWith("/guides/")
                  ? `/help?slug=${encodeURIComponent(h.href.replace(/^\/guides\//, ""))}`
                  : h.href;
                return (
                  <li
                    key={`${h.href}-${i}`}
                    className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-4 py-3 transition hover:bg-white"
                  >
                    <ActionLink href={targetHref} variant="card" className="block">
                      <div className="flex items-center gap-2">
                        <StatusPill label={h.kind} tone="sky" showDot={false} />
                        <strong className="text-sm text-slate-900">{h.title}</strong>
                      </div>
                      <p className="mt-1 text-zinc-600">{h.summary}</p>
                    </ActionLink>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[310px_1fr] lg:items-start">
        <SectionCard title="All Help Guides" noPadding>
          <ul className="divide-y divide-zinc-100 bg-white text-xs">
            {articles.map((art) => {
              const planActive = art.service
                ? hasActiveEntitlement(session.workspace.id, art.service)
                : true;
              const isSelected = art.slug === activeArticle?.slug;

              return (
                <li
                  key={art.slug}
                  className={
                    isSelected
                      ? "bg-emerald-50/70"
                      : "transition hover:bg-zinc-50/80"
                  }
                >
                  <ActionLink
                    href={`/help?slug=${encodeURIComponent(art.slug)}`}
                    variant="card"
                    className="block px-4 py-3.5"
                  >
                    <div
                      className={`pr-6 font-semibold leading-snug ${
                        isSelected ? "text-emerald-800" : "text-slate-900"
                      }`}
                    >
                      {art.title}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                      <span>{art.section}</span>
                      {art.service && (
                        <StatusPill
                          label={planActive ? "Active" : "Locked"}
                          tone={planActive ? "emerald" : "stone"}
                          showDot={false}
                        />
                      )}
                    </div>
                  </ActionLink>
                </li>
              );
            })}
          </ul>
        </SectionCard>

        {activeArticle && (
          <SectionCard
            title={activeArticle.title}
            subtitle={activeArticle.summary}
            action={
              <div className="flex items-center gap-2">
                <StatusPill
                  label={`${activeArticle.readingMinutes} min read`}
                  tone="stone"
                  showDot={false}
                />
                <StatusPill
                  label={`Wallet: ${formatInr(walletPaise, { showDecimals: true })}`}
                  tone="emerald"
                  showDot={false}
                />
              </div>
            }
          >
            <div className="w-full">
              <FormattedGuideBody markdown={activeArticle.bodyMarkdown} linkMode="help" />
            </div>

            <form
              action={submitHelpFeedbackAction}
              className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200/80 pt-5 text-xs"
            >
              <input type="hidden" name="slug" value={activeArticle.slug} />
              <span className="font-semibold text-slate-900">Was this guide helpful?</span>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  name="comment"
                  placeholder="Optional suggestion..."
                  className="rsl-input w-56"
                />
                <SubmitButton
                  name="helpful"
                  value="yes"
                  spinnerSize="xs"
                  pendingText="Saving..."
                  className="rsl-btn-primary"
                >
                  Yes, Helpful
                </SubmitButton>
                <SubmitButton
                  name="helpful"
                  value="no"
                  spinnerSize="xs"
                  pendingText="Saving..."
                  className="rsl-btn-secondary"
                >
                  Needs Improvement
                </SubmitButton>
              </div>
            </form>
          </SectionCard>
        )}
      </div>
    </div>
  );
}
