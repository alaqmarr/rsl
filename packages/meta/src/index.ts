import { and, desc, eq, lte } from "drizzle-orm";
import { z } from "zod";
import { formatInr, hashPiiIdentifier, newId, RslError, rupeesToPaise } from "@rsl/core";
import { tenantDataSchema } from "@rsl/database";
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

export const createAdCampaign = defineAction({
  key: "campaigns.created",
  permission: "ads:create",
  input: z.object({
    name: z.string().min(2).max(120),
    channel: z.enum(["meta_ads", "instagram", "facebook"]),
    objective: z.enum(["messages", "website_sales", "lead_generation", "awareness"]),
    dailyBudgetRupees: z.coerce.number().min(0),
    startDateIso: z.string(),
  }),
  summarize: (input) =>
    `Created campaign '${input.name}' with daily budget ${formatInr(rupeesToPaise(input.dailyBudgetRupees))}`,
  handler: (ctx, input) => {
    const now = Date.now();
    const id = newId();
    const startTs = new Date(input.startDateIso).getTime() || now;

    tenantDataDb(ctx)
      .insert(tenantDataSchema.campaigns)
      .values({
        id,
        name: input.name.trim(),
        channel: input.channel,
        objective: input.objective,
        status: "active",
        dailyBudgetPaise: rupeesToPaise(input.dailyBudgetRupees),
        totalSpendPaise: 0,
        attributedRevenuePaise: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        startDate: startTs,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return { campaignId: id };
  },
});

export const toggleCampaignStatus = defineAction({
  key: "campaigns.status.updated",
  permission: "ads:pause",
  input: z.object({
    campaignId: z.string().min(10),
    status: z.enum(["active", "paused", "completed"]),
  }),
  summarize: (input) => `Changed campaign status to '${input.status}'`,
  handler: (ctx, input) => {
    tenantDataDb(ctx)
      .update(tenantDataSchema.campaigns)
      .set({ status: input.status, updatedAt: Date.now() })
      .where(eq(tenantDataSchema.campaigns.id, input.campaignId))
      .run();
    return { updated: true };
  },
});

export const recordCampaignDailySnapshot = defineAction({
  key: "campaigns.snapshot.recorded",
  permission: "ads:create",
  input: z.object({
    campaignId: z.string().min(10),
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

    // Recompute totals from real snapshots
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

    db.update(tenantDataSchema.campaigns)
      .set({
        totalSpendPaise: totals.spend,
        attributedRevenuePaise: totals.rev,
        impressions: totals.imp,
        clicks: totals.clk,
        conversions: totals.conv,
        updatedAt: Date.now(),
      })
      .where(eq(tenantDataSchema.campaigns.id, camp.id))
      .run();

    return { updated: true };
  },
});

export const scheduleSocialPost = defineAction({
  key: "posts.scheduled",
  permission: "posts:schedule",
  input: z.object({
    channel: z.enum(["instagram_feed", "instagram_reel", "facebook_page", "google_post"]),
    caption: z.string().min(2).max(2200),
    scheduledForIso: z.string(),
    publishNow: z.boolean().default(false),
  }),
  summarize: (input) => `${input.publishNow ? "Published" : "Scheduled"} ${input.channel} post`,
  handler: (ctx, input) => {
    const now = Date.now();
    const scheduledTs = input.publishNow ? now : new Date(input.scheduledForIso).getTime() || now;
    const id = newId();

    tenantDataDb(ctx)
      .insert(tenantDataSchema.scheduledPosts)
      .values({
        id,
        channel: input.channel,
        caption: input.caption.trim(),
        scheduledFor: scheduledTs,
        status: input.publishNow ? "published" : "scheduled",
        publishedAt: input.publishNow ? now : null,
        reachCount: 0,
        engagementCount: 0,
        createdAt: now,
      })
      .run();

    return { postId: id };
  },
});

export const recordWebsiteSalesEvent = defineAction({
  key: "pixel.event.recorded",
  permission: "pixel:manage",
  input: z.object({
    eventId: z.string().min(4).max(120),
    eventName: z.enum(["Purchase", "Lead", "AddToCart", "ViewContent"]),
    valueRupees: z.coerce.number().min(0).default(0),
    customerIdentifier: z.string().optional(),
  }),
  summarize: (input) => `Recorded website ${input.eventName} event (${input.eventId})`,
  handler: (ctx, input) => {
    const db = tenantDataDb(ctx);
    const existing = db
      .select()
      .from(tenantDataSchema.pixelEvents)
      .where(eq(tenantDataSchema.pixelEvents.eventId, input.eventId.trim()))
      .get();

    if (existing) {
      return { deduplicated: true, id: existing.id };
    }

    const id = newId();
    const hasCustomer = Boolean(input.customerIdentifier?.trim());

    db.insert(tenantDataSchema.pixelEvents)
      .values({
        id,
        eventId: input.eventId.trim(),
        eventName: input.eventName,
        valuePaise: rupeesToPaise(input.valueRupees),
        currency: "INR",
        matchQualityScore: hasCustomer ? 92 : 65,
        customerHash: hasCustomer ? hashPiiIdentifier(input.customerIdentifier!) : null,
        occurredAt: Date.now(),
      })
      .run();

    return { deduplicated: false, id };
  },
});

export const publishScheduledPost = defineAction({
  key: "posts.published",
  permission: "posts:publish",
  input: z.object({
    postId: z.string().min(8),
  }),
  summarize: () => "Published scheduled social post immediately",
  handler: (ctx, input) => {
    const db = tenantDataDb(ctx);
    const existing = db
      .select()
      .from(tenantDataSchema.scheduledPosts)
      .where(eq(tenantDataSchema.scheduledPosts.id, input.postId))
      .get();
    if (!existing) {
      throw new RslError("RSL-VAL-1001", "Scheduled post not found.");
    }

    const now = Date.now();
    db.update(tenantDataSchema.scheduledPosts)
      .set({
        status: "published",
        publishedAt: now,
      })
      .where(eq(tenantDataSchema.scheduledPosts.id, existing.id))
      .run();

    return { postId: existing.id, publishedAt: now };
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
