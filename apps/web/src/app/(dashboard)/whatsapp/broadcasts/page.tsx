import Link from "next/link";
import {
  getWalletAvailableSpendPaise,
  getWalletBalancePaise,
  getWorkspacePlansByKeys,
  getWorkspaceWhatsAppMessagingRates,
  hasActiveEntitlement,
  MIN_WALLET_BALANCE_PAISE,
  resolveWhatsAppTemplateUnitCostPaise,
} from "@rsl/billing";
import { formatInr } from "@rsl/core";
import { canRoleAccessWebRoute, canRolePerform, formatRoleLabel } from "@rsl/rbac";
import {
  AccessRestrictedState,
  MetricCard,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@rsl/ui";
import { getWhatsAppWorkspaceData } from "@rsl/whatsapp";
import { FeaturePlanGate, InlineAddonPlanBanner } from "@/components/feature-plan-gate";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { WhatsAppSuiteNav } from "@/components/suite-subnav";
import { launchBroadcastAction } from "@/lib/actions";
import { requireWebSession } from "@/lib/session";

export default async function WhatsAppBroadcastsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/whatsapp", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="WhatsApp Bulk Broadcasts"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View WhatsApp broadcasts"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  if (!hasActiveEntitlement(session.workspace.id, "whatsapp.messaging")) {
    const plans = getWorkspacePlansByKeys(session.workspace.id, [
      "whatsapp.messaging",
      "whatsapp.broadcast",
    ]);
    return (
      <FeaturePlanGate
        pageTitle="WhatsApp Bulk Broadcasts"
        pageSubtitle="Send official WhatsApp announcements, festive offers, and catalogues to opted-in customers with live wallet metering."
        plans={plans}
        returnPath="/whatsapp/broadcasts"
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  const canBroadcast = canRolePerform(
    session.roleSlug,
    "whatsapp:broadcast",
    session.workspace.id
  );
  const hasBroadcastEntitlement = hasActiveEntitlement(session.workspace.id, "whatsapp.broadcast");
  const broadcastPlan = getWorkspacePlansByKeys(session.workspace.id, ["whatsapp.broadcast"])[0];

  const wa = getWhatsAppWorkspaceData(session.workspace.id);
  const waRates = getWorkspaceWhatsAppMessagingRates(session.workspace.id);
  const approvedTemplates = wa.templates.filter((t) => t.approvalStatus === "APPROVED");
  const walletBalancePaise = getWalletBalancePaise(session.workspace.id);
  const walletAvailableSpendPaise = getWalletAvailableSpendPaise(walletBalancePaise);
  const isOverdraftExhausted = walletBalancePaise <= MIN_WALLET_BALANCE_PAISE;
  const totalDelivered = wa.broadcasts.reduce((sum, b) => sum + b.deliveredCount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Meta -> WhatsApp"
        title="Bulk WhatsApp Broadcasts"
        subtitle="Dispatch approved template campaigns to opted-in contacts with per-message wallet tracking"
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <ActionLink href="/billing/wallet" className="rsl-btn-secondary">
              Top Up Wallet
            </ActionLink>
            <ActionLink href="/whatsapp" className="rsl-btn-secondary">
              Manage Templates
            </ActionLink>
          </div>
        }
      />

      <WhatsAppSuiteNav
        active="broadcasts"
        templatesCount={wa.templates.length}
        broadcastsCount={wa.broadcasts.length}
        suppressionsCount={wa.suppressions.length}
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <MetricCard
          label="Opted-In Recipients"
          value={wa.eligibleOptInCount.toLocaleString("en-IN")}
          sublabel={`${wa.suppressions.length} opted out excluded`}
          accent="sky"
        />
        <MetricCard
          label="Approved Templates"
          value={String(approvedTemplates.length)}
          sublabel="Ready for bulk dispatch"
          accent="emerald"
        />
        <MetricCard
          label="Broadcasts Sent"
          value={String(wa.broadcasts.length)}
          sublabel={`${totalDelivered.toLocaleString("en-IN")} messages delivered`}
        />
        <MetricCard
          label="Available Spend"
          value={formatInr(walletAvailableSpendPaise, { showDecimals: true })}
          sublabel={`Wallet ${formatInr(walletBalancePaise, { showDecimals: true })}`}
          accent={isOverdraftExhausted ? "ruby" : "emerald"}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="xl:col-span-5">
          <SectionCard
            title="Launch New Broadcast"
            subtitle={`Targets ${wa.eligibleOptInCount} opted-in customer contacts (excludes do-not-message numbers)`}
          >
            {!hasBroadcastEntitlement && broadcastPlan ? (
              <InlineAddonPlanBanner plan={broadcastPlan} returnPath="/whatsapp/broadcasts" />
            ) : !canBroadcast ? (
              <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-inset)] p-3.5 text-xs text-[var(--ink-secondary)]">
                Read-only view - Owner, Admin, or Manager permission is required to launch bulk
                WhatsApp broadcasts.
              </p>
            ) : approvedTemplates.length === 0 ? (
              <div className="space-y-3 text-[13px] text-[var(--ink-secondary)]">
                <p>
                  {wa.templates.length === 0
                    ? "Create or load ready-made WhatsApp templates first before sending a broadcast."
                    : "No Meta-approved templates are available yet. Wait for template approval on the Message Templates tab."}
                </p>
                <ActionLink href="/whatsapp" className="rsl-btn-secondary py-1.5 text-xs">
                  Open Message Templates →
                </ActionLink>
              </div>
            ) : wa.eligibleOptInCount === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-inset)] p-4 text-[13px] text-[var(--ink-secondary)]">
                <span>Add opted-in customer contacts first so your broadcast has recipients.</span>
                <ActionLink href="/inbox?channel=whatsapp" className="rsl-btn-secondary py-1.5 text-xs">
                  Add Contacts in Inbox →
                </ActionLink>
              </div>
            ) : (
              <form action={launchBroadcastAction} className="space-y-4 text-[13px]">
                <div>
                  <label className="rsl-label">Broadcast Name *</label>
                  <input
                    name="name"
                    required
                    placeholder="Festive Stock Arrival Update"
                    className="rsl-input"
                  />
                </div>
                <div>
                  <label className="rsl-label">Select Approved Template *</label>
                  <select name="templateId" required className="rsl-input">
                    {approvedTemplates.map((t) => {
                      const unitRate = resolveWhatsAppTemplateUnitCostPaise(
                        session.workspace.id,
                        t.category,
                        "whatsapp.broadcast"
                      );
                      return (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.category} - est.{" "}
                          {formatInr(wa.eligibleOptInCount * unitRate, {
                            showDecimals: true,
                          })}
                          )
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3 text-xs text-[var(--ink-secondary)]">
                  Utility rate: {formatInr(waRates.utilityPaise, { showDecimals: true })}/msg •
                  Marketing rate: {formatInr(waRates.marketingPaise, { showDecimals: true })}/msg •
                  Overdraft floor {formatInr(MIN_WALLET_BALANCE_PAISE)}.
                </div>
                <SubmitButton pendingText="Sending Broadcast..." className="rsl-btn-primary w-full">
                  Send Broadcast ({wa.eligibleOptInCount} recipients)
                </SubmitButton>
              </form>
            )}
          </SectionCard>
        </div>

        <div className="xl:col-span-7">
          <SectionCard
            title={`Broadcast Campaign History (${wa.broadcasts.length})`}
            subtitle="Delivery telemetry and exact INR metering per broadcast"
            noPadding
          >
            {wa.broadcasts.length === 0 ? (
              <div className="p-6 text-[13px] text-[var(--ink-muted)]">
                No broadcasts sent yet. Launch your first campaign on the left to track delivery
                rates and wallet charges here.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="border-b border-[var(--border)] bg-[var(--surface-inset)] text-[11px] tracking-wider text-[var(--ink-muted)] uppercase">
                    <tr>
                      <th className="px-5 py-3 font-semibold sm:px-6">Campaign</th>
                      <th className="px-4 py-3 font-semibold">Recipients</th>
                      <th className="px-4 py-3 font-semibold">Delivered</th>
                      <th className="px-4 py-3 font-semibold">Spend</th>
                      <th className="px-5 py-3 text-right font-semibold sm:px-6">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {wa.broadcasts.map((b) => (
                      <tr key={b.id} className="hover:bg-[var(--surface-inset)]/60">
                        <td className="px-5 py-3.5 font-medium text-[var(--ink)] sm:px-6">
                          {b.name}
                        </td>
                        <td className="px-4 py-3.5 tabular-nums text-[var(--ink-secondary)]">
                          {b.totalRecipients.toLocaleString("en-IN")}
                        </td>
                        <td className="px-4 py-3.5 tabular-nums text-[var(--ink)]">
                          {b.deliveredCount.toLocaleString("en-IN")}
                        </td>
                        <td className="px-4 py-3.5 tabular-nums font-semibold text-[var(--ink)]">
                          {formatInr(b.actualCostPaise, { showDecimals: true })}
                        </td>
                        <td className="px-5 py-3.5 text-right sm:px-6">
                          <StatusPill
                            label={b.deliveredCount >= b.totalRecipients ? "Completed" : "Dispatched"}
                            tone="emerald"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="border-t border-[var(--border-subtle)] px-5 py-3 text-xs text-[var(--ink-muted)] sm:px-6">
              Need to exclude opted-out numbers?{" "}
              <Link href="/whatsapp/contacts" className="font-semibold text-[var(--brand)] hover:underline">
                Review Opt-Outs &amp; Contacts →
              </Link>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
