import { NextRequest, NextResponse } from "next/server";
import { requireEntitlement } from "@rsl/billing";
import { RslError } from "@rsl/core";
import {
  getOrCreateTallyWebhookEndpoint,
  getTallyCompanyRoutingConfig,
  getTallyWorkspaceSummary,
  ingestTallyBillEventAndEnqueueAutomation,
  LATEST_TALLY_TDL_VERSION,
  recordAgentSyncSuccess,
  saveNativeTallyVoucherPdf,
  verifyAgentSignedRequest,
} from "@rsl/tally";
import {
  ensureTallyAutomationProcessorRegistered,
  flushInlineTallyOutboxIfNoRedis,
} from "@/lib/tally-outbox-runner";

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const verified = verifyAgentSignedRequest({
      deviceId: req.headers.get("x-rsl-device-id") || "",
      timestampHeader: req.headers.get("x-rsl-timestamp") || "",
      signatureHex: req.headers.get("x-rsl-signature") || "",
      rawBody,
    });

    requireEntitlement(verified.workspaceId, "tally.sync");
    ensureTallyAutomationProcessorRegistered();

    const parsed = JSON.parse(rawBody) as {
      rawContent?: string;
      rawXml?: string;
      companyName?: string;
      fullSnapshot?: boolean;
      voucherPdfs?: Array<{
        guid?: string;
        voucherNumber?: string;
        voucherType?: string;
        companyName?: string;
        alterId?: number;
        masterId?: string;
        pdfBase64?: string;
      }>;
    };

    // Pre-stage exact native Tally printed PDFs BEFORE voucher ingestion so WhatsApp
    // automation jobs immediately attach the client's genuine Tally PDF!
    let savedPdfsCount = 0;
    if (Array.isArray(parsed.voucherPdfs)) {
      for (const p of parsed.voucherPdfs) {
        const b64 = typeof p.pdfBase64 === "string" ? p.pdfBase64.trim() : "";
        if (!b64) continue;
        try {
          saveNativeTallyVoucherPdf({
            workspaceId: verified.workspaceId,
            voucherGuid: p.guid,
            voucherNumber: p.voucherNumber,
            voucherType: p.voucherType,
            companyName: p.companyName || parsed.companyName,
            alterId: p.alterId,
            masterId: p.masterId ?? null,
            pdfBuffer: Buffer.from(b64, "base64"),
            capturedFrom: "agent_native_pdf",
          });
          savedPdfsCount++;
        } catch {
          // Non-blocking if individual PDF invalid
        }
      }
    }

    const payloadToIngest = parsed.rawXml || parsed.rawContent || rawBody;
    const out = await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: verified.workspaceId,
      actorType: "agent",
      actorId: verified.deviceId,
      rawPayload: payloadToIngest,
      sourceLabel: "agent",
      fullCompanySnapshot:
        parsed.fullSnapshot && parsed.companyName?.trim()
          ? { companyName: parsed.companyName.trim() }
          : undefined,
    });

    recordAgentSyncSuccess({
      deviceId: verified.deviceId,
      activeCompanyName: out.detectedCompanyName ?? parsed.companyName ?? null,
      lastAlterId: out.maxAlterId > 0 ? out.maxAlterId : undefined,
    });

    await flushInlineTallyOutboxIfNoRedis(verified.workspaceId);

    return NextResponse.json({
      ok: true,
      upserted: out.upserted,
      deletedCount: out.deletedCount,
      ignoredCompanyCount: out.ignoredCompanyCount,
      skippedOptionalCount: out.skippedOptionalCount,
      savedPdfsCount,
      queuedJobs: out.queuedJobs,
      maxAlterId: out.maxAlterId,
    });
  } catch (err) {
    const mapped =
      err instanceof RslError
        ? err
        : new RslError("RSL-VAL-1001", err instanceof Error ? err.message : "Agent ingest failed");
    return NextResponse.json(
      { ok: false, error: mapped.toPublicObject("agent") },
      { status: mapped.httpStatus }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const verified = verifyAgentSignedRequest({
      deviceId: req.headers.get("x-rsl-device-id") || "",
      timestampHeader: req.headers.get("x-rsl-timestamp") || "",
      signatureHex: req.headers.get("x-rsl-signature") || "",
      rawBody: "",
    });
    const summary = getTallyWorkspaceSummary(verified.workspaceId);
    const ep = getOrCreateTallyWebhookEndpoint(verified.workspaceId);
    const routing = getTallyCompanyRoutingConfig(verified.workspaceId);
    return NextResponse.json({
      ok: true,
      workspaceId: verified.workspaceId,
      pollIntervalSeconds: 30,
      latestTdlVersion: LATEST_TALLY_TDL_VERSION,
      webhookToken: ep.webhookToken,
      companyRouting: routing,
      activeAutomationRulesCount: summary.automationRules.filter((r) => r.active).length,
    });
  } catch (err) {
    const mapped = err instanceof RslError ? err : new RslError("RSL-SYS-1001");
    return NextResponse.json(
      { ok: false, error: mapped.toPublicObject("agent") },
      { status: mapped.httpStatus }
    );
  }
}
