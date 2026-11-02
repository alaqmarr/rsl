import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { registerUserWithWorkspace } from "@rsl/auth";
import {
  buildUpiPaymentPayload,
  createGstInvoice,
  generateAnalyticsReportPdfBytes,
  generateGstInvoicePdfBytes,
  generateTallyReceivablesPdfBytes,
  generateUpiQrSvg,
  generateWalletStatementPdfBytes,
  getInvoiceDetailById,
  getPdfPageCount,
  getPlatformBillingSettings,
  getWorkspaceFreeAccessStatus,
  hasActiveEntitlement,
  listBundlesWithWorkspaceState,
  listServicesWithWorkspaceState,
  listWorkspaceBillingReminders,
  SERVICE_CATALOG,
  staffBulkUnlockBundle,
  staffCreateClientCustomBundle,
  staffGrantFreeAllToolsAccess,
  staffRecordPlanPaymentAndActivate,
  staffRevokeFreeAllToolsAccess,
  staffSetClientBundleOverride,
  staffSetClientPlanOverride,
  submitBundlePlanRequest,
  submitServicePlanRequest,
  sweepAutomaticBillingReminders,
} from "@rsl/billing";
import { controlSchema } from "@rsl/database";
import { controlDb } from "@rsl/tenancy";

function setupFreshAccount(tag: string) {
  const email = `${tag.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 10000)}@rsltest.in`;
  const reg = registerUserWithWorkspace({
    name: `${tag} Owner`,
    email,
    password: "InitialPassword123!",
    businessName: `${tag} Enterprises`,
    industry: "Wholesale",
    stateCode: "27",
  });
  const ws = controlDb()
    .select()
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, reg.workspaceId))
    .get()!;
  return {
    email,
    userId: reg.userId,
    workspaceId: reg.workspaceId,
    workspaceSlug: ws.slug,
    workspaceName: ws.name,
  };
}

