import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { dispatchWorkspaceWebhookEvent } from "@rsl/api-keys";
import {
  canDebitWalletUsage,
  consumeUsage,
  getWalletAvailableSpendPaise,
  getWalletBalancePaise,
  WALLET_OVERDRAFT_LIMIT_PAISE,
} from "@rsl/billing";
import { decryptEnvelope, fetchWithRetry, formatInr, newEntityId, newId, RslError } from "@rsl/core";
import { controlSchema, tenantDataSchema, tenantLogsSchema } from "@rsl/database";
import { defineAction } from "@rsl/logging";
import {
  enqueueJob,
  isRedisConfigured,
  markSendGuardOutcome,
  processDueSqliteOutboxForTenant,
  registerJobProcessor,
  reserveSendGuard,
  type JobEnvelope,
} from "@rsl/queue";
import {
  controlDb,
  isWorkspaceSandboxIntegrationMode,
  tenantDataDb,
  tenantLogsDb,
} from "@rsl/tenancy";

function extractConnectionAccessToken(encryptedBlob: string): string {
  const decrypted = decryptEnvelope(encryptedBlob);
  try {
    const parsed = JSON.parse(decrypted) as { accessToken?: unknown };
    if (parsed && typeof parsed.accessToken === "string") {
      return parsed.accessToken.trim();
    }
  } catch {
    // Plaintext envelope fallback
  }
  return decrypted.trim();
}

function resolveWabaGraphId(conn: { externalAccountId: string; metadataJson: string | null }): string {
  try {
    const parsedMeta = JSON.parse(conn.metadataJson || "{}") as { wabaId?: string };
    if (parsedMeta.wabaId && parsedMeta.wabaId.trim()) {
      return parsedMeta.wabaId.trim();
    }
  } catch {
    // Fall back to externalAccountId
  }
  return conn.externalAccountId;
}

function buildMetaTemplateSubmissionComponents(input: {
  headerType: "NONE" | "TEXT" | "DOCUMENT" | "IMAGE";
  headerText?: string | null;
  bodyText: string;
  footerText?: string | null;
  buttons?: WhatsAppTemplateButton[];
  vars: string[];
  sampleValues: Record<string, string>;
}): Array<Record<string, unknown>> {
  const components: Array<Record<string, unknown>> = [];
  if (input.headerType === "TEXT" && input.headerText?.trim()) {
    const headerVars = extractTemplateVariables([input.headerText]);
    const headerExamples = headerVars.map((v) => input.sampleValues[v.replace(/[{}]/g, "")] || "Sample");
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: input.headerText.trim(),
      ...(headerExamples.length > 0 ? { example: { header_text: headerExamples } } : {}),
    });
  } else if (input.headerType === "DOCUMENT") {
    components.push({ type: "HEADER", format: "DOCUMENT" });
  } else if (input.headerType === "IMAGE") {
    components.push({ type: "HEADER", format: "IMAGE" });
  }

  const bodyVars = extractTemplateVariables([input.bodyText]);
  const bodyExamples = bodyVars.map((v) => input.sampleValues[v.replace(/[{}]/g, "")] || "Sample");
  components.push({
    type: "BODY",
    text: input.bodyText.trim(),
    ...(bodyExamples.length > 0 ? { example: { body_text: [bodyExamples] } } : {}),
  });

  if (input.footerText?.trim()) {
    components.push({ type: "FOOTER", text: input.footerText.trim() });
  }

  if (input.buttons && input.buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: input.buttons.map((b) =>
        b.type === "URL"
          ? { type: "URL", text: b.text, url: b.url || "https://example.com" }
          : b.type === "PHONE_NUMBER"
            ? { type: "PHONE_NUMBER", text: b.text, phone_number: b.phoneNumber || "+919820000000" }
            : { type: "QUICK_REPLY", text: b.text }
      ),
    });
  }

  return components;
}

export interface WhatsAppTemplateButton {
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
  text: string;
  url?: string;
  phoneNumber?: string;
}

export const TALLY_TEMPLATE_VARIABLE_FIELDS = [
  { key: "partyName", label: "Customer / Party Name", sample: "Shree Ganesh Traders" },
  { key: "voucherNumber", label: "Bill / Receipt Number", sample: "GST/26-27/0108" },
  { key: "amountFormatted", label: "Bill / Receipt Amount (₹)", sample: "₹18,450" },
  { key: "balanceFormatted", label: "Pending Balance Due (₹)", sample: "₹18,450" },
  { key: "dueDateFormatted", label: "Payment Due Date", sample: "15 Nov 2026" },
  { key: "voucherDateFormatted", label: "Bill / Receipt Date", sample: "01 Nov 2026" },
  { key: "companyName", label: "Your Business Name", sample: "RSL Management" },
] as const;

export type TallyVariableFieldKey = (typeof TALLY_TEMPLATE_VARIABLE_FIELDS)[number]["key"];

export interface ParsedWhatsAppTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  headerType: "NONE" | "TEXT" | "DOCUMENT" | "IMAGE";
  headerText: string | null;
  bodyText: string;
  footerText: string | null;
  variables: string[];
  variableMappings: Record<string, string>;
  sampleValues: Record<string, string>;
  buttons: WhatsAppTemplateButton[];
  approvalStatus: string;
  metaTemplateId: string | null;
  qualityScore: string;
  rejectionReason: string | null;
  lastSyncedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function extractTemplateVariables(texts: Array<string | null | undefined>): string[] {
  const found = new Set<number>();
  for (const txt of texts) {
    if (!txt) continue;
    for (const m of txt.matchAll(/\{\{(\d+)\}\}/g)) {
      const idx = Number(m[1]);
      if (Number.isInteger(idx) && idx >= 1 && idx <= 20) {
        found.add(idx);
      }
    }
  }
  return Array.from(found)
    .sort((a, b) => a - b)
    .map((n) => `{{${n}}}`);
}

export function parseTemplateRow(
  row: typeof tenantDataSchema.whatsappTemplates.$inferSelect
): ParsedWhatsAppTemplate {
  return {
    id: row.id,
    name: row.name,
    language: row.language,
    category: row.category,
    headerType: (row.headerType as ParsedWhatsAppTemplate["headerType"]) || "NONE",
    headerText: row.headerText ?? null,
    bodyText: row.bodyText,
    footerText: row.footerText ?? null,
    variables: safeParseJson<string[]>(row.variablesJson, []),
    variableMappings: safeParseJson<Record<string, string>>(row.variableMappingsJson, {}),
    sampleValues: safeParseJson<Record<string, string>>(row.sampleValuesJson, {}),
    buttons: safeParseJson<WhatsAppTemplateButton[]>(row.buttonsJson, []),
    approvalStatus: row.approvalStatus,
    metaTemplateId: row.metaTemplateId ?? null,
    qualityScore: row.qualityScore || "GREEN",
    rejectionReason: row.rejectionReason ?? null,
    lastSyncedAt: row.lastSyncedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt || row.createdAt,
  };
}

