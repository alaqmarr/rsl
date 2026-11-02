import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { dispatchWorkspaceWebhookEvent } from "@rsl/api-keys";
import { canDebitWalletUsage, consumeUsage, getWalletBalancePaise } from "@rsl/billing";
import { newId, RslError } from "@rsl/core";
import { tenantDataSchema } from "@rsl/database";
import { defineAction } from "@rsl/logging";
import { tenantDataDb } from "@rsl/tenancy";

export function listGoogleReviews(workspaceId: string) {
  return tenantDataDb({ workspaceId })
    .select()
    .from(tenantDataSchema.reviews)
    .orderBy(desc(tenantDataSchema.reviews.reviewedAt))
    .limit(200)
    .all();
}

function buildSmartReplyDraftText(params: {
  reviewerName: string;
  locationName: string;
  rating: number;
  comment: string;
}): string {
  const firstName = params.reviewerName.trim().split(/\s+/)[0] || "Customer";
  const branch = params.locationName.trim() || "our store";
  const lower = params.comment.toLowerCase();

  const highlights: string[] = [];
  if (/(delivery|timely|fast|quick|on time)/.test(lower)) highlights.push("timely delivery");
  if (/(staff|team|service|polite|helpful|support)/.test(lower)) highlights.push("helpful service");
  if (/(quality|product|genuine|fresh|stock)/.test(lower)) highlights.push("product quality");
  if (/(price|pricing|rate|value|reasonable)/.test(lower)) highlights.push("fair pricing");

  if (params.rating >= 5) {
    const detail =
      highlights.length > 0
        ? ` We are especially glad you appreciated our ${highlights.slice(0, 2).join(" and ")}.`
        : "";
    return `Thank you so much for your 5-star review, ${firstName}!${detail} Everyone at ${branch} truly appreciates your support, and we look forward to serving you again soon.`;
  }

  if (params.rating === 4) {
    const detail =
      highlights.length > 0
        ? ` We are glad our ${highlights[0]} stood out during your visit.`
        : "";
    return `Thank you for your 4-star feedback, ${firstName}!${detail} We are always working to make every experience at ${branch} a full 5-star visit and hope to welcome you back soon.`;
  }

  if (params.rating === 3) {
    return `Thank you for sharing your honest feedback with ${branch}, ${firstName}. We want every customer experience to be smooth and reliable — please reach out to our team directly so we can understand what we could have done better for you.`;
  }

  return `Dear ${firstName}, thank you for bringing this to our attention, and please accept our sincere apologies that your experience with ${branch} fell short of expectations. Our manager would like to resolve this for you right away — please message or call our desk directly with your order or visit details so we can make things right.`;
}

export const recordGoogleReview = defineAction({
  key: "reviews.recorded",
  permission: "reviews:reply",
  input: z.object({
    locationName: z.string().min(2).max(120),
    reviewerName: z.string().min(1).max(120),
    rating: z.coerce.number().int().min(1).max(5),
    comment: z.string().min(1).max(2000),
  }),
  summarize: (input) => `Recorded ${input.rating}-star Google review for '${input.locationName}'`,
  handler: (ctx, input) => {
    const now = Date.now();
    const id = newId();
    tenantDataDb(ctx)
      .insert(tenantDataSchema.reviews)
      .values({
        id,
        externalReviewId: `gbp_${id}`,
        locationName: input.locationName.trim(),
        reviewerName: input.reviewerName.trim(),
        rating: input.rating,
        comment: input.comment.trim(),
        replyStatus: "unreplied",
        reviewedAt: now,
        createdAt: now,
      })
      .run();

    void dispatchWorkspaceWebhookEvent(ctx.workspaceId, "review.created", {
      reviewId: id,
      locationName: input.locationName.trim(),
      reviewerName: input.reviewerName.trim(),
      rating: input.rating,
      comment: input.comment.trim(),
    }).catch(() => 0);

    return { reviewId: id };
  },
});

export const generateSmartReviewDraft = defineAction({
  key: "reviews.draft_generated",
  permission: "reviews:reply",
  service: "google.autoreply",
  input: z.object({
    reviewId: z.string().min(10),
  }),
  summarize: () => "Prepared smart reply draft for Google Business review",
  handler: (ctx, input) => {
    const db = tenantDataDb(ctx);
    const review = db
      .select()
      .from(tenantDataSchema.reviews)
      .where(eq(tenantDataSchema.reviews.id, input.reviewId))
      .get();

    if (!review) {
      throw new RslError("RSL-VAL-1001", "Google review not found.");
    }
    if (review.replyStatus === "replied") {
      throw new RslError("RSL-VAL-1001", "This review already has a published owner reply.");
    }

    const unitCostPaise = 100; // ₹1.00 per smart draft
    const currentBalance = getWalletBalancePaise(ctx.workspaceId);
    if (!canDebitWalletUsage(currentBalance, unitCostPaise)) {
      throw new RslError(
        "RSL-BILL-1003",
        "Your prepaid wallet has reached the -₹200.00 overdraft limit. Recharge your wallet to prepare smart review reply drafts."
      );
    }

    consumeUsage({
      workspaceId: ctx.workspaceId,
      serviceKey: "google.autoreply",
      quantity: 1,
      unitCostPaise,
      dedupeKey: `review_draft:${review.id}:${Math.floor(Date.now() / 3000)}`,
      description: `Smart reply draft for ${review.reviewerName} (${review.rating}★)`,
      actorId: ctx.actorId,
    });

    const draftText = buildSmartReplyDraftText({
      reviewerName: review.reviewerName,
      locationName: review.locationName,
      rating: review.rating,
      comment: review.comment,
    });

    db.update(tenantDataSchema.reviews)
      .set({
        replyStatus: "draft_ready",
        publishedReplyText: draftText,
      })
      .where(eq(tenantDataSchema.reviews.id, review.id))
      .run();

    return { reviewId: review.id, draftText };
  },
});

export const replyToGoogleReview = defineAction({
  key: "reviews.replied",
  permission: "reviews:reply",
  input: z.object({
    reviewId: z.string().min(10),
    replyText: z.string().min(2).max(2000),
  }),
  summarize: () => "Published owner reply to Google Business review",
  handler: (ctx, input) => {
    tenantDataDb(ctx)
      .update(tenantDataSchema.reviews)
      .set({
        replyStatus: "replied",
        publishedReplyText: input.replyText.trim(),
        repliedAt: Date.now(),
      })
      .where(eq(tenantDataSchema.reviews.id, input.reviewId))
      .run();
    return { replied: true };
  },
});