describe("Phase 12 Commercial Suite (UPI QR Modal Payload, Cycles, Custom Pricing, Bundles, Free Access, Auto Reminders & PDFs)", () => {
  it("builds NPCI-compliant Bank-Account-over-UPI (.ifsc.npci) & VPA QR URIs with exact 18% GST amount, sanitized note, and SVG", async () => {
    const bankUpi = buildUpiPaymentPayload({
      routingMode: "bank_account",
      accountNumber: "50200091827364",
      ifscCode: "hdfc0001234",
      bankName: "HDFC Bank",
      payeeName: "RSL Marketing Pvt Ltd",
      subtotalPaise: 129900, // Rs. 1,299.00
      workspaceSlug: "sharma-traders",
      itemLabel: "Tally Prime Live Sync",
      billingCycle: "quarterly",
    });

    // 1299.00 + 18% GST (233.82) = 1532.82
    expect(bankUpi.routingMode).toBe("bank_account");
    expect(bankUpi.payeeAddress).toBe("50200091827364@HDFC0001234.ifsc.npci");
    expect(bankUpi.gstPaise).toBe(23382);
    expect(bankUpi.totalPayablePaise).toBe(153282);
    expect(bankUpi.amountRupeesFormatted).toBe("1532.82");
    expect(bankUpi.transactionNote).toContain("RSL sharma-traders Tally Prime Live Sync Quarterly");
    expect(bankUpi.upiUri).toContain("upi://pay?");
    expect(bankUpi.upiUri).toContain("pa=50200091827364@HDFC0001234.ifsc.npci");
    expect(bankUpi.upiUri).toContain("am=1532.82");
    expect(bankUpi.upiUri).toContain("cu=INR");
    expect(bankUpi.upiUri).toContain("tn=");

    const vpaUpi = buildUpiPaymentPayload({
      routingMode: "upi_id",
      upiId: "rslmarketing@icici",
      payeeName: "RSL Marketing Pvt Ltd",
      subtotalPaise: 129900,
      workspaceSlug: "sharma-traders",
      itemLabel: "Tally Prime Live Sync",
      billingCycle: "monthly",
    });
    expect(vpaUpi.routingMode).toBe("upi_id");
    expect(vpaUpi.upiUri).toContain("pa=rslmarketing@icici");

    const svg = await generateUpiQrSvg(bankUpi.upiUri);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("supports custom per-client Monthly/Quarterly/Yearly pricing and tracks pending_payment state to disable repeat requests", () => {
    const acct = setupFreshAccount("CustomPricing");

    staffSetClientPlanOverride({
      workspaceId: acct.workspaceId,
      serviceKey: "tally.sync",
      customMonthlyPaise: 89900,
      customQuarterlyPaise: 239900,
      customYearlyPaise: 849900,
    });

    const afterOverride = listServicesWithWorkspaceState(acct.workspaceId).find(
      (s) => s.key === "tally.sync"
    )!;
    expect(afterOverride.hasCustomPriceOverride).toBe(true);
    expect(afterOverride.monthlyAmountPaise).toBe(89900);
    expect(afterOverride.quarterlyAmountPaise).toBe(239900);
    expect(afterOverride.yearlyAmountPaise).toBe(849900);
    expect(afterOverride.pendingRequest).toBeNull();

    const submitted = submitServicePlanRequest({
      workspaceId: acct.workspaceId,
      serviceKey: "tally.sync",
      billingCycle: "quarterly",
      requestedByUserId: acct.userId,
      customerPaymentRef: "UTR9988776655",
      customerNote: "Paid via GPay QR",
    });
    expect(submitted.alreadyPending).toBe(false);
    expect(submitted.billingCycle).toBe("quarterly");
    expect(submitted.quotedCyclePaise).toBe(239900);

    const withPending = listServicesWithWorkspaceState(acct.workspaceId).find(
      (s) => s.key === "tally.sync"
    )!;
    expect(withPending.pendingRequest).not.toBeNull();
    expect(withPending.pendingRequest?.billingCycle).toBe("quarterly");
    expect(withPending.isUnlocked).toBe(false);

    // Reset back to catalog default
    staffSetClientPlanOverride({
      workspaceId: acct.workspaceId,
      serviceKey: "tally.sync",
      customMonthlyPaise: null,
      customQuarterlyPaise: null,
      customYearlyPaise: null,
    });
    const afterReset = listServicesWithWorkspaceState(acct.workspaceId).find(
      (s) => s.key === "tally.sync"
    )!;
    expect(afterReset.hasCustomPriceOverride).toBe(false);
    expect(afterReset.monthlyAmountPaise).toBe(afterReset.standardMonthlyAmountPaise);
  });

  it("supports dependency bundles, Complete 15-Tool Software Package, per-client bundle overrides, and bespoke client bundles", () => {
    const clientA = setupFreshAccount("BundleClientA");
    const clientB = setupFreshAccount("BundleClientB");

    const initialBundles = listBundlesWithWorkspaceState(clientA.workspaceId);
    expect(initialBundles.length).toBeGreaterThanOrEqual(6);

    const allFeatures = initialBundles.find((b) => b.key === "all_features")!;
    expect(allFeatures).toBeDefined();
    expect(allFeatures.totalServicesCount).toBe(SERVICE_CATALOG.length);

    // Customize tally_whatsapp_pack specifically for Client A
    staffSetClientBundleOverride({
      workspaceId: clientA.workspaceId,
      bundleKey: "tally_whatsapp_pack",
      customName: "Client A Negotiated Tally + WhatsApp Suite",
      includedKeys: ["tally.sync", "whatsapp.messaging", "tally.invoicing"],
      monthlyOverridePaise: 249900,
      quarterlyOverridePaise: 679900,
      yearlyOverridePaise: 2399900,
    });

    // Create a bespoke bundle exclusively for Client A
    const bespoke = staffCreateClientCustomBundle({
      workspaceId: clientA.workspaceId,
      name: "Client A Showroom Reputation + Inbox Pack",
      includedKeys: ["inbox", "google.reviews", "google.autoreply"],
      monthlyAmountPaise: 159900,
      quarterlyAmountPaise: 429900,
      yearlyAmountPaise: 1499900,
    });

    const bundlesA = listBundlesWithWorkspaceState(clientA.workspaceId);
    const bundlesB = listBundlesWithWorkspaceState(clientB.workspaceId);

    const tallyPackA = bundlesA.find((b) => b.key === "tally_whatsapp_pack")!;
    expect(tallyPackA.name).toBe("Client A Negotiated Tally + WhatsApp Suite");
    expect(tallyPackA.monthlyAmountPaise).toBe(249900);
    expect(tallyPackA.totalServicesCount).toBe(3);

    // Client B sees untouched global bundle and does NOT see Client A's bespoke bundle
    const tallyPackB = bundlesB.find((b) => b.key === "tally_whatsapp_pack")!;
    expect(tallyPackB.monthlyAmountPaise).not.toBe(249900);
    expect(bundlesB.some((b) => b.key === bespoke.bundleKey)).toBe(false);

    // Client A requests bespoke bundle on Yearly cycle
    const reqOut = submitBundlePlanRequest({
      workspaceId: clientA.workspaceId,
      bundleKey: bespoke.bundleKey,
      billingCycle: "yearly",
      requestedByUserId: clientA.userId,
      customerPaymentRef: "UTR1122334455",
    });
    expect(reqOut.billingCycle).toBe("yearly");
    expect(reqOut.quotedCyclePaise).toBe(1499900);

    // Pending bundle marks its included services as pending
    const servicesPending = listServicesWithWorkspaceState(clientA.workspaceId);
    expect(servicesPending.find((s) => s.key === "google.reviews")?.pendingRequest).not.toBeNull();

    // Staff records yearly bundle payment and unlocks all 3 tools
    const unlocked = staffBulkUnlockBundle({
      workspaceId: clientA.workspaceId,
      bundleKey: bespoke.bundleKey,
      billingCycle: "yearly",
      amountPaidPaise: 1499900,
      paymentMethod: "upi",
      paymentReference: "UTR1122334455",
      staffId: "stf_test",
    });
    expect(unlocked.unlockedCount).toBe(3);
    expect(unlocked.invoiceNumber).toContain("RSL/");
    expect(hasActiveEntitlement(clientA.workspaceId, "inbox")).toBe(true);
    expect(hasActiveEntitlement(clientA.workspaceId, "google.reviews")).toBe(true);
    expect(hasActiveEntitlement(clientA.workspaceId, "google.autoreply")).toBe(true);
  });

  it("grants time-bounded Complimentary Free Access to all 15 tools and cleanly revokes or expires it", () => {
    const acct = setupFreshAccount("FreeAccess");

    expect(hasActiveEntitlement(acct.workspaceId, "meta.ads")).toBe(false);

    const granted = staffGrantFreeAllToolsAccess({
      workspaceId: acct.workspaceId,
      durationDays: 14,
      note: "14-day VIP pilot access",
      staffId: "stf_admin",
    });
    expect(granted.remainingDays).toBe(14);

    const status = getWorkspaceFreeAccessStatus(acct.workspaceId);
    expect(status.isActive).toBe(true);

    const allServices = listServicesWithWorkspaceState(acct.workspaceId);
    expect(allServices.length).toBe(SERVICE_CATALOG.length);
    expect(allServices.every((s) => s.isUnlocked)).toBe(true);
    expect(hasActiveEntitlement(acct.workspaceId, "meta.ads")).toBe(true);
    expect(hasActiveEntitlement(acct.workspaceId, "api.access")).toBe(true);

    // Revoking free access immediately re-locks unpaid services
    staffRevokeFreeAllToolsAccess({
      workspaceId: acct.workspaceId,
      staffId: "stf_admin",
    });
    expect(getWorkspaceFreeAccessStatus(acct.workspaceId).isActive).toBe(false);
    expect(hasActiveEntitlement(acct.workspaceId, "meta.ads")).toBe(false);
  });

  it("dispatches deduplicated automatic renewal reminders across Monthly/Quarterly/Yearly cycles", async () => {
    const acct = setupFreshAccount("AutoReminder");

    // Unlock a plan on Quarterly cycle
    staffRecordPlanPaymentAndActivate({
      workspaceId: acct.workspaceId,
      serviceKey: "inbox",
      billingCycle: "quarterly",
      amountPaidPaise: 269700,
      paymentMethod: "upi",
      paymentReference: "UTR777888999",
      staffId: "stf_admin",
    });

    const nowMs = Date.now();
    // Move expiresAt to 5 days from now so it enters the 7-day upcoming renewal window
    controlDb()
      .update(controlSchema.entitlements)
      .set({ expiresAt: nowMs + 5 * 86_400_000 })
      .where(eq(controlSchema.entitlements.workspaceId, acct.workspaceId))
      .run();

    const firstSweep = await sweepAutomaticBillingReminders(nowMs);
    expect(firstSweep.checkedWorkspaces).toBeGreaterThanOrEqual(1);

    const logsAfterFirst = listWorkspaceBillingReminders(acct.workspaceId);
    expect(logsAfterFirst.length).toBe(1);
    expect(logsAfterFirst[0]?.billingCycle).toBe("quarterly");
    expect(logsAfterFirst[0]?.reminderStage).toBe("upcoming_7d");

    // Second sweep at same timestamp must deduplicate and not send duplicate reminder
    await sweepAutomaticBillingReminders(nowMs + 1000);
    const logsAfterSecond = listWorkspaceBillingReminders(acct.workspaceId);
    expect(logsAfterSecond.length).toBe(1);
  });

  it("generates valid %PDF-1.7 documents for GST Tax Invoices, Wallet Statements, Tally Receivables, and Analytics Reports", async () => {
    const acct = setupFreshAccount("PdfGen");
    const invRow = createGstInvoice({
      workspaceId: acct.workspaceId,
      description: "Tally Prime + WhatsApp Billing Pack — Quarterly Plan",
      subtotalPaise: 949900,
      status: "paid",
    });
    const detail = getInvoiceDetailById(invRow.id)!;
    const settings = getPlatformBillingSettings();

    const invoicePdf = await generateGstInvoicePdfBytes({
      invoiceNumber: detail.invoiceNumber,
      financialYear: invRow.financialYear,
      description: detail.description,
      subtotalPaise: detail.subtotalPaise,
      cgstPaise: detail.cgstPaise,
      sgstPaise: detail.sgstPaise,
      igstPaise: detail.igstPaise,
      totalPaise: detail.totalPaise,
      hsnSac: detail.sacCode,
      status: detail.status,
      issuedAt: detail.issuedAt,
      paidAt: detail.paidAt,
      buyerName: detail.buyerName,
      buyerGstin: detail.buyerGstin,
      buyerStateCode: detail.buyerStateCode,
      buyerStateName: detail.buyerStateName,
      paymentMethod: "upi",
      paymentReference: "UTR5544332211",
      seller: {
        payeeName: settings.payeeName,
        gstin: settings.gstin,
        stateCode: detail.supplierStateCode,
        stateName: detail.supplierStateName,
        billingEmail: settings.billingEmail,
        supportPhone: settings.supportPhone,
        bankName: settings.bankName,
        accountNumber: settings.accountNumber,
        ifscCode: settings.ifscCode,
        upiId: settings.upiId,
      },
    });

    const statementPdf = await generateWalletStatementPdfBytes({
      workspaceName: acct.workspaceName,
      workspaceGstin: "27AABCU9603R1ZM",
      balancePaise: 250000,
      entries: [
        {
          createdAt: Date.now(),
          entryType: "credit",
          description: "Verified UPI Wallet Recharge ₹2,500",
          amountPaise: 250000,
        },
      ],
      invoices: [
        {
          invoiceNumber: invRow.invoiceNumber,
          issuedAt: invRow.issuedAt,
          status: "paid",
          totalPaise: invRow.totalPaise,
          description: invRow.description,
        },
      ],
    });

    const tallyPdf = await generateTallyReceivablesPdfBytes({
      workspaceName: acct.workspaceName,
      companyName: "RSL Demo Distributors",
      totalBilledPaise: 1850000,
      totalCollectedPaise: 1200000,
      totalPendingPaise: 650000,
      vouchers: [
        {
          voucherNumber: "GST/26-27/0104",
          voucherType: "Sales",
          partyName: "Mahavir Hardware Stores",
          voucherDate: Date.now() - 20 * 86_400_000,
          dueDate: Date.now() - 5 * 86_400_000,
          amountPaise: 650000,
          paidAmountPaise: 0,
          paymentStatus: "unpaid",
        },
      ],
    });

    const analyticsPdf = await generateAnalyticsReportPdfBytes({
      workspaceName: acct.workspaceName,
      rangeLabel: "Last 30 Days",
      moneyCollectedPaise: 1200000,
      overdueReceivablesPaise: 650000,
      marketingSpendPaise: 45000,
      salesLinkedPaise: 380000,
      returnPerRupeeSpent: 8.44,
      replyRatePct: 96,
      avgReplyMinutes: 4,
      walletBalancePaise: 250000,
      contactsTotalCount: 420,
      optedInCount: 398,
      campaigns: [
        {
          name: "Diwali Wholesale Price List",
          channel: "whatsapp",
          status: "completed",
          spendPaise: 45000,
          revenuePaise: 380000,
          conversions: 19,
        },
      ],
    });

    for (const bytes of [invoicePdf, statementPdf, tallyPdf, analyticsPdf]) {
      expect(bytes.byteLength).toBeGreaterThan(25_000);
      const rawLatin1 = Buffer.from(bytes).toString("latin1");
      expect(rawLatin1.slice(0, 8)).toContain("%PDF-1.7");
      // Confirms embedded RapidShift Labs PNG brand logos (header lockup + footer monogram)
      expect(rawLatin1).toContain("/Subtype /Image");
    }

    // Verify multi-page continuation letterhead & Page X of Y footer stamping
    const multiPageTallyPdf = await generateTallyReceivablesPdfBytes({
      workspaceName: acct.workspaceName,
      companyName: "RSL Multi-Page Wholesale",
      totalBilledPaise: 9500000,
      totalCollectedPaise: 5000000,
      totalPendingPaise: 4500000,
      vouchers: Array.from({ length: 42 }, (_, idx) => ({
        voucherNumber: `GST/26-27/${String(idx + 1).padStart(4, "0")}`,
        voucherType: "Sales",
        partyName: `Wholesale Party ${idx + 1}`,
        voucherDate: Date.now() - 15 * 86_400_000,
        dueDate: Date.now() - 2 * 86_400_000,
        amountPaise: 125000,
        paidAmountPaise: 25000,
        paymentStatus: "partial",
      })),
    });
    expect(await getPdfPageCount(multiPageTallyPdf)).toBeGreaterThanOrEqual(2);
    expect(Buffer.from(multiPageTallyPdf).toString("latin1")).toContain("/Subtype /Image");
  });
});