export function renderWhatsAppTemplate(
  template: ParsedWhatsAppTemplate,
  valuesByIndexOrKey: Record<string, string>
): {
  renderedHeader: string | null;
  renderedBody: string;
  renderedFooter: string | null;
  fullPreviewText: string;
  metaComponents: Array<Record<string, unknown>>;
} {
  const resolveSlot = (slotNum: string): string => {
    // 1. Direct index e.g. "1" or "{{1}}"
    if (valuesByIndexOrKey[slotNum]) return valuesByIndexOrKey[slotNum]!;
    if (valuesByIndexOrKey[`{{${slotNum}}}`]) return valuesByIndexOrKey[`{{${slotNum}}}`]!;

    // 2. Mapped field key e.g. variableMappings["1"] === "partyName"
    const mappedField = template.variableMappings[slotNum] || template.variableMappings[`{{${slotNum}}}`];
    if (mappedField && valuesByIndexOrKey[mappedField]) {
      return valuesByIndexOrKey[mappedField]!;
    }

    // 3. Fallback to template sample value
    if (template.sampleValues[slotNum]) return template.sampleValues[slotNum]!;
    const defaultField = TALLY_TEMPLATE_VARIABLE_FIELDS[Number(slotNum) - 1];
    return defaultField?.sample ?? `[Value ${slotNum}]`;
  };

  const replaceSlots = (input: string | null): string | null => {
    if (!input) return null;
    return input.replace(/\{\{(\d+)\}\}/g, (_all, num: string) => resolveSlot(num));
  };

  const renderedHeader = template.headerType === "TEXT" ? replaceSlots(template.headerText) : template.headerText;
  const renderedBody = replaceSlots(template.bodyText) || template.bodyText;
  const renderedFooter = template.footerText;

  const metaComponents: Array<Record<string, unknown>> = [];
  if (template.headerType === "TEXT" && template.headerText) {
    const headerVars = extractTemplateVariables([template.headerText]);
    if (headerVars.length > 0) {
      metaComponents.push({
        type: "header",
        parameters: headerVars.map((v) => ({
          type: "text",
          text: resolveSlot(v.replace(/[{}]/g, "")),
        })),
      });
    }
  } else if (template.headerType === "DOCUMENT" && valuesByIndexOrKey.documentUrl) {
    metaComponents.push({
      type: "header",
      parameters: [
        {
          type: "document",
          document: {
            link: valuesByIndexOrKey.documentUrl,
            filename: valuesByIndexOrKey.documentFilename || "Invoice.pdf",
          },
        },
      ],
    });
  }

  const bodyVars = extractTemplateVariables([template.bodyText]);
  if (bodyVars.length > 0) {
    metaComponents.push({
      type: "body",
      parameters: bodyVars.map((v) => ({
        type: "text",
        text: resolveSlot(v.replace(/[{}]/g, "")),
      })),
    });
  }

  const parts = [
    renderedHeader ? `*${renderedHeader}*` : null,
    renderedBody,
    renderedFooter ? `_${renderedFooter}_` : null,
  ].filter(Boolean);

  return {
    renderedHeader,
    renderedBody,
    renderedFooter,
    fullPreviewText: parts.join("\n\n"),
    metaComponents,
  };
}

export function getWhatsAppWorkspaceData(workspaceId: string) {
  const dataDb = tenantDataDb({ workspaceId });
  const logsDb = tenantLogsDb({ workspaceId });
  const ctrl = controlDb();

  const rawTemplates = dataDb
    .select()
    .from(tenantDataSchema.whatsappTemplates)
    .orderBy(desc(tenantDataSchema.whatsappTemplates.createdAt))
    .all();

  const templates = rawTemplates.map(parseTemplateRow);

  const broadcasts = dataDb
    .select()
    .from(tenantDataSchema.broadcasts)
    .orderBy(desc(tenantDataSchema.broadcasts.createdAt))
    .all();

  const optIns = dataDb
    .select()
    .from(tenantDataSchema.optIns)
    .orderBy(desc(tenantDataSchema.optIns.consentedAt))
    .all();

  const suppressions = logsDb
    .select()
    .from(tenantLogsSchema.suppressions)
    .where(eq(tenantLogsSchema.suppressions.channel, "whatsapp"))
    .orderBy(desc(tenantLogsSchema.suppressions.createdAt))
    .all();

  const wabaConnection = ctrl
    .select()
    .from(controlSchema.connections)
    .where(
      and(
        eq(controlSchema.connections.workspaceId, workspaceId),
        eq(controlSchema.connections.provider, "whatsapp")
      )
    )
    .get();

  const suppressedSet = new Set(suppressions.map((s) => s.identifier));
  const eligibleOptInCount = optIns.filter((o) => !suppressedSet.has(o.phoneE164)).length;

  return {
    templates,
    broadcasts,
    optIns,
    suppressions,
    eligibleOptInCount,
    wabaConnected: Boolean(wabaConnection && wabaConnection.status === "healthy"),
    wabaDisplayName: wabaConnection?.displayName ?? null,
    wabaExternalId: wabaConnection?.externalAccountId ?? null,
  };
}

export const createWhatsAppTemplate = defineAction({
  key: "whatsapp.template.created",
  permission: "whatsapp:template.manage",
  input: z.object({
    name: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers, and underscores only (for example: tally_sales_invoice)"),
    category: z.enum(["utility", "marketing", "authentication"]),
    language: z.string().default("en_IN"),
    headerType: z.enum(["NONE", "TEXT", "DOCUMENT", "IMAGE"]).default("NONE"),
    headerText: z.string().max(120).optional(),
    bodyText: z.string().min(5).max(1024),
    footerText: z.string().max(60).optional(),
    variableMappings: z.record(z.string(), z.string()).optional(),
    sampleValues: z.record(z.string(), z.string()).optional(),
    buttons: z
      .array(
        z.object({
          type: z.enum(["QUICK_REPLY", "URL", "PHONE_NUMBER"]),
          text: z.string().min(1).max(25),
          url: z.string().optional(),
          phoneNumber: z.string().optional(),
        })
      )
      .max(3)
      .optional(),
    submitToMeta: z.boolean().default(true),
  }),
  summarize: (input) => `Saved WhatsApp message template '${input.name}'`,
  handler: async (ctx, input) => {
    const db = tenantDataDb(ctx);
    const existing = db
      .select()
      .from(tenantDataSchema.whatsappTemplates)
      .where(eq(tenantDataSchema.whatsappTemplates.name, input.name))
      .get();

    if (existing) {
      throw new RslError("RSL-VAL-1001", `A template named '${input.name}' already exists.`);
    }

    const vars = extractTemplateVariables([input.headerText, input.bodyText]);
    const defaultMappings: Record<string, string> = {};
    const defaultSamples: Record<string, string> = {};

    vars.forEach((v, idx) => {
      const slot = v.replace(/[{}]/g, "");
      const preset = TALLY_TEMPLATE_VARIABLE_FIELDS[idx];
      defaultMappings[slot] = input.variableMappings?.[slot] || preset?.key || "custom";
      defaultSamples[slot] = input.sampleValues?.[slot] || preset?.sample || `Example ${slot}`;
    });

    let approvalStatus = "DRAFT";
    let metaTemplateId: string | null = null;
    const now = Date.now();

    const wabaConn = controlDb()
      .select()
      .from(controlSchema.connections)
      .where(
        and(
          eq(controlSchema.connections.workspaceId, ctx.workspaceId),
          eq(controlSchema.connections.provider, "whatsapp")
        )
      )
      .get();

    if (input.submitToMeta && wabaConn && wabaConn.status === "healthy") {
      const token = extractConnectionAccessToken(wabaConn.encryptedTokens);
      const isSandbox = isWorkspaceSandboxIntegrationMode(ctx.workspaceId, token);

      if (!isSandbox && token) {
        const wabaGraphId = resolveWabaGraphId(wabaConn);
        const components = buildMetaTemplateSubmissionComponents({
          headerType: input.headerType,
          headerText: input.headerText,
          bodyText: input.bodyText,
          footerText: input.footerText,
          buttons: input.buttons,
          vars,
          sampleValues: defaultSamples,
        });

        let resp: Response;
        try {
          resp = await fetchWithRetry(
            `https://graph.facebook.com/v21.0/${encodeURIComponent(wabaGraphId)}/message_templates`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                name: input.name,
                language: input.language,
                category: input.category.toUpperCase(),
                components,
              }),
              timeoutMs: 12_000,
              maxRetries: 2,
            }
          );
        } catch (err) {
          throw new RslError(
            "RSL-VAL-1001",
            `Could not submit template to Meta WhatsApp Cloud API: ${err instanceof Error ? err.message : "network timeout"}`
          );
        }

        const metaOut = (await resp.json().catch(() => ({}))) as {
          id?: string;
          status?: string;
          error?: { message?: string; error_user_msg?: string };
        };

        if (!resp.ok) {
          throw new RslError(
            "RSL-VAL-1001",
            `Meta WhatsApp API rejected template '${input.name}' (HTTP ${resp.status}): ${metaOut.error?.error_user_msg || metaOut.error?.message || "Check WABA ID & whatsapp_business_management scope."}`
          );
        }

        metaTemplateId = metaOut.id || `meta_tmpl_live_${now}`;
        approvalStatus = (metaOut.status || "PENDING").toUpperCase();
      } else if (isSandbox) {
        metaTemplateId = `meta_tmpl_sb_${now}`;
        approvalStatus = "APPROVED";
      }
    }

    const id = newEntityId("tmpl", ctx.workspaceId, now);
    db.insert(tenantDataSchema.whatsappTemplates)
      .values({
        id,
        name: input.name,
        language: input.language,
        category: input.category,
        headerType: input.headerType,
        headerText: input.headerText?.trim() || null,
        bodyText: input.bodyText.trim(),
        footerText: input.footerText?.trim() || null,
        buttonsJson: JSON.stringify(input.buttons ?? []),
        variablesJson: JSON.stringify(vars),
        variableMappingsJson: JSON.stringify(defaultMappings),
        sampleValuesJson: JSON.stringify(defaultSamples),
        approvalStatus,
        metaTemplateId,
        qualityScore: "GREEN",
        lastSyncedAt: metaTemplateId ? now : null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return { templateId: id, approvalStatus, metaTemplateId };
  },
});

