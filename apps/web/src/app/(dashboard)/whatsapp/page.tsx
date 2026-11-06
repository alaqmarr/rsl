import {
  getWalletAvailableSpendPaise,
  getWalletBalancePaise,
  getWorkspacePlansByKeys,
  hasActiveEntitlement,
  MIN_WALLET_BALANCE_PAISE,
  WALLET_OVERDRAFT_LIMIT_PAISE,
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
import { FeaturePlanGate, InlineAddonPlanBanner } from "@/components/feature-plan-gate";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { WhatsAppTemplateBuilder } from "@/components/whatsapp-template-builder";
import {
  addSuppressionAction,
  createTemplateAction,
  deleteTemplateAction,
  installStarterTemplatesAction,
  launchBroadcastAction,
  removeSuppressionAction,
  submitTemplateToMetaAction,
  syncMetaTemplatesAction,
} from "@/lib/actions";
import { requireWebSession } from "@/lib/session";

export default async function WhatsAppPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/whatsapp", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="WhatsApp Template Manager & Broadcasts"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View WhatsApp templates & broadcasts"
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
        pageTitle="WhatsApp Business Template Manager & Broadcasts"
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
  const canBroadcast = canRolePerform(
    session.roleSlug,
    "whatsapp:broadcast",
    session.workspace.id
  );
  const canManageSuppressions =
    canRolePerform(session.roleSlug, "whatsapp:send", session.workspace.id) || canManageTemplates;
  const canManageConnections = canRoleAccessWebRoute(
    session.roleSlug,
    "/connections",
    session.workspace.id
  );

  const hasBroadcastEntitlement = hasActiveEntitlement(session.workspace.id, "whatsapp.broadcast");
  const broadcastPlan = getWorkspacePlansByKeys(session.workspace.id, ["whatsapp.broadcast"])[0];

  const wa = getWhatsAppWorkspaceData(session.workspace.id);
  const walletBalancePaise = getWalletBalancePaise(session.workspace.id);
  const walletAvailableSpendPaise = getWalletAvailableSpendPaise(walletBalancePaise);
  const isOverdraftExhausted = walletBalancePaise <= MIN_WALLET_BALANCE_PAISE;

  const starterNames = [
    "tally_tax_invoice_pdf",
    "tally_sales_bill_created",
    "tally_payment_receipt_ack",
    "tally_overdue_bill_reminder",
  ];
  const existingTemplateNames = new Set(wa.templates.map((t) => t.name));
  const hasAllStarterTemplates = starterNames.every((n) => existingTemplateNames.has(n));
  const approvedTemplates = wa.templates.filter((t) => t.approvalStatus === "APPROVED");

  const labelByFieldKey = new Map<string, string>(
    TALLY_TEMPLATE_VARIABLE_FIELDS.map((f) => [f.key, f.label])
  );

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Daily Operations"
        title="WhatsApp Template Manager & Broadcasts"
        subtitle="Build official WhatsApp Business templates for Tally PDF invoices, payment receipts, reminders, and customer offers — with live phone preview and Meta sync."
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            {canManageTemplates && !hasAllStarterTemplates && (
              <form action={installStarterTemplatesAction}>
                <SubmitButton pendingText="Loading..." className="rsl-btn-secondary">
                  + Load Ready-Made Tally PDF Templates
                </SubmitButton>
              </form>
            )}
            {canManageTemplates && wa.wabaConnected ? (
              <form action={syncMetaTemplatesAction}>
                <SubmitButton pendingText="Syncing..." className="rsl-btn-primary">
                  Sync Templates from WhatsApp Business
                </SubmitButton>
              </form>
            ) : !wa.wabaConnected && canManageConnections ? (
              <ActionLink href="/connections" className="rsl-btn-primary">
                Connect WhatsApp Business Account
              </ActionLink>
            ) : null}
          </div>
        }
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Saved Templates"
          value={String(wa.templates.length)}
          sublabel={
            wa.wabaConnected
              ? `Connected: ${wa.wabaDisplayName}`
              : "Ready for Tally PDF bills & broadcasts"
          }
          accent="emerald"
        />
        <MetricCard
          label="Opted-In Contacts"
          value={wa.eligibleOptInCount.toLocaleString("en-IN")}
          sublabel="Customers who agreed to receive updates"
          accent="sky"
        />
        <MetricCard
          label="Opt-Out / Blocked List"
          value={String(wa.suppressions.length)}
          sublabel="Permanently excluded from messages"
          accent="amber"
        />
        <MetricCard
          label="Available Wallet Balance"
          value={formatInr(walletBalancePaise, { showDecimals: true })}
          accent={
            isOverdraftExhausted ? "ruby" : walletBalancePaise < 0 ? "amber" : "default"
          }
          sublabel={
            walletBalancePaise < 0
              ? `Overdraft active • ${formatInr(walletAvailableSpendPaise, { showDecimals: true })} of ${formatInr(WALLET_OVERDRAFT_LIMIT_PAISE)} credit left`
              : `₹0.85 utility • ₹0.95 marketing (usable down to ${formatInr(MIN_WALLET_BALANCE_PAISE)})`
          }
        />
      </div>

      {canManageTemplates && (
        <SectionCard
          title="Design WhatsApp Message Template"
          subtitle="Create structured templates with headers, Tally bill placeholders, footers, and interactive buttons"
        >
          <WhatsAppTemplateBuilder
            action={createTemplateAction}
            wabaConnected={wa.wabaConnected}
          />
        </SectionCard>
      )}

      <SectionCard
        title={`Your WhatsApp Template Library (${wa.templates.length})`}
        subtitle="Attach these templates to automatic Tally Prime bill rules or bulk customer broadcasts"
        noPadding
      >
        {wa.templates.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-4 p-6 text-[13.5px] text-zinc-600">
            <span>
              No templates saved yet.
              {canManageTemplates
                ? ' Click "+ Load Ready-Made Tally PDF Templates" to add Tally PDF Invoice, Sales Bill, Payment Receipt, and Overdue Reminder templates in one click.'
                : " Ask an Owner, Admin, or Manager to install or create WhatsApp templates."}
            </span>
            {canManageTemplates && (
              <form action={installStarterTemplatesAction}>
                <SubmitButton pendingText="Loading..." className="rsl-btn-primary">
                  Load Ready-Made Tally PDF Templates
                </SubmitButton>
              </form>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-zinc-200/80 bg-zinc-50/75 text-[11px] tracking-wider text-zinc-500 uppercase">
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
              <tbody className="divide-y divide-zinc-100">
                {wa.templates.map((t) => (
                  <tr key={t.id}>
                    <td className="px-5 py-4 align-top sm:px-6">
                      <div className="font-mono font-semibold text-slate-900">{t.name}</div>
                      <div className="mt-0.5 text-xs text-zinc-500 capitalize">
                        {t.category} • {t.language}
                        {t.headerType === "DOCUMENT" ? " • PDF Document Header" : ""}
                      </div>
                    </td>
                    <td className="max-w-md px-4 py-4 align-top">
                      {t.headerType === "DOCUMENT" && (
                        <div className="mb-1 inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                          Attaches Exact Tally-Printed PDF
                        </div>
                      )}
                      {t.headerText && (
                        <div className="mb-0.5 font-semibold text-slate-900">{t.headerText}</div>
                      )}
                      <div className="leading-relaxed text-zinc-700">{t.bodyText}</div>
                      {t.footerText && (
                        <div className="mt-1 text-xs text-zinc-500">{t.footerText}</div>
                      )}
                      {t.buttons.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {t.buttons.map((b, idx) => (
                            <span
                              key={idx}
                              className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800"
                            >
                              Button: {b.text}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4 align-top text-xs text-zinc-600">
                      {t.variables.length === 0 ? (
                        <span className="text-zinc-400">Static text</span>
                      ) : (
                        <ul className="space-y-1">
                          {t.variables.map((v) => {
                            const slot = v.replace(/[{}]/g, "");
                            const fieldKey = t.variableMappings[slot];
                            return (
                              <li key={v}>
                                <span className="font-mono font-semibold text-emerald-700">{v}</span>{" "}
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
                                ? "Draft — Submit to Meta"
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
                        <div className="mt-1 max-w-[220px] text-[11px] leading-snug text-rose-700">
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard
          title="Send Bulk WhatsApp Broadcast"
          subtitle={`Sends to ${wa.eligibleOptInCount} opted-in customer contacts using your wallet balance (down to ${formatInr(MIN_WALLET_BALANCE_PAISE)} overdraft)`}
        >
          {!hasBroadcastEntitlement && broadcastPlan ? (
            <InlineAddonPlanBanner plan={broadcastPlan} returnPath="/whatsapp" />
          ) : !canBroadcast ? (
            <p className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3.5 text-xs text-zinc-600">
              Read-only view — Owner, Admin, or Manager permission is required to launch bulk
              WhatsApp broadcasts.
            </p>
          ) : approvedTemplates.length === 0 ? (
            <p className="text-[13px] text-zinc-500">
              {wa.templates.length === 0
                ? "Save or load a WhatsApp template above before sending a broadcast."
                : "No approved WhatsApp templates available yet — wait for Meta review or load ready-made templates."}
            </p>
          ) : wa.eligibleOptInCount === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-4 text-[13px] text-zinc-600">
              <span>
                Add opted-in customer contacts first so your broadcast has recipients.
              </span>
              {canRoleAccessWebRoute(session.roleSlug, "/inbox", session.workspace.id) && (
                <ActionLink href="/inbox" className="rsl-btn-secondary py-1.5 text-xs">
                  Add Opted-In Contacts →
                </ActionLink>
              )}
            </div>
          ) : (
            <form action={launchBroadcastAction} className="space-y-3.5 text-[13px]">
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
                  {approvedTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.category} — est.{" "}
                      {formatInr(wa.eligibleOptInCount * (t.category === "marketing" ? 95 : 85), {
                        showDecimals: true,
                      })}
                      )
                    </option>
                  ))}
                </select>
              </div>
              <SubmitButton pendingText="Sending Broadcast..." className="rsl-btn-primary">
                Send Broadcast ({wa.eligibleOptInCount} recipients)
              </SubmitButton>
            </form>
          )}

          {hasBroadcastEntitlement && wa.broadcasts.length > 0 && (
            <div className="mt-5 border-t border-zinc-100 pt-4">
              <div className="mb-2 text-xs font-semibold text-slate-900">
                Recent Broadcasts ({wa.broadcasts.length})
              </div>
              <ul className="divide-y divide-zinc-100 text-[13px]">
                {wa.broadcasts.slice(0, 5).map((b) => (
                  <li key={b.id} className="flex items-center justify-between py-2.5">
                    <span className="font-medium text-slate-900">{b.name}</span>
                    <span className="text-zinc-600 tabular-nums">
                      {b.deliveredCount}/{b.totalRecipients} delivered •{" "}
                      {formatInr(b.actualCostPaise, { showDecimals: true })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title={`Opt-Out / Do-Not-Message Numbers (${wa.suppressions.length})`}
          subtitle="Any customer on this list will never receive automated messages or broadcasts"
        >
          {canManageSuppressions ? (
            <form
              action={addSuppressionAction}
              className="grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            >
              <div>
                <label className="rsl-label">Phone Number *</label>
                <input
                  name="phoneE164"
                  required
                  placeholder="+919820000000"
                  className="rsl-input font-mono"
                />
              </div>
              <div>
                <label className="rsl-label">Reason / Note</label>
                <input
                  name="reason"
                  placeholder="Requested STOP"
                  className="rsl-input"
                />
              </div>
              <SubmitButton pendingText="Saving..." className="rsl-btn-secondary">
                Add to List
              </SubmitButton>
            </form>
          ) : (
            <p className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3.5 text-xs text-zinc-600">
              Read-only view — messaging or template management permission is required to edit the
              do-not-message list.
            </p>
          )}

          {wa.suppressions.length > 0 && (
            <ul className="mt-4 divide-y divide-zinc-100 text-[13px]">
              {wa.suppressions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div>
                    <span className="font-mono font-medium text-slate-900">{s.identifier}</span>
                    <span className="ml-2 text-xs text-zinc-500">• {s.reason}</span>
                  </div>
                  {canManageSuppressions && (
                    <form action={removeSuppressionAction}>
                      <input type="hidden" name="suppressionId" value={s.id} />
                      <SubmitButton
                        spinnerSize="xs"
                        pendingText="Updating..."
                        className="rsl-btn-secondary py-1 text-xs"
                      >
                        Re-Enable (Re-Consented)
                      </SubmitButton>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
