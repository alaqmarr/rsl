import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getWorkspaceAnalytics } from "@rsl/analytics";
import { authenticatePublicApiKey, issueApiKey } from "@rsl/api-keys";
import { registerUserWithWorkspace } from "@rsl/auth";
import {
  createSignedEncryptedBackup,
  readLocalBackupBundleBytes,
  restoreSignedEncryptedBackup,
} from "@rsl/backup";
import {
  activateServiceEntitlement,
  creditWallet,
  getWalletBalancePaise,
} from "@rsl/billing";
import { newEntityId } from "@rsl/core";
import { tenantDataSchema, tenantLogsSchema } from "@rsl/database";
import { verifyTenantHashChain } from "@rsl/logging";
import { reserveSendGuard } from "@rsl/queue";
import { putWorkspaceObject, readWorkspaceObjectBytes } from "@rsl/storage";
import { bulkImportTallyData, exportTallyVouchersAsXml } from "@rsl/tally";
import {
  closeAllHandlesForShutdown,
  controlDb,
  resolveSafeTenantDir,
  tenantDataDb,
  tenantLogsDb,
} from "@rsl/tenancy";
import { addWhatsAppUnsubscribedNumber } from "@rsl/whatsapp";

describe("RSL Marketing Platform — Core Security, Tenancy, Tally, Backup & Ledger Invariants", () => {
  let tenantA: { userId: string; workspaceId: string };
  let tenantB: { userId: string; workspaceId: string };

  beforeAll(() => {
    tenantA = registerUserWithWorkspace({
      name: "Aarav Patel",
      email: "aarav@shreetraders.in",
      password: "Password_1234",
      businessName: "Shree Traders",
      stateCode: "27",
    });

    tenantB = registerUserWithWorkspace({
      name: "Meera Nair",
      email: "meera@malabarspices.in",
      password: "Password_1234",
      businessName: "Malabar Spices",
      stateCode: "32",
    });
  });

  afterAll(() => {
    closeAllHandlesForShutdown();
    if (process.env.RSL_TEST_TEMP_ROOT) {
      fs.rmSync(process.env.RSL_TEST_TEMP_ROOT, { recursive: true, force: true });
    }
  });

  it("generates meaningful client-slugged time-sortable IDs and blocks path traversal", () => {
    expect(tenantA.workspaceId.startsWith("biz_shreetra_")).toBe(true);
    const voucherId = newEntityId("tvch", tenantA.workspaceId);
    expect(voucherId.startsWith("tvch_shreetra_")).toBe(true);

    expect(() => resolveSafeTenantDir("../platform")).toThrow();
    expect(() => resolveSafeTenantDir("../../etc/passwd")).toThrow();
  });

  it("guarantees physical SQLite file isolation and honest zero-state analytics on fresh workspace", () => {
    const analyticsB = getWorkspaceAnalytics(tenantB.workspaceId, "30d");
    expect(analyticsB.hasAnyData).toBe(false);
    expect(analyticsB.kpis.walletBalancePaise).toBe(0);
    expect(analyticsB.kpis.moneyCollectedPaise).toBe(0);
    expect(analyticsB.kpis.contactsTotalCount).toBe(0);

    // Insert contact into Tenant A and verify Tenant B still sees 0 contacts
    tenantDataDb({ workspaceId: tenantA.workspaceId })
      .insert(tenantDataSchema.contacts)
      .values({
        id: newEntityId("cnt", tenantA.workspaceId),
        name: "Sunrise Hardware",
        phoneE164: "+919820012345",
        tagsJson: "[]",
        lifetimeValuePaise: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();

    const rowsB = tenantDataDb({ workspaceId: tenantB.workspaceId })
      .select()
      .from(tenantDataSchema.contacts)
      .all();
    expect(rowsB.length).toBe(0);
  });

  it("enforces append-only SQLite triggers on wallet ledger_entries and tamper-evident SHA-256 action_logs", () => {
    const topup = creditWallet({
      workspaceId: tenantA.workspaceId,
      amountPaise: 500000, // ₹5,000
      description: "Initial Wallet Top-Up",
      idempotencyKey: "topup_001",
      actorId: tenantA.userId,
      createInvoice: true,
    });
    expect(topup.balancePaise).toBe(500000);
    expect(topup.invoiceNumber).toMatch(/^RSL\/\d{2}-\d{2}\/0001$/);

    // Attempting UPDATE or DELETE on ledger_entries MUST fail via SQLite trigger
    const rawCtrl = controlDb().$client;
    expect(() =>
      rawCtrl.prepare("UPDATE ledger_entries SET amount_paise = 99999999").run()
    ).toThrow(/append-only|immutable/i);
    expect(() => rawCtrl.prepare("DELETE FROM ledger_entries").run()).toThrow(/append-only|immutable/i);

    // Attempting UPDATE on action_logs MUST fail via SQLite trigger
    const rawLogs = tenantLogsDb({ workspaceId: tenantA.workspaceId }).$client;
    expect(() =>
      rawLogs.prepare("UPDATE action_logs SET summary = 'tampered'").run()
    ).toThrow(/immutable|append-only/i);

    const chain = verifyTenantHashChain(tenantA.workspaceId);
    expect(chain.valid).toBe(true);
    expect(chain.rowCount).toBeGreaterThanOrEqual(1);
  });

  it("enforces service dependency graph before activating dependent plans", () => {
    // tally.invoicing depends on tally.sync + whatsapp.messaging
    expect(() =>
      activateServiceEntitlement({
        workspaceId: tenantA.workspaceId,
        serviceKey: "tally.invoicing",
        actorId: tenantA.userId,
      })
    ).toThrow(/activate/i);

    activateServiceEntitlement({
      workspaceId: tenantA.workspaceId,
      serviceKey: "tally.sync",
      actorId: tenantA.userId,
    });
    activateServiceEntitlement({
      workspaceId: tenantA.workspaceId,
      serviceKey: "whatsapp.messaging",
      actorId: tenantA.userId,
    });
    const unlocked = activateServiceEntitlement({
      workspaceId: tenantA.workspaceId,
      serviceKey: "tally.invoicing",
      actorId: tenantA.userId,
    });
    expect(unlocked.entitlementId).toBeTruthy();
  });

  it("round-trips Tally Prime XML import & export accurately", async () => {
    const ctxA = {
      workspaceId: tenantA.workspaceId,
      actorType: "user" as const,
      actorId: tenantA.userId,
      roleSlug: "owner",
      correlationId: "corr_tally_1",
      requestId: "req_tally_1",
    };

    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <BODY>
    <IMPORTDATA>
      <REQUESTDATA>
        <TALLYMESSAGE>
          <VOUCHER VCHTYPE="Sales" ACTION="Create">
            <GUID>guid-shree-inv-101</GUID>
            <DATE>20260415</DATE>
            <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
            <VOUCHERNUMBER>GST/26-27/101</VOUCHERNUMBER>
            <PARTYLEDGERNAME>Kiran Electronics</PARTYLEDGERNAME>
            <RSLPARTYPHONE>+919820099887</RSLPARTYPHONE>
            <ALLLEDGERENTRIES.LIST>
              <AMOUNT>-18500.00</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

    const res = await bulkImportTallyData(ctxA, {
      companyName: "Shree Traders FY26",
      format: "tally_xml",
      rawContent: sampleXml,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.importedCount).toBe(1);
    }

    const exportedXml = exportTallyVouchersAsXml(tenantA.workspaceId);
    expect(exportedXml).toContain("GST/26-27/101");
    expect(exportedXml).toContain("Kiran Electronics");
  });

  it("verifies signed encrypted backups, blocks tampered bundles, and preserves Wallet + Unsubscribed numbers across restore", async () => {
    const ctxA = {
      workspaceId: tenantA.workspaceId,
      actorType: "user" as const,
      actorId: tenantA.userId,
      roleSlug: "owner",
      correlationId: "corr_bkp_1",
      requestId: "req_bkp_1",
    };

    // 1. Create backup when Tenant A has 1 contact
    const bkpRes = await createSignedEncryptedBackup(ctxA, {
      destinationLabel: "Test Vault",
    });
    expect(bkpRes.ok).toBe(true);
    if (!bkpRes.ok) return;

    const rawBundleText = readLocalBackupBundleBytes(
      tenantA.workspaceId,
      bkpRes.data.backupId
    ).toString("utf8");

    // 2. Add a post-backup contact in data.db AND an unsubscribed number + SendGuard in logs/current.db
    tenantDataDb({ workspaceId: tenantA.workspaceId })
      .insert(tenantDataSchema.contacts)
      .values({
        id: newEntityId("cnt", tenantA.workspaceId),
        name: "Post-Backup Temporary Contact",
        phoneE164: "+919820055555",
        tagsJson: "[]",
        lifetimeValuePaise: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();

    await addWhatsAppUnsubscribedNumber(ctxA, {
      phoneE164: "+919820077777",
      reason: "Customer replied STOP",
    });

    const guardFirst = reserveSendGuard({
      workspaceId: tenantA.workspaceId,
      idempotencyKey: "msg_dedupe_999",
      channel: "whatsapp",
      recipient: "+919820012345",
    });
    expect(guardFirst.allowed).toBe(true);

    // 3. Tamper with signature and confirm strict rejection (RSL-BACKUP-1001)
    const tampered = JSON.parse(rawBundleText);
    tampered.signatureHex = "00".repeat(32);
    const badRestore = await restoreSignedEncryptedBackup(ctxA, {
      bundleJsonText: JSON.stringify(tampered),
      confirmPhrase: "RESTORE",
    });
    expect(badRestore.ok).toBe(false);
    if (!badRestore.ok) {
      expect(badRestore.error.code).toBe("RSL-BACKUP-1001");
    }

    // 4. Restore valid signed bundle
    const walletBefore = getWalletBalancePaise(tenantA.workspaceId);
    const goodRestore = await restoreSignedEncryptedBackup(ctxA, {
      bundleJsonText: rawBundleText,
      confirmPhrase: "RESTORE",
    });
    expect(goodRestore.ok).toBe(true);

    // Post-backup contact rolled back to 1 original contact
    const contactsAfter = tenantDataDb({ workspaceId: tenantA.workspaceId })
      .select()
      .from(tenantDataSchema.contacts)
      .all();
    expect(contactsAfter.length).toBe(1);

    // Wallet balance, Unsubscribed numbers, and SendGuard MUST survive untouched!
    expect(getWalletBalancePaise(tenantA.workspaceId)).toBe(walletBefore);
    const suppressionsAfter = tenantLogsDb({ workspaceId: tenantA.workspaceId })
      .select()
      .from(tenantLogsSchema.suppressions)
      .all();
    expect(suppressionsAfter.some((s) => s.identifier === "+919820077777")).toBe(true);

    const guardReplayAfterRestore = reserveSendGuard({
      workspaceId: tenantA.workspaceId,
      idempotencyKey: "msg_dedupe_999",
      channel: "whatsapp",
      recipient: "+919820012345",
    });
    expect(guardReplayAfterRestore.allowed).toBe(false);
  });

  it("stores and verifies workspace objects and authenticates client-prefixed API keys", async () => {
    const obj = await putWorkspaceObject({
      workspaceId: tenantA.workspaceId,
      category: "tally_pdf",
      fileName: "GST-101.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("%PDF-1.4 sample invoice bytes", "utf8"),
      actorId: tenantA.userId,
    });
    expect(obj.id.startsWith("ast_shreetra_")).toBe(true);

    const loaded = await readWorkspaceObjectBytes(tenantA.workspaceId, obj.id);
    expect(loaded.bytes.toString("utf8")).toContain("%PDF-1.4");

    activateServiceEntitlement({
      workspaceId: tenantA.workspaceId,
      serviceKey: "api.access",
      actorId: tenantA.userId,
    });

    const ctxA = {
      workspaceId: tenantA.workspaceId,
      actorType: "user" as const,
      actorId: tenantA.userId,
      roleSlug: "owner",
      correlationId: "corr_key_1",
      requestId: "req_key_1",
    };
    const keyRes = await issueApiKey(ctxA, {
      name: "ERP Connector",
      mode: "live",
      scopes: ["contacts:read", "vouchers:read"],
      rateLimitPerMin: 120,
      expiresInDays: 0,
    });
    expect(keyRes.ok).toBe(true);
    if (keyRes.ok) {
      expect(keyRes.data.rawKey).toMatch(/^rsl_live_shreetra[a-z0-9]+_[A-Za-z0-9]+$/);
      const verified = await authenticatePublicApiKey({
        authorizationHeader: `Bearer ${keyRes.data.rawKey}`,
        requiredScope: "contacts:read",
      });
      expect(verified.workspaceId).toBe(tenantA.workspaceId);
    }
  });
});