export const updateWhatsAppTemplate = defineAction({
  key: "whatsapp.template.created",
  permission: "whatsapp:template.manage",
  input: z.object({
    templateId: z.string().min(6),
    category: z.enum(["utility", "marketing", "authentication"]).optional(),
    headerType: z.enum(["NONE", "TEXT", "DOCUMENT", "IMAGE"]).optional(),
    headerText: z.string().max(120).optional(),
    bodyText: z.string().min(5).max(1024),
    footerText: z.string().max(60).optional(),
    variableMappings: z.record(z.string(), z.string()).optional(),
  }),
  summarize: (input) => `Updated WhatsApp message template ${input.templateId}`,
  handler: (ctx, input) => {
    const db = tenantDataDb(ctx);
    const existing = db
      .select()
      .from(tenantDataSchema.whatsappTemplates)
      .where(eq(tenantDataSchema.whatsappTemplates.id, input.templateId))
      .get();

    if (!existing) {
      throw new RslError("RSL-VAL-1001", "Template not found.");
    }

    const vars = extractTemplateVariables([input.headerText ?? existing.headerText, input.bodyText]);
    const currentMappings = safeParseJson<Record<string, string>>(existing.variableMappingsJson, {});
    const mergedMappings = { ...currentMappings, ...(input.variableMappings ?? {}) };

    db.update(tenantDataSchema.whatsappTemplates)
      .set({
        category: input.category ?? existing.category,
        headerType: input.headerType ?? existing.headerType,
        headerText: input.headerText !== undefined ? input.headerText.trim() || null : existing.headerText,
        bodyText: input.bodyText.trim(),
        footerText: input.footerText !== undefined ? input.footerText.trim() || null : existing.footerText,
        variablesJson: JSON.stringify(vars),
        variableMappingsJson: JSON.stringify(mergedMappings),
        updatedAt: Date.now(),
      })
      .where(eq(tenantDataSchema.whatsappTemplates.id, existing.id))
      .run();

    return { templateId: existing.id };
  },
});

export const deleteWhatsAppTemplate = defineAction({
  key: "whatsapp.template.created",
  permission: "whatsapp:template.manage",
  input: z.object({
    templateId: z.string().min(6),
  }),
  summarize: () => "Deleted WhatsApp message template",
  handler: (ctx, input) => {
    const db = tenantDataDb(ctx);
    const usedInBroadcast = db
      .select()
      .from(tenantDataSchema.broadcasts)
      .where(eq(tenantDataSchema.broadcasts.templateId, input.templateId))
      .get();

    if (usedInBroadcast) {
      throw new RslError(
        "RSL-VAL-1001",
        "This template was used in past broadcasts and cannot be deleted."
      );
    }

    db.delete(tenantDataSchema.whatsappTemplates)
      .where(eq(tenantDataSchema.whatsappTemplates.id, input.templateId))
      .run();

    return { deleted: true };
  },
});

export const submitWhatsAppTemplateToMeta = defineAction({
  key: "whatsapp.template.created",
  permission: "whatsapp:template.manage",
  input: z.object({
    templateId: z.string().min(6),
  }),
  summarize: () => "Submitted WhatsApp message template to Meta for approval",
  handler: async (ctx, input) => {
    const db = tenantDataDb(ctx);
    const existing = db
      .select()
      .from(tenantDataSchema.whatsappTemplates)
      .where(eq(tenantDataSchema.whatsappTemplates.id, input.templateId))
      .get();

    if (!existing) {
      throw new RslError("RSL-VAL-1001", "Template not found.");
    }

    const wabaConn = controlDb()
      .select()
      .from(controlSchema.connections)
      .where(
        and(
          eq(controlSchema.connections.workspaceId, ctx.workspaceId),
          eq(controlSchema.connections.provider, "whatsapp")
        )
      )
      .get();

    if (!wabaConn || wabaConn.status !== "healthy") {
      throw new RslError(
        "RSL-VAL-1001",
        "Connect your WhatsApp Business Account under Connected Channels before submitting templates to Meta."
      );
    }

    const token = extractConnectionAccessToken(wabaConn.encryptedTokens);
    if (!token) {
      throw new RslError("RSL-VAL-1001", "WhatsApp Business Account token is missing. Reconnect WhatsApp first.");
    }

    const now = Date.now();
    const isSandbox = isWorkspaceSandboxIntegrationMode(ctx.workspaceId, token);
    let metaTemplateId = existing.metaTemplateId;
    let approvalStatus = "PENDING";

    if (isSandbox) {
      metaTemplateId = `meta_tmpl_sb_${now}`;
      approvalStatus = "APPROVED";
    } else {
      const parsed = parseTemplateRow(existing);
      const wabaGraphId = resolveWabaGraphId(wabaConn);
      const components = buildMetaTemplateSubmissionComponents({
        headerType: parsed.headerType,
        headerText: parsed.headerText,
        bodyText: parsed.bodyText,
        footerText: parsed.footerText,
        buttons: parsed.buttons,
        vars: parsed.variables,
        sampleValues: parsed.sampleValues,
      });

      let resp: Response;
      try {
        resp = await fetchWithRetry(
          `https://graph.facebook.com/v21.0/${encodeURIComponent(wabaGraphId)}/message_templates`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: parsed.name,
              language: parsed.language,
              category: parsed.category.toUpperCase(),
              components,
            }),
            timeoutMs: 12_000,
            maxRetries: 2,
          }
        );
      } catch (err) {
        throw new RslError(
          "RSL-VAL-1001",
          `Could not submit template to Meta WhatsApp Cloud API: ${err instanceof Error ? err.message : "network timeout"}`
        );
      }

      const metaOut = (await resp.json().catch(() => ({}))) as {
        id?: string;
        status?: string;
        error?: { message?: string; error_user_msg?: string };
      };

      if (!resp.ok) {
        throw new RslError(
          "RSL-VAL-1001",
          `Meta WhatsApp API rejected template '${parsed.name}' (HTTP ${resp.status}): ${metaOut.error?.error_user_msg || metaOut.error?.message || "Verify WABA ID and whatsapp_business_management scope."}`
        );
      }

      metaTemplateId = metaOut.id || `meta_tmpl_live_${now}`;
      approvalStatus = (metaOut.status || "PENDING").toUpperCase();
    }

    db.update(tenantDataSchema.whatsappTemplates)
      .set({
        approvalStatus,
        metaTemplateId,
        rejectionReason: null,
        lastSyncedAt: now,
        updatedAt: now,
      })
      .where(eq(tenantDataSchema.whatsappTemplates.id, existing.id))
      .run();

    return { templateId: existing.id, approvalStatus, metaTemplateId };
  },
});

