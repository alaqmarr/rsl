import { NextRequest, NextResponse } from "next/server";
import { resolveEndpointsFromHeaders } from "@rsl/core";
import { generateOpenApiSpec } from "@rsl/docs";

export async function GET(req: NextRequest) {
  const endpoints = resolveEndpointsFromHeaders(req.headers);
  return NextResponse.json(generateOpenApiSpec(endpoints.cloudBaseUrl));
}
