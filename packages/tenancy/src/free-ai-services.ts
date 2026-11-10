import { fetchWithRetry } from "@rsl/core";
import { resolveWorkspaceClientCloudflareAiCredentials } from "./client-cloudflare";
import {
  getPlatformBhashiniConfig,
  getPlatformCloudflareAiConfig,
  getPlatformTurnstileConfig,
} from "./platform-credentials";

/* ============================================================================
 * 1. Cloudflare Turnstile Server-Side Token Verification (`siteverify`)
 * ============================================================================ */

export interface TurnstileVerificationResult {
  allowed: boolean;
  skipped: boolean;
  warning?: string;
  error?: string;
}

export async function verifyCloudflareTurnstileToken(params: {
  token: string | null | undefined;
  remoteIp?: string | null;
  surface: "login" | "register" | "public_form";
}): Promise<TurnstileVerificationResult> {
  const cfg = getPlatformTurnstileConfig();
  const isTest = process.env.NODE_ENV === "test";

  if (!cfg.isReady) {
    return {
      allowed: true,
      skipped: true,
    };
  }

  const enforced =
    params.surface === "login"
      ? cfg.enforceOnLogin
      : params.surface === "register"
        ? cfg.enforceOnRegister
        : cfg.enforceOnPublicForms;

  if (!enforced) {
    return { allowed: true, skipped: true };
  }

  const responseToken = (params.token || "").trim();
  if (!responseToken) {
    return {
      allowed: false,
      skipped: false,
      error: "Please complete the Cloudflare security check before submitting.",
    };
  }

  // Cloudflare's official test secret key is permitted strictly inside automated test runs
  if (isTest && cfg.secretKey === "1x0000000000000000000000000000000AA") {
    return { allowed: true, skipped: false };
  }

  try {
    const body = new URLSearchParams();
    body.set("secret", cfg.secretKey);
    body.set("response", responseToken);
    if (params.remoteIp && params.remoteIp.trim()) {
      body.set("remoteip", params.remoteIp.trim());
    }

    const resp = await fetchWithRetry(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
      { maxAttempts: 2, timeoutMs: 6000 }
    );

    if (!resp.ok) {
      return {
        allowed: false,
        skipped: false,
        error: `Security check verification failed (HTTP ${resp.status}). Please retry.`,
      };
    }

    const json = (await resp.json()) as {
      success?: boolean;
      "error-codes"?: string[];
    };
    if (json.success) {
      return { allowed: true, skipped: false };
    }
    return {
      allowed: false,
      skipped: false,
      error: `Security check expired or invalid (${(json["error-codes"] || []).join(", ") || "turnstile_rejected"}).`,
    };
  } catch (err) {
    return {
      allowed: false,
      skipped: false,
      error: `Security verification unreachable (${err instanceof Error ? err.message : "timeout"}).`,
    };
  }
}

/* ============================================================================
 * 2. Cloudflare Workers AI Inference (Client Account First, Platform Fallback)
 * ============================================================================ */

export interface CloudflareAiTextResult {
  ok: boolean;
  text: string;
  provider: "cloudflare_workers_ai" | "unconfigured";
  billingOwner?: "client_cloudflare" | "platform_cloudflare";
  model?: string;
  error?: string;
}

