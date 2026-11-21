import { canStaffPerform, formatStaffRoleLabel } from "@rsl/auth";
import { ClientDetailShell } from "@/components/client-detail/client-detail-shell";
import { ClientFinanceInvoicesTab } from "@/components/client-detail/finance-invoices-tab";
import {
  getClientDetailHeaderData,
  getClientFinanceSectionData,
} from "@/lib/client-detail-data";
import { requireStaffSession } from "@/lib/session";

export default async function AdminClientFinancePage({
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
    getClientFinanceSectionData(id),
  ]);

  const canViewBilling = canStaffPerform(staff.staffRole, "staff:billing.view");
  const canManageBilling = canStaffPerform(staff.staffRole, "staff:billing.manage");
  const staffRoleLabel = formatStaffRoleLabel(staff.staffRole);

  return (
    <ClientDetailShell
      activeSection="finance"
      staffRole={staff.staffRole}
      headerData={headerData}
      notice={sp.notice}
      error={sp.error}
    >
      <ClientFinanceInvoicesTab
        workspaceId={headerData.workspace.id}
        canViewBilling={canViewBilling}
        canManageBilling={canManageBilling}
        staffRoleLabel={staffRoleLabel}
        ledger={sectionData.ledger}
        invoices={sectionData.invoices}
      />
    </ClientDetailShell>
  );
}
