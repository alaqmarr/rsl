import { NextRequest, NextResponse } from "next/server";
import { exportWorkspaceAnalyticsCsv, type AnalyticsDateRange } from "@rsl/analytics";
import { exportWorkspaceGstInvoicesCsv } from "@rsl/billing";
import {
  exportContactsAsCsv,
  exportPortableWorkspaceJson,
  readLocalBackupBundleBytes,
} from "@rsl/backup";
import { escapeCsvCellSafe, resolveEndpointsFromHeaders, RslError } from "@rsl/core";
import { exportActionLogsAsCsv } from "@rsl/logging";
import { authorizeAny, type Permission } from "@rsl/rbac";
import {
  buildWindowsInstallerFilename,
  buildWorkspaceTdlFilename,
  exportTallyInventoryAsCsv,
  exportTallyInventoryAsXml,
  exportTallyVouchersAsCsv,
  exportTallyVouchersAsXml,
  generateStandaloneTallyConnectorMjs,
  generateTallyPrimeTdlAddOn,
  generateWindowsTallyInstallerBat,
  getOrCreateTallyWebhookEndpoint,
  getTallyCompanyRoutingConfig,
  getWorkspacePartiesLedgerSummary,
} from "@rsl/tally";
import { getOptionalWebSession } from "@/lib/session";

