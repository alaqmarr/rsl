import { z } from "zod";
import { assertUserEmailVerified } from "@rsl/auth";
import { formatInr } from "@rsl/core";
import {
  addConversationInternalNote,
  assignConversationToMember,
  attachConversationLabel,
  createContact,
  deleteCannedReply,
  removeConversationLabel,
  replyToConversation,
  saveCannedReply,
  startOrLogConversation,
  updateConversationStatus,
} from "@rsl/inbox";
import {
  lintWhatsAppTemplateForMeta,
  translateIndianBusinessText,
} from "@rsl/tenancy";
import {
  addWhatsAppUnsubscribedNumber,
  createWhatsAppTemplate,
  deleteWhatsAppTemplate,
  installStarterTallyTemplates,
  launchWhatsAppBroadcast,
  removeWhatsAppUnsubscribedNumber,
  submitWhatsAppTemplateToMeta,
  syncWhatsAppTemplatesWithMeta,
  updateWhatsAppTemplate,
  type WhatsAppTemplateButton,
} from "@rsl/whatsapp";
import { requireWebSession } from "../session";
import {
  enforceFeaturePaidEntitlement,
  friendlyMessage,
  goWithError,
  goWithNotice,
} from "./shared";

const InboxChannelSchema = z.enum(["whatsapp", "instagram", "facebook", "google_review"]);
const InboxDirectionSchema = z.enum(["inbound", "outbound"]);
const InboxStatusSchema = z.enum(["open", "pending", "resolved", "snoozed"]);
const WaCategorySchema = z.enum(["utility", "marketing", "authentication"]);
const WaHeaderTypeSchema = z.enum(["NONE", "TEXT", "DOCUMENT", "IMAGE"]);
const WaButtonTypeSchema = z.enum(["QUICK_REPLY", "URL", "PHONE_NUMBER"]);

export async function createContactActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "inbox", "/inbox");
  const res = await createContact(session.ctx, {
    name: String(formData.get("name") || ""),
    phoneE164: String(formData.get("phoneE164") || ""),
    email: String(formData.get("email") || ""),
    companyName: String(formData.get("companyName") || ""),
    recordWhatsAppConsent: formData.get("recordWhatsAppConsent") === "on",
    consentSource: "direct_customer_entry",
  });
  if (!res.ok) return goWithError("/inbox", res.error.message);
  return goWithNotice("/inbox", "Customer contact saved.");
}

export async function startConversationActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "inbox", "/inbox");
  const parsedChannel = InboxChannelSchema.safeParse(String(formData.get("channel") || "whatsapp"));
  const parsedDir = InboxDirectionSchema.safeParse(String(formData.get("direction") || "inbound"));
  if (!parsedChannel.success || !parsedDir.success) {
    return goWithError("/inbox", "Invalid conversation channel or direction.");
  }
  const slaRaw = Number(formData.get("slaTargetMinutes") || 30);
  const slaTargetMinutes = Number.isFinite(slaRaw) ? Math.min(1440, Math.max(5, Math.trunc(slaRaw))) : 30;

  const res = await startOrLogConversation(session.ctx, {
    contactId: String(formData.get("contactId") || ""),
    channel: parsedChannel.data,
    direction: parsedDir.data,
    body: String(formData.get("body") || ""),
    slaTargetMinutes,
  });
  if (!res.ok) return goWithError("/inbox", res.error.message);
  return goWithNotice(`/inbox?conv=${encodeURIComponent(res.data.conversationId)}`, "Conversation logged.");
}

export async function replyConversationActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "inbox", "/inbox");
  const convId = String(formData.get("conversationId") || "");
  const returnPath = convId ? `/inbox?conv=${encodeURIComponent(convId)}` : "/inbox";

  if (!session.impersonatorStaffId) {
    try {
      assertUserEmailVerified(session.user.id, "sending outbound customer replies");
    } catch (err) {
      return goWithError(returnPath, friendlyMessage(err));
    }
  }

  const res = await replyToConversation(session.ctx, {
    conversationId: convId,
    body: String(formData.get("body") || ""),
    templateName: String(formData.get("templateName") || "") || undefined,
  });
  if (!res.ok) {
    return goWithError(returnPath, res.error.message);
  }
  return goWithNotice(returnPath, "Reply sent.");
}

