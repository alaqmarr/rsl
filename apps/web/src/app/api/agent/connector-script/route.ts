import { NextRequest, NextResponse } from "next/server";
import { resolveEndpointsFromHeaders } from "@rsl/core";
import { generateStandaloneTallyConnectorMjs } from "@rsl/tally";

export async function GET(req: NextRequest) {
  const preferLocal = req.nextUrl.searchParams.get("target") === "local";
  const endpoints = resolveEndpointsFromHeaders(req.headers, { preferLocal });
  const serverUrl = preferLocal ? endpoints.effectiveTallyBaseUrl : endpoints.tallyCloudBaseUrl;
  const script = generateStandaloneTallyConnectorMjs({
    serverUrl,
    workspaceName: "RapidShift Tally Office PC",
  });

  return new NextResponse(script, {
    status: 200,
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Content-Disposition": `attachment; filename="rsl-tally-connector.mjs"`,
      "Cache-Control": "no-store",
    },
  });
}
