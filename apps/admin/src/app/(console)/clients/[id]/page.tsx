import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { Layers, Wallet } from "lucide-react";
import {
  canStaffPerform,
  formatStaffRoleLabel,
  listWorkspaceTeam,
} from "@rsl/auth";
import {
  getWalletAvailableSpendPaise,
  getWalletBalancePaise,
  getWorkspaceFreeAccessStatus,
  listBundlesWithWorkspaceState,
  listLedgerEntries,
  listServicesWithWorkspaceState,
  listWorkspaceBillingReminders,
  getSupplierGstStateCode,
} from "@rsl/billing";
import { formatInr, resolvePublicEndpoints } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { ensureWorkspaceSslProvisioned } from "@rsl/queue";
import { controlDb, getStaffClientIntegrationSnapshot } from "@rsl/tenancy";
import {
  FlashBanner,
  MetricCard,
  PageHeader,
  StatusPill,
} from "@rsl/ui";
import { ClientConnectionsStatusTab } from "@/components/client-detail/connections-status-tab";
import { ClientFinanceInvoicesTab } from "@/components/client-detail/finance-invoices-tab";
import { ClientPlansEntitlementsTab } from "@/components/client-detail/plans-entitlements-tab";
import { ClientProfileSslTeamTab } from "@/components/client-detail/profile-ssl-team-tab";
import { ClientSupportTemplatesTab } from "@/components/client-detail/support-templates-tab";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import {
  staffStartImpersonationAction,
  staffUpdateClientProfileAction,
} from "@/lib/actions";
import { requireStaffSession } from "@/lib/session";

