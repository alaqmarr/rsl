import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import {
  addOrInviteTeamMember,
  listWorkspaceTeam,
  registerUserWithWorkspace,
  resolveUserSessionFromToken,
  updateWorkspaceMemberRole,
} from "@rsl/auth";
import {
  canDebitWalletUsage,
  consumeUsage,
  getWalletAvailableSpendPaise,
  getWalletBalancePaise,
  MIN_WALLET_BALANCE_PAISE,
  staffGrantFreeAllToolsAccess,
  WALLET_OVERDRAFT_LIMIT_PAISE,
} from "@rsl/billing";
import { formatInr, resolvePublicEndpoints } from "@rsl/core";
import { tenantDataSchema } from "@rsl/database";
import { enqueueWorkspaceSslProvisioning } from "@rsl/queue";
import {
  canPermissionsAccessWebRoute,
  canStaffAccessAdminRoute,
  canStaffPerform,
  getPermissionsForRole,
  SYSTEM_ROLES,
} from "@rsl/rbac";
import {
  buildSignedTallyVoucherPdfUrl,
  generateStandaloneTallyConnectorMjs,
  generateTallyPrimeTdlAddOn,
  getNativeTallyVoucherPdf,
  getOrCreateTallyWebhookEndpoint,
  getTallyWorkspaceSummary,
  ingestTallyBillEventAndEnqueueAutomation,
  reconcileTallyCompanySnapshot,
  reconcileTallySyncBatch,
  saveNativeTallyVoucherPdf,
  saveTallyCompanyRouting,
  verifySignedTallyVoucherPdfToken,
} from "@rsl/tally";
import { tenantDataDb, validateManagedClientSubdomainHost } from "@rsl/tenancy";
import { executeWhatsAppTemplateSend, installStarterTallyTemplates } from "@rsl/whatsapp";
import { GET as publicTallyPdfGet } from "../app/api/public/tally-invoice/[workspaceId]/[voucherId]/[filename]/route";
import { GET as tallyWebhookGet } from "../app/api/webhooks/tally/route";

function createTestWorkspace(tag: string) {
  const email = `${tag.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 10000)}@rapidshiftlabs.in`;
  const reg = registerUserWithWorkspace({
    name: `${tag} Owner`,
    email,
    password: "StrongPassword123!",
    businessName: `${tag} Enterprises`,
    industry: "Manufacturing",
    stateCode: "27",
  });
  const session = resolveUserSessionFromToken(reg.rawSessionToken)!;
  return { email, reg, session };
}