export async function runCloudflareWorkersAiText(params: {
  workspaceId?: string | null;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<CloudflareAiTextResult> {
  const clientCfg = resolveWorkspaceClientCloudflareAiCredentials(params.workspaceId);
  const platformCfg = getPlatformCloudflareAiConfig();

  const useClient = Boolean(clientCfg && clientCfg.active);
  const accountId = useClient ? clientCfg!.accountId : platformCfg.accountId;
  const apiToken = useClient ? clientCfg!.apiToken : platformCfg.apiToken;
  const textModel = useClient ? clientCfg!.textModel : platformCfg.textModel;
  const aiGatewaySlug = useClient ? clientCfg!.aiGatewaySlug : "";
  const billingOwner: "client_cloudflare" | "platform_cloudflare" = useClient
    ? "client_cloudflare"
    : "platform_cloudflare";

  if (!useClient && !platformCfg.isReady) {
    return {
      ok: false,
      text: "",
      provider: "unconfigured",
      error: "Cloudflare Workers AI credentials are not configured.",
    };
  }

  if (useClient && clientCfg?.isSandbox) {
    // Deterministic sandbox inference for client-connected Cloudflare Workers AI in test/sandbox mode
    const lowerSys = params.systemPrompt.toLowerCase();
    let simulatedText = `Client Workers AI (${textModel}) processed: ${params.userPrompt.slice(0, 120)}`;
    if (lowerSys.includes("headline") && lowerSys.includes("primarytext")) {
      simulatedText = JSON.stringify({
        headline: "Direct GST Wholesale & Fast Dispatch",
        primaryText:
          "Connect directly for verified GST billing, ready stock, and priority dispatch from our warehouse.",
      });
    } else if (lowerSys.includes("translator") || lowerSys.includes("translate")) {
      simulatedText = `नमस्ते, ${params.userPrompt}`;
    }
    return {
      ok: true,
      text: simulatedText,
      provider: "cloudflare_workers_ai",
      billingOwner: "client_cloudflare",
      model: textModel,
    };
  }

  try {
    const url = aiGatewaySlug
      ? `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(accountId)}/${encodeURIComponent(aiGatewaySlug)}/workers-ai/${textModel}`
      : `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${textModel}`;
    const resp = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: params.systemPrompt },
            { role: "user", content: params.userPrompt },
          ],
          max_tokens: params.maxTokens ?? 320,
        }),
      },
      { maxAttempts: 2, timeoutMs: 12000 }
    );

    const json = (await resp.json().catch(() => ({}))) as {
      success?: boolean;
      result?: { response?: string };
      errors?: Array<{ message?: string }>;
    };

    const output = (json.result?.response || "").trim();
    if (resp.ok && json.success !== false && output) {
      return {
        ok: true,
        text: output,
        provider: "cloudflare_workers_ai",
        billingOwner,
        model: textModel,
      };
    }

    return {
      ok: false,
      text: "",
      provider: "unconfigured",
      billingOwner,
      error: json.errors?.[0]?.message || `Workers AI HTTP ${resp.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      text: "",
      provider: "unconfigured",
      billingOwner,
      error: err instanceof Error ? err.message : "Workers AI request failed",
    };
  }
}

export async function transcribeCloudflareWorkersAiAudio(params: {
  workspaceId?: string | null;
  audioBytes: Uint8Array | Buffer;
  mimeType?: string;
}): Promise<{
  ok: boolean;
  transcript: string;
  billingOwner?: "client_cloudflare" | "platform_cloudflare";
  error?: string;
}> {
  const clientCfg = resolveWorkspaceClientCloudflareAiCredentials(params.workspaceId);
  const platformCfg = getPlatformCloudflareAiConfig();

  const useClient = Boolean(clientCfg && clientCfg.active);
  const accountId = useClient ? clientCfg!.accountId : platformCfg.accountId;
  const apiToken = useClient ? clientCfg!.apiToken : platformCfg.apiToken;
  const whisperModel = useClient ? clientCfg!.whisperModel : platformCfg.whisperModel;
  const billingOwner: "client_cloudflare" | "platform_cloudflare" = useClient
    ? "client_cloudflare"
    : "platform_cloudflare";

  if (!useClient && !platformCfg.isReady) {
    return { ok: false, transcript: "", error: "Cloudflare Workers AI not configured." };
  }

  if (useClient && clientCfg?.isSandbox) {
    return {
      ok: true,
      transcript: "Transcribed via Client Cloudflare Workers AI Whisper model.",
      billingOwner: "client_cloudflare",
    };
  }

  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${whisperModel}`;
    const resp = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/octet-stream",
        },
        body: Buffer.from(params.audioBytes),
      },
      { maxAttempts: 2, timeoutMs: 15000 }
    );
    const json = (await resp.json().catch(() => ({}))) as {
      success?: boolean;
      result?: { text?: string };
    };
    const transcript = (json.result?.text || "").trim();
    if (resp.ok && transcript) {
      return { ok: true, transcript, billingOwner };
    }
    return { ok: false, transcript: "", billingOwner, error: `Whisper HTTP ${resp.status}` };
  } catch (err) {
    return {
      ok: false,
      transcript: "",
      billingOwner,
      error: err instanceof Error ? err.message : "Whisper transcription failed",
    };
  }
}

