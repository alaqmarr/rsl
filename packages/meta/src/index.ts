import crypto from "node:crypto";
import { and, desc, eq, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { dispatchWorkspaceWebhookEvent } from "@rsl/api-keys";
import {
  allocateAdSpendToCampaign,
  releaseUnusedCampaignAdSpend,
} from "@rsl/billing";
import {
  resolveWorkspaceChannelCredentials,
  resolveWorkspaceMetaAdsCredentials,
} from "@rsl/connections";
import { formatInr, hashPiiIdentifier, newId, RslError, rupeesToPaise } from "@rsl/core";
import { tenantDataSchema } from "@rsl/database";
import {
  mutateGoogleAdCampaignStatusInternal,
  publishGoogleBusinessLocalPost,
  syncGoogleAdCampaignsInsightsForWorkspace,
  updateGoogleAdCampaignBudgetInternal,
} from "@rsl/google";
import { defineAction } from "@rsl/logging";
import { tenantDataDb } from "@rsl/tenancy";

export function getMetaWorkspaceSummary(workspaceId: string) {
  const db = tenantDataDb({ workspaceId });
  const campaigns = db
    .select()
    .from(tenantDataSchema.campaigns)
    .orderBy(desc(tenantDataSchema.campaigns.createdAt))
    .all();

  const posts = db
    .select()
    .from(tenantDataSchema.scheduledPosts)
    .orderBy(desc(tenantDataSchema.scheduledPosts.scheduledFor))
    .limit(100)
    .all();

  const pixelEvents = db
    .select()
    .from(tenantDataSchema.pixelEvents)
    .orderBy(desc(tenantDataSchema.pixelEvents.occurredAt))
    .limit(100)
    .all();

  return { campaigns, posts, pixelEvents };
}

function mapObjectiveToMetaApi(objective: string): {
  campaignObjective: string;
  optimizationGoal: string;
  defaultCta: string;
} {
  switch (objective) {
    case "messages":
      return {
        campaignObjective: "OUTCOME_ENGAGEMENT",
        optimizationGoal: "CONVERSATIONS",
        defaultCta: "WHATSAPP_MESSAGE",
      };
    case "lead_generation":
      return {
        campaignObjective: "OUTCOME_LEADS",
        optimizationGoal: "LINK_CLICKS",
        defaultCta: "SIGN_UP",
      };
    case "website_sales":
      return {
        campaignObjective: "OUTCOME_SALES",
        optimizationGoal: "LINK_CLICKS",
        defaultCta: "SHOP_NOW",
      };
    case "awareness":
    default:
      return {
        campaignObjective: "OUTCOME_AWARENESS",
        optimizationGoal: "REACH",
        defaultCta: "LEARN_MORE",
      };
  }
}

function sha256Lower(value: string): string {
  return crypto.createHash("sha256").update(value.trim().toLowerCase(), "utf8").digest("hex");
}

export const createAdCampaign = defineAction({
  key: "campaigns.created",
  permission: "ads:create",
  input: z.object({
    name: z.string().min(2).max(120),
    channel: z.enum(["meta_ads", "instagram", "facebook"]),
    objective: z.enum(["messages", "website_sales", "lead_generation", "awareness"]),
    billingMode: z.enum(["direct_client", "rsl_managed_vault"]).default("direct_client"),
    dailyBudgetRupees: z.coerce.number().min(0),
    vaultAllocationRupees: z.coerce.number().min(0).optional(),
    headline: z.string().max(120).optional(),
    primaryText: z.string().max(1000).optional(),
    callToAction: z.string().max(40).optional(),
    destinationUrl: z.string().max(500).optional(),
    whatsappPhoneE164: z.string().max(24).optional(),
    mediaUrl: z.string().max(1000).optional(),
    targetLocations: z.array(z.string().min(1).max(80)).max(20).optional(),
    ageMin: z.coerce.number().int().min(18).max(65).optional(),
    ageMax: z.coerce.number().int().min(18).max(65).optional(),
    startDateIso: z.string().optional(),
    allowDraftWhenDisconnected: z.boolean().default(true),
  }),
  summarize: (input) =>
    `Created ${input.channel} campaign '${input.name}' (${formatInr(rupeesToPaise(input.dailyBudgetRupees))}/day, ${input.billingMode})`,
  handler: async (ctx, input) => {
    const now = Date.now();
    const campaignId = newId();
    const startTs = input.startDateIso ? new Date(input.startDateIso).getTime() || now : now;
    const dailyBudgetPaise = rupeesToPaise(input.dailyBudgetRupees);

    const cleanWaDigits = (input.whatsappPhoneE164 || "").replace(/[^0-9]/g, "");
    const resolvedFinalUrl =
      input.destinationUrl?.trim() ||
      (cleanWaDigits ? `https://wa.me/${cleanWaDigits}` : "https://rapidshiftlabs.in");

    const metaSpec = mapObjectiveToMetaApi(input.objective);
    const ctaType = input.callToAction?.trim() || metaSpec.defaultCta;

    const vaultAllocatedPaise =
      input.billingMode === "rsl_managed_vault"
        ? rupeesToPaise(
            input.vaultAllocationRupees && input.vaultAllocationRupees > 0
              ? input.vaultAllocationRupees
              : Math.max(input.dailyBudgetRupees, 500)
          )
        : 0;

    if (input.billingMode === "rsl_managed_vault") {
      if (dailyBudgetPaise <= 0) {
        throw new RslError("RSL-VAL-1001", "Daily budget must be greater than ₹0 for Managed Vault campaigns.");
      }
      if (vaultAllocatedPaise < dailyBudgetPaise) {
        throw new RslError(
          "RSL-VAL-1001",
          `Managed Vault allocation (${formatInr(vaultAllocatedPaise)}) must cover at least 1 day's budget (${formatInr(dailyBudgetPaise)}).`
        );
      }
      allocateAdSpendToCampaign({
        workspaceId: ctx.workspaceId,
        amountPaise: vaultAllocatedPaise,
        provider: "meta_ads",
        campaignId,
        campaignName: input.name.trim(),
        idempotencyKey: `meta_alloc:${campaignId}`,
        actorId: ctx.actorId,
      });
    }

    const rollbackVaultIfAllocated = () => {
      if (input.billingMode === "rsl_managed_vault" && vaultAllocatedPaise > 0) {
        releaseUnusedCampaignAdSpend({
          workspaceId: ctx.workspaceId,
          unspentAmountPaise: vaultAllocatedPaise,
          provider: "meta_ads",
          campaignId,
          campaignName: input.name.trim(),
          idempotencyKey: `meta_rollback:${campaignId}`,
          actorId: ctx.actorId,
        });
      }
    };

    const creds = resolveWorkspaceMetaAdsCredentials({
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
            channel: input.channel,
            objective: input.objective,
            billingMode: input.billingMode,
            status: "active",
            dailyBudgetPaise,
            lifetimeBudgetPaise: 0,
            vaultAllocatedPaise: 0,
            totalSpendPaise: 0,
            attributedRevenuePaise: 0,
            impressions: 0,
            clicks: 0,
            conversions: 0,
            headline: input.headline?.trim() || input.name.trim(),
            primaryText: input.primaryText?.trim() || null,
            callToAction: ctaType,
            destinationUrl: resolvedFinalUrl,
            whatsappPhoneE164: input.whatsappPhoneE164?.trim() || null,
            mediaUrl: input.mediaUrl?.trim() || null,
            targetLocationsJson: JSON.stringify(input.targetLocations ?? ["India"]),
            ageMin: input.ageMin ?? 18,
            ageMax: input.ageMax ?? 55,
            syncStatus: "local_draft",
            lastSyncMessage:
              creds.error || "Saved locally — connect Meta Ads on Connected Channels to push live.",
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
        creds.error || "Meta Ad Account is not connected yet."
      );
    }

    const adAccountId = creds.adAccountId!;
    const v = creds.graphVersion || "v21.0";
    let externalCampaignId = "";
    let externalAdsetId: string | null = null;
    let externalCreativeId: string | null = null;
    let externalAdId: string | null = null;
    let syncStatus: "live_synced" | "sandbox_simulated" = "live_synced";
    let lastSyncMessage = "";

    if (creds.mode === "sandbox") {
      syncStatus = "sandbox_simulated";
      externalCampaignId = `meta_camp_sb_${Date.now()}`;
      externalAdsetId = `meta_adset_sb_${Date.now()}`;
      externalCreativeId = `meta_creative_sb_${Date.now()}`;
      externalAdId = `meta_ad_sb_${Date.now()}`;
      lastSyncMessage = `Sandbox Meta Ads campaign provisioned on ${adAccountId}.`;
    } else {
      const headers = {
        Authorization: `Bearer ${creds.accessToken!}`,
        "Content-Type": "application/json",
      };

      const campDisplayName =
        input.billingMode === "rsl_managed_vault"
          ? `${input.name.trim()} [RSL-${ctx.workspaceId.slice(0, 8)}]`
          : input.name.trim();

      try {
        // 1. Create Meta Campaign (with hard spend_cap in paise when using Managed Vault!)
        const campPayload: Record<string, unknown> = {
          name: campDisplayName,
          objective: metaSpec.campaignObjective,
          status: "ACTIVE",
          special_ad_categories: [],
        };
        if (vaultAllocatedPaise > 0) {
          campPayload.spend_cap = String(vaultAllocatedPaise);
        }

        const campResp = await fetch(
          `https://graph.facebook.com/${v}/${adAccountId}/campaigns`,
          {
            method: "POST",
            headers,
            body: JSON.stringify(campPayload),
            signal: AbortSignal.timeout(12_000),
          }
        );
        const campBody = (await campResp.json().catch(() => ({}))) as {
          id?: string;
          error?: { message?: string; error_user_msg?: string };
        };
        if (!campResp.ok || !campBody.id) {
          rollbackVaultIfAllocated();
          throw new RslError(
            "RSL-VAL-1001",
            `Meta Marketing API rejected campaign creation (HTTP ${campResp.status}): ${campBody.error?.error_user_msg || campBody.error?.message || "Verify Ad Account payment method & permissions."}`
          );
        }
        externalCampaignId = campBody.id;

        // 2. Create Meta Ad Set (INR paise daily_budget + geo/age/platform targeting)
        const publisherPlatforms =
          input.channel === "instagram"
            ? ["instagram"]
            : input.channel === "facebook"
              ? ["facebook"]
              : ["facebook", "instagram"];

        const targeting: Record<string, unknown> = {
          geo_locations: { countries: ["IN"] },
          age_min: input.ageMin ?? 18,
          age_max: Math.max(input.ageMin ?? 18, input.ageMax ?? 55),
          publisher_platforms: publisherPlatforms,
        };

        const adsetPayload: Record<string, unknown> = {
          name: `${input.name.trim()} — Ad Set`,
          campaign_id: externalCampaignId,
          daily_budget: String(Math.max(10_000, dailyBudgetPaise)), // Min ₹100/day in Meta INR minor units
          billing_event: "IMPRESSIONS",
          optimization_goal:
            metaSpec.optimizationGoal === "CONVERSATIONS" && !creds.pageId
              ? "LINK_CLICKS"
              : metaSpec.optimizationGoal === "CONVERSATIONS"
                ? "LINK_CLICKS"
                : metaSpec.optimizationGoal,
          bid_strategy: "LOWEST_COST_WITHOUT_CAP",
          targeting,
          status: "ACTIVE",
        };
        if (creds.pageId) {
          adsetPayload.promoted_object = { page_id: creds.pageId };
        }

        const adsetResp = await fetch(
          `https://graph.facebook.com/${v}/${adAccountId}/adsets`,
          {
            method: "POST",
            headers,
            body: JSON.stringify(adsetPayload),
            signal: AbortSignal.timeout(12_000),
          }
        );
        const adsetBody = (await adsetResp.json().catch(() => ({}))) as {
          id?: string;
          error?: { message?: string; error_user_msg?: string };
        };
        if (!adsetResp.ok || !adsetBody.id) {
          // Pause orphan campaign & refund vault allocation cleanly
          await fetch(`https://graph.facebook.com/${v}/${externalCampaignId}`, {
            method: "POST",
            headers,
            body: JSON.stringify({ status: "PAUSED" }),
            signal: AbortSignal.timeout(6000),
          }).catch(() => undefined);
          rollbackVaultIfAllocated();
          throw new RslError(
            "RSL-VAL-1001",
            `Meta Marketing API rejected Ad Set creation (HTTP ${adsetResp.status}): ${adsetBody.error?.error_user_msg || adsetBody.error?.message || "Verify daily budget & Page connection."}`
          );
        }
        externalAdsetId = adsetBody.id;

        // 3. Create Ad Creative & Ad when a Facebook Page ID is linked
        if (creds.pageId) {
          const linkData: Record<string, unknown> = {
            message:
              input.primaryText?.trim() ||
              `${input.name.trim()} — Tap below to connect with us directly.`,
            link: resolvedFinalUrl,
            name: input.headline?.trim() || input.name.trim(),
            call_to_action: {
              type: ctaType,
              value: { link: resolvedFinalUrl },
            },
          };
          if (input.mediaUrl?.trim()) {
            linkData.picture = input.mediaUrl.trim();
          }

          const objectStorySpec: Record<string, unknown> = {
            page_id: creds.pageId,
            link_data: linkData,
          };
          if (creds.igUserId) {
            objectStorySpec.instagram_actor_id = creds.igUserId;
          }

          const creativeResp = await fetch(
            `https://graph.facebook.com/${v}/${adAccountId}/adcreatives`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                name: `${input.name.trim()} — Creative`,
                object_story_spec: objectStorySpec,
              }),
              signal: AbortSignal.timeout(12_000),
            }
          );
          const creativeBody = (await creativeResp.json().catch(() => ({}))) as {
            id?: string;
            error?: { message?: string };
          };

          if (creativeResp.ok && creativeBody.id) {
            externalCreativeId = creativeBody.id;
            const adResp = await fetch(
              `https://graph.facebook.com/${v}/${adAccountId}/ads`,
              {
                method: "POST",
                headers,
                body: JSON.stringify({
                  name: `${input.name.trim()} — Live Ad`,
                  adset_id: externalAdsetId,
                  creative: { creative_id: externalCreativeId },
                  status: "ACTIVE",
                }),
                signal: AbortSignal.timeout(12_000),
              }
            );
            const adBody = (await adResp.json().catch(() => ({}))) as { id?: string };
            if (adResp.ok && adBody.id) {
              externalAdId = adBody.id;
            }
          }
        }

        lastSyncMessage = externalAdId
          ? `Live on Meta Ads (${adAccountId}) • Campaign + Ad Set + Creative active`
          : `Campaign & Ad Set live on ${adAccountId} (link a Facebook Page to attach ad creative)`;
      } catch (err) {
        if (err instanceof RslError) throw err;
        rollbackVaultIfAllocated();
        throw new RslError(
          "RSL-VAL-1001",
          `Network error reaching Meta Marketing API: ${err instanceof Error ? err.message : "timeout"}. Any reserved Managed Vault funds were refunded.`
        );
      }
    }

    tenantDataDb(ctx)
      .insert(tenantDataSchema.campaigns)
      .values({
        id: campaignId,
        name: input.name.trim(),
        channel: input.channel,
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
        externalAccountId: adAccountId,
        externalCampaignId,
        externalAdsetId,
        externalCreativeId,
        externalAdId,
        headline: input.headline?.trim() || input.name.trim(),
        primaryText: input.primaryText?.trim() || null,
        callToAction: ctaType,
        destinationUrl: resolvedFinalUrl,
        whatsappPhoneE164: input.whatsappPhoneE164?.trim() || null,
        mediaUrl: input.mediaUrl?.trim() || null,
        targetLocationsJson: JSON.stringify(input.targetLocations ?? ["India"]),
        ageMin: input.ageMin ?? 18,
        ageMax: input.ageMax ?? 55,
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

export const toggleCampaignStatus = defineAction({
  key: "campaigns.status.updated",
  permission: "ads:pause",
  input: z.object({
    campaignId: z.string().min(8),
    status: z.enum(["active", "paused", "completed"]),
  }),
  summarize: (input) => `Changed campaign status to '${input.status}'`,
  handler: async (ctx, input) => {
    const db = tenantDataDb(ctx);
    const camp = db
      .select()
      .from(tenantDataSchema.campaigns)
      .where(eq(tenantDataSchema.campaigns.id, input.campaignId))
      .get();

    if (!camp) {
      throw new RslError("RSL-VAL-1001", "Campaign not found.");
    }

    if (camp.channel === "google_ads") {
      return mutateGoogleAdCampaignStatusInternal({
        workspaceId: ctx.workspaceId,
        actorId: ctx.actorId,
        campaignId: camp.id,
        status: input.status,
      });
    }

    let syncMessage = camp.lastSyncMessage || "";

    if (camp.externalCampaignId && camp.syncStatus === "live_synced") {
      const creds = resolveWorkspaceMetaAdsCredentials({
        workspaceId: ctx.workspaceId,
        billingMode:
          camp.billingMode === "rsl_managed_vault" ? "rsl_managed_vault" : "direct_client",
      });

      if (creds.ok && creds.mode === "live" && creds.accessToken) {
        const metaStatus = input.status === "active" ? "ACTIVE" : "PAUSED";
        const resp = await fetch(
          `https://graph.facebook.com/${creds.graphVersion}/${camp.externalCampaignId}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${creds.accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ status: metaStatus }),
            signal: AbortSignal.timeout(10_000),
          }
        );

        if (!resp.ok) {
          const errBody = (await resp.json().catch(() => ({}))) as {
            error?: { message?: string };
          };
          throw new RslError(
            "RSL-VAL-1001",
            `Meta Marketing API rejected status update (HTTP ${resp.status}): ${errBody.error?.message || "Unknown error"}`
          );
        }
        syncMessage = `Meta Ads status set to ${metaStatus} (${new Date().toLocaleTimeString("en-IN")})`;
      }
    }

    let releasedPaise = 0;
    let nextVaultAllocated = camp.vaultAllocatedPaise;

    if (
      input.status === "completed" &&
      camp.billingMode === "rsl_managed_vault" &&
      camp.vaultAllocatedPaise > camp.totalSpendPaise
    ) {
      releasedPaise = camp.vaultAllocatedPaise - camp.totalSpendPaise;
      releaseUnusedCampaignAdSpend({
        workspaceId: ctx.workspaceId,
        unspentAmountPaise: releasedPaise,
        provider: "meta_ads",
        campaignId: camp.id,
        campaignName: camp.name,
        idempotencyKey: `meta_complete_release:${camp.id}`,
        actorId: ctx.actorId,
      });
      nextVaultAllocated = camp.totalSpendPaise;
      syncMessage = `Campaign completed; refunded ${formatInr(releasedPaise, { showDecimals: true })} unspent funds to Ad Spend Vault.`;
    }

    const now = Date.now();
    db.update(tenantDataSchema.campaigns)
      .set({
        status: input.status,
        vaultAllocatedPaise: nextVaultAllocated,
        endDate: input.status === "completed" ? now : camp.endDate,
        lastSyncMessage: syncMessage || camp.lastSyncMessage,
        lastSyncedAt: now,
        updatedAt: now,
      })
      .where(eq(tenantDataSchema.campaigns.id, camp.id))
      .run();

    return { updated: true, releasedPaise };
  },
});

export const updateCampaignBudget = defineAction({
  key: "campaigns.budget.updated",
  permission: "ads:create",
  input: z.object({
    campaignId: z.string().min(8),
    dailyBudgetRupees: z.coerce.number().min(50),
    additionalVaultAllocationRupees: z.coerce.number().min(0).optional(),
  }),
  summarize: (input) =>
    `Updated campaign daily budget to ${formatInr(rupeesToPaise(input.dailyBudgetRupees))}/day`,
  handler: async (ctx, input) => {
    const db = tenantDataDb(ctx);
    const camp = db
      .select()
      .from(tenantDataSchema.campaigns)
      .where(eq(tenantDataSchema.campaigns.id, input.campaignId))
      .get();

    if (!camp) {
      throw new RslError("RSL-VAL-1001", "Campaign not found.");
    }

    if (camp.channel === "google_ads") {
      return updateGoogleAdCampaignBudgetInternal({
        workspaceId: ctx.workspaceId,
        actorId: ctx.actorId,
        campaignId: camp.id,
        dailyBudgetRupees: input.dailyBudgetRupees,
        additionalVaultAllocationRupees: input.additionalVaultAllocationRupees,
      });
    }

    const dailyBudgetPaise = rupeesToPaise(input.dailyBudgetRupees);
    const extraVaultPaise =
      camp.billingMode === "rsl_managed_vault" &&
      input.additionalVaultAllocationRupees &&
      input.additionalVaultAllocationRupees > 0
        ? rupeesToPaise(input.additionalVaultAllocationRupees)
        : 0;

    if (extraVaultPaise > 0) {
      allocateAdSpendToCampaign({
        workspaceId: ctx.workspaceId,
        amountPaise: extraVaultPaise,
        provider: "meta_ads",
        campaignId: camp.id,
        campaignName: camp.name,
        externalCampaignId: camp.externalCampaignId ?? undefined,
        idempotencyKey: `meta_topup_alloc:${camp.id}:${Date.now()}`,
        actorId: ctx.actorId,
      });
    }

    const nextVaultAllocated = camp.vaultAllocatedPaise + extraVaultPaise;

    if (camp.syncStatus === "live_synced") {
      const creds = resolveWorkspaceMetaAdsCredentials({
        workspaceId: ctx.workspaceId,
        billingMode:
          camp.billingMode === "rsl_managed_vault" ? "rsl_managed_vault" : "direct_client",
      });

      if (creds.ok && creds.mode === "live" && creds.accessToken) {
        const headers = {
          Authorization: `Bearer ${creds.accessToken}`,
          "Content-Type": "application/json",
        };
        if (camp.externalAdsetId) {
          const adsetResp = await fetch(
            `https://graph.facebook.com/${creds.graphVersion}/${camp.externalAdsetId}`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({ daily_budget: String(Math.max(10_000, dailyBudgetPaise)) }),
              signal: AbortSignal.timeout(10_000),
            }
          );
          if (!adsetResp.ok) {
            const errBody = (await adsetResp.json().catch(() => ({}))) as {
              error?: { message?: string };
            };
            throw new RslError(
              "RSL-VAL-1001",
              `Meta Marketing API rejected budget update (HTTP ${adsetResp.status}): ${errBody.error?.message || "Unknown error"}`
            );
          }
        }
        if (camp.externalCampaignId && extraVaultPaise > 0) {
          await fetch(
            `https://graph.facebook.com/${creds.graphVersion}/${camp.externalCampaignId}`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({ spend_cap: String(nextVaultAllocated) }),
              signal: AbortSignal.timeout(8000),
            }
          ).catch(() => undefined);
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
            ? camp.externalCampaignId?.includes("_sb_")
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
  },
});

export const recordCampaignDailySnapshot = defineAction({
  key: "campaigns.snapshot.recorded",
  permission: "ads:create",
  input: z.object({
    campaignId: z.string().min(8),
    dayKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    spendRupees: z.coerce.number().min(0),
    revenueRupees: z.coerce.number().min(0).default(0),
    impressions: z.coerce.number().int().min(0),
    clicks: z.coerce.number().int().min(0),
    conversions: z.coerce.number().int().min(0).default(0),
  }),
  summarize: (input) => `Synced campaign metrics for ${input.dayKey}`,
  handler: (ctx, input) => {
    const db = tenantDataDb(ctx);
    const camp = db
      .select()
      .from(tenantDataSchema.campaigns)
      .where(eq(tenantDataSchema.campaigns.id, input.campaignId))
      .get();
    if (!camp) {
      throw new RslError("RSL-VAL-1001", "Campaign not found.");
    }

    const spendPaise = rupeesToPaise(input.spendRupees);
    const revenuePaise = rupeesToPaise(input.revenueRupees);

    db.insert(tenantDataSchema.insightSnapshots)
      .values({
        id: newId(),
        campaignId: camp.id,
        dayKey: input.dayKey,
        spendPaise,
        revenuePaise,
        impressions: input.impressions,
        clicks: input.clicks,
        leadsCount: input.conversions,
        salesCount: input.conversions,
        createdAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: [tenantDataSchema.insightSnapshots.campaignId, tenantDataSchema.insightSnapshots.dayKey],
        set: {
          spendPaise,
          revenuePaise,
          impressions: input.impressions,
          clicks: input.clicks,
          leadsCount: input.conversions,
          salesCount: input.conversions,
        },
      })
      .run();

    const allSnaps = db
      .select()
      .from(tenantDataSchema.insightSnapshots)
      .where(eq(tenantDataSchema.insightSnapshots.campaignId, camp.id))
      .all();

    const totals = allSnaps.reduce(
      (acc, s) => ({
        spend: acc.spend + s.spendPaise,
        rev: acc.rev + s.revenuePaise,
        imp: acc.imp + s.impressions,
        clk: acc.clk + s.clicks,
        conv: acc.conv + s.salesCount,
      }),
      { spend: 0, rev: 0, imp: 0, clk: 0, conv: 0 }
    );

    const capReached =
      camp.billingMode === "rsl_managed_vault" &&
      camp.vaultAllocatedPaise > 0 &&
      totals.spend >= camp.vaultAllocatedPaise;

    db.update(tenantDataSchema.campaigns)
      .set({
        totalSpendPaise: totals.spend,
        attributedRevenuePaise: totals.rev,
        impressions: totals.imp,
        clicks: totals.clk,
        conversions: totals.conv,
        status: capReached && camp.status === "active" ? "paused" : camp.status,
        syncStatus: capReached ? "vault_cap_reached" : camp.syncStatus,
        lastSyncMessage: capReached
          ? `Auto-paused at 100% of ${formatInr(camp.vaultAllocatedPaise)} Managed Ad Spend Vault cap.`
          : camp.lastSyncMessage,
        updatedAt: Date.now(),
      })
      .where(eq(tenantDataSchema.campaigns.id, camp.id))
      .run();

    return { updated: true, capReached };
  },
});

export async function syncMetaAdCampaignsInsightsForWorkspace(workspaceId: string): Promise<{
  syncedCampaigns: number;
  autoPausedVaultCampaigns: number;
}> {
  const db = tenantDataDb({ workspaceId });
  const metaCampaigns = db
    .select()
    .from(tenantDataSchema.campaigns)
    .where(ne(tenantDataSchema.campaigns.channel, "google_ads"))
    .all();

  if (metaCampaigns.length === 0) {
    return { syncedCampaigns: 0, autoPausedVaultCampaigns: 0 };
  }

  let syncedCampaigns = 0;
  let autoPausedVaultCampaigns = 0;

  const modesPresent = new Set<"direct_client" | "rsl_managed_vault">();
  for (const c of metaCampaigns) {
    if (c.externalCampaignId && c.syncStatus !== "local_draft") {
      modesPresent.add(
        c.billingMode === "rsl_managed_vault" ? "rsl_managed_vault" : "direct_client"
      );
    }
  }

  for (const mode of modesPresent) {
    const creds = resolveWorkspaceMetaAdsCredentials({
      workspaceId,
      billingMode: mode,
    });
    if (!creds.ok || creds.mode !== "live" || !creds.adAccountId || !creds.accessToken) {
      continue;
    }

    try {
      const url = new URL(
        `https://graph.facebook.com/${creds.graphVersion}/${creds.adAccountId}/insights`
      );
      url.searchParams.set("level", "campaign");
      url.searchParams.set("time_increment", "1");
      url.searchParams.set("date_preset", "last_30d");
      url.searchParams.set("limit", "250");
      url.searchParams.set(
        "fields",
        "campaign_id,campaign_name,date_start,spend,impressions,clicks,actions,action_values"
      );

      const resp = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${creds.accessToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) continue;

      const body = (await resp.json().catch(() => ({}))) as {
        data?: Array<{
          campaign_id?: string;
          date_start?: string;
          spend?: string;
          impressions?: string;
          clicks?: string;
          actions?: Array<{ action_type?: string; value?: string }>;
          action_values?: Array<{ action_type?: string; value?: string }>;
        }>;
      };

      const byExtId = new Map<string, (typeof metaCampaigns)[number]>();
      for (const c of metaCampaigns) {
        if (c.externalCampaignId) byExtId.set(c.externalCampaignId, c);
      }

      const touchedCampaignIds = new Set<string>();

      for (const row of body.data ?? []) {
        const localCamp = row.campaign_id ? byExtId.get(row.campaign_id) : undefined;
        const dayKey = row.date_start;
        if (!localCamp || !dayKey || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) continue;

        const spendPaise = Math.max(0, Math.round(Number(row.spend || 0) * 100));
        const impressions = Math.max(0, Math.round(Number(row.impressions || 0)));
        const clicks = Math.max(0, Math.round(Number(row.clicks || 0)));

        const conversionActions = (row.actions ?? []).filter((a) =>
          /^(lead|purchase|onsite_conversion\.messaging_conversation_started_7d|offsite_conversion\.fb_pixel_purchase|offsite_conversion\.fb_pixel_lead)$/i.test(
            a.action_type || ""
          )
        );
        const conversions = conversionActions.reduce(
          (sum, a) => sum + Math.max(0, Math.round(Number(a.value || 0))),
          0
        );

        const purchaseValues = (row.action_values ?? []).filter((a) =>
          /purchase/i.test(a.action_type || "")
        );
        const revenuePaise = purchaseValues.reduce(
          (sum, a) => sum + Math.max(0, Math.round(Number(a.value || 0) * 100)),
          0
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
          .where(eq(tenantDataSchema.campaigns.id, campId))
          .get();
        if (!campRow) continue;

        const capReached =
          campRow.billingMode === "rsl_managed_vault" &&
          campRow.vaultAllocatedPaise > 0 &&
          totals.spend >= campRow.vaultAllocatedPaise &&
          campRow.status === "active";

        if (capReached && campRow.externalCampaignId) {
          await fetch(
            `https://graph.facebook.com/${creds.graphVersion}/${campRow.externalCampaignId}`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${creds.accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ status: "PAUSED" }),
              signal: AbortSignal.timeout(8000),
            }
          ).catch(() => undefined);
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
              : `Synced Meta Insights (${new Date(now).toLocaleString("en-IN")})`,
            lastSyncedAt: now,
            updatedAt: now,
          })
          .where(eq(tenantDataSchema.campaigns.id, campId))
          .run();

        syncedCampaigns++;
      }
    } catch {
      // Safe fallback
    }
  }

  return { syncedCampaigns, autoPausedVaultCampaigns };
}

export async function syncAllWorkspaceAdCampaignsInsights(workspaceId: string): Promise<{
  syncedCampaigns: number;
  autoPausedVaultCampaigns: number;
}> {
  const [metaRes, googleRes] = await Promise.all([
    syncMetaAdCampaignsInsightsForWorkspace(workspaceId),
    syncGoogleAdCampaignsInsightsForWorkspace(workspaceId),
  ]);
  return {
    syncedCampaigns: metaRes.syncedCampaigns + googleRes.syncedCampaigns,
    autoPausedVaultCampaigns:
      metaRes.autoPausedVaultCampaigns + googleRes.autoPausedVaultCampaigns,
  };
}

// ============================================================================
// Live Social Post Publishing (Facebook Pages, Instagram 2-Step Container, GBP)
// ============================================================================

export async function publishSocialPostExternal(params: {
  workspaceId: string;
  channel: "instagram_feed" | "instagram_reel" | "facebook_page" | "google_post";
  caption: string;
  mediaUrl?: string | null;
  mediaType?: "image" | "video" | "none" | string | null;
  ctaUrl?: string | null;
  ctaType?: string | null;
}): Promise<{
  ok: boolean;
  mode: "live" | "sandbox" | "disconnected";
  externalPostId?: string;
  externalPermalink?: string;
  error?: string;
}> {
  if (params.channel === "google_post") {
    return publishGoogleBusinessLocalPost({
      workspaceId: params.workspaceId,
      summary: params.caption,
      mediaUrl: params.mediaUrl || undefined,
      ctaUrl: params.ctaUrl || undefined,
      ctaType: (params.ctaType as "LEARN_MORE" | undefined) || "LEARN_MORE",
    });
  }

  if (params.channel === "facebook_page") {
    const creds = resolveWorkspaceChannelCredentials({
      workspaceId: params.workspaceId,
      channelKind: "facebook_page",
    });
    if (!creds.ok || !creds.accessToken) {
      return {
        ok: false,
        mode: "disconnected",
        error: "Connect your Facebook Page on Connected Channels first.",
      };
    }

    const pageId = creds.metadata?.pageId || creds.externalAccountId || "page_sandbox";
    if (creds.mode === "sandbox") {
      return {
        ok: true,
        mode: "sandbox",
        externalPostId: `${pageId}_sb_${Date.now()}`,
        externalPermalink: `https://www.facebook.com/${pageId}`,
      };
    }

    const v = creds.graphVersion;
    const isPhoto = Boolean(params.mediaUrl?.trim()) && params.mediaType !== "video";
    const endpoint = isPhoto
      ? `https://graph.facebook.com/${v}/${pageId}/photos`
      : `https://graph.facebook.com/${v}/${pageId}/feed`;

    const payload: Record<string, unknown> = isPhoto
      ? {
          url: params.mediaUrl!.trim(),
          message: params.caption.trim(),
          published: true,
        }
      : {
          message: params.caption.trim(),
          ...(params.ctaUrl?.trim() ? { link: params.ctaUrl.trim() } : {}),
        };

    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12_000),
      });
      const body = (await resp.json().catch(() => ({}))) as {
        id?: string;
        post_id?: string;
        error?: { message?: string };
      };
      if (!resp.ok || (!body.id && !body.post_id)) {
        return {
          ok: false,
          mode: "live",
          error: `Facebook Page API rejected post (HTTP ${resp.status}): ${body.error?.message || "Verify pages_manage_posts scope."}`,
        };
      }
      const postId = body.post_id || body.id!;
      return {
        ok: true,
        mode: "live",
        externalPostId: postId,
        externalPermalink: `https://www.facebook.com/${postId}`,
      };
    } catch (err) {
      return {
        ok: false,
        mode: "live",
        error: err instanceof Error ? err.message : "Network error reaching Facebook Graph API.",
      };
    }
  }

  // Instagram Feed & Instagram Reels (2-step container creation -> media_publish)
  const creds = resolveWorkspaceChannelCredentials({
    workspaceId: params.workspaceId,
    channelKind: "instagram_business",
  });
  if (!creds.ok || !creds.accessToken) {
    return {
      ok: false,
      mode: "disconnected",
      error: "Connect your Instagram Business Account on Connected Channels first.",
    };
  }

  const igUserId = creds.metadata?.igUserId || creds.externalAccountId || "ig_sandbox";
  if (creds.mode === "sandbox") {
    return {
      ok: true,
      mode: "sandbox",
      externalPostId: `ig_media_sb_${Date.now()}`,
      externalPermalink: "https://www.instagram.com/",
    };
  }

  if (!params.mediaUrl?.trim()) {
    return {
      ok: false,
      mode: "live",
      error:
        params.channel === "instagram_reel"
          ? "Instagram Reels require a public MP4 video URL or uploaded video file."
          : "Instagram Feed posts require an image URL or uploaded image file.",
    };
  }

  const v = creds.graphVersion;
  const headers = {
    Authorization: `Bearer ${creds.accessToken}`,
    "Content-Type": "application/json",
  };

  try {
    const containerPayload: Record<string, unknown> =
      params.channel === "instagram_reel" || params.mediaType === "video"
        ? {
            media_type: "REELS",
            video_url: params.mediaUrl.trim(),
            caption: params.caption.trim(),
          }
        : {
            image_url: params.mediaUrl.trim(),
            caption: params.caption.trim(),
          };

    const containerResp = await fetch(
      `https://graph.facebook.com/${v}/${igUserId}/media`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(containerPayload),
        signal: AbortSignal.timeout(15_000),
      }
    );
    const containerBody = (await containerResp.json().catch(() => ({}))) as {
      id?: string;
      error?: { message?: string };
    };
    if (!containerResp.ok || !containerBody.id) {
      return {
        ok: false,
        mode: "live",
        error: `Instagram Container API rejected media (HTTP ${containerResp.status}): ${containerBody.error?.message || "Ensure image/video URL is publicly reachable."}`,
      };
    }

    const publishResp = await fetch(
      `https://graph.facebook.com/${v}/${igUserId}/media_publish`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ creation_id: containerBody.id }),
        signal: AbortSignal.timeout(15_000),
      }
    );
    const publishBody = (await publishResp.json().catch(() => ({}))) as {
      id?: string;
      error?: { message?: string };
    };
    if (!publishResp.ok || !publishBody.id) {
      return {
        ok: false,
        mode: "live",
        error: `Instagram Publish API rejected container (HTTP ${publishResp.status}): ${publishBody.error?.message || "Media container may still be processing."}`,
      };
    }

    return {
      ok: true,
      mode: "live",
      externalPostId: publishBody.id,
      externalPermalink: `https://www.instagram.com/`,
    };
  } catch (err) {
    return {
      ok: false,
      mode: "live",
      error: err instanceof Error ? err.message : "Network error reaching Instagram Graph API.",
    };
  }
}