export const installStarterTallyTemplates = defineAction({
  key: "whatsapp.template.created",
  permission: "whatsapp:template.manage",
  input: z.object({}),
  summarize: () => "Added ready-to-use Tally bill, receipt, and reminder WhatsApp templates",
  handler: async (ctx) => {
    const db = tenantDataDb(ctx);
    const now = Date.now();

    const wabaConn = controlDb()
      .select()
      .from(controlSchema.connections)
      .where(
        and(
          eq(controlSchema.connections.workspaceId, ctx.workspaceId),
          eq(controlSchema.connections.provider, "whatsapp")
        )
      )
      .get();

    const wabaHealthy = Boolean(wabaConn && wabaConn.status === "healthy");
    const token = wabaHealthy && wabaConn ? extractConnectionAccessToken(wabaConn.encryptedTokens) : "";
    const isSandbox = Boolean(token) && isWorkspaceSandboxIntegrationMode(ctx.workspaceId, token);
    const wabaGraphId = wabaHealthy && wabaConn ? resolveWabaGraphId(wabaConn) : "";

    const presets: Array<{
      name: string;
      category: "utility";
      headerType: "DOCUMENT" | "TEXT";
      headerText: string | null;
      bodyText: string;
      footerText: string;
      mappings: Record<string, string>;
      buttons: WhatsAppTemplateButton[];
    }> = [
      {
        name: "tally_tax_invoice_pdf",
        category: "utility",
        headerType: "DOCUMENT",
        headerText: null,
        bodyText:
          "Namaste {{1}}, please find attached your Tally Tax Invoice #{{2}} for {{3}}. Payment due date is {{4}}. Thank you for your business!",
        footerText: "Reply STOP to opt out of updates",
        mappings: {
          "1": "partyName",
          "2": "voucherNumber",
          "3": "amountFormatted",
          "4": "dueDateFormatted",
        },
        buttons: [{ type: "QUICK_REPLY", text: "Confirm Receipt" }],
      },
      {
        name: "tally_sales_bill_created",
        category: "utility",
        headerType: "TEXT",
        headerText: "New Tax Invoice Generated",
        bodyText:
          "Namaste {{1}}, your invoice #{{2}} for {{3}} has been generated. Payment due date is {{4}}. Thank you for your business!",
        footerText: "Reply STOP to opt out of updates",
        mappings: {
          "1": "partyName",
          "2": "voucherNumber",
          "3": "amountFormatted",
          "4": "dueDateFormatted",
        },
        buttons: [{ type: "QUICK_REPLY", text: "Confirm Receipt" }],
      },
      {
        name: "tally_payment_receipt_ack",
        category: "utility",
        headerType: "TEXT",
        headerText: "Payment Received - Thank You",
        bodyText:
          "Namaste {{1}}, we have received your payment of {{3}} under Receipt #{{2}} on {{4}}. Thank you!",
        footerText: "Automated update from accounts desk",
        mappings: {
          "1": "partyName",
          "2": "voucherNumber",
          "3": "amountFormatted",
          "4": "voucherDateFormatted",
        },
        buttons: [],
      },
      {
        name: "tally_overdue_bill_reminder",
        category: "utility",
        headerType: "TEXT",
        headerText: "Gentle Payment Reminder",
        bodyText:
          "Namaste {{1}}, this is a polite reminder that Invoice #{{2}} has a pending balance of {{3}} (due {{4}}). Kindly share details if already paid.",
        footerText: "Reply STOP to opt out",
        mappings: {
          "1": "partyName",
          "2": "voucherNumber",
          "3": "balanceFormatted",
          "4": "dueDateFormatted",
        },
        buttons: [{ type: "QUICK_REPLY", text: "Already Paid" }],
      },
    ];

    const sampleValues: Record<string, string> = {
      "1": "Shree Ganesh Traders",
      "2": "GST/26-27/0108",
      "3": "₹18,450",
      "4": "15 Nov 2026",
    };

    let installed = 0;
    let approvedCount = 0;
    let pendingCount = 0;
    let draftCount = 0;

    for (const p of presets) {
      const exists = db
        .select()
        .from(tenantDataSchema.whatsappTemplates)
        .where(eq(tenantDataSchema.whatsappTemplates.name, p.name))
        .get();
      if (exists) continue;

      const vars = extractTemplateVariables([p.headerText, p.bodyText]);
      let approvalStatus = "DRAFT";
      let metaTemplateId: string | null = null;
      let rejectionReason: string | null = null;

      if (wabaHealthy && isSandbox) {
        approvalStatus = "APPROVED";
        metaTemplateId = `meta_tmpl_sb_${now + installed}`;
        approvedCount++;
      } else if (wabaHealthy && token && wabaGraphId) {
        try {
          const components = buildMetaTemplateSubmissionComponents({
            headerType: p.headerType,
            headerText: p.headerText,
            bodyText: p.bodyText,
            footerText: p.footerText,
            buttons: p.buttons,
            vars,
            sampleValues,
          });
          const resp = await fetch(
            `https://graph.facebook.com/v21.0/${encodeURIComponent(wabaGraphId)}/message_templates`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                name: p.name,
                language: "en_IN",
                category: p.category.toUpperCase(),
                components,
              }),
              signal: AbortSignal.timeout(12_000),
            }
          );
          const metaOut = (await resp.json().catch(() => ({}))) as {
            id?: string;
            status?: string;
            error?: { message?: string; error_user_msg?: string };
          };
          if (resp.ok) {
            metaTemplateId = metaOut.id || `meta_tmpl_live_${now + installed}`;
            approvalStatus = (metaOut.status || "PENDING").toUpperCase();
            if (approvalStatus === "APPROVED") approvedCount++;
            else pendingCount++;
          } else {
            approvalStatus = "DRAFT";
            rejectionReason = metaOut.error?.error_user_msg || metaOut.error?.message || null;
            draftCount++;
          }
        } catch {
          approvalStatus = "DRAFT";
          draftCount++;
        }
      } else {
        approvalStatus = "DRAFT";
        draftCount++;
      }

      db.insert(tenantDataSchema.whatsappTemplates)
        .values({
          id: newEntityId("tmpl", ctx.workspaceId, now + installed),
          name: p.name,
          language: "en_IN",
          category: p.category,
          headerType: p.headerType,
          headerText: p.headerText,
          bodyText: p.bodyText,
          footerText: p.footerText,
          buttonsJson: JSON.stringify(p.buttons),
          variablesJson: JSON.stringify(vars),
          variableMappingsJson: JSON.stringify(p.mappings),
          sampleValuesJson: JSON.stringify(sampleValues),
          approvalStatus,
          metaTemplateId,
          rejectionReason,
          qualityScore: "GREEN",
          lastSyncedAt: metaTemplateId ? now + installed : null,
          createdAt: now + installed,
          updatedAt: now + installed,
        })
        .run();
      installed++;
    }

    return { installed, approvedCount, pendingCount, draftCount };
  },
});

