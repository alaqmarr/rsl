import { cache } from "react";
import { notFound } from "next/navigation";
import { getWorkspacePlansByKeys, hasActiveEntitlement } from "@rsl/billing";
import { canRoleAccessWebRoute, canRolePerform } from "@rsl/rbac";
import { getTallyWorkspaceSummary, getWorkspacePartyLedgerDetail } from "@rsl/tally";
import { requireWebSession } from "@/lib/session";

export function formatPartyShortDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export const loadPartyDetailContext = cache(async (partyId: string) => {
  const session = await requireWebSession();
  const canAccess = canRoleAccessWebRoute(
    session.roleSlug,
    `/tally/parties/${partyId}`,
    session.workspace.id
  );
  if (!canAccess) {
    return { status: "restricted" as const, session, partyId };
  }

  const hasSync = hasActiveEntitlement(session.workspace.id, "tally.sync");
  if (!hasSync) {
    const plans = getWorkspacePlansByKeys(session.workspace.id, ["tally.sync", "tally.invoicing"]);
    return { status: "locked" as const, session, partyId, plans };
  }

  let detail;
  try {
    detail = getWorkspacePartyLedgerDetail(session.workspace.id, partyId);
  } catch {
    notFound();
  }

  const [tallyOverview, hasInvoicingEntitlement] = await Promise.all([
    Promise.resolve(getTallyWorkspaceSummary(session.workspace.id)),
    Promise.resolve(hasActiveEntitlement(session.workspace.id, "tally.invoicing")),
  ]);

  const canManageTally = canRolePerform(
    session.roleSlug,
    "tally:sync.manage",
    session.workspace.id
  );
  const canSendTallyWhatsApp = canRolePerform(
    session.roleSlug,
    "tally:invoice.send",
    session.workspace.id
  );

  return {
    status: "ready" as const,
    session,
    detail,
    tallyOverview,
    canManageTally,
    canSendTallyWhatsApp,
    hasInvoicingEntitlement,
  };
});
