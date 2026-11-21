import { cache } from "react";
import { headers } from "next/headers";
import { getWorkspacePlansByKeys, hasActiveEntitlement } from "@rsl/billing";
import { resolveEndpointsFromHeaders } from "@rsl/core";
import { canRoleAccessWebRoute, canRolePerform } from "@rsl/rbac";
import { getWorkspaceInventorySummary, probeLocalTallyPort9000 } from "@rsl/tally";
import { requireWebSession } from "@/lib/session";

export function formatStockQty(qty: number, uom: string): string {
  const formatted = Number.isInteger(qty)
    ? qty.toLocaleString("en-IN")
    : qty.toLocaleString("en-IN", { maximumFractionDigits: 3 });
  return `${formatted} ${uom}`;
}

export const loadInventoryPageContext = cache(async (companyParam?: string) => {
  const session = await requireWebSession();
  const canAccess = canRoleAccessWebRoute(session.roleSlug, "/inventory", session.workspace.id);
  if (!canAccess) {
    return { status: "restricted" as const, session };
  }

  const hasSync = hasActiveEntitlement(session.workspace.id, "tally.sync");
  if (!hasSync) {
    const plans = getWorkspacePlansByKeys(session.workspace.id, ["tally.sync", "tally.invoicing"]);
    return { status: "locked" as const, session, plans };
  }

  const canManageTally = canRolePerform(
    session.roleSlug,
    "tally:sync.manage",
    session.workspace.id
  );
  const hdrs = await headers();
  const endpoints = resolveEndpointsFromHeaders(hdrs, {
    workspaceSlug: session.workspace.slug,
  });

  const [inv, localPortProbe] = await Promise.all([
    Promise.resolve(
      getWorkspaceInventorySummary(
        session.workspace.id,
        companyParam && companyParam !== "all" ? companyParam : undefined
      )
    ),
    endpoints.isLocalDev ? probeLocalTallyPort9000(9000) : Promise.resolve(null),
  ]);

  const selectedCompanyId =
    companyParam && inv.companies.some((c) => c.id === companyParam) ? companyParam : "all";
  const defaultCompanyName =
    session.workspace.defaultTallyCompany || inv.companies[0]?.name || session.workspace.name;

  return {
    status: "ready" as const,
    session,
    canManageTally,
    inv,
    localPortProbe,
    selectedCompanyId,
    defaultCompanyName,
  };
});