export const scheduleSocialPost = defineAction({
  key: "posts.scheduled",
  permission: "posts:schedule",
  input: z.object({
    channel: z.enum(["instagram_feed", "instagram_reel", "facebook_page", "google_post"]),
    caption: z.string().min(2).max(2200),
    scheduledForIso: z.string(),
    publishNow: z.boolean().default(false),
    mediaUrl: z.string().max(1000).optional(),
    mediaType: z.enum(["none", "image", "video"]).default("none"),
    ctaUrl: z.string().max(500).optional(),
    ctaType: z.string().max(40).optional(),
    requireLiveConnection: z.boolean().default(false),
  }),
  summarize: (input) => `${input.publishNow ? "Published" : "Scheduled"} ${input.channel} post`,
  handler: async (ctx, input) => {
    const now = Date.now();
    const scheduledTs = input.publishNow ? now : new Date(input.scheduledForIso).getTime() || now;
    const id = newId();
    const db = tenantDataDb(ctx);

    let status: "scheduled" | "published" | "failed" = input.publishNow ? "published" : "scheduled";
    let publishedAt: number | null = input.publishNow ? now : null;
    let externalPostId: string | null = null;
    let externalPermalink: string | null = null;
    let lastError: string | null = null;

    if (input.publishNow) {
      const pubRes = await publishSocialPostExternal({
        workspaceId: ctx.workspaceId,
        channel: input.channel,
        caption: input.caption,
        mediaUrl: input.mediaUrl,
        mediaType: input.mediaType,
        ctaUrl: input.ctaUrl,
        ctaType: input.ctaType,
      });

      if (pubRes.ok) {
        externalPostId = pubRes.externalPostId ?? null;
        externalPermalink = pubRes.externalPermalink ?? null;
      } else if (pubRes.mode === "disconnected" && !input.requireLiveConnection) {
        status = "published";
        lastError = pubRes.error || null;
      } else {
        throw new RslError("RSL-VAL-1001", pubRes.error || "Failed to publish social post.");
      }
    }

    db.insert(tenantDataSchema.scheduledPosts)
      .values({
        id,
        channel: input.channel,
        caption: input.caption.trim(),
        mediaUrl: input.mediaUrl?.trim() || null,
        mediaType: input.mediaType,
        ctaUrl: input.ctaUrl?.trim() || null,
        ctaType: input.ctaType?.trim() || null,
        scheduledFor: scheduledTs,
        status,
        publishedAt,
        externalPostId,
        externalPermalink,
        lastError,
        reachCount: 0,
        engagementCount: 0,
        createdAt: now,
      })
      .run();

    return { postId: id, externalPostId, externalPermalink };
  },
});

