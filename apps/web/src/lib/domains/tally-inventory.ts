import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { assertUserEmailVerified } from "@rsl/auth";
import { hasActiveEntitlement } from "@rsl/billing";
import { getEnv, resolveEndpointsFromHeaders } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { syncWorkspaceCaGoogleSheet } from "@rsl/google";
import { appendActionLog } from "@rsl/logging";
import { authorize } from "@rsl/rbac";
import {
  buildTallyWebhookSignedHeaders,
  bulkImportTallyData,
  bulkImportTallyInventory,
  computeTallyWebhookLiveStatus,
  createTallyAutomationRule,
  deleteTallyAutomationRule,
  deleteTallyReminderRule,
  deleteTallyStockItem,
  dismissSupplierBillDraft,
  fetchAndSyncLocalTallyPort9000,
  generateTallyPairingCode,
  getOrCreateTallyWebhookEndpoint,
  importSupplierBillDraftToTally,
  ingestTallyBillEventAndEnqueueAutomation,
  markTallyBillPaidViaReceipt,
  purgeWorkspaceConfidentialDataNow,
  recordTallyVoucher,
  requestConfidentialityUnmaskOtp,
  revokeConfidentialityUnmaskGrant,
  revokeTallyAgentDevice,
  rotateTallyWebhookToken,
  runDueTallyReminders,
  saveTallyCompanyRouting,
  saveTallyReminderRule,
  saveWorkspaceConfidentialityPolicyAction,
  sendTallyBillOnWhatsApp,
  toggleTallyAutomationRule,
  toggleTallyWebhookEndpoint,
  upsertTallyStockItem,
  upsertWorkspacePartyLedger,
  verifyConfidentialityUnmaskOtp,
  type WorkspaceConfidentialityPolicy,
} from "@rsl/tally";
import { controlDb } from "@rsl/tenancy";
import { requireWebSession } from "../session";
import { flushInlineTallyOutboxIfNoRedis } from "../tally-outbox-runner";
import {
  elapsedMs,
  enforceFeaturePaidEntitlement,
  friendlyMessage,
  goWithError,
  goWithNotice,
} from "./shared";

export async function generatePairingCodeActionImpl() {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/tally");
  const res = await generateTallyPairingCode(session.ctx, {});
  if (!res.ok) return goWithError("/tally", res.error.message);
  return goWithNotice(
    `/tally?pairingCode=${encodeURIComponent(res.data.pairingCode)}`,
    "Generated 15-minute PC pairing code."
  );
}

export async function rotateTallyWebhookTokenActionImpl() {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/tally");
  const res = await rotateTallyWebhookToken(session.ctx, {});
  if (!res.ok) return goWithError("/tally", res.error.message);
  return goWithNotice("/tally", "Generated a fresh Tally webhook token.");
}

export async function rotatePublicBillLinksActionImpl(formData?: FormData) {
  const startedAt = Date.now();
  const session = await requireWebSession();
  const rawReturn = formData ? String(formData.get("returnPath") || "").trim() : "";
  const returnPath =
    rawReturn.startsWith("/") && !rawReturn.startsWith("//") ? rawReturn : "/tally";

  try {
    authorize(session.ctx, "tally:sync.manage");
    const db = controlDb();
    const ws = db
      .select({ publicLinkEpoch: controlSchema.workspaces.publicLinkEpoch })
      .from(controlSchema.workspaces)
      .where(eq(controlSchema.workspaces.id, session.workspace.id))
      .get();
    const nextEpoch = (ws?.publicLinkEpoch ?? 1) + 1;
    db.update(controlSchema.workspaces)
      .set({ publicLinkEpoch: nextEpoch, updatedAt: Date.now() })
      .where(eq(controlSchema.workspaces.id, session.workspace.id))
      .run();

    appendActionLog({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      impersonatorId: session.impersonatorStaffId,
      source: "web",
      action: "tally.webhook.rotated",
      outcome: "success",
      requestId: session.ctx.requestId,
      correlationId: session.ctx.correlationId,
      durationMs: elapsedMs(startedAt),
      summary: `Revoked previously shared public Tally bill links (epoch #${nextEpoch})`,
    });
    revalidatePath("/tally");
    revalidatePath("/settings/business");
  } catch (err) {
    return goWithError(returnPath, friendlyMessage(err));
  }

  return goWithNotice(
    returnPath,
    "All previously shared public Tally invoice payment links have been revoked immediately."
  );
}

export async function createTallyAutomationActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/tally");
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.invoicing", "/tally");
  const res = await createTallyAutomationRule(session.ctx, {
    name: String(formData.get("name") || "").trim(),
    triggerEvent: String(formData.get("triggerEvent") || "Sales") as
      | "Sales"
      | "Receipt"
      | "CreditNote"
      | "Purchase"
      | "All",
    templateId: String(formData.get("templateId") || "").trim(),
    minAmountRupees: Number(formData.get("minAmountRupees") || 0),
    delaySeconds: Number(formData.get("delaySeconds") || 0),
  });
  if (!res.ok) return goWithError("/tally", res.error.message);
  return goWithNotice(
    "/tally",
    "Tally-to-WhatsApp automation rule saved. New bills matching this rule will automatically go out."
  );
}

