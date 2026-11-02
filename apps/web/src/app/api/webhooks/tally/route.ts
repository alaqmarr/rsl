import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { authenticatePublicApiKey } from "@rsl/api-keys";
import { requireEntitlement } from "@rsl/billing";
import { newId, resolveEndpointsFromHeaders, RslError } from "@rsl/core";
import { controlSchema, ingressSchema } from "@rsl/database";
import {
  captureNativePdfsForVouchersFromLocalPort9000,
  computeTallyWebhookLiveStatus,
  generateTallyPrimeTdlAddOn,
  getOrCreateTallyWebhookEndpoint,
  getTallyCompanyRoutingConfig,
  ingestTallyBillEventAndEnqueueAutomation,
  LATEST_TALLY_TDL_VERSION,
  lookupTallyWebhookEndpointByToken,
  reconcileTallySyncBatch,
  recordTallyWebhookError,
  recordTallyWebhookPing,
  saveNativeTallyVoucherPdf,
} from "@rsl/tally";
import { controlDb, ingressDb } from "@rsl/tenancy";
import {
  ensureTallyAutomationProcessorRegistered,
  flushInlineTallyOutboxIfNoRedis,
} from "../../../../lib/tally-outbox-runner";

function extractClientIp(req: NextRequest): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return (fwd.split(",")[0] ?? "").trim() || null;
  return req.headers.get("x-real-ip") || null;
}

function isTallyTdlUserAgent(userAgent?: string | null): boolean {
  return Boolean(userAgent && userAgent.includes("TallyPrime-RSL-TDL/"));
}

/**
 * Tally Prime's `HTTP JSON` transport discards any response body whose HTTP status != 200,
 * causing `##RSLPingStatus` to be blank (`""`) and triggering a generic "Could not reach..." dialog.
 * Returning HTTP 200 with `{ ok: false, tallyResult: [{ RSLOkStatus: "Error", RSLMessage }] }`
 * ONLY for `TallyPrime-RSL-TDL/*` lets Tally Prime display the exact actionable error message!
 */
function resolveHttpStatusForCaller(httpStatus: number, userAgent?: string | null): number {
  return isTallyTdlUserAgent(userAgent) ? 200 : httpStatus;
}

function buildTallyResultFields(
  status: "Connected" | "Error",
  message: string,
  userAgent?: string | null,
  deletedCount = 0
) {
  const tallyResult = [
    {
      RSLOkStatus: status,
      RSLMessage: message,
      RSLDeletedCount: String(deletedCount),
    },
  ];
  const isLegacyTdl20 = Boolean(userAgent && userAgent.includes("TallyPrime-RSL-TDL/2.0"));
  return {
    ok: isLegacyTdl20
      ? status === "Connected"
        ? [{ RSLOkStatus: "Connected", RSLMessage: message }]
        : []
      : status === "Connected",
    tallyResult,
  };
}

async function resolveWebhookCaller(req: NextRequest): Promise<{
  workspaceId: string | null;
  endpointId: string | null;
  webhookToken: string | null;
  actorType: "webhook" | "api_key";
  actorId: string;
  paused: boolean;
  hasCredentials: boolean;
}> {
  const token = (
    req.headers.get("x-tally-webhook-token") ||
    req.nextUrl.searchParams.get("token") ||
    ""
  ).trim();

  if (token) {
    const endpoint = lookupTallyWebhookEndpointByToken(token);
    if (!endpoint) {
      return {
        workspaceId: null,
        endpointId: null,
        webhookToken: null,
        actorType: "webhook",
        actorId: "tally_webhook",
        paused: false,
        hasCredentials: true,
      };
    }
    if (!endpoint.enabled) {
      return {
        workspaceId: endpoint.workspaceId,
        endpointId: endpoint.id,
        webhookToken: endpoint.webhookToken,
        actorType: "webhook",
        actorId: endpoint.id,
        paused: true,
        hasCredentials: true,
      };
    }
    return {
      workspaceId: endpoint.workspaceId,
      endpointId: endpoint.id,
      webhookToken: endpoint.webhookToken,
      actorType: "webhook",
      actorId: endpoint.id,
      paused: false,
      hasCredentials: true,
    };
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const auth = await authenticatePublicApiKey({
      authorizationHeader: authHeader,
      requiredScope: "vouchers:write",
      clientIp: extractClientIp(req) ?? undefined,
    });
    const ep = getOrCreateTallyWebhookEndpoint(auth.workspaceId);
    return {
      workspaceId: auth.workspaceId,
      endpointId: ep.id,
      webhookToken: ep.webhookToken,
      actorType: "api_key",
      actorId: auth.keyId,
      paused: !ep.enabled,
      hasCredentials: true,
    };
  }

  return {
    workspaceId: null,
    endpointId: null,
    webhookToken: null,
    actorType: "webhook",
    actorId: "tally_webhook",
    paused: false,
    hasCredentials: false,
  };
}

