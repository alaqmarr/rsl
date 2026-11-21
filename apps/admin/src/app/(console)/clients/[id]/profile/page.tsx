import { canStaffPerform } from "@rsl/auth";
import { ClientDetailShell } from "@/components/client-detail/client-detail-shell";
import { ClientProfileSslTeamTab } from "@/components/client-detail/profile-ssl-team-tab";
import {
  getClientDetailHeaderData,
  getClientProfileSectionData,
} from "@/lib/client-detail-data";
import { requireStaffSession } from "@/lib/session";

export default async function AdminClientProfilePage({
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
  const profileData = await getClientProfileSectionData(id, headerData.workspace.slug);

  const canManageClients = canStaffPerform(staff.staffRole, "staff:clients.manage");
  const canManageOps = canStaffPerform(staff.staffRole, "staff:ops.manage");
  const canProvisionSsl = canManageClients || canManageOps;
  const isPaused = headerData.workspace.billingStatus === "suspended";

  return (
    <ClientDetailShell
      activeSection="profile"
      staffRole={staff.staffRole}
      headerData={headerData}
      notice={sp.notice}
      error={sp.error}
    >
      <ClientProfileSslTeamTab
        workspace={headerData.workspace}
        isPaused={isPaused}
        canManageClients={canManageClients}
        canProvisionSsl={canProvisionSsl}
        clientEndpoints={profileData.clientEndpoints}
        sslCerts={profileData.sslCerts}
        teamMembers={profileData.teamMembers}
      />
    </ClientDetailShell>
  );
}