export async function toggleTallyAutomationActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/tally");
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.invoicing", "/tally");
  const ruleId = String(formData.get("ruleId") || "");
  const active = formData.get("active") === "true";
  const res = await toggleTallyAutomationRule(session.ctx, { ruleId, active });
  if (!res.ok) return goWithError("/tally", res.error.message);
  return goWithNotice("/tally", active ? "Automation rule turned on." : "Automation rule paused.");
}

export async function deleteTallyAutomationActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/tally");
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.invoicing", "/tally");
  const ruleId = String(formData.get("ruleId") || "");
  const res = await deleteTallyAutomationRule(session.ctx, { ruleId });
  if (!res.ok) return goWithError("/tally", res.error.message);
  return goWithNotice("/tally", "Automation rule removed.");
}

export async function sendTestTallyBillWebhookActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/tally");
  const partyName = String(formData.get("partyName") || "Test Customer").trim();
  const partyPhone = String(formData.get("partyPhone") || "").trim();
  const voucherType = String(formData.get("voucherType") || "Sales");
  const amountRupees = Number(formData.get("amountRupees") || 1500);
  const voucherNumber = `TEST-${String(Date.now()).slice(-4)}`;

  try {
    authorize(session.ctx, "tally:sync.manage");
    const out = await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      sourceLabel: "webhook",
      correlationId: session.ctx.correlationId,
      rawPayload: {
        companyName: session.workspace.name,
        voucherNumber,
        voucherType,
        partyName,
        partyPhone,
        amountRupees,
        voucherDate: new Date().toISOString().slice(0, 10),
      },
    });
    await flushInlineTallyOutboxIfNoRedis(session.workspace.id);
    return goWithNotice(
      "/tally",
      out.queuedJobs > 0
        ? `Recorded test ${voucherType} #${voucherNumber} and queued ${out.queuedJobs} WhatsApp message(s) for delivery!`
        : `Recorded test ${voucherType} #${voucherNumber}. Add an active Automation Rule + customer phone number to auto-send on WhatsApp.`
    );
  } catch (err) {
    return goWithError("/tally", friendlyMessage(err));
  }
}

export async function recordTallyVoucherActionImpl(formData: FormData) {
  const session = await requireWebSession();
  const rawReturn = String(formData.get("returnPath") || "").trim();
  const returnPath =
    rawReturn.startsWith("/") && !rawReturn.startsWith("//") ? rawReturn : "/tally";
  const errorReturnPath =
    rawReturn.startsWith("/") && !rawReturn.startsWith("//") ? rawReturn : "/tally?tab=import";

  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", returnPath);

  const lineItemName = String(formData.get("lineItemName") || "").trim();
  const lineItemQty = Number(formData.get("lineItemQty") || 0);
  const lineItemRate = Number(formData.get("lineItemRate") || 0);
  const lineItemUom = String(formData.get("lineItemUom") || "PCS").trim().toUpperCase();
  const lineItemGstPct = Number(formData.get("lineItemGstPct") || 18);
  const lineItemGodown = String(formData.get("lineItemGodown") || "Main Location").trim();

  const lineItems =
    lineItemName && Number.isFinite(lineItemQty) && lineItemQty > 0
      ? [
          {
            itemName: lineItemName,
            billedQty: lineItemQty,
            uom: lineItemUom || "PCS",
            rateRupees: Number.isFinite(lineItemRate) && lineItemRate >= 0 ? lineItemRate : 0,
            gstRatePct: Number.isFinite(lineItemGstPct) ? lineItemGstPct : 18,
            godownName: lineItemGodown || "Main Location",
          },
        ]
      : undefined;

  const explicitAmount = Number(formData.get("amountRupees") || 0);
  const computedLineTotal =
    lineItems && lineItems[0]
      ? Math.round(
          lineItems[0].billedQty *
            lineItems[0].rateRupees *
            (1 + (lineItems[0].gstRatePct ?? 0) / 100) *
            100
        ) / 100
      : 0;
  const effectiveAmountRupees = explicitAmount > 0 ? explicitAmount : computedLineTotal;

  const res = await recordTallyVoucher(session.ctx, {
    voucherId: String(formData.get("voucherId") || "").trim() || undefined,
    preventOverwrite: formData.get("preventOverwrite") === "true",
    companyName: String(formData.get("companyName") || session.workspace.name),
    voucherNumber: String(formData.get("voucherNumber") || ""),
    voucherType: String(formData.get("voucherType") || "Sales") as
      | "Sales"
      | "Receipt"
      | "Payment"
      | "CreditNote"
      | "DebitNote"
      | "Purchase",
    partyName: String(formData.get("partyName") || ""),
    partyPhoneE164: String(formData.get("partyPhoneE164") || "") || undefined,
    againstBillNumber: String(formData.get("againstBillNumber") || "").trim() || undefined,
    ledgerAccountName: String(formData.get("ledgerAccountName") || "").trim() || undefined,
    narration: String(formData.get("narration") || "").trim() || undefined,
    amountRupees: effectiveAmountRupees,
    paidAmountRupees: Number(formData.get("paidAmountRupees") || 0),
    voucherDateIso: String(
      formData.get("voucherDateIso") || new Date().toISOString().slice(0, 10)
    ),
    dueDateIso: String(formData.get("dueDateIso") || "") || undefined,
    lineItems,
  });
  if (!res.ok) return goWithError(errorReturnPath, res.error.message);
  await flushInlineTallyOutboxIfNoRedis(session.workspace.id);
  const stockSuffix = lineItems ? ` Stock updated for '${lineItems[0]!.itemName}'.` : "";
  return goWithNotice(
    returnPath,
    res.data.queuedJobs && res.data.queuedJobs > 0
      ? `Voucher saved${stockSuffix} ${res.data.queuedJobs} automated WhatsApp message(s) queued for delivery.`
      : `Voucher saved and party ledger updated.${stockSuffix}`
  );
}

