import { desc, eq } from "drizzle-orm";
import {
  getAdSpendVaultSummary,
  getPlatformBillingSettings,
  getWalletAvailableSpendPaise,
  getWalletBalancePaise,
  getWorkspaceFreeAccessStatus,
  isRazorpayCheckoutConfigured,
  listBundlesWithWorkspaceState,
  listLedgerEntries,
  listServicesWithWorkspaceState,
  listWorkspacePlanRequests,
  listWorkspaceRechargeRequests,
  MIN_WALLET_BALANCE_PAISE,
} from "@rsl/billing";
import { controlSchema } from "@rsl/database";
import { canRolePerform } from "@rsl/rbac";
import { controlDb } from "@rsl/tenancy";

export const FEATURE_PAGE_BY_KEY: Record<string, { href: string; label: string }> = {
  inbox: { href: "/inbox", label: "Open Team Inbox →" },
  "whatsapp.messaging": { href: "/whatsapp", label: "Open Templates →" },
  "whatsapp.broadcast": { href: "/whatsapp/broadcasts", label: "Open Broadcasts →" },
  "tally.sync": { href: "/tally", label: "Open Tally Bills →" },
  "tally.invoicing": { href: "/tally/automation", label: "Open Tally Automation →" },
  "meta.pages": { href: "/meta/facebook/posts", label: "Open Facebook Posts →" },
  "meta.instagram": { href: "/meta/instagram/posts", label: "Open Instagram Posts →" },
  "meta.pixel": { href: "/meta/facebook/pixel", label: "Open Pixel & CAPI →" },
  "meta.ads": { href: "/meta/facebook/ads", label: "Open Meta Ads →" },
  "google.ads": { href: "/google/ads", label: "Open Google Ads →" },
  "google.reviews": { href: "/reviews", label: "Open Google Reviews →" },
  "google.autoreply": { href: "/reviews/automation", label: "Open Review Auto-Reply →" },
  "backup.export": { href: "/backups", label: "Open Backups →" },
  "storage.managed": { href: "/backups", label: "Open Storage →" },
  "backup.custom": { href: "/backups/exports", label: "Open Exports & Adapters →" },
  "api.access": { href: "/settings/api-keys", label: "Open REST API Keys →" },
};

export function loadBillingWorkspaceContext(workspaceId: string, roleSlug: string) {
  const canManageBilling = canRolePerform(roleSlug, "billing:manage", workspaceId);
  const walletBalancePaise = getWalletBalancePaise(workspaceId);
  const walletAvailableSpendPaise = getWalletAvailableSpendPaise(walletBalancePaise);
  const isOverdraftExhausted = walletBalancePaise <= MIN_WALLET_BALANCE_PAISE;
  const freeAccess = getWorkspaceFreeAccessStatus(workspaceId);
  const services = listServicesWithWorkspaceState(workspaceId);
  const bundles = listBundlesWithWorkspaceState(workspaceId, services);
  const planRequests = listWorkspacePlanRequests(workspaceId, 25);
  const ledger = listLedgerEntries(workspaceId, 40);
  const rechargeRequests = listWorkspaceRechargeRequests(workspaceId, 15);
  const adVault = getAdSpendVaultSummary(workspaceId);
  const razorpayReady = isRazorpayCheckoutConfigured();
  const billingSettings = getPlatformBillingSettings();

  const invoices = controlDb()
    .select()
    .from(controlSchema.invoices)
    .where(eq(controlSchema.invoices.workspaceId, workspaceId))
    .orderBy(desc(controlSchema.invoices.issuedAt))
    .limit(40)
    .all();

  const activeCount = services.filter((s) => s.isUnlocked).length;
  const pendingPlanCount = services.filter((s) => !s.isUnlocked && Boolean(s.pendingRequest)).length;
  const availablePlanCount = services.filter((s) => !s.isUnlocked && !s.pendingRequest).length;
  const allToolsUnlocked = services.length > 0 && activeCount === services.length;

  return {
    canManageBilling,
    walletBalancePaise,
    walletAvailableSpendPaise,
    isOverdraftExhausted,
    freeAccess,
    services,
    bundles,
    planRequests,
    ledger,
    rechargeRequests,
    adVault,
    razorpayReady,
    billingSettings,
    invoices,
    activeCount,
    pendingPlanCount,
    availablePlanCount,
    allToolsUnlocked,
    unlockedKeySet: new Set(services.filter((s) => s.isUnlocked).map((s) => s.key)),
    serviceNameByKey: new Map(services.map((s) => [s.key, s.name])),
    availableBundles: bundles.filter((b) => !b.isFullyUnlocked),
    unlockedBundles: bundles.filter((b) => b.isFullyUnlocked),
    pendingRechargeCount: rechargeRequests.filter((r) => r.status === "pending_verification")
      .length,
    showStatementPdfButton:
      ledger.length > 0 || invoices.length > 0 || activeCount > 0 || freeAccess.isActive,
  };
}