const EXPORT_PERMISSION_MAP: Record<string, Permission[]> = {
  "tally-tdl": ["tally:sync.manage"],
  "tally-connector": ["tally:sync.manage"],
  "tally-installer": ["tally:sync.manage"],
  "tally-xml": ["tally:view"],
  "tally-csv": ["tally:view"],
  "party-ledgers-csv": ["tally:view"],
  "inventory-csv": ["tally:view"],
  "inventory-xml": ["tally:view"],
  "contacts-csv": ["inbox:view", "backup:manage"],
  "portable-json": ["backup:manage"],
  "analytics-csv": ["tally:view", "ads:view", "pixel:view", "billing:view"],
  "gst-invoices-csv": ["billing:view", "billing:manage"],
  "activity-csv": ["logs:export"],
  "backup-bundle": ["backup:view", "backup:manage"],
};

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ kind: string }> }
) {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return NextResponse.json({ ok: false, error: "Cross-site export downloads are forbidden." }, { status: 403 });
  }

  const session = await getOptionalWebSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }

  const { kind } = await context.params;
  const requiredPerms = EXPORT_PERMISSION_MAP[kind];
  if (!requiredPerms) {
    return NextResponse.json({ ok: false, error: "Unknown export format" }, { status: 404 });
  }

  try {
    authorizeAny(session.ctx, requiredPerms);
  } catch (err) {
    const msg = err instanceof RslError ? err.message : "Permission denied";
    return NextResponse.json({ ok: false, error: msg }, { status: 403 });
  }

  const wsId = session.workspace.id;
  const preferLocal = req.nextUrl.searchParams.get("target") === "local";
  const isolated = req.nextUrl.searchParams.get("isolated") === "1";
  const endpoints = resolveEndpointsFromHeaders(req.headers, {
    workspaceSlug: session.workspace.slug,
    preferLocal,
  });

  if (kind === "tally-tdl") {
    const ep = getOrCreateTallyWebhookEndpoint(wsId);
    const routing = getTallyCompanyRoutingConfig(wsId);
    const webhookUrl = preferLocal
      ? endpoints.tallyWebhookUrl
      : `${endpoints.tallyCloudBaseUrl}/api/webhooks/tally`;
    const tdl = generateTallyPrimeTdlAddOn({
      workspaceName: session.workspace.name,
      webhookUrl,
      webhookToken: ep.webhookToken,
      allowedCompanyNames: routing.mode === "selected" ? routing.allowedCompanyNames : undefined,
      namespaceTag: isolated ? session.workspace.slug : undefined,
    });
    const fileLabel = buildWorkspaceTdlFilename(session.workspace.name, {
      isolatedSlug: isolated ? session.workspace.slug : undefined,
    });
    return new NextResponse(tdl, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileLabel}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (kind === "tally-connector") {
    const serverUrl = preferLocal
      ? endpoints.effectiveTallyBaseUrl
      : endpoints.tallyCloudBaseUrl;
    const script = generateStandaloneTallyConnectorMjs({
      serverUrl,
      workspaceName: session.workspace.name,
    });
    return new NextResponse(script, {
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        "Content-Disposition": `attachment; filename="rsl-tally-connector.mjs"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (kind === "tally-installer") {
    const serverUrl = preferLocal
      ? endpoints.effectiveTallyBaseUrl
      : endpoints.tallyCloudBaseUrl;
    const ep = getOrCreateTallyWebhookEndpoint(wsId);
    const pairingCode = req.nextUrl.searchParams.get("code") || undefined;
    const bat = generateWindowsTallyInstallerBat({
      serverUrl,
      workspaceName: session.workspace.name,
      webhookToken: ep.webhookToken,
      pairingCode,
    });
    const installerFilename = buildWindowsInstallerFilename(session.workspace.name);
    return new NextResponse(bat, {
      headers: {
        "Content-Type": "application/x-bat; charset=utf-8",
        "Content-Disposition": `attachment; filename="${installerFilename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (kind === "party-ledgers-csv") {
    const summary = getWorkspacePartiesLedgerSummary(wsId);
    const header = [
      "Party / Ledger Name",
      "Group",
      "Company",
      "GSTIN",
      "PAN",
      "Phone",
      "Email",
      "State",
      "Credit Days",
      "Credit Limit (INR)",
      "Opening Balance (INR)",
      "Total Invoiced (INR)",
      "Total Paid/Received (INR)",
      "Closing Balance (INR)",
      "Dr/Cr",
      "Unpaid Bills",
      "Overdue Bills",
      "Max Days Overdue",
    ];
    const lines = [header.join(",")];
    for (const p of summary.parties) {
      const closingRupees = (Math.abs(p.closingBalancePaise) / 100).toFixed(2);
      const drCr =
        p.closingBalancePaise > 0 ? "Dr" : p.closingBalancePaise < 0 ? "Cr" : "Nil";
      lines.push(
        [
          escapeCsvCellSafe(p.name),
          escapeCsvCellSafe(p.parentGroup),
          escapeCsvCellSafe(p.companyName),
          escapeCsvCellSafe(p.gstin ?? ""),
          escapeCsvCellSafe(p.pan ?? ""),
          escapeCsvCellSafe(p.phoneE164 ?? ""),
          escapeCsvCellSafe(p.email ?? ""),
          escapeCsvCellSafe(p.stateName ?? ""),
          String(p.creditDays),
          (p.creditLimitPaise / 100).toFixed(2),
          (Math.abs(p.openingBalancePaise) / 100).toFixed(2),
          (p.totalInvoicedPaise / 100).toFixed(2),
          (p.totalReceivedPaise / 100).toFixed(2),
          closingRupees,
          drCr,
          String(p.unpaidBillsCount),
          String(p.overdueBillsCount),
          String(p.maxOpenBillAgeDays),
        ].join(",")
      );
    }
    return new NextResponse(`\uFEFF${lines.join("\n")}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${session.workspace.slug}-client-supplier-ledgers.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (kind === "tally-xml") {
    const xml = exportTallyVouchersAsXml(wsId);
    return new NextResponse(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${session.workspace.slug}-tally-vouchers.xml"`,
      },
    });
  }

  if (kind === "tally-csv") {
    const csv = exportTallyVouchersAsCsv(wsId);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${session.workspace.slug}-tally-bills.csv"`,
      },
    });
  }

  if (kind === "inventory-csv") {
    const csv = exportTallyInventoryAsCsv(wsId);
    return new NextResponse(`\uFEFF${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${session.workspace.slug}-tally-inventory.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (kind === "inventory-xml") {
    const xml = exportTallyInventoryAsXml(wsId);
    return new NextResponse(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${session.workspace.slug}-tally-stock-items.xml"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (kind === "contacts-csv") {
    const csv = exportContactsAsCsv(wsId);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${session.workspace.slug}-contacts.csv"`,
      },
    });
  }

  if (kind === "portable-json") {
    const json = exportPortableWorkspaceJson(wsId);
    return new NextResponse(json, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${session.workspace.slug}-portable-export.json"`,
      },
    });
  }

  if (kind === "analytics-csv") {
    const range = (req.nextUrl.searchParams.get("range") || "30d") as AnalyticsDateRange;
    const csv = exportWorkspaceAnalyticsCsv(wsId, range);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${session.workspace.slug}-analytics-${range}.csv"`,
      },
    });
  }

  if (kind === "gst-invoices-csv") {
    const csv = exportWorkspaceGstInvoicesCsv(wsId);
    return new NextResponse(`\uFEFF${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${session.workspace.slug}-gstr1-invoices.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (kind === "activity-csv") {
    const csv = exportActionLogsAsCsv(wsId);
    return new NextResponse(`\uFEFF${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${session.workspace.slug}-activity-history.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (kind === "backup-bundle") {
    const backupId = req.nextUrl.searchParams.get("backupId") || "";
    const bytes = readLocalBackupBundleBytes(wsId, backupId);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${backupId}.rslbackup"`,
      },
    });
  }

  return NextResponse.json({ ok: false, error: "Unknown export format" }, { status: 404 });
}
