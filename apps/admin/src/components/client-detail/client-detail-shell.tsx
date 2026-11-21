import { Layers, Wallet } from "lucide-react";
import { canStaffPerform } from "@rsl/auth";
import { formatInr } from "@rsl/core";
import { FlashBanner, MetricCard, PageHeader, StatusPill } from "@rsl/ui";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import {
  staffStartImpersonationAction,
  staffUpdateClientProfileAction,
} from "@/lib/actions";

export type ClientSectionKey = "plans" | "finance" | "connections" | "profile" | "support";

export function ClientDetailShell({
  activeSection,
  staffRole,
  headerData,
  notice,
  error,
  children,
}: {
  activeSection: ClientSectionKey;
  staffRole: string;
  headerData: {
    workspace: {
      id: string;
      name: string;
      slug: string;
      industry: string | null;
      gstin: string | null;
      stateCode: string;
      billingStatus: string;
      allowManualCredentials?: boolean | null;
      createdAt: number;
    };
    supplierStateCode: string;
    walletPaise: number;
    overdraftRemainingPaise: number;
    freeAccess: { isActive: boolean; remainingDays: number; autoBillingReminders: boolean };
    unlockedCount: number;
    totalToolsCount: number;
    pendingCount: number;
    invoicesCount: number;
    latestInvoiceNumber: string | null;
    ledgerCount: number;
    connectionsCount: number;
    remindersCount: number;
    teamCount: number;
  };
  notice?: string;
  error?: string;
  children: React.ReactNode;
}) {
  const { workspace, supplierStateCode, walletPaise, overdraftRemainingPaise, freeAccess } =
    headerData;
  const canViewBilling = canStaffPerform(staffRole, "staff:billing.view");
  const canManageClients = canStaffPerform(staffRole, "staff:clients.manage");
  const canImpersonate = canStaffPerform(staffRole, "staff:impersonate");
  const isPaused = workspace.billingStatus === "suspended";
  const returnHere = `/clients/${workspace.id}/${activeSection}`;

  const sections: Array<{ key: ClientSectionKey; href: string; label: string }> = [
    {
      key: "plans",
      href: `/clients/${workspace.id}`,
      label: `Plans, Bundles & Rates (${headerData.unlockedCount}/${headerData.totalToolsCount})`,
    },
    ...(canViewBilling
      ? [
          {
            key: "finance" as const,
            href: `/clients/${workspace.id}/finance`,
            label: `Wallet & GST Invoices (${headerData.invoicesCount})`,
          },
        ]
      : []),
    {
      key: "connections",
      href: `/clients/${workspace.id}/connections`,
      label: `Connected Channels (${headerData.connectionsCount})`,
    },
    {
      key: "profile",
      href: `/clients/${workspace.id}/profile`,
      label: `Profile, SSL & Team (${headerData.teamCount})`,
    },
    {
      key: "support",
      href: `/clients/${workspace.id}/support`,
      label: "Templates & Email Tools",
    },
  ];

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
        }) • Created ${new Date(workspace.createdAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}`}
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

      <FlashBanner notice={notice} error={error} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Unlocked Tools"
          value={`${headerData.unlockedCount} / ${headerData.totalToolsCount}`}
          sublabel={
            freeAccess.isActive
              ? `Complimentary all-tools access (${freeAccess.remainingDays}d left)`
              : headerData.pendingCount > 0
                ? `${headerData.pendingCount} request(s) waiting for payment`
                : "All active plans verified"
          }
          accent={headerData.unlockedCount > 0 ? "emerald" : "default"}
          icon={<Layers className="h-4 w-4" />}
        />
        <MetricCard
          label="Wallet Balance"
          value={formatInr(walletPaise, { showDecimals: true })}
          sublabel={
            walletPaise < 0
              ? `Overdraft active • ${formatInr(overdraftRemainingPaise, { showDecimals: true })} left of ₹200.00 limit`
              : `${headerData.ledgerCount} passbook entries`
          }
          accent={walletPaise < 0 ? "ruby" : "emerald"}
          icon={<Wallet className="h-3.5 w-3.5" />}
        />
        <MetricCard
          label="GST Tax Invoices"
          value={String(headerData.invoicesCount)}
          sublabel={
            headerData.latestInvoiceNumber
              ? `Latest: ${headerData.latestInvoiceNumber}`
              : "No GST invoices issued yet"
          }
        />
        <MetricCard
          label="Auto Renewal Reminders"
          value={freeAccess.autoBillingReminders ? "Enabled" : "Paused"}
          sublabel={`${headerData.remindersCount} reminder(s) logged • ${headerData.teamCount} user(s)`}
          accent={freeAccess.autoBillingReminders ? "emerald" : "default"}
        />
      </div>

      <nav
        aria-label="Client Workspace Pages"
        className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-zinc-200/90 bg-white p-1.5 shadow-2xs"
      >
        {sections.map((section) => {
          const isCurrent = activeSection === section.key;
          return (
            <ActionLink
              key={section.key}
              href={section.href}
              className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
                isCurrent
                  ? "bg-slate-900 text-white shadow-xs"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-slate-900"
              }`}
            >
              {section.label}
            </ActionLink>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