export async function changeConversationStatusActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "inbox", "/inbox");
  const convId = String(formData.get("conversationId") || "");
  const returnPath = convId ? `/inbox?conv=${encodeURIComponent(convId)}` : "/inbox";
  const parsedStatus = InboxStatusSchema.safeParse(String(formData.get("status") || "resolved"));
  if (!parsedStatus.success) {
    return goWithError(returnPath, "Invalid conversation status.");
  }
  const res = await updateConversationStatus(session.ctx, {
    conversationId: convId,
    status: parsedStatus.data,
  });
  if (!res.ok) {
    return goWithError(returnPath, res.error.message);
  }
  return goWithNotice(returnPath, `Marked conversation as ${parsedStatus.data}.`);
}

export async function addInternalNoteActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "inbox", "/inbox");
  const convId = String(formData.get("conversationId") || "");
  const returnPath = convId ? `/inbox?conv=${encodeURIComponent(convId)}` : "/inbox";
  const res = await addConversationInternalNote(session.ctx, {
    conversationId: convId,
    authorName: session.user.name,
    body: String(formData.get("body") || ""),
  });
  if (!res.ok) {
    return goWithError(returnPath, res.error.message);
  }
  return goWithNotice(returnPath, "Private team note saved.");
}

export async function saveCannedReplyActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "inbox", "/inbox");
  const convId = String(formData.get("conversationId") || "").trim();
  const returnPath = convId ? `/inbox?conv=${encodeURIComponent(convId)}` : "/inbox";
  const res = await saveCannedReply(session.ctx, {
    shortcut: String(formData.get("shortcut") || "").trim().toLowerCase(),
    title: String(formData.get("title") || "").trim(),
    body: String(formData.get("body") || "").trim(),
  });
  if (!res.ok) return goWithError(returnPath, res.error.message);
  return goWithNotice(returnPath, `Saved quick reply "/${res.data.shortcut}".`);
}

export async function deleteCannedReplyActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "inbox", "/inbox");
  const convId = String(formData.get("conversationId") || "").trim();
  const returnPath = convId ? `/inbox?conv=${encodeURIComponent(convId)}` : "/inbox";
  const res = await deleteCannedReply(session.ctx, {
    replyId: String(formData.get("replyId") || ""),
  });
  if (!res.ok) return goWithError(returnPath, res.error.message);
  return goWithNotice(returnPath, "Quick reply removed.");
}

export async function assignConversationActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "inbox", "/inbox");
  const convId = String(formData.get("conversationId") || "").trim();
  const assignedUserId = String(formData.get("assignedUserId") || "").trim();
  const returnPath = convId ? `/inbox?conv=${encodeURIComponent(convId)}` : "/inbox";
  const res = await assignConversationToMember(session.ctx, {
    conversationId: convId,
    assignedUserId,
  });
  if (!res.ok) return goWithError(returnPath, res.error.message);
  return goWithNotice(
    returnPath,
    res.data.assignedUserId ? "Assigned thread to team member." : "Unassigned conversation thread."
  );
}

export async function attachConversationLabelActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "inbox", "/inbox");
  const convId = String(formData.get("conversationId") || "").trim();
  const returnPath = convId ? `/inbox?conv=${encodeURIComponent(convId)}` : "/inbox";
  const rawColorHex = String(formData.get("colorHex") || "").trim();
  const res = await attachConversationLabel(session.ctx, {
    conversationId: convId,
    labelName: String(formData.get("labelName") || "").trim(),
    ...(rawColorHex ? { colorHex: rawColorHex } : {}),
  });
  if (!res.ok) return goWithError(returnPath, res.error.message);
  return goWithNotice(returnPath, `Added label "${res.data.name}".`);
}

export async function removeConversationLabelActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "inbox", "/inbox");
  const convId = String(formData.get("conversationId") || "").trim();
  const returnPath = convId ? `/inbox?conv=${encodeURIComponent(convId)}` : "/inbox";
  const res = await removeConversationLabel(session.ctx, {
    conversationId: convId,
    labelId: String(formData.get("labelId") || "").trim(),
  });
  if (!res.ok) return goWithError(returnPath, res.error.message);
  return goWithNotice(returnPath, "Removed label from thread.");
}

