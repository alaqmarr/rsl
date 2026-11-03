import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { registerUserWithWorkspace, resolveUserSessionFromToken } from "@rsl/auth";
import { staffGrantFreeAllToolsAccess } from "@rsl/billing";
import { listWorkspaceConnections } from "@rsl/connections";
import {
  isLoopbackUrlOrHost,
  resetEnvCacheForTests,
  resolveEndpointsFromHeaders,
  resolvePublicEndpoints,
} from "@rsl/core";
import {
  AGENT_HEARTBEAT_STALE_MS,
  computeAgentDeviceLiveStatus,
  computeTallyWebhookLiveStatus,
  exchangePairingCodeForAgentDevice,
  generateStandaloneTallyConnectorMjs,
  generateTallyPairingCode,
  generateTallyPrimeTdlAddOn,
  getOrCreateTallyWebhookEndpoint,
  getTallyWorkspaceSummary,
  ingestTallyBillEventAndEnqueueAutomation,
  parseTallyXmlEnvelope,
  recordAgentHeartbeat,
  recordTallyWebhookError,
  recordTallyWebhookPing,
  revokeTallyAgentDevice,
  toggleTallyWebhookEndpoint,
} from "@rsl/tally";
import {
  GET as tallyWebhookGet,
  POST as tallyWebhookPost,
} from "../app/api/webhooks/tally/route";

function createTestWorkspace(tag: string) {
  const email = `${tag.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 10000)}@rapidshiftlabs.in`;
  const reg = registerUserWithWorkspace({
    name: `${tag} Owner`,
    email,
    password: "StrongPassword123!",
    businessName: `${tag} Traders`,
    industry: "Wholesale",
    stateCode: "27",
  });
  const session = resolveUserSessionFromToken(reg.rawSessionToken)!;
  return { email, reg, session };
}

