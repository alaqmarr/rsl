import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { registerUserWithWorkspace, resolveUserSessionFromToken } from "@rsl/auth";
import { staffGrantFreeAllToolsAccess } from "@rsl/billing";
import {
  generateStandaloneTallyConnectorMjs,
  generateTallyPrimeTdlAddOn,
  getOrCreateTallyWebhookEndpoint,
  getTallyWorkspaceSummary,
  getWorkspaceInventorySummary,
  getWorkspacePartiesLedgerSummary,
  ingestTallyBillEventAndEnqueueAutomation,
  LATEST_TALLY_TDL_VERSION,
  reconcileTallyCompanySnapshot,
  registerTallyCompaniesForWorkspace,
} from "@rsl/tally";
import { POST as tallyWebhookPost } from "../app/api/webhooks/tally/route";

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

describe("Phase 28 — Zero Bill Overwrite (#8 vs #9), Direct Real-Time Product Import, Multi-Company Detection & Isolation, and Step-by-Step Tally Guide", () => {
  it("generates compiler-safe .tdl v2.8 with max-MasterID voucher lookup, real-time StockItem & Ledger hooks, bulk masters sync, and multi-company iteration", () => {
    expect(LATEST_TALLY_TDL_VERSION).toBe("2.8");

    const variants = [
      generateTallyPrimeTdlAddOn({
        workspaceName: "Agarwal Hardware & Plywood",
        webhookUrl: "https://agarwal.tally.rapidshiftlabs.in/api/webhooks/tally",
        webhookToken: "tlwh_p28token112233",
      }),
      generateTallyPrimeTdlAddOn({
        workspaceName: "Agarwal Hardware & Plywood",
        webhookUrl: "https://agarwal.tally.rapidshiftlabs.in/api/webhooks/tally",
        webhookToken: "tlwh_p28token112233",
        namespaceTag: "hq28",
      }),
    ];

    for (const tdl of variants) {
      expect(tdl).toContain('Header          : "User-Agent: TallyPrime-RSL-TDL/2.8"');
      // 1. Built-in Tally forms hooked for instant Ctrl+A / Alt+C sync
      expect(tdl).toContain("[#Form: Voucher]");
      expect(tdl).toContain("[#Form: Stock Item]");
      expect(tdl).toContain("[#Form: Ledger]");

      // 2. Maximum $$Number:$MasterID selection (prevents stopping at oldest bill #8)
      expect(tdl).toContain("RSLBestMasterNum");
      expect(tdl).toContain("##RSLCurMasterNum > ##RSLBestMasterNum");
      expect(tdl).toContain('JSONTag     : "inAlterMode"');

      // 3. Direct line items & bill allocations inside VoucherJsonReport
      expect(tdl).toContain('JSONTag     : "lineItems"');
      expect(tdl).toContain('JSONTag     : "billAllocations"');

      // 4. Bulk masters & multi-company openCompanies support
      expect(tdl).toContain("BulkCompanyMastersJson");
      expect(tdl).toContain('JSONTag     : "openCompanies"');
      expect(tdl).toContain("Parm Var    : SVCurrentCompany : String :");
      expect(tdl).toContain('$$Date:"1-Apr-2000"');

      // 5. Never use C-style != operator or duplicate Form Accept inside On: Form Accept
      expect(tdl).not.toContain("!=");
      expect(tdl).not.toContain("Add : On : Form Accept : Yes : Form Accept");

      // 6. Strict zero-colon procedural safety across every [Function: ...] line
      const fnStepLines = tdl
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => /^\d{2,3}\s*:/.test(l));
      expect(fnStepLines.length).toBeGreaterThan(40);
      for (const line of fnStepLines) {
        const strippedQuotes = line.replace(/"[^"]*"/g, '""');
        expect(strippedQuotes).not.toMatch(/\$\$[A-Za-z0-9_]+\s*:/);
        if (/^\d{2,3}\s*:\s*Set\s*:/i.test(strippedQuotes)) {
          const colonCount = (strippedQuotes.match(/:/g) || []).length;
          expect(colonCount).toBe(3);
        }
      }
    }

    const connectorMjs = generateStandaloneTallyConnectorMjs({
      serverUrl: "https://agarwal.tally.rapidshiftlabs.in",
      workspaceName: "Agarwal Hardware & Plywood",
    });
    expect(connectorMjs).toContain("companyAlterIds");
    expect(connectorMjs).toContain("openCompanies");
  });

  it("never overwrites Bill #8 when Bill #9 is created — across both .tdl v2.8 max-MasterID payloads and legacy .tdl <= v2.7 stale-GUID collisions, while supporting Seamless Sync-All Upgrade and genuine Alter mode", async () => {
    const { session } = createTestWorkspace("Bill8And9Shield", "Gupta Distributors");
    const wsId = session.workspace.id;
    staffGrantFreeAllToolsAccess({ workspaceId: wsId, durationDays: 30, staffId: "stf_p28_b89" });

    // Case A: .tdl v2.8 sequential Bill #8 then Bill #9 (distinct GUIDs & MasterIDs)
    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "Gupta Distributors FY26",
        guid: "d08-guid-bill-8",
        masterId: "108",
        voucherNumber: "8",
        voucherType: "Sales",
        partyName: "Shree Ganesh Hardware",
        amountRupees: 8400,
        voucherDate: "2026-11-03",
        inAlterMode: "No",
      },
    });

    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "Gupta Distributors FY26",
        guid: "d09-guid-bill-9",
        masterId: "109",
        voucherNumber: "9",
        voucherType: "Sales",
        partyName: "Shree Ganesh Hardware",
        amountRupees: 12600,
        voucherDate: "2026-11-03",
        inAlterMode: "No",
      },
    });

    let summary = getTallyWorkspaceSummary(wsId);
    expect(summary.vouchers.find((v) => v.voucherNumber === "8")?.amountPaise).toBe(840_000);
    expect(summary.vouchers.find((v) => v.voucherNumber === "9")?.amountPaise).toBe(1_260_000);

    // Case B: Legacy .tdl <= v2.7 stale-GUID collision!
    // Suppose another branch PC still has .tdl v2.7 loaded in Tally RAM:
    // Bill #18 is saved first with guid "legacy-guid-18" and masterId "218".
    // Then Bill #19 is created for the SAME party & date, and legacy .tdl v2.7's old Break-at-first-match loop
    // accidentally sends Bill #18's stale guid "legacy-guid-18" & masterId "218" while reporting voucherNumber "19"!
    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "Gupta Distributors Branch-2",
        guid: "legacy-guid-18",
        masterId: "218",
        voucherNumber: "18",
        voucherType: "Sales",
        partyName: "Omkar Traders",
        amountRupees: 5200,
        voucherDate: "2026-11-03",
      },
    });

    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "Gupta Distributors Branch-2",
        guid: "legacy-guid-18", // Stale GUID from Bill #18!
        masterId: "218", // Stale MasterID from Bill #18!
        voucherNumber: "19", // New Bill #19!
        voucherType: "Sales",
        partyName: "Omkar Traders",
        amountRupees: 9750,
        voucherDate: "2026-11-03",
      },
    });

    summary = getTallyWorkspaceSummary(wsId);
    const branch2CompId = summary.companies.find((c) => c.name === "Gupta Distributors Branch-2")!.id;
    const fy26CompId = summary.companies.find((c) => c.name === "Gupta Distributors FY26")!.id;
    const branch2Bill18 = summary.vouchers.find(
      (v) => v.companyId === branch2CompId && v.voucherNumber === "18"
    );
    const branch2Bill19BeforeSyncAll = summary.vouchers.find(
      (v) => v.companyId === branch2CompId && v.voucherNumber === "19"
    );
    expect(branch2Bill18).toBeDefined();
    expect(branch2Bill18!.amountPaise).toBe(520_000);
    expect(branch2Bill19BeforeSyncAll).toBeDefined();
    expect(branch2Bill19BeforeSyncAll!.amountPaise).toBe(975_000);
    expect(branch2Bill19BeforeSyncAll!.id).not.toBe(branch2Bill18!.id);
    // And Bill #19 did NOT inherit Bill #18's stale masterId "218"
    expect(branch2Bill19BeforeSyncAll!.masterId).toBeNull();

    // Now when the user later runs "Sync All Now" (syncBatchId present) with .tdl v2.8,
    // Bill #19 arrives with its true Tally GUID "real-guid-19" and masterId "219".
    // It must seamlessly upgrade the existing Bill #19 row in place WITHOUT creating a duplicate!
    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "Gupta Distributors Branch-2",
        syncBatchId: "batch_upgrade_219",
        guid: "real-guid-19",
        masterId: "219",
        voucherNumber: "19",
        voucherType: "Sales",
        partyName: "Omkar Traders",
        amountRupees: 9750,
        voucherDate: "2026-11-03",
      },
    });

    summary = getTallyWorkspaceSummary(wsId);
    const branch2Bill19Rows = summary.vouchers.filter(
      (v) => v.companyId === branch2CompId && v.voucherNumber === "19"
    );
    expect(branch2Bill19Rows).toHaveLength(1);
    expect(branch2Bill19Rows[0]!.id).toBe(branch2Bill19BeforeSyncAll!.id);
    expect(branch2Bill19Rows[0]!.masterId).toBe("219");
    expect(branch2Bill19Rows[0]!.guid).toContain("real-guid-19");

    // Case C: Genuine Tally Alter mode (inAlterMode: "Yes") on Bill #8 updates Bill #8 in place (even if renumbered #8 -> #8A or amount edited)
    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "Gupta Distributors FY26",
        guid: "d08-guid-bill-8",
        masterId: "108",
        voucherNumber: "8-REV",
        voucherType: "Sales",
        partyName: "Shree Ganesh Hardware",
        amountRupees: 8900,
        voucherDate: "2026-11-03",
        inAlterMode: "Yes",
      },
    });

    summary = getTallyWorkspaceSummary(wsId);
    expect(
      summary.vouchers.find((v) => v.companyId === fy26CompId && v.voucherNumber === "8")
    ).toBeUndefined();
    const updatedBill8 = summary.vouchers.find(
      (v) => v.companyId === fy26CompId && v.voucherNumber === "8-REV"
    );
    expect(updatedBill8).toBeDefined();
    expect(updatedBill8!.amountPaise).toBe(890_000);
  });

  it("directly imports StockItems, Godowns, Party Ledgers, Voucher Line Items, and Bill Allocations in real time via JSON webhook", async () => {
    const { session } = createTestWorkspace("DirectProductsP28", "Kabra Electricals");
    const wsId = session.workspace.id;
    staffGrantFreeAllToolsAccess({ workspaceId: wsId, durationDays: 30, staffId: "stf_p28_prod" });

    const ep = getOrCreateTallyWebhookEndpoint(wsId);

    // 1. User creates a new Stock Item in Tally Prime (Gateway -> Create -> Stock Item -> Ctrl+A or Alt+C inside a bill)
    const singleItemReq = new NextRequest(
      `https://kabra.tally.rapidshiftlabs.in/api/webhooks/tally?token=${encodeURIComponent(ep.webhookToken)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "TallyPrime-RSL-TDL/2.8",
        },
        body: JSON.stringify({
          mode: "masters",
          companyName: "Kabra Electricals",
          stockItem: {
            guid: "item-guid-havells-mcb",
            name: "Havells 32A DP MCB",
            parentGroup: "Switchgear",
            categoryName: "Havells",
            baseUnit: "PCS",
            hsnCode: "853620",
            gstRatePercent: "18%",
            openingQty: "50 PCS",
            openingValue: "-42,500.00",
            standardCost: "850.00/PCS",
            standardSellingPrice: "1,180.00/PCS",
            reorderLevel: "10 PCS",
          },
        }),
      }
    );
    const singleItemRes = await tallyWebhookPost(singleItemReq);
    expect(singleItemRes.status).toBe(200);
    const singleItemJson = (await singleItemRes.json()) as {
      ok: boolean;
      stockItemsUpserted: number;
    };
    expect(singleItemJson.ok).toBe(true);
    expect(singleItemJson.stockItemsUpserted).toBe(1);

    // 2. User creates a Party Ledger & Godowns via bulk masters sync ("Sync All Now")
    const bulkMastersReq = new NextRequest(
      `https://kabra.tally.rapidshiftlabs.in/api/webhooks/tally?token=${encodeURIComponent(ep.webhookToken)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "TallyPrime-RSL-TDL/2.8",
        },
        body: JSON.stringify({
          mode: "masters",
          companyName: "Kabra Electricals",
          godowns: [{ guid: "gd-bhiwandi", name: "Bhiwandi Central Godown", parentName: "Primary" }],
          partyLedgers: [
            {
              guid: "pty-siddhi",
              name: "Siddhi Infra Projects",
              parentGroup: "Sundry Debtors",
              gstin: "27AABCS1429B1Z5",
              phone: "9820456789",
              creditDays: "30 Days",
              creditLimit: "5,00,000.00",
              openingBalance: "-40,000.00",
            },
          ],
          stockItems: [
            {
              guid: "item-guid-polycab-wire",
              name: "Polycab 2.5 sqmm FR Coil",
              parentGroup: "Wires & Cables",
              baseUnit: "COIL",
              hsnCode: "8544",
              gstRatePercent: "18",
              openingQty: "30 COIL",
              openingValue: "-54,000.00",
              standardCost: "1800.00/COIL",
              standardSellingPrice: "2250.00/COIL",
              godownAllocations: [{ godownName: "Bhiwandi Central Godown", qty: "30 COIL" }],
            },
          ],
        }),
      }
    );
    const bulkMastersRes = await tallyWebhookPost(bulkMastersReq);
    expect(bulkMastersRes.status).toBe(200);
    const bulkMastersJson = (await bulkMastersRes.json()) as {
      ok: boolean;
      stockItemsUpserted: number;
      godownsUpserted: number;
      partiesUpserted: number;
    };
    expect(bulkMastersJson.stockItemsUpserted).toBe(1);
    expect(bulkMastersJson.godownsUpserted).toBe(1);
    expect(bulkMastersJson.partiesUpserted).toBe(1);

    // 3. Sales Invoice #105 arrives via .tdl v2.8 JSON WITH lineItems -> automatically deducts live stock!
    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "Kabra Electricals",
        guid: "vch-kabra-105",
        masterId: "505",
        voucherNumber: "105",
        voucherType: "Sales",
        partyName: "Siddhi Infra Projects",
        partyParentGroup: "Sundry Debtors",
        amountRupees: 16150,
        voucherDate: "2026-11-04",
        lineItems: [
          {
            stockItemName: "Havells 32A DP MCB",
            godownName: "Main Location",
            quantity: "10 PCS",
            unit: "PCS",
            rate: "1,180.00/PCS",
            amount: "11,800.00",
            hsnCode: "853620",
            gstRatePercent: "18%",
          },
          {
            stockItemName: "Polycab 2.5 sqmm FR Coil",
            godownName: "Bhiwandi Central Godown",
            quantity: "2 COIL",
            unit: "COIL",
            rate: "2,175.00/COIL",
            amount: "4,350.00",
          },
        ],
      },
    });

    // 4. Receipt Voucher arrives via .tdl v2.8 JSON with signed/formatted billAllocations ("-16,150.00") -> marks Invoice #105 PAID!
    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "Kabra Electricals",
        guid: "vch-kabra-rcpt-88",
        masterId: "506",
        voucherNumber: "RCPT-88",
        voucherType: "Receipt",
        partyName: "Siddhi Infra Projects",
        amountRupees: 16150,
        voucherDate: "2026-11-04",
        billAllocations: [
          {
            billName: "105",
            billType: "Agst Ref",
            amountRupees: "-16,150.00",
          },
        ],
      },
    });

    const invSummary = getWorkspaceInventorySummary(wsId);
    expect(invSummary.kpis.totalSkusCount).toBe(2);
    const mcb = invSummary.items.find((i) => i.name === "Havells 32A DP MCB")!;
    const coil = invSummary.items.find((i) => i.name === "Polycab 2.5 sqmm FR Coil")!;
    expect(mcb.closingQty).toBe(40); // 50 opening - 10 sold
    expect(mcb.sellingPricePaise).toBe(118_000);
    expect(mcb.costPricePaise).toBe(85_000);
    expect(coil.closingQty).toBe(28); // 30 opening - 2 sold

    const tallySummary = getTallyWorkspaceSummary(wsId);
    const inv105 = tallySummary.vouchers.find((v) => v.voucherNumber === "105")!;
    expect(inv105.paymentStatus).toBe("paid");
    expect(inv105.paidAmountPaise).toBe(1_615_000);

    const ledgerSummary = getWorkspacePartiesLedgerSummary(wsId);
    const siddhi = ledgerSummary.parties.find((p) => p.name === "Siddhi Infra Projects")!;
    expect(siddhi).toBeDefined();
    expect(siddhi.gstin).toBe("27AABCS1429B1Z5");
    // Opening ₹40,000 Dr + Sales ₹16,150 Dr - Receipt ₹16,150 Cr = ₹40,000 receivable remaining
    expect(siddhi.closingBalancePaise).toBe(4_000_000);
  });

  it("detects all open Tally companies (even 0-bill companies) on ping/reconcile/masters and isolates Inventory & Party Ledgers per selected company", async () => {
    const { session } = createTestWorkspace("MultiCompSuiteP28", "Vardhman Group");
    const wsId = session.workspace.id;
    staffGrantFreeAllToolsAccess({ workspaceId: wsId, durationDays: 30, staffId: "stf_p28_mc" });
    const ep = getOrCreateTallyWebhookEndpoint(wsId);

    // 1. Connection Test (mode=ping) reports 3 open companies in Tally — including "Vardhman Dormant Holdings" with 0 bills
    const pingReq = new NextRequest(
      `https://vardhman.tally.rapidshiftlabs.in/api/webhooks/tally?mode=ping&token=${encodeURIComponent(ep.webhookToken)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "TallyPrime-RSL-TDL/2.8",
        },
        body: JSON.stringify({
          companyName: "Vardhman Textiles Mumbai",
          openCompanies: [
            { name: "Vardhman Textiles Mumbai", guid: "comp-mum-01" },
            { name: "Vardhman Yarns Surat", guid: "comp-sur-02" },
            { name: "Vardhman Dormant Holdings", guid: "comp-dor-03" },
          ],
        }),
      }
    );
    const pingRes = await tallyWebhookPost(pingReq);
    expect(pingRes.status).toBe(200);
    const pingJson = (await pingRes.json()) as {
      ok: boolean;
      openCompaniesRegistered: number;
    };
    expect(pingJson.ok).toBe(true);
    expect(pingJson.openCompaniesRegistered).toBe(3);

    // Also verify reconcileTallyCompanySnapshot registers a newly opened 0-bill company immediately
    reconcileTallyCompanySnapshot({
      workspaceId: wsId,
      companyName: "Vardhman Exports Ahmedabad",
      activeCanonicalGuids: [],
      actorType: "webhook",
      actorId: "tdl",
      hasExplicitDateSpan: true,
    });

    const summaryAll = getTallyWorkspaceSummary(wsId);
    expect(summaryAll.companies.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        "Vardhman Textiles Mumbai",
        "Vardhman Yarns Surat",
        "Vardhman Dormant Holdings",
        "Vardhman Exports Ahmedabad",
      ])
    );

    const mumbaiComp = summaryAll.companies.find((c) => c.name === "Vardhman Textiles Mumbai")!;
    const suratComp = summaryAll.companies.find((c) => c.name === "Vardhman Yarns Surat")!;
    const dormantComp = summaryAll.companies.find((c) => c.name === "Vardhman Dormant Holdings")!;

    // 2. Sync distinct products & bills into Mumbai vs Surat
    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        mode: "masters",
        companyName: "Vardhman Textiles Mumbai",
        stockItems: [
          {
            guid: "mum-cotton-roll",
            name: "Mumbai Cotton Roll",
            baseUnit: "MTR",
            openingQty: "200 MTR",
            standardCost: "150/MTR",
            standardSellingPrice: "220/MTR",
          },
        ],
      },
    });
    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "Vardhman Textiles Mumbai",
        guid: "mum-inv-1",
        masterId: "1",
        voucherNumber: "MUM/01",
        voucherType: "Sales",
        partyName: "Mumbai Garments Co",
        amountRupees: 44000,
        voucherDate: "2026-11-04",
      },
    });

    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        mode: "masters",
        companyName: "Vardhman Yarns Surat",
        stockItems: [
          {
            guid: "sur-poly-cone",
            name: "Surat Polyester Cone",
            baseUnit: "KG",
            openingQty: "500 KG",
            standardCost: "90/KG",
            standardSellingPrice: "130/KG",
          },
        ],
      },
    });
    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "Vardhman Yarns Surat",
        guid: "sur-inv-1",
        masterId: "1", // Same MasterID "1" in Surat must NEVER collide with Mumbai's MasterID "1"
        voucherNumber: "SUR/01",
        voucherType: "Sales",
        partyName: "Surat Looms Pvt Ltd",
        amountRupees: 65000,
        voucherDate: "2026-11-04",
      },
    });

    // 3. Verify company-scoped Inventory & Party Ledger queries return isolated data + full company list for switcher
    const invMumbai = getWorkspaceInventorySummary(wsId, mumbaiComp.id);
    expect(invMumbai.companies.length).toBeGreaterThanOrEqual(4);
    expect(invMumbai.kpis.totalSkusCount).toBe(1);
    expect(invMumbai.items[0]?.name).toBe("Mumbai Cotton Roll");

    const invSurat = getWorkspaceInventorySummary(wsId, suratComp.id);
    expect(invSurat.kpis.totalSkusCount).toBe(1);
    expect(invSurat.items[0]?.name).toBe("Surat Polyester Cone");

    const invDormant = getWorkspaceInventorySummary(wsId, dormantComp.id);
    expect(invDormant.kpis.totalSkusCount).toBe(0);

    const partiesMumbai = getWorkspacePartiesLedgerSummary(wsId, mumbaiComp.id);
    expect(partiesMumbai.parties.map((p) => p.name)).toEqual(["Mumbai Garments Co"]);
    expect(partiesMumbai.kpis.totalReceivablePaise).toBe(4_400_000);

    const partiesSurat = getWorkspacePartiesLedgerSummary(wsId, suratComp.id);
    expect(partiesSurat.parties.map((p) => p.name)).toEqual(["Surat Looms Pvt Ltd"]);
    expect(partiesSurat.kpis.totalReceivablePaise).toBe(6_500_000);

    // Also test registerTallyCompaniesForWorkspace direct deduplication
    const regDedup = registerTallyCompaniesForWorkspace({
      workspaceId: wsId,
      companies: ["Vardhman Textiles Mumbai", "Vardhman Textiles Mumbai"],
    });
    expect(regDedup.registeredCompanies).toHaveLength(1);
  });

  it("includes comprehensive step-by-step Tally Prime F11/F12/F3 setup instructions in docs & studio while maintaining fluid full-width Tally Suite pages", () => {
    const repoRoot = path.resolve(__dirname, "../../../..");
    const guideDoc = fs.readFileSync(
      path.join(repoRoot, "content/en/tally-sync-and-import.md"),
      "utf8"
    );

    expect(guideDoc).toContain("v2.8");
    expect(guideDoc).toContain("F11");
    expect(guideDoc).toContain("F12");
    expect(guideDoc).toContain("Enable Bill-wise entry");
    expect(guideDoc).toContain("Maintain Inventory");
    expect(guideDoc).toContain("Provide Standard Buying and Selling Rates");
    expect(guideDoc).toContain("9000");

    // Verify editorial rule: zero informal exclamation marks in prose (only markdown images ![...] or GitHub alerts > [!NOTE])
    const linesWithoutAlertsAndImages = guideDoc
      .split(/\r?\n/)
      .map((line) => line.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/^>\s*\[![A-Z]+\]/g, ""));
    for (const line of linesWithoutAlertsAndImages) {
      expect(line).not.toContain("!");
    }

    // Verify fluid layout rule across all Tally Suite pages (no outer max-w-7xl / max-w-6xl / max-w-5xl / max-w-4xl container caps)
    const suitePages = [
      "apps/web/src/app/(dashboard)/tally/page.tsx",
      "apps/web/src/app/(dashboard)/tally/parties/page.tsx",
      "apps/web/src/app/(dashboard)/inventory/page.tsx",
      "apps/web/src/components/tally-suite-nav.tsx",
    ];
    for (const relPath of suitePages) {
      const content = fs.readFileSync(path.join(repoRoot, relPath), "utf8");
      expect(content).not.toMatch(/\bmax-w-[4567]xl\b/);
    }
  });
});
