import { canStaffPerform } from "@rsl/auth";
import { ClientConnectionsStatusTab } from "@/components/client-detail/connections-status-tab";
import { ClientDetailShell } from "@/components/client-detail/client-detail-shell";
import {
  getClientConnectionsSectionData,
  getClientDetailHeaderData,
} from "@/lib/client-detail-data";
import { requireStaffSession } from "@/lib/session";

export default async function AdminClientConnectionsPage({
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
  const [headerData, snapshot] = await Promise.all([
    getClientDetailHeaderData(id),
    getClientConnectionsSectionData(id),
  ]);

  const canManageClients = canStaffPerform(staff.staffRole, "staff:clients.manage");
  const canManageOps = canStaffPerform(staff.staffRole, "staff:ops.manage");
  const canTestIntegrations = canManageClients || canManageOps;

  return (
    <ClientDetailShell
      activeSection="connections"
      staffRole={staff.staffRole}
      headerData={headerData}
      notice={sp.notice}
      error={sp.error}
    >
      <ClientConnectionsStatusTab
        workspaceId={headerData.workspace.id}
        workspaceName={headerData.workspace.name}
        canTestIntegrations={canTestIntegrations}
        snapshot={snapshot}
      />
    </ClientDetailShell>
  );
}
