import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerUserWithWorkspace, resolveUserSessionFromToken } from "@rsl/auth";
import { exportPortableWorkspaceJson } from "@rsl/backup";
import {
  DEFAULT_BUNDLE_CATALOG,
  ensureServiceCatalogSeeded,
  generatePartyLedgerStatementPdfBytes,
  generateTallyVoucherDetailPdfBytes,
  getPdfPageCount,
  listPublicPricingCatalog,
  SERVICE_CATALOG,
  staffGrantFreeAllToolsAccess,
} from "@rsl/billing";
import { newEntityId } from "@rsl/core";
import { tenantDataSchema } from "@rsl/database";
import { canRoleAccessWebRoute } from "@rsl/rbac";
import {
  buildTallyDisplayBrandTitle,
  buildWindowsInstallerFilename,
  buildWorkspaceTdlFilename,
  generateTallyPrimeTdlAddOn,
  generateWindowsTallyInstallerBat,
  getTallyWorkspaceSummary,
  getWorkspacePartiesLedgerSummary,
  getWorkspacePartyLedgerDetail,
  getWorkspaceVoucherDetail,
  ingestTallyBillEventAndEnqueueAutomation,
  LATEST_TALLY_TDL_VERSION,
  markTallyBillPaidViaReceipt,
  recordTallyVoucher,
  upsertWorkspacePartyLedger,
} from "@rsl/tally";
import { tenantDataDb } from "@rsl/tenancy";

function createTestWorkspace(tag: string, businessName?: string) {
  const email = `${tag.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 10000)}@rapidshiftlabs.in`;
  const reg = registerUserWithWorkspace({
    name: `${tag} Owner`,
    email,
    password: "StrongPassword123!",
    businessName: businessName ?? `${tag} Enterprises`,
    industry: "Wholesale",
    stateCode: "27",
  });
  const session = resolveUserSessionFromToken(reg.rawSessionToken)!;
  return { email, reg, session };
}