describe("Phase 17 Suite (Client SSL Queue, -₹200 Overdraft, Native Tally PDF Delivery, v2.5 Zero-Colon TDL, Multi-Company & Live Delete/Cancel, Full RBAC)", () => {
  it("provisions client wildcard SSL certificates (*.tally.rapidshiftlabs.in & *.api.rapidshiftlabs.in) via the durable backend queue and rejects invalid hosts", async () => {
    const { session } = createTestWorkspace("SslQueue");
    const ws = session.workspace;

    const endpoints = resolvePublicEndpoints({ workspaceSlug: ws.slug, preferLocal: false });
    expect(endpoints.primaryDomain).toBe("rapidshiftlabs.in");
    expect(endpoints.clientTallySubdomainHost).toBe(`${ws.slug}.tally.rapidshiftlabs.in`);
    expect(endpoints.clientApiSubdomainHost).toBe(`${ws.slug}.api.rapidshiftlabs.in`);

    const provisioned = await enqueueWorkspaceSslProvisioning({
      workspaceId: ws.id,
      workspaceSlug: ws.slug,
      actorType: "system",
      actorId: "test_ssl_worker",
      processInlineIfLocal: true,
    });

    expect(provisioned.certificates).toHaveLength(2);
    expect(provisioned.certificates.map((c) => c.hostname).sort()).toEqual([
      `${ws.slug}.api.rapidshiftlabs.in`,
      `${ws.slug}.tally.rapidshiftlabs.in`,
    ]);
    for (const cert of provisioned.certificates) {
      expect(cert.status).toBe("active");
      expect(cert.expiresAt).toBeGreaterThan(Date.now());
    }

    const renewed = await enqueueWorkspaceSslProvisioning({
      workspaceId: ws.id,
      workspaceSlug: ws.slug,
      forceRenew: true,
      processInlineIfLocal: true,
    });
    expect(renewed.queuedJobs).toBe(2);
    expect(renewed.certificates.every((c) => c.status === "active")).toBe(true);

    expect(() => validateManagedClientSubdomainHost("evil.example.com")).toThrow();
    expect(() => validateManagedClientSubdomainHost("-bad.tally.rapidshiftlabs.in")).toThrow();
  });

  it("allows wallet overdraft down to -₹200.00 (-20,000 paise), formats negative INR cleanly, and blocks at -₹200.01", () => {
    const { session } = createTestWorkspace("Overdraft");
    const wsId = session.workspace.id;

    expect(WALLET_OVERDRAFT_LIMIT_PAISE).toBe(20_000);
    expect(MIN_WALLET_BALANCE_PAISE).toBe(-20_000);
    expect(formatInr(-12550, { showDecimals: true })).toBe("-₹125.50");
    expect(getWalletBalancePaise(wsId)).toBe(0);
    expect(getWalletAvailableSpendPaise(0)).toBe(20_000);

    // Spend ₹125.50 from ₹0.00 -> balance becomes -₹125.50
    consumeUsage({
      workspaceId: wsId,
      serviceKey: "whatsapp.messaging",
      quantity: 1,
      unitCostPaise: 12_550,
      dedupeKey: `od_test_1_${wsId}`,
      description: "WhatsApp template send in overdraft",
      actorId: session.user.id,
    });
    expect(getWalletBalancePaise(wsId)).toBe(-12_550);
    expect(getWalletAvailableSpendPaise(getWalletBalancePaise(wsId))).toBe(7_450);

    // Spend remaining ₹74.50 -> balance hits exact floor -₹200.00 (-20,000 paise)
    consumeUsage({
      workspaceId: wsId,
      serviceKey: "tally.invoicing",
      quantity: 1,
      unitCostPaise: 7_450,
      dedupeKey: `od_test_2_${wsId}`,
      description: "Tally bill send reaching exact -₹200.00 limit",
      actorId: session.user.id,
    });
    expect(getWalletBalancePaise(wsId)).toBe(-20_000);
    expect(canDebitWalletUsage(-20_000, 1)).toBe(false);

    // Next 1 paisa (-₹200.01) must throw RSL-BILL-1001
    expect(() =>
      consumeUsage({
        workspaceId: wsId,
        serviceKey: "whatsapp.messaging",
        quantity: 1,
        unitCostPaise: 1,
        dedupeKey: `od_test_3_${wsId}`,
        description: "Exceeds -₹200.00 overdraft floor",
        actorId: session.user.id,
      })
    ).toThrow(/overdraft|wallet|balance/i);
  });

  it("stores, serves, and attaches Tally Prime's exact native printed %PDF-1.x bytes byte-for-byte untouched over WhatsApp", async () => {
    const { session } = createTestWorkspace("NativePdf");
    const wsId = session.workspace.id;
    staffGrantFreeAllToolsAccess({ workspaceId: wsId, durationDays: 30, staffId: "stf_pdf" });
    await installStarterTallyTemplates(session.ctx, {});

    // Non-PDF bytes must be rejected strictly so fake/custom HTML or text can never masquerade as Tally's PDF
    expect(() =>
      saveNativeTallyVoucherPdf({
        workspaceId: wsId,
        voucherGuid: "guid-bad",
        voucherNumber: "INV-BAD",
        pdfBuffer: Buffer.from("<html>Not a Tally PDF</html>", "utf8"),
      })
    ).toThrow(/PDF/i);

    const exactTallyPrintedPdfBytes = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Creator (TallyPrime) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
      "utf8"
    );
    const expectedSha256 = crypto
      .createHash("sha256")
      .update(exactTallyPrintedPdfBytes)
      .digest("hex");

    const ingestRes = await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tally-tdl",
      rawPayload: {
        companyName: "NativePdf Enterprises FY26",
        voucherNumber: "GST/26-27/777",
        voucherType: "Sales",
        guid: "guid-native-777",
        masterId: "777",
        alterId: 19,
        partyName: "Kiran Electricals",
        partyPhone: "9822011223",
        amountRupees: 8500,
        nativePdfBase64: exactTallyPrintedPdfBytes.toString("base64"),
      },
      sourceLabel: "webhook",
    });

    expect(ingestRes.upserted).toBe(1);
    const savedVoucher = ingestRes.vouchers[0]!;
    const storedPdf = getNativeTallyVoucherPdf(wsId, savedVoucher.id);
    expect(storedPdf).not.toBeNull();
    expect(storedPdf!.sha256).toBe(expectedSha256);
    expect(Buffer.compare(storedPdf!.pdfBuffer, exactTallyPrintedPdfBytes)).toBe(0);

    // Verify signed public URL & Next.js route serve exact untouched bytes
    const signedUrl = buildSignedTallyVoucherPdfUrl({
      workspaceId: wsId,
      voucherId: savedVoucher.id,
      filename: storedPdf!.filename,
    });
    const parsedUrl = new URL(signedUrl);
    const exp = Number(parsedUrl.searchParams.get("exp"));
    const sig = parsedUrl.searchParams.get("sig")!;
    expect(
      verifySignedTallyVoucherPdfToken({
        workspaceId: wsId,
        voucherId: savedVoucher.id,
        expiresAt: exp,
        sig,
      })
    ).toBe(true);
    expect(
      verifySignedTallyVoucherPdfToken({
        workspaceId: wsId,
        voucherId: savedVoucher.id,
        expiresAt: exp,
        sig: "tampered" + sig.slice(8),
      })
    ).toBe(false);

    const routeRes = await publicTallyPdfGet(new NextRequest(signedUrl), {
      params: Promise.resolve({
        workspaceId: wsId,
        voucherId: savedVoucher.id,
        filename: storedPdf!.filename,
      }),
    });
    expect(routeRes.status).toBe(200);
    expect(routeRes.headers.get("content-type")).toBe("application/pdf");
    const servedBytes = Buffer.from(await routeRes.arrayBuffer());
    expect(Buffer.compare(servedBytes, exactTallyPrintedPdfBytes)).toBe(0);

    // Verify WhatsApp template dispatcher attaches the native PDF document & records messageAttachments
    const sendRes = await executeWhatsAppTemplateSend({
      workspaceId: wsId,
      templateIdOrName: "tally_sales_bill_created",
      recipientPhone: "9822011223",
      recipientName: "Kiran Electricals",
      variables: {
        "1": "Kiran Electricals",
        "2": "GST/26-27/777",
        "3": "₹8,500.00",
        "4": "NativePdf Enterprises FY26",
      },
      idempotencyKey: `wa_pdf_test_${savedVoucher.id}`,
      actorId: session.user.id,
      linkedVoucherGuid: savedVoucher.guid,
      serviceKey: "tally.invoicing",
      pdfDocument: {
        url: signedUrl,
        filename: storedPdf!.filename,
        caption: "Invoice GST/26-27/777",
        sizeBytes: storedPdf!.byteSize,
      },
    });
    expect(sendRes.sent).toBe(true);
    expect(sendRes.attachedPdfUrl).toBe(signedUrl);

    const attachments = tenantDataDb({ workspaceId: wsId })
      .select()
      .from(tenantDataSchema.messageAttachments)
      .all();
    expect(attachments.some((a) => a.storageKey === signedUrl && a.mimeType === "application/pdf")).toBe(
      true
    );
  });

  it("generates zero-colon procedural [Function: ...] lines in .tdl v2.5, normalizes localhost -> 127.0.0.1, and serves OTA TDL auto-updates", async () => {
    const { session } = createTestWorkspace("ZeroColonTdl");
    const wsId = session.workspace.id;
    const ep = getOrCreateTallyWebhookEndpoint(wsId);

    const localTdl = generateTallyPrimeTdlAddOn({
      workspaceName: "ZeroColon Traders",
      webhookUrl: "http://localhost:4500/api/webhooks/tally",
      webhookToken: ep.webhookToken,
    });
    // Loopback localhost MUST be rewritten to 127.0.0.1 so Tally WinHTTP never hits IPv6 ::1 failures
    expect(localTdl).toContain("http://127.0.0.1:4500/api/webhooks/tally");
    expect(localTdl).not.toContain("http://localhost:4500");

    // Verify ZERO unquoted colons exist inside any [Function: ...] action expression (preventing 'Bad formula!')
    const lines = localTdl.split(/\r?\n/);
    let insideFunctionBlock = false;
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith(";")) continue;
      if (trimmed.startsWith("[")) {
        insideFunctionBlock = /^\[Function\s*:/i.test(trimmed);
        continue;
      }
      if (!insideFunctionBlock) continue;
      if (/^(Variable|Parameter|Local Formula|Returns)\s*:/i.test(trimmed)) continue;

      if (/^\d+\s*:/.test(trimmed)) {
        // Strip quoted strings before counting structural colons; every procedural step must not use $$Fn:Arg unquoted colons
        const withoutQuotes = trimmed.replace(/"[^"]*"/g, '""');
        expect(withoutQuotes).not.toMatch(/\$\$[A-Za-z0-9_]+\s*:/);
      }
    }

    // Verify Over-The-Air TDL manifest & latest download endpoints + self-updating connector v2.2
    const manifestRes = await tallyWebhookGet(
      new NextRequest(
        `https://zerocolon.tally.rapidshiftlabs.in/api/webhooks/tally?mode=tdl-manifest&token=${encodeURIComponent(ep.webhookToken)}`
      )
    );
    expect(manifestRes.status).toBe(200);
    const manifestJson = (await manifestRes.json()) as {
      ok: boolean;
      tdlVersion: string;
      sha256: string;
    };
    expect(manifestJson.ok).toBe(true);
    expect(manifestJson.tdlVersion).toBe("2.8");
    expect(manifestJson.sha256).toHaveLength(64);

    const latestTdlRes = await tallyWebhookGet(
      new NextRequest(
        `https://zerocolon.tally.rapidshiftlabs.in/api/webhooks/tally?mode=tdl-latest&token=${encodeURIComponent(ep.webhookToken)}`
      )
    );
    expect(latestTdlRes.status).toBe(200);
    const latestTdlText = await latestTdlRes.text();
    expect(latestTdlText).toContain("TallyPrime-RSL-TDL/2.8");

    const connector = generateStandaloneTallyConnectorMjs({
      serverUrl: "https://zerocolon.tally.rapidshiftlabs.in",
      workspaceName: "ZeroColon Traders",
    });
    expect(connector).toContain("mode=tdl-manifest");
    expect(connector).toContain("RSLNativeVoucherPrint");
  });

  it("isolates multiple Tally companies and reflects live Create, Update, Cancel (Alt+X), Optional conversion, and Delete (Alt+D & Day Book reconcile)", async () => {
    const { session } = createTestWorkspace("MultiCompLifecycle");
    const wsId = session.workspace.id;
    staffGrantFreeAllToolsAccess({ workspaceId: wsId, durationDays: 30, staffId: "stf_mc" });

    // 1. Two companies in the same Tally with identical raw GUID "guid-100" must NOT overwrite each other
    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "Branch Alpha FY26",
        guid: "guid-100",
        voucherNumber: "ALPHA/001",
        voucherType: "Sales",
        partyName: "Buyer One",
        amountRupees: 5000,
      },
    });
    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "Branch Beta FY26",
        guid: "guid-100",
        voucherNumber: "BETA/001",
        voucherType: "Sales",
        partyName: "Buyer Two",
        amountRupees: 9000,
      },
    });

    let summary = getTallyWorkspaceSummary(wsId);
    expect(summary.companies).toHaveLength(2);
    expect(summary.vouchers).toHaveLength(2);
    expect(summary.totals.totalBilledPaise).toBe(1_400_000);

    // 2. Update ALPHA/001 amount from ₹5,000 -> ₹6,200
    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "Branch Alpha FY26",
        guid: "guid-100",
        voucherNumber: "ALPHA/001",
        voucherType: "Sales",
        partyName: "Buyer One",
        amountRupees: 6200,
        alterId: 12,
      },
    });
    summary = getTallyWorkspaceSummary(wsId);
    expect(summary.totals.totalBilledPaise).toBe(1_520_000);

    // 3. Cancel ALPHA/001 via Alt+X (isCancelled: "Yes") -> marked 'cancelled' & excluded from receivables
    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "Branch Alpha FY26",
        guid: "guid-100",
        voucherNumber: "ALPHA/001",
        voucherType: "Sales",
        partyName: "Buyer One",
        amountRupees: 0,
        isCancelled: "Yes",
      },
    });
    summary = getTallyWorkspaceSummary(wsId);
    expect(summary.vouchers.find((v) => v.voucherNumber === "ALPHA/001")?.paymentStatus).toBe(
      "cancelled"
    );
    expect(summary.totals.totalBilledPaise).toBe(900_000);

    // 4. Delete ALPHA/001 via Alt+D (isDeleted: "Yes") -> removed completely from Branch Alpha while BETA/001 stays intact
    const delRes = await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "Branch Alpha FY26",
        guid: "guid-100",
        voucherNumber: "ALPHA/001",
        voucherType: "Sales",
        isDeleted: "Yes",
      },
    });
    expect(delRes.deletedCount).toBe(1);
    expect(getTallyWorkspaceSummary(wsId).vouchers).toHaveLength(1);

    // 5. Reconcile empty sync batch for Branch Beta (when last remaining bill was deleted from Day Book) -> 0 bills remain
    const batchRec = reconcileTallySyncBatch({
      workspaceId: wsId,
      companyName: "Branch Beta FY26",
      syncBatchId: "b_empty_daybook",
      actorType: "webhook",
      actorId: "tdl",
    });
    expect(batchRec.deletedCount).toBe(1);
    expect(getTallyWorkspaceSummary(wsId).vouchers).toHaveLength(0);

    // 6. Selected-company routing filter ignores unapproved companies while accepting selected ones
    const routeSave = await saveTallyCompanyRouting(session.ctx, {
      mode: "selected",
      allowedCompanyNames: ["Branch Alpha FY26"],
    });
    expect(routeSave.ok).toBe(true);

    const ignoredRes = await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "Personal Books FY26",
        guid: "guid-personal-1",
        voucherNumber: "PER/001",
        voucherType: "Sales",
        partyName: "Private",
        amountRupees: 1500,
      },
    });
    expect(ignoredRes.ignoredCompanyCount).toBe(1);
    expect(ignoredRes.upserted).toBe(0);

    // Also verify reconcileTallyCompanySnapshot directly
    const snap = reconcileTallyCompanySnapshot({
      workspaceId: wsId,
      companyName: "Personal Books FY26",
      activeCanonicalGuids: [],
      actorType: "webhook",
      actorId: "tdl",
    });
    expect(snap.ignoredCompany).toBe(true);
  });

  it("enforces Customer Web RBAC across all 6 roles, prevents non-owner privilege escalation, and enforces Staff Console RBAC across super_admin / finance / support", () => {
    const { session } = createTestWorkspace("RbacMatrix");
    const wsId = session.workspace.id;

    expect(SYSTEM_ROLES.map((r) => r.slug)).toEqual([
      "owner",
      "admin",
      "manager",
      "agent",
      "analyst",
      "billing",
    ]);

    const ownerPerms = getPermissionsForRole("owner", wsId);
    const adminPerms = getPermissionsForRole("admin", wsId);
    const managerPerms = getPermissionsForRole("manager", wsId);
    const agentPerms = getPermissionsForRole("agent", wsId);
    const analystPerms = getPermissionsForRole("analyst", wsId);
    const billingPerms = getPermissionsForRole("billing", wsId);

    // Customer route matrix verification
    expect(canPermissionsAccessWebRoute(ownerPerms, "/settings/api-keys")).toBe(true);
    expect(canPermissionsAccessWebRoute(adminPerms, "/settings/team")).toBe(true);

    // Agent can access /inbox, NOT /billing, /tally, /developers, or /settings/api-keys
    expect(canPermissionsAccessWebRoute(agentPerms, "/inbox")).toBe(true);
    expect(canPermissionsAccessWebRoute(agentPerms, "/billing")).toBe(false);
    expect(canPermissionsAccessWebRoute(agentPerms, "/tally")).toBe(false);
    expect(canPermissionsAccessWebRoute(agentPerms, "/developers")).toBe(false);
    expect(canPermissionsAccessWebRoute(agentPerms, "/settings/api-keys")).toBe(false);

    // Billing/Accountant can access /billing & /tally, NOT /campaigns or /developers
    expect(canPermissionsAccessWebRoute(billingPerms, "/billing")).toBe(true);
    expect(canPermissionsAccessWebRoute(billingPerms, "/tally")).toBe(true);
    expect(canPermissionsAccessWebRoute(billingPerms, "/campaigns")).toBe(false);
    expect(canPermissionsAccessWebRoute(billingPerms, "/developers")).toBe(false);
    expect(canPermissionsAccessWebRoute(billingPerms, "/settings/api-keys")).toBe(false);

    // Analyst has read-only view across /analytics & /billing (without billing:manage), and CANNOT access /settings/team
    expect(canPermissionsAccessWebRoute(analystPerms, "/analytics")).toBe(true);
    expect(canPermissionsAccessWebRoute(analystPerms, "/billing")).toBe(true);
    expect(analystPerms.has("billing:manage")).toBe(false);
    expect(canPermissionsAccessWebRoute(analystPerms, "/settings/team")).toBe(false);

    // Manager can access /campaigns & /tally, NOT /billing, /developers, or /settings/api-keys
    expect(canPermissionsAccessWebRoute(managerPerms, "/campaigns")).toBe(true);
    expect(canPermissionsAccessWebRoute(managerPerms, "/billing")).toBe(false);
    expect(canPermissionsAccessWebRoute(managerPerms, "/developers")).toBe(false);
    expect(canPermissionsAccessWebRoute(managerPerms, "/settings/api-keys")).toBe(false);

    // Privilege escalation guard: an 'admin' CANNOT invite or promote anyone to 'owner'
    expect(() =>
      addOrInviteTeamMember({
        workspaceId: wsId,
        email: `escalate-${Date.now()}@rapidshiftlabs.in`,
        name: "Escalated User",
        roleSlug: "owner",
        invitedByUserId: session.user.id,
        initialPassword: "Password123!",
        actorRoleSlug: "admin",
      })
    ).toThrow(/Owner/i);

    addOrInviteTeamMember({
      workspaceId: wsId,
      email: `agent-${Date.now()}@rapidshiftlabs.in`,
      name: "Support Agent",
      roleSlug: "agent",
      invitedByUserId: session.user.id,
      initialPassword: "Password123!",
      actorRoleSlug: "admin",
    });
    const agentMember = listWorkspaceTeam(wsId).members.find((m) => m.roleSlug === "agent")!;
    expect(() =>
      updateWorkspaceMemberRole({
        workspaceId: wsId,
        membershipId: agentMember.membershipId,
        roleSlug: "owner",
        actorRoleSlug: "admin",
      })
    ).toThrow(/Owner/i);

    // Staff Console RBAC verification across super_admin, finance, and support
    expect(canStaffAccessAdminRoute("super_admin", "/staff")).toBe(true);
    expect(canStaffAccessAdminRoute("super_admin", "/pricing")).toBe(true);
    expect(canStaffAccessAdminRoute("super_admin", "/queues")).toBe(true);

    expect(canStaffAccessAdminRoute("finance", "/invoices")).toBe(true);
    expect(canStaffAccessAdminRoute("finance", "/pricing")).toBe(true);
    expect(canStaffAccessAdminRoute("finance", "/queues")).toBe(false);
    expect(canStaffAccessAdminRoute("finance", "/staff")).toBe(false);
    expect(canStaffPerform("finance", "staff:billing.manage")).toBe(true);
    expect(canStaffPerform("finance", "staff:impersonate")).toBe(false);

    expect(canStaffAccessAdminRoute("support", "/templates")).toBe(true);
    expect(canStaffAccessAdminRoute("support", "/queues")).toBe(true);
    expect(canStaffAccessAdminRoute("support", "/inspector")).toBe(true);
    expect(canStaffAccessAdminRoute("support", "/invoices")).toBe(false);
    expect(canStaffAccessAdminRoute("support", "/pricing")).toBe(false);
    expect(canStaffAccessAdminRoute("support", "/staff")).toBe(false);
    expect(canStaffPerform("support", "staff:impersonate")).toBe(true);
    expect(canStaffPerform("support", "staff:billing.manage")).toBe(false);
  });
});