export default async function AdminClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { staff } = await requireStaffSession();
  const canManageBilling = canStaffPerform(staff.staffRole, "staff:billing.manage");
  const canViewBilling = canStaffPerform(staff.staffRole, "staff:billing.view");
  const canManageClients = canStaffPerform(staff.staffRole, "staff:clients.manage");
  const canImpersonate = canStaffPerform(staff.staffRole, "staff:impersonate");
  const canManageTemplates = canStaffPerform(staff.staffRole, "staff:templates.manage");
  const canManageOps = canStaffPerform(staff.staffRole, "staff:ops.manage");
  const canSendEmail = canManageBilling || canManageOps;
  const canProvisionSsl = canManageClients || canManageOps;

  const { id } = await params;
  const sp = await searchParams;
  const activeTab = sp.tab || (canManageBilling ? "plans" : "profile");

  const db = controlDb();
  const workspace = db
    .select()
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, id))
    .get();

  if (!workspace) {
    notFound();
  }

  const sslCerts = await ensureWorkspaceSslProvisioned(workspace.id, workspace.slug);
  const clientEndpoints = resolvePublicEndpoints({
    workspaceSlug: workspace.slug,
    preferLocal: false,
  });
  const supplierStateCode = getSupplierGstStateCode();
  const walletPaise = getWalletBalancePaise(workspace.id);
  const overdraftRemainingPaise = getWalletAvailableSpendPaise(walletPaise);
  const freeAccess = getWorkspaceFreeAccessStatus(workspace.id);
  const plans = listServicesWithWorkspaceState(workspace.id);
  const bundles = listBundlesWithWorkspaceState(workspace.id);
  const reminders = listWorkspaceBillingReminders(workspace.id, 6);
  const ledger = listLedgerEntries(workspace.id, 30);
  const team = listWorkspaceTeam(workspace.id);
  const integrationSnapshot = getStaffClientIntegrationSnapshot(workspace.id);
  const canTestIntegrations = canManageClients || canManageOps;
  const invoices = db
    .select()
    .from(controlSchema.invoices)
    .where(eq(controlSchema.invoices.workspaceId, workspace.id))
    .orderBy(desc(controlSchema.invoices.issuedAt))
    .limit(25)
    .all();

  const usersById = new Map(
    db
      .select()
      .from(controlSchema.users)
      .all()
      .map((u) => [u.id, u])
  );

  const unlockedCount = plans.filter((p) => p.isUnlocked).length;
  const pendingCount = plans.filter((p) => Boolean(p.pendingRequest)).length;
  const isPaused = workspace.billingStatus === "suspended";
  const ownerEmail = team.members[0]?.email || "";
  const staffRoleLabel = formatStaffRoleLabel(staff.staffRole);
  const returnHere = `/clients/${workspace.id}?tab=${activeTab}`;

  const teamMembers = team.members.map((m) => ({
    membershipId: m.membershipId,
    userId: m.userId,
    name: m.name,
    email: m.email,
    roleSlug: m.roleSlug,
    emailVerified: Boolean(usersById.get(m.userId)?.emailVerified),
  }));

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow={
          <>
            <ActionLink
              href="/clients"
              className="text-xs font-semibold text-zinc-500 hover:text-slate-900"
            >
              ← Client Directory
            </ActionLink>
            <span className="text-zinc-300">/</span>
            <StatusPill
              label={isPaused ? "Account Paused" : "Active Account"}
              tone={isPaused ? "ruby" : "emerald"}
            />
            {freeAccess.isActive && (
              <StatusPill
                label={`Free All-Tools Access (${freeAccess.remainingDays}d left)`}
                tone="emerald"
              />
            )}
            {workspace.allowManualCredentials && (
              <StatusPill label="Manual Credentials Enabled" tone="amber" />
            )}
            {workspace.gstin && (
              <span className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 font-mono text-[11px] font-medium text-zinc-600">
                GSTIN: {workspace.gstin}
              </span>
            )}
          </>
        }
        title={workspace.name}
        subtitle={`Client ID: ${workspace.id} • State Code ${workspace.stateCode} (${
          workspace.stateCode === supplierStateCode ? "CGST + SGST" : "IGST 18%"
        }) • Created ${new Date(workspace.createdAt).toLocaleDateString("en-IN")}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canViewBilling && (
              <a
                href={`/api/pdf/client-statement?workspaceId=${workspace.id}`}
                className="adm-btn-secondary text-xs"
              >
                Statement PDF
              </a>
            )}

            {canManageClients && (
              <form action={staffUpdateClientProfileAction}>
                <input type="hidden" name="workspaceId" value={workspace.id} />
                <input type="hidden" name="name" value={workspace.name} />
                <input type="hidden" name="industry" value={workspace.industry ?? ""} />
                <input type="hidden" name="gstin" value={workspace.gstin ?? ""} />
                <input type="hidden" name="stateCode" value={workspace.stateCode} />
                <input
                  type="hidden"
                  name="billingStatus"
                  value={isPaused ? "active" : "suspended"}
                />
                <input type="hidden" name="returnTo" value={returnHere} />
                <SubmitButton
                  className={isPaused ? "adm-btn-primary text-xs" : "adm-btn-danger text-xs"}
                  spinnerSize="xs"
                  pendingText={isPaused ? "Activating..." : "Pausing..."}
                >
                  {isPaused ? "Reactivate Account" : "Pause Account"}
                </SubmitButton>
              </form>
            )}

            {canImpersonate && (
              <form action={staffStartImpersonationAction} className="inline-flex items-center gap-1.5">
                <input type="hidden" name="workspaceId" value={workspace.id} />
                <input type="hidden" name="returnTo" value={returnHere} />
                <input type="hidden" name="reason" value="Client onboarding & support assistance" />
                <SubmitButton className="adm-btn-dark text-xs" spinnerSize="xs" pendingText="Opening...">
                  Open Client Dashboard (30m) ↗
                </SubmitButton>
              </form>
            )}
          </div>
        }
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Unlocked Tools"
          value={`${unlockedCount} / ${plans.length}`}
          sublabel={
            freeAccess.isActive
              ? `Complimentary all-tools access (${freeAccess.remainingDays}d left)`
              : pendingCount > 0
                ? `${pendingCount} request(s) waiting for payment`
                : "All active plans verified"
          }
          accent={unlockedCount > 0 ? "emerald" : "default"}
          icon={<Layers className="h-4 w-4" />}
        />
        <MetricCard
          label="Wallet Balance"
          value={formatInr(walletPaise, { showDecimals: true })}
          sublabel={
            walletPaise < 0
              ? `Overdraft active • ${formatInr(overdraftRemainingPaise, { showDecimals: true })} left of ₹200.00 limit`
              : `${ledger.length} recent passbook entries`
          }
          accent={walletPaise < 0 ? "ruby" : "emerald"}
          icon={<Wallet className="h-3.5 w-3.5" />}
        />
        <MetricCard
          label="GST Tax Invoices"
          value={String(invoices.length)}
          sublabel={
            invoices[0] ? `Latest: ${invoices[0].invoiceNumber}` : "No GST invoices issued yet"
          }
        />
        <MetricCard
          label="Auto Renewal Reminders"
          value={freeAccess.autoBillingReminders ? "Enabled" : "Paused"}
          sublabel={`${reminders.length} reminder(s) logged • ${team.members.length} user(s)`}
          accent={freeAccess.autoBillingReminders ? "emerald" : "default"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-zinc-200/90 bg-white p-1.5 shadow-2xs">
        {[
          {
            key: "plans",
            label: `Free Access, Bundles, Cycles & Custom Rates (${unlockedCount}/${plans.length})`,
          },
          ...(canViewBilling
            ? [{ key: "finance", label: `Wallet, PDFs & GST Invoices (${invoices.length})` }]
            : []),
          {
            key: "connections",
            label: `Connected Channels & Live Status (${integrationSnapshot.connections.length})`,
          },
          { key: "profile", label: `Business Profile, SSL & Team (${team.members.length})` },
          { key: "support", label: "Templates & Email Tools" },
        ].map((tab) => {
          const isCurrent = activeTab === tab.key;
          return (
            <ActionLink
              key={tab.key}
              href={`/clients/${workspace.id}?tab=${tab.key}`}
              className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
                isCurrent
                  ? "bg-slate-900 text-white shadow-xs"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </ActionLink>
          );
        })}
      </div>

      {activeTab === "plans" && (
        <ClientPlansEntitlementsTab
          workspaceId={workspace.id}
          workspaceName={workspace.name}
          ownerEmail={ownerEmail}
          canManageBilling={canManageBilling}
          staffRoleLabel={staffRoleLabel}
          unlockedCount={unlockedCount}
          plans={plans}
          bundles={bundles}
          freeAccess={freeAccess}
          reminders={reminders}
        />
      )}

      {activeTab === "finance" && (
        <ClientFinanceInvoicesTab
          workspaceId={workspace.id}
          canViewBilling={canViewBilling}
          canManageBilling={canManageBilling}
          staffRoleLabel={staffRoleLabel}
          ledger={ledger}
          invoices={invoices}
        />
      )}

      {activeTab === "connections" && (
        <ClientConnectionsStatusTab
          workspaceId={workspace.id}
          workspaceName={workspace.name}
          canTestIntegrations={canTestIntegrations}
          snapshot={integrationSnapshot}
        />
      )}

      {activeTab === "profile" && (
        <ClientProfileSslTeamTab
          workspace={workspace}
          isPaused={isPaused}
          canManageClients={canManageClients}
          canProvisionSsl={canProvisionSsl}
          clientEndpoints={clientEndpoints}
          sslCerts={sslCerts}
          teamMembers={teamMembers}
        />
      )}

      {activeTab === "support" && (
        <ClientSupportTemplatesTab
          workspaceId={workspace.id}
          workspaceName={workspace.name}
          ownerEmail={ownerEmail}
          canManageTemplates={canManageTemplates}
          canSendEmail={canSendEmail}
        />
      )}
    </div>
  );
}
