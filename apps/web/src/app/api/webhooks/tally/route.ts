import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { authenticatePublicApiKey } from "@rsl/api-keys";
import { requireEntitlement } from "@rsl/billing";
import { decryptEnvelope, newId, resolveEndpointsFromHeaders, RslError, signHmac } from "@rsl/core";
import { controlSchema, ingressSchema } from "@rsl/database";
import {
  buildTallyDisplayBrandTitle,
  buildWorkspaceTdlFilename,
  captureNativePdfsForVouchersFromLocalPort9000,
  computeTallyWebhookLiveStatus,
  generateTallyPrimeTdlAddOn,
  getOrCreateTallyWebhookEndpoint,
  getTallyCompanyRoutingConfig,
  ingestTallyBillEventAndEnqueueAutomation,
  LATEST_TALLY_TDL_VERSION,
  lookupTallyWebhookEndpointByToken,
  parseTallyOpenCompaniesInput,
  reconcileTallySyncBatch,
  recordTallyWebhookError,
  recordTallyWebhookPing,
  registerTallyCompaniesForWorkspace,
  saveNativeTallyVoucherPdf,
  unwrapTallyMultiPartJson,
  verifyAgentSignedRequest,
  verifyTallyWebhookSignedPayload,
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

interface ResolvedTallyCaller {
  workspaceId: string | null;
  endpointId: string | null;
  webhookToken: string | null;
  actorType: "webhook" | "api_key" | "agent";
  actorId: string;
  paused: boolean;
  hasCredentials: boolean;
  authenticatedBy: "device_hmac" | "webhook_token" | "api_key" | "none";
}

async function resolveWebhookCaller(
  req: NextRequest,
  rawBodyBuffer?: Buffer
): Promise<ResolvedTallyCaller> {
  if (req.nextUrl.searchParams.has("token")) {
    throw new RslError(
      "RSL-TALLY-1002",
      "Query-string ?token= authentication is disabled for security. Send X-Tally-Webhook-Token in the request header."
    );
  }

  const deviceId = (req.headers.get("x-rsl-device-id") || "").trim();
  const timestampHeader = (req.headers.get("x-rsl-timestamp") || "").trim();
  const signatureHex = (req.headers.get("x-rsl-signature") || "").trim();

  if (deviceId && timestampHeader && signatureHex) {
    const rawStr = rawBodyBuffer ? rawBodyBuffer.toString("utf8") : "";
    const verified = verifyAgentSignedRequest({
      deviceId,
      timestampHeader,
      signatureHex,
      rawBody: rawStr,
    });
    const ep = getOrCreateTallyWebhookEndpoint(verified.workspaceId);
    return {
      workspaceId: verified.workspaceId,
      endpointId: ep.id,
      webhookToken: ep.webhookToken,
      actorType: "agent",
      actorId: verified.deviceId,
      paused: !ep.enabled,
      hasCredentials: true,
      authenticatedBy: "device_hmac",
    };
  }

  const token = (req.headers.get("x-tally-webhook-token") || "").trim();
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
        authenticatedBy: "webhook_token",
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
        authenticatedBy: "webhook_token",
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
      authenticatedBy: "webhook_token",
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
      authenticatedBy: "api_key",
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
    authenticatedBy: "none",
  };
}

function getWorkspaceBranding(workspaceId: string): { name: string; slug: string | null } {
  const ws = controlDb()
    .select({
      name: controlSchema.workspaces.name,
      slug: controlSchema.workspaces.slug,
    })
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, workspaceId))
    .get();
  return {
    name: ws?.name ?? "RapidShift Workspace",
    slug: ws?.slug ?? null,
  };
}

