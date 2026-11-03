import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import {
  getPlatformAdminAnalytics,
  getWorkspaceAnalytics,
  getWorkspaceSetupProgress,
} from "@rsl/analytics";
import { registerUserWithWorkspace, updateWorkspaceBusinessSettings } from "@rsl/auth";
import { exportContactsAsCsv } from "@rsl/backup";
import {
  approveWalletRechargeRequest,
  computeGstTaxSplit,
  createAdvanceReceiptVoucher,
  createGstInvoice,
  creditWallet,
  debitWallet,
  exportWorkspaceGstInvoicesCsv,
  generateGstInvoicePdfBytes,
  getInvoiceDetailById,
  getPlatformBillingSettings,
  getWalletBalancePaise,
  savePlatformBillingSettings,
  staffRecordPlanPaymentAndActivate,
  staffUpdateInvoiceStatus,
  submitWalletRechargeRequest,
} from "@rsl/billing";
import { computeIndianFinancialYearIst, newId } from "@rsl/core";
import { controlSchema, tenantDataSchema } from "@rsl/database";
import { appendActionLog, exportActionLogsAsCsv } from "@rsl/logging";
import {
  controlDb,
  savePlatformRazorpayConfig,
  tenantDataDb,
} from "@rsl/tenancy";
import { POST as razorpayWebhookPost } from "../app/api/webhooks/razorpay/route";

function setupFreshAccount(tag: string, stateCode = "27") {
  const email = `${tag.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 1000)}@rsltest.in`;
  const reg = registerUserWithWorkspace({
    name: `${tag} Owner`,
    email,
    password: "InitialPassword123!",
    businessName: `${tag} Enterprises`,
    industry: "Manufacturing",
    stateCode,
  });
  return { ...reg, email };
}