export const syncWhatsAppTemplatesWithMeta = defineAction({
  key: "whatsapp.template.created",
  permission: "whatsapp:template.manage",
  input: z.object({}),
  summarize: (_in, out?: { syncedCount: number }) =>
    `Synced ${out?.syncedCount ?? 0} templates from WhatsApp Business Account`,
  handler: async (ctx) => {
    const conn = controlDb()
      .select()
      .from(controlSchema.connections)
      .where(
        and(
          eq(controlSchema.connections.workspaceId, ctx.workspaceId),
          eq(controlSchema.connections.provider, "whatsapp")
        )
      )
      .get();

    if (!conn || conn.status !== "healthy") {
      throw new RslError(
        "RSL-VAL-1001",
        "Connect your WhatsApp Business Account under Connected Accounts first to sync templates from Meta."
      );
    }

    const token = extractConnectionAccessToken(conn.encryptedTokens);
    if (isWorkspaceSandboxIntegrationMode(ctx.workspaceId, token)) {
      return { syncedCount: 0 };
    }
    const wabaGraphId = resolveWabaGraphId(conn);
    const resp = await fetchWithRetry(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(wabaGraphId)}/message_templates?limit=100`,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeoutMs: 10_000,
        maxRetries: 2,
      }
    );

    if (!resp.ok) {
      throw new RslError(
        "RSL-SYS-1001",
        "Could not fetch templates from WhatsApp Business API. Please check your WhatsApp Business Account ID and token."
      );
    }

    const payload = (await resp.json()) as {
      data?: Array<{
        id: string;
        name: string;
        language: string;
        category: string;
        status: string;
        rejected_reason?: string;
        components?: Array<{ type: string; format?: string; text?: string }>;
      }>;
    };

    const db = tenantDataDb(ctx);
    const now = Date.now();
    let syncedCount = 0;

    for (const item of payload.data ?? []) {
      const bodyComp = item.components?.find((c) => c.type === "BODY");
      const headerComp = item.components?.find((c) => c.type === "HEADER");
      const footerComp = item.components?.find((c) => c.type === "FOOTER");
      if (!bodyComp?.text) continue;

      const vars = extractTemplateVariables([headerComp?.text, bodyComp.text]);
      db.insert(tenantDataSchema.whatsappTemplates)
        .values({
          id: newEntityId("tmpl", ctx.workspaceId, now + syncedCount),
          name: item.name.toLowerCase(),
          language: item.language || "en_IN",
          category: (item.category || "UTILITY").toLowerCase(),
          headerType: (headerComp?.format || "NONE").toUpperCase(),
          headerText: headerComp?.text || null,
          bodyText: bodyComp.text,
          footerText: footerComp?.text || null,
          variablesJson: JSON.stringify(vars),
          approvalStatus: (item.status || "APPROVED").toUpperCase(),
          metaTemplateId: item.id,
          rejectionReason: item.rejected_reason || null,
          lastSyncedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: tenantDataSchema.whatsappTemplates.name,
          set: {
            approvalStatus: (item.status || "APPROVED").toUpperCase(),
            metaTemplateId: item.id,
            rejectionReason: item.rejected_reason || null,
            lastSyncedAt: now,
            updatedAt: now,
          },
        })
        .run();
      syncedCount++;
    }

    return { syncedCount };
  },
});

/**
 * Core Backend & Worker Template Dispatcher:
 * Renders the WhatsApp Business API template, checks opt-out & duplicate guards,
 * calls Meta Cloud API when connected, and logs the outbound message in Customer Messages!
 */
export async function executeWhatsAppTemplateSend(params: {
  workspaceId: string;
  templateIdOrName: string;
  recipientPhone: string;
  recipientName?: string;
  variables: Record<string, string>;
  idempotencyKey: string;
  actorId: string;
  linkedVoucherGuid?: string;
  broadcastId?: string;
  serviceKey?: "whatsapp.messaging" | "tally.invoicing";
  correlationId?: string;
  pdfDocument?: {
    url: string;
    filename: string;
    caption?: string;
    sizeBytes?: number;
  };
}): Promise<{
  sent: boolean;
  mode?: "live" | "sandbox" | "disconnected";
  isSandboxData?: boolean;
  authRevoked?: boolean;
  deduplicated?: boolean;
  skippedReason?: string;
  externalMessageId?: string;
  renderedPreview?: string;
  attachedPdfUrl?: string;
}> {
  const dataDb = tenantDataDb({ workspaceId: params.workspaceId });
  const logsDb = tenantLogsDb({ workspaceId: params.workspaceId });
  const ctrl = controlDb();

  const cleanDigits = params.recipientPhone.replace(/[^\d+]/g, "");
  const phoneE164 = cleanDigits.startsWith("+")
    ? cleanDigits
    : cleanDigits.length === 10
      ? `+91${cleanDigits}`
      : `+${cleanDigits}`;

  if (phoneE164.length < 10) {
    return { sent: false, skippedReason: "Missing or invalid customer phone number" };
  }

  // 1. Check opt-out / unsubscribed list
  const suppressed = logsDb
    .select()
    .from(tenantLogsSchema.suppressions)
    .where(
      and(
        eq(tenantLogsSchema.suppressions.channel, "whatsapp"),
        eq(tenantLogsSchema.suppressions.identifier, phoneE164)
      )
    )
    .get();

  if (suppressed) {
    return { sent: false, skippedReason: "Customer has opted out of WhatsApp messages" };
  }

  // 2. Load template by ID or name
  let rawTemplate = dataDb
    .select()
    .from(tenantDataSchema.whatsappTemplates)
    .where(eq(tenantDataSchema.whatsappTemplates.id, params.templateIdOrName))
    .get();

  if (!rawTemplate) {
    rawTemplate = dataDb
      .select()
      .from(tenantDataSchema.whatsappTemplates)
      .where(eq(tenantDataSchema.whatsappTemplates.name, params.templateIdOrName))
      .get();
  }

  if (!rawTemplate || rawTemplate.approvalStatus !== "APPROVED") {
    return {
      sent: false,
      skippedReason: rawTemplate
        ? `Template '${rawTemplate.name}' is currently ${rawTemplate.approvalStatus} (must be Meta-approved 'APPROVED' before sending)`
        : "Template is missing or not approved yet",
    };
  }

  // 2b. Verify WhatsApp Business Cloud API connection & live Meta template approval BEFORE reserving SendGuard or charging wallet
  const wabaAsset = ctrl
    .select()
    .from(controlSchema.assets)
    .where(
      and(
        eq(controlSchema.assets.workspaceId, params.workspaceId),
        eq(controlSchema.assets.assetType, "waba_phone"),
        eq(controlSchema.assets.active, true)
      )
    )
    .get();

  const wabaConn = ctrl
    .select()
    .from(controlSchema.connections)
    .where(
      and(
        eq(controlSchema.connections.workspaceId, params.workspaceId),
        eq(controlSchema.connections.provider, "whatsapp")
      )
    )
    .get();

  if (!wabaConn || wabaConn.status !== "healthy") {
    return {
      sent: false,
      mode: "disconnected",
      authRevoked: wabaConn?.status === "needs_reauth",
      skippedReason: "WhatsApp Business Account is not connected or requires re-authorization under Connected Channels",
    };
  }

  const accessToken = extractConnectionAccessToken(wabaConn.encryptedTokens);
  if (!accessToken) {
    return {
      sent: false,
      mode: "disconnected",
      skippedReason: "WhatsApp Business Account access token is missing",
    };
  }

  const isSandbox = isWorkspaceSandboxIntegrationMode(params.workspaceId, accessToken);
  if (!isSandbox && !rawTemplate.metaTemplateId) {
    return {
      sent: false,
      mode: "live",
      skippedReason: `Template '${rawTemplate.name}' has not been verified on Meta WhatsApp Manager yet; sync or submit it first`,
    };
  }

  const parsedTemplate = parseTemplateRow(rawTemplate);
  const effectiveVariables: Record<string, string> = {
    ...params.variables,
    ...(params.pdfDocument?.url
      ? {
          documentUrl: params.variables.documentUrl || params.pdfDocument.url,
          documentFilename:
            params.variables.documentFilename || params.pdfDocument.filename || "Tax-Invoice.pdf",
        }
      : {}),
  };
  const rendered = renderWhatsAppTemplate(parsedTemplate, effectiveVariables);

  // 3. Verify wallet balance including ₹200 overdraft allowance (-₹200.00 minimum) BEFORE reserving SendGuard
  const unitCostPaise = parsedTemplate.category === "marketing" ? 95 : 85;
  const currentBal = getWalletBalancePaise(params.workspaceId);
  if (!canDebitWalletUsage(currentBal, unitCostPaise)) {
    return {
      sent: false,
      skippedReason: `Prepaid wallet balance (${formatInr(currentBal, { showDecimals: true })}) has reached the -${formatInr(WALLET_OVERDRAFT_LIMIT_PAISE)} overdraft limit`,
    };
  }

  // 4. Reserve duplicate-send guard
  const guard = reserveSendGuard({
    workspaceId: params.workspaceId,
    idempotencyKey: params.idempotencyKey,
    channel: "whatsapp",
    recipient: phoneE164,
  });

  if (!guard.allowed) {
    return { sent: false, deduplicated: true, renderedPreview: rendered.fullPreviewText };
  }

  // 5. Dispatch to Meta WhatsApp Business Cloud API STRICTLY BEFORE billing or confirming SendGuard
  let externalMessageId = `wamid.sb_${newId("msg", params.workspaceId)}`;
  const deliveryStatus: "sent" | "queued" | "failed" = "sent";
  const sendMode: "live" | "sandbox" = isSandbox ? "sandbox" : "live";

  if (!isSandbox) {
    const phoneNumberId = wabaAsset?.externalId || wabaConn.externalAccountId;
    if (!phoneNumberId) {
      markSendGuardOutcome({
        workspaceId: params.workspaceId,
        idempotencyKey: params.idempotencyKey,
        state: "failed",
      });
      return {
        sent: false,
        mode: "live",
        skippedReason: "WhatsApp Phone Number ID is missing on Connected Channels",
      };
    }

    const started = Date.now();
    const apiBody = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phoneE164.replace(/^\+/, ""),
      type: "template",
      template: {
        name: parsedTemplate.name,
        language: { code: parsedTemplate.language },
        ...(rendered.metaComponents.length > 0 ? { components: rendered.metaComponents } : {}),
      },
    };

    let resp: Response;
    try {
      resp = await fetchWithRetry(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(apiBody),
          timeoutMs: 15_000,
          maxRetries: 2,
        }
      );
    } catch (err) {
      logsDb
        .insert(tenantLogsSchema.providerCalls)
        .values({
          id: newEntityId("req", params.workspaceId),
          ts: Date.now(),
          provider: "whatsapp",
          operation: "messages.send_template",
          method: "POST",
          status: 0,
          latencyMs: Date.now() - started,
          correlationId: params.correlationId || newEntityId("req", params.workspaceId),
        })
        .run();

      markSendGuardOutcome({
        workspaceId: params.workspaceId,
        idempotencyKey: params.idempotencyKey,
        state: "failed",
      });
      return {
        sent: false,
        mode: "live",
        skippedReason: `Network error reaching Meta WhatsApp Cloud API (${err instanceof Error ? err.message : "timeout"})`,
      };
    }

    const latencyMs = Date.now() - started;
    logsDb
      .insert(tenantLogsSchema.providerCalls)
      .values({
        id: newEntityId("req", params.workspaceId),
        ts: Date.now(),
        provider: "whatsapp",
        operation: "messages.send_template",
        method: "POST",
        status: resp.status,
        latencyMs,
        correlationId: params.correlationId || newEntityId("req", params.workspaceId),
      })
      .run();

    const resJson = (await resp.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>;
      error?: { message?: string; error_user_msg?: string; code?: number };
    };

    if (!resp.ok) {
      const authRevoked = resp.status === 401 || resJson.error?.code === 190;
      if (authRevoked) {
        ctrl
          .update(controlSchema.connections)
          .set({
            status: "needs_reauth",
            lastHealthCheckAt: Date.now(),
            updatedAt: Date.now(),
          })
          .where(eq(controlSchema.connections.id, wabaConn.id))
          .run();
      }
      markSendGuardOutcome({
        workspaceId: params.workspaceId,
        idempotencyKey: params.idempotencyKey,
        state: "failed",
      });
      return {
        sent: false,
        mode: "live",
        authRevoked,
        skippedReason: `WhatsApp Cloud API rejected message (HTTP ${resp.status}: ${resJson.error?.error_user_msg || resJson.error?.message || "delivery rejected"})`,
      };
    }

    const returnedMsgId = resJson.messages?.[0]?.id?.trim();
    if (!returnedMsgId) {
      markSendGuardOutcome({
        workspaceId: params.workspaceId,
        idempotencyKey: params.idempotencyKey,
        state: "failed",
      });
      return {
        sent: false,
        mode: "live",
        skippedReason: "WhatsApp Cloud API did not return a confirmed message ID (wamid)",
      };
    }
    externalMessageId = returnedMsgId;

    // If a Tally-format PDF document is requested and the chosen template header is not already DOCUMENT,
    // automatically send the formatted Tally PDF document right alongside the WhatsApp notification!
    if (params.pdfDocument?.url && parsedTemplate.headerType !== "DOCUMENT") {
      await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: phoneE164.replace(/^\+/, ""),
            type: "document",
            document: {
              link: params.pdfDocument.url,
              filename: params.pdfDocument.filename || "Tax-Invoice.pdf",
              ...(params.pdfDocument.caption ? { caption: params.pdfDocument.caption } : {}),
            },
          }),
          signal: AbortSignal.timeout(12_000),
        }
      ).catch(() => null);
    }
  }

  // 6. Meter per-message usage STRICTLY AFTER Meta accepted the message and returned a valid wamid (₹0 on error)
  consumeUsage({
    workspaceId: params.workspaceId,
    serviceKey: params.serviceKey ?? "whatsapp.messaging",
    quantity: 1,
    unitCostPaise,
    dedupeKey: params.idempotencyKey,
    description: `WhatsApp template '${parsedTemplate.name}'${params.pdfDocument ? " + Tally PDF" : ""} to ${params.recipientName || phoneE164}`,
    actorId: params.actorId,
  });

  markSendGuardOutcome({
    workspaceId: params.workspaceId,
    idempotencyKey: params.idempotencyKey,
    state: "confirmed",
    externalId: externalMessageId,
  });

  // 6. Ensure Contact + Conversation Thread in Customer Messages
  const now = Date.now();
  let contact = dataDb
    .select()
    .from(tenantDataSchema.contacts)
    .where(eq(tenantDataSchema.contacts.phoneE164, phoneE164))
    .get();

  if (!contact) {
    const contactId = newEntityId("cnt", params.workspaceId, now);
    dataDb
      .insert(tenantDataSchema.contacts)
      .values({
        id: contactId,
        name: params.recipientName?.trim() || phoneE164,
        phoneE164,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    contact = dataDb
      .select()
      .from(tenantDataSchema.contacts)
      .where(eq(tenantDataSchema.contacts.id, contactId))
      .get()!;
  }

  let conv = dataDb
    .select()
    .from(tenantDataSchema.conversations)
    .where(
      and(
        eq(tenantDataSchema.conversations.contactId, contact.id),
        eq(tenantDataSchema.conversations.channel, "whatsapp")
      )
    )
    .get();

  if (!conv) {
    const convId = newEntityId("cnv", params.workspaceId, now);
    dataDb
      .insert(tenantDataSchema.conversations)
      .values({
        id: convId,
        contactId: contact.id,
        channel: "whatsapp",
        status: "open",
        linkedVoucherGuid: params.linkedVoucherGuid ?? null,
        lastMessagePreview: rendered.renderedBody.slice(0, 140),
        lastActivityAt: now,
        createdAt: now,
      })
      .run();
    conv = dataDb
      .select()
      .from(tenantDataSchema.conversations)
      .where(eq(tenantDataSchema.conversations.id, convId))
      .get()!;
  } else {
    dataDb
      .update(tenantDataSchema.conversations)
      .set({
        linkedVoucherGuid: params.linkedVoucherGuid ?? conv.linkedVoucherGuid,
        lastMessagePreview: rendered.renderedBody.slice(0, 140),
        lastActivityAt: now,
      })
      .where(eq(tenantDataSchema.conversations.id, conv.id))
      .run();
  }

  const previewWithPdf = params.pdfDocument?.filename
    ? `${rendered.fullPreviewText}\n\n[Attached Tally PDF: ${params.pdfDocument.filename}]`
    : rendered.fullPreviewText;

  const msgId = newEntityId("msg", params.workspaceId, now);
  dataDb
    .insert(tenantDataSchema.messages)
    .values({
      id: msgId,
      conversationId: conv.id,
      broadcastId: params.broadcastId ?? null,
      direction: "outbound",
      senderType: "template_automation",
      senderId: params.actorId,
      body: previewWithPdf,
      templateName: parsedTemplate.name,
      deliveryStatus,
      costPaise: unitCostPaise,
      pricingCategory: parsedTemplate.category,
      externalMessageId,
      createdAt: now,
    })
    .run();

  if (params.pdfDocument?.url) {
    dataDb
      .insert(tenantDataSchema.messageAttachments)
      .values({
        id: newId(),
        messageId: msgId,
        fileName: params.pdfDocument.filename,
        mimeType: "application/pdf",
        sizeBytes: params.pdfDocument.sizeBytes ?? 0,
        storageKey: params.pdfDocument.url,
        createdAt: now,
      })
      .run();
  }

  return {
    sent: true,
    mode: sendMode,
    isSandboxData: isSandbox,
    externalMessageId,
    renderedPreview: previewWithPdf,
    ...(params.pdfDocument?.url ? { attachedPdfUrl: params.pdfDocument.url } : {}),
  };
}

export async function sendWhatsAppDirectTextJob(params: {
  workspaceId: string;
  recipientPhone: string;
  body: string;
  idempotencyKey: string;
}): Promise<{ sent: boolean; externalMessageId?: string }> {
  const cleanDigits = params.recipientPhone.replace(/[^0-9]/g, "");
  const toDigits = cleanDigits.length === 10 ? `91${cleanDigits}` : cleanDigits;
  if (toDigits.length < 10 || !params.body.trim()) {
    return { sent: false };
  }

  const guard = reserveSendGuard({
    workspaceId: params.workspaceId,
    idempotencyKey: params.idempotencyKey,
    channel: "whatsapp",
    recipient: `+${toDigits}`,
  });
  if (!guard.allowed) {
    return { sent: false };
  }

  const ctrl = controlDb();
  const wabaAsset = ctrl
    .select()
    .from(controlSchema.assets)
    .where(
      and(
        eq(controlSchema.assets.workspaceId, params.workspaceId),
        eq(controlSchema.assets.assetType, "waba_phone"),
        eq(controlSchema.assets.active, true)
      )
    )
    .get();
  const wabaConn = ctrl
    .select()
    .from(controlSchema.connections)
    .where(
      and(
        eq(controlSchema.connections.workspaceId, params.workspaceId),
        eq(controlSchema.connections.provider, "whatsapp")
      )
    )
    .get();

  if (!wabaConn || wabaConn.status !== "healthy") {
    markSendGuardOutcome({
      workspaceId: params.workspaceId,
      idempotencyKey: params.idempotencyKey,
      state: "failed",
    });
    return { sent: false };
  }

  let extId = `wamid.job_${newId("msg", params.workspaceId)}`;
  const token = extractConnectionAccessToken(wabaConn.encryptedTokens);
  const isSandbox = isWorkspaceSandboxIntegrationMode(params.workspaceId, token);
  const phoneNumberId = wabaAsset?.externalId || wabaConn.externalAccountId;

  if (!token) {
    markSendGuardOutcome({
      workspaceId: params.workspaceId,
      idempotencyKey: params.idempotencyKey,
      state: "failed",
    });
    return { sent: false };
  }

  if (!isSandbox) {
    if (!phoneNumberId) {
      markSendGuardOutcome({
        workspaceId: params.workspaceId,
        idempotencyKey: params.idempotencyKey,
        state: "failed",
      });
      return { sent: false };
    }
    try {
      const resp = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: toDigits,
            type: "text",
            text: { body: params.body.trim() },
          }),
          signal: AbortSignal.timeout(10_000),
        }
      );
      if (!resp.ok) {
        markSendGuardOutcome({
          workspaceId: params.workspaceId,
          idempotencyKey: params.idempotencyKey,
          state: "failed",
        });
        return { sent: false };
      }
      const out = (await resp.json().catch(() => ({}))) as {
        messages?: Array<{ id?: string }>;
      };
      if (!out.messages?.[0]?.id) {
        markSendGuardOutcome({
          workspaceId: params.workspaceId,
          idempotencyKey: params.idempotencyKey,
          state: "failed",
        });
        return { sent: false };
      }
      extId = out.messages[0].id;
    } catch {
      markSendGuardOutcome({
        workspaceId: params.workspaceId,
        idempotencyKey: params.idempotencyKey,
        state: "failed",
      });
      return { sent: false };
    }
  }

  markSendGuardOutcome({
    workspaceId: params.workspaceId,
    idempotencyKey: params.idempotencyKey,
    state: "confirmed",
    externalId: extId,
  });
  return { sent: true, externalMessageId: extId };
}

export const addWhatsAppUnsubscribedNumber = defineAction({
  key: "whatsapp.suppression.added",
  permission: "whatsapp:send",
  input: z.object({
    phoneE164: z.string().min(8).max(20),
    reason: z.string().min(2).max(120).default("Customer requested STOP"),
  }),
  summarize: (input) => `Added number ending ${input.phoneE164.slice(-4)} to unsubscribed list`,
  handler: (ctx, input) => {
    const logsDb = tenantLogsDb(ctx);
    logsDb
      .insert(tenantLogsSchema.suppressions)
      .values({
        id: newId(),
        channel: "whatsapp",
        identifier: input.phoneE164.trim(),
        reason: input.reason.trim(),
        createdAt: Date.now(),
      })
      .onConflictDoNothing()
      .run();

    return { added: true };
  },
});

export const removeWhatsAppUnsubscribedNumber = defineAction({
  key: "whatsapp.suppression.removed",
  permission: "whatsapp:send",
  input: z.object({
    suppressionId: z.string().min(6),
  }),
  summarize: () => "Re-enabled WhatsApp delivery after customer re-consent",
  handler: (ctx, input) => {
    const logsDb = tenantLogsDb(ctx);
    logsDb
      .delete(tenantLogsSchema.suppressions)
      .where(
        and(
          eq(tenantLogsSchema.suppressions.id, input.suppressionId),
          eq(tenantLogsSchema.suppressions.channel, "whatsapp")
        )
      )
      .run();

    return { removed: true };
  },
});

const BROADCAST_CHUNK_SIZE = 50;
let broadcastProcessorRegistered = false;

export async function executeWhatsAppBroadcastChunkJob(envelope: JobEnvelope): Promise<void> {
  const payload = envelope.payload as {
    broadcastId?: string;
    templateId?: string;
    templateName?: string;
    broadcastName?: string;
    unitCostPaise?: number;
    recipients?: Array<{ phoneE164: string; name?: string }>;
  };

  if (!payload.broadcastId || !payload.templateId || !Array.isArray(payload.recipients)) {
    return;
  }

  const dataDb = tenantDataDb({ workspaceId: envelope.tenantId });
  const bcast = dataDb
    .select()
    .from(tenantDataSchema.broadcasts)
    .where(eq(tenantDataSchema.broadcasts.id, payload.broadcastId))
    .get();
  if (!bcast || bcast.status === "paused" || bcast.status === "completed") return;

  const unitCostPaise = payload.unitCostPaise ?? 85;
  let chunkSent = 0;
  let chunkImmediateDelivered = 0;
  let chunkFailed = 0;
  let pausedDueToTokenRevocation = false;

  for (const recipient of payload.recipients) {
    const res = await executeWhatsAppTemplateSend({
      workspaceId: envelope.tenantId,
      templateIdOrName: payload.templateId,
      recipientPhone: recipient.phoneE164,
      recipientName: recipient.name,
      variables: {
        partyName: recipient.name || recipient.phoneE164,
      },
      idempotencyKey: `bcast:${payload.broadcastId}:${recipient.phoneE164}`,
      actorId: envelope.actor.id,
      broadcastId: payload.broadcastId,
      serviceKey: "whatsapp.messaging",
      correlationId: envelope.correlationId,
    });

    if (res.sent || res.deduplicated) {
      if (res.sent) {
        chunkSent++;
        // In live WABA mode, deliveredCount increments from real Meta statuses[] webhooks!
        if (res.mode !== "live") {
          chunkImmediateDelivered++;
        }
      }
    } else {
      chunkFailed++;
      if (res.authRevoked) {
        pausedDueToTokenRevocation = true;
        break;
      }
    }
  }

  const now = Date.now();
  dataDb
    .update(tenantDataSchema.broadcasts)
    .set({
      ...(pausedDueToTokenRevocation ? { status: "paused" } : {}),
      sentCount: sql`${tenantDataSchema.broadcasts.sentCount} + ${chunkSent}`,
      deliveredCount: sql`${tenantDataSchema.broadcasts.deliveredCount} + ${chunkImmediateDelivered}`,
      failedCount: sql`${tenantDataSchema.broadcasts.failedCount} + ${chunkFailed}`,
      actualCostPaise: sql`${tenantDataSchema.broadcasts.actualCostPaise} + ${chunkSent * unitCostPaise}`,
    })
    .where(eq(tenantDataSchema.broadcasts.id, payload.broadcastId))
    .run();

  if (pausedDueToTokenRevocation) {
    return;
  }

  const updated = dataDb
    .select()
    .from(tenantDataSchema.broadcasts)
    .where(eq(tenantDataSchema.broadcasts.id, payload.broadcastId))
    .get();

  if (
    updated &&
    updated.status !== "completed" &&
    updated.sentCount + updated.failedCount >= updated.totalRecipients
  ) {
    dataDb
      .update(tenantDataSchema.broadcasts)
      .set({
        status: "completed",
        completedAt: now,
      })
      .where(eq(tenantDataSchema.broadcasts.id, payload.broadcastId))
      .run();

    void dispatchWorkspaceWebhookEvent(envelope.tenantId, "whatsapp.broadcast.completed", {
      broadcastId: updated.id,
      name: updated.name,
      templateName: payload.templateName ?? payload.templateId,
      recipientCount: updated.sentCount,
      failedCount: updated.failedCount,
      costPaise: updated.actualCostPaise,
    }).catch(() => 0);
  }
}

export function ensureWhatsAppBroadcastProcessorRegistered(): void {
  if (broadcastProcessorRegistered) return;
  registerJobProcessor("whatsapp.broadcast.chunk", executeWhatsAppBroadcastChunkJob);
  broadcastProcessorRegistered = true;
}

ensureWhatsAppBroadcastProcessorRegistered();

export const launchWhatsAppBroadcast = defineAction({
  key: "whatsapp.broadcast.launched",
  permission: "whatsapp:broadcast",
  input: z.object({
    name: z.string().min(2).max(120),
    templateId: z.string().min(6),
  }),
  summarize: (input, out?: { recipientCount: number }) =>
    `Launched WhatsApp broadcast '${input.name}' to ${out?.recipientCount ?? 0} opted-in contacts`,
  handler: async (ctx, input) => {
    ensureWhatsAppBroadcastProcessorRegistered();
    const dataDb = tenantDataDb(ctx);
    const logsDb = tenantLogsDb(ctx);

    const wabaConn = controlDb()
      .select()
      .from(controlSchema.connections)
      .where(
        and(
          eq(controlSchema.connections.workspaceId, ctx.workspaceId),
          eq(controlSchema.connections.provider, "whatsapp")
        )
      )
      .get();

    if (!wabaConn || wabaConn.status !== "healthy") {
      throw new RslError(
        "RSL-VAL-1001",
        "Connect your WhatsApp Business Account under Connected Channels before launching a broadcast."
      );
    }

    const template = dataDb
      .select()
      .from(tenantDataSchema.whatsappTemplates)
      .where(eq(tenantDataSchema.whatsappTemplates.id, input.templateId))
      .get();

    if (!template || template.approvalStatus !== "APPROVED") {
      throw new RslError(
        "RSL-VAL-1001",
        "Select a Meta-approved WhatsApp template ('APPROVED') before launching a broadcast."
      );
    }

    const accessToken = extractConnectionAccessToken(wabaConn.encryptedTokens);
    const isSandbox = isWorkspaceSandboxIntegrationMode(ctx.workspaceId, accessToken);
    if (!isSandbox && !template.metaTemplateId) {
      throw new RslError(
        "RSL-VAL-1001",
        `Template '${template.name}' has not been verified on Meta WhatsApp Manager yet. Submit or sync it first.`
      );
    }

    const optIns = dataDb.select().from(tenantDataSchema.optIns).all();
    const contacts = dataDb.select().from(tenantDataSchema.contacts).all();
    const contactNameByPhone = new Map(
      contacts.filter((c) => c.phoneE164).map((c) => [c.phoneE164!, c.name])
    );
    const suppressions = logsDb
      .select()
      .from(tenantLogsSchema.suppressions)
      .where(eq(tenantLogsSchema.suppressions.channel, "whatsapp"))
      .all();

    const suppressedSet = new Set(suppressions.map((s) => s.identifier));
    const seenPhones = new Set<string>();
    const eligibleRecipients = optIns.filter((o) => {
      if (suppressedSet.has(o.phoneE164) || seenPhones.has(o.phoneE164)) return false;
      seenPhones.add(o.phoneE164);
      return true;
    });

    if (eligibleRecipients.length === 0) {
      throw new RslError(
        "RSL-WA-1003",
        "You have 0 opted-in contacts eligible for broadcasts. Add contacts with WhatsApp permission first."
      );
    }

    const unitCostPaise = template.category === "marketing" ? 95 : 85;
    const totalCostPaise = eligibleRecipients.length * unitCostPaise;

    const currentBalance = getWalletBalancePaise(ctx.workspaceId);
    if (!canDebitWalletUsage(currentBalance, totalCostPaise)) {
      const availablePaise = getWalletAvailableSpendPaise(currentBalance);
      throw new RslError(
        "RSL-BILL-1003",
        `This broadcast requires ${formatInr(totalCostPaise, { showDecimals: true })} for ${eligibleRecipients.length} opted-in contacts, while your wallet balance is ${formatInr(currentBalance, { showDecimals: true })} (${formatInr(availablePaise, { showDecimals: true })} available including ₹200 overdraft).`
      );
    }

    const broadcastId = newEntityId("bcst", ctx.workspaceId);
    const now = Date.now();

    dataDb
      .insert(tenantDataSchema.broadcasts)
      .values({
        id: broadcastId,
        name: input.name.trim(),
        templateId: template.id,
        status: "sending",
        totalRecipients: eligibleRecipients.length,
        sentCount: 0,
        deliveredCount: 0,
        readCount: 0,
        repliedCount: 0,
        failedCount: 0,
        estimatedCostPaise: totalCostPaise,
        actualCostPaise: 0,
        scheduledAt: now,
        completedAt: null,
        createdAt: now,
      })
      .run();

    for (let offset = 0; offset < eligibleRecipients.length; offset += BROADCAST_CHUNK_SIZE) {
      const chunkIndex = Math.floor(offset / BROADCAST_CHUNK_SIZE);
      const slice = eligibleRecipients.slice(offset, offset + BROADCAST_CHUNK_SIZE);
      await enqueueJob({
        queue: "broadcast.fanout",
        jobType: "whatsapp.broadcast.chunk",
        tenantId: ctx.workspaceId,
        correlationId: ctx.correlationId,
        requestId: ctx.requestId,
        actorType: ctx.actorType,
        actorId: ctx.actorId,
        idempotencyKey: `bcast_chunk:${broadcastId}:${chunkIndex}`,
        payload: {
          broadcastId,
          broadcastName: input.name.trim(),
          templateId: template.id,
          templateName: template.name,
          unitCostPaise,
          recipients: slice.map((r) => ({
            phoneE164: r.phoneE164,
            name: contactNameByPhone.get(r.phoneE164) ?? undefined,
          })),
        },
      });
    }

    if (!isRedisConfigured()) {
      await processDueSqliteOutboxForTenant(ctx.workspaceId, { queueName: "broadcast.fanout" });
    }

    const finalRow = dataDb
      .select()
      .from(tenantDataSchema.broadcasts)
      .where(eq(tenantDataSchema.broadcasts.id, broadcastId))
      .get();

    return {
      broadcastId,
      recipientCount: finalRow?.sentCount ?? eligibleRecipients.length,
      costPaise: finalRow?.actualCostPaise ?? totalCostPaise,
    };
  },
});

// ==========================================
// Platform Staff Backend Template Operations
// ==========================================

export function listAllPlatformWhatsAppTemplates() {
  const ctrl = controlDb();
  const activeTenants = ctrl
    .select()
    .from(controlSchema.tenantRegistry)
    .where(eq(controlSchema.tenantRegistry.status, "active"))
    .all();

  const workspaces = ctrl.select().from(controlSchema.workspaces).all();
  const wsNameById = new Map(workspaces.map((w) => [w.id, w.name]));

  const all: Array<ParsedWhatsAppTemplate & { workspaceId: string; workspaceName: string }> = [];

  for (const t of activeTenants) {
    try {
      const rows = tenantDataDb({ workspaceId: t.tenantId })
        .select()
        .from(tenantDataSchema.whatsappTemplates)
        .orderBy(desc(tenantDataSchema.whatsappTemplates.createdAt))
        .all();

      for (const r of rows) {
        all.push({
          ...parseTemplateRow(r),
          workspaceId: t.tenantId,
          workspaceName: wsNameById.get(t.tenantId) ?? t.tenantId,
        });
      }
    } catch {
      // Skip inaccessible tenant
    }
  }

  return all;
}

export function staffUpdateWhatsAppTemplateStatus(params: {
  workspaceId: string;
  templateId: string;
  approvalStatus: "APPROVED" | "PENDING" | "REJECTED" | "PAUSED";
  rejectionReason?: string;
}) {
  const db = tenantDataDb({ workspaceId: params.workspaceId });
  db.update(tenantDataSchema.whatsappTemplates)
    .set({
      approvalStatus: params.approvalStatus,
      rejectionReason: params.approvalStatus === "REJECTED" ? params.rejectionReason || "Policy mismatch" : null,
      updatedAt: Date.now(),
    })
    .where(eq(tenantDataSchema.whatsappTemplates.id, params.templateId))
    .run();
}
