import { canStaffPerform } from "@rsl/auth";
import { ClientDetailShell } from "@/components/client-detail/client-detail-shell";
import { ClientSupportTemplatesTab } from "@/components/client-detail/support-templates-tab";
import { getClientDetailHeaderData } from "@/lib/client-detail-data";
import { requireStaffSession } from "@/lib/session";

export default async function AdminClientSupportPage({
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
  const headerData = await getClientDetailHeaderData(id);

  const canManageBilling = canStaffPerform(staff.staffRole, "staff:billing.manage");
  const canManageOps = canStaffPerform(staff.staffRole, "staff:ops.manage");
  const canManageTemplates = canStaffPerform(staff.staffRole, "staff:templates.manage");
  const canSendEmail = canManageBilling || canManageOps;

  return (
    <ClientDetailShell
      activeSection="support"
      staffRole={staff.staffRole}
      headerData={headerData}
      notice={sp.notice}
      error={sp.error}
    >
      <ClientSupportTemplatesTab
        workspaceId={headerData.workspace.id}
        workspaceName={headerData.workspace.name}
        ownerEmail={headerData.ownerEmail}
        canManageTemplates={canManageTemplates}
        canSendEmail={canSendEmail}
      />
    </ClientDetailShell>
  );
}