/* ============================================================================
 * 3. MeitY BHASHINI + Cloudflare AI Regional Language Business Translator
 * ============================================================================ */

export const SUPPORTED_INDIAN_LANGUAGES: ReadonlyArray<{
  code: string;
  metaLocale: string;
  label: string;
}> = [
  { code: "hi", metaLocale: "hi", label: "Hindi (हिन्दी)" },
  { code: "gu", metaLocale: "gu", label: "Gujarati (ગુજરાતી)" },
  { code: "mr", metaLocale: "mr", label: "Marathi (मराठी)" },
  { code: "ta", metaLocale: "ta", label: "Tamil (தமிழ்)" },
  { code: "te", metaLocale: "te", label: "Telugu (తెలుగు)" },
  { code: "kn", metaLocale: "kn", label: "Kannada (ಕನ್ನಡ)" },
  { code: "bn", metaLocale: "bn", label: "Bengali (বাংলা)" },
  { code: "ml", metaLocale: "ml", label: "Malayalam (മലയാളം)" },
  { code: "pa", metaLocale: "pa", label: "Punjabi (ਪੰਜਾਬੀ)" },
];

export interface IndianTranslationResult {
  ok: boolean;
  translatedText: string;
  targetLanguage: string;
  metaLocale: string;
  provider: "bhashini" | "cloudflare_workers_ai" | "identity" | "unconfigured";
  error?: string;
}

export async function translateIndianBusinessText(params: {
  workspaceId?: string | null;
  text: string;
  targetLanguage: string;
  sourceLanguage?: string;
}): Promise<IndianTranslationResult> {
  const sourceText = (params.text || "").trim();
  const targetLang = (params.targetLanguage || "hi").trim().toLowerCase().slice(0, 2);
  const sourceLang = (params.sourceLanguage || "en").trim().toLowerCase().slice(0, 2);
  const langMeta = SUPPORTED_INDIAN_LANGUAGES.find((l) => l.code === targetLang) ?? {
    code: targetLang,
    metaLocale: targetLang,
    label: targetLang.toUpperCase(),
  };

  if (!sourceText || targetLang === sourceLang) {
    return {
      ok: true,
      translatedText: sourceText,
      targetLanguage: targetLang,
      metaLocale: langMeta.metaLocale,
      provider: "identity",
    };
  }

  // Protect WhatsApp placeholders {{1}}, {{2}} from translation alteration
  const placeholders: string[] = [];
  const maskedInput = sourceText.replace(/\{\{\d+\}\}/g, (match) => {
    const idx = placeholders.length;
    placeholders.push(match);
    return `__VAR${idx}__`;
  });
  const restorePlaceholders = (out: string): string =>
    out.replace(/__VAR(\d+)__/g, (_, i) => placeholders[Number(i)] ?? `{{${Number(i) + 1}}}`);

  // 1. Try MeitY Digital India BHASHINI if configured in control.db
  const bhashini = getPlatformBhashiniConfig();
  if (bhashini.isReady && bhashini.inferenceApiKey) {
    try {
      const resp = await fetchWithRetry(
        "https://dhruva-api.bhashini.gov.in/services/inference/pipeline",
        {
          method: "POST",
          headers: {
            Authorization: bhashini.inferenceApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            pipelineTasks: [
              {
                taskType: "translation",
                config: {
                  language: {
                    sourceLanguage: sourceLang,
                    targetLanguage: targetLang,
                  },
                },
              },
            ],
            inputData: {
              input: [{ source: maskedInput }],
            },
          }),
        },
        { maxAttempts: 2, timeoutMs: 9000 }
      );
      if (resp.ok) {
        const json = (await resp.json()) as {
          pipelineResponse?: Array<{
            output?: Array<{ target?: string }>;
          }>;
        };
        const target = json.pipelineResponse?.[0]?.output?.[0]?.target?.trim();
        if (target) {
          return {
            ok: true,
            translatedText: restorePlaceholders(target),
            targetLanguage: targetLang,
            metaLocale: langMeta.metaLocale,
            provider: "bhashini",
          };
        }
      }
    } catch {
      // Fall back to Cloudflare Workers AI if configured
    }
  }

  // 2. Try Cloudflare Workers AI (Client's connected Cloudflare account first, then platform fallback)
  const aiRes = await runCloudflareWorkersAiText({
    workspaceId: params.workspaceId,
    systemPrompt: `You are an Indian business translator. Translate the user's business message from English into natural ${langMeta.label} script. Keep every __VAR0__, __VAR1__ token and ₹ symbol untouched. Output ONLY the translated text with no quotes or explanation.`,
    userPrompt: maskedInput,
    maxTokens: 350,
  });
  if (aiRes.ok && aiRes.text) {
    return {
      ok: true,
      translatedText: restorePlaceholders(aiRes.text),
      targetLanguage: targetLang,
      metaLocale: langMeta.metaLocale,
      provider: "cloudflare_workers_ai",
    };
  }

  // Honest unconfigured failure: never return untranslated English disguised as regional translation
  return {
    ok: false,
    translatedText: "",
    targetLanguage: targetLang,
    metaLocale: langMeta.metaLocale,
    provider: "unconfigured",
    error:
      aiRes.error ||
      `Regional translation into ${langMeta.label} requires MeitY BHASHINI or Cloudflare Workers AI credentials to be configured by a Platform Administrator.`,
  };
}