export async function createTemplateActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "whatsapp.messaging", "/whatsapp");

  const variableMappings: Record<string, string> = {};
  for (let i = 1; i <= 6; i++) {
    const val = String(formData.get(`varMap_${i}`) || "").trim();
    if (val) variableMappings[String(i)] = val;
  }

  const buttons: WhatsAppTemplateButton[] = [];
  const btn1Text = String(formData.get("button1Text") || "").trim();
  const parsedBtnType = WaButtonTypeSchema.safeParse(String(formData.get("button1Type") || "QUICK_REPLY"));
  const btn1Type: WhatsAppTemplateButton["type"] = parsedBtnType.success
    ? parsedBtnType.data
    : "QUICK_REPLY";
  const btn1Target = String(formData.get("button1Target") || "").trim();
  if (btn1Text) {
    buttons.push({
      type: btn1Type,
      text: btn1Text,
      ...(btn1Type === "URL" ? { url: btn1Target } : {}),
      ...(btn1Type === "PHONE_NUMBER" ? { phoneNumber: btn1Target } : {}),
    });
  }

  const parsedCategory = WaCategorySchema.safeParse(String(formData.get("category") || "utility"));
  const parsedHeader = WaHeaderTypeSchema.safeParse(String(formData.get("headerType") || "NONE"));

  const res = await createWhatsAppTemplate(session.ctx, {
    name: String(formData.get("name") || "").trim().toLowerCase(),
    category: parsedCategory.success ? parsedCategory.data : "utility",
    language: String(formData.get("language") || "en_IN"),
    headerType: parsedHeader.success ? parsedHeader.data : "NONE",
    headerText: String(formData.get("headerText") || "").trim() || undefined,
    bodyText: String(formData.get("bodyText") || ""),
    footerText: String(formData.get("footerText") || "").trim() || undefined,
    variableMappings,
    buttons,
    submitToMeta: formData.get("submitToMeta") !== "off",
  });
  if (!res.ok) return goWithError("/whatsapp", res.error.message);
  return goWithNotice(
    "/whatsapp",
    res.data.approvalStatus === "APPROVED"
      ? "Template approved by Meta and ready for automations."
      : res.data.approvalStatus === "PENDING"
        ? "Template submitted to Meta for approval. It will automatically unlock for automations once Meta approves it."
        : "Template saved as Draft. Connect your WhatsApp Business Account and click 'Submit to Meta' before using it in automations."
  );
}

export async function submitTemplateToMetaActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "whatsapp.messaging", "/whatsapp");
  const res = await submitWhatsAppTemplateToMeta(session.ctx, {
    templateId: String(formData.get("templateId") || ""),
  });
  if (!res.ok) return goWithError("/whatsapp", res.error.message);
  return goWithNotice(
    "/whatsapp",
    res.data.approvalStatus === "APPROVED"
      ? "Template approved by Meta and ready for automations!"
      : "Template submitted to Meta for review. Status updates automatically via webhook or 'Sync Templates'."
  );
}

export async function updateTemplateActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "whatsapp.messaging", "/whatsapp");
  const parsedHeader = WaHeaderTypeSchema.safeParse(String(formData.get("headerType") || "NONE"));
  const res = await updateWhatsAppTemplate(session.ctx, {
    templateId: String(formData.get("templateId") || ""),
    headerType: parsedHeader.success ? parsedHeader.data : "NONE",
    headerText: String(formData.get("headerText") || ""),
    bodyText: String(formData.get("bodyText") || ""),
    footerText: String(formData.get("footerText") || ""),
  });
  if (!res.ok) return goWithError("/whatsapp", res.error.message);
  return goWithNotice("/whatsapp", "WhatsApp template updated.");
}

export async function deleteTemplateActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "whatsapp.messaging", "/whatsapp");
  const res = await deleteWhatsAppTemplate(session.ctx, {
    templateId: String(formData.get("templateId") || ""),
  });
  if (!res.ok) return goWithError("/whatsapp", res.error.message);
  return goWithNotice("/whatsapp", "WhatsApp template deleted.");
}