export async function upsertWorkspacePartyLedgerActionImpl(formData: FormData) {
  const session = await requireWebSession();
  const rawReturn = String(formData.get("returnPath") || "").trim();
  const returnPath =
    rawReturn.startsWith("/") && !rawReturn.startsWith("//") ? rawReturn : "/tally/parties";

  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", returnPath);

  const inputPartyName = String(formData.get("name") || "").trim();
  const res = await upsertWorkspacePartyLedger(session.ctx, {
    partyId: String(formData.get("partyId") || "").trim() || undefined,
    companyName: String(formData.get("companyName") || session.workspace.name).trim(),
    name: inputPartyName,
    parentGroup:
      String(formData.get("parentGroup") || "Sundry Debtors") === "Sundry Creditors"
        ? "Sundry Creditors"
        : "Sundry Debtors",
    phoneE164: String(formData.get("phoneE164") || "").trim() || undefined,
    email: String(formData.get("email") || "").trim() || undefined,
    gstin: String(formData.get("gstin") || "").trim() || undefined,
    pan: String(formData.get("pan") || "").trim() || undefined,
    contactPerson: String(formData.get("contactPerson") || "").trim() || undefined,
    stateName: String(formData.get("stateName") || "").trim() || undefined,
    pincode: String(formData.get("pincode") || "").trim() || undefined,
    address: String(formData.get("address") || "").trim() || undefined,
    creditLimitRupees: Number(formData.get("creditLimitRupees") || 0),
    creditDays: Number(formData.get("creditDays") || 15),
    openingBalanceRupees: Number(formData.get("openingBalanceRupees") || 0),
    openingBalanceType:
      String(formData.get("openingBalanceType") || "Dr") === "Cr" ? "Cr" : "Dr",
  });
  if (!res.ok) return goWithError(returnPath, res.error.message);
  return goWithNotice(
    `/tally/parties/${encodeURIComponent(res.data.partyId)}`,
    `Saved party ledger '${inputPartyName}'.`
  );
}

export async function markTallyBillPaidActionImpl(formData: FormData) {
  const session = await requireWebSession();
  const rawReturn = String(formData.get("returnPath") || "").trim();
  const returnPath =
    rawReturn.startsWith("/") && !rawReturn.startsWith("//") ? rawReturn : "/tally";

  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", returnPath);

  const amountStr = String(formData.get("amountRupees") || "").trim();
  const parsedAmt = amountStr ? Number(amountStr) : undefined;

  const res = await markTallyBillPaidViaReceipt(session.ctx, {
    billVoucherId: String(
      formData.get("billVoucherId") || formData.get("voucherId") || ""
    ).trim(),
    amountRupees: parsedAmt && Number.isFinite(parsedAmt) && parsedAmt > 0 ? parsedAmt : undefined,
    paymentModeLedger:
      String(formData.get("paymentModeLedger") || "Bank / UPI Receipt").trim() ||
      "Bank / UPI Receipt",
    settlementVoucherNumber:
      String(formData.get("settlementVoucherNumber") || "").trim() || undefined,
    settlementDateIso: String(formData.get("settlementDateIso") || "").trim() || undefined,
    narration: String(formData.get("narration") || "").trim() || undefined,
  });
  if (!res.ok) return goWithError(returnPath, res.error.message);
  await flushInlineTallyOutboxIfNoRedis(session.workspace.id);
  return goWithNotice(
    returnPath,
    `Recorded ${res.data.settlementVoucherNumber} against Bill #${res.data.billNumber} - status is now ${res.data.updatedStatus.toUpperCase()}.`
  );
}

export async function importTallyFileActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/tally");
  const format = String(formData.get("format") || "tally_xml") === "csv" ? "csv" : "tally_xml";
  const companyName = String(formData.get("companyName") || session.workspace.name);
  let rawContent = String(formData.get("rawContent") || "").trim();

  const uploaded = formData.get("uploadFile");
  if (uploaded instanceof File && uploaded.size > 0) {
    if (uploaded.size > 20 * 1024 * 1024) {
      return goWithError("/tally?tab=import", "Uploaded Tally file must be 20 MB or smaller.");
    }
    rawContent = await uploaded.text();
  }

  const res = await bulkImportTallyData(session.ctx, {
    companyName,
    format,
    rawContent,
  });
  if (!res.ok) return goWithError("/tally?tab=import", res.error.message);
  const stockNote =
    res.data.stockItemsUpserted && res.data.stockItemsUpserted > 0
      ? ` & ${res.data.stockItemsUpserted} stock item(s)`
      : "";
  return goWithNotice("/tally", `Imported ${res.data.importedCount} bills/receipts${stockNote}.`);
}