/* ============================================================================
 * 4. WhatsApp Meta Approval Risk Linter & Ad Copy Helper
 * ============================================================================ */

export interface TemplateLintFinding {
  severity: "blocker" | "warning";
  message: string;
}

export interface WhatsAppTemplateLintReport {
  riskLevel: "low" | "medium" | "high";
  recommendedCategory: "utility" | "marketing" | "authentication";
  findings: TemplateLintFinding[];
  aiSuggestedRewrite: string | null;
  rewriteProvider: "cloudflare_workers_ai" | null;
}

const PROMO_WORDS_IN_UTILITY = [
  "discount",
  "cashback",
  "sale",
  "hurry",
  "limited offer",
  "free gift",
  "promo code",
  "coupon",
  "buy now",
  "festive offer",
  "special offer",
];

export async function lintWhatsAppTemplateForMeta(params: {
  workspaceId?: string | null;
  category: string;
  headerText?: string;
  bodyText: string;
  footerText?: string;
}): Promise<WhatsAppTemplateLintReport> {
  const body = (params.bodyText || "").trim();
  const cat = (params.category || "utility").toLowerCase() as
    | "utility"
    | "marketing"
    | "authentication";
  const findings: TemplateLintFinding[] = [];

  if (!body) {
    return {
      riskLevel: "high",
      recommendedCategory: cat,
      findings: [{ severity: "blocker", message: "Template body text cannot be empty." }],
      aiSuggestedRewrite: null,
      rewriteProvider: null,
    };
  }

  if (/^\{\{\d+\}\}/.test(body)) {
    findings.push({
      severity: "blocker",
      message:
        "Meta rejects templates that start with a variable (e.g. '{{1}}, your bill...'). Add static text before '{{1}}' such as 'Hello {{1}},'.",
    });
  }
  if (/\{\{\d+\}\}[.!?]*$/.test(body)) {
    findings.push({
      severity: "blocker",
      message:
        "Meta rejects templates that end with a variable. Add closing text after the last variable (e.g. 'Thank you for your business.').",
    });
  }

  const nums = Array.from(body.matchAll(/\{\{(\d+)\}\}/g)).map((m) => Number(m[1]));
  const uniqueNums = Array.from(new Set(nums)).sort((a, b) => a - b);
  for (let i = 0; i < uniqueNums.length; i++) {
    if (uniqueNums[i] !== i + 1) {
      findings.push({
        severity: "blocker",
        message: `Variables must be sequential starting at {{1}} without gaps (found {{${uniqueNums.join("}}, {{")}}}).`,
      });
      break;
    }
  }

  const plainWords = body.replace(/\{\{\d+\}\}/g, "").trim().split(/\s+/).filter(Boolean);
  if (uniqueNums.length > 0 && plainWords.length < uniqueNums.length * 2 + 2) {
    findings.push({
      severity: "warning",
      message:
        "Too many variables relative to static words. Meta often rejects short templates packed with placeholders; add 4 to 6 clear context words.",
    });
  }

  if (/\b(bit\.ly|tinyurl\.com|t\.co|cutt\.ly|rb\.gy)\b/i.test(body)) {
    findings.push({
      severity: "blocker",
      message:
        "Meta blocks public URL shorteners (bit.ly, tinyurl) in templates. Use your verified business domain.",
    });
  }

  let recommendedCategory = cat;
  const lowerBody = body.toLowerCase();
  const matchedPromo = PROMO_WORDS_IN_UTILITY.filter((w) => lowerBody.includes(w));
  if (cat === "utility" && matchedPromo.length > 0) {
    recommendedCategory = "marketing";
    findings.push({
      severity: "warning",
      message: `Contains promotional terms (${matchedPromo.join(", ")}) inside a UTILITY template. Meta may reclassify or reject this unless reworded neutrally or submitted as MARKETING.`,
    });
  }

  const hasBlocker = findings.some((f) => f.severity === "blocker");
  const riskLevel: "low" | "medium" | "high" = hasBlocker
    ? "high"
    : findings.length > 0
      ? "medium"
      : "low";

  let aiSuggestedRewrite: string | null = null;
  let rewriteProvider: "cloudflare_workers_ai" | null = null;
  if (findings.length > 0) {
    const ai = await runCloudflareWorkersAiText({
      workspaceId: params.workspaceId,
      systemPrompt:
        "Rewrite this WhatsApp Business template so it passes Meta's UTILITY/MARKETING template review: never start or end with {{1}}, keep sequential {{1}}..{{n}} placeholders intact, remove URL shorteners, and keep a clear Indian business tone. Return ONLY the rewritten template body.",
      userPrompt: `Category: ${cat}\nOriginal Body: ${body}`,
      maxTokens: 220,
    });
    if (ai.ok && ai.text) {
      aiSuggestedRewrite = ai.text;
      rewriteProvider = "cloudflare_workers_ai";
    }
  }

  return {
    riskLevel,
    recommendedCategory,
    findings,
    aiSuggestedRewrite,
    rewriteProvider,
  };
}

