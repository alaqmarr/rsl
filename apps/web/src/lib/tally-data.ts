import { headers } from "next/headers";
import {
  getWalletAvailableSpendPaise,
  getWalletBalancePaise,
  getWorkspacePlansByKeys,
  MIN_WALLET_BALANCE_PAISE,
} from "@rsl/billing";
import { resolveEndpointsFromHeaders } from "@rsl/core";
import { canRolePerform } from "@rsl/rbac";
import {
  buildTallyDisplayBrandTitle,
  buildWorkspaceTdlFilename,
  detectOutdatedTdlVersion,
  getTallyWorkspaceSummary,
  probeLocalTallyPort9000,
} from "@rsl/tally";

export async function loadTallyPageContext(args: {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  userId: string;
  roleSlug: string;
  defaultTallyCompany?: string | null;
  companyParam?: string;
}) {
  const canManageTally = canRolePerform(
    args.roleSlug,
    "tally:sync.manage",
    args.workspaceId
  );
  const canSendTallyWhatsApp = canRolePerform(
    args.roleSlug,
    "tally:invoice.send",
    args.workspaceId
  );

  const hdrs = await headers();
  const endpoints = resolveEndpointsFromHeaders(hdrs, {
    workspaceSlug: args.workspaceSlug,
  });

  const [invoicingPlans, tally, walletBalancePaise, localPortProbe] = await Promise.all([
    Promise.resolve(getWorkspacePlansByKeys(args.workspaceId, ["tally.invoicing"])),
    Promise.resolve(
      getTallyWorkspaceSummary(args.workspaceId, {
        userId: args.userId,
      })
    ),
    Promise.resolve(getWalletBalancePaise(args.workspaceId)),
    endpoints.isLocalDev ? probeLocalTallyPort9000(9000) : Promise.resolve(null),
  ]);
  const invoicingPlan = invoicingPlans[0];
  const hasInvoicingEntitlement = Boolean(invoicingPlan?.isUnlocked);
  const outdatedTdl = detectOutdatedTdlVersion(tally.webhookEndpoint.lastUserAgent);
  const walletAvailableSpendPaise = getWalletAvailableSpendPaise(walletBalancePaise);
  const isWalletOverdraftExhausted = walletBalancePaise <= MIN_WALLET_BALANCE_PAISE;

  const selectedCompanyId =
    args.companyParam && tally.companies.some((c) => c.id === args.companyParam)
      ? args.companyParam
      : "all";

  const companyScopedVouchers =
    selectedCompanyId === "all"
      ? tally.vouchers
      : tally.vouchers.filter((v) => v.companyId === selectedCompanyId);

  const approvedTemplates = tally.templates.filter((t) => t.approvalStatus === "APPROVED");
  const hasNativePdfTemplate = approvedTemplates.some((t) => t.name === "tally_tax_invoice_pdf");
  const activeRulesCount = tally.automationRules.filter((r) => r.active).length;

  const overviewTone: "emerald" | "sky" | "ruby" | "amber" =
    tally.connectionOverview.overallTone === "success"
      ? "emerald"
      : tally.connectionOverview.overallTone === "info"
        ? "sky"
        : tally.connectionOverview.overallTone === "danger"
          ? "ruby"
          : "amber";

  return {
    tally,
    endpoints,
    localPortProbe,
    outdatedTdl,
    walletBalancePaise,
    walletAvailableSpendPaise,
    isWalletOverdraftExhausted,
    selectedCompanyId,
    companyScopedVouchers,
    approvedTemplates,
    hasNativePdfTemplate,
    activeRulesCount,
    overviewTone,
    canManageTally,
    canSendTallyWhatsApp,
    hasInvoicingEntitlement,
    invoicingPlan,
    todayIso: new Date().toISOString().slice(0, 10),
    tdlFilename: buildWorkspaceTdlFilename(args.workspaceName),
    tallyBrandTitle: buildTallyDisplayBrandTitle(args.workspaceName),
    topTdlDownloadHref: endpoints.isLocalDev
      ? "/api/export/tally-tdl?target=local"
      : "/api/export/tally-tdl",
    topConnectorDownloadHref: endpoints.isLocalDev
      ? "/api/export/tally-connector?target=local"
      : "/api/export/tally-connector",
    knownCompanyNames: Array.from(
      new Set(
        [
          ...tally.companies.map((c) => c.name),
          ...(localPortProbe?.openCompanies ?? []),
          ...(args.defaultTallyCompany ? [args.defaultTallyCompany] : []),
        ].filter(Boolean)
      )
    ),
  };
}
