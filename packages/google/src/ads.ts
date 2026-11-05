import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  allocateAdSpendToCampaign,
  releaseUnusedCampaignAdSpend,
} from "@rsl/billing";
import {
  formatGoogleAdsCustomerId,
  resolveWorkspaceGoogleAdsCredentials,
} from "@rsl/connections";
import { formatInr, newId, RslError, rupeesToPaise } from "@rsl/core";
import { tenantDataSchema } from "@rsl/database";
import { defineAction } from "@rsl/logging";
import { tenantDataDb } from "@rsl/tenancy";

const GOOGLE_ADS_API_VERSION = "v18";

function buildGoogleAdsHeaders(creds: {
  accessToken: string;
  developerToken: string;
  loginCustomerId?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.accessToken}`,
    "developer-token": creds.developerToken,
    "Content-Type": "application/json",
  };
  if (creds.loginCustomerId) {
    headers["login-customer-id"] = creds.loginCustomerId.replace(/[^0-9]/g, "");
  }
  return headers;
}

function sanitizeRsaAssetText(text: string, maxLen: number, fallback: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return fallback.slice(0, maxLen);
  return clean.slice(0, maxLen);
}

export const createGoogleAdCampaign = defineAction({
  key: "google.ads.campaign.created",
  permission: "ads:create",
  input: z.object({
    name: z.string().min(2).max(120),
    objective: z
      .enum(["search_leads", "performance_max", "call_ads", "website_sales"])
      .default("search_leads"),
    billingMode: z.enum(["direct_client", "rsl_managed_vault"]).default("direct_client"),
    dailyBudgetRupees: z.coerce.number().min(50, "Minimum Google Ads daily budget is ₹50"),
    vaultAllocationRupees: z.coerce.number().min(0).optional(),
    headline: z.string().max(90).optional(),
    primaryText: z.string().max(300).optional(),
    callToAction: z.string().max(40).optional(),
    destinationUrl: z.string().max(500).optional(),
    whatsappPhoneE164: z.string().max(24).optional(),
    mediaUrl: z.string().max(1000).optional(),
    targetLocations: z.array(z.string().min(1).max(80)).max(20).optional(),
    targetKeywords: z.array(z.string().min(1).max(80)).max(30).optional(),
    startDateIso: z.string().optional(),
    allowDraftWhenDisconnected: z.boolean().default(false),
  }),
  summarize: (input) =>
    `Launched Google Ads (${input.objective}) '${input.name}' at ${formatInr(rupeesToPaise(input.dailyBudgetRupees))}/day [${input.billingMode}]`,
  handler: async (ctx, input) => {
    const now = Date.now();
    const campaignId = newId();
    const dailyBudgetPaise = rupeesToPaise(input.dailyBudgetRupees);
    const startTs = input.startDateIso ? new Date(input.startDateIso).getTime() || now : now;

    const cleanWaDigits = (input.whatsappPhoneE164 || "").replace(/[^0-9]/g, "");
    const resolvedFinalUrl =
      input.destinationUrl?.trim() ||
      (cleanWaDigits ? `https://wa.me/${cleanWaDigits}` : "https://rapidshiftlabs.in");

    const vaultAllocatedPaise =
      input.billingMode === "rsl_managed_vault"
        ? rupeesToPaise(
            input.vaultAllocationRupees && input.vaultAllocationRupees > 0
              ? input.vaultAllocationRupees
              : Math.max(input.dailyBudgetRupees, 500)
          )
        : 0;

    if (input.billingMode === "rsl_managed_vault") {
      if (vaultAllocatedPaise < dailyBudgetPaise) {
        throw new RslError(
          "RSL-VAL-1001",
          `Managed Vault allocation (${formatInr(vaultAllocatedPaise)}) must be at least 1 day's budget (${formatInr(dailyBudgetPaise)}).`
        );
      }
      allocateAdSpendToCampaign({
        workspaceId: ctx.workspaceId,
        amountPaise: vaultAllocatedPaise,
        provider: "google_ads",
        campaignId,
        campaignName: input.name.trim(),
        idempotencyKey: `gads_alloc:${campaignId}`,
        actorId: ctx.actorId,
      });
    }

    const rollbackVaultIfAllocated = () => {
      if (input.billingMode === "rsl_managed_vault" && vaultAllocatedPaise > 0) {
        releaseUnusedCampaignAdSpend({
          workspaceId: ctx.workspaceId,
          unspentAmountPaise: vaultAllocatedPaise,
          provider: "google_ads",
          campaignId,
          campaignName: input.name.trim(),
          idempotencyKey: `gads_rollback:${campaignId}`,
          actorId: ctx.actorId,
        });
      }
    };

    const creds = await resolveWorkspaceGoogleAdsCredentials({
      workspaceId: ctx.workspaceId,
      billingMode: input.billingMode,
    });

    if (!creds.ok) {
      if (input.billingMode === "direct_client" && input.allowDraftWhenDisconnected) {
        tenantDataDb(ctx)
          .insert(tenantDataSchema.campaigns)
          .values({
            id: campaignId,
            name: input.name.trim(),
            channel: "google_ads",
            objective: input.objective,
            billingMode: input.billingMode,
            status: "paused",
            dailyBudgetPaise,
            lifetimeBudgetPaise: 0,
            vaultAllocatedPaise: 0,
            headline: input.headline?.trim() || null,
            primaryText: input.primaryText?.trim() || null,
            callToAction: input.callToAction?.trim() || "LEARN_MORE",
            destinationUrl: resolvedFinalUrl,
            whatsappPhoneE164: input.whatsappPhoneE164?.trim() || null,
            mediaUrl: input.mediaUrl?.trim() || null,
            targetLocationsJson: JSON.stringify(input.targetLocations ?? ["India"]),
            targetKeywordsJson: JSON.stringify(input.targetKeywords ?? []),
            syncStatus: "local_draft",
            lastSyncMessage: creds.error || "Connect Google Ads on Connected Channels to publish live.",
            startDate: startTs,
            createdAt: now,
            updatedAt: now,
          })
          .run();

        return {
          campaignId,
          syncStatus: "local_draft" as const,
          externalCampaignId: null,
        };
      }

      rollbackVaultIfAllocated();
      throw new RslError(
        "RSL-VAL-1001",
        creds.error || "Google Ads credentials are not connected."
      );
    }

    const customerId = creds.customerId!;
    let externalCampaignId = "";
    let externalAdsetId: string | null = null;
    let externalCreativeId: string | null = null;
    let externalAdId: string | null = null;
    let syncStatus: "live_synced" | "sandbox_simulated" = "live_synced";
    let lastSyncMessage = "";

    if (creds.mode === "sandbox") {
      syncStatus = "sandbox_simulated";
      externalCampaignId = `customers/${customerId}/campaigns/sb_${Date.now()}`;
      externalAdsetId = `customers/${customerId}/adGroups/sb_${Date.now()}`;
      externalCreativeId = `customers/${customerId}/campaignBudgets/sb_${Date.now()}`;
      externalAdId = `customers/${customerId}/adGroupAds/sb_${Date.now()}`;
      lastSyncMessage = `Sandbox Google Ads campaign provisioned on Customer ${formatGoogleAdsCustomerId(customerId)}.`;
    } else {
      const budgetMicros = String(dailyBudgetPaise * 10_000);
      const isPMax = input.objective === "performance_max";
      const budgetTempResource = `customers/${customerId}/campaignBudgets/-1`;
      const campaignTempResource = `customers/${customerId}/campaigns/-2`;
      const adGroupTempResource = `customers/${customerId}/adGroups/-3`;

      const mutateOperations: Array<Record<string, unknown>> = [
        {
          campaignBudgetOperation: {
            create: {
              resourceName: budgetTempResource,
              name: `RSL Budget • ${input.name.trim().slice(0, 60)} • ${now}`,
              amountMicros: budgetMicros,
              deliveryMethod: "STANDARD",
              explicitlyShared: false,
            },
          },
        },
        {
          campaignOperation: {
            create: {
              resourceName: campaignTempResource,
              name: `${input.name.trim()}${input.billingMode === "rsl_managed_vault" ? ` [RSL-${ctx.workspaceId.slice(0, 8)}]` : ""}`,
              advertisingChannelType: isPMax ? "PERFORMANCE_MAX" : "SEARCH",
              status: "ENABLED",
              campaignBudget: budgetTempResource,
              ...(isPMax
                ? {
                    maximizeConversionValue: {},
                    urlExpansionOptOut: false,
                  }
                : {
                    manualCpc: { enhancedCpcEnabled: false },
                    networkSettings: {
                      targetGoogleSearch: true,
                      targetSearchNetwork: true,
                      targetContentNetwork: false,
                    },
                  }),
            },
          },
        },
      ];

      if (!isPMax) {
        mutateOperations.push({
          adGroupOperation: {
            create: {
              resourceName: adGroupTempResource,
              name: `${input.name.trim().slice(0, 80)} — Search Ad Group`,
              campaign: campaignTempResource,
              status: "ENABLED",
              type: "SEARCH_STANDARD",
              cpcBidMicros: "15000000", // ₹15 default max CPC
            },
          },
        });

        const keywords =
          input.targetKeywords && input.targetKeywords.length > 0
            ? input.targetKeywords.slice(0, 15)
            : [input.name.trim().slice(0, 60)];

        for (const kw of keywords) {
          const cleanKw = kw.replace(/[^\p{L}\p{N}\s+-]/gu, " ").replace(/\s+/g, " ").trim();
          if (!cleanKw) continue;
          mutateOperations.push({
            adGroupCriterionOperation: {
              create: {
                adGroup: adGroupTempResource,
                status: "ENABLED",
                keyword: {
                  text: cleanKw.slice(0, 80),
                  matchType: "BROAD",
                },
              },
            },
          });
        }

        const h1 = sanitizeRsaAssetText(
          input.headline || input.name,
          30,
          input.name.trim().slice(0, 30)
        );
        const h2 = sanitizeRsaAssetText(
          input.targetLocations?.[0] ? `Serving ${input.targetLocations[0]}` : "Trusted Quality & Service",
          30,
          "Get Instant Quote Today"
        );
        const h3 = sanitizeRsaAssetText(
          input.objective === "call_ads" ? "Call or Enquire Direct" : "Enquire Online Today",
          30,
          "Contact Us Now"
        );
        const d1 = sanitizeRsaAssetText(
          input.primaryText || `${input.name.trim()} — Connect with us for fast pricing and verified service.`,
          90,
          "Connect with our team today for fast pricing, verified quality, and prompt delivery."
        );
        const d2 = sanitizeRsaAssetText(
          input.callToAction
            ? `${input.callToAction.replace(/_/g, " ")} — Direct support & transparent GST billing.`
            : "Fast response on enquiries with transparent pricing and verified delivery.",
          90,
          "Fast response on enquiries with transparent pricing and verified delivery."
        );

        mutateOperations.push({
          adGroupAdOperation: {
            create: {
              adGroup: adGroupTempResource,
              status: "ENABLED",
              ad: {
                finalUrls: [resolvedFinalUrl],
                responsiveSearchAd: {
                  headlines: [{ text: h1 }, { text: h2 }, { text: h3 }],
                  descriptions: [{ text: d1 }, { text: d2 }],
                },
              },
            },
          },
        });
      }

      let mutateResp: Response;
      try {
        mutateResp = await fetch(
          `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:mutate`,
          {
            method: "POST",
            headers: buildGoogleAdsHeaders({
              accessToken: creds.accessToken!,
              developerToken: creds.developerToken!,
              loginCustomerId: creds.loginCustomerId,
            }),
            body: JSON.stringify({ mutateOperations }),
            signal: AbortSignal.timeout(15_000),
          }
        );
      } catch (err) {
        rollbackVaultIfAllocated();
        throw new RslError(
          "RSL-VAL-1001",
          `Network error reaching Google Ads API: ${err instanceof Error ? err.message : "timeout"}. Any reserved Managed Vault funds were automatically refunded.`
        );
      }

      const mutateBody = (await mutateResp.json().catch(() => ({}))) as {
        mutateOperationResponses?: Array<{
          campaignBudgetResult?: { resourceName?: string };
          campaignResult?: { resourceName?: string };
          adGroupResult?: { resourceName?: string };
          adGroupAdResult?: { resourceName?: string };
        }>;
        error?: { message?: string; status?: string };
      };

      if (!mutateResp.ok) {
        rollbackVaultIfAllocated();
        throw new RslError(
          "RSL-VAL-1001",
          `Google Ads API rejected campaign launch (HTTP ${mutateResp.status}): ${mutateBody.error?.message || "Verify Google Ads billing setup & Developer Token access level."}`
        );
      }

      const opResponses = mutateBody.mutateOperationResponses ?? [];
      for (const r of opResponses) {
        if (r.campaignBudgetResult?.resourceName) {
          externalCreativeId = r.campaignBudgetResult.resourceName; // Store budget resourceName here for live budget edits!
        }
        if (r.campaignResult?.resourceName) {
          externalCampaignId = r.campaignResult.resourceName;
        }
        if (r.adGroupResult?.resourceName) {
          externalAdsetId = r.adGroupResult.resourceName;
        }
        if (r.adGroupAdResult?.resourceName) {
          externalAdId = r.adGroupAdResult.resourceName;
        }
      }

      if (!externalCampaignId) {
        externalCampaignId = `customers/${customerId}/campaigns/live_${now}`;
      }
      lastSyncMessage = `Live on Google Ads (${formatGoogleAdsCustomerId(customerId)}) • ${isPMax ? "Performance Max" : "Search RSA"}`;
    }

    tenantDataDb(ctx)
      .insert(tenantDataSchema.campaigns)
      .values({
        id: campaignId,
        name: input.name.trim(),
        channel: "google_ads",
        objective: input.objective,
        billingMode: input.billingMode,
        status: "active",
        dailyBudgetPaise,
        lifetimeBudgetPaise: vaultAllocatedPaise,
        vaultAllocatedPaise,
        totalSpendPaise: 0,
        attributedRevenuePaise: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        externalAccountId: customerId,
        externalCampaignId,
        externalAdsetId,
        externalCreativeId,
        externalAdId,
        headline: input.headline?.trim() || input.name.trim(),
        primaryText: input.primaryText?.trim() || null,
        callToAction: input.callToAction?.trim() || "LEARN_MORE",
        destinationUrl: resolvedFinalUrl,
        whatsappPhoneE164: input.whatsappPhoneE164?.trim() || null,
        mediaUrl: input.mediaUrl?.trim() || null,
        targetLocationsJson: JSON.stringify(input.targetLocations ?? ["India"]),
        targetKeywordsJson: JSON.stringify(input.targetKeywords ?? []),
        syncStatus,
        lastSyncMessage,
        lastSyncedAt: now,
        startDate: startTs,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return {
      campaignId,
      syncStatus,
      externalCampaignId,
    };
  },
});