describe("Phase 16 Suite (Subdomain Endpoints on rapidshiftlabs.in, Tally Sync Engine & Live Connection Statuses)", () => {
  const savedEnv = {
    PRIMARY_DOMAIN: process.env.PRIMARY_DOMAIN,
    APP_SUBDOMAIN: process.env.APP_SUBDOMAIN,
    TALLY_SUBDOMAIN: process.env.TALLY_SUBDOMAIN,
    APP_URL: process.env.APP_URL,
  };

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    resetEnvCacheForTests();
  });

  it("resolves canonical rapidshiftlabs.in & *.tally / *.api client subdomains without leaking localhost into cloud webhook URLs", () => {
    process.env.PRIMARY_DOMAIN = "rapidshiftlabs.in";
    process.env.APP_SUBDOMAIN = "app";
    process.env.TALLY_SUBDOMAIN = "";
    process.env.APP_URL = "http://localhost:4500";
    resetEnvCacheForTests();

    expect(isLoopbackUrlOrHost("http://localhost:4500")).toBe(true);
    expect(isLoopbackUrlOrHost("127.0.0.1:4500")).toBe(true);
    expect(isLoopbackUrlOrHost("app.rapidshiftlabs.in")).toBe(false);

    // Even when accessed on localhost:4500, default cloud endpoints use rapidshiftlabs.in + client wildcard subdomains
    const localHeaders = new Headers({ host: "localhost:4500" });
    const cloudResolved = resolveEndpointsFromHeaders(localHeaders, {
      workspaceSlug: "shah-traders",
    });

    expect(cloudResolved.primaryDomain).toBe("rapidshiftlabs.in");
    expect(cloudResolved.cloudBaseUrl).toBe("https://app.rapidshiftlabs.in");
    expect(cloudResolved.adminBaseUrl).toBe("https://admin.rapidshiftlabs.in");
    expect(cloudResolved.docsBaseUrl).toBe("https://docs.rapidshiftlabs.in");
    expect(cloudResolved.workspaceSubdomainUrl).toBe("https://shah-traders.rapidshiftlabs.in");
    expect(cloudResolved.clientTallySubdomainHost).toBe("shah-traders.tally.rapidshiftlabs.in");
    expect(cloudResolved.clientApiSubdomainHost).toBe("shah-traders.api.rapidshiftlabs.in");
    expect(cloudResolved.tallyWildcardPattern).toBe("*.tally.rapidshiftlabs.in");
    expect(cloudResolved.apiWildcardPattern).toBe("*.api.rapidshiftlabs.in");
    expect(cloudResolved.tallyWebhookUrl).toBe(
      "https://shah-traders.tally.rapidshiftlabs.in/api/webhooks/tally"
    );
    expect(cloudResolved.tallyBillEventApiUrl).toBe(
      "https://shah-traders.api.rapidshiftlabs.in/api/v1/tally/bill-event"
    );
    expect(cloudResolved.whatsappWebhookUrl).toBe(
      "https://app.rapidshiftlabs.in/api/webhooks/whatsapp"
    );
    expect(cloudResolved.isLocalDev).toBe(true);
    expect(cloudResolved.localBaseUrl).toBe("http://localhost:4500");

    // Explicit preferLocal=true returns localhost URLs for local dev sandbox testing
    const localSandbox = resolveEndpointsFromHeaders(localHeaders, { preferLocal: true });
    expect(localSandbox.tallyWebhookUrl).toBe("http://localhost:4500/api/webhooks/tally");

    // Tenant wildcard Tally subdomain via Nginx X-Forwarded-Host is preserved automatically
    const tenantSubdomainHeaders = new Headers({
      host: "127.0.0.1:4500",
      "x-forwarded-host": "acme-distributors.tally.rapidshiftlabs.in",
      "x-forwarded-proto": "https",
    });
    const tenantResolved = resolveEndpointsFromHeaders(tenantSubdomainHeaders);
    expect(tenantResolved.tallyWebhookUrl).toBe(
      "https://acme-distributors.tally.rapidshiftlabs.in/api/webhooks/tally"
    );
    expect(tenantResolved.tallyBillEventApiUrl).toBe(
      "https://acme-distributors.api.rapidshiftlabs.in/api/v1/tally/bill-event"
    );

    // Explicit TALLY_SUBDOMAIN=tally override routes Tally webhooks to https://tally.rapidshiftlabs.in
    process.env.TALLY_SUBDOMAIN = "tally";
    resetEnvCacheForTests();
    const dedicatedTally = resolvePublicEndpoints({ workspaceSlug: "acme" });
    expect(dedicatedTally.tallyWebhookUrl).toBe(
      "https://tally.rapidshiftlabs.in/api/webhooks/tally"
    );
    expect(dedicatedTally.agentPairUrl).toBe("https://tally.rapidshiftlabs.in/api/agent/pair");
    expect(dedicatedTally.whatsappWebhookUrl).toBe(
      "https://app.rapidshiftlabs.in/api/webhooks/whatsapp"
    );
  });

  it("accurately parses real Tally Prime XML envelopes (party ledger totals, &amp; entities, optional skip, cancelled status, credit days, ledger phones)", async () => {
    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <BODY>
    <DATA>
      <SVCURRENTCOMPANY>Shah &amp; Sons Distributors FY26</SVCURRENTCOMPANY>
      <TALLYMESSAGE>
        <LEDGER NAME="M/s Mehta &amp; Co">
          <LEDGERMOBILE>9876543210</LEDGERMOBILE>
        </LEDGER>
      </TALLYMESSAGE>
      <TALLYMESSAGE>
        <VOUCHER VCHTYPE="GST Sales" ACTION="Create">
          <GUID>guid-sales-101</GUID>
          <ALTERID>412</ALTERID>
          <DATE>20261015</DATE>
          <VOUCHERTYPENAME>GST Sales B2B</VOUCHERTYPENAME>
          <RSLBASEVCHTYPE>Sales</RSLBASEVCHTYPE>
          <VOUCHERNUMBER>GST/26-27/101</VOUCHERNUMBER>
          <PARTYLEDGERNAME>M/s Mehta &amp; Co</PARTYLEDGERNAME>
          <BASICDUEDATEOFPYMT>30 Days</BASICDUEDATEOFPYMT>
          <ISOPTIONAL>No</ISOPTIONAL>
          <ISCANCELLED>No</ISCANCELLED>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>CGST Output 9%</LEDGERNAME>
            <ISPARTYLEDGER>No</ISPARTYLEDGER>
            <AMOUNT>1132.63</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>SGST Output 9%</LEDGERNAME>
            <ISPARTYLEDGER>No</ISPARTYLEDGER>
            <AMOUNT>1132.63</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>M/s Mehta &amp; Co</LEDGERNAME>
            <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
            <AMOUNT>-14850.00</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>
      </TALLYMESSAGE>
      <TALLYMESSAGE>
        <VOUCHER VCHTYPE="Sales" ACTION="Create">
          <GUID>guid-optional-quote</GUID>
          <ALTERID>413</ALTERID>
          <DATE>20261016</DATE>
          <VOUCHERNUMBER>QTN-999</VOUCHERNUMBER>
          <PARTYLEDGERNAME>Proforma Buyer</PARTYLEDGERNAME>
          <ISOPTIONAL>Yes</ISOPTIONAL>
          <AMOUNT>-5000.00</AMOUNT>
        </VOUCHER>
      </TALLYMESSAGE>
      <TALLYMESSAGE>
        <VOUCHER VCHTYPE="Sales" ACTION="Alter">
          <GUID>guid-cancelled-102</GUID>
          <ALTERID>415</ALTERID>
          <DATE>20261016</DATE>
          <VOUCHERNUMBER>GST/26-27/102</VOUCHERNUMBER>
          <PARTYLEDGERNAME>M/s Mehta &amp; Co</PARTYLEDGERNAME>
          <ISCANCELLED>Yes</ISCANCELLED>
          <AMOUNT>0.00</AMOUNT>
        </VOUCHER>
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>`;

    const parsed = parseTallyXmlEnvelope(sampleXml);
    expect(parsed.detectedCompanyName).toBe("Shah & Sons Distributors FY26");
    expect(parsed.skippedOptionalCount).toBe(1);
    expect(parsed.maxAlterId).toBe(415);
    expect(parsed.vouchers).toHaveLength(2);

    const salesVch = parsed.vouchers[0]!;
    expect(salesVch.voucherNumber).toBe("GST/26-27/101");
    expect(salesVch.voucherType).toBe("Sales");
    expect(salesVch.partyName).toBe("M/s Mehta & Co");
    expect(salesVch.partyPhone).toBe("9876543210");
    // Must extract party control total 14850.00, NOT the first CGST ledger line 1132.63!
    expect(salesVch.amountRupees).toBe(14850);
    expect(salesVch.isCancelled).toBe(false);
    // 30 Days after 2026-10-15 UTC -> 2026-11-14 UTC
    expect(new Date(salesVch.dueDate!).toISOString().slice(0, 10)).toBe("2026-11-14");

    const cancelledVch = parsed.vouchers[1]!;
    expect(cancelledVch.voucherNumber).toBe("GST/26-27/102");
    expect(cancelledVch.isCancelled).toBe(true);

    // Verify full DB ingestion marks cancelled voucher as 'cancelled' and excludes it from pending receivables
    const { session } = createTestWorkspace("XmlIngest");
    const result = await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: session.workspace.id,
      actorType: "webhook",
      actorId: "tally-webhook-test",
      rawPayload: sampleXml,
      sourceLabel: "webhook",
    });

    expect(result.upserted).toBe(2);
    expect(result.skippedOptionalCount).toBe(1);
    expect(result.vouchers.find((v) => v.voucherNumber === "GST/26-27/101")?.paymentStatus).toBe(
      "unpaid"
    );
    expect(result.vouchers.find((v) => v.voucherNumber === "GST/26-27/102")?.paymentStatus).toBe(
      "cancelled"
    );

    const summary = getTallyWorkspaceSummary(session.workspace.id);
    expect(summary.totals.totalBilledPaise).toBe(1485000);
  });

  it("generates authentic Tally Prime .tdl add-on and standalone Windows connector pointing to rapidshiftlabs.in", () => {
    const tdl = generateTallyPrimeTdlAddOn({
      workspaceName: "Shah Traders",
      webhookUrl: "https://shah-traders.tally.rapidshiftlabs.in/api/webhooks/tally",
      webhookToken: "tlwh_testtoken123456",
    });

    expect(tdl).toContain("[#Menu: Gateway of Tally]");
    expect(tdl).toContain('"Shah Traders & RSL Sync - Connection Test"');
    expect(tdl).toContain("[#Form: Voucher]");
    expect(tdl).toContain("Add : On : Form Accept : Yes : Form Accept");
    expect(tdl).toContain("Walk Collection : RSLCloudPingCheck");
    expect(tdl).toContain('JSON Object Path: "tallyResult:1"');
    expect(tdl).toContain("[Collection: RSLCloudVoucherPost]");
    expect(tdl).toContain(
      'Data Source     : HTTP JSON : "https://shah-traders.tally.rapidshiftlabs.in/api/webhooks/tally?token=tlwh_testtoken123456"'
    );
    expect(tdl).toContain('Header          : "X-Tally-Webhook-Token: tlwh_testtoken123456"');
    expect(tdl).toContain('Header          : "User-Agent: TallyPrime-RSL-TDL/2.7"');
    expect(tdl).toContain('"Shah Traders & RSL Sync - Sync All Now"');
    expect(tdl).toContain("[System: Variable]");
    expect(tdl).toContain("Start Progress");
    expect(tdl).not.toContain("Else If");
    expect(tdl).toContain("Plain JSON          : Yes");
    expect(tdl).toContain("$Parent:VoucherType:$VoucherTypeName");
    expect(tdl).not.toContain("localhost:4500");

    const connectorMjs = generateStandaloneTallyConnectorMjs({
      serverUrl: "https://shah-traders.tally.rapidshiftlabs.in",
      workspaceName: "Shah Traders",
    });
    expect(connectorMjs).toContain(
      'const DEFAULT_SERVER_URL = "https://shah-traders.tally.rapidshiftlabs.in"'
    );
    expect(connectorMjs).toContain("/api/agent/pair");
    expect(connectorMjs).toContain("/api/agent/heartbeat");
    expect(connectorMjs).toContain("/api/agent/ingest");
    expect(connectorMjs).toContain("RSLSyncVouchers");
  });

  it("tracks truthful live statuses across webhook handshakes, errors, pause/resume, and PC connector heartbeats", async () => {
    const { session } = createTestWorkspace("LiveStatus");
    const wsId = session.workspace.id;
    staffGrantFreeAllToolsAccess({
      workspaceId: wsId,
      durationDays: 30,
      staffId: "stf_phase16_test",
    });

    // 1. Fresh endpoint starts in 'awaiting_first_event' (never falsely 'Active')
    const ep0 = getOrCreateTallyWebhookEndpoint(wsId);
    expect(computeTallyWebhookLiveStatus(ep0).state).toBe("awaiting_first_event");

    // 2. Non-destructive HTTP GET & POST ?mode=ping handshake checks transition status to 'handshake_verified'
    const discoveryRes = await tallyWebhookGet(
      new NextRequest("http://localhost:4500/api/webhooks/tally", {
        headers: {
          "x-forwarded-host": "shah-traders.tally.rapidshiftlabs.in",
          "x-forwarded-proto": "https",
        },
      })
    );
    expect(discoveryRes.status).toBe(200);
    const discoveryBody = (await discoveryRes.json()) as { endpoint: string; ok: boolean };
    expect(discoveryBody.ok).toBe(true);
    expect(discoveryBody.endpoint).toBe(
      "https://shah-traders.tally.rapidshiftlabs.in/api/webhooks/tally"
    );

    // v2.5 Tally Prime TDL ping check receives boolean ok=true AND tallyResult[0].RSLOkStatus === "Connected"
    const pingPostRes = await tallyWebhookPost(
      new NextRequest(
        `https://shah-traders.tally.rapidshiftlabs.in/api/webhooks/tally?mode=ping&token=${encodeURIComponent(ep0.webhookToken)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "TallyPrime-RSL-TDL/2.5",
          },
          body: JSON.stringify({ mode: "ping", companyName: "LiveStatus Traders FY26" }),
        }
      )
    );
    expect(pingPostRes.status).toBe(200);
    const pingJson = (await pingPostRes.json()) as {
      ok: boolean;
      tallyResult: Array<{ RSLOkStatus: string; RSLMessage: string }>;
    };
    expect(pingJson.ok).toBe(true);
    expect(pingJson.tallyResult[0]?.RSLOkStatus).toBe("Connected");
    expect(pingJson.tallyResult[0]?.RSLMessage).toContain("LiveStatus Traders FY26");

    // Legacy v2.0 Tally Prime TDL (JSON Object Path: "ok:1") also receives ok[0].RSLOkStatus === "Connected"
    const legacyPingRes = await tallyWebhookPost(
      new NextRequest(
        `https://shah-traders.tally.rapidshiftlabs.in/api/webhooks/tally?mode=ping&token=${encodeURIComponent(ep0.webhookToken)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "TallyPrime-RSL-TDL/2.0",
          },
          body: JSON.stringify({ mode: "ping", companyName: "LiveStatus Traders FY26" }),
        }
      )
    );
    expect(legacyPingRes.status).toBe(200);
    const legacyJson = (await legacyPingRes.json()) as {
      ok: Array<{ RSLOkStatus: string }>;
    };
    expect(Array.isArray(legacyJson.ok)).toBe(true);
    expect(legacyJson.ok[0]?.RSLOkStatus).toBe("Connected");

    const sumAfterPing = getTallyWorkspaceSummary(wsId);
    expect(sumAfterPing.webhookLiveStatus.state).toBe("handshake_verified");
    expect(sumAfterPing.connectionOverview.overallState).toBe("handshake_ready");

    // Direct helper ping check also increments pingsReceivedCount cleanly
    recordTallyWebhookPing({
      endpointId: ep0.id,
      sourceIp: "103.21.58.12",
      userAgent: "TallyPrime-RSL-TDL/2.1",
    });

    // 3. Real voucher delivery (including comma-formatted Tally amount string) transitions status to 'receiving_live'
    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: ep0.id,
      rawPayload: {
        voucherNumber: "INV-501",
        voucherType: "Sales",
        partyName: "Patel Hardware",
        partyPhone: "9811122233",
        amountRupees: "4,200.00",
      },
      sourceLabel: "webhook",
    });
    const sumAfterEvent = getTallyWorkspaceSummary(wsId);
    expect(sumAfterEvent.webhookLiveStatus.state).toBe("receiving_live");
    expect(sumAfterEvent.connectionOverview.overallState).toBe("live_connected");
    expect(sumAfterEvent.totals.totalBilledPaise).toBe(420000);

    // 4. Subsequent malformed payload error surfaces 'error' state
    await new Promise((r) => setTimeout(r, 5));
    recordTallyWebhookError({
      endpointId: ep0.id,
      errorMessage: "Malformed XML envelope on line 4",
    });
    expect(getTallyWorkspaceSummary(wsId).webhookLiveStatus.state).toBe("error");

    // 5. Pausing webhook transitions status to 'paused' and returns HTTP 403 on incoming POST
    const pauseRes = await toggleTallyWebhookEndpoint(session.ctx, { enabled: false });
    expect(pauseRes.ok).toBe(true);
    expect(getTallyWorkspaceSummary(wsId).webhookLiveStatus.state).toBe("paused");

    const pausedPostRes = await tallyWebhookPost(
      new NextRequest("https://shah-traders.tally.rapidshiftlabs.in/api/webhooks/tally", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tally-webhook-token": ep0.webhookToken,
        },
        body: JSON.stringify({ voucherNumber: "INV-502", partyName: "Test", amountRupees: 100 }),
      })
    );
    expect(pausedPostRes.status).toBe(403);

    const resumeRes = await toggleTallyWebhookEndpoint(session.ctx, { enabled: true });
    expect(resumeRes.ok).toBe(true);

    // 6. Windows PC Connector lifecycle: pair -> tally_unreachable -> connected -> stale offline -> unpair
    const pairCodeRes = await generateTallyPairingCode(session.ctx, {});
    expect(pairCodeRes.ok).toBe(true);
    if (!pairCodeRes.ok) throw new Error("Expected pairing code generation to succeed");
    const paired = exchangePairingCodeForAgentDevice({
      pairingCode: pairCodeRes.data.pairingCode,
      deviceName: "Accounts-PC-01",
      osVersion: "Windows 11 Pro",
      agentVersion: "2.0.0",
    });

    recordAgentHeartbeat({
      deviceId: paired.deviceId,
      tallyReachable: false,
      tallyHost: "127.0.0.1",
      tallyPort: 9000,
      lastErrorMessage: "ECONNREFUSED 127.0.0.1:9000",
    });
    let wsConns = listWorkspaceConnections(wsId);
    expect(wsConns.tallyDevices[0]?.status).toBe("tally_unreachable");

    recordAgentHeartbeat({
      deviceId: paired.deviceId,
      tallyReachable: true,
      tallyHost: "127.0.0.1",
      tallyPort: 9000,
      activeCompanyName: "LiveStatus Traders FY26",
      lastAlterId: 88,
    });
    wsConns = listWorkspaceConnections(wsId);
    expect(wsConns.tallyDevices[0]?.status).toBe("online");
    expect(wsConns.tallyDevices[0]?.activeCompanyName).toBe("LiveStatus Traders FY26");

    // Verify heartbeat staleness (> 120s) transitions computed device state to 'offline'
    const staleCheck = computeAgentDeviceLiveStatus(
      {
        status: "online",
        tallyReachable: true,
        lastHeartbeatAt: Date.now() - AGENT_HEARTBEAT_STALE_MS - 5_000,
      },
      Date.now()
    );
    expect(staleCheck.state).toBe("offline");
    expect(staleCheck.isOnline).toBe(false);

    // Unpairing device hides it from active workspace connections & Tally devices list
    const revokeRes = await revokeTallyAgentDevice(session.ctx, { deviceId: paired.deviceId });
    expect(revokeRes.ok).toBe(true);
    expect(listWorkspaceConnections(wsId).tallyDevices).toHaveLength(0);
    expect(getTallyWorkspaceSummary(wsId).devices).toHaveLength(0);
  });
});