describe("Phase 27 — All-in-One Tally Suite, Business-Named .TDL & Menu, Live Paid-in-Tally Sync, Client Ledgers, and Indian SMB Pricing", () => {
  it("names .tdl & .bat installers with client business name and displays '<Business Name> & RSL Sync' safely inside Tally Prime", () => {
    expect(LATEST_TALLY_TDL_VERSION).toBe("2.8");

    expect(buildWorkspaceTdlFilename("Sharma Hardware & Steels")).toBe(
      "sharma-hardware-and-steels-rsl-sync.tdl"
    );
    expect(
      buildWorkspaceTdlFilename("Sharma Hardware & Steels", { isolatedSlug: "Mumbai Branch" })
    ).toBe("sharma-hardware-and-steels-mumbai-branch-rsl-sync.tdl");

    expect(buildWindowsInstallerFilename("Sharma Hardware & Steels")).toBe(
      "Install-Sharma-Hardware-Steels-RSL-Sync.bat"
    );
    expect(buildTallyDisplayBrandTitle("Sharma Hardware & Steels")).toBe(
      "Sharma Hardware & Steels & RSL Sync"
    );

    // Even if business name contains colons, brackets, or quotes, procedural TDL lines remain 100% zero-colon safe
    const trickyTdl = generateTallyPrimeTdlAddOn({
      workspaceName: 'Kothari [Exports]: "Unit-2"',
      webhookUrl: "https://kothari.tally.rapidshiftlabs.in/api/webhooks/tally",
      webhookToken: "tlwh_p27token987654",
    });

    expect(trickyTdl).toContain("Kothari Exports Unit-2 & RSL Sync - Connection Test");
    expect(trickyTdl).toContain("Kothari Exports Unit-2 & RSL Sync - Sync All Now");
    expect(trickyTdl).toContain('Header          : "User-Agent: TallyPrime-RSL-TDL/2.8"');
    expect(trickyTdl).toContain('"Payment"');
    expect(trickyTdl).toContain('"Purchase"');
    expect(trickyTdl).toContain('"Debit Note"');
    expect(trickyTdl).toContain('JSONTag     : "againstBillNumber"');
    expect(trickyTdl).toContain('JSONTag     : "partyParentGroup"');
    expect(trickyTdl).not.toContain('"RSL Sync All Bills Now"');
    expect(trickyTdl).not.toContain('"RSL Cloud Connection Test"');

    // Verify no procedural step uses unquoted $$Fn:Arg colons and every "<step> : Set : <var> : <expr>" step has exact 3 structural colons (0 in <expr>)
    const fnStepLines = trickyTdl
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^\d{2,3}\s*:/.test(l));
    expect(fnStepLines.length).toBeGreaterThan(20);
    for (const line of fnStepLines) {
      const strippedQuotes = line.replace(/"[^"]*"/g, '""');
      expect(strippedQuotes).not.toMatch(/\$\$[A-Za-z0-9_]+\s*:/);
      if (/^\d{2,3}\s*:\s*Set\s*:/i.test(strippedQuotes)) {
        const colonCount = (strippedQuotes.match(/:/g) || []).length;
        expect(colonCount).toBe(3);
      }
    }

    const installerBat = generateWindowsTallyInstallerBat({
      workspaceName: "Sharma Hardware & Steels",
      serverUrl: "https://sharma.tally.rapidshiftlabs.in",
      pairingCode: "PAIR99",
    });
    expect(installerBat).toContain("Sharma Hardware & Steels & RSL Sync");
    expect(installerBat).toContain("sharma-hardware-and-steels-rsl-sync.tdl");
  });

  it("automatically settles Sales & Purchase bills when marked Paid in Tally (Cash Counter, Agst Ref, CreditNote, FIFO, Payment) and reversibly un-pays on Receipt cancellation/deletion", async () => {
    const { session } = createTestWorkspace("PaidSyncP27", "Mehta Electricals");
    const wsId = session.workspace.id;
    staffGrantFreeAllToolsAccess({ workspaceId: wsId, durationDays: 30, staffId: "stf_p27" });

    // 1. Cash Counter Invoice -> immediately marked 'paid' via 'cash_counter'
    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "Mehta Electricals",
        guid: "guid-cash-01",
        voucherNumber: "CASH/001",
        voucherType: "Sales",
        partyName: "Cash",
        amountRupees: 1850,
        voucherDate: "2026-10-01",
      },
    });

    const summaryAfterCash = getTallyWorkspaceSummary(wsId);
    const cashVch = summaryAfterCash.vouchers.find((v) => v.voucherNumber === "CASH/001")!;
    expect(cashVch.paymentStatus).toBe("paid");
    expect(cashVch.paidAmountPaise).toBe(185_000);
    expect(cashVch.settlements[0]?.allocationType).toBe("cash_counter");

    // 2. Credit Sales Invoice #INV/101 for ₹25,000 (unpaid) + enqueue a pending overdue WhatsApp job in outbox
    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "Mehta Electricals",
        guid: "guid-inv-101",
        voucherNumber: "INV/101",
        voucherType: "Sales",
        partyName: "Patel Builders Pvt Ltd",
        partyPhone: "+919820112233",
        amountRupees: 25000,
        voucherDate: "2026-09-10",
        dueDate: "2026-09-25",
      },
    });

    const db = tenantDataDb({ workspaceId: wsId });
    const inv101Before = db
      .select()
      .from(tenantDataSchema.tallyVouchers)
      .all()
      .find((v) => v.voucherNumber === "INV/101")!;
    expect(inv101Before.paymentStatus).toBe("unpaid");

    const outboxId = newEntityId("obx", wsId);
    db.insert(tenantDataSchema.outbox)
      .values({
        id: outboxId,
        queueName: "realtime",
        jobType: "tally.whatsapp.automation",
        idempotencyKey: `rem-${inv101Before.id}`,
        envelopeJson: JSON.stringify({ voucherId: inv101Before.id, kind: "overdue_reminder" }),
        status: "pending",
        attempts: 0,
        nextRunAt: Date.now() + 60_000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();

    // 3. Partial Credit Note of ₹5,000 against INV/101 -> marks INV/101 'partial' (₹20,000 balance)
    const cnXml = `<ENVELOPE><BODY><DATA><TALLYMESSAGE>
      <VOUCHER VCHTYPE="Credit Note" ACTION="Create">
        <GUID>guid-cn-01</GUID>
        <DATE>20260915</DATE>
        <VOUCHERTYPENAME>Credit Note</VOUCHERTYPENAME>
        <VOUCHERNUMBER>CN/01</VOUCHERNUMBER>
        <PARTYLEDGERNAME>Patel Builders Pvt Ltd</PARTYLEDGERNAME>
        <AMOUNT>5000.00</AMOUNT>
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>Patel Builders Pvt Ltd</LEDGERNAME>
          <AMOUNT>5000.00</AMOUNT>
          <BILLALLOCATIONS.LIST>
            <NAME>INV/101</NAME>
            <BILLTYPE>Agst Ref</BILLTYPE>
            <AMOUNT>5000.00</AMOUNT>
          </BILLALLOCATIONS.LIST>
        </ALLLEDGERENTRIES.LIST>
      </VOUCHER>
    </TALLYMESSAGE></DATA></BODY></ENVELOPE>`;

    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: cnXml,
    });

    const afterCn = getTallyWorkspaceSummary(wsId);
    const inv101Partial = afterCn.vouchers.find((v) => v.voucherNumber === "INV/101")!;
    expect(inv101Partial.paymentStatus).toBe("partial");
    expect(inv101Partial.paidAmountPaise).toBe(500_000);

    // 4. Receipt of ₹20,000 in Tally with Agst Ref INV/101 -> marks INV/101 'paid', zeroes party balance, and cancels pending overdue outbox job!
    const rcptXml = `<ENVELOPE><BODY><DATA><TALLYMESSAGE>
      <VOUCHER VCHTYPE="Receipt" ACTION="Create">
        <GUID>guid-rcpt-501</GUID>
        <DATE>20260928</DATE>
        <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
        <VOUCHERNUMBER>RCPT/501</VOUCHERNUMBER>
        <PARTYLEDGERNAME>Patel Builders Pvt Ltd</PARTYLEDGERNAME>
        <NARRATION>NEFT UTR HDFC00998811 against INV/101</NARRATION>
        <AMOUNT>20000.00</AMOUNT>
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>Patel Builders Pvt Ltd</LEDGERNAME>
          <AMOUNT>20000.00</AMOUNT>
          <BILLALLOCATIONS.LIST>
            <NAME>INV/101</NAME>
            <BILLTYPE>Agst Ref</BILLTYPE>
            <AMOUNT>20000.00</AMOUNT>
          </BILLALLOCATIONS.LIST>
        </ALLLEDGERENTRIES.LIST>
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>HDFC Bank Current A/c</LEDGERNAME>
          <AMOUNT>-20000.00</AMOUNT>
        </ALLLEDGERENTRIES.LIST>
      </VOUCHER>
    </TALLYMESSAGE></DATA></BODY></ENVELOPE>`;

    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: rcptXml,
    });

    const afterRcpt = getTallyWorkspaceSummary(wsId);
    const inv101Paid = afterRcpt.vouchers.find((v) => v.voucherNumber === "INV/101")!;
    expect(inv101Paid.paymentStatus).toBe("paid");
    expect(inv101Paid.paidAmountPaise).toBe(2_500_000);
    expect(inv101Paid.settlements).toHaveLength(2);

    const outboxAfterPaid = db
      .select()
      .from(tenantDataSchema.outbox)
      .all()
      .find((r) => r.id === outboxId)!;
    expect(outboxAfterPaid.status).toBe("completed");

    const ledgersAfterPaid = getWorkspacePartiesLedgerSummary(wsId);
    const patelParty = ledgersAfterPaid.parties.find((p) => p.name === "Patel Builders Pvt Ltd")!;
    expect(patelParty.closingBalancePaise).toBe(0);
    expect(patelParty.unpaidBillsCount).toBe(0);

    // 5. Reversibility: Accountant cancels (Alt+X) Receipt #RCPT/501 in Tally -> INV/101 reverts to 'partial' (₹20,000 pending) & party closing balance restores to ₹20,000 Dr!
    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "Mehta Electricals",
        guid: "guid-rcpt-501",
        voucherNumber: "RCPT/501",
        voucherType: "Receipt",
        partyName: "Patel Builders Pvt Ltd",
        amountRupees: 20000,
        isCancelled: true,
      },
    });

    const afterCancel = getTallyWorkspaceSummary(wsId);
    const inv101Reverted = afterCancel.vouchers.find((v) => v.voucherNumber === "INV/101")!;
    expect(inv101Reverted.paymentStatus).toBe("partial");
    expect(inv101Reverted.paidAmountPaise).toBe(500_000);

    const patelAfterCancel = getWorkspacePartiesLedgerSummary(wsId).parties.find(
      (p) => p.name === "Patel Builders Pvt Ltd"
    )!;
    expect(patelAfterCancel.closingBalancePaise).toBe(2_000_000);
    expect(patelAfterCancel.unpaidBillsCount).toBe(1);

    // 6. Supplier Purchase Bill + Supplier Payment Voucher -> settles Purchase bill & updates Sundry Creditors balance
    const ctx = session.ctx;

    const polycabUpsert = await upsertWorkspacePartyLedger(ctx, {
      companyName: "Mehta Electricals",
      name: "Polycab Wires Ltd",
      parentGroup: "Sundry Creditors",
      gstin: "27AAACP1234F1Z5",
      phoneE164: "+919811223344",
      creditDays: 30,
      creditLimitRupees: 0,
      openingBalanceRupees: 0,
      openingBalanceType: "Cr",
    });
    expect(polycabUpsert.ok).toBe(true);

    const purchOut = await recordTallyVoucher(ctx, {
      companyName: "Mehta Electricals",
      voucherNumber: "PUR/2026/09",
      voucherType: "Purchase",
      partyName: "Polycab Wires Ltd",
      amountRupees: 40000,
      paidAmountRupees: 0,
      voucherDateIso: "2026-10-05",
      preventOverwrite: true,
    });
    expect(purchOut.ok).toBe(true);
    if (!purchOut.ok) throw new Error(purchOut.error.message);

    const markPaidOut = await markTallyBillPaidViaReceipt(ctx, {
      billVoucherId: purchOut.data.voucherId,
      paymentModeLedger: "HDFC Bank Current A/c",
      narration: "RTGS Supplier Settlement",
    });
    expect(markPaidOut.ok).toBe(true);
    if (!markPaidOut.ok) throw new Error(markPaidOut.error.message);
    expect(markPaidOut.data.updatedStatus).toBe("paid");
    expect(markPaidOut.data.remainingBalancePaise).toBe(0);

    const polycabDetail = getWorkspacePartyLedgerDetail(
      wsId,
      getWorkspacePartiesLedgerSummary(wsId).parties.find((p) => p.name === "Polycab Wires Ltd")!.id
    );
    expect(polycabDetail.party.closingBalancePaise).toBe(0);
    expect(polycabDetail.settledBills).toHaveLength(1);
  });

  it("renders T-account chronological running balances, voucher settlement trails, PDFs, and portable backups cleanly", async () => {
    const { session } = createTestWorkspace("LedgerDetailP27", "Desai Sanitaryware");
    const wsId = session.workspace.id;
    staffGrantFreeAllToolsAccess({ workspaceId: wsId, durationDays: 30, staffId: "stf_p27_b" });

    const ctx = session.ctx;

    const partyRes = await upsertWorkspacePartyLedger(ctx, {
      companyName: "Desai Sanitaryware",
      name: "Shreeji Interiors",
      parentGroup: "Sundry Debtors",
      gstin: "27AABCS9988D1Z2",
      pan: "AABCS9988D",
      phoneE164: "+919822001100",
      stateName: "Maharashtra",
      creditLimitRupees: 50000,
      creditDays: 15,
      openingBalanceRupees: 10000,
      openingBalanceType: "Dr",
    });
    expect(partyRes.ok).toBe(true);
    if (!partyRes.ok) throw new Error(partyRes.error.message);
    const partyId = partyRes.data.partyId;

    const sale1 = await recordTallyVoucher(ctx, {
      companyName: "Desai Sanitaryware",
      voucherNumber: "DS/26-27/001",
      voucherType: "Sales",
      partyName: "Shreeji Interiors",
      partyPhoneE164: "+919822001100",
      amountRupees: 60000,
      paidAmountRupees: 0,
      voucherDateIso: "2026-08-01",
      dueDateIso: "2026-08-16",
      lineItems: [
        {
          itemName: "Jaquar Basin Mixer",
          billedQty: 10,
          uom: "PCS",
          rateRupees: 6000,
          gstRatePct: 18,
          godownName: "Main Location",
        },
      ],
      preventOverwrite: true,
    });
    expect(sale1.ok).toBe(true);
    if (!sale1.ok) throw new Error(sale1.error.message);

    // FIFO auto-settlement via on-account Receipt of ₹25,000
    const rcptRes = await recordTallyVoucher(ctx, {
      companyName: "Desai Sanitaryware",
      voucherNumber: "RCPT/26-27/010",
      voucherType: "Receipt",
      partyName: "Shreeji Interiors",
      amountRupees: 25000,
      paidAmountRupees: 25000,
      voucherDateIso: "2026-08-10",
      narration: "On-account UPI receipt",
      preventOverwrite: true,
    });
    expect(rcptRes.ok).toBe(true);

    const summary = getWorkspacePartiesLedgerSummary(wsId);
    const shreeji = summary.parties.find((p) => p.id === partyId)!;
    // Opening 10,000 Dr + Sales 60,000 Dr - Receipt 25,000 Cr = 45,000 Dr (4,500,000 paise)
    expect(shreeji.closingBalancePaise).toBe(4_500_000);
    expect(summary.ageingBuckets.some((b) => b.amountPaise > 0)).toBe(true);

    const detail = getWorkspacePartyLedgerDetail(wsId, partyId);
    expect(detail.statementRows.length).toBeGreaterThanOrEqual(3); // Opening + Sales + Receipt
    const lastRow = detail.statementRows[detail.statementRows.length - 1]!;
    expect(lastRow.runningBalancePaise).toBe(4_500_000);
    expect(lastRow.runningDrCr).toBe("Dr");
    expect(detail.itemHistory[0]?.itemName).toBe("Jaquar Basin Mixer");

    const vchDetail = getWorkspaceVoucherDetail(wsId, sale1.data.voucherId);
    expect(vchDetail.voucher.paymentStatus).toBe("partial");
    expect(vchDetail.settlementsAgainstBill).toHaveLength(1);
    expect(vchDetail.settlementsAgainstBill[0]?.allocationType).toBe("fifo_auto");

    const nowMs = Date.now();
    // Generate both PDFs and verify valid %PDF header & page count >= 1
    const stmtPdf = await generatePartyLedgerStatementPdfBytes({
      workspaceName: "Desai Sanitaryware",
      companyName: detail.companyName,
      partyName: detail.party.name,
      parentGroup: detail.party.parentGroup,
      gstin: detail.party.gstin,
      pan: detail.party.pan,
      phoneE164: detail.party.phoneE164,
      stateName: detail.party.stateName,
      creditLimitPaise: detail.party.creditLimitPaise,
      creditDays: detail.party.creditDays,
      openingBalancePaise: detail.party.openingBalancePaise,
      closingBalancePaise: detail.party.closingBalancePaise,
      totalDebitsPaise: detail.totals.totalDebitsPaise,
      totalCreditsPaise: detail.totals.totalCreditsPaise,
      statementEntries: detail.statementRows
        .filter((r) => r.voucherId !== null)
        .map((r) => ({
          voucherNumber: r.voucherNumber,
          voucherType: r.voucherType,
          voucherDate: r.date,
          particulars: r.particulars,
          debitPaise: r.debitPaise,
          creditPaise: r.creditPaise,
          runningBalancePaise: r.runningBalancePaise,
          runningBalanceDrCr: r.runningDrCr,
        })),
      openBills: detail.openBills.map((b) => ({
        voucherNumber: b.voucherNumber,
        voucherType: b.voucherType,
        voucherDate: b.voucherDate,
        dueDate: b.dueDate,
        amountPaise: b.amountPaise,
        paidAmountPaise: b.paidAmountPaise,
        balancePaise: b.pendingPaise,
        daysOverdue:
          b.dueDate !== null && b.dueDate < nowMs
            ? Math.max(0, Math.floor((nowMs - b.dueDate) / 86_400_000))
            : 0,
      })),
    });
    expect(Buffer.from(stmtPdf.slice(0, 5)).toString("ascii")).toBe("%PDF-");
    expect(await getPdfPageCount(stmtPdf)).toBeGreaterThanOrEqual(1);

    const vchPdf = await generateTallyVoucherDetailPdfBytes({
      workspaceName: "Desai Sanitaryware",
      companyName: vchDetail.companyName,
      voucherNumber: vchDetail.voucher.voucherNumber,
      voucherType: vchDetail.voucher.voucherType,
      voucherDate: vchDetail.voucher.voucherDate,
      dueDate: vchDetail.voucher.dueDate,
      partyName: vchDetail.voucher.partyName,
      partyGstin: vchDetail.party?.gstin,
      partyPhone: vchDetail.voucher.partyPhoneE164,
      amountPaise: vchDetail.voucher.amountPaise,
      paidAmountPaise: vchDetail.voucher.paidAmountPaise,
      balancePaise: vchDetail.pendingPaise,
      paymentStatus: vchDetail.voucher.paymentStatus,
      narration: vchDetail.voucher.narration,
      lineItems: vchDetail.lineItems.map((li) => ({
        itemName: li.itemName,
        hsnCode: li.hsnCode,
        billedQty: li.billedQty,
        uom: li.uom,
        ratePaise: li.ratePaise,
        discountPct: li.discountBps / 100,
        gstRatePct: li.gstRateBps / 100,
        amountPaise: li.amountPaise,
      })),
      settlements: vchDetail.settlementsAgainstBill.map((s) => ({
        settlementVoucherNumber: s.settlementVoucherNumber || "Direct",
        settlementVoucherType: s.settlementVoucherType,
        settlementMethod: s.allocationType,
        settledAt: s.settledAt,
        amountPaise: s.amountPaise,
      })),
    });
    expect(Buffer.from(vchPdf.slice(0, 5)).toString("ascii")).toBe("%PDF-");
    expect(await getPdfPageCount(vchPdf)).toBeGreaterThanOrEqual(1);

    // Portable backup includes tallyBillSettlements
    const backupJson = exportPortableWorkspaceJson(wsId);
    const backup = JSON.parse(backupJson) as {
      tallyBillSettlements?: unknown[];
    };
    expect(Array.isArray(backup.tallyBillSettlements)).toBe(true);
    expect((backup.tallyBillSettlements ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("aligns pricing with Indian Tally Suite benchmarks (BizAnalyst/Livekeeping) and enforces full-width layouts on all Tally Suite & public pages", () => {
    ensureServiceCatalogSeeded();
    const storefront = listPublicPricingCatalog();

    const tallyBusinessSuite = DEFAULT_BUNDLE_CATALOG.find(
      (b) => b.key === "tally_business_suite"
    )!;
    expect(tallyBusinessSuite).toBeDefined();
    expect(tallyBusinessSuite.yearlyAmountPaise).toBe(330_000); // ₹3,300/yr (~₹275/mo)

    const tallyWhatsappPack = DEFAULT_BUNDLE_CATALOG.find(
      (b) => b.key === "tally_whatsapp_pack"
    )!;
    expect(tallyWhatsappPack.yearlyAmountPaise).toBe(449_900); // ₹4,499/yr (~₹375/mo)

    const allFeatures = DEFAULT_BUNDLE_CATALOG.find((b) => b.key === "all_features")!;
    expect(allFeatures.yearlyAmountPaise).toBe(899_900); // ₹8,999/yr (~₹750/mo)

    const tallySyncSvc = SERVICE_CATALOG.find((s) => s.key === "tally.sync")!;
    expect(tallySyncSvc.defaultMonthlyPaise).toBe(29_900);
    expect(tallyBusinessSuite.monthlyAmountPaise).toBe(34_900);
    expect(storefront.bundles.some((b) => b.key === "tally_business_suite")).toBe(true);

    // RBAC route checks for new Tally Suite pages
    expect(canRoleAccessWebRoute("owner", "/tally/parties")).toBe(true);
    expect(canRoleAccessWebRoute("billing", "/tally/parties")).toBe(true);
    expect(canRoleAccessWebRoute("manager", "/tally/vouchers/tvch_123")).toBe(true);
    expect(canRoleAccessWebRoute("agent", "/tally/parties")).toBe(false);

    // Verify zero outer max-w-7xl / max-w-6xl / max-w-5xl / max-w-4xl restrictions on all Tally Suite & public pages
    const filesToVerifyFullWidth = [
      path.resolve(__dirname, "../app/(dashboard)/tally/page.tsx"),
      path.resolve(__dirname, "../app/(dashboard)/tally/parties/page.tsx"),
      path.resolve(__dirname, "../app/(dashboard)/tally/parties/[partyId]/page.tsx"),
      path.resolve(__dirname, "../app/(dashboard)/tally/vouchers/[voucherId]/page.tsx"),
      path.resolve(__dirname, "../app/(dashboard)/inventory/page.tsx"),
      path.resolve(__dirname, "../components/public-landing-page.tsx"),
    ];

    for (const filePath of filesToVerifyFullWidth) {
      const src = fs.readFileSync(filePath, "utf8");
      expect(src).toContain("w-full");
      expect(src).not.toMatch(/\bmax-w-(?:7xl|6xl|5xl|4xl)\b/);
    }
  });
});