function buildLatestWorkspaceTdl(req: NextRequest, workspaceId: string, webhookToken: string): {
  tdlBody: string;
  filename: string;
  displayBrandTitle: string;
} {
  const ws = getWorkspaceBranding(workspaceId);
  const preferLocal = req.nextUrl.searchParams.get("target") === "local";
  const isolated = req.nextUrl.searchParams.get("isolated") === "1";
  const endpoints = resolveEndpointsFromHeaders(req.headers, {
    workspaceSlug: ws.slug,
    preferLocal,
  });
  const routing = getTallyCompanyRoutingConfig(workspaceId);
  const tdlBody = generateTallyPrimeTdlAddOn({
    workspaceName: ws.name,
    webhookUrl: preferLocal
      ? endpoints.tallyWebhookUrl
      : `${endpoints.tallyCloudBaseUrl}/api/webhooks/tally`,
    webhookToken,
    allowedCompanyNames: routing.mode === "selected" ? routing.allowedCompanyNames : undefined,
    namespaceTag: isolated && ws.slug ? ws.slug : undefined,
  });
  return {
    tdlBody,
    filename: buildWorkspaceTdlFilename(ws.name, {
      isolatedSlug: isolated && ws.slug ? ws.slug : undefined,
    }),
    displayBrandTitle: buildTallyDisplayBrandTitle(ws.name),
  };
}

