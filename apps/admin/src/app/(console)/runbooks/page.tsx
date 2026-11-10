import fs from "node:fs";
import path from "node:path";
import { asc } from "drizzle-orm";
import { Activity, BookOpen, Cpu, KeyRound, Play, Server } from "lucide-react";
import { getPlatformAdminAnalytics } from "@rsl/analytics";
import { canStaffPerform } from "@rsl/auth";
import { getEnv } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { controlDb, probePlatformSystemStatuses } from "@rsl/tenancy";
import {
  FlashBanner,
  FormattedGuideBody,
  MetricCard,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@rsl/ui";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import {
  staffSaveFeatureFlagAction,
  staffToggleFeatureFlagAction,
} from "@/lib/actions";
import { requireStaffSession } from "@/lib/session";

interface InternalRunbook {
  slug: string;
  title: string;
  body: string;
}

function loadStaffRunbooks(): InternalRunbook[] {
  const candidates = [
    path.resolve(process.cwd(), "content", "internal"),
    path.resolve(process.cwd(), "..", "..", "content", "internal"),
  ];
  const dir = candidates.find((d) => fs.existsSync(d));
  if (!dir) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((file) => {
      const raw = fs.readFileSync(path.join(dir, file), "utf8");
      const firstHeading = /^#\s+(.+)$/m.exec(raw);
      const bodyWithoutTopTitle = raw.replace(/^#\s+.+\r?\n?/, "").trim();
      return {
        slug: file.replace(/\.md$/, ""),
        title: firstHeading ? firstHeading[1]!.trim() : file,
        body: bodyWithoutTopTitle,
      };
    });
}

export default async function StaffRunbooksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { staff } = await requireStaffSession();
  const canManageFlags = canStaffPerform(staff.staffRole, "staff:flags.manage");
  const sp = await searchParams;
  const env = getEnv();
  const runbooks = loadStaffRunbooks();
  const adminAnalytics = getPlatformAdminAnalytics();
  const includeExternalProbe = sp.probe === "1";
  const systemHealth = await probePlatformSystemStatuses({
    includeOpenExternalApis: includeExternalProbe,
  });
  const rolloutToggles = controlDb()
    .select()
    .from(controlSchema.featureFlags)
    .orderBy(asc(controlSchema.featureFlags.key))
    .all();

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Operations Reference"
        title="Server Health & Guides"
        subtitle={`Signed in as ${staff.name}. Live diagnostics for server ports, SQLite WAL databases, KMS encryption, rollout toggles, and staff SOP runbooks.`}
        badge={
          <StatusPill
            label={`${systemHealth.summary.healthy}/${systemHealth.items.length} Services Healthy`}
            tone={systemHealth.summary.error > 0 ? "ruby" : "emerald"}
          />
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ActionLink
              href="/runbooks?probe=1#live-server-health"
              className="adm-btn-secondary text-xs"
            >
              <Play className="h-3.5 w-3.5 text-indigo-600" />
              <span>Test All Ports, DBs &amp; Public APIs</span>
            </ActionLink>
            <ActionLink href="/credentials" className="adm-btn-primary text-xs">
              <KeyRound className="h-3.5 w-3.5" />
              <span>Test 11 OAuth &amp; API Credentials</span>
            </ActionLink>
          </div>
        }
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Allowed Server Ports"
          value="4500 – 4600"
          sublabel="Client 4500 • Staff 4501 • Help 4502"
          accent="emerald"
          icon={<Server className="h-4 w-4" />}
        />
        <MetricCard
          label="Background Services"
          value={`${env.WORKER_HEALTH_PORT} / ${env.CLEANUP_SERVICE_PORT}`}
          sublabel="Task runner & 20-minute cleanup"
          accent="emerald"
          icon={<Activity className="h-4 w-4" />}
        />
        <MetricCard
          label="Process Group"
          value="rsl-marketing"
          sublabel="Isolated from other apps on server"
          accent="sky"
          icon={<Cpu className="h-4 w-4" />}
        />
        <MetricCard
          label="Maintenance Guides"
          value={String(runbooks.length)}
          sublabel="Step-by-step staff instructions"
          icon={<BookOpen className="h-4 w-4" />}
        />
      </div>

      {/* Live Server Ports, SQLite Databases, KMS & Public API Status */}
      <div id="live-server-health" className="scroll-mt-24">
        <SectionCard
          title={`Live Server Ports, SQLite Databases & KMS Health (${systemHealth.summary.healthy} Healthy • ${systemHealth.summary.warning} Warning • ${systemHealth.summary.error} Error)`}
          subtitle={
            includeExternalProbe
              ? `Full runtime + external India SMB API probe executed at ${new Date(systemHealth.checkedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}`
              : `Local ports, SQLite WAL engines & KMS cipher probed at ${new Date(systemHealth.checkedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}. Click "Test All Ports, DBs & Public APIs" to include external IFSC, Pincode & Forex APIs.`
          }
          action={
            <ActionLink
              href="/runbooks?probe=1#live-server-health"
              className="adm-btn-secondary py-1 text-xs"
            >
              <Play className="h-3 w-3 text-indigo-600" />
              <span>Re-Run Full Probe</span>
            </ActionLink>
          }
          noPadding
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-200 bg-zinc-50/90 text-[11px] font-bold tracking-wide text-zinc-500 uppercase">
                <tr>
                  <th className="px-4 py-2.5">Subsystem</th>
                  <th className="px-4 py-2.5">Target / Endpoint</th>
                  <th className="px-4 py-2.5">Live Status</th>
                  <th className="px-4 py-2.5">Latency</th>
                  <th className="px-4 py-2.5">Diagnostic Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white">
                {systemHealth.items.map((item) => (
                  <tr key={item.key} className="hover:bg-zinc-50/60">
                    <td className="px-4 py-2.5 font-semibold text-slate-900">{item.label}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-600">
                      {item.target}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusPill
                        label={
                          item.status === "healthy"
                            ? "Healthy"
                            : item.status === "warning"
                              ? "Optional / Warn"
                              : "Unreachable"
                        }
                        tone={
                          item.status === "healthy"
                            ? "emerald"
                            : item.status === "warning"
                              ? "amber"
                              : "ruby"
                        }
                      />
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-500 tabular-nums">
                      {item.latencyMs}ms
                    </td>
                    <td className="px-4 py-2.5 text-zinc-700">{item.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      {/* Platform Rollout Toggles */}
      <SectionCard
        title={`Platform Rollout Toggles (${rolloutToggles.length})`}
        subtitle="Turn optional platform-wide capabilities on or off without restarting the server"
      >
        <div className="space-y-4 text-xs">
          {canManageFlags ? (
            <form
              action={staffSaveFeatureFlagAction}
              className="grid grid-cols-1 gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3.5 sm:grid-cols-[1fr_1.6fr_auto_auto] sm:items-end"
            >
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Toggle Key</label>
                <input
                  name="key"
                  required
                  placeholder="e.g. beta_ai_review_replies"
                  className="adm-input bg-white font-mono text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">
                  Plain-English Description
                </label>
                <input
                  name="description"
                  required
                  placeholder="Allow client accounts to preview suggested review replies"
                  className="adm-input bg-white"
                />
              </div>
              <label className="inline-flex items-center gap-2 pb-2 text-xs font-medium text-zinc-700">
                <input
                  type="checkbox"
                  name="enabledGlobal"
                  defaultChecked
                  className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>Enable immediately</span>
              </label>
              <SubmitButton className="adm-btn-primary" pendingText="Saving...">
                Save Toggle
              </SubmitButton>
            </form>
          ) : (
            <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-3.5 py-2.5 text-zinc-600">
              Read-only view - only Super Admins can add or change platform rollout toggles.
            </div>
          )}

          {rolloutToggles.length === 0 ? (
            <p className="text-xs text-zinc-500">
              No custom platform rollout toggles configured yet.
            </p>
          ) : (
            <div className="divide-y divide-zinc-100">
              {rolloutToggles.map((flag) => (
                <div
                  key={flag.key}
                  className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <code className="font-mono font-semibold text-slate-900">{flag.key}</code>
                      <StatusPill
                        label={flag.enabledGlobal ? "Enabled" : "Paused"}
                        tone={flag.enabledGlobal ? "emerald" : "stone"}
                      />
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-zinc-600">{flag.description}</p>
                  </div>
                  {canManageFlags && (
                    <div className="flex items-center gap-1.5">
                      <form action={staffToggleFeatureFlagAction}>
                        <input type="hidden" name="key" value={flag.key} />
                        <input
                          type="hidden"
                          name="mode"
                          value={flag.enabledGlobal ? "disable" : "enable"}
                        />
                        <SubmitButton
                          spinnerSize="xs"
                          pendingText="Updating..."
                          className="adm-btn-secondary py-1 text-[11px]"
                        >
                          {flag.enabledGlobal ? "Pause" : "Enable"}
                        </SubmitButton>
                      </form>
                      <form action={staffToggleFeatureFlagAction}>
                        <input type="hidden" name="key" value={flag.key} />
                        <input type="hidden" name="mode" value="delete" />
                        <SubmitButton
                          spinnerSize="xs"
                          pendingText="Removing..."
                          className="adm-btn-secondary py-1 text-[11px] text-rose-700"
                        >
                          Remove
                        </SubmitButton>
                      </form>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <SectionCard
          title={`Client Help Guide Feedback (${adminAnalytics.docsFeedbackRows.length})`}
          subtitle="Live ratings & comments submitted by clients inside the Help Center"
        >
          {adminAnalytics.docsFeedbackRows.length === 0 ? (
            <p className="text-xs text-zinc-500">
              No client help guide feedback submitted yet.
            </p>
          ) : (
            <div className="divide-y divide-zinc-100 text-xs">
              {adminAnalytics.docsFeedbackRows.slice(0, 12).map((fb) => (
                <div key={fb.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="font-mono font-semibold text-slate-900">{fb.slug}</code>
                      <StatusPill
                        label={fb.helpful ? "Helpful" : "Needs Improvement"}
                        tone={fb.helpful ? "emerald" : "amber"}
                        showDot={false}
                      />
                    </div>
                    {fb.comment && <p className="mt-1 text-zinc-600">{fb.comment}</p>}
                  </div>
                  <span className="shrink-0 text-[11px] text-zinc-400 tabular-nums">
                    {new Date(fb.createdAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title={`Unanswered Help Searches (${adminAnalytics.zeroResultSearches.length})`}
          subtitle="Search terms with zero matching guides - prioritize writing new guides for top queries"
        >
          {adminAnalytics.zeroResultSearches.length === 0 ? (
            <p className="text-xs text-zinc-500">
              All recent help center searches matched at least one guide.
            </p>
          ) : (
            <div className="divide-y divide-zinc-100 text-xs">
              {adminAnalytics.zeroResultSearches.map((z) => (
                <div
                  key={z.query}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <span className="font-medium text-slate-900">&ldquo;{z.query}&rdquo;</span>
                    <div className="text-[11px] text-zinc-400 tabular-nums">
                      Last searched {new Date(z.lastSearchedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                    </div>
                  </div>
                  <StatusPill
                    label={`${z.searches} search${z.searches === 1 ? "" : "es"}`}
                    tone="amber"
                    showDot={false}
                  />
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[310px_1fr] lg:items-start">
        <SectionCard title={`Staff SOP Runbooks (${runbooks.length})`} noPadding>
          <ul className="divide-y divide-zinc-100 bg-white text-xs">
            {runbooks.map((rb, idx) => {
              const selectedDoc = sp.doc || runbooks[0]?.slug || "";
              const isSelected = selectedDoc !== "all" && rb.slug === selectedDoc;
              return (
                <li
                  key={rb.slug}
                  className={isSelected ? "bg-emerald-50/75" : "transition hover:bg-zinc-50/80"}
                >
                  <ActionLink
                    href={`/runbooks?doc=${encodeURIComponent(rb.slug)}`}
                    variant="card"
                    className="block px-4 py-3.5"
                  >
                    <div className="text-[10.5px] font-bold tracking-wider text-zinc-400 uppercase">
                      SOP #{idx + 1}
                    </div>
                    <div
                      className={`mt-0.5 font-semibold leading-snug ${
                        isSelected ? "text-emerald-800" : "text-slate-900"
                      }`}
                    >
                      {rb.title}
                    </div>
                  </ActionLink>
                </li>
              );
            })}
            <li className={sp.doc === "all" ? "bg-emerald-50/75" : "transition hover:bg-zinc-50/80"}>
              <ActionLink
                href="/runbooks?doc=all"
                variant="card"
                className="block px-4 py-3 text-center font-semibold text-emerald-700"
              >
                Show All {runbooks.length} Runbooks (Full Page) →
              </ActionLink>
            </li>
          </ul>
        </SectionCard>

        <div className="space-y-6">
          {(sp.doc === "all"
            ? runbooks
            : [runbooks.find((r) => r.slug === sp.doc) ?? runbooks[0]].filter(
                (r): r is InternalRunbook => Boolean(r)
              )
          ).map((rb) => (
            <SectionCard
              key={rb.slug}
              title={rb.title}
              action={<StatusPill label="Staff SOP Guide" tone="emerald" showDot={false} />}
            >
              <div className="w-full">
                <FormattedGuideBody markdown={rb.body} linkMode="docs" />
              </div>
            </SectionCard>
          ))}
        </div>
      </div>
    </div>
  );
}
