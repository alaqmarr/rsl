import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerUserWithWorkspace, resolveUserSessionFromToken } from "@rsl/auth";
import { exportPortableWorkspaceJson } from "@rsl/backup";
import { staffGrantFreeAllToolsAccess } from "@rsl/billing";
import { canRoleAccessWebRoute } from "@rsl/rbac";
import {
  buildLocalTallyExportXml,
  bulkImportTallyInventory,
  exportTallyInventoryAsCsv,
  exportTallyInventoryAsXml,
  generateStandaloneTallyConnectorMjs,
  generateTallyPrimeTdlAddOn,
  getTallyWorkspaceSummary,
  getWorkspaceInventorySummary,
  ingestTallyBillEventAndEnqueueAutomation,
  LATEST_TALLY_TDL_VERSION,
  parseTallyXmlEnvelope,
  recordTallyVoucher,
  upsertTallyStockItem,
} from "@rsl/tally";

function createTestWorkspace(tag: string) {
  const email = `${tag.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 10000)}@rapidshiftlabs.in`;
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

describe("Phase 26 — Tally Overwrite Prevention, Live Inventory & Masters Engine, and Full-Width Public Pages", () => {
  it("prevents new Tally bills from ever overwriting previously saved bills across TDL JSON, multi-date XML snapshots, and manual UI entry", async () => {
    const { session } = createTestWorkspace("NoOverwriteP26");
    const wsId = session.workspace.id;
    staffGrantFreeAllToolsAccess({ workspaceId: wsId, durationDays: 30, staffId: "stf_p26" });

    // 1. TDL v2.8 Post-Commit Hook + SVFromDate/SVToDate verification
    expect(LATEST_TALLY_TDL_VERSION).toBe("2.8");
    const tdl = generateTallyPrimeTdlAddOn({
      workspaceName: "NoOverwriteP26 Enterprises",
      webhookUrl: "https://nooverwrite.tally.rapidshiftlabs.in/api/webhooks/tally",
      webhookToken: "tlwh_p26token123456",
    });
    expect(tdl).toContain("CaptureVoucherBeforeAccept");
    expect(tdl).toContain(
      "Add : On : Form Accept : First : @@RSLShouldPostOnSave : Call : RSLCaptureVoucherBeforeAccept"
    );
    expect(tdl).toContain("PostCapturedVoucherAfterAccept");
    expect(tdl).toContain("JustSavedVoucherColl");
    expect(tdl).toContain('$$Date:"1-Apr-2000"');

    const localExportXml = buildLocalTallyExportXml(0, "NoOverwriteP26 Enterprises");
    expect(localExportXml).toContain("<SVFROMDATE>20000401</SVFROMDATE>");
    expect(localExportXml).toContain("<SVTODATE>20990331</SVTODATE>");
    expect(localExportXml).toContain("AllInventoryEntries.StockItemName");

    const connectorMjs = generateStandaloneTallyConnectorMjs({
      serverUrl: "https://nooverwrite.tally.rapidshiftlabs.in",
      workspaceName: "NoOverwriteP26 Enterprises",
    });
    expect(connectorMjs).toContain("<SVFROMDATE>20000401</SVFROMDATE>");
    expect(connectorMjs).toContain("RSLSyncInventoryMasters");
    expect(connectorMjs).toContain("/<VOUCHER(?:\\s|>)/i");

    // 2. Three sequential TDL JSON bills where Tally sends empty GUID & empty VoucherNumber MUST create 3 separate bills
    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "NoOverwriteP26 Enterprises",
        guid: "",
        masterId: "0",
        voucherNumber: "",
        voucherType: "Sales",
        partyName: "Alpha Traders",
        amountRupees: 12500,
        voucherDate: "2026-11-01",
      },
    });
    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "NoOverwriteP26 Enterprises",
        guid: "",
        masterId: "0",
        voucherNumber: "",
        voucherType: "Sales",
        partyName: "Beta Electricals",
        amountRupees: 28900,
        voucherDate: "2026-11-02",
      },
    });
    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "NoOverwriteP26 Enterprises",
        guid: "",
        masterId: "0",
        voucherNumber: "",
        voucherType: "Sales",
        partyName: "Alpha Traders",
        amountRupees: 9400,
        voucherDate: "2026-11-03",
      },
    });

    let summary = getTallyWorkspaceSummary(wsId);
    expect(summary.vouchers).toHaveLength(3);
    expect(summary.totals.totalBilledPaise).toBe((12500 + 28900 + 9400) * 100);

    // 3. Multi-Date Tally XML Snapshot Guard:
    // Ingest two real Tally XML bills on Nov 01 and Nov 02
    const twoDayXml = `<ENVELOPE>
      <BODY>
        <DESC><STATICVARIABLES><SVFROMDATE>20000401</SVFROMDATE><SVTODATE>20990331</SVTODATE></STATICVARIABLES></DESC>
        <DATA>
          <TALLYMESSAGE>
            <VOUCHER REMOTEID="guid-nov-01" VCHTYPE="Sales">
              <GUID>guid-nov-01</GUID>
              <MASTERID>501</MASTERID>
              <ALTERID>901</ALTERID>
              <DATE>20261101</DATE>
              <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
              <VOUCHERNUMBER>GST/001</VOUCHERNUMBER>
              <PARTYLEDGERNAME>Shree Steels</PARTYLEDGERNAME>
              <AMOUNT>-15000.00</AMOUNT>
              <ALLLEDGERENTRIES.LIST>
                <LEDGERNAME>Shree Steels</LEDGERNAME>
                <GUID>nested-ledger-guid-must-be-ignored</GUID>
                <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
                <AMOUNT>-15000.00</AMOUNT>
              </ALLLEDGERENTRIES.LIST>
            </VOUCHER>
            <VOUCHER REMOTEID="guid-nov-02" VCHTYPE="Sales">
              <GUID>guid-nov-02</GUID>
              <MASTERID>502</MASTERID>
              <ALTERID>902</ALTERID>
              <DATE>20261102</DATE>
              <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
              <VOUCHERNUMBER>GST/002</VOUCHERNUMBER>
              <PARTYLEDGERNAME>Kiran Hardware</PARTYLEDGERNAME>
              <AMOUNT>-22000.00</AMOUNT>
            </VOUCHER>
          </TALLYMESSAGE>
        </DATA>
      </BODY>
    </ENVELOPE>`;

    const parsedCheck = parseTallyXmlEnvelope(twoDayXml, "NoOverwriteP26 Enterprises");
    expect(parsedCheck.hasExplicitDateSpan).toBe(true);
    expect(parsedCheck.vouchers[0]?.guid).toBe("guid-nov-01");

    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "agent",
      actorId: "dev_p26",
      rawPayload: twoDayXml,
      sourceLabel: "agent",
    });

    // Now simulate an OLD legacy connector sending an un-spanned XML (NO <SVFROMDATE>) containing ONLY Nov 03's new bill!
    // Previously, fullCompanySnapshot wiped Nov 01 and Nov 02 bills ("saved bill is being overwritten").
    const legacySingleDayXml = `<ENVELOPE>
      <BODY>
        <DATA>
          <TALLYMESSAGE>
            <VOUCHER REMOTEID="guid-nov-03" VCHTYPE="Sales">
              <GUID>guid-nov-03</GUID>
              <MASTERID>503</MASTERID>
              <ALTERID>903</ALTERID>
              <DATE>20261103</DATE>
              <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
              <VOUCHERNUMBER>GST/003</VOUCHERNUMBER>
              <PARTYLEDGERNAME>Mehta Cables</PARTYLEDGERNAME>
              <AMOUNT>-31000.00</AMOUNT>
            </VOUCHER>
          </TALLYMESSAGE>
        </DATA>
      </BODY>
    </ENVELOPE>`;

    const singleDayOut = await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "agent",
      actorId: "dev_p26",
      rawPayload: legacySingleDayXml,
      sourceLabel: "agent",
      fullCompanySnapshot: { companyName: "NoOverwriteP26 Enterprises" },
    });
    expect(singleDayOut.deletedCount).toBe(0);

    summary = getTallyWorkspaceSummary(wsId);
    const voucherNos = summary.vouchers.map((v) => v.voucherNumber);
    expect(voucherNos).toContain("GST/001");
    expect(voucherNos).toContain("GST/002");
    expect(voucherNos).toContain("GST/003");

    // Genuine edit of GST/002 (matching GUID guid-nov-02) updates amount in place without duplicating
    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "NoOverwriteP26 Enterprises",
        guid: "guid-nov-02",
        masterId: "502",
        voucherNumber: "GST/002",
        voucherType: "Sales",
        partyName: "Kiran Hardware",
        amountRupees: 25500,
        voucherDate: "2026-11-02",
        alterId: 905,
      },
    });
    summary = getTallyWorkspaceSummary(wsId);
    const gst002Rows = summary.vouchers.filter((v) => v.voucherNumber === "GST/002");
    expect(gst002Rows).toHaveLength(1);
    expect(gst002Rows[0]?.amountPaise).toBe(25500 * 100);

    // 4. Manual UI Entry Overwrite Protection (`preventOverwrite: true`)
    const manual1 = await recordTallyVoucher(session.ctx, {
      companyName: "NoOverwriteP26 Enterprises",
      voucherNumber: "MAN/26-27/101",
      voucherType: "Sales",
      partyName: "Patel Distributors",
      amountRupees: 8000,
      paidAmountRupees: 0,
      voucherDateIso: "2026-11-03",
      preventOverwrite: true,
    });
    expect(manual1.ok).toBe(true);

    const accidentalDuplicate = await recordTallyVoucher(session.ctx, {
      companyName: "NoOverwriteP26 Enterprises",
      voucherNumber: "MAN/26-27/101",
      voucherType: "Sales",
      partyName: "Different Party",
      amountRupees: 4200,
      paidAmountRupees: 0,
      voucherDateIso: "2026-11-03",
      preventOverwrite: true,
    });
    expect(accidentalDuplicate.ok).toBe(false);
    if (!accidentalDuplicate.ok) {
      expect(accidentalDuplicate.error.message).toContain("already saved");
      expect(accidentalDuplicate.error.message).toContain("not overwritten");
    }

    summary = getTallyWorkspaceSummary(wsId);
    expect(summary.nextSuggestedBillNumber).toBeTruthy();
    expect(
      summary.vouchers.some((v) => v.voucherNumber === summary.nextSuggestedBillNumber)
    ).toBe(false);
  });

  it("syncs Tally Inventory Masters, Godowns, Batches & Party Credit Limits and live-updates stock across Sales, Purchase, Cancel & Delete", async () => {
    const { session } = createTestWorkspace("InventoryLiveP26");
    const wsId = session.workspace.id;
    staffGrantFreeAllToolsAccess({ workspaceId: wsId, durationDays: 30, staffId: "stf_inv26" });

    // RBAC route checks for /inventory
    expect(canRoleAccessWebRoute("owner", "/inventory", wsId)).toBe(true);
    expect(canRoleAccessWebRoute("manager", "/inventory", wsId)).toBe(true);
    expect(canRoleAccessWebRoute("analyst", "/inventory", wsId)).toBe(true);
    expect(canRoleAccessWebRoute("billing", "/inventory", wsId)).toBe(true);
    expect(canRoleAccessWebRoute("agent", "/inventory", wsId)).toBe(false);

    // 1. Import Tally Prime Masters XML (Godowns + Party Credit Limits + Stock Items with Batches)
    const mastersXml = `<ENVELOPE>
      <BODY>
        <DESC><STATICVARIABLES><SVCURRENTCOMPANY>InventoryLiveP26 Enterprises</SVCURRENTCOMPANY></STATICVARIABLES></DESC>
        <DATA>
          <TALLYMESSAGE>
            <GODOWN NAME="Bhiwandi Central Warehouse">
              <GUID>gdwn-bhiwandi-01</GUID>
              <NAME>Bhiwandi Central Warehouse</NAME>
              <PARENT>Primary</PARENT>
            </GODOWN>
            <LEDGER NAME="Rajesh Electricals">
              <GUID>led-rajesh-01</GUID>
              <NAME>Rajesh Electricals</NAME>
              <PARENT>Sundry Debtors</PARENT>
              <PARTYGSTIN>27AAACR5055K1Z5</PARTYGSTIN>
              <LEDSTATENAME>Maharashtra</LEDSTATENAME>
              <LEDGERMOBILE>9820098200</LEDGERMOBILE>
              <CREDITLIMIT>50000.00</CREDITLIMIT>
              <BILLCREDITPERIOD>30 Days</BILLCREDITPERIOD>
              <CLOSINGBALANCE>-65000.00</CLOSINGBALANCE>
            </LEDGER>
            <STOCKITEM NAME="Havells 4 Sqmm Copper Wire">
              <GUID>item-havells-4mm</GUID>
              <MASTERID>801</MASTERID>
              <ALTERID>1200</ALTERID>
              <NAME>Havells 4 Sqmm Copper Wire</NAME>
              <PARENT>Cables &amp; Wires</PARENT>
              <BASEUNITS>COIL</BASEUNITS>
              <PARTNO>HVL-4MM-90M</PARTNO>
              <HSNCODE>8544</HSNCODE>
              <GSTRATE>18</GSTRATE>
              <STDPRICELIST.LIST><RATE>2800.00/COIL</RATE></STDPRICELIST.LIST>
              <STDCOSTLIST.LIST><RATE>2200.00/COIL</RATE></STDCOSTLIST.LIST>
              <OPENINGBALANCE>50 COIL</OPENINGBALANCE>
              <OPENINGVALUE>-110000.00</OPENINGVALUE>
              <CLOSINGBALANCE>50 COIL</CLOSINGBALANCE>
              <CLOSINGVALUE>-110000.00</CLOSINGVALUE>
              <REORDERBASE>20 COIL</REORDERBASE>
              <MINIMUMORDERBASE>25 COIL</MINIMUMORDERBASE>
              <BATCHALLOCATIONS.LIST>
                <GODOWNNAME>Bhiwandi Central Warehouse</GODOWNNAME>
                <BATCHNAME>LOT-2026-A</BATCHNAME>
                <CLOSINGBALANCE>50 COIL</CLOSINGBALANCE>
                <CLOSINGVALUE>-110000.00</CLOSINGVALUE>
                <EXPIRYPERIOD>20271231</EXPIRYPERIOD>
              </BATCHALLOCATIONS.LIST>
            </STOCKITEM>
          </TALLYMESSAGE>
        </DATA>
      </BODY>
    </ENVELOPE>`;

    const importRes = await bulkImportTallyInventory(session.ctx, {
      companyName: "InventoryLiveP26 Enterprises",
      format: "tally_xml",
      rawContent: mastersXml,
    });
    expect(importRes.ok).toBe(true);
    if (importRes.ok) {
      expect(importRes.data.stockItemsUpserted).toBe(1);
      expect(importRes.data.godownsUpserted).toBeGreaterThanOrEqual(1);
      expect(importRes.data.partiesUpserted).toBe(1);
    }

    // Also add a second SKU via manual upsert
    const addSkuRes = await upsertTallyStockItem(session.ctx, {
      companyName: "InventoryLiveP26 Enterprises",
      name: "PolyCab MCB 32A DP",
      skuCode: "PCB-MCB-32DP",
      stockGroup: "Switchgear",
      uom: "PCS",
      hsnCode: "8536",
      gstRatePct: 18,
      sellingPriceRupees: 450,
      costPriceRupees: 320,
      openingQty: 100,
      reorderLevelQty: 15,
      minOrderQty: 20,
      godownName: "Bhiwandi Central Warehouse",
      batchName: "Primary Batch",
    });
    expect(addSkuRes.ok).toBe(true);

    let inv = getWorkspaceInventorySummary(wsId);
    expect(inv.kpis.totalSkusCount).toBe(2);
    expect(inv.parties[0]?.creditExceeded).toBe(true);
    expect(inv.parties[0]?.gstin).toBe("27AAACR5055K1Z5");

    // 2. Sync a Tally Sales Voucher XML with <ALLINVENTORYENTRIES.LIST> selling 35 COILs (50 -> 15 COILs, triggering Reorder Alert <= 20!)
    const salesWithItemsXml = `<ENVELOPE>
      <BODY>
        <DESC><STATICVARIABLES><SVFROMDATE>20000401</SVFROMDATE><SVTODATE>20990331</SVTODATE></STATICVARIABLES></DESC>
        <DATA>
          <TALLYMESSAGE>
            <VOUCHER REMOTEID="vch-sale-items-1" VCHTYPE="Sales">
              <GUID>vch-sale-items-1</GUID>
              <MASTERID>901</MASTERID>
              <ALTERID>1301</ALTERID>
              <DATE>20261103</DATE>
              <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
              <VOUCHERNUMBER>INV/26-27/501</VOUCHERNUMBER>
              <PARTYLEDGERNAME>Rajesh Electricals</PARTYLEDGERNAME>
              <AMOUNT>-98000.00</AMOUNT>
              <ALLINVENTORYENTRIES.LIST>
                <STOCKITEMNAME>Havells 4 Sqmm Copper Wire</STOCKITEMNAME>
                <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                <ACTUALQTY>35 COIL</ACTUALQTY>
                <BILLEDQTY>35 COIL</BILLEDQTY>
                <RATE>2800.00/COIL</RATE>
                <AMOUNT>98000.00</AMOUNT>
                <BATCHALLOCATIONS.LIST>
                  <GODOWNNAME>Bhiwandi Central Warehouse</GODOWNNAME>
                  <BATCHNAME>LOT-2026-A</BATCHNAME>
                </BATCHALLOCATIONS.LIST>
              </ALLINVENTORYENTRIES.LIST>
            </VOUCHER>
          </TALLYMESSAGE>
        </DATA>
      </BODY>
    </ENVELOPE>`;

    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: salesWithItemsXml,
    });

    inv = getWorkspaceInventorySummary(wsId);
    const wireAfterSale = inv.items.find((i) => i.name === "Havells 4 Sqmm Copper Wire")!;
    expect(wireAfterSale.closingQty).toBe(15); // 50 opening - 35 sold = 15
    expect(wireAfterSale.totalSoldQty).toBe(35);
    expect(wireAfterSale.totalSoldPaise).toBe(98000 * 100);
    expect(wireAfterSale.stockStatus).toBe("low_stock"); // 15 <= reorder 20
    expect(inv.reorderActionItems.some((i) => i.id === wireAfterSale.id)).toBe(true);

    // Verify line items also show up on getTallyWorkspaceSummary for /tally Bills Register
    const tallySummary = getTallyWorkspaceSummary(wsId);
    const syncedSaleBill = tallySummary.vouchers.find((v) => v.voucherNumber === "INV/26-27/501");
    expect(syncedSaleBill?.lineItems).toHaveLength(1);
    expect(syncedSaleBill?.lineItems?.[0]?.itemName).toBe("Havells 4 Sqmm Copper Wire");
    expect(syncedSaleBill?.lineItems?.[0]?.billedQty).toBe(35);

    // 3. Purchase Voucher adds +20 COILs -> 15 + 20 = 35 COILs (Healthy again!)
    const purchaseRes = await recordTallyVoucher(session.ctx, {
      companyName: "InventoryLiveP26 Enterprises",
      voucherNumber: "PUR/26-27/088",
      voucherType: "Purchase",
      partyName: "Havells India Ltd",
      amountRupees: 44000,
      paidAmountRupees: 44000,
      voucherDateIso: "2026-11-03",
      lineItems: [
        {
          itemName: "Havells 4 Sqmm Copper Wire",
          billedQty: 20,
          uom: "COIL",
          rateRupees: 2200,
          godownName: "Bhiwandi Central Warehouse",
          batchName: "LOT-2026-A",
        },
      ],
    });
    expect(purchaseRes.ok).toBe(true);

    inv = getWorkspaceInventorySummary(wsId);
    const wireAfterPurchase = inv.items.find((i) => i.name === "Havells 4 Sqmm Copper Wire")!;
    expect(wireAfterPurchase.closingQty).toBe(35); // 50 + 20 - 35 = 35
    expect(wireAfterPurchase.totalPurchasedQty).toBe(20);
    expect(wireAfterPurchase.stockStatus).toBe("healthy");

    // 4. Cancelling INV/26-27/501 in Tally (Alt+X) automatically restores the 35 sold COILs -> 50 + 20 = 70 COILs!
    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "InventoryLiveP26 Enterprises",
        guid: "vch-sale-items-1",
        masterId: "901",
        voucherNumber: "INV/26-27/501",
        voucherType: "Sales",
        partyName: "Rajesh Electricals",
        amountRupees: 98000,
        voucherDate: "2026-11-03",
        isCancelled: true,
      },
    });

    inv = getWorkspaceInventorySummary(wsId);
    const wireAfterCancel = inv.items.find((i) => i.name === "Havells 4 Sqmm Copper Wire")!;
    expect(wireAfterCancel.closingQty).toBe(70);
    expect(wireAfterCancel.totalSoldQty).toBe(0);

    // 5. Verify Inventory CSV, Tally XML & Portable Backup exports
    const csv = exportTallyInventoryAsCsv(wsId);
    expect(csv).toContain("Havells 4 Sqmm Copper Wire");
    expect(csv).toContain("PolyCab MCB 32A DP");

    const xml = exportTallyInventoryAsXml(wsId);
    expect(xml).toContain("<STOCKITEM");
    expect(xml).toContain("Havells 4 Sqmm Copper Wire");

    const portable = JSON.parse(exportPortableWorkspaceJson(wsId)) as Record<string, unknown[]>;
    expect(portable.tallyStockItems).toHaveLength(2);
    expect(portable.tallyGodowns?.length).toBeGreaterThanOrEqual(1);
    expect(portable.tallyVoucherItems?.length).toBeGreaterThanOrEqual(1);

    // 6. Deleting PUR/26-27/088 in Tally (Alt+D) removes the +20 purchase and restores stock cleanly to 50 COILs!
    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "InventoryLiveP26 Enterprises",
        voucherNumber: "PUR/26-27/088",
        voucherType: "Purchase",
        partyName: "Havells India Ltd",
        amountRupees: 44000,
        isDeleted: true,
      },
    });
    inv = getWorkspaceInventorySummary(wsId);
    const wireAfterDelete = inv.items.find((i) => i.name === "Havells 4 Sqmm Copper Wire")!;
    expect(wireAfterDelete.closingQty).toBe(50);
    expect(wireAfterDelete.totalPurchasedQty).toBe(0);
  });

  it("enforces fluid full-width containers with zero max-w-7xl / max-w-4xl restrictions on homepage, legal compliance pages, docs, and setup", () => {
    const repoRoot = path.resolve(__dirname, "../../../../");
    const filesToVerify = [
      "apps/web/src/components/public-landing-page.tsx",
      "apps/web/src/app/(legal)/layout.tsx",
      "apps/web/src/components/legal-page-view.tsx",
      "apps/web/src/app/(dashboard)/inventory/page.tsx",
      "apps/docs/src/app/errors/[code]/page.tsx",
      "apps/docs/src/app/guides/[slug]/page.tsx",
      "apps/admin/src/app/setup/page.tsx",
    ];

    for (const relPath of filesToVerify) {
      const fullPath = path.join(repoRoot, relPath);
      const source = fs.readFileSync(fullPath, "utf8");
      expect(source, `${relPath} must not contain max-w-7xl`).not.toContain("max-w-7xl");
      expect(source, `${relPath} must not contain max-w-6xl`).not.toContain("max-w-6xl");
      expect(source, `${relPath} must not contain max-w-5xl`).not.toContain("max-w-5xl");
      expect(source, `${relPath} must not contain max-w-4xl`).not.toContain("max-w-4xl");
    }
  });
});