export async function mutateGoogleAdCampaignStatusInternal(params: {
  workspaceId: string;
  actorId: string;
  campaignId: string;
  status: "active" | "paused" | "completed";
}): Promise<{ updated: boolean; releasedPaise: number; syncMessage: string }> {
  const db = tenantDataDb({ workspaceId: params.workspaceId });
  const camp = db
    .select()
    .from(tenantDataSchema.campaigns)
    .where(eq(tenantDataSchema.campaigns.id, params.campaignId))
    .get();

  if (!camp) {
    throw new RslError("RSL-VAL-1001", "Google Ads campaign not found.");
  }

  let syncMessage = camp.lastSyncMessage || "";

  if (camp.externalCampaignId && camp.syncStatus !== "local_draft") {
    const creds = await resolveWorkspaceGoogleAdsCredentials({
      workspaceId: params.workspaceId,
      billingMode:
        camp.billingMode === "rsl_managed_vault" ? "rsl_managed_vault" : "direct_client",
    });

    if (creds.ok && creds.mode === "live" && creds.customerId) {
      const gadsStatus = params.status === "active" ? "ENABLED" : "PAUSED";
      const resourceName = camp.externalCampaignId.startsWith("customers/")
        ? camp.externalCampaignId
        : `customers/${creds.customerId}/campaigns/${camp.externalCampaignId}`;

      const resp = await fetch(
        `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${creds.customerId}/googleAds:mutate`,
        {
          method: "POST",
          headers: buildGoogleAdsHeaders({
            accessToken: creds.accessToken!,
            developerToken: creds.developerToken!,
            loginCustomerId: creds.loginCustomerId,
          }),
          body: JSON.stringify({
            mutateOperations: [
              {
                campaignOperation: {
                  update: {
                    resourceName,
                    status: gadsStatus,
                  },
                  updateMask: "status",
                },
              },
            ],
          }),
          signal: AbortSignal.timeout(10_000),
        }
      );

      if (!resp.ok) {
        const errBody = (await resp.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new RslError(
          "RSL-VAL-1001",
          `Google Ads API rejected status change (HTTP ${resp.status}): ${errBody.error?.message || "Unknown error"}`
        );
      }
      syncMessage = `Google Ads status updated to ${gadsStatus} (${new Date().toLocaleTimeString("en-IN")})`;
    }
  }

  let releasedPaise = 0;
  let nextVaultAllocated = camp.vaultAllocatedPaise;

  if (
    params.status === "completed" &&
    camp.billingMode === "rsl_managed_vault" &&
    camp.vaultAllocatedPaise > camp.totalSpendPaise
  ) {
    releasedPaise = camp.vaultAllocatedPaise - camp.totalSpendPaise;
    releaseUnusedCampaignAdSpend({
      workspaceId: params.workspaceId,
      unspentAmountPaise: releasedPaise,
      provider: "google_ads",
      campaignId: camp.id,
      campaignName: camp.name,
      idempotencyKey: `gads_complete_release:${camp.id}`,
      actorId: params.actorId,
    });
    nextVaultAllocated = camp.totalSpendPaise;
    syncMessage = `Campaign completed; refunded ${formatInr(releasedPaise, { showDecimals: true })} unspent funds to Ad Spend Vault.`;
  }

  const now = Date.now();
  db.update(tenantDataSchema.campaigns)
    .set({
      status: params.status,
      vaultAllocatedPaise: nextVaultAllocated,
      endDate: params.status === "completed" ? now : camp.endDate,
      lastSyncMessage: syncMessage || camp.lastSyncMessage,
      lastSyncedAt: now,
      updatedAt: now,
    })
    .where(eq(tenantDataSchema.campaigns.id, camp.id))
    .run();

  return { updated: true, releasedPaise, syncMessage };
}

export async function updateGoogleAdCampaignBudgetInternal(params: {
  workspaceId: string;
  actorId: string;
  campaignId: string;
  dailyBudgetRupees: number;
  additionalVaultAllocationRupees?: number;
}): Promise<{ updated: boolean; dailyBudgetPaise: number; vaultAllocatedPaise: number }> {
  const db = tenantDataDb({ workspaceId: params.workspaceId });
  const camp = db
    .select()
    .from(tenantDataSchema.campaigns)
    .where(eq(tenantDataSchema.campaigns.id, params.campaignId))
    .get();

  if (!camp) {
    throw new RslError("RSL-VAL-1001", "Google Ads campaign not found.");
  }

  const dailyBudgetPaise = rupeesToPaise(params.dailyBudgetRupees);
  if (dailyBudgetPaise < 5000) {
    throw new RslError("RSL-VAL-1001", "Minimum Google Ads daily budget is ₹50.");
  }

  const extraVaultPaise =
    camp.billingMode === "rsl_managed_vault" &&
    params.additionalVaultAllocationRupees &&
    params.additionalVaultAllocationRupees > 0
      ? rupeesToPaise(params.additionalVaultAllocationRupees)
      : 0;

  if (extraVaultPaise > 0) {
    allocateAdSpendToCampaign({
      workspaceId: params.workspaceId,
      amountPaise: extraVaultPaise,
      provider: "google_ads",
      campaignId: camp.id,
      campaignName: camp.name,
      externalCampaignId: camp.externalCampaignId ?? undefined,
      idempotencyKey: `gads_topup_alloc:${camp.id}:${Date.now()}`,
      actorId: params.actorId,
    });
  }

  const nextVaultAllocated = camp.vaultAllocatedPaise + extraVaultPaise;

  if (camp.externalCreativeId && camp.syncStatus === "live_synced") {
    const creds = await resolveWorkspaceGoogleAdsCredentials({
      workspaceId: params.workspaceId,
      billingMode:
        camp.billingMode === "rsl_managed_vault" ? "rsl_managed_vault" : "direct_client",
    });

    if (creds.ok && creds.mode === "live" && creds.customerId) {
      const resp = await fetch(
        `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${creds.customerId}/googleAds:mutate`,
        {
          method: "POST",
          headers: buildGoogleAdsHeaders({
            accessToken: creds.accessToken!,
            developerToken: creds.developerToken!,
            loginCustomerId: creds.loginCustomerId,
          }),
          body: JSON.stringify({
            mutateOperations: [
              {
                campaignBudgetOperation: {
                  update: {
                    resourceName: camp.externalCreativeId,
                    amountMicros: String(dailyBudgetPaise * 10_000),
                  },
                  updateMask: "amount_micros",
                },
              },
            ],
          }),
          signal: AbortSignal.timeout(10_000),
        }
      );

      if (!resp.ok) {
        const errBody = (await resp.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new RslError(
          "RSL-VAL-1001",
          `Google Ads API rejected budget update (HTTP ${resp.status}): ${errBody.error?.message || "Unknown error"}`
        );
      }
    }
  }

  const now = Date.now();
  db.update(tenantDataSchema.campaigns)
    .set({
      dailyBudgetPaise,
      vaultAllocatedPaise: nextVaultAllocated,
      lifetimeBudgetPaise: nextVaultAllocated > 0 ? nextVaultAllocated : camp.lifetimeBudgetPaise,
      status:
        camp.syncStatus === "vault_cap_reached" && nextVaultAllocated > camp.totalSpendPaise
          ? "active"
          : camp.status,
      syncStatus:
        camp.syncStatus === "vault_cap_reached" && nextVaultAllocated > camp.totalSpendPaise
          ? camp.externalCampaignId?.includes("/sb_")
            ? "sandbox_simulated"
            : "live_synced"
          : camp.syncStatus,
      lastSyncedAt: now,
      updatedAt: now,
    })
    .where(eq(tenantDataSchema.campaigns.id, camp.id))
    .run();

  return {
    updated: true,
    dailyBudgetPaise,
    vaultAllocatedPaise: nextVaultAllocated,
  };
}

export async function syncGoogleAdCampaignsInsightsForWorkspace(workspaceId: string): Promise<{
  syncedCampaigns: number;
  autoPausedVaultCampaigns: number;
}> {
  const db = tenantDataDb({ workspaceId });
  const googleCampaigns = db
    .select()
    .from(tenantDataSchema.campaigns)
    .where(eq(tenantDataSchema.campaigns.channel, "google_ads"))
    .all();

  if (googleCampaigns.length === 0) {
    return { syncedCampaigns: 0, autoPausedVaultCampaigns: 0 };
  }

  let syncedCampaigns = 0;
  let autoPausedVaultCampaigns = 0;

  const modesPresent = new Set<"direct_client" | "rsl_managed_vault">();
  for (const c of googleCampaigns) {
    if (c.externalCampaignId && c.syncStatus !== "local_draft") {
      modesPresent.add(
        c.billingMode === "rsl_managed_vault" ? "rsl_managed_vault" : "direct_client"
      );
    }
  }

  for (const mode of modesPresent) {
    const creds = await resolveWorkspaceGoogleAdsCredentials({
      workspaceId,
      billingMode: mode,
    });
    if (!creds.ok || creds.mode !== "live" || !creds.customerId) continue;

    const query =
      "SELECT campaign.id, campaign.resource_name, campaign.name, campaign.status, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date DURING LAST_30_DAYS";

    try {
      const resp = await fetch(
        `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${creds.customerId}/googleAds:searchStream`,
        {
          method: "POST",
          headers: buildGoogleAdsHeaders({
            accessToken: creds.accessToken!,
            developerToken: creds.developerToken!,
            loginCustomerId: creds.loginCustomerId,
          }),
          body: JSON.stringify({ query }),
          signal: AbortSignal.timeout(15_000),
        }
      );

      if (!resp.ok) continue;

      const batches = (await resp.json().catch(() => [])) as Array<{
        results?: Array<{
          campaign?: {
            id?: string;
            resourceName?: string;
            name?: string;
            status?: string;
          };
          segments?: { date?: string };
          metrics?: {
            costMicros?: string | number;
            impressions?: string | number;
            clicks?: string | number;
            conversions?: string | number;
            conversionsValue?: string | number;
          };
        }>;
      }>;

      const byResource = new Map<string, (typeof googleCampaigns)[number]>();
      for (const c of googleCampaigns) {
        if (!c.externalCampaignId) continue;
        byResource.set(c.externalCampaignId, c);
        const numericTail = c.externalCampaignId.split("/").pop();
        if (numericTail) byResource.set(numericTail, c);
      }

      const touchedCampaignIds = new Set<string>();

      for (const batch of Array.isArray(batches) ? batches : []) {
        for (const row of batch.results ?? []) {
          const resName = row.campaign?.resourceName || "";
          const campIdNum = String(row.campaign?.id || "");
          const localCamp = byResource.get(resName) || byResource.get(campIdNum);
          const dayKey = row.segments?.date;
          if (!localCamp || !dayKey || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) continue;

          const costMicros = Number(row.metrics?.costMicros || 0);
          const spendPaise = Math.max(0, Math.round(costMicros / 10_000));
          const impressions = Math.max(0, Math.round(Number(row.metrics?.impressions || 0)));
          const clicks = Math.max(0, Math.round(Number(row.metrics?.clicks || 0)));
          const conversions = Math.max(0, Math.round(Number(row.metrics?.conversions || 0)));
          const revenuePaise = Math.max(
            0,
            Math.round(Number(row.metrics?.conversionsValue || 0) * 100)
          );

          db.insert(tenantDataSchema.insightSnapshots)
            .values({
              id: newId(),
              campaignId: localCamp.id,
              dayKey,
              spendPaise,
              revenuePaise,
              impressions,
              clicks,
              leadsCount: conversions,
              salesCount: conversions,
              createdAt: Date.now(),
            })
            .onConflictDoUpdate({
              target: [
                tenantDataSchema.insightSnapshots.campaignId,
                tenantDataSchema.insightSnapshots.dayKey,
              ],
              set: {
                spendPaise,
                revenuePaise,
                impressions,
                clicks,
                leadsCount: conversions,
                salesCount: conversions,
              },
            })
            .run();

          touchedCampaignIds.add(localCamp.id);
        }
      }

      const now = Date.now();
      for (const campId of touchedCampaignIds) {
        const snaps = db
          .select()
          .from(tenantDataSchema.insightSnapshots)
          .where(eq(tenantDataSchema.insightSnapshots.campaignId, campId))
          .all();

        const totals = snaps.reduce(
          (acc, s) => ({
            spend: acc.spend + s.spendPaise,
            rev: acc.rev + s.revenuePaise,
            imp: acc.imp + s.impressions,
            clk: acc.clk + s.clicks,
            conv: acc.conv + s.salesCount,
          }),
          { spend: 0, rev: 0, imp: 0, clk: 0, conv: 0 }
        );

        const campRow = db
          .select()
          .from(tenantDataSchema.campaigns)
          .where(
            and(
              eq(tenantDataSchema.campaigns.id, campId),
              eq(tenantDataSchema.campaigns.channel, "google_ads")
            )
          )
          .get();
        if (!campRow) continue;

        const capReached =
          campRow.billingMode === "rsl_managed_vault" &&
          campRow.vaultAllocatedPaise > 0 &&
          totals.spend >= campRow.vaultAllocatedPaise &&
          campRow.status === "active";

        if (capReached) {
          // Immediately pause on live Google Ads so Managed MCC never overspends allocated vault funds
          try {
            await mutateGoogleAdCampaignStatusInternal({
              workspaceId,
              actorId: "system_vault_guard",
              campaignId: campRow.id,
              status: "paused",
            });
          } catch {
            // Even if remote pause retries next cycle, mark local state paused
          }
          autoPausedVaultCampaigns++;
        }

        db.update(tenantDataSchema.campaigns)
          .set({
            totalSpendPaise: totals.spend,
            attributedRevenuePaise: totals.rev,
            impressions: totals.imp,
            clicks: totals.clk,
            conversions: totals.conv,
            status: capReached ? "paused" : campRow.status,
            syncStatus: capReached ? "vault_cap_reached" : "live_synced",
            lastSyncMessage: capReached
              ? `Auto-paused at 100% of ${formatInr(campRow.vaultAllocatedPaise)} Managed Ad Spend Vault cap.`
              : `Synced GAQL metrics (${new Date(now).toLocaleString("en-IN")})`,
            lastSyncedAt: now,
            updatedAt: now,
          })
          .where(eq(tenantDataSchema.campaigns.id, campId))
          .run();

        syncedCampaigns++;
      }
    } catch {
      // Continue safely
    }
  }

  // Also enforce vault cap guard on any sandbox/manual snapshot campaigns
  for (const camp of googleCampaigns) {
    const fresh = db
      .select()
      .from(tenantDataSchema.campaigns)
      .where(eq(tenantDataSchema.campaigns.id, camp.id))
      .get();
    if (
      fresh &&
      fresh.billingMode === "rsl_managed_vault" &&
      fresh.vaultAllocatedPaise > 0 &&
      fresh.totalSpendPaise >= fresh.vaultAllocatedPaise &&
      fresh.status === "active"
    ) {
      db.update(tenantDataSchema.campaigns)
        .set({
          status: "paused",
          syncStatus: "vault_cap_reached",
          lastSyncMessage: `Auto-paused at 100% of ${formatInr(fresh.vaultAllocatedPaise)} Managed Ad Spend Vault cap.`,
          updatedAt: Date.now(),
        })
        .where(eq(tenantDataSchema.campaigns.id, fresh.id))
        .run();
      autoPausedVaultCampaigns++;
    }
  }

  return { syncedCampaigns, autoPausedVaultCampaigns };
}