export const publishScheduledPost = defineAction({
  key: "posts.published",
  permission: "posts:publish",
  input: z.object({
    postId: z.string().min(8),
    requireLiveConnection: z.boolean().default(false),
  }),
  summarize: () => "Published scheduled social post immediately",
  handler: async (ctx, input) => {
    const db = tenantDataDb(ctx);
    const existing = db
      .select()
      .from(tenantDataSchema.scheduledPosts)
      .where(eq(tenantDataSchema.scheduledPosts.id, input.postId))
      .get();
    if (!existing) {
      throw new RslError("RSL-VAL-1001", "Scheduled post not found.");
    }

    const ch = existing.channel as
      | "instagram_feed"
      | "instagram_reel"
      | "facebook_page"
      | "google_post";

    const pubRes = await publishSocialPostExternal({
      workspaceId: ctx.workspaceId,
      channel: ch,
      caption: existing.caption,
      mediaUrl: existing.mediaUrl,
      mediaType: existing.mediaType,
      ctaUrl: existing.ctaUrl,
      ctaType: existing.ctaType,
    });

    const now = Date.now();

    if (!pubRes.ok && (pubRes.mode !== "disconnected" || input.requireLiveConnection)) {
      db.update(tenantDataSchema.scheduledPosts)
        .set({
          status: "failed",
          lastError: pubRes.error || "Provider rejected post.",
        })
        .where(eq(tenantDataSchema.scheduledPosts.id, existing.id))
        .run();
      throw new RslError("RSL-VAL-1001", pubRes.error || "Provider rejected post.");
    }

    db.update(tenantDataSchema.scheduledPosts)
      .set({
        status: "published",
        publishedAt: now,
        externalPostId: pubRes.externalPostId ?? existing.externalPostId,
        externalPermalink: pubRes.externalPermalink ?? existing.externalPermalink,
        lastError: pubRes.ok ? null : pubRes.error || null,
      })
      .where(eq(tenantDataSchema.scheduledPosts.id, existing.id))
      .run();

    return {
      postId: existing.id,
      publishedAt: now,
      externalPostId: pubRes.externalPostId ?? null,
    };
  },
});

