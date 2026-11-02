import { describe, expect, it } from "vitest";
import { getPlatformAdminAnalytics, getWorkspaceAnalytics } from "@rsl/analytics";
import {
  registerUserWithWorkspace,
  resolveUserSessionFromToken,
} from "@rsl/auth";
import {
  getMatchingBundlesForKeys,
  listBundlesWithWorkspaceState,
  listServicesWithWorkspaceState,
  staffGrantFreeAllToolsAccess,
  staffRecordPlanPaymentAndActivate,
  staffRevokeFreeAllToolsAccess,
  submitBundlePlanRequest,
  submitServicePlanRequest,
} from "@rsl/billing";

function createTestWorkspace(tag: string) {
  const email = `${tag.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 10000)}@rslphase15.in`;
  const reg = registerUserWithWorkspace({
    name: `${tag} Owner`,
    email,
    password: "StrongPassword123!",
    businessName: `${tag} Enterprises`,
    industry: "Wholesale",
    stateCode: "27",
  });
  const session = resolveUserSessionFromToken(reg.rawSessionToken)!;
  return { email, reg, session };
}

describe("Phase 15 Suite (Active Tools State Consistency, Zero Redundant Upsells & Admin Free-Access Sync)", () => {
  it("marks all services & bundles unlocked under complimentary free access, hides matching upsell bundles, and blocks duplicate requests", () => {
    const { session } = createTestWorkspace("FreeSuite");
    const wsId = session.workspace.id;

    // Initially 0 unlocked, matching bundles exist for Tally
    const initialBundles = getMatchingBundlesForKeys(wsId, ["tally.sync", "tally.invoicing"]);
    expect(initialBundles.length).toBeGreaterThan(0);

    // Grant 365 days complimentary all-tools access
    staffGrantFreeAllToolsAccess({
      workspaceId: wsId,
      durationDays: 365,
      note: "Annual VIP onboarding",
      staffId: "stf_phase15_test",
    });

    const services = listServicesWithWorkspaceState(wsId);
    expect(services.length).toBe(15);
    expect(services.every((s) => s.isUnlocked)).toBe(true);
    expect(services.every((s) => s.isComplimentaryFreeAccess)).toBe(true);

    const bundles = listBundlesWithWorkspaceState(wsId);
    expect(bundles.length).toBeGreaterThan(0);
    expect(bundles.every((b) => b.isFullyUnlocked)).toBe(true);
    expect(bundles.every((b) => b.isAllFreeAccess)).toBe(true);
    expect(bundles.every((b) => b.remainingLockedCount === 0)).toBe(true);

    // Matching upsell bundles must be empty once all tools in those bundles are active
    expect(getMatchingBundlesForKeys(wsId, ["tally.sync", "tally.invoicing"])).toHaveLength(0);

    // Duplicate activation requests on already-unlocked tools or bundles must be rejected
    expect(() =>
      submitServicePlanRequest({
        workspaceId: wsId,
        serviceKey: "tally.sync",
        billingCycle: "monthly",
        requestedByUserId: session.user.id,
      })
    ).toThrow(/already active/i);

    expect(() =>
      submitBundlePlanRequest({
        workspaceId: wsId,
        bundleKey: bundles[0]!.key,
        billingCycle: "monthly",
        requestedByUserId: session.user.id,
      })
    ).toThrow(/already active/i);

    // Revoking free access restores available bundles cleanly
    staffRevokeFreeAllToolsAccess({
      workspaceId: wsId,
      staffId: "stf_phase15_test",
    });
    expect(getMatchingBundlesForKeys(wsId, ["tally.sync", "tally.invoicing"]).length).toBeGreaterThan(0);
  });

  it("tracks remainingLockedCount accurately on partially unlocked bundles and syncs free-access counts in platform admin analytics", () => {
    const { session } = createTestWorkspace("PartialSuite");
    const wsId = session.workspace.id;

    // Activate 'inbox' (paid) -> bundles containing 'inbox' + other tools should be partially unlocked
    staffRecordPlanPaymentAndActivate({
      workspaceId: wsId,
      serviceKey: "inbox",
      billingCycle: "monthly",
      amountPaidPaise: 99900,
      paymentMethod: "upi",
      paymentReference: "UTR9988776655",
      staffId: "stf_phase15_test",
    });

    const bundlesAfterInbox = listBundlesWithWorkspaceState(wsId);
    const tallyPack = bundlesAfterInbox.find((b) => b.includedKeys.includes("tally.invoicing"))!;
    expect(tallyPack).toBeDefined();
    expect(tallyPack.unlockedCount).toBe(1);
    expect(tallyPack.remainingLockedCount).toBe(tallyPack.totalServicesCount - 1);
    expect(tallyPack.isFullyUnlocked).toBe(false);

    // Setup checklist wallet step points directly to /billing?tab=wallet with 'Recharge Wallet'
    const wsAnalytics = getWorkspaceAnalytics(wsId, "30d");
    const walletStep = wsAnalytics.setupChecklist.find((s) => s.key === "wallet")!;
    expect(walletStep.href).toBe("/billing?tab=wallet");
    expect(walletStep.cta).toBe("Recharge Wallet");

    // Grant free all-tools access on another workspace and verify Staff Admin Analytics reflects 15 unlocked tools
    const { session: freeSession } = createTestWorkspace("AdminSyncClient");
    staffGrantFreeAllToolsAccess({
      workspaceId: freeSession.workspace.id,
      durationDays: 180,
      staffId: "stf_phase15_test",
    });

    const adminAnalytics = getPlatformAdminAnalytics();
    const clientRow = adminAnalytics.businesses.find((b) => b.id === freeSession.workspace.id)!;
    expect(clientRow).toBeDefined();
    expect(clientRow.hasFreeAllTools).toBe(true);
    expect(clientRow.freeAccessRemainingDays).toBeGreaterThanOrEqual(179);
    expect(clientRow.effectiveUnlockedCount).toBe(15);
    expect(adminAnalytics.totals.freeAccessClientsCount).toBeGreaterThanOrEqual(1);
    expect(adminAnalytics.totals.effectiveUnlockedToolsCount).toBeGreaterThanOrEqual(16);
  });
});
