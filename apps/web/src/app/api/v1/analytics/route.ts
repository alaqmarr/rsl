import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceAnalytics, type AnalyticsDateRange } from "@rsl/analytics";
import { authenticatePublicApiKey } from "@rsl/api-keys";
import { RslError } from "@rsl/core";

const ALLOWED_RANGES = new Set<AnalyticsDateRange>(["7d", "30d", "90d", "365d", "all"]);

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticatePublicApiKey({
      authorizationHeader: req.headers.get("authorization"),
      requiredScope: "analytics:read",
      clientIp: req.headers.get("x-forwarded-for"),
    });

    const rawRange = (req.nextUrl.searchParams.get("range") || "30d") as AnalyticsDateRange;
    const range: AnalyticsDateRange = ALLOWED_RANGES.has(rawRange) ? rawRange : "30d";
    const report = getWorkspaceAnalytics(auth.workspaceId, range);

    return NextResponse.json({
      ok: true,
      workspaceId: auth.workspaceId,
      range: report.range,
      daysCount: report.daysCount,
      kpis: report.kpis,
      receivablesAging: report.receivablesAging,
      channelBreakdown: report.channelBreakdown,
      dailySeries: report.dailySeries,
    });
  } catch (err) {
    const mapped = err instanceof RslError ? err : new RslError("RSL-SYS-1001");
    return NextResponse.json(
      { ok: false, error: mapped.toPublicObject("api") },
      { status: mapped.httpStatus }
    );
  }
}
