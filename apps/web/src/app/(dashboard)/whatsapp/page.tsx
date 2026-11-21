import Link from "next/link";
import {
  getWalletBalancePaise,
  getWorkspacePlansByKeys,
  getWorkspaceWhatsAppMessagingRates,
  hasActiveEntitlement,
  MIN_WALLET_BALANCE_PAISE,
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
import { getWhatsAppWorkspaceData, TALLY_TEMPLATE_VARIABLE_FIELDS } from "@rsl/whatsapp";
import { FeaturePlanGate } from "@/components/feature-plan-gate";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { WhatsAppSuiteNav } from "@/components/suite-subnav";
import { WhatsAppTemplateBuilder } from "@/components/whatsapp-template-builder";
import {
  createTemplateAction,
  deleteTemplateAction,
  installStarterTemplatesAction,
  submitTemplateToMetaAction,
  syncMetaTemplatesAction,
} from "@/lib/actions";
import { requireWebSession } from "@/lib/session";

export default async function WhatsAppTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/whatsapp", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="WhatsApp Message Templates"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View WhatsApp templates"
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
        pageTitle="WhatsApp Business Templates & Broadcasts"
        pageSubtitle="Design official WhatsApp Business templates with headers, Tally bill variables, and interactive buttons, sync with Meta, and send broadcasts to opted-in customers."
        plans={plans}
        returnPath="/whatsapp"
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  const canManageTemplates = canRolePerform(
    session.roleSlug,
    "whatsapp:template.manage",
    session.workspace.id
  );
  const canManageConnections = canRoleAccessWebRoute(
    session.roleSlug,
    "/connections/whatsapp",
    session.workspace.id
  );

  const wa = getWhatsAppWorkspaceData(session.workspace.id);
  const waRates = getWorkspaceWhatsAppMessagingRates(session.workspace.id);
  const walletBalancePaise = getWalletBalancePaise(session.workspace.id);
  const isOverdraftExhausted = walletBalancePaise <= MIN_WALLET_BALANCE_PAISE;

  const starterNames = [
    "tally_tax_invoice_pdf",
    "tally_sales_bill_created",
    "tally_payment_receipt_ack",
    "tally_overdue_bill_reminder",
  ];
  const existingTemplateNames = new Set(wa.templates.map((t) => t.name));
  const hasAllStarterTemplates = starterNames.every((n) => existingTemplateNames.has(n));
  const approvedCount = wa.templates.filter((t) => t.approvalStatus === "APPROVED").length;

  const labelByFieldKey = new Map<string, string>(
    TALLY_TEMPLATE_VARIABLE_FIELDS.map((f) => [f.key, f.label])
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Meta -> WhatsApp"
        title="Message Templates"
        subtitle="Create Meta-approved templates mapped to Tally bill variables and PDF headers"
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            {canManageTemplates && !hasAllStarterTemplates && (
              <form action={installStarterTemplatesAction}>
                <SubmitButton pendingText="Loading..." className="rsl-btn-secondary">
                  Load Tally PDF Starters
                </SubmitButton>
              </form>
            )}
            {wa.wabaConnected && canManageTemplates && (
              <form action={syncMetaTemplatesAction}>
                <SubmitButton pendingText="Syncing..." className="rsl-btn-secondary">
                  Sync Meta Status
                </SubmitButton>
              </form>
            )}
            {!wa.wabaConnected && canManageConnections && (
              <ActionLink href="/connections/whatsapp" className="rsl-btn-primary">
                Connect WhatsApp Business
              </ActionLink>
            )}
          </div>
        }
      />

      <WhatsAppSuiteNav
        active="templates"
        templatesCount={wa.templates.length}
        broadcastsCount={wa.broadcasts.length}
        suppressionsCount={wa.suppressions.length}
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <MetricCard
          label="Template Library"
          value={String(wa.templates.length)}
          sublabel={`${approvedCount} Meta approved`}
          accent="emerald"
        />
        <MetricCard
          label="WhatsApp Status"
          value={wa.wabaConnected ? "Connected" : "Setup Pending"}
          sublabel={wa.wabaDisplayName || "Meta Cloud API"}
          accent={wa.wabaConnected ? "emerald" : "amber"}
        />
        <MetricCard
          label="Opted-In Reach"
          value={wa.eligibleOptInCount.toLocaleString("en-IN")}
          sublabel="Eligible recipients"
          accent="sky"
        />
        <MetricCard
          label="Wallet Balance"
          value={formatInr(walletBalancePaise, { showDecimals: true })}
          sublabel={isOverdraftExhausted ? "Recharge needed" : "Ready for dispatches"}
          accent={isOverdraftExhausted ? "ruby" : walletBalancePaise < 0 ? "amber" : "default"}
        />
      </div>

      {canManageTemplates && (
        <details
          open={wa.templates.length === 0}
          className="group rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-semibold text-[var(--ink)] select-none sm:px-6">
            <div>
              <div>+ Design New WhatsApp Message Template</div>
              <div className="mt-0.5 text-xs font-normal text-[var(--ink-muted)]">
                Add dynamic headers, Tally bill placeholders, footers, and interactive buttons
              </div>
            </div>
            <span className="rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-1 text-xs font-medium text-[var(--ink-secondary)]">
              Toggle Builder
            </span>
          </summary>
          <div className="border-t border-[var(--border-subtle)] px-5 py-5 sm:px-6">
            <WhatsAppTemplateBuilder
              action={createTemplateAction}
              wabaConnected={wa.wabaConnected}
              rates={{
                utilityPaise: waRates.utilityPaise,
                marketingPaise: waRates.marketingPaise,
                authenticationPaise: waRates.authenticationPaise,
              }}
            />
          </div>
        </details>
      )}

      <SectionCard
        title={`Saved WhatsApp Templates (${wa.templates.length})`}
        subtitle="Use approved templates in Bulk Broadcasts or Tally Auto-Send rules"
        action={
          <Link
            href="/whatsapp/broadcasts"
            className="text-xs font-semibold text-[var(--brand)] hover:underline"
          >
            Send Broadcast →
          </Link>
        }
        noPadding
      >
        {wa.templates.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-4 p-6 text-[13.5px] text-[var(--ink-secondary)]">
            <span>
              No templates saved yet.
              {canManageTemplates
                ? ' Click "Load Tally PDF Starters" above or open the template builder to create your first template.'
                : " Ask an Owner, Admin, or Manager to install or create WhatsApp templates."}
            </span>
            {canManageTemplates && (
              <form action={installStarterTemplatesAction}>
                <SubmitButton pendingText="Loading..." className="rsl-btn-primary">
                  Load Tally PDF Starters
                </SubmitButton>
              </form>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-[var(--border)] bg-[var(--surface-inset)] text-[11px] tracking-wider text-[var(--ink-muted)] uppercase">
                <tr>
                  <th className="px-5 py-3 font-semibold sm:px-6">Template Name &amp; Type</th>
                  <th className="px-4 py-3 font-semibold">Message Content</th>
                  <th className="px-4 py-3 font-semibold">Tally Auto-Fill Mapping</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  {canManageTemplates && (
                    <th className="px-5 py-3 text-right font-semibold sm:px-6">Action</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {wa.templates.map((t) => (
                  <tr key={t.id} className="transition-colors hover:bg-[var(--surface-inset)]/60">
                    <td className="px-5 py-4 align-top sm:px-6">
                      <div className="font-mono font-semibold text-[var(--ink)]">{t.name}</div>
                      <div className="mt-0.5 text-xs text-[var(--ink-muted)] capitalize">
                        {t.category} • {t.language}
                        {t.headerType === "DOCUMENT" ? " • PDF Document Header" : ""}
                      </div>
                    </td>
                    <td className="max-w-md px-4 py-4 align-top">
                      {t.headerType === "DOCUMENT" && (
                        <div className="mb-1 inline-flex rounded-md border border-[var(--success)]/30 bg-[var(--success-surface)] px-2 py-0.5 text-[11px] font-semibold text-[var(--success)]">
                          Attaches Exact Tally-Printed PDF
                        </div>
                      )}
                      {t.headerText && (
                        <div className="mb-0.5 font-semibold text-[var(--ink)]">{t.headerText}</div>
                      )}
                      <div className="leading-relaxed text-[var(--ink-secondary)]">{t.bodyText}</div>
                      {t.footerText && (
                        <div className="mt-1 text-xs text-[var(--ink-muted)]">{t.footerText}</div>
                      )}
                      {t.buttons.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {t.buttons.map((b, idx) => (
                            <span
                              key={idx}
                              className="rounded-md border border-[var(--brand)]/25 bg-[var(--brand-surface)] px-2 py-0.5 text-[11px] font-semibold text-[var(--brand)]"
                            >
                              Button: {b.text}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4 align-top text-xs text-[var(--ink-secondary)]">
                      {t.variables.length === 0 ? (
                        <span className="text-[var(--ink-muted)]">Static text</span>
                      ) : (
                        <ul className="space-y-1">
                          {t.variables.map((v) => {
                            const slot = v.replace(/[{}]/g, "");
                            const fieldKey = t.variableMappings[slot];
                            return (
                              <li key={v}>
                                <span className="font-mono font-semibold text-[var(--brand)]">{v}</span>{" "}
                                → {labelByFieldKey.get(fieldKey || "") || fieldKey || "Custom"}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-4 align-top">
                      <StatusPill
                        label={
                          t.approvalStatus === "APPROVED"
                            ? "Meta Approved"
                            : t.approvalStatus === "PENDING"
                              ? "Pending Meta Review"
                              : t.approvalStatus === "DRAFT"
                                ? "Draft - Submit to Meta"
                                : t.approvalStatus
                        }
                        tone={
                          t.approvalStatus === "APPROVED"
                            ? "emerald"
                            : t.approvalStatus === "PENDING"
                              ? "amber"
                              : t.approvalStatus === "DRAFT"
                                ? "stone"
                                : "ruby"
                        }
                      />
                      {t.rejectionReason && (
                        <div className="mt-1 max-w-[220px] text-[11px] leading-snug text-[var(--danger)]">
                          {t.rejectionReason}
                        </div>
                      )}
                    </td>
                    {canManageTemplates && (
                      <td className="px-5 py-4 text-right align-top sm:px-6">
                        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                          {wa.wabaConnected &&
                            (t.approvalStatus === "DRAFT" || t.approvalStatus === "REJECTED") && (
                              <form action={submitTemplateToMetaAction} className="inline">
                                <input type="hidden" name="templateId" value={t.id} />
                                <SubmitButton
                                  spinnerSize="xs"
                                  pendingText="Submitting..."
                                  className="rsl-btn-secondary py-1 text-xs"
                                >
                                  Submit to Meta
                                </SubmitButton>
                              </form>
                            )}
                          <form action={deleteTemplateAction} className="inline">
                            <input type="hidden" name="templateId" value={t.id} />
                            <SubmitButton
                              spinnerSize="xs"
                              pendingText="Deleting..."
                              className="rsl-btn-danger-soft"
                            >
                              Delete
                            </SubmitButton>
                          </form>
                        </div>
                      </td>
                    )}
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