export async function installStarterTemplatesActionImpl() {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "whatsapp.messaging", "/whatsapp");
  const res = await installStarterTallyTemplates(session.ctx, {});
  if (!res.ok) return goWithError("/whatsapp", res.error.message);
  return goWithNotice(
    "/whatsapp",
    res.data.installed > 0
      ? res.data.approvedCount > 0
        ? `Added ${res.data.installed} Tally WhatsApp template(s) (${res.data.approvedCount} approved, ${res.data.pendingCount} pending Meta review).`
        : res.data.pendingCount > 0
          ? `Submitted ${res.data.pendingCount} Tally WhatsApp template(s) to Meta for approval.`
          : `Saved ${res.data.installed} Tally WhatsApp template draft(s). Connect WhatsApp Business Account & click 'Submit to Meta' to activate automations.`
      : "All starter Tally templates are already in your template library."
  );
}

export async function syncMetaTemplatesActionImpl() {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "whatsapp.messaging", "/whatsapp");
  const res = await syncWhatsAppTemplatesWithMeta(session.ctx, {});
  if (!res.ok) return goWithError("/whatsapp", res.error.message);
  return goWithNotice(
    "/whatsapp",
    `Synced ${res.data.syncedCount} templates from your WhatsApp Business Account.`
  );
}

export async function launchBroadcastActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "whatsapp.messaging", "/whatsapp");
  await enforceFeaturePaidEntitlement(session.workspace.id, "whatsapp.broadcast", "/whatsapp");
  if (!session.impersonatorStaffId) {
    try {
      assertUserEmailVerified(session.user.id, "launching WhatsApp broadcasts");
    } catch (err) {
      return goWithError("/whatsapp", friendlyMessage(err));
    }
  }
  const res = await launchWhatsAppBroadcast(session.ctx, {
    name: String(formData.get("name") || ""),
    templateId: String(formData.get("templateId") || ""),
  });
  if (!res.ok) return goWithError("/whatsapp", res.error.message);
  return goWithNotice(
    "/whatsapp",
    `Broadcast sent to ${res.data.recipientCount} opted-in contacts (${formatInr(res.data.costPaise, { showDecimals: true })}).`
  );
}

export async function addSuppressionActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "whatsapp.messaging", "/whatsapp");
  const res = await addWhatsAppUnsubscribedNumber(session.ctx, {
    phoneE164: String(formData.get("phoneE164") || ""),
    reason: String(formData.get("reason") || "Customer requested STOP"),
  });
  if (!res.ok) return goWithError("/whatsapp", res.error.message);
  return goWithNotice("/whatsapp", "Phone number added to opt-out list.");
}

export async function removeSuppressionActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "whatsapp.messaging", "/whatsapp");
  const res = await removeWhatsAppUnsubscribedNumber(session.ctx, {
    suppressionId: String(formData.get("suppressionId") || ""),
  });
  if (!res.ok) return goWithError("/whatsapp", res.error.message);
  return goWithNotice("/whatsapp", "Number removed from opt-out list after customer re-consent.");
}

export async function lintWhatsAppTemplateJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  score?: number;
  riskLevel?: "low" | "medium" | "high";
  recommendedCategory?: "utility" | "marketing" | "authentication";
  warnings?: string[];
  aiAdvice?: string | null;
  message?: string;
}> {
  try {
    const session = await requireWebSession();
    const parsedCategory = WaCategorySchema.safeParse(String(formData.get("category") || "utility"));
    const res = await lintWhatsAppTemplateForMeta({
      workspaceId: session.workspace.id,
      category: parsedCategory.success ? parsedCategory.data : "utility",
      headerText: String(formData.get("headerText") || ""),
      bodyText: String(formData.get("bodyText") || ""),
    });
    const score = res.riskLevel === "low" ? 96 : res.riskLevel === "medium" ? 72 : 35;
    return {
      ok: true,
      score,
      riskLevel: res.riskLevel,
      recommendedCategory: res.recommendedCategory,
      warnings: res.findings.map((f) => f.message),
      aiAdvice: res.aiSuggestedRewrite,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function translateWhatsAppTemplateJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  translatedText?: string;
  provider?: string;
  message?: string;
}> {
  try {
    const session = await requireWebSession();
    const text = String(formData.get("text") || "");
    const targetLanguage = String(formData.get("targetLanguage") || "hi");
    const res = await translateIndianBusinessText({
      workspaceId: session.workspace.id,
      text,
      sourceLanguage: "en",
      targetLanguage,
    });
    return {
      ok: res.ok,
      translatedText: res.translatedText,
      provider: res.provider,
      message: res.error,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}
