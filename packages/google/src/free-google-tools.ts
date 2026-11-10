import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { listWorkspaceConnections, refreshGoogleConnectionIfNeeded } from "@rsl/connections";
import { fetchWithRetry, newId, RslError } from "@rsl/core";
import { controlSchema, tenantDataSchema } from "@rsl/database";
import { defineAction } from "@rsl/logging";
import { controlDb, isWorkspaceSandboxIntegrationMode, tenantDataDb } from "@rsl/tenancy";

/* ============================================================================
 * 1. Live Google Sheets Multi-Tab Export for Chartered Accountants (CAs)
 * ============================================================================ */

function formatDateYmd(ts: number | null | undefined): string {
  if (!ts) return "";
  return new Date(ts).toISOString().slice(0, 10);
}

function rupeesNumber(paise: number | null | undefined): number {
  return Number(((paise ?? 0) / 100).toFixed(2));
}

export interface CaGoogleSheetSyncResult {
  ok: boolean;
  mode: "live" | "sandbox";
  isSandboxData?: boolean;
  spreadsheetId: string;
  spreadsheetUrl: string;
  salesRows: number;
  purchaseRows: number;
  partyRows: number;
  gstInvoiceRows: number;
}

export const syncWorkspaceCaGoogleSheet = defineAction({
  key: "tally.ca_sheet.synced",
  permission: "tally:view",
  input: z.object({
    companyId: z.string().optional(),
  }),
  summarize: () => "Synced live Tally & GST books to Google Sheets for Chartered Accountant",
  handler: async (ctx, input): Promise<CaGoogleSheetSyncResult> => {
    const { connections } = listWorkspaceConnections(ctx.workspaceId);
    const sheetConn =
      connections.find((c) => c.channelKind === "google_sheets" && c.status !== "disconnected") ??
      connections.find((c) => c.channelKind === "google_drive" && c.status !== "disconnected");

    if (!sheetConn) {
      throw new RslError(
        "RSL-VAL-1001",
        "Connect Google Sheets (or Google Drive) in 1 click first so RapidShift Labs can create and update your CA Google Sheet."
      );
    }

    const accessToken = await refreshGoogleConnectionIfNeeded(ctx.workspaceId, sheetConn.id);
    if (!accessToken) {
      throw new RslError(
        "RSL-VAL-1001",
        "Google session expired. Click 'Connect Google Sheets' to refresh authorization."
      );
    }

    const ws = controlDb()
      .select()
      .from(controlSchema.workspaces)
      .where(eq(controlSchema.workspaces.id, ctx.workspaceId))
      .get();

    const db = tenantDataDb(ctx);
    const vouchers = db
      .select()
      .from(tenantDataSchema.tallyVouchers)
      .orderBy(desc(tenantDataSchema.tallyVouchers.voucherDate))
      .limit(1000)
      .all()
      .filter((v) => !input.companyId || v.companyId === input.companyId);

    const parties = db
      .select()
      .from(tenantDataSchema.tallyParties)
      .orderBy(desc(tenantDataSchema.tallyParties.closingBalancePaise))
      .limit(1000)
      .all()
      .filter((p) => !input.companyId || p.companyId === input.companyId);

    const partyByName = new Map(parties.map((p) => [p.name.trim().toLowerCase(), p]));

    const gstInvoices = controlDb()
      .select()
      .from(controlSchema.invoices)
      .where(eq(controlSchema.invoices.workspaceId, ctx.workspaceId))
      .orderBy(desc(controlSchema.invoices.issuedAt))
      .limit(500)
      .all();

    const salesVouchers = vouchers.filter(
      (v) => v.voucherType === "Sales" || v.voucherType === "CreditNote"
    );
    const purchaseVouchers = vouchers.filter(
      (v) => v.voucherType === "Purchase" || v.voucherType === "DebitNote"
    );

    const salesSheetValues: Array<Array<string | number>> = [
      [
        "Voucher No",
        "Voucher Type",
        "Voucher Date",
        "Customer / Party Name",
        "Party GSTIN",
        "State",
        "Bill Total (INR)",
        "Paid (INR)",
        "Pending Balance (INR)",
        "Payment Status",
      ],
      ...salesVouchers.map((v) => {
        const pt = partyByName.get(v.partyName.trim().toLowerCase());
        const pending = Math.max(0, v.amountPaise - v.paidAmountPaise);
        return [
          v.voucherNumber,
          v.voucherType,
          formatDateYmd(v.voucherDate),
          v.partyName,
          pt?.gstin || "URP",
          pt?.stateName || "",
          rupeesNumber(v.amountPaise),
          rupeesNumber(v.paidAmountPaise),
          rupeesNumber(pending),
          v.paymentStatus.toUpperCase(),
        ];
      }),
    ];

    const purchaseSheetValues: Array<Array<string | number>> = [
      [
        "Voucher No",
        "Voucher Type",
        "Bill Date",
        "Supplier / Vendor Name",
        "Supplier GSTIN",
        "Bill Total (INR)",
        "Paid (INR)",
        "Pending Payable (INR)",
        "Status",
      ],
      ...purchaseVouchers.map((v) => {
        const pt = partyByName.get(v.partyName.trim().toLowerCase());
        const pending = Math.max(0, v.amountPaise - v.paidAmountPaise);
        return [
          v.voucherNumber,
          v.voucherType,
          formatDateYmd(v.voucherDate),
          v.partyName,
          pt?.gstin || "",
          rupeesNumber(v.amountPaise),
          rupeesNumber(v.paidAmountPaise),
          rupeesNumber(pending),
          v.paymentStatus.toUpperCase(),
        ];
      }),
    ];

    const agingSheetValues: Array<Array<string | number>> = [
      [
        "Party Name",
        "Group",
        "GSTIN",
        "Phone",
        "Total Invoiced (INR)",
        "Total Received (INR)",
        "Closing Balance (INR)",
        "Unpaid Bills",
        "Overdue Bills",
      ],
      ...parties.map((p) => [
        p.name,
        p.parentGroup,
        p.gstin || "",
        p.phoneE164 || "",
        rupeesNumber(p.totalInvoicedPaise),
        rupeesNumber(p.totalReceivedPaise),
        rupeesNumber(p.closingBalancePaise),
        p.unpaidBillsCount,
        p.overdueBillsCount,
      ]),
    ];

    const gstInvoicesValues: Array<Array<string | number>> = [
      [
        "Document No",
        "Type",
        "Date",
        "Description",
        "HSN/SAC",
        "Taxable (INR)",
        "CGST (INR)",
        "SGST (INR)",
        "IGST (INR)",
        "Total (INR)",
      ],
      ...gstInvoices.map((inv) => [
        inv.invoiceNumber,
        inv.docType,
        formatDateYmd(inv.issuedAt),
        inv.description,
        inv.hsnSac,
        rupeesNumber(inv.subtotalPaise),
        rupeesNumber(inv.cgstPaise),
        rupeesNumber(inv.sgstPaise),
        rupeesNumber(inv.igstPaise),
        rupeesNumber(inv.totalPaise),
      ]),
    ];

    const isSandbox = isWorkspaceSandboxIntegrationMode(ctx.workspaceId, accessToken);
    let spreadsheetId = sheetConn.metadata.caSpreadsheetId || "";
    let spreadsheetUrl = sheetConn.metadata.caSpreadsheetUrl || "";

    if (isSandbox) {
      spreadsheetId = spreadsheetId || `sb_sheet_${newId("ast", ctx.workspaceId)}`;
      spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    } else {
      const sheetTitle = `RSL CA Pack - ${ws?.name || "Business"}`;
      if (!spreadsheetId) {
        const createResp = await fetchWithRetry("https://sheets.googleapis.com/v4/spreadsheets", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            properties: { title: sheetTitle },
            sheets: [
              { properties: { title: "Sales Register" } },
              { properties: { title: "Purchase Register" } },
              { properties: { title: "Party Aging" } },
              { properties: { title: "RSL GST Invoices" } },
            ],
          }),
          timeoutMs: 12_000,
          maxRetries: 2,
        });

        if (!createResp.ok) {
          const errTxt = await createResp.text().catch(() => "");
          throw new RslError(
            "RSL-VAL-1001",
            `Google Sheets API returned HTTP ${createResp.status}. Ensure 'Google Sheets API' is enabled in Google Cloud Console or click 'Connect Google Sheets' to grant spreadsheet access. ${errTxt.slice(0, 160)}`
          );
        }

        const created = (await createResp.json()) as {
          spreadsheetId: string;
          spreadsheetUrl?: string;
        };
        spreadsheetId = created.spreadsheetId;
        spreadsheetUrl =
          created.spreadsheetUrl ||
          `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}/edit`;
      }

      const batchResp = await fetchWithRetry(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            valueInputOption: "USER_ENTERED",
            data: [
              { range: "'Sales Register'!A1", values: salesSheetValues },
              { range: "'Purchase Register'!A1", values: purchaseSheetValues },
              { range: "'Party Aging'!A1", values: agingSheetValues },
              { range: "'RSL GST Invoices'!A1", values: gstInvoicesValues },
            ],
          }),
          timeoutMs: 12_000,
          maxRetries: 2,
        }
      );

      if (!batchResp.ok) {
        const errTxt = await batchResp.text().catch(() => "");
        throw new RslError(
          "RSL-VAL-1001",
          `Updating CA Google Sheet failed (HTTP ${batchResp.status}): ${errTxt.slice(0, 160)}`
        );
      }
    }

    // Persist spreadsheet link onto the connection metadata so future clicks update in-place
    const rawRow = controlDb()
      .select()
      .from(controlSchema.connections)
      .where(
        and(
          eq(controlSchema.connections.id, sheetConn.id),
          eq(controlSchema.connections.workspaceId, ctx.workspaceId)
        )
      )
      .get();

    if (rawRow) {
      let parsedMeta: Record<string, unknown> = {};
      try {
        parsedMeta = JSON.parse(rawRow.metadataJson || "{}");
      } catch {
        parsedMeta = {};
      }
      parsedMeta.caSpreadsheetId = spreadsheetId;
      parsedMeta.caSpreadsheetUrl = spreadsheetUrl;
      parsedMeta.lastCaSheetSyncedAt = Date.now();
      controlDb()
        .update(controlSchema.connections)
        .set({
          metadataJson: JSON.stringify(parsedMeta),
          updatedAt: Date.now(),
        })
        .where(eq(controlSchema.connections.id, rawRow.id))
        .run();
    }

    return {
      ok: true,
      mode: isSandbox ? "sandbox" : "live",
      isSandboxData: isSandbox,
      spreadsheetId,
      spreadsheetUrl,
      salesRows: salesVouchers.length,
      purchaseRows: purchaseVouchers.length,
      partyRows: parties.length,
      gstInvoiceRows: gstInvoices.length,
    };
  },
});