export async function upsertStockItemActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/inventory");
  const res = await upsertTallyStockItem(session.ctx, {
    itemId: String(formData.get("itemId") || "").trim() || undefined,
    companyName: String(formData.get("companyName") || session.workspace.name),
    name: String(formData.get("name") || "").trim(),
    skuCode: String(formData.get("skuCode") || "").trim() || undefined,
    partNumber: String(formData.get("partNumber") || "").trim() || undefined,
    stockGroup: String(formData.get("stockGroup") || "Primary").trim() || "Primary",
    stockCategory: String(formData.get("stockCategory") || "").trim() || undefined,
    uom: String(formData.get("uom") || "PCS").trim().toUpperCase() || "PCS",
    hsnCode: String(formData.get("hsnCode") || "").trim() || undefined,
    gstRatePct: Number(formData.get("gstRatePct") || 18),
    sellingPriceRupees: Number(formData.get("sellingPriceRupees") || 0),
    costPriceRupees: Number(formData.get("costPriceRupees") || 0),
    openingQty: Number(formData.get("openingQty") || 0),
    reorderLevelQty: Number(formData.get("reorderLevelQty") || 0),
    minOrderQty: Number(formData.get("minOrderQty") || 0),
    godownName: String(formData.get("godownName") || "Main Location").trim() || "Main Location",
    batchName: String(formData.get("batchName") || "Primary Batch").trim() || "Primary Batch",
    expiryDateIso: String(formData.get("expiryDateIso") || "").trim() || undefined,
  });
  if (!res.ok) return goWithError("/inventory?tab=manage", res.error.message);
  return goWithNotice(
    "/inventory",
    `Saved stock item '${String(formData.get("name") || "").trim()}'.`
  );
}

export async function deleteStockItemActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/inventory");
  const res = await deleteTallyStockItem(session.ctx, {
    itemId: String(formData.get("itemId") || ""),
  });
  if (!res.ok) return goWithError("/inventory", res.error.message);
  return goWithNotice("/inventory", `Removed stock item '${res.data.name}'.`);
}

export async function importTallyInventoryFileActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/inventory");
  const format = String(formData.get("format") || "tally_xml") === "csv" ? "csv" : "tally_xml";
  const companyName = String(formData.get("companyName") || session.workspace.name);
  let rawContent = String(formData.get("rawContent") || "").trim();

  const uploaded = formData.get("uploadFile");
  if (uploaded instanceof File && uploaded.size > 0) {
    if (uploaded.size > 20 * 1024 * 1024) {
      return goWithError("/inventory?tab=manage", "Uploaded inventory file must be 20 MB or smaller.");
    }
    rawContent = await uploaded.text();
  }

  const res = await bulkImportTallyInventory(session.ctx, {
    companyName,
    format,
    rawContent,
  });
  if (!res.ok) return goWithError("/inventory?tab=manage", res.error.message);
  return goWithNotice(
    "/inventory",
    `Imported ${res.data.stockItemsUpserted} stock item(s)${res.data.godownsUpserted ? ` & ${res.data.godownsUpserted} godown(s)` : ""} into your live inventory register.`
  );
}

export async function syncLocalTallyInventoryActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/inventory");
  const port = Number(formData.get("port") || 9000);
  const res = await fetchAndSyncLocalTallyPort9000(session.ctx, { port });
  if (!res.ok) return goWithError("/inventory?tab=manage", res.error.message);
  await flushInlineTallyOutboxIfNoRedis(session.workspace.id);
  return goWithNotice(
    "/inventory",
    `Synced ${res.data.upserted} voucher(s) & stock masters from Tally Prime Port ${port}.`
  );
}

export async function sendBillWhatsAppActionImpl(formData: FormData) {
  const session = await requireWebSession();
  const rawReturn = String(formData.get("returnPath") || "/tally");
  const returnPath = rawReturn.startsWith("/tally") ? rawReturn : "/tally";
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", returnPath);
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.invoicing", returnPath);
  if (!session.impersonatorStaffId) {
    try {
      assertUserEmailVerified(session.user.id, "sending Tally bills on WhatsApp");
    } catch (err) {
      return goWithError(returnPath, friendlyMessage(err));
    }
  }
  const sendKind = String(formData.get("sendKind") || "reminder") === "invoice" ? "invoice" : "reminder";
  const res = await sendTallyBillOnWhatsApp(session.ctx, {
    voucherId: String(formData.get("voucherId") || ""),
    sendKind,
  });
  if (!res.ok) return goWithError(returnPath, res.error.message);
  const pdfSuffix = res.data.attachedTallyPdf ? " with exact native Tally PDF attached" : "";
  return goWithNotice(
    returnPath,
    res.data.deduplicated
      ? sendKind === "invoice"
        ? "This sales bill was already sent recently - duplicate message skipped."
        : "This reminder was already sent recently - duplicate message skipped."
      : sendKind === "invoice"
        ? `Sales bill sent on WhatsApp${pdfSuffix}.`
        : `Payment reminder sent on WhatsApp${pdfSuffix}.`
  );
}

