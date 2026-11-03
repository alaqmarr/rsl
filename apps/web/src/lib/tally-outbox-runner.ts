import { eq, sql } from "drizzle-orm";
import { tenantDataSchema } from "@rsl/database";
import { appendActionLog } from "@rsl/logging";
import {
  ensureSslProvisionProcessorRegistered,
  isRedisConfigured,
  processDueSqliteOutboxForTenant,
  registerJobProcessor,
} from "@rsl/queue";
import {
  buildSignedTallyVoucherPdfUrl,
  getNativeTallyVoucherPdf,
} from "@rsl/tally";
import { tenantDataDb } from "@rsl/tenancy";
import {
  ensureWhatsAppBroadcastProcessorRegistered,
  executeWhatsAppTemplateSend,
} from "@rsl/whatsapp";

let tallyAutomationRegistered = false;

export function ensureTallyAutomationProcessorRegistered(): void {
  ensureSslProvisionProcessorRegistered();
  ensureWhatsAppBroadcastProcessorRegistered();
  if (tallyAutomationRegistered) return;

  registerJobProcessor("tally.whatsapp.automation", async (envelope) => {
    const payload = envelope.payload as {
      voucherId?: string;
      voucherGuid?: string;
      ruleId?: string;
      templateId?: string;
      templateName?: string;
      recipientPhone?: string;
      recipientName?: string;
      variables?: Record<string, string>;
    };

    const templateTarget = payload.templateId || payload.templateName || "";
    const recipientPhone = payload.recipientPhone || "";
    if (!templateTarget || !recipientPhone) return;

    const nativePdf = getNativeTallyVoucherPdf(
      envelope.tenantId,
      payload.voucherId || payload.voucherGuid || ""
    );
    const signedPdfUrl = nativePdf
      ? buildSignedTallyVoucherPdfUrl({
          workspaceId: envelope.tenantId,
          voucherId: nativePdf.voucherId,
          filename: nativePdf.filename,
        })
      : null;

    const res = await executeWhatsAppTemplateSend({
      workspaceId: envelope.tenantId,
      templateIdOrName: templateTarget,
      recipientPhone,
      recipientName: payload.recipientName,
      variables: payload.variables ?? {},
      idempotencyKey: envelope.idempotencyKey,
      actorId: envelope.actor.id,
      linkedVoucherGuid: payload.voucherGuid,
      serviceKey: "tally.invoicing",
      correlationId: envelope.correlationId,
      pdfDocument:
        nativePdf && signedPdfUrl
          ? {
              url: signedPdfUrl,
              filename: nativePdf.filename,
              caption: `Bill #${nativePdf.voucherNumber} (${nativePdf.companyName})`,
            }
          : undefined,
    });

    if (res.sent) {
      const now = Date.now();
      const db = tenantDataDb({ workspaceId: envelope.tenantId });

      if (payload.voucherId) {
        db.update(tenantDataSchema.tallyVouchers)
          .set({
            whatsappInvoiceSentAt: now,
            updatedAt: now,
          })
          .where(eq(tenantDataSchema.tallyVouchers.id, payload.voucherId))
          .run();
      }

      if (payload.ruleId) {
        db.update(tenantDataSchema.tallyAutomationRules)
          .set({
            triggeredCount: sql`${tenantDataSchema.tallyAutomationRules.triggeredCount} + 1`,
            lastTriggeredAt: now,
            updatedAt: now,
          })
          .where(eq(tenantDataSchema.tallyAutomationRules.id, payload.ruleId))
          .run();
      }

      appendActionLog({
        workspaceId: envelope.tenantId,
        actorType: envelope.actor.type,
        actorId: envelope.actor.id,
        source: "worker",
        action: "tally.invoice.sent",
        outcome: "success",
        requestId: envelope.requestId,
        correlationId: envelope.correlationId,
        durationMs: 12,
        summary: `Automatically sent WhatsApp template '${payload.templateName || templateTarget}'${
          nativePdf ? ` with native Tally PDF (${nativePdf.filename})` : ""
        } for Tally bill to ${payload.recipientName || "customer"}`,
      });
    }
  });

  tallyAutomationRegistered = true;
}

export async function flushInlineTallyOutboxIfNoRedis(workspaceId: string): Promise<number> {
  if (isRedisConfigured()) return 0;
  ensureTallyAutomationProcessorRegistered();
  return processDueSqliteOutboxForTenant(workspaceId);
}