export async function GET(req: NextRequest) {
  const endpoints = resolveEndpointsFromHeaders(req.headers);
  const sourceIp = extractClientIp(req);
  const userAgent = req.headers.get("user-agent");

  try {
    const caller = await resolveWebhookCaller(req);

    if (!caller.hasCredentials) {
      const msg = "RapidShift Labs - Tally Prime Cloud Sync Ingress is online.";
      return NextResponse.json({
        ...buildTallyResultFields("Connected", msg, userAgent),
        service: "RapidShift Labs - Tally Prime Cloud Sync Ingress",
        primaryDomain: endpoints.primaryDomain,
        latestTdlVersion: LATEST_TALLY_TDL_VERSION,
        endpoint: endpoints.tallyWebhookUrl,
        endpointUrl: endpoints.tallyWebhookUrl,
        pingUrlTemplate: `${endpoints.tallyWebhookUrl}?mode=ping`,
        otaManifestUrlTemplate: `${endpoints.tallyWebhookUrl}?mode=tdl-manifest`,
        otaLatestTdlUrlTemplate: `${endpoints.tallyWebhookUrl}?mode=tdl-latest`,
        authentication: [
          "Header: X-Tally-Webhook-Token + X-RSL-Timestamp + X-RSL-Signature (HMAC-SHA256)",
          "Header: X-RSL-Device-Id + X-RSL-Timestamp + X-RSL-Signature (paired Tally PC)",
          "Header: Authorization: Bearer rsl_live_<api_key> (scope: vouchers:write)",
        ],
        acceptedPayloads: [
          "application/json (RSL Tally Prime .tdl add-on or custom ERP JSON)",
          "text/xml or application/xml (Tally Prime <ENVELOPE> / <VOUCHER> XML)",
          "application/pdf (?mode=voucher-pdf native Tally printed PDF)",
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

    if (mode === "tdl-manifest") {
      const built = buildLatestWorkspaceTdl(req, caller.workspaceId, epRow.webhookToken);
      const sha256 = crypto.createHash("sha256").update(built.tdlBody, "utf8").digest("hex");
      const sigPayload = `${LATEST_TALLY_TDL_VERSION}:${sha256}`;
      const manifestHmac = signHmac(sigPayload, epRow.webhookToken);

      let deviceHmac: string | undefined;
      const requestedDeviceId = (
        req.nextUrl.searchParams.get("deviceId") ||
        req.headers.get("x-rsl-device-id") ||
        ""
      ).trim();
      if (requestedDeviceId) {
        const dev = controlDb()
          .select({ signingSecretEncrypted: controlSchema.agentDevices.signingSecretEncrypted })
          .from(controlSchema.agentDevices)
          .where(
            and(
              eq(controlSchema.agentDevices.id, requestedDeviceId),
              eq(controlSchema.agentDevices.workspaceId, caller.workspaceId)
            )
          )
          .get();
        if (dev?.signingSecretEncrypted) {
          try {
            const rawSecret = decryptEnvelope(dev.signingSecretEncrypted);
            deviceHmac = signHmac(sigPayload, rawSecret);
          } catch {
            // Fall back to manifestHmac when envelope cannot be decrypted
          }
        }
      }

      return NextResponse.json({
        ok: true,
        version: LATEST_TALLY_TDL_VERSION,
        tdlVersion: LATEST_TALLY_TDL_VERSION,
        latestTdlVersion: LATEST_TALLY_TDL_VERSION,
        filename: built.filename,
        displayBrandTitle: built.displayBrandTitle,
        sha256,
        manifestHmac,
        ...(deviceHmac ? { deviceHmac } : {}),
        byteLength: Buffer.byteLength(built.tdlBody, "utf8"),
        downloadUrl: `${endpoints.tallyWebhookUrl}?mode=tdl-latest`,
      });
    }

    if (mode === "tdl-latest") {
      const built = buildLatestWorkspaceTdl(req, caller.workspaceId, epRow.webhookToken);
      return new NextResponse(built.tdlBody, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${built.filename}"`,
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

    const wsBrand = getWorkspaceBranding(caller.workspaceId);
    const displayBrandTitle = buildTallyDisplayBrandTitle(wsBrand.name);
    const updatedEndpoint = getOrCreateTallyWebhookEndpoint(caller.workspaceId);
    const liveStatus = computeTallyWebhookLiveStatus(updatedEndpoint);
    const okMsg = `Connected via ${displayBrandTitle}! Live Tally voucher, receipt & ledger sync is active.`;

    return NextResponse.json({
      ...buildTallyResultFields("Connected", okMsg, userAgent),
      mode: "handshake",
      workspaceId: caller.workspaceId,
      displayBrandTitle,
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
    const rawBodyBuffer = Buffer.from(await req.arrayBuffer());
    const caller = await resolveWebhookCaller(req, rawBodyBuffer);
    endpointIdForError = caller.endpointId;

    if (!caller.hasCredentials) {
      const errMsg =
        "Provide X-Tally-Webhook-Token + X-RSL-Timestamp + X-RSL-Signature, paired X-RSL-Device-Id headers, or Authorization Bearer API key.";
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

    // Enforce timestamp + HMAC-SHA256 + replay protection on webhook-token and device-signed POSTs
    if (caller.authenticatedBy === "webhook_token" && caller.webhookToken) {
      verifyTallyWebhookSignedPayload({
        workspaceId: caller.workspaceId,
        signingSecret: caller.webhookToken,
        timestampHeader: req.headers.get("x-rsl-timestamp") || "",
        signatureHex: req.headers.get("x-rsl-signature") || "",
        nonceHeader: req.headers.get("x-rsl-nonce"),
        rawBody: rawBodyBuffer,
      });
    } else if (caller.authenticatedBy === "device_hmac") {
      // Also guard against replay of an identical device-signed POST within the 5-minute window
      const devSig = (req.headers.get("x-rsl-signature") || "").trim().toLowerCase();
      const devTs = (req.headers.get("x-rsl-timestamp") || "").trim();
      const replayInserted = controlDb()
        .insert(controlSchema.idempotencyRecords)
        .values({
          id: newId(),
          workspaceId: caller.workspaceId,
          idempotencyKey: `tally_agent_replay:${caller.actorId}:${devTs}:${devSig.slice(0, 32)}`,
          method: "POST",
          path: "/api/webhooks/tally",
          requestHash: devSig,
          statusCode: 200,
          responseJson: "{}",
          expiresAt: now + 10 * 60 * 1000,
          createdAt: now,
        })
        .onConflictDoNothing()
        .run();
      if (replayInserted.changes === 0) {
        throw new RslError("RSL-TALLY-1002", "Duplicate or replayed agent webhook signature rejected.");
      }
    }

    requireEntitlement(caller.workspaceId, "tally.sync");
    ensureTallyAutomationProcessorRegistered();

    // Direct Native Tally Printed PDF Upload (?mode=voucher-pdf or raw application/pdf), idempotent by voucherGuid + sha256
    if (modeParam === "voucher-pdf" || contentType.includes("application/pdf")) {
      let pdfBuffer: Buffer;
      let voucherGuid = req.nextUrl.searchParams.get("guid") || req.headers.get("x-tally-voucher-guid") || "";
      let voucherNumber = req.nextUrl.searchParams.get("voucherNumber") || req.headers.get("x-tally-voucher-number") || "";
      let voucherType = req.nextUrl.searchParams.get("voucherType") || "Sales";
      let companyName = req.nextUrl.searchParams.get("companyName") || req.headers.get("x-tally-company") || "";
      let alterId = Number(req.nextUrl.searchParams.get("alterId") || "0");
      let masterId = req.nextUrl.searchParams.get("masterId") || null;

      if (contentType.includes("application/json")) {
        const bodyJson = JSON.parse(rawBodyBuffer.toString("utf8")) as Record<string, unknown>;
        voucherGuid = String(bodyJson.guid ?? voucherGuid).trim();
        voucherNumber = String(bodyJson.voucherNumber ?? voucherNumber).trim();
        voucherType = String(bodyJson.voucherType ?? voucherType).trim();
        companyName = String(bodyJson.companyName ?? companyName).trim();
        alterId = Number(bodyJson.alterId ?? alterId) || 0;
        masterId = bodyJson.masterId ? String(bodyJson.masterId) : masterId;
        pdfBuffer = Buffer.from(String(bodyJson.pdfBase64 ?? ""), "base64");
      } else {
        pdfBuffer = rawBodyBuffer;
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

      const okPdfMsg = `Stored native Tally PDF (${savedPdf.filename}) for Bill #${savedPdf.voucherNumber}.`;
      return NextResponse.json(
        {
          ...buildTallyResultFields("Connected", okPdfMsg, userAgent),
          savedPdf,
          message: okPdfMsg,
        },
        { status: 200 }
      );
    }

    const rawBody = rawBodyBuffer.toString("utf8");

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

    let isPingPayload = modeParam === "ping";
    let pingCompanyName = "";
    let pingOpenCompanies: Array<string | { name?: string; guid?: string; startingFrom?: string }> = [];
    let reconcilePayload: { companyName: string; syncBatchId: string } | null = null;

    const trimmedBody = rawBody.trim();
    if (trimmedBody.startsWith("{") || trimmedBody.startsWith("[")) {
      try {
        const parsedProbe = unwrapTallyMultiPartJson(JSON.parse(trimmedBody));
        if (parsedProbe.mode === "ping" || parsedProbe.type === "ping") {
          isPingPayload = true;
        }
        if (typeof parsedProbe.companyName === "string") {
          pingCompanyName = parsedProbe.companyName.replace(/[\x00-\x1F]+/g, "").trim();
        }
        pingOpenCompanies = parseTallyOpenCompaniesInput(
          parsedProbe.openCompanies,
          parsedProbe.openCompaniesPipe
        );
        if (
          (parsedProbe.mode === "reconcile" || modeParam === "reconcile") &&
          typeof parsedProbe.companyName === "string" &&
          typeof parsedProbe.syncBatchId === "string"
        ) {
          reconcilePayload = {
            companyName: parsedProbe.companyName.replace(/[\x00-\x1F]+/g, "").trim(),
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

      const companiesToRegister = [
        ...pingOpenCompanies,
        ...(pingCompanyName ? [pingCompanyName] : []),
      ];
      const regOut =
        companiesToRegister.length > 0
          ? registerTallyCompaniesForWorkspace({
              workspaceId: caller.workspaceId,
              companies: companiesToRegister,
              updateLastSyncedAt: true,
            })
          : { registeredCompanies: [] as Array<{ id: string; name: string; companyGuid: string }>, ignoredCount: 0 };

      const wsBrand = getWorkspaceBranding(caller.workspaceId);
      const displayBrandTitle = buildTallyDisplayBrandTitle(wsBrand.name);
      const registeredNames = regOut.registeredCompanies.map((c) => c.name);
      const verifiedNames =
        registeredNames.length > 0
          ? registeredNames
          : pingCompanyName
            ? [pingCompanyName]
            : [];
      const okMsg =
        verifiedNames.length > 1
          ? `Connected via ${displayBrandTitle}! Verified ${verifiedNames.length} open Tally companies (${verifiedNames.join(", ")}).`
          : verifiedNames.length === 1
            ? `Connected via ${displayBrandTitle}! Tally company '${verifiedNames[0]}' is verified and live.`
            : `Connected via ${displayBrandTitle}! Tally webhook endpoint verified and ready.`;

      return NextResponse.json(
        {
          ...buildTallyResultFields("Connected", okMsg, userAgent),
          mode: "ping",
          status: "handshake_verified",
          workspaceId: caller.workspaceId,
          displayBrandTitle,
          companyName: verifiedNames[0] || pingCompanyName || null,
          openCompanies: verifiedNames,
          openCompaniesRegistered: regOut.registeredCompanies.length,
          pingsReceivedCount: pingInfo?.pingsReceivedCount ?? 1,
          verifiedAt: new Date(now).toISOString(),
          message: okMsg,
        },
        { status: 200 }
      );
    }

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

    const explicitIdemKey = (req.headers.get("idempotency-key") || req.headers.get("x-rsl-event-id") || "").trim();
    const eventId = explicitIdemKey
      ? `tally_${caller.workspaceId}_${crypto.createHash("sha256").update(explicitIdemKey).digest("hex").slice(0, 24)}`
      : `tally_${caller.workspaceId}_${crypto.createHash("sha256").update(`${req.headers.get("x-rsl-timestamp") || ""}:${rawBody}`).digest("hex").slice(0, 24)}`;

    const inserted = ingressDb()
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

    if (inserted.changes === 0) {
      const dedupeMsg = "Duplicate Tally webhook payload already processed.";
      return NextResponse.json(
        {
          ...buildTallyResultFields("Connected", dedupeMsg, userAgent),
          deduplicated: true,
          workspaceId: caller.workspaceId,
          message: dedupeMsg,
        },
        { status: 200 }
      );
    }
    inboxInserted = true;

    const result = await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: caller.workspaceId,
      actorType: caller.actorType,
      actorId: caller.actorId,
      rawPayload: rawBody,
      modeHint: modeParam || undefined,
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

    const endpointsForPost = resolveEndpointsFromHeaders(req.headers);
    const isLoopbackCaller =
      !sourceIp ||
      sourceIp === "127.0.0.1" ||
      sourceIp === "::1" ||
      sourceIp === "::ffff:127.0.0.1";
    const shouldCaptureLocalPort9000PdfAsync =
      endpointsForPost.isLocalDev &&
      isLoopbackCaller &&
      !process.env.VITEST &&
      process.env.NODE_ENV !== "test" &&
      isTallyTdlUserAgent(userAgent) &&
      result.vouchers.some((v) => Boolean(v.masterId) && v.paymentStatus !== "cancelled");

    if (shouldCaptureLocalPort9000PdfAsync) {
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

    const mastersSummaryParts: string[] = [];
    if (result.stockItemsUpserted > 0) {
      mastersSummaryParts.push(`${result.stockItemsUpserted} product(s)`);
    }
    if (result.partiesUpserted > 0) {
      mastersSummaryParts.push(`${result.partiesUpserted} party ledger(s)`);
    }
    if (result.godownsUpserted > 0) {
      mastersSummaryParts.push(`${result.godownsUpserted} godown(s)`);
    }

    const syncMsg =
      result.upserted === 0 && result.deletedCount === 0 && mastersSummaryParts.length > 0
        ? `Synced ${mastersSummaryParts.join(", ")} to RapidShift Labs.`
        : `Synced ${result.upserted} voucher(s)${
            mastersSummaryParts.length > 0 ? `, ${mastersSummaryParts.join(", ")}` : ""
          }${
            result.deletedCount > 0 ? `, removed ${result.deletedCount} deleted` : ""
          } to RapidShift Labs (${result.queuedJobs} WhatsApp job(s) queued).`;
    return NextResponse.json(
      {
        ...buildTallyResultFields("Connected", syncMsg, userAgent, result.deletedCount),
        workspaceId: caller.workspaceId,
        upsertedBills: result.upserted,
        deletedBills: result.deletedCount,
        stockItemsUpserted: result.stockItemsUpserted,
        godownsUpserted: result.godownsUpserted,
        partiesUpserted: result.partiesUpserted,
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