export async function saveReminderRuleActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/tally?tab=rules");
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.invoicing", "/tally?tab=rules");
  const res = await saveTallyReminderRule(session.ctx, {
    name: String(formData.get("name") || ""),
    triggerDaysOffset: Number(formData.get("triggerDaysOffset") || 3),
    templateName: String(formData.get("templateName") || "tally_overdue_bill_reminder"),
    maxRemindersPerBill: Number(formData.get("maxRemindersPerBill") || 3),
  });
  if (!res.ok) return goWithError("/tally?tab=rules", res.error.message);
  return goWithNotice("/tally?tab=rules", "Saved overdue payment reminder schedule.");
}

export async function deleteReminderRuleActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/tally?tab=rules");
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.invoicing", "/tally?tab=rules");
  const res = await deleteTallyReminderRule(session.ctx, {
    ruleId: String(formData.get("ruleId") || ""),
  });
  if (!res.ok) return goWithError("/tally?tab=rules", res.error.message);
  return goWithNotice("/tally?tab=rules", "Removed overdue payment reminder schedule.");
}

export async function runDueTallyRemindersActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/tally?tab=rules");
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.invoicing", "/tally?tab=rules");
  const ignoreQuietHours = formData.get("ignoreQuietHours") === "true";
  const res = await runDueTallyReminders(session.ctx, { ignoreQuietHours });
  if (!res.ok) return goWithError("/tally?tab=rules", res.error.message);

  if (res.data.skippedQuietHours && res.data.sentCount === 0) {
    return goWithNotice(
      "/tally?tab=rules",
      "Outside daytime hours (9 AM – 8 PM IST) - reminders are paused overnight unless sent manually."
    );
  }
  return goWithNotice(
    "/tally?tab=rules",
    res.data.sentCount > 0
      ? `Sent ${res.data.sentCount} due-date payment reminder(s) across ${res.data.evaluatedCount} open bill(s).`
      : `Checked ${res.data.evaluatedCount} open bill(s) - no new reminders are due right now.`
  );
}

