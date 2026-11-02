import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { newId } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { controlDb } from "@rsl/tenancy";
import {
  approveWalletRechargeRequest,
  ensureServiceCatalogSeeded,
  getInvoiceDetailById,
  getWalletBalancePaise,
  hasActiveEntitlement,
  listWorkspacePlanRequests,
  staffCreateCustomInvoice,
  staffRecordPlanPaymentAndActivate,
  staffRevokeServiceEntitlement,
  submitServicePlanRequest,
  submitWalletRechargeRequest,
} from "../src/index";

function createTestWorkspaceAndUser(label: string) {
  ensureServiceCatalogSeeded();
  const db = controlDb();
  const now = Date.now();
  const userId = newId("usr", label);
  const workspaceId = newId("biz", label);

  db.insert(controlSchema.users)
    .values({
      id: userId,
      name: `${label} Owner`,
      email: `${label.toLowerCase()}-${now}@example.com`,
      passwordHash: "test-hash",
      emailVerified: true,
      totpEnabled: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  db.insert(controlSchema.workspaces)
    .values({
      id: workspaceId,
      name: `${label} Traders`,
      slug: `${label.toLowerCase()}-${now}`,
      ownerUserId: userId,
      stateCode: "27",
      billingStatus: "active",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return { userId, workspaceId };
}

describe("Payment-gated plan requests & wallet verification", () => {
  it("keeps plans locked when a client submits a request until staff records payment", () => {
    const { userId, workspaceId } = createTestWorkspaceAndUser("Shree");

    expect(hasActiveEntitlement(workspaceId, "tally.invoicing")).toBe(false);
    expect(hasActiveEntitlement(workspaceId, "tally.sync")).toBe(false);
    expect(hasActiveEntitlement(workspaceId, "whatsapp.messaging")).toBe(false);

    const submitted = submitServicePlanRequest({
      workspaceId,
      serviceKey: "tally.invoicing",
      requestedByUserId: userId,
      customerPaymentRef: "UTR9988776655",
      customerNote: "Paid by UPI today",
    });

    expect(submitted.alreadyPending).toBe(false);
    // Client submitting a request MUST NOT activate the feature!
    expect(hasActiveEntitlement(workspaceId, "tally.invoicing")).toBe(false);
    expect(hasActiveEntitlement(workspaceId, "tally.sync")).toBe(false);

    const reqRows = listWorkspacePlanRequests(workspaceId);
    expect(reqRows).toHaveLength(1);
    expect(reqRows[0]?.status).toBe("pending_payment");

    // Staff must enter a positive amount and UTR/receipt reference
    expect(() =>
      staffRecordPlanPaymentAndActivate({
        requestId: submitted.requestId,
        workspaceId,
        serviceKey: "tally.invoicing",
        amountPaidPaise: 0,
        paymentMethod: "upi",
        paymentReference: "UTR9988776655",
        staffId: "stf_admin_01",
      })
    ).toThrow();

    expect(() =>
      staffRecordPlanPaymentAndActivate({
        requestId: submitted.requestId,
        workspaceId,
        serviceKey: "tally.invoicing",
        amountPaidPaise: 79900,
        paymentMethod: "upi",
        paymentReference: "",
        staffId: "stf_admin_01",
      })
    ).toThrow();

    // Staff records verified payment -> unlocks requested plan + prerequisites + issues paid GST invoice
    const activated = staffRecordPlanPaymentAndActivate({
      requestId: submitted.requestId,
      workspaceId,
      serviceKey: "tally.invoicing",
      amountPaidPaise: 79900,
      paymentMethod: "upi",
      paymentReference: "UTR9988776655",
      staffId: "stf_admin_01",
      includePrerequisites: true,
    });

    expect(activated.invoiceNumber).toBeTruthy();
    expect(hasActiveEntitlement(workspaceId, "tally.invoicing")).toBe(true);
    expect(hasActiveEntitlement(workspaceId, "tally.sync")).toBe(true);
    expect(hasActiveEntitlement(workspaceId, "whatsapp.messaging")).toBe(true);

    const invoices = controlDb()
      .select()
      .from(controlSchema.invoices)
      .where(eq(controlSchema.invoices.workspaceId, workspaceId))
      .all();
    expect(invoices.length).toBeGreaterThanOrEqual(1);
    expect(invoices[0]?.status).toBe("paid");
    expect(invoices[0]?.subtotalPaise).toBe(79900);

    // Staff revoking a plan immediately locks it again
    staffRevokeServiceEntitlement({ workspaceId, serviceKey: "tally.invoicing" });
    expect(hasActiveEntitlement(workspaceId, "tally.invoicing")).toBe(false);
  });

  it("credits ₹0 to client wallet on UTR submission until staff approves the payment", () => {
    const { workspaceId } = createTestWorkspaceAndUser("Mehta");

    expect(getWalletBalancePaise(workspaceId)).toBe(0);

    const recharge = submitWalletRechargeRequest({
      workspaceId,
      amountPaise: 250000,
      utrOrReference: "UPI4455667788",
      paymentMethod: "upi",
    });

    // Balance remains ₹0 before staff verification
    expect(getWalletBalancePaise(workspaceId)).toBe(0);

    const approved = approveWalletRechargeRequest({
      paymentId: recharge.paymentId,
      staffId: "stf_admin_01",
    });

    expect(approved.balancePaise).toBe(250000);
    expect(getWalletBalancePaise(workspaceId)).toBe(250000);
    expect(approved.invoiceNumber).toBeTruthy();
  });

  it("loads printable GST invoice details with intra/inter-state split and enforces workspace isolation", () => {
    const mh = createTestWorkspaceAndUser("Pune");
    const ka = createTestWorkspaceAndUser("Bengaluru");

    controlDb()
      .update(controlSchema.workspaces)
      .set({ stateCode: "29", gstin: "29AABCB1234F1Z2" })
      .where(eq(controlSchema.workspaces.id, ka.workspaceId))
      .run();

    const mhInv = staffCreateCustomInvoice({
      workspaceId: mh.workspaceId,
      description: "Tally Prime Live Sync Retainer",
      subtotalPaise: 100000,
      status: "paid",
      paymentMethod: "upi",
      paymentReference: "UTR88001122",
    });

    const kaInv = staffCreateCustomInvoice({
      workspaceId: ka.workspaceId,
      description: "WhatsApp Business Messaging Setup",
      subtotalPaise: 200000,
      status: "paid",
      paymentMethod: "bank_transfer",
      paymentReference: "NEFT77223344",
    });

    const mhDetail = getInvoiceDetailById(mhInv.id, { workspaceId: mh.workspaceId });
    expect(mhDetail).not.toBeNull();
    expect(mhDetail?.sacCode).toBe("998314");
    expect(mhDetail?.buyerStateName).toBe("Maharashtra");
    expect(mhDetail?.cgstPaise).toBe(9000);
    expect(mhDetail?.sgstPaise).toBe(9000);
    expect(mhDetail?.igstPaise).toBe(0);
    expect(mhDetail?.totalPaise).toBe(118000);
    expect(mhDetail?.paymentReference).toBe("UTR88001122");

    // Cross-tenant isolation check: Karnataka workspace cannot read Maharashtra invoice
    expect(getInvoiceDetailById(mhInv.id, { workspaceId: ka.workspaceId })).toBeNull();

    // Inter-state IGST 18% check for State 29 (Karnataka)
    const kaDetail = getInvoiceDetailById(kaInv.id, { workspaceId: ka.workspaceId });
    expect(kaDetail).not.toBeNull();
    expect(kaDetail?.buyerStateName).toBe("Karnataka");
    expect(kaDetail?.buyerGstin).toBe("29AABCB1234F1Z2");
    expect(kaDetail?.cgstPaise).toBe(0);
    expect(kaDetail?.sgstPaise).toBe(0);
    expect(kaDetail?.igstPaise).toBe(36000);
    expect(kaDetail?.totalPaise).toBe(236000);
  });
});