export async function generateSmartAdCopy(params: {
  workspaceId?: string | null;
  businessName: string;
  offerSummary: string;
  channel: "meta_ads" | "google_ads";
  objective?: string;
}): Promise<{
  headline: string;
  primaryText: string;
  isAiGenerated: boolean;
  provider: "cloudflare_workers_ai" | "starter_draft";
  billingOwner?: "client_cloudflare" | "platform_cloudflare";
}> {
  const biz = (params.businessName || "Our Store").trim();
  const offer = (params.offerSummary || "GST-billed products and prompt dispatch").trim();

  const ai = await runCloudflareWorkersAiText({
    workspaceId: params.workspaceId,
    systemPrompt:
      'You write clear ad copy for Indian SMBs. Return valid JSON only with keys "headline" (max 40 chars) and "primaryText" (max 180 chars, clear Indian commercial value, no exaggerated claims).',
    userPrompt: `Business: ${biz}\nChannel: ${params.channel}\nObjective: ${params.objective || "leads"}\nOffer/Product: ${offer}`,
    maxTokens: 200,
  });

  if (ai.ok && ai.text) {
    try {
      const jsonMatch = ai.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          headline?: string;
          primaryText?: string;
        };
        if (parsed.headline && parsed.primaryText) {
          return {
            headline: parsed.headline.trim().slice(0, 60),
            primaryText: parsed.primaryText.trim().slice(0, 320),
            isAiGenerated: true,
            provider: "cloudflare_workers_ai",
            billingOwner: ai.billingOwner,
          };
        }
      }
    } catch {
      // fall through to deterministic starter draft
    }
  }

  return {
    headline: `${biz} | Direct Enquiry`.slice(0, 40),
    primaryText: `Looking for ${offer}? Contact ${biz} directly for GST invoices, wholesale pricing, and scheduled dispatch.`,
    isAiGenerated: false,
    provider: "starter_draft",
  };
}