export async function rotateTallyTokenJsonActionImpl(): Promise<{
  ok: boolean;
  message: string;
  webhookToken?: string;
  webhookUrl?: string;
  cleanEndpointUrl?: string;
}> {
  try {
    const session = await requireWebSession();
    const res = await rotateTallyWebhookToken(session.ctx, {});
    if (!res.ok) {
      return { ok: false, message: res.error.message };
    }
    const hdrs = await headers();
    const endpoints = resolveEndpointsFromHeaders(hdrs, {
      workspaceSlug: session.workspace.slug,
    });
    const cleanEndpointUrl = endpoints.tallyWebhookUrl;

    revalidatePath("/settings/tokens");
    revalidatePath("/developers");
    revalidatePath("/tally");

    return {
      ok: true,
      webhookToken: res.data.webhookToken,
      webhookUrl: cleanEndpointUrl,
      cleanEndpointUrl,
      message:
        "Tally Prime webhook token rotated. Re-download the .tdl add-on or update X-Tally-Webhook-Token in your ERP.",
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function testTallyEndpointHandshakeJsonActionImpl(): Promise<{
  ok: boolean;
  message: string;
  latencyMs?: number;
  status?: string;
  statusLabel?: string;
  pingsReceivedCount?: number;
  eventsReceivedCount?: number;
  publicEndpointUrl?: string;
}> {
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "tally:sync.manage");
    if (!hasActiveEntitlement(session.workspace.id, "tally.sync")) {
      return {
        ok: false,
        message: "Tally Prime Live Sync plan is required before verifying live Tally endpoints.",
      };
    }

    const endpoint = getOrCreateTallyWebhookEndpoint(session.workspace.id);
    if (!endpoint.enabled) {
      return {
        ok: false,
        status: "paused",
        statusLabel: "Paused",
        message: "Your Tally webhook endpoint is currently paused. Click 'Resume Webhook' first.",
      };
    }

    const hdrs = await headers();
    const publicEndpoints = resolveEndpointsFromHeaders(hdrs, {
      workspaceSlug: session.workspace.slug,
    });
    const probeBase =
      publicEndpoints.localBaseUrl ??
      getEnv().APP_URL.replace(/\/$/, "") ??
      publicEndpoints.effectiveTallyBaseUrl;

    const bodyJson = JSON.stringify({
      mode: "ping",
      companyName: session.workspace.defaultTallyCompany || session.workspace.name,
    });
    const signedHeaders = buildTallyWebhookSignedHeaders(endpoint.webhookToken, bodyJson);

    const startedAt = Date.now();
    const probeRes = await fetch(`${probeBase}/api/webhooks/tally?mode=ping`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tally-Webhook-Token": endpoint.webhookToken,
        ...signedHeaders,
        "User-Agent": "RSL-Dashboard-HandshakeCheck/2.1",
      },
      body: bodyJson,
      cache: "no-store",
    });
    const latencyMs = Math.max(1, Date.now() - startedAt);
    const data = (await probeRes.json().catch(() => ({}))) as {
      ok?: boolean;
      pingsReceivedCount?: number;
      error?: string | { message?: string };
    };

    if (!probeRes.ok || !data.ok) {
      const errMsg =
        typeof data.error === "string"
          ? data.error
          : data.error?.message || `HTTP ${probeRes.status}`;
      return {
        ok: false,
        latencyMs,
        message: `Endpoint check failed (${errMsg}).`,
      };
    }

    const refreshed = getOrCreateTallyWebhookEndpoint(session.workspace.id);
    const live = computeTallyWebhookLiveStatus(refreshed);

    revalidatePath("/tally");
    revalidatePath("/settings/tokens");
    revalidatePath("/developers");

    return {
      ok: true,
      latencyMs,
      status: live.state,
      statusLabel: live.label,
      pingsReceivedCount: refreshed.pingsReceivedCount,
      eventsReceivedCount: refreshed.eventsReceivedCount,
      publicEndpointUrl: publicEndpoints.tallyWebhookUrl,
      message: `Handshake verified in ${latencyMs}ms! ${publicEndpoints.tallyWebhookUrl} authenticated cleanly without creating test bills.`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function toggleTallyWebhookJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  enabled?: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    const enabled = formData.get("enabled") === "true";
    const res = await toggleTallyWebhookEndpoint(session.ctx, { enabled });
    if (!res.ok) return { ok: false, message: res.error.message };

    revalidatePath("/tally");
    revalidatePath("/settings/tokens");
    revalidatePath("/developers");

    return {
      ok: true,
      enabled,
      message: enabled
        ? "Incoming Tally Prime webhook endpoint resumed."
        : "Incoming Tally Prime webhook endpoint paused.",
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function generatePairingCodeJsonActionImpl(): Promise<{
  ok: boolean;
  pairingCode?: string;
  expiresAt?: number;
  cloudServerUrl?: string;
  localServerUrl?: string | null;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "tally:sync.manage");
    if (!hasActiveEntitlement(session.workspace.id, "tally.sync")) {
      return { ok: false, message: "Tally Prime Live Sync plan is required to pair an office PC." };
    }
    const res = await generateTallyPairingCode(session.ctx, {});
    if (!res.ok) return { ok: false, message: res.error.message };

    const hdrs = await headers();
    const endpoints = resolveEndpointsFromHeaders(hdrs, {
      workspaceSlug: session.workspace.slug,
    });

    revalidatePath("/tally");
    return {
      ok: true,
      pairingCode: res.data.pairingCode,
      expiresAt: res.data.expiresAt,
      cloudServerUrl: endpoints.effectiveTallyBaseUrl,
      localServerUrl: endpoints.localBaseUrl,
      message: "Generated one-time 15-minute Windows PC pairing code.",
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function revokeTallyDeviceJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    const deviceId = String(formData.get("deviceId") || "").trim();
    const res = await revokeTallyAgentDevice(session.ctx, { deviceId });
    if (!res.ok) return { ok: false, message: res.error.message };

    revalidatePath("/tally");
    revalidatePath("/connections");
    return {
      ok: true,
      message: `Unpaired Windows PC '${res.data.deviceName}'.`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function simulateSampleTallyBillJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
  queuedJobs?: number;
}> {
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "tally:sync.manage");
    if (!hasActiveEntitlement(session.workspace.id, "tally.sync")) {
      return { ok: false, message: "Tally Prime Live Sync plan is required." };
    }

    const endpoint = getOrCreateTallyWebhookEndpoint(session.workspace.id);
    if (!endpoint.enabled) {
      return {
        ok: false,
        message: "Resume your Tally webhook endpoint before simulating an inbound voucher.",
      };
    }

    const partyName = String(formData.get("partyName") || "Sample Customer").trim();
    const partyPhone = String(formData.get("partyPhone") || "").trim();
    const voucherType = String(formData.get("voucherType") || "Sales");
    const amountRupees = Number(formData.get("amountRupees") || 1850);
    const voucherNumber = `SIM-${String(Date.now()).slice(-4)}`;

    const hdrs = await headers();
    const endpoints = resolveEndpointsFromHeaders(hdrs, {
      workspaceSlug: session.workspace.slug,
    });
    const probeBase =
      endpoints.localBaseUrl ??
      getEnv().APP_URL.replace(/\/$/, "") ??
      endpoints.effectiveTallyBaseUrl;

    const bodyJson = JSON.stringify({
      bill: {
        companyName: session.workspace.defaultTallyCompany || session.workspace.name,
        voucherNumber,
        voucherType,
        partyName,
        partyPhone,
        amountRupees,
        voucherDate: new Date().toISOString().slice(0, 10),
      },
    });
    const signedHeaders = buildTallyWebhookSignedHeaders(endpoint.webhookToken, bodyJson);

    const res = await fetch(`${probeBase}/api/webhooks/tally`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tally-Webhook-Token": endpoint.webhookToken,
        ...signedHeaders,
        "User-Agent": "RSL-Dashboard-VoucherSimulator/2.1",
      },
      body: bodyJson,
      cache: "no-store",
    });

    const payload = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      queuedWhatsAppJobs?: number;
      error?: string | { message?: string };
    };

    if (!res.ok || !payload.ok) {
      const errMsg =
        typeof payload.error === "string"
          ? payload.error
          : payload.error?.message || `HTTP ${res.status}`;
      return { ok: false, message: errMsg };
    }

    revalidatePath("/tally");
    const queued = payload.queuedWhatsAppJobs ?? 0;
    return {
      ok: true,
      queuedJobs: queued,
      message:
        queued > 0
          ? `Simulated ${voucherType} #${voucherNumber} via HTTP webhook and queued ${queued} WhatsApp message(s)!`
          : `Simulated ${voucherType} #${voucherNumber} via HTTP webhook. Add an active Automation Rule + customer phone to auto-queue WhatsApp.`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function syncLocalTallyPort9000JsonActionImpl(port = 9000): Promise<{
  ok: boolean;
  upserted?: number;
  queuedJobs?: number;
  companyName?: string | null;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "tally:sync.manage");
    if (!hasActiveEntitlement(session.workspace.id, "tally.sync")) {
      return {
        ok: false,
        message: "Tally Prime Live Sync plan is required before fetching bills from Tally.",
      };
    }

    const res = await fetchAndSyncLocalTallyPort9000(session.ctx, { port });
    if (!res.ok) {
      return { ok: false, message: res.error.message };
    }

    await flushInlineTallyOutboxIfNoRedis(session.workspace.id);

    revalidatePath("/tally");
    revalidatePath("/");

    const { upserted, deletedCount, queuedJobs, companyName } = res.data;
    if (upserted === 0 && deletedCount === 0) {
      return {
        ok: true,
        upserted: 0,
        queuedJobs: 0,
        companyName,
        message: companyName
          ? `Connected to Tally Prime company '${companyName}' on Port ${port}, and all bills match your portal.`
          : `Connected to Tally Prime on Port ${port}, but no saved bills or receipts were found in the open company.`,
      };
    }

    return {
      ok: true,
      upserted,
      queuedJobs,
      companyName,
      message: `Fetched and synced ${upserted} bill(s)/receipt(s)${
        deletedCount > 0 ? ` and removed ${deletedCount} deleted bill(s)` : ""
      } from Tally Prime${companyName ? ` ('${companyName}')` : ""} on Port ${port}${
        queuedJobs > 0 ? ` (${queuedJobs} WhatsApp message(s) queued with native Tally PDF)` : ""
      }!`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function saveTallyCompanyRoutingJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  mode?: "all" | "selected";
  allowedCompanyNames?: string[];
  message: string;
}> {
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "tally:sync.manage");
    const mode = String(formData.get("mode") || "all") === "selected" ? "selected" : "all";
    const rawNames = String(formData.get("allowedCompanyNames") || "");
    const checkboxNames = formData.getAll("selectedCompany").map(String);
    const parsedNames = Array.from(
      new Set(
        [...checkboxNames, ...rawNames.split(/[\r\n,]+/)]
          .map((n) => n.trim())
          .filter((n) => n.length > 0)
      )
    );

    const res = await saveTallyCompanyRouting(session.ctx, {
      mode,
      allowedCompanyNames: parsedNames,
    });
    if (!res.ok) return { ok: false, message: res.error.message };

    revalidatePath("/tally");
    return {
      ok: true,
      mode: res.data.mode,
      allowedCompanyNames: res.data.allowedCompanyNames,
      message:
        res.data.mode === "selected" && res.data.allowedCompanyNames.length > 0
          ? `Restricted Tally sync to ${res.data.allowedCompanyNames.length} selected company(ies): ${res.data.allowedCompanyNames.join(", ")}.`
          : "Tally sync configured to accept vouchers from all open Tally companies.",
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function syncCaGoogleSheetJsonActionImpl(): Promise<{
  ok: boolean;
  message: string;
  spreadsheetUrl?: string;
  rowsWritten?: number;
}> {
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "tally:sync.manage");
    const out = await syncWorkspaceCaGoogleSheet(session.ctx, {});
    if (!out.ok) {
      throw out.error;
    }
    const rowsWritten =
      out.data.salesRows +
      out.data.purchaseRows +
      out.data.partyRows +
      out.data.gstInvoiceRows;
    revalidatePath("/tally");
    revalidatePath("/connections");
    return {
      ok: true,
      spreadsheetUrl: out.data.spreadsheetUrl,
      rowsWritten,
      message: `Synced ${rowsWritten} Tally & GST row(s) across 4 tabs to your live CA Google Sheet!`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function importSupplierBillDraftJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
  voucherId?: string;
}> {
  try {
    const session = await requireWebSession();
    const draftId = String(formData.get("draftId") || "").trim();
    const companyName = String(formData.get("companyName") || "").trim() || undefined;
    const rawOverride = String(formData.get("overrideAmountRupees") || "").trim();
    const overrideAmountRupees = rawOverride ? Number(rawOverride) : undefined;

    const res = await importSupplierBillDraftToTally(session.ctx, {
      draftId,
      companyName,
      overrideAmountRupees,
    });
    if (!res.ok) {
      throw res.error;
    }
    revalidatePath("/tally");
    return {
      ok: true,
      voucherId: res.data.voucherId,
      message: `Imported vendor bill #${res.data.billNumber} (${res.data.supplierName}) as a Tally Purchase voucher!`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function dismissSupplierBillDraftJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    const draftId = String(formData.get("draftId") || "").trim();
    const res = await dismissSupplierBillDraft(session.ctx, { draftId });
    if (!res.ok) {
      throw res.error;
    }
    revalidatePath("/tally");
    return { ok: true, message: "Dismissed vendor bill draft." };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function saveConfidentialityPolicyJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
  policy?: WorkspaceConfidentialityPolicy;
}> {
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "workspace:manage");

    const saveBillsAndDetails =
      String(formData.get("saveBillsAndDetails") ?? "true") === "true" ||
      String(formData.get("saveBillsAndDetails") ?? "") === "on";
    const maskCompanyAndContactDetails =
      String(formData.get("maskCompanyAndContactDetails") ?? "false") === "true" ||
      String(formData.get("maskCompanyAndContactDetails") ?? "") === "on";
    const allowApiUnmaskedAccessOnly =
      String(formData.get("allowApiUnmaskedAccessOnly") ?? "false") === "true" ||
      String(formData.get("allowApiUnmaskedAccessOnly") ?? "") === "on";
    const requireOtpToUnmask =
      String(formData.get("requireOtpToUnmask") ?? "true") !== "false";

    const rawRetention = String(formData.get("autoDeleteRetentionHours") ?? "").trim();
    const rawCustomHours = String(formData.get("customRetentionHours") ?? "").trim();
    let autoDeleteRetentionHours: number | null = null;

    if (rawRetention === "custom" && rawCustomHours) {
      const parsedCustom = Number(rawCustomHours);
      if (Number.isFinite(parsedCustom) && parsedCustom >= 0) {
        autoDeleteRetentionHours = Math.min(8760, Math.max(0, Math.trunc(parsedCustom)));
      }
    } else if (rawRetention !== "" && rawRetention !== "manual" && rawRetention !== "null") {
      const parsed = Number(rawRetention);
      if (Number.isFinite(parsed) && parsed >= 0) {
        autoDeleteRetentionHours = Math.min(8760, Math.max(0, Math.trunc(parsed)));
      }
    }

    const res = await saveWorkspaceConfidentialityPolicyAction(session.ctx, {
      saveBillsAndDetails,
      autoDeleteRetentionHours,
      maskCompanyAndContactDetails: maskCompanyAndContactDetails || allowApiUnmaskedAccessOnly,
      allowApiUnmaskedAccessOnly,
      requireOtpToUnmask,
    });
    if (!res.ok) {
      throw res.error;
    }

    revalidatePath("/");
    revalidatePath("/tally");
    revalidatePath("/tally/parties");
    revalidatePath("/settings/business");

    return {
      ok: true,
      policy: res.data,
      message: !res.data.saveBillsAndDetails
        ? "Zero-Persistence Mode enabled: bills and party records will be purged immediately after outbound WhatsApp dispatch."
        : res.data.allowApiUnmaskedAccessOnly
          ? "Confidentiality saved: Portal company & contact details are masked, while REST API (/api/v1/*) receives cleartext."
          : res.data.maskCompanyAndContactDetails
            ? "Confidentiality saved: Buyer, supplier, and contact details are now masked in the portal unless unlocked via OTP."
            : "Confidentiality & data retention preferences saved.",
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function requestUnmaskOtpJsonActionImpl(): Promise<{
  ok: boolean;
  message: string;
  maskedDestination?: string;
  expiresAt?: number;
  devOtpCode?: string;
}> {
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "tally:view");
    const out = requestConfidentialityUnmaskOtp({
      workspaceId: session.workspace.id,
      userId: session.user.id,
      recipientEmail: session.user.email,
      recipientName: session.user.name,
    });
    return {
      ok: true,
      maskedDestination: out.maskedDestination,
      expiresAt: out.expiresAt,
      devOtpCode: out.devOtpCode,
      message: `Sent a 6-digit OTP to ${out.maskedDestination}. Enter it below to reveal masked company and contact names for 15 minutes.`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function verifyUnmaskOtpJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
  expiresAt?: number;
}> {
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "tally:view");
    const code = String(formData.get("otpCode") || formData.get("code") || "").trim();
    const out = verifyConfidentialityUnmaskOtp({
      workspaceId: session.workspace.id,
      userId: session.user.id,
      code,
    });
    revalidatePath("/");
    revalidatePath("/tally");
    revalidatePath("/tally/parties");
    revalidatePath("/settings/business");
    return {
      ok: true,
      expiresAt: out.expiresAt,
      message: "OTP verified. Buyer, supplier, and contact names are unmasked for the next 15 minutes.",
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function lockConfidentialityMaskJsonActionImpl(): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    revokeConfidentialityUnmaskGrant({
      workspaceId: session.workspace.id,
      userId: session.user.id,
    });
    revalidatePath("/");
    revalidatePath("/tally");
    revalidatePath("/tally/parties");
    revalidatePath("/settings/business");
    return {
      ok: true,
      message: "Confidential company and contact details have been locked and re-masked.",
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function purgeConfidentialDataNowJsonActionImpl(): Promise<{
  ok: boolean;
  message: string;
  purgedVouchersCount?: number;
  purgedPartiesCount?: number;
}> {
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "workspace:manage");
    const res = await purgeWorkspaceConfidentialDataNow(session.ctx, {});
    if (!res.ok) {
      throw res.error;
    }
    revalidatePath("/");
    revalidatePath("/tally");
    revalidatePath("/tally/parties");
    revalidatePath("/settings/business");
    return {
      ok: true,
      purgedVouchersCount: res.data.purgedVouchersCount,
      purgedPartiesCount: res.data.purgedPartiesCount,
      message: `Purged ${res.data.purgedVouchersCount} saved bill(s), ${res.data.purgedPartiesCount} party ledger(s), and ${res.data.purgedPdfsCount} PDF(s) from this workspace.`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}