/* ============================================================================
 * 2. Free Organic Google Search Console Insights (`webmasters.readonly`)
 * ============================================================================ */

export interface SearchConsoleQueryMetric {
  query: string;
  clicks: number;
  impressions: number;
  ctrPercent: number;
  position: number;
}

export interface SearchConsoleInsightsSummary {
  connected: boolean;
  isSandboxData?: boolean;
  siteUrl: string | null;
  availableSites: string[];
  totalClicks28d: number;
  totalImpressions28d: number;
  avgCtrPercent: number;
  avgPosition: number;
  topQueries: SearchConsoleQueryMetric[];
  statusMessage?: string;
}

export async function fetchWorkspaceGoogleSearchConsoleInsights(
  workspaceId: string
): Promise<SearchConsoleInsightsSummary> {
  const { connections } = listWorkspaceConnections(workspaceId);
  const gscConn = connections.find(
    (c) => c.channelKind === "google_search_console" && c.status !== "disconnected"
  );

  if (!gscConn) {
    return {
      connected: false,
      siteUrl: null,
      availableSites: [],
      totalClicks28d: 0,
      totalImpressions28d: 0,
      avgCtrPercent: 0,
      avgPosition: 0,
      topQueries: [],
    };
  }

  const accessToken = await refreshGoogleConnectionIfNeeded(workspaceId, gscConn.id);
  if (!accessToken) {
    return {
      connected: true,
      siteUrl: gscConn.metadata.searchConsoleSiteUrl ?? null,
      availableSites: gscConn.metadata.availableSearchConsoleSites ?? [],
      totalClicks28d: 0,
      totalImpressions28d: 0,
      avgCtrPercent: 0,
      avgPosition: 0,
      topQueries: [],
      statusMessage: "Google Search Console session expired - click Reconnect.",
    };
  }

  if (isWorkspaceSandboxIntegrationMode(workspaceId, accessToken)) {
    return {
      connected: true,
      isSandboxData: true,
      siteUrl: gscConn.metadata.searchConsoleSiteUrl || null,
      availableSites: gscConn.metadata.availableSearchConsoleSites ?? [],
      totalClicks28d: 0,
      totalImpressions28d: 0,
      avgCtrPercent: 0,
      avgPosition: 0,
      topQueries: [],
      statusMessage:
        "Sandbox integration mode active - connect a live Google Search Console property in production mode to view verified organic search metrics.",
    };
  }

  let siteUrl = gscConn.metadata.searchConsoleSiteUrl || "";
  const availableSites = gscConn.metadata.availableSearchConsoleSites ?? [];

  if (!siteUrl) {
    try {
      const sitesResp = await fetchWithRetry("https://www.googleapis.com/webmasters/v3/sites", {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeoutMs: 6000,
        maxRetries: 2,
      });
      if (sitesResp.ok) {
        const j = (await sitesResp.json()) as { siteEntry?: Array<{ siteUrl?: string }> };
        const list = (j.siteEntry ?? []).map((x) => (x.siteUrl || "").trim()).filter(Boolean);
        if (list[0]) siteUrl = list[0];
      }
    } catch {
      // ignore
    }
  }

  if (!siteUrl) {
    return {
      connected: true,
      siteUrl: null,
      availableSites,
      totalClicks28d: 0,
      totalImpressions28d: 0,
      avgCtrPercent: 0,
      avgPosition: 0,
      topQueries: [],
      statusMessage:
        "No verified website property found in this Google Search Console account yet.",
    };
  }

  const endDate = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  try {
    const queryResp = await fetchWithRetry(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate,
          endDate,
          dimensions: ["query"],
          rowLimit: 10,
        }),
        timeoutMs: 8000,
        maxRetries: 2,
      }
    );

    if (!queryResp.ok) {
      return {
        connected: true,
        siteUrl,
        availableSites,
        totalClicks28d: 0,
        totalImpressions28d: 0,
        avgCtrPercent: 0,
        avgPosition: 0,
        topQueries: [],
        statusMessage: `Search Console API HTTP ${queryResp.status} (verify Search Console API is enabled in Google Cloud Console).`,
      };
    }

    const data = (await queryResp.json()) as {
      rows?: Array<{
        keys?: string[];
        clicks?: number;
        impressions?: number;
        ctr?: number;
        position?: number;
      }>;
    };

    const rows = data.rows ?? [];
    const topQueries: SearchConsoleQueryMetric[] = rows.map((r) => ({
      query: r.keys?.[0] || "(not provided)",
      clicks: Math.round(r.clicks ?? 0),
      impressions: Math.round(r.impressions ?? 0),
      ctrPercent: Number(((r.ctr ?? 0) * 100).toFixed(2)),
      position: Number((r.position ?? 0).toFixed(1)),
    }));

    const totalClicks28d = topQueries.reduce((acc, q) => acc + q.clicks, 0);
    const totalImpressions28d = topQueries.reduce((acc, q) => acc + q.impressions, 0);
    const avgCtrPercent =
      totalImpressions28d > 0
        ? Number(((totalClicks28d / totalImpressions28d) * 100).toFixed(2))
        : 0;
    const avgPosition =
      topQueries.length > 0
        ? Number(
            (
              topQueries.reduce((acc, q) => acc + q.position, 0) / topQueries.length
            ).toFixed(1)
          )
        : 0;

    return {
      connected: true,
      siteUrl,
      availableSites,
      totalClicks28d,
      totalImpressions28d,
      avgCtrPercent,
      avgPosition,
      topQueries,
    };
  } catch (err) {
    return {
      connected: true,
      siteUrl,
      availableSites,
      totalClicks28d: 0,
      totalImpressions28d: 0,
      avgCtrPercent: 0,
      avgPosition: 0,
      topQueries: [],
      statusMessage: err instanceof Error ? err.message : "Failed querying Search Console.",
    };
  }
}
