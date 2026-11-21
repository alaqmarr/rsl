import { hasActiveEntitlement, getWorkspacePlansByKeys } from "@rsl/billing";
import { canRoleAccessWebRoute, canRolePerform, formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, MetricCard, PageHeader, SectionCard, StatusPill } from "@rsl/ui";
import { getWhatsAppWorkspaceData } from "@rsl/whatsapp";
import { FeaturePlanGate } from "@/components/feature-plan-gate";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { WhatsAppSuiteNav } from "@/components/suite-subnav";
import { addSuppressionAction, removeSuppressionAction } from "@/lib/actions";
import { requireWebSession } from "@/lib/session";

export default async function WhatsAppContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/whatsapp", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="WhatsApp Opt-Outs & Contacts"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View WhatsApp contacts & suppressions"
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
        pageTitle="WhatsApp Opt-Outs & Contacts"
        pageSubtitle="Manage opted-in customer contacts and maintain a strict Do-Not-Message compliance list."
        plans={plans}
        returnPath="/whatsapp/contacts"
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
  const canManageSuppressions =
    canRolePerform(session.roleSlug, "whatsapp:send", session.workspace.id) || canManageTemplates;

  const wa = getWhatsAppWorkspaceData(session.workspace.id);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Meta -> WhatsApp"
        title="Opt-Outs & Do-Not-Message List"
        subtitle="Customers on this list are blocked from automated Tally dispatches and bulk broadcasts"
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <ActionLink href="/inbox?channel=whatsapp" className="rsl-btn-secondary">
              Open WhatsApp Team Inbox →
            </ActionLink>
          </div>
        }
      />

      <WhatsAppSuiteNav
        active="contacts"
        templatesCount={wa.templates.length}
        broadcastsCount={wa.broadcasts.length}
        suppressionsCount={wa.suppressions.length}
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <MetricCard
          label="Opted-In Contacts"
          value={wa.eligibleOptInCount.toLocaleString("en-IN")}
          sublabel="Eligible to receive broadcasts & updates"
          accent="emerald"
        />
        <MetricCard
          label="Suppressed / Opt-Out Numbers"
          value={String(wa.suppressions.length)}
          sublabel="Automatically excluded from all outgoing messages"
          accent="amber"
        />
        <MetricCard
          label="Consent Standard"
          value="STOP Keyword"
          sublabel="Inbound STOP replies auto-block within seconds"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="xl:col-span-5">
          <SectionCard
            title="Block / Opt-Out a Phone Number"
            subtitle="Add a customer phone number in E.164 format (+91...)"
          >
            {canManageSuppressions ? (
              <form action={addSuppressionAction} className="space-y-3.5 text-[13px]">
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
                <SubmitButton pendingText="Saving..." className="rsl-btn-primary w-full">
                  Add to Do-Not-Message List
                </SubmitButton>
              </form>
            ) : (
              <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-inset)] p-3.5 text-xs text-[var(--ink-secondary)]">
                Read-only view - messaging or template management permission is required to edit the
                do-not-message list.
              </p>
            )}
          </SectionCard>
        </div>

        <div className="xl:col-span-7">
          <SectionCard
            title={`Suppressed Numbers (${wa.suppressions.length})`}
            subtitle="Re-enable a number only after obtaining fresh customer opt-in consent"
            noPadding
          >
            {wa.suppressions.length === 0 ? (
              <div className="p-6 text-[13px] text-[var(--ink-muted)]">
                No suppressed phone numbers yet. Anyone who replies STOP or is added on the left
                appears here.
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)] text-[13px]">
                {wa.suppressions.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 sm:px-6"
                  >
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="font-mono font-semibold text-[var(--ink)]">{s.identifier}</span>
                      <StatusPill label={s.reason || "Opted Out"} tone="amber" />
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
    </div>
  );
}
