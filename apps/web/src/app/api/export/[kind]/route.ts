import { NextRequest, NextResponse } from "next/server";
import { exportWorkspaceAnalyticsCsv, type AnalyticsDateRange } from "@rsl/analytics";
import {
  exportContactsAsCsv,
  exportPortableWorkspaceJson,
  readLocalBackupBundleBytes,
} from "@rsl/backup";
import { resolveEndpointsFromHeaders, RslError } from "@rsl/core";
import { exportActionLogsAsCsv } from "@rsl/logging";
import { authorizeAny, type Permission } from "@rsl/rbac";
import {
  exportTallyVouchersAsCsv,
  exportTallyVouchersAsXml,
  generateStandaloneTallyConnectorMjs,
  generateTallyPrimeTdlAddOn,
  getOrCreateTallyWebhookEndpoint,
  getTallyCompanyRoutingConfig,
} from "@rsl/tally";
import { getOptionalWebSession } from "@/lib/session";

const EXPORT_PERMISSION_MAP: Record<string, Permission[]> = {
  "tally-tdl": ["tally:sync.manage"],
  "tally-connector": ["tally:sync.manage"],
  "tally-xml": ["tally:view"],
  "tally-csv": ["tally:view"],
  "contacts-csv": ["inbox:view", "backup:manage"],
  "portable-json": ["backup:manage"],
  "analytics-csv": ["tally:view", "ads:view", "pixel:view", "billing:view"],
  "activity-csv": ["logs:export"],
  "backup-bundle": ["backup:view", "backup:manage"],
};

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ kind: string }> }
) {
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
    const fileLabel = isolated
      ? `rsl-tally-${session.workspace.slug}.tdl`
      : "rsl-tally-whatsapp.tdl";
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