export const deleteScheduledPost = defineAction({
  key: "posts.deleted",
  permission: "posts:schedule",
  input: z.object({
    postId: z.string().min(8),
  }),
  summarize: () => "Removed social post from schedule",
  handler: (ctx, input) => {
    tenantDataDb(ctx)
      .delete(tenantDataSchema.scheduledPosts)
      .where(eq(tenantDataSchema.scheduledPosts.id, input.postId))
      .run();
    return { deleted: true };
  },
});

export function sweepDueScheduledPosts(workspaceId: string): number {
  const db = tenantDataDb({ workspaceId });
  const now = Date.now();
  const due = db
    .select()
    .from(tenantDataSchema.scheduledPosts)
    .where(
      and(
        eq(tenantDataSchema.scheduledPosts.status, "scheduled"),
        lte(tenantDataSchema.scheduledPosts.scheduledFor, now)
      )
    )
    .all();

  for (const post of due) {
    db.update(tenantDataSchema.scheduledPosts)
      .set({ status: "published", publishedAt: now })
      .where(eq(tenantDataSchema.scheduledPosts.id, post.id))
      .run();
  }
  return due.length;
}

export async function sweepDueScheduledPostsAsync(workspaceId: string): Promise<number> {
  const db = tenantDataDb({ workspaceId });
  const now = Date.now();
  const due = db
    .select()
    .from(tenantDataSchema.scheduledPosts)
    .where(
      and(
        eq(tenantDataSchema.scheduledPosts.status, "scheduled"),
        lte(tenantDataSchema.scheduledPosts.scheduledFor, now)
      )
    )
    .all();

  let publishedCount = 0;

  for (const post of due) {
    const ch = post.channel as
      | "instagram_feed"
      | "instagram_reel"
      | "facebook_page"
      | "google_post";

    const pubRes = await publishSocialPostExternal({
      workspaceId,
      channel: ch,
      caption: post.caption,
      mediaUrl: post.mediaUrl,
      mediaType: post.mediaType,
      ctaUrl: post.ctaUrl,
      ctaType: post.ctaType,
    });

    if (pubRes.ok || pubRes.mode === "disconnected") {
      db.update(tenantDataSchema.scheduledPosts)
        .set({
          status: "published",
          publishedAt: now,
          externalPostId: pubRes.externalPostId ?? null,
          externalPermalink: pubRes.externalPermalink ?? null,
          lastError: pubRes.ok ? null : pubRes.error || null,
        })
        .where(eq(tenantDataSchema.scheduledPosts.id, post.id))
        .run();
      publishedCount++;
    } else {
      db.update(tenantDataSchema.scheduledPosts)
        .set({
          status: "failed",
          lastError: pubRes.error || "Live channel API rejected scheduled post.",
        })
        .where(eq(tenantDataSchema.scheduledPosts.id, post.id))
        .run();
    }
  }

  return publishedCount;
}

