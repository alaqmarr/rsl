import { cache } from "react";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { listWorkspaceTeam } from "@rsl/auth";
import {
  getSupplierGstStateCode,
  getWalletAvailableSpendPaise,
  getWalletBalancePaise,
  getWorkspaceFreeAccessStatus,
  listBundlesWithWorkspaceState,
  listLedgerEntries,
  listServicesWithWorkspaceState,
  listWorkspaceBillingReminders,
  SERVICE_CATALOG,
} from "@rsl/billing";
import { resolvePublicEndpoints } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import {
  controlDb,
  getStaffClientIntegrationSnapshot,
  listWorkspaceSslCertificates,
} from "@rsl/tenancy";

export const getClientWorkspaceBase = cache((workspaceId: string) => {
  const db = controlDb();
  const workspace = db
    .select()
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, workspaceId))
    .get();
  if (!workspace) {
    notFound();
  }
  return workspace;
});

export const getClientDetailHeaderData = cache(async (workspaceId: string) => {
  const workspace = getClientWorkspaceBase(workspaceId);
  const db = controlDb();
  const raw = db.$client;
  const now = Date.now();

  const [walletPaise, freeAccess, team] = await Promise.all([
    Promise.resolve(getWalletBalancePaise(workspaceId)),
    Promise.resolve(getWorkspaceFreeAccessStatus(workspaceId)),
    Promise.resolve(listWorkspaceTeam(workspaceId)),
  ]);

  const totalToolsCount = SERVICE_CATALOG.length;
  const activeEntRow = raw
    .prepare(
      `SELECT COUNT(DISTINCT service_key) AS c
       FROM entitlements
       WHERE workspace_id = ? AND status IN ('active','trialing') AND (expires_at IS NULL OR expires_at > ?)`
    )
    .get(workspaceId, now) as { c: number } | undefined;
  const unlockedCount = freeAccess.isActive
    ? totalToolsCount
    : Math.min(totalToolsCount, Number(activeEntRow?.c ?? 0));

  const pendingReqRow = raw
    .prepare(
      `SELECT COUNT(*) AS c FROM service_plan_requests WHERE workspace_id = ? AND status = 'pending_payment'`
    )
    .get(workspaceId) as { c: number } | undefined;

  const invAggRow = raw
    .prepare(
      `SELECT COUNT(*) AS c,
              (SELECT invoice_number FROM invoices WHERE workspace_id = ? ORDER BY issued_at DESC LIMIT 1) AS latestNo
       FROM invoices
       WHERE workspace_id = ?`
    )
    .get(workspaceId, workspaceId) as { c: number; latestNo: string | null } | undefined;

  const ledgerCountRow = raw
    .prepare(`SELECT COUNT(*) AS c FROM ledger_entries WHERE workspace_id = ?`)
    .get(workspaceId) as { c: number } | undefined;

  const connCountRow = raw
    .prepare(`SELECT COUNT(*) AS c FROM connections WHERE workspace_id = ?`)
    .get(workspaceId) as { c: number } | undefined;

  const remCountRow = raw
    .prepare(`SELECT COUNT(*) AS c FROM billing_reminder_logs WHERE workspace_id = ?`)
    .get(workspaceId) as { c: number } | undefined;

  return {
    workspace,
    supplierStateCode: getSupplierGstStateCode(),
    walletPaise,
    overdraftRemainingPaise: getWalletAvailableSpendPaise(walletPaise),
    freeAccess,
    unlockedCount,
    totalToolsCount,
    pendingCount: Number(pendingReqRow?.c ?? 0),
    invoicesCount: Number(invAggRow?.c ?? 0),
    latestInvoiceNumber: invAggRow?.latestNo ?? null,
    ledgerCount: Number(ledgerCountRow?.c ?? 0),
    connectionsCount: Number(connCountRow?.c ?? 0),
    remindersCount: Number(remCountRow?.c ?? 0),
    teamCount: team.members.length,
    ownerEmail: team.members[0]?.email || "",
    team,
  };
});

export async function getClientPlansSectionData(workspaceId: string) {
  const [plans, reminders] = await Promise.all([
    Promise.resolve(listServicesWithWorkspaceState(workspaceId)),
    Promise.resolve(listWorkspaceBillingReminders(workspaceId, 6)),
  ]);
  const bundles = listBundlesWithWorkspaceState(workspaceId, plans);
  return { plans, bundles, reminders };
}

export async function getClientFinanceSectionData(workspaceId: string) {
  const db = controlDb();
  const [ledger, invoices] = await Promise.all([
    Promise.resolve(listLedgerEntries(workspaceId, 30)),
    Promise.resolve(
      db
        .select()
        .from(controlSchema.invoices)
        .where(eq(controlSchema.invoices.workspaceId, workspaceId))
        .orderBy(desc(controlSchema.invoices.issuedAt))
        .limit(25)
        .all()
    ),
  ]);
  return { ledger, invoices };
}

export async function getClientConnectionsSectionData(workspaceId: string) {
  return getStaffClientIntegrationSnapshot(workspaceId);
}

export async function getClientProfileSectionData(workspaceId: string, workspaceSlug: string) {
  const db = controlDb();
  const [sslCerts, team] = await Promise.all([
    Promise.resolve(listWorkspaceSslCertificates(workspaceId)),
    Promise.resolve(listWorkspaceTeam(workspaceId)),
  ]);
  const userIds = Array.from(new Set(team.members.map((m) => m.userId)));
  const usersRows =
    userIds.length > 0
      ? db
          .select({
            id: controlSchema.users.id,
            emailVerified: controlSchema.users.emailVerified,
          })
          .from(controlSchema.users)
          .where(inArray(controlSchema.users.id, userIds))
          .all()
      : [];
  const verifiedById = new Map(usersRows.map((u) => [u.id, Boolean(u.emailVerified)]));
  const teamMembers = team.members.map((m) => ({
    membershipId: m.membershipId,
    userId: m.userId,
    name: m.name,
    email: m.email,
    roleSlug: m.roleSlug,
    emailVerified: verifiedById.get(m.userId) ?? false,
  }));
  const clientEndpoints = resolvePublicEndpoints({
    workspaceSlug,
    preferLocal: false,
  });
  return { sslCerts, teamMembers, clientEndpoints };
}

// Keep unused drizzle helpers imported intentionally if needed by sub-queries
export { and, sql };