describe("Phase 20: Statutory GST Accounting, Credit Notes, CSV Security & Analytics Accuracy", () => {
  it("3.1 & 3.3: separates 0% GST Advance Receipt Vouchers (ADV/...) on wallet top-ups from 18% GST Tax Invoices (RSL/...) and populates double-entry contra accounts", async () => {
    const acct = setupFreshAccount("AdvVsTax");

    // 1. Prepaid wallet deposit via manual UTR recharge -> ADV/... at 0% GST
    const req = submitWalletRechargeRequest({
      workspaceId: acct.workspaceId,
      amountPaise: 250000, // ₹2,500.00
      utrOrReference: "UTR_ADV_001",
      paymentMethod: "upi",
    });
    const approved = approveWalletRechargeRequest({
      paymentId: req.paymentId,
      staffId: "stf_fin_01",
    });
    expect(approved.balancePaise).toBe(250000);
    expect(approved.invoiceNumber).toMatch(/^ADV\/\d{2}-\d{2}\/\d{4}$/);

    const advRow = controlDb()
      .select()
      .from(controlSchema.invoices)
      .where(eq(controlSchema.invoices.invoiceNumber, approved.invoiceNumber!))
      .get();
    expect(advRow).toBeDefined();
    expect(advRow?.docType).toBe("advance_receipt");
    expect(advRow?.cgstPaise).toBe(0);
    expect(advRow?.sgstPaise).toBe(0);
    expect(advRow?.igstPaise).toBe(0);
    expect(advRow?.totalPaise).toBe(250000);

    // 2. Taxable service consumption -> RSL/... at 18% GST
    const activated = staffRecordPlanPaymentAndActivate({
      workspaceId: acct.workspaceId,
      serviceKey: "inbox",
      billingCycle: "monthly",
      amountPaidPaise: 99900,
      paymentMethod: "upi",
      paymentReference: "UTR_PLAN_001",
      staffId: "stf_fin_01",
    });
    expect(activated.invoiceNumber).toMatch(/^RSL\/\d{2}-\d{2}\/\d{4}$/);

    const taxInv = controlDb()
      .select()
      .from(controlSchema.invoices)
      .where(eq(controlSchema.invoices.invoiceNumber, activated.invoiceNumber))
      .get();
    expect(taxInv?.docType).toBe("tax_invoice");
    expect(taxInv!.cgstPaise + taxInv!.sgstPaise + taxInv!.igstPaise).toBeGreaterThan(0);

    // 3. Double-entry contra-account columns on ledger_entries
    debitWallet({
      workspaceId: acct.workspaceId,
      amountPaise: 150,
      serviceKey: "whatsapp.messaging",
      description: "Metered WhatsApp utility send",
      idempotencyKey: "msg_debit_001",
      actorId: acct.userId,
    });

    const ledgerRows = controlDb()
      .select()
      .from(controlSchema.ledgerEntries)
      .where(eq(controlSchema.ledgerEntries.workspaceId, acct.workspaceId))
      .all();
    const creditRow = ledgerRows.find((r) => r.amountPaise > 0)!;
    const debitRow = ledgerRows.find((r) => r.amountPaise < 0)!;
    expect(creditRow.debitAccount).toBe("Bank / Clearing Settlement");
    expect(creditRow.creditAccount).toBe("Customer Prepaid Wallet Liability");
    expect(debitRow.debitAccount).toBe("Customer Prepaid Wallet Liability");
    expect(debitRow.creditAccount).toBe("Recognized SaaS & Messaging Revenue");

    // 4. Advance receipt PDF renders statutory Advance Receipt title cleanly
    const detail = getInvoiceDetailById(advRow!.id, { workspaceId: acct.workspaceId })!;
    const pdfBytes = await generateGstInvoicePdfBytes({
      invoiceNumber: detail.invoiceNumber,
      docType: detail.docType,
      financialYear: advRow!.financialYear,
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
      seller: {
        payeeName: detail.supplierName,
        gstin: detail.supplierGstin,
        stateCode: detail.supplierStateCode,
        stateName: detail.supplierStateName,
        billingEmail: detail.supplierEmail,
        supportPhone: detail.supplierPhone,
        bankName: detail.bankName,
        accountNumber: detail.accountNumber,
        ifscCode: detail.ifscCode,
        upiId: detail.upiId,
      },
    });
    expect(pdfBytes.byteLength).toBeGreaterThan(800);
  });

  it("3.2: dynamically derives supplier GST state code from platform GSTIN, aligns tax split math, and validates customer GSTIN-state prefix", () => {
    const originalSettings = getPlatformBillingSettings();
    try {
      // Configure platform supplier in Karnataka (29)
      savePlatformBillingSettings({
        gstin: "29AAACR5055K1Z1",
      });

      const kaClient = setupFreshAccount("KaBuyer", "29");
      const mhClient = setupFreshAccount("MhBuyer", "27");

      // Karnataka buyer + Karnataka supplier -> Intra-state 9% CGST + 9% SGST
      const kaInv = createGstInvoice({
        workspaceId: kaClient.workspaceId,
        description: "Karnataka Intra-State Subscription",
        subtotalPaise: 99999, // odd paise to verify rounding symmetry
      });
      const expectedKa = computeGstTaxSplit({
        subtotalPaise: 99999,
        buyerStateCode: "29",
        supplierStateCode: "29",
      });
      expect(kaInv.cgstPaise).toBe(expectedKa.cgstPaise);
      expect(kaInv.sgstPaise).toBe(expectedKa.sgstPaise);
      expect(kaInv.igstPaise).toBe(0);
      expect(kaInv.totalPaise).toBe(expectedKa.totalPaise);

      // Maharashtra buyer + Karnataka supplier -> Inter-state 18% IGST
      const mhInv = createGstInvoice({
        workspaceId: mhClient.workspaceId,
        description: "Maharashtra Inter-State Subscription",
        subtotalPaise: 99999,
      });
      const expectedMh = computeGstTaxSplit({
        subtotalPaise: 99999,
        buyerStateCode: "27",
        supplierStateCode: "29",
      });
      expect(mhInv.cgstPaise).toBe(0);
      expect(mhInv.sgstPaise).toBe(0);
      expect(mhInv.igstPaise).toBe(expectedMh.igstPaise);
      expect(mhInv.totalPaise).toBe(expectedMh.totalPaise);

      // GSTIN prefix mismatch check (ACT-2.4)
      expect(() =>
        updateWorkspaceBusinessSettings({
          workspaceId: mhClient.workspaceId,
          name: "MhBuyer Enterprises",
          stateCode: "27",
          gstin: "29AAAAA0000A1Z5", // 29 != 27
        })
      ).toThrow(/GSTIN state prefix/i);

      // Matching GSTIN prefix + stateCode succeeds
      const updated = updateWorkspaceBusinessSettings({
        workspaceId: mhClient.workspaceId,
        name: "MhBuyer Enterprises",
        stateCode: "27",
        gstin: "27AAAAA0000A1Z5",
      });
      expect(updated.gstin).toBe("27AAAAA0000A1Z5");
      expect(updated.stateCode).toBe("27");

      // IST Financial Year boundary check: April 1, 2026 01:00 IST (March 31, 2026 19:30 UTC) -> FY 26-27!
      const april1EarlyIst = Date.UTC(2026, 2, 31, 19, 30, 0);
      expect(computeIndianFinancialYearIst(april1EarlyIst)).toBe("26-27");
    } finally {
      savePlatformBillingSettings({ gstin: originalSettings.gstin });
    }
  });

  it("3.3: enforces Razorpay webhook HMAC pre-validation + idempotency, issues Section 34 Credit Notes on void, and neutralizes CSV formula injection", async () => {
    const acct = setupFreshAccount("CnAndCsv");

    const webhookSecret = "rzp_whsec_phase20_test_secret";
    savePlatformRazorpayConfig({
      keyId: "rzp_test_phase20",
      keySecret: "rzp_secret_phase20",
      webhookSecret,
      staffId: "stf_fin_01",
    });

    const payloadObj = {
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_Phase20Dup01",
            order_id: "order_Phase20Dup01",
            amount: 100000,
            notes: {
              workspaceId: acct.workspaceId,
              walletCreditPaise: "100000",
            },
          },
        },
      },
    };
    const rawBody = JSON.stringify(payloadObj);

    // 1. Invalid signature rejected with 401 BEFORE writing to ingress.db
    const badReq = new NextRequest("https://app.rapidshiftlabs.in/api/webhooks/razorpay", {
      method: "POST",
      headers: {
        "x-razorpay-signature": "deadbeef",
        "x-razorpay-event-id": "evt_forged_phase20",
      },
      body: rawBody,
    });
    const badRes = await razorpayWebhookPost(badReq);
    expect(badRes.status).toBe(401);

    // 2. Valid webhook + duplicate replay with different event-id -> wallet credited ONCE & single ADV voucher
    const validSig = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
    const req1 = new NextRequest("https://app.rapidshiftlabs.in/api/webhooks/razorpay", {
      method: "POST",
      headers: {
        "x-razorpay-signature": validSig,
        "x-razorpay-event-id": "evt_valid_phase20_1",
      },
      body: rawBody,
    });
    const req2 = new NextRequest("https://app.rapidshiftlabs.in/api/webhooks/razorpay", {
      method: "POST",
      headers: {
        "x-razorpay-signature": validSig,
        "x-razorpay-event-id": "evt_valid_phase20_2",
      },
      body: rawBody,
    });
    expect((await razorpayWebhookPost(req1)).status).toBe(200);
    expect((await razorpayWebhookPost(req2)).status).toBe(200);
    expect(getWalletBalancePaise(acct.workspaceId)).toBe(100000);

    const directDup = createAdvanceReceiptVoucher({
      workspaceId: acct.workspaceId,
      description: "Duplicate check",
      amountPaise: 100000,
      externalRefKey: "rzp_payment:pay_Phase20Dup01",
    });
    expect(directDup.docType).toBe("advance_receipt");

    // 3. Issue taxable invoice, then reverse via staffUpdateInvoiceStatus({ status: "void" }) -> Section 34 Credit Note
    const taxInv = createGstInvoice({
      workspaceId: acct.workspaceId,
      description: "=CMD|' /C calc'!A0 Malicious Plan Description",
      subtotalPaise: 200000,
      status: "paid",
    });
    const adminBeforeCn = getPlatformAdminAnalytics().totals.totalInvoicedRevenuePaise;

    staffUpdateInvoiceStatus({
      invoiceId: taxInv.id,
      status: "void",
      reason: "Customer cancelled within cooling-off window",
      staffId: "stf_fin_01",
    });

    const refreshedOrig = controlDb()
      .select()
      .from(controlSchema.invoices)
      .where(eq(controlSchema.invoices.id, taxInv.id))
      .get();
    expect(refreshedOrig?.status).toBe("credited");

    const cnRow = controlDb()
      .select()
      .from(controlSchema.invoices)
      .where(eq(controlSchema.invoices.linkedInvoiceId, taxInv.id))
      .get();
    expect(cnRow).toBeDefined();
    expect(cnRow?.docType).toBe("credit_note");
    expect(cnRow?.invoiceNumber).toMatch(/^CN\/\d{2}-\d{2}\/\d{4}$/);
    expect(cnRow?.totalPaise).toBe(-Math.abs(taxInv.totalPaise));

    const adminAfterCn = getPlatformAdminAnalytics().totals.totalInvoicedRevenuePaise;
    expect(adminAfterCn).toBe(adminBeforeCn - taxInv.totalPaise);

    // 4. GSTR-1 CSV export + Contacts CSV + Action Logs CSV neutralize formula injection while preserving E.164 phone
    const gstrCsv = exportWorkspaceGstInvoicesCsv(acct.workspaceId);
    expect(gstrCsv).toContain("DocumentType,InvoiceNumber,InvoiceDateIST,RecipientGSTIN");
    expect(gstrCsv).toContain("'=CMD|");
    expect(gstrCsv).toContain(taxInv.invoiceNumber);
    expect(gstrCsv).toContain(cnRow!.invoiceNumber);

    tenantDataDb({ workspaceId: acct.workspaceId })
      .insert(tenantDataSchema.contacts)
      .values({
        id: newId("cnt", acct.workspaceId),
        name: "=HYPERLINK(\"http://evil.example\",\"Click\")",
        phoneE164: "+919820099887",
        email: "@attacker@example.com",
        tagsJson: "[]",
        lifetimeValuePaise: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();

    const contactsCsv = exportContactsAsCsv(acct.workspaceId);
    expect(contactsCsv).toContain("\"'=HYPERLINK");
    expect(contactsCsv).toContain("\"+919820099887\"");
    expect(contactsCsv).toContain("\"'@attacker@example.com\"");

    appendActionLog({
      workspaceId: acct.workspaceId,
      actorType: "user",
      actorId: acct.userId,
      source: "web",
      action: "inbox.contact.created",
      outcome: "success",
      requestId: `req_${Date.now()}`,
      correlationId: `cor_${Date.now()}`,
      durationMs: 12,
      summary: "+SUM(1,2) formula summary",
    });
    const logsCsv = exportActionLogsAsCsv(acct.workspaceId);
    expect(logsCsv).toContain("'+SUM(1,2)");
  });

  it("3.4: prevents double-counting Receipt + settled Sales vouchers in Workspace Analytics and exposes clickable setup milestones", () => {
    const acct = setupFreshAccount("AnalyticsDedup");
    const tdb = tenantDataDb({ workspaceId: acct.workspaceId });
    const now = Date.now();
    const companyId = newId("tco", acct.workspaceId);

    tdb
      .insert(tenantDataSchema.tallyCompanies)
      .values({
        id: companyId,
        companyGuid: `cguid-${companyId}`,
        name: "Analytics Dedup Co",
        financialYearFrom: "2026-04-01",
        lastAlterId: 2,
        lastSyncedAt: now,
        createdAt: now,
      })
      .run();

    // Insert a settled ₹10,000 Sales bill (paid_amount_paise = 1,000,000) AND its settling ₹10,000 Receipt voucher for the same party
    tdb
      .insert(tenantDataSchema.tallyVouchers)
      .values([
        {
          id: newId("tvch", acct.workspaceId),
          guid: "guid-sales-10k",
          companyId,
          voucherNumber: "INV-101",
          voucherType: "Sales",
          partyName: "Shree Ganesh Traders",
          amountPaise: 1_000_000,
          paidAmountPaise: 1_000_000,
          paymentStatus: "paid",
          voucherDate: now - 3600_000,
          contentHash: "hash-sales-10k",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: newId("tvch", acct.workspaceId),
          guid: "guid-rcpt-10k",
          companyId,
          voucherNumber: "RCPT-101",
          voucherType: "Receipt",
          partyName: "Shree Ganesh Traders",
          amountPaise: 1_000_000,
          paidAmountPaise: 1_000_000,
          paymentStatus: "paid",
          voucherDate: now - 1800_000,
          contentHash: "hash-rcpt-10k",
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run();

    const analytics = getWorkspaceAnalytics(acct.workspaceId, "30d");
    // Must be ₹10,000 (1,000,000 paise), NOT ₹20,000 (2,000,000 paise)!
    expect(analytics.kpis.moneyCollectedPaise).toBe(1_000_000);

    const dailyTotalCollected = analytics.dailySeries.reduce(
      (sum, d) => sum + d.paymentsCollectedPaise,
      0
    );
    expect(dailyTotalCollected).toBe(1_000_000);

    const progress = getWorkspaceSetupProgress(acct.workspaceId);
    expect(progress.totalCount).toBe(5);
    expect(progress.milestones.length).toBe(5);
    const tallyMilestone = progress.milestones.find((m) => m.key === "tally");
    expect(tallyMilestone?.done).toBe(true);
    expect(tallyMilestone?.href).toBe("/tally");

    const walletChecklist = analytics.setupChecklist.find((s) => s.key === "wallet");
    expect(walletChecklist?.href).toBe("/billing?tab=wallet");
    expect(walletChecklist?.cta).toBe("Recharge Wallet");
  });
});
