import { canRoleAccessWebRoute, canRolePerform, formatRoleLabel } from "@rsl/rbac";
import { getWorkspacePlansByKeys, hasActiveEntitlement } from "@rsl/billing";
import {
  AccessRestrictedState,
  ConfirmSubmitButton,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@rsl/ui";
import {
  ConfidentialityOtpBar,
  ConfidentialityVaultCard,
} from "@/components/confidentiality-vault-card";
import { FeaturePlanGate, InlineAddonPlanBanner } from "@/components/feature-plan-gate";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { TallyFreePowerToolsBar } from "@/components/tally-free-power-tools";
import { TallySuiteNav } from "@/components/tally-suite-nav";
import {
  createTallyAutomationAction,
  deleteReminderRuleAction,
  deleteTallyAutomationAction,
  installStarterTemplatesAction,
  runDueTallyRemindersAction,
  saveReminderRuleAction,
  toggleTallyAutomationAction,
} from "@/lib/actions";
import { requireWebSession } from "@/lib/session";
import { loadTallyPageContext } from "@/lib/tally-data";

export default async function TallyAutomationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/tally", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Tally Auto-Send Rules & Reminders"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View Tally automation rules"
        homeHref="/inbox"
        homeLabel="Go to Customer Messages"
      />
    );
  }

  if (!hasActiveEntitlement(session.workspace.id, "tally.sync")) {
    const plans = getWorkspacePlansByKeys(session.workspace.id, ["tally.sync", "tally.invoicing"]);
    return (
      <FeaturePlanGate
        pageTitle="Tally Auto-Send & Overdue Reminders"
        pageSubtitle="Automatically WhatsApp Tally-printed PDFs on voucher save and trigger scheduled overdue payment follow-ups."
        plans={plans}
        returnPath="/tally/automation"
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  const ctx = await loadTallyPageContext({
    workspaceId: session.workspace.id,
    workspaceName: session.workspace.name,
    workspaceSlug: session.workspace.slug,
    userId: session.user.id,
    roleSlug: session.roleSlug,
    defaultTallyCompany: session.workspace.defaultTallyCompany,
    companyParam: sp.company,
  });

  const {
    tally,
    selectedCompanyId,
    companyScopedVouchers,
    approvedTemplates,
    activeRulesCount,
    canManageTally,
    hasInvoicingEntitlement,
    invoicingPlan,
  } = ctx;

  return (
    <div className="w-full space-y-6">
      <TallySuiteNav
        activeSection="automation"
        vouchersCount={companyScopedVouchers.length}
        rulesCount={activeRulesCount}
        partiesCount={tally.totals.partiesCount}
        stockItemsCount={tally.totals.stockItemsCount}
        companies={tally.companies}
        selectedCompanyId={selectedCompanyId}
      />

      <PageHeader
        eyebrow="Meta -> WhatsApp -> Tally Integration"
        title="Auto-Send Rules, Reminders & Power Tools"
        subtitle="Trigger WhatsApp PDF bills when vouchers save in Tally, schedule overdue follow-ups, and run CA/Vendor workflows"
        actions={
          canManageTally && hasInvoicingEntitlement && approvedTemplates.length > 0 ? (
            <form action={runDueTallyRemindersAction}>
              <SubmitButton pendingText="Checking Bills..." className="rsl-btn-primary">
                Run Due Reminders Now
              </SubmitButton>
            </form>
          ) : undefined
        }
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <ConfidentialityOtpBar
        isMasked={tally.confidentiality.isMasked}
        unmaskActive={tally.confidentiality.unmaskActive}
        unmaskExpiresAt={tally.confidentiality.unmaskExpiresAt}
        policy={tally.confidentiality.policy}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <SectionCard
          title="Automatic WhatsApp Rules on Bill Save"
          subtitle="Send untouched Tally-printed PDF invoices whenever a voucher saves"
        >
          {!hasInvoicingEntitlement && invoicingPlan ? (
            <InlineAddonPlanBanner plan={invoicingPlan} returnPath="/tally/automation" />
          ) : !canManageTally ? (
            <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-inset)] p-3.5 text-xs text-[var(--ink-secondary)]">
              Read-only view - Owner, Admin, or Manager permission is required to edit automation
              rules.
            </p>
          ) : approvedTemplates.length === 0 ? (
            <div className="rounded-xl border border-[var(--warning)]/30 bg-[var(--warning-surface)] p-4 text-xs text-[var(--ink)]">
              <div className="font-semibold">Meta-Approved WhatsApp Template Required</div>
              <p className="mt-1 text-[var(--ink-secondary)]">
                Approve a template in{" "}
                <ActionLink href="/whatsapp" className="font-semibold text-[var(--brand)] underline">
                  Message Templates
                </ActionLink>{" "}
                first. Wallet charges apply only on confirmed Meta delivery.
              </p>
              <form action={installStarterTemplatesAction} className="mt-3">
                <SubmitButton pendingText="Loading Templates..." className="rsl-btn-primary text-xs">
                  + Load Starter Tally Templates
                </SubmitButton>
              </form>
            </div>
          ) : (
            <form action={createTallyAutomationAction} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="rsl-label">Rule Name</label>
                  <input
                    name="name"
                    required
                    placeholder="e.g. Auto-Send Tally PDF Sales Invoice"
                    className="rsl-input"
                  />
                </div>
                <div>
                  <label className="rsl-label">When Tally Generates</label>
                  <select name="triggerEvent" defaultValue="Sales" className="rsl-input">
                    <option value="Sales">Sales Bill / Tax Invoice (Attaches Tally PDF)</option>
                    <option value="Receipt">Payment Receipt</option>
                    <option value="CreditNote">Credit Note</option>
                    <option value="All">Any Bill or Receipt</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.5fr_1fr]">
                <div>
                  <label className="rsl-label">Send WhatsApp Template</label>
                  <select
                    name="templateId"
                    required
                    defaultValue={
                      approvedTemplates.find((t) => t.name === "tally_tax_invoice_pdf")?.id ??
                      approvedTemplates[0]?.id
                    }
                    className="rsl-input"
                  >
                    {approvedTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.category})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="rsl-label">Minimum Bill Amount (₹)</label>
                  <input
                    name="minAmountRupees"
                    type="number"
                    min={0}
                    defaultValue={0}
                    className="rsl-input tabular-nums"
                  />
                </div>
              </div>

              <SubmitButton pendingText="Saving Rule..." className="rsl-btn-primary">
                Enable Automatic WhatsApp Rule
              </SubmitButton>
            </form>
          )}

          {hasInvoicingEntitlement && tally.automationRules.length > 0 && (
            <ul className="mt-5 divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)] pt-3 text-xs">
              {tally.automationRules.map((rule) => (
                <li
                  key={rule.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                >
                  <div>
                    <div className="font-semibold text-[var(--ink)]">{rule.name}</div>
                    <div className="text-[11px] text-[var(--ink-muted)]">
                      On <strong>{rule.triggerEvent}</strong> →{" "}
                      <code className="font-mono text-[var(--brand)]">{rule.templateName}</code> •
                      Sent <strong>{rule.triggeredCount}</strong>x
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <StatusPill
                      label={rule.active ? "Active" : "Paused"}
                      tone={rule.active ? "emerald" : "stone"}
                    />
                    {canManageTally && (
                      <>
                        <form action={toggleTallyAutomationAction}>
                          <input type="hidden" name="ruleId" value={rule.id} />
                          <input type="hidden" name="active" value={String(!rule.active)} />
                          <SubmitButton spinnerSize="xs" className="rsl-btn-secondary py-1 text-xs">
                            {rule.active ? "Pause" : "Resume"}
                          </SubmitButton>
                        </form>
                        <form action={deleteTallyAutomationAction}>
                          <input type="hidden" name="ruleId" value={rule.id} />
                          <ConfirmSubmitButton
                            confirmMessage={`Delete rule "${rule.name}"?`}
                            className="rsl-btn-danger-soft py-1 text-xs"
                          >
                            Delete
                          </ConfirmSubmitButton>
                        </form>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Overdue Payment Reminder Schedules"
          subtitle="Automatic pre-due and overdue WhatsApp follow-ups"
        >
          {!hasInvoicingEntitlement && invoicingPlan ? (
            <InlineAddonPlanBanner plan={invoicingPlan} returnPath="/tally/automation" />
          ) : canManageTally ? (
            approvedTemplates.length === 0 ? (
              <p className="rounded-xl border border-[var(--warning)]/30 bg-[var(--warning-surface)] p-3.5 text-xs text-[var(--ink-secondary)]">
                Approve a WhatsApp template on{" "}
                <ActionLink href="/whatsapp" className="font-semibold text-[var(--brand)] underline">
                  Message Templates
                </ActionLink>{" "}
                before creating overdue schedules.
              </p>
            ) : (
              <form
                action={saveReminderRuleAction}
                className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2"
              >
                <input
                  name="name"
                  required
                  placeholder="e.g. 7 Days Overdue Follow-Up"
                  className="rsl-input"
                />
                <select
                  name="templateName"
                  required
                  defaultValue={
                    approvedTemplates.find((t) => t.name === "tally_overdue_bill_reminder")
                      ?.name ?? approvedTemplates[0]?.name
                  }
                  className="rsl-input"
                >
                  {approvedTemplates.map((t) => (
                    <option key={t.id} value={t.name}>
                      {t.name} (Meta Approved)
                    </option>
                  ))}
                </select>
                <input
                  name="triggerDaysOffset"
                  type="number"
                  defaultValue={7}
                  required
                  title="Negative = days before due date; Positive = days after due date"
                  className="rsl-input tabular-nums"
                />
                <SubmitButton pendingText="Saving..." className="rsl-btn-primary">
                  Add Schedule
                </SubmitButton>
              </form>
            )
          ) : (
            <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-inset)] p-3.5 text-xs text-[var(--ink-secondary)]">
              Read-only view - manager permission required to modify schedules.
            </p>
          )}

          {hasInvoicingEntitlement && tally.rules.length > 0 && (
            <ul className="mt-4 divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)] pt-3 text-xs">
              {tally.rules.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                >
                  <div>
                    <div className="font-semibold text-[var(--ink)]">{r.name}</div>
                    <div className="text-[11px] text-[var(--ink-muted)]">
                      {r.triggerDaysOffset >= 0
                        ? `${r.triggerDaysOffset} days after due date`
                        : `${Math.abs(r.triggerDaysOffset)} days before due date`}{" "}
                      • Max {r.maxRemindersPerBill} reminders/bill
                    </div>
                  </div>
                  {canManageTally && (
                    <form action={deleteReminderRuleAction}>
                      <input type="hidden" name="ruleId" value={r.id} />
                      <ConfirmSubmitButton
                        confirmMessage={`Remove overdue reminder schedule "${r.name}"?`}
                        className="rsl-btn-danger-soft py-1 text-xs"
                      >
                        Remove
                      </ConfirmSubmitButton>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <TallyFreePowerToolsBar
        canManageTally={canManageTally}
        supplierInboxEmail={tally.supplierBillInbox.emailAddress}
        supplierInboxReady={tally.supplierBillInbox.configured}
        drafts={tally.supplierBillDrafts}
        defaultCompanyName={tally.companies[0]?.name}
      />

      <details className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
        <summary className="cursor-pointer select-none text-xs font-semibold text-[var(--ink)]">
          Buyer &amp; Supplier Confidentiality, OTP Reveal &amp; Auto-Delete Retention Policy
        </summary>
        <div className="mt-4">
          <ConfidentialityVaultCard
            initialPolicy={tally.confidentiality.policy}
            isMasked={tally.confidentiality.isMasked}
            unmaskActive={tally.confidentiality.unmaskActive}
            unmaskExpiresAt={tally.confidentiality.unmaskExpiresAt}
            canManageSettings={canRolePerform(
              session.roleSlug,
              "workspace:manage",
              session.workspace.id
            )}
          />
        </div>
      </details>
    </div>
  );
}
