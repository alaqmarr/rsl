import { canStaffPerform, formatStaffRoleLabel } from "@rsl/auth";
import { ClientDetailShell } from "@/components/client-detail/client-detail-shell";
import { ClientPlansEntitlementsTab } from "@/components/client-detail/plans-entitlements-tab";
import {
  getClientDetailHeaderData,
  getClientPlansSectionData,
} from "@/lib/client-detail-data";
import { requireStaffSession } from "@/lib/session";

export default async function AdminClientPlansPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ id }, sp, { staff }] = await Promise.all([
    params,
    searchParams,
    requireStaffSession(),
  ]);
  const [headerData, sectionData] = await Promise.all([
    getClientDetailHeaderData(id),
    getClientPlansSectionData(id),
  ]);

  const canManageBilling = canStaffPerform(staff.staffRole, "staff:billing.manage");
  const staffRoleLabel = formatStaffRoleLabel(staff.staffRole);

  return (
    <ClientDetailShell
      activeSection="plans"
      staffRole={staff.staffRole}
      headerData={headerData}
      notice={sp.notice}
      error={sp.error}
    >
      <ClientPlansEntitlementsTab
        workspaceId={headerData.workspace.id}
        workspaceName={headerData.workspace.name}
        ownerEmail={headerData.ownerEmail}
        canManageBilling={canManageBilling}
        staffRoleLabel={staffRoleLabel}
        unlockedCount={headerData.unlockedCount}
        plans={sectionData.plans}
        bundles={sectionData.bundles}
        freeAccess={headerData.freeAccess}
        reminders={sectionData.reminders}
      />
    </ClientDetailShell>
  );
}