function buildLatestWorkspaceTdl(req: NextRequest, workspaceId: string, webhookToken: string): string {
  const ws = controlDb()
    .select({
      name: controlSchema.workspaces.name,
      slug: controlSchema.workspaces.slug,
    })
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, workspaceId))
    .get();
  const preferLocal = req.nextUrl.searchParams.get("target") === "local";
  const isolated = req.nextUrl.searchParams.get("isolated") === "1";
  const endpoints = resolveEndpointsFromHeaders(req.headers, {
    workspaceSlug: ws?.slug ?? null,
    preferLocal,
  });
  const routing = getTallyCompanyRoutingConfig(workspaceId);
  return generateTallyPrimeTdlAddOn({
    workspaceName: ws?.name ?? "RapidShift Workspace",
    webhookUrl: preferLocal
      ? endpoints.tallyWebhookUrl
      : `${endpoints.tallyCloudBaseUrl}/api/webhooks/tally`,
    webhookToken,
    allowedCompanyNames: routing.mode === "selected" ? routing.allowedCompanyNames : undefined,
    namespaceTag: isolated && ws?.slug ? ws.slug : undefined,
  });
}

export async function GET(req: NextRequest) {
  const endpoints = resolveEndpointsFromHeaders(req.headers);
  const sourceIp = extractClientIp(req);
  const userAgent = req.headers.get("user-agent");

  try {
    const caller = await resolveWebhookCaller(req);

    // Unauthenticated browser / health check -> return helpful endpoint specification
    if (!caller.hasCredentials) {
      const msg = "RapidShift Labs — Tally Prime Cloud Sync Ingress is online.";
      return NextResponse.json({
        ...buildTallyResultFields("Connected", msg, userAgent),
        service: "RapidShift Labs — Tally Prime Cloud Sync Ingress",
        primaryDomain: endpoints.primaryDomain,
        latestTdlVersion: LATEST_TALLY_TDL_VERSION,
        endpoint: endpoints.tallyWebhookUrl,
        endpointUrl: endpoints.tallyWebhookUrl,
        pingUrlTemplate: `${endpoints.tallyWebhookUrl}?mode=ping&token=<tlwh_token>`,
        otaManifestUrlTemplate: `${endpoints.tallyWebhookUrl}?mode=tdl-manifest&token=<tlwh_token>`,
        otaLatestTdlUrlTemplate: `${endpoints.tallyWebhookUrl}?mode=tdl-latest&token=<tlwh_token>`,
        authentication: [
          "Header: X-Tally-Webhook-Token: tlwh_<workspace_token>",
          "Query: ?token=tlwh_<workspace_token>",
          "Header: Authorization: Bearer rsl_live_<api_key> (scope: vouchers:write)",
        ],
        acceptedPayloads: [
          "application/json (RSL Tally Prime .tdl add-on or custom ERP JSON)",
          "text/xml or application/xml (Tally Prime <ENVELOPE> / <VOUCHER> XML)",
          "application/pdf (?mode=voucher-pdf exact native Tally printed PDF)",
        ],
      });
    }

    if (!caller.workspaceId) {
      const errMsg = "Invalid or rotated Tally webhook token. Re-download your .tdl add-on.";
      return NextResponse.json(
        {
          ...buildTallyResultFields("Error", errMsg, userAgent),
          error: errMsg,
        },
        { status: resolveHttpStatusForCaller(401, userAgent) }
      );
    }

    if (caller.paused) {
      const errMsg = "Incoming Tally webhook endpoint is currently paused in workspace settings.";
      return NextResponse.json(
        {
          ...buildTallyResultFields("Error", errMsg, userAgent),
          status: "paused",
          error: errMsg,
        },
        { status: resolveHttpStatusForCaller(403, userAgent) }
      );
    }

    const mode = req.nextUrl.searchParams.get("mode");
    const epRow = getOrCreateTallyWebhookEndpoint(caller.workspaceId);

    // Over-The-Air (OTA) .tdl manifest & auto-update endpoints run even before plan unlock so setup is frictionless
    if (mode === "tdl-manifest") {
      const tdlBody = buildLatestWorkspaceTdl(req, caller.workspaceId, epRow.webhookToken);
      const sha256 = crypto.createHash("sha256").update(tdlBody).digest("hex");
      return NextResponse.json({
        ok: true,
        tdlVersion: LATEST_TALLY_TDL_VERSION,
        latestTdlVersion: LATEST_TALLY_TDL_VERSION,
        sha256,
        byteLength: Buffer.byteLength(tdlBody, "utf8"),
        downloadUrl: `${endpoints.tallyWebhookUrl}?mode=tdl-latest&token=${encodeURIComponent(epRow.webhookToken)}`,
      });
    }

    if (mode === "tdl-latest") {
      const tdlBody = buildLatestWorkspaceTdl(req, caller.workspaceId, epRow.webhookToken);
      return new NextResponse(tdlBody, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="rsl-tally-whatsapp.tdl"`,
          "Cache-Control": "no-store",
          "X-RSL-TDL-Version": LATEST_TALLY_TDL_VERSION,
        },
      });
    }

    requireEntitlement(caller.workspaceId, "tally.sync");

    if ((mode === "ping" || req.nextUrl.searchParams.get("check") === "1") && caller.endpointId) {
      recordTallyWebhookPing({
        endpointId: caller.endpointId,
        sourceIp,
        userAgent,
      });
    }

    const updatedEndpoint = getOrCreateTallyWebhookEndpoint(caller.workspaceId);
    const liveStatus = computeTallyWebhookLiveStatus(updatedEndpoint);
    const okMsg = "Connected to RapidShift Labs! Live Tally voucher sync is active.";

    return NextResponse.json({
      ...buildTallyResultFields("Connected", okMsg, userAgent),
      mode: "handshake",
      workspaceId: caller.workspaceId,
      latestTdlVersion: LATEST_TALLY_TDL_VERSION,
      endpoint: endpoints.tallyWebhookUrl,
      endpointUrl: endpoints.tallyWebhookUrl,
      status: liveStatus.state,
      statusLabel: liveStatus.label,
      eventsReceivedCount: updatedEndpoint.eventsReceivedCount,
      pingsReceivedCount: updatedEndpoint.pingsReceivedCount,
      lastEventAt: updatedEndpoint.lastEventAt,
      lastPingAt: updatedEndpoint.lastPingAt,
      checkedAt: new Date().toISOString(),
      message: okMsg,
    });
  } catch (err) {
    const mapped =
      err instanceof RslError
        ? err
        : new RslError("RSL-VAL-1001", err instanceof Error ? err.message : "Handshake check failed");
    return NextResponse.json(
      {
        ...buildTallyResultFields("Error", mapped.message, userAgent),
        error: mapped.toPublicObject("tally_webhook"),
      },
      { status: resolveHttpStatusForCaller(mapped.httpStatus, userAgent) }
    );
  }
}

export async function POST(req: NextRequest) {
  const now = Date.now();
  const sourceIp = extractClientIp(req);
  const userAgent = req.headers.get("user-agent");
  const modeParam = req.nextUrl.searchParams.get("mode");
  const contentType = (req.headers.get("content-type") || "").toLowerCase();

  let endpointIdForError: string | null = null;
  let inboxInserted = false;
  const inboxId = newId();

  try {
    const caller = await resolveWebhookCaller(req);
    endpointIdForError = caller.endpointId;

    if (!caller.hasCredentials) {
      const errMsg =
        "Provide your Tally webhook token (Header X-Tally-Webhook-Token or ?token=tlwh_...) or Authorization Bearer API key.";
      return NextResponse.json(
        {
          ...buildTallyResultFields("Error", errMsg, userAgent),
          error: errMsg,
        },
        { status: resolveHttpStatusForCaller(401, userAgent) }
      );
    }

    if (!caller.workspaceId) {
      const errMsg = "Invalid or rotated Tally webhook token. Re-download your .tdl add-on.";
      return NextResponse.json(
        {
          ...buildTallyResultFields("Error", errMsg, userAgent),
          error: errMsg,
        },
        { status: resolveHttpStatusForCaller(401, userAgent) }
      );
    }

    if (caller.paused) {
      const errMsg = "Incoming Tally webhook endpoint is currently paused in workspace settings.";
      return NextResponse.json(
        {
          ...buildTallyResultFields("Error", errMsg, userAgent),
          status: "paused",
          error: errMsg,
        },
        { status: resolveHttpStatusForCaller(403, userAgent) }
      );
    }

    requireEntitlement(caller.workspaceId, "tally.sync");
    ensureTallyAutomationProcessorRegistered();

    // Direct Native Tally Printed PDF Upload (?mode=voucher-pdf or raw application/pdf)
    if (modeParam === "voucher-pdf" || contentType.includes("application/pdf")) {
      let pdfBuffer: Buffer;
      let voucherGuid = req.nextUrl.searchParams.get("guid") || req.headers.get("x-tally-voucher-guid") || "";
      let voucherNumber = req.nextUrl.searchParams.get("voucherNumber") || req.headers.get("x-tally-voucher-number") || "";
      let voucherType = req.nextUrl.searchParams.get("voucherType") || "Sales";
      let companyName = req.nextUrl.searchParams.get("companyName") || req.headers.get("x-tally-company") || "";
      let alterId = Number(req.nextUrl.searchParams.get("alterId") || "0");
      let masterId = req.nextUrl.searchParams.get("masterId") || null;

      if (contentType.includes("application/json")) {
        const bodyJson = (await req.json()) as Record<string, unknown>;
        voucherGuid = String(bodyJson.guid ?? voucherGuid).trim();
        voucherNumber = String(bodyJson.voucherNumber ?? voucherNumber).trim();
        voucherType = String(bodyJson.voucherType ?? voucherType).trim();
        companyName = String(bodyJson.companyName ?? companyName).trim();
        alterId = Number(bodyJson.alterId ?? alterId) || 0;
        masterId = bodyJson.masterId ? String(bodyJson.masterId) : masterId;
        pdfBuffer = Buffer.from(String(bodyJson.pdfBase64 ?? ""), "base64");
      } else {
        pdfBuffer = Buffer.from(await req.arrayBuffer());
      }

      const savedPdf = saveNativeTallyVoucherPdf({
        workspaceId: caller.workspaceId,
        voucherGuid: voucherGuid || undefined,
        voucherNumber: voucherNumber || undefined,
        voucherType,
        companyName: companyName || undefined,
        alterId,
        masterId,
        pdfBuffer,
        capturedFrom: "webhook_native_pdf",
      });

      await flushInlineTallyOutboxIfNoRedis(caller.workspaceId);

      const okPdfMsg = `Stored exact native Tally PDF (${savedPdf.filename}) for Bill #${savedPdf.voucherNumber}.`;
      return NextResponse.json(
        {
          ...buildTallyResultFields("Connected", okPdfMsg, userAgent),
          savedPdf,
          message: okPdfMsg,
        },
        { status: 200 }
      );
    }

    const rawBody = await req.text();
    const eventId = `tally_${crypto.createHash("sha256").update(`${now}:${rawBody}`).digest("hex").slice(0, 24)}`;

    // Tally Prime HTTP JSON collections send a 0-byte preflight POST probe right before
    // streaming the RemoteRequest payload. Acknowledge it cleanly without recording an error.
    if (rawBody.trim() === "" && modeParam !== "ping") {
      const preflightMsg = "Tally Prime HTTP preflight ready.";
      return NextResponse.json(
        {
          ...buildTallyResultFields("Connected", preflightMsg, userAgent),
          mode: "preflight",
          status: "preflight_ok",
          workspaceId: caller.workspaceId,
          message: preflightMsg,
        },
        { status: 200 }
      );
    }

    // Parse JSON metadata if body is JSON
    let isPingPayload = modeParam === "ping";
    let pingCompanyName = "";
    let reconcilePayload: { companyName: string; syncBatchId: string } | null = null;

    if (rawBody.trim().startsWith("{")) {
      try {
        const parsedProbe = JSON.parse(rawBody) as Record<string, unknown>;
        if (parsedProbe.mode === "ping" || parsedProbe.type === "ping") {
          isPingPayload = true;
        }
        if (typeof parsedProbe.companyName === "string") {
          pingCompanyName = parsedProbe.companyName.trim();
        }
        if (
          parsedProbe.mode === "reconcile" &&
          typeof parsedProbe.companyName === "string" &&
          typeof parsedProbe.syncBatchId === "string"
        ) {
          reconcilePayload = {
            companyName: parsedProbe.companyName.trim(),
            syncBatchId: parsedProbe.syncBatchId.trim(),
          };
        }
      } catch {
        // Handled below during full ingestion
      }
    }

    if (isPingPayload) {
      const pingInfo = caller.endpointId
        ? recordTallyWebhookPing({
            endpointId: caller.endpointId,
            sourceIp,
            userAgent,
          })
        : null;

      const okMsg = pingCompanyName
        ? `Connected to RapidShift Labs! Tally company '${pingCompanyName}' is verified and live.`
        : "Connected to RapidShift Labs! Tally webhook endpoint verified and ready.";

      return NextResponse.json(
        {
          ...buildTallyResultFields("Connected", okMsg, userAgent),
          mode: "ping",
          status: "handshake_verified",
          workspaceId: caller.workspaceId,
          companyName: pingCompanyName || null,
          pingsReceivedCount: pingInfo?.pingsReceivedCount ?? 1,
          verifiedAt: new Date(now).toISOString(),
          message: okMsg,
        },
        { status: 200 }
      );
    }

    // Reconcile Day Book batch deletions (including when 0 vouchers remain in Tally!)
    if (reconcilePayload) {
      const rec = reconcileTallySyncBatch({
        workspaceId: caller.workspaceId,
        companyName: reconcilePayload.companyName,
        syncBatchId: reconcilePayload.syncBatchId,
        actorType: caller.actorType,
        actorId: caller.actorId,
        sourceIp,
        userAgent,
      });
      const recMsg =
        rec.deletedCount > 0
          ? `Reconciled '${reconcilePayload.companyName}': removed ${rec.deletedCount} deleted bill(s).`
          : `Reconciled '${reconcilePayload.companyName}': all bills match Tally Prime.`;
      return NextResponse.json(
        {
          ...buildTallyResultFields("Connected", recMsg, userAgent, rec.deletedCount),
          mode: "reconcile",
          workspaceId: caller.workspaceId,
          companyName: reconcilePayload.companyName,
          deletedCount: rec.deletedCount,
          deletedVoucherNumbers: rec.deletedVoucherNumbers,
          ignoredCompany: rec.ignoredCompany,
          message: recMsg,
        },
        { status: 200 }
      );
    }

    ingressDb()
      .insert(ingressSchema.webhookInbox)
      .values({
        id: inboxId,
        provider: "tally",
        eventId,
        rawBody: rawBody.slice(0, 65536),
        headersJson: JSON.stringify({
          contentType: req.headers.get("content-type"),
          userAgent,
          sourceIp,
        }),
        signatureValid: true,
        routedTenantId: caller.workspaceId,
        status: "received",
        receivedAt: now,
      })
      .onConflictDoNothing()
      .run();
    inboxInserted = true;

    const result = await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: caller.workspaceId,
      actorType: caller.actorType,
      actorId: caller.actorId,
      rawPayload: rawBody,
      sourceLabel: "webhook",
      sourceIp,
      userAgent,
    });

    ingressDb()
      .update(ingressSchema.webhookInbox)
      .set({
        status: "enqueued",
        processedAt: Date.now(),
      })
      .where(eq(ingressSchema.webhookInbox.id, inboxId))
      .run();

    const shouldCaptureLocalPort9000PdfAsync =
      !process.env.VITEST &&
      process.env.NODE_ENV !== "test" &&
      isTallyTdlUserAgent(userAgent) &&
      result.vouchers.some((v) => Boolean(v.masterId) && v.paymentStatus !== "cancelled");

    if (shouldCaptureLocalPort9000PdfAsync) {
      // Return HTTP 200 immediately so single-threaded tally.exe finishes Form Accept,
      // then export the 100% genuine native Tally PDF from 127.0.0.1:9000 and dispatch WhatsApp!
      const wsIdForAsync = caller.workspaceId;
      const vouchersForAsync = result.vouchers;
      setTimeout(() => {
        void (async () => {
          try {
            await captureNativePdfsForVouchersFromLocalPort9000({
              workspaceId: wsIdForAsync,
              vouchers: vouchersForAsync,
            });
          } catch {
            // Non-blocking
          }
          try {
            await flushInlineTallyOutboxIfNoRedis(wsIdForAsync);
          } catch {
            // Non-blocking
          }
        })();
      }, 350);
    } else {
      await flushInlineTallyOutboxIfNoRedis(caller.workspaceId);
    }

    const syncMsg = `Synced ${result.upserted} voucher(s)${
      result.deletedCount > 0 ? `, removed ${result.deletedCount} deleted` : ""
    } to RapidShift Labs (${result.queuedJobs} WhatsApp job(s) queued).`;
    return NextResponse.json(
      {
        ...buildTallyResultFields("Connected", syncMsg, userAgent, result.deletedCount),
        workspaceId: caller.workspaceId,
        upsertedBills: result.upserted,
        deletedBills: result.deletedCount,
        ignoredCompanyBills: result.ignoredCompanyCount,
        skippedOptionalBills: result.skippedOptionalCount,
        queuedWhatsAppJobs: result.queuedJobs,
        vouchers: result.vouchers,
        message: syncMsg,
      },
      { status: 200 }
    );
  } catch (err) {
    const mapped =
      err instanceof RslError
        ? err
        : new RslError("RSL-VAL-1001", err instanceof Error ? err.message : "Invalid Tally payload");

    if (endpointIdForError) {
      try {
        recordTallyWebhookError({
          endpointId: endpointIdForError,
          errorMessage: mapped.message,
          sourceIp,
          userAgent,
        });
      } catch {
        // Non-blocking diagnostic write
      }
    }

    if (inboxInserted) {
      try {
        ingressDb()
          .update(ingressSchema.webhookInbox)
          .set({
            status: "failed",
            errorMessage: mapped.message.slice(0, 300),
            processedAt: Date.now(),
          })
          .where(eq(ingressSchema.webhookInbox.id, inboxId))
          .run();
      } catch {
        // Non-blocking inbox status update
      }
    }

    return NextResponse.json(
      {
        ...buildTallyResultFields("Error", mapped.message, userAgent),
        error: mapped.toPublicObject("tally_webhook"),
      },
      { status: resolveHttpStatusForCaller(mapped.httpStatus, userAgent) }
    );
  }
}