// ============================================================================
// Live Meta Conversions API (CAPI) & Server-Side Pixel Ingestion
// ============================================================================

export async function ingestWebsitePixelEventForWorkspace(params: {
  workspaceId: string;
  eventId: string;
  eventName: "Purchase" | "Lead" | "AddToCart" | "ViewContent";
  valueRupees?: number;
  currency?: string;
  customerIdentifier?: string;
  customerEmail?: string;
  customerPhone?: string;
  sourceUrl?: string;
  orderRef?: string;
  clientIp?: string | null;
  userAgent?: string | null;
}): Promise<{
  deduplicated: boolean;
  id: string;
  capiStatus: string;
  capiResponseDetail: string | null;
}> {
  const db = tenantDataDb({ workspaceId: params.workspaceId });
  const cleanEventId = params.eventId.trim();
  const existing = db
    .select()
    .from(tenantDataSchema.pixelEvents)
    .where(eq(tenantDataSchema.pixelEvents.eventId, cleanEventId))
    .get();

  if (existing) {
    return {
      deduplicated: true,
      id: existing.id,
      capiStatus: existing.capiStatus,
      capiResponseDetail: existing.capiResponseDetail ?? null,
    };
  }

  const now = Date.now();
  const id = newId();
  const valuePaise = rupeesToPaise(params.valueRupees ?? 0);
  const currency = (params.currency || "INR").trim().toUpperCase().slice(0, 3) || "INR";

  const rawIdentifier =
    params.customerEmail?.trim() ||
    params.customerPhone?.trim() ||
    params.customerIdentifier?.trim() ||
    "";

  const resolvedEmail =
    params.customerEmail?.trim() ||
    (rawIdentifier.includes("@") ? rawIdentifier : "");
  const resolvedPhone =
    params.customerPhone?.trim() ||
    (!rawIdentifier.includes("@") && /\d{7,}/.test(rawIdentifier) ? rawIdentifier : "");

  const phoneDigits = resolvedPhone.replace(/[^0-9]/g, "");
  const normalizedPhoneDigits =
    phoneDigits.length === 10 ? `91${phoneDigits}` : phoneDigits;

  const hasCustomer = Boolean(resolvedEmail || normalizedPhoneDigits);
  const matchQualityScore =
    resolvedEmail && normalizedPhoneDigits ? 96 : hasCustomer ? 92 : 65;

  let capiStatus = "local_only";
  let capiResponseDetail: string | null = null;

  const pixelCreds = resolveWorkspaceChannelCredentials({
    workspaceId: params.workspaceId,
    channelKind: "meta_ads_pixel",
  });
  const pixelId = pixelCreds.metadata?.pixelId?.trim();

  if (pixelCreds.ok && pixelId && pixelCreds.accessToken) {
    if (pixelCreds.mode === "sandbox") {
      capiStatus = "sandbox_simulated";
      capiResponseDetail = `Simulated Meta CAPI dispatch to Pixel ${pixelId} (events_received: 1)`;
    } else {
      const userData: Record<string, unknown> = {};
      if (resolvedEmail) userData.em = [sha256Lower(resolvedEmail)];
      if (normalizedPhoneDigits) userData.ph = [sha256Lower(normalizedPhoneDigits)];
      if (params.clientIp) userData.client_ip_address = params.clientIp.split(",")[0]!.trim();
      if (params.userAgent) userData.client_user_agent = params.userAgent;
      if (!resolvedEmail && !normalizedPhoneDigits) {
        userData.external_id = [sha256Lower(`${params.workspaceId}:${cleanEventId}`)];
      }

      const capiEvent: Record<string, unknown> = {
        event_name: params.eventName,
        event_time: Math.floor(now / 1000),
        event_id: cleanEventId,
        action_source: "website",
        user_data: userData,
        custom_data: {
          currency,
          value: Number((valuePaise / 100).toFixed(2)),
          ...(params.orderRef?.trim() ? { order_id: params.orderRef.trim() } : {}),
        },
      };
      if (params.sourceUrl?.trim()) {
        capiEvent.event_source_url = params.sourceUrl.trim();
      }

      try {
        const resp = await fetch(
          `https://graph.facebook.com/${pixelCreds.graphVersion}/${pixelId}/events`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${pixelCreds.accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ data: [capiEvent] }),
            signal: AbortSignal.timeout(8000),
          }
        );
        const body = (await resp.json().catch(() => ({}))) as {
          events_received?: number;
          fbtrace_id?: string;
          error?: { message?: string };
        };
        if (resp.ok) {
          capiStatus = "sent_live";
          capiResponseDetail = `Meta CAPI Pixel ${pixelId}: events_received=${body.events_received ?? 1}${body.fbtrace_id ? ` (trace ${body.fbtrace_id})` : ""}`;
        } else {
          capiStatus = "failed";
          capiResponseDetail = `Meta CAPI HTTP ${resp.status}: ${body.error?.message || "Rejected by Meta Pixel"}`;
        }
      } catch (err) {
        capiStatus = "failed";
        capiResponseDetail =
          err instanceof Error ? err.message : "Network error sending Meta CAPI event.";
      }
    }
  }

  db.insert(tenantDataSchema.pixelEvents)
    .values({
      id,
      eventId: cleanEventId,
      eventName: params.eventName,
      valuePaise,
      currency,
      matchQualityScore,
      customerHash: hasCustomer ? hashPiiIdentifier(rawIdentifier) : null,
      sourceUrl: params.sourceUrl?.trim() || null,
      orderRef: params.orderRef?.trim() || null,
      capiStatus,
      capiResponseDetail,
      occurredAt: now,
    })
    .run();

  void dispatchWorkspaceWebhookEvent(params.workspaceId, "pixel.event.recorded", {
    id,
    eventId: cleanEventId,
    eventName: params.eventName,
    valuePaise,
    currency,
    capiStatus,
  }).catch(() => undefined);

  return {
    deduplicated: false,
    id,
    capiStatus,
    capiResponseDetail,
  };
}

export const recordWebsiteSalesEvent = defineAction({
  key: "pixel.event.recorded",
  permission: "pixel:manage",
  input: z.object({
    eventId: z.string().min(4).max(120),
    eventName: z.enum(["Purchase", "Lead", "AddToCart", "ViewContent"]),
    valueRupees: z.coerce.number().min(0).default(0),
    customerIdentifier: z.string().optional(),
    sourceUrl: z.string().max(500).optional(),
    orderRef: z.string().max(120).optional(),
  }),
  summarize: (input) => `Recorded website ${input.eventName} event (${input.eventId})`,
  handler: async (ctx, input) => {
    return ingestWebsitePixelEventForWorkspace({
      workspaceId: ctx.workspaceId,
      eventId: input.eventId,
      eventName: input.eventName,
      valueRupees: input.valueRupees,
      customerIdentifier: input.customerIdentifier,
      sourceUrl: input.sourceUrl,
      orderRef: input.orderRef,
    });
  },
});
