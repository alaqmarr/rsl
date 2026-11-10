import { desc } from "drizzle-orm";
import { assertValidUlid, escapeCsvCellSafe, formatInr } from "@rsl/core";
import { controlSchema, platformLogsSchema } from "@rsl/database";
import { controlDb, ingressDb, platformLogsDb, tenantDataDb, tenantLogsDb } from "@rsl/tenancy";

export type AnalyticsDateRange = "7d" | "30d" | "90d" | "365d" | "all";

export interface DailyAnalyticsPoint {
  dayKey: string; // YYYY-MM-DD
  label: string; // e.g. "18 Oct"
  messagesIn: number;
  messagesOut: number;
  adSpendPaise: number;
  salesLinkedPaise: number;
  billsRaisedPaise: number;
  paymentsCollectedPaise: number;
  walletSpentPaise: number;
}

export interface FunnelStep {
  step: string;
  plainDescription: string;
  count: number;
  conversionFromStartPct: number;
}

export interface AgingBucket {
  bucket: string;
  billsCount: number;
  amountPaise: number;
  sharePct: number;
}

export interface ChannelPerformanceRow {
  channel: string;
  activityLabel: string;
  volume: number;
  spendPaise: number;
  valuePaise: number;
  returnRatio: number | null;
  statusNote: string;
}

function resolveRangeDays(range: AnalyticsDateRange): number {
  switch (range) {
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "90d":
      return 90;
    case "365d":
      return 365;
    case "all":
      return 90;
  }
}

function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function formatShortDay(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1));
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

export interface SetupMilestoneItem {
  key: string;
  label: string;
  href: string;
  done: boolean;
}

const setupProgressCache = new Map<
  string,
  { expiresAt: number; data: { doneCount: number; totalCount: number; milestones: SetupMilestoneItem[] } }
>();

export function getWorkspaceSetupProgress(workspaceId: string): {
  doneCount: number;
  totalCount: number;
  milestones: SetupMilestoneItem[];
} {
  const validId = assertValidUlid(workspaceId, "workspaceId");
  const now = Date.now();
  const cached = setupProgressCache.get(validId);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const ctrlDb = controlDb().$client;
  const dataDb = tenantDataDb({ workspaceId: validId }).$client;

  const hasWallet =
    Number(
      (ctrlDb.prepare("SELECT COALESCE(SUM(amount_paise), 0) AS bal FROM ledger_entries WHERE workspace_id = ?").get(validId) as { bal: number } | undefined)
        ?.bal ?? 0
    ) > 0;
  const hasConnection = Boolean(
    ctrlDb.prepare("SELECT 1 FROM connections WHERE workspace_id = ? LIMIT 1").get(validId)
  );
  const hasContact = Boolean(dataDb.prepare("SELECT 1 FROM contacts LIMIT 1").get());
  const hasTally = Boolean(dataDb.prepare("SELECT 1 FROM tally_vouchers LIMIT 1").get());
  const hasMessage = Boolean(dataDb.prepare("SELECT 1 FROM messages LIMIT 1").get());

  const milestones: SetupMilestoneItem[] = [
    { key: "wallet", label: "Recharge Wallet", href: "/billing?tab=wallet", done: hasWallet },
    { key: "connections", label: "Connect Account", href: "/connections", done: hasConnection },
    { key: "contacts", label: "Add Contacts", href: "/inbox", done: hasContact },
    { key: "tally", label: "Sync Tally Bills", href: "/tally", done: hasTally },
    { key: "messages", label: "Send First Reply", href: "/inbox", done: hasMessage },
  ];

  const doneCount = milestones.filter((m) => m.done).length;
  const data = { doneCount, totalCount: milestones.length, milestones };
  if (process.env.NODE_ENV !== "test") {
    setupProgressCache.set(validId, { expiresAt: now + 5_000, data });
  }
  return data;
}

function computeWorkspaceAnalyticsWatermark(
  validId: string,
  dataDb: ReturnType<typeof tenantDataDb>["$client"],
  ctrlDb: ReturnType<typeof controlDb>["$client"]
): string {
  const tenantRow = dataDb
    .prepare(
      `SELECT
        (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), 0) FROM contacts) || '|' ||
        (SELECT COUNT(*) || ':' || COALESCE(MAX(created_at), 0) FROM messages) || '|' ||
        (SELECT COUNT(*) || ':' || COALESCE(MAX(last_activity_at), 0) FROM conversations) || '|' ||
        (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), 0) FROM tally_vouchers) || '|' ||
        (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), 0) FROM campaigns) || '|' ||
        (SELECT COUNT(*) || ':' || COALESCE(MAX(occurred_at), 0) FROM pixel_events) || '|' ||
        (SELECT COUNT(*) || ':' || COALESCE(MAX(created_at), 0) FROM broadcasts) || '|' ||
        (SELECT COUNT(*) FROM reviews) AS wm`
    )
    .get() as { wm: string } | undefined;

  const ctrlRow = ctrlDb
    .prepare(
      `SELECT
        (SELECT COALESCE(SUM(amount_paise), 0) || ':' || COUNT(*) FROM ledger_entries WHERE workspace_id = ?) || '|' ||
        (SELECT COUNT(*) FROM connections WHERE workspace_id = ?) AS wm`
    )
    .get(validId, validId) as { wm: string } | undefined;

  return `${tenantRow?.wm ?? ""}|${ctrlRow?.wm ?? ""}`;
}

export function invalidateWorkspaceAnalyticsRollups(workspaceId: string): void {
  const validId = assertValidUlid(workspaceId, "workspaceId");
  setupProgressCache.delete(validId);
  try {
    tenantDataDb({ workspaceId: validId }).$client.prepare(`DELETE FROM analytics_rollups`).run();
  } catch {
    // Ignore if tenant DB is closed
  }
}

export function refreshWorkspaceAnalyticsRollups(workspaceId: string): void {
  const validId = assertValidUlid(workspaceId, "workspaceId");
  getWorkspaceAnalytics(validId, "30d", { forceRecompute: true });
  getWorkspaceAnalytics(validId, "7d", { forceRecompute: true });
}

export function getWorkspaceAnalytics(
  workspaceId: string,
  range: AnalyticsDateRange = "30d",
  options?: { forceRecompute?: boolean }
) {
  const validId = assertValidUlid(workspaceId, "workspaceId");
  const dataDb = tenantDataDb({ workspaceId: validId }).$client;
  const logsDb = tenantLogsDb({ workspaceId: validId }).$client;
  const ctrlDb = controlDb().$client;

  const now = Date.now();
  const rollupKey = `analytics:${range}`;
  const watermark = computeWorkspaceAnalyticsWatermark(validId, dataDb, ctrlDb);

  if (!options?.forceRecompute) {
    try {
      const existingRollup = dataDb
        .prepare(
          `SELECT payload_json AS payloadJson, computed_at AS computedAt
           FROM analytics_rollups
           WHERE key = ?`
        )
        .get(rollupKey) as { payloadJson: string; computedAt: number } | undefined;

      if (existingRollup && now - existingRollup.computedAt <= 60_000) {
        const parsed = JSON.parse(existingRollup.payloadJson) as {
          watermark?: string;
          report?: ReturnType<typeof computeWorkspaceAnalyticsSnapshot>;
        };
        if (parsed.watermark === watermark && parsed.report) {
          return parsed.report;
        }
      }
    } catch {
      // Fall through to live computation
    }
  }

  const report = computeWorkspaceAnalyticsSnapshot(validId, range, now, dataDb, logsDb, ctrlDb);

  try {
    dataDb
      .prepare(
        `INSERT INTO analytics_rollups (key, payload_json, computed_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET payload_json = excluded.payload_json, computed_at = excluded.computed_at`
      )
      .run(rollupKey, JSON.stringify({ watermark, report }), now);
  } catch {
    // Non-fatal rollup cache write
  }

  return report;
}

function computeWorkspaceAnalyticsSnapshot(
  validId: string,
  range: AnalyticsDateRange,
  now: number,
  dataDb: ReturnType<typeof tenantDataDb>["$client"],
  logsDb: ReturnType<typeof tenantLogsDb>["$client"],
  ctrlDb: ReturnType<typeof controlDb>["$client"]
) {
  const days = resolveRangeDays(range);
  const windowMs = days * 86_400_000;
  const startMs = range === "all" ? 0 : now - windowMs;
  const prevStartMs = range === "all" ? 0 : startMs - windowMs;
  const startDayKey = new Date(now - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const prevDayKey = new Date(now - (days * 2 - 1) * 86_400_000).toISOString().slice(0, 10);

  // 1. Contacts & Consent
  const contactsTotalCount = Number(
    (dataDb.prepare("SELECT COUNT(*) AS c FROM contacts").get() as { c: number } | undefined)?.c ?? 0
  );
  const optedInCount = Number(
    (dataDb.prepare("SELECT COUNT(*) AS c FROM opt_ins").get() as { c: number } | undefined)?.c ?? 0
  );
  const unsubscribedCount = Number(
    (logsDb.prepare("SELECT COUNT(*) AS c FROM suppressions").get() as { c: number } | undefined)?.c ?? 0
  );

  // 2. Customer Messages & Reply Speed
  const msgAgg = dataDb
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END), 0) AS inboundCount,
        COALESCE(SUM(CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END), 0) AS outboundCount,
        COALESCE(SUM(CASE WHEN direction = 'outbound' AND delivery_status IN ('sent','delivered','read') THEN 1 ELSE 0 END), 0) AS deliveredCount,
        COALESCE(SUM(CASE WHEN direction = 'outbound' AND delivery_status = 'read' THEN 1 ELSE 0 END), 0) AS readCount,
        COALESCE(SUM(cost_paise), 0) AS messageCostPaise
      FROM messages
      WHERE created_at >= ?`
    )
    .get(startMs) as {
    inboundCount: number;
    outboundCount: number;
    deliveredCount: number;
    readCount: number;
    messageCostPaise: number;
  };

  const convAgg = dataDb
    .prepare(
      `SELECT
        COUNT(*) AS totalConvs,
        COALESCE(SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END), 0) AS openConvs,
        COALESCE(SUM(CASE WHEN first_reply_time_sec IS NOT NULL THEN 1 ELSE 0 END), 0) AS repliedConvs,
        COALESCE(AVG(first_reply_time_sec), 0) AS avgReplySec,
        COALESCE(SUM(CASE WHEN sla_breached = 0 AND first_reply_time_sec IS NOT NULL THEN 1 ELSE 0 END), 0) AS withinSlaConvs
      FROM conversations
      WHERE created_at >= ?`
    )
    .get(startMs) as {
    totalConvs: number;
    openConvs: number;
    repliedConvs: number;
    avgReplySec: number;
    withinSlaConvs: number;
  };

  const openConversationsNow = Number(
    (dataDb.prepare("SELECT COUNT(*) AS c FROM conversations WHERE status = 'open'").get() as { c: number } | undefined)?.c ?? 0
  );

  const replyRatePct =
    convAgg.totalConvs > 0 ? Math.round((convAgg.repliedConvs / convAgg.totalConvs) * 1000) / 10 : 0;
  const avgReplyMinutes = convAgg.repliedConvs > 0 ? Math.round((convAgg.avgReplySec / 60) * 10) / 10 : 0;
  const withinTargetPct =
    convAgg.repliedConvs > 0 ? Math.round((convAgg.withinSlaConvs / convAgg.repliedConvs) * 1000) / 10 : 100;

  // 3. Tally Receivables, Collections & Aging
  const tallyLive = dataDb
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN voucher_type = 'Sales' AND payment_status IN ('unpaid','partial') THEN (amount_paise - paid_amount_paise) ELSE 0 END), 0) AS pendingPaise,
        COALESCE(SUM(CASE WHEN voucher_type = 'Sales' AND payment_status IN ('unpaid','partial') THEN 1 ELSE 0 END), 0) AS unpaidCount,
        COALESCE(SUM(CASE WHEN voucher_type = 'Sales' AND payment_status IN ('unpaid','partial') AND due_date IS NOT NULL AND due_date < ? THEN (amount_paise - paid_amount_paise) ELSE 0 END), 0) AS overduePaise,
        COALESCE(SUM(CASE WHEN voucher_type = 'Sales' AND payment_status IN ('unpaid','partial') AND due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END), 0) AS overdueCount
      FROM tally_vouchers`
    )
    .get(now, now) as {
    pendingPaise: number;
    unpaidCount: number;
    overduePaise: number;
    overdueCount: number;
  };

  // Deduplicate Receipt vouchers vs Sales.paid_amount_paise per (company, party) so collections are never double-counted
  const collectedPartyRows = dataDb
    .prepare(
      `SELECT
         COALESCE(company_id, '') AS companyId,
         LOWER(TRIM(party_name)) AS partyKey,
         COALESCE(SUM(CASE WHEN voucher_type = 'Receipt' THEN amount_paise ELSE 0 END), 0) AS receiptPaise,
         COALESCE(SUM(CASE WHEN voucher_type = 'Sales' THEN paid_amount_paise ELSE 0 END), 0) AS salesPaidPaise,
         COALESCE(SUM(CASE WHEN voucher_type = 'Sales' AND payment_status = 'paid' THEN 1 ELSE 0 END), 0) AS paidBillsCount
       FROM tally_vouchers
       WHERE voucher_date >= ? AND payment_status != 'cancelled'
       GROUP BY COALESCE(company_id, ''), LOWER(TRIM(party_name))`
    )
    .all(startMs) as Array<{
    companyId: string;
    partyKey: string;
    receiptPaise: number;
    salesPaidPaise: number;
    paidBillsCount: number;
  }>;

  const collectedWindow = collectedPartyRows.reduce(
    (acc, r) => ({
      collectedPaise:
        acc.collectedPaise + Math.max(Number(r.receiptPaise), Number(r.salesPaidPaise)),
      paidBillsCount: acc.paidBillsCount + Number(r.paidBillsCount),
    }),
    { collectedPaise: 0, paidBillsCount: 0 }
  );

  const collectedPrev =
    range === "all"
      ? { collectedPaise: 0 }
      : (() => {
          const prevRows = dataDb
            .prepare(
              `SELECT
                 COALESCE(SUM(CASE WHEN voucher_type = 'Receipt' THEN amount_paise ELSE 0 END), 0) AS receiptPaise,
                 COALESCE(SUM(CASE WHEN voucher_type = 'Sales' THEN paid_amount_paise ELSE 0 END), 0) AS salesPaidPaise
               FROM tally_vouchers
               WHERE voucher_date >= ? AND voucher_date < ? AND payment_status != 'cancelled'
               GROUP BY COALESCE(company_id, ''), LOWER(TRIM(party_name))`
            )
            .all(prevStartMs, startMs) as Array<{ receiptPaise: number; salesPaidPaise: number }>;
          return {
            collectedPaise: prevRows.reduce(
              (sum, r) => sum + Math.max(Number(r.receiptPaise), Number(r.salesPaidPaise)),
              0
            ),
          };
        })();

  // Receivables Aging Buckets
  const unpaidSalesRows = dataDb
    .prepare(
      `SELECT amount_paise AS amountPaise, paid_amount_paise AS paidAmountPaise, due_date AS dueDate
       FROM tally_vouchers
       WHERE voucher_type = 'Sales' AND payment_status IN ('unpaid', 'partial')`
    )
    .all() as Array<{ amountPaise: number; paidAmountPaise: number; dueDate: number | null }>;

  const rawAging = [
    { bucket: "Not Due Yet", billsCount: 0, amountPaise: 0 },
    { bucket: "1–15 Days Overdue", billsCount: 0, amountPaise: 0 },
    { bucket: "16–30 Days Overdue", billsCount: 0, amountPaise: 0 },
    { bucket: "31–60 Days Overdue", billsCount: 0, amountPaise: 0 },
    { bucket: "60+ Days Overdue", billsCount: 0, amountPaise: 0 },
  ];

  for (const row of unpaidSalesRows) {
    const due = Math.max(0, row.amountPaise - row.paidAmountPaise);
    if (due <= 0) continue;
    if (!row.dueDate || row.dueDate >= now) {
      rawAging[0]!.billsCount += 1;
      rawAging[0]!.amountPaise += due;
    } else {
      const daysLate = Math.floor((now - row.dueDate) / 86_400_000);
      const idx = daysLate <= 15 ? 1 : daysLate <= 30 ? 2 : daysLate <= 60 ? 3 : 4;
      rawAging[idx]!.billsCount += 1;
      rawAging[idx]!.amountPaise += due;
    }
  }

  const totalAgingPaise = rawAging.reduce((acc, b) => acc + b.amountPaise, 0);
  const receivablesAging: AgingBucket[] = rawAging.map((b) => ({
    ...b,
    sharePct: totalAgingPaise > 0 ? Math.round((b.amountPaise / totalAgingPaise) * 1000) / 10 : 0,
  }));

  // 4. Marketing Spend & Sales Linked (Campaigns + Snapshots + Pixel + Broadcasts)
  const snapFilter = range === "all" ? "1=1" : "day_key >= ?";
  const snapAgg = (
    range === "all"
      ? dataDb.prepare(
          `SELECT COALESCE(SUM(spend_paise),0) AS spendPaise, COALESCE(SUM(revenue_paise),0) AS revPaise, COALESCE(SUM(clicks),0) AS clicks, COALESCE(SUM(sales_count),0) AS salesCount FROM insight_snapshots`
        ).get()
      : dataDb
          .prepare(
            `SELECT COALESCE(SUM(spend_paise),0) AS spendPaise, COALESCE(SUM(revenue_paise),0) AS revPaise, COALESCE(SUM(clicks),0) AS clicks, COALESCE(SUM(sales_count),0) AS salesCount FROM insight_snapshots WHERE ${snapFilter}`
          )
          .get(startDayKey)
  ) as { spendPaise: number; revPaise: number; clicks: number; salesCount: number };

  const campaignFallbackAgg = dataDb
    .prepare(
      `SELECT COALESCE(SUM(total_spend_paise),0) AS spendPaise, COALESCE(SUM(attributed_revenue_paise),0) AS revPaise, COALESCE(SUM(clicks),0) AS clicks, COALESCE(SUM(conversions),0) AS conversions, COUNT(*) AS campaignsCount FROM campaigns`
    )
    .get() as {
    spendPaise: number;
    revPaise: number;
    clicks: number;
    conversions: number;
    campaignsCount: number;
  };

  const pixelAgg = dataDb
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN event_name = 'Purchase' THEN value_paise ELSE 0 END), 0) AS purchasePaise,
        COALESCE(SUM(CASE WHEN event_name = 'Purchase' THEN 1 ELSE 0 END), 0) AS purchaseCount,
        COUNT(*) AS totalEvents
      FROM pixel_events
      WHERE occurred_at >= ?`
    )
    .get(startMs) as { purchasePaise: number; purchaseCount: number; totalEvents: number };

  const broadcastAgg = dataDb
    .prepare(
      `SELECT
        COUNT(*) AS broadcastsCount,
        COALESCE(SUM(sent_count), 0) AS sentCount,
        COALESCE(SUM(delivered_count), 0) AS deliveredCount,
        COALESCE(SUM(read_count), 0) AS readCount,
        COALESCE(SUM(replied_count), 0) AS repliedCount,
        COALESCE(SUM(actual_cost_paise), 0) AS costPaise
      FROM broadcasts
      WHERE created_at >= ?`
    )
    .get(startMs) as {
    broadcastsCount: number;
    sentCount: number;
    deliveredCount: number;
    readCount: number;
    repliedCount: number;
    costPaise: number;
  };

  const prevSnapAgg =
    range === "all"
      ? { spendPaise: 0, revPaise: 0 }
      : (dataDb
          .prepare(
            `SELECT COALESCE(SUM(spend_paise),0) AS spendPaise, COALESCE(SUM(revenue_paise),0) AS revPaise FROM insight_snapshots WHERE day_key >= ? AND day_key < ?`
          )
          .get(prevDayKey, startDayKey) as { spendPaise: number; revPaise: number });

  const adSpendPaise = snapAgg.spendPaise > 0 ? snapAgg.spendPaise : campaignFallbackAgg.spendPaise;
  const adRevenuePaise = snapAgg.revPaise > 0 ? snapAgg.revPaise : campaignFallbackAgg.revPaise;

  const marketingSpendPaise = adSpendPaise + msgAgg.messageCostPaise + broadcastAgg.costPaise;
  const salesLinkedPaise = adRevenuePaise + pixelAgg.purchasePaise;
  const returnPerRupeeSpent =
    marketingSpendPaise > 0 ? Math.round((salesLinkedPaise / marketingSpendPaise) * 100) / 100 : 0;

  // 5. Wallet Health (Control DB)
  const walletBalanceRow = ctrlDb
    .prepare(`SELECT COALESCE(SUM(amount_paise), 0) AS bal FROM ledger_entries WHERE workspace_id = ?`)
    .get(validId) as { bal: number };
  const walletSpend30dRow = ctrlDb
    .prepare(
      `SELECT COALESCE(SUM(ABS(amount_paise)), 0) AS spent
       FROM ledger_entries
       WHERE workspace_id = ? AND amount_paise < 0 AND created_at >= ?`
    )
    .get(validId, now - 30 * 86_400_000) as { spent: number };

  const dailyBurnPaise = walletSpend30dRow.spent / 30;
  const estimatedDaysRemaining =
    dailyBurnPaise > 0 ? Math.max(0, Math.round(walletBalanceRow.bal / dailyBurnPaise)) : null;

  // 6. Google Reviews & Star Breakdown
  const reviewRows = dataDb
    .prepare(`SELECT rating, COUNT(*) AS cnt FROM reviews GROUP BY rating`)
    .all() as Array<{ rating: number; cnt: number }>;
  const unrepliedReviewsCount = Number(
    (dataDb.prepare(`SELECT COUNT(*) AS c FROM reviews WHERE reply_status != 'replied'`).get() as { c: number } | undefined)
      ?.c ?? 0
  );
  const reviewsCount = reviewRows.reduce((s, r) => s + Number(r.cnt), 0);
  const weightedRating = reviewRows.reduce((s, r) => s + Number(r.rating) * Number(r.cnt), 0);
  const averageGoogleRating = reviewsCount > 0 ? Math.round((weightedRating / reviewsCount) * 10) / 10 : 0;

  const reviewStars = [5, 4, 3, 2, 1].map((star) => {
    const found = reviewRows.find((r) => Number(r.rating) === star);
    const count = Number(found?.cnt ?? 0);
    return {
      star,
      count,
      sharePct: reviewsCount > 0 ? Math.round((count / reviewsCount) * 1000) / 10 : 0,
    };
  });

  // 7. Social Posts
  const socialAgg = dataDb
    .prepare(
      `SELECT COUNT(*) AS totalPosts, COALESCE(SUM(reach_count),0) AS reach, COALESCE(SUM(engagement_count),0) AS engagement
       FROM scheduled_posts WHERE created_at >= ?`
    )
    .get(startMs) as { totalPosts: number; reach: number; engagement: number };

  // 8. Daily Time Series (Every day in selected window, 100% SQLite-backed)
  const msgByDay = new Map<string, { inb: number; outb: number }>();
  const msgDayRows = dataDb
    .prepare(
      `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS dayKey,
              SUM(CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END) AS inb,
              SUM(CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END) AS outb
       FROM messages
       WHERE created_at >= ?
       GROUP BY dayKey`
    )
    .all(now - days * 86_400_000) as Array<{ dayKey: string; inb: number; outb: number }>;
  for (const r of msgDayRows) {
    if (r.dayKey) msgByDay.set(r.dayKey, { inb: Number(r.inb), outb: Number(r.outb) });
  }

  const snapByDay = new Map<string, { spend: number; rev: number }>();
  const snapDayRows = dataDb
    .prepare(
      `SELECT day_key AS dayKey, SUM(spend_paise) AS spend, SUM(revenue_paise) AS rev
       FROM insight_snapshots
       WHERE day_key >= ?
       GROUP BY day_key`
    )
    .all(startDayKey) as Array<{ dayKey: string; spend: number; rev: number }>;
  for (const r of snapDayRows) {
    if (r.dayKey) snapByDay.set(r.dayKey, { spend: Number(r.spend), rev: Number(r.rev) });
  }

  const pixelByDay = new Map<string, number>();
  const pixelDayRows = dataDb
    .prepare(
      `SELECT strftime('%Y-%m-%d', occurred_at / 1000, 'unixepoch') AS dayKey,
              SUM(CASE WHEN event_name = 'Purchase' THEN value_paise ELSE 0 END) AS val
       FROM pixel_events
       WHERE occurred_at >= ?
       GROUP BY dayKey`
    )
    .all(now - days * 86_400_000) as Array<{ dayKey: string; val: number }>;
  for (const r of pixelDayRows) {
    if (r.dayKey) pixelByDay.set(r.dayKey, Number(r.val));
  }

  const tallyByDay = new Map<string, { raised: number; collected: number }>();
  const tallyDayPartyRows = dataDb
    .prepare(
      `SELECT strftime('%Y-%m-%d', voucher_date / 1000, 'unixepoch') AS dayKey,
              SUM(CASE WHEN voucher_type = 'Sales' THEN amount_paise ELSE 0 END) AS raised,
              SUM(CASE WHEN voucher_type = 'Receipt' THEN amount_paise ELSE 0 END) AS receiptPaise,
              SUM(CASE WHEN voucher_type = 'Sales' THEN paid_amount_paise ELSE 0 END) AS salesPaidPaise
       FROM tally_vouchers
       WHERE voucher_date >= ? AND payment_status != 'cancelled'
       GROUP BY dayKey, COALESCE(company_id, ''), LOWER(TRIM(party_name))`
    )
    .all(now - days * 86_400_000) as Array<{
    dayKey: string;
    raised: number;
    receiptPaise: number;
    salesPaidPaise: number;
  }>;
  for (const r of tallyDayPartyRows) {
    if (!r.dayKey) continue;
    const prev = tallyByDay.get(r.dayKey) ?? { raised: 0, collected: 0 };
    prev.raised += Number(r.raised);
    prev.collected += Math.max(Number(r.receiptPaise), Number(r.salesPaidPaise));
    tallyByDay.set(r.dayKey, prev);
  }

  const walletByDay = new Map<string, number>();
  const walletDayRows = ctrlDb
    .prepare(
      `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS dayKey,
              SUM(ABS(amount_paise)) AS spent
       FROM ledger_entries
       WHERE workspace_id = ? AND amount_paise < 0 AND created_at >= ?
       GROUP BY dayKey`
    )
    .all(validId, now - days * 86_400_000) as Array<{ dayKey: string; spent: number }>;
  for (const r of walletDayRows) {
    if (r.dayKey) walletByDay.set(r.dayKey, Number(r.spent));
  }

  const dailySeries: DailyAnalyticsPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayKey = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
    const m = msgByDay.get(dayKey);
    const s = snapByDay.get(dayKey);
    const px = pixelByDay.get(dayKey) ?? 0;
    const t = tallyByDay.get(dayKey);
    const w = walletByDay.get(dayKey) ?? 0;
    dailySeries.push({
      dayKey,
      label: formatShortDay(dayKey),
      messagesIn: m?.inb ?? 0,
      messagesOut: m?.outb ?? 0,
      adSpendPaise: s?.spend ?? 0,
      salesLinkedPaise: (s?.rev ?? 0) + px,
      billsRaisedPaise: t?.raised ?? 0,
      paymentsCollectedPaise: t?.collected ?? 0,
      walletSpentPaise: w,
    });
  }

  // 9. Customer Conversion Funnel
  const reachedCount = Math.max(contactsTotalCount, msgAgg.outboundCount + broadcastAgg.sentCount);
  const deliveredTotal = msgAgg.deliveredCount + broadcastAgg.deliveredCount;
  const engagedTotal = msgAgg.readCount + broadcastAgg.readCount + snapAgg.clicks + campaignFallbackAgg.clicks;
  const repliedTotal = msgAgg.inboundCount + broadcastAgg.repliedCount;
  const convertedTotal = collectedWindow.paidBillsCount + pixelAgg.purchaseCount + snapAgg.salesCount;

  const funnelBase = Math.max(1, reachedCount);
  const funnel: FunnelStep[] = [
    {
      step: "Contacts & Reach",
      plainDescription: "Customers in your directory or reached by messages",
      count: reachedCount,
      conversionFromStartPct: reachedCount > 0 ? 100 : 0,
    },
    {
      step: "Messages Delivered",
      plainDescription: "WhatsApp replies, bill reminders, and broadcasts delivered",
      count: deliveredTotal,
      conversionFromStartPct: reachedCount > 0 ? Math.min(100, Math.round((deliveredTotal / funnelBase) * 1000) / 10) : 0,
    },
    {
      step: "Read or Clicked",
      plainDescription: "Messages opened by customers or ad links clicked",
      count: engagedTotal,
      conversionFromStartPct: reachedCount > 0 ? Math.min(100, Math.round((engagedTotal / funnelBase) * 1000) / 10) : 0,
    },
    {
      step: "Customer Replies",
      plainDescription: "Inbound replies received in your team inbox",
      count: repliedTotal,
      conversionFromStartPct: reachedCount > 0 ? Math.min(100, Math.round((repliedTotal / funnelBase) * 1000) / 10) : 0,
    },
    {
      step: "Paid Bills & Purchases",
      plainDescription: "Settled Tally sales bills and verified website orders",
      count: convertedTotal,
      conversionFromStartPct: reachedCount > 0 ? Math.min(100, Math.round((convertedTotal / funnelBase) * 1000) / 10) : 0,
    },
  ];

  // 10. Channel Breakdown Table
  const totalVouchersCount = Number(
    (dataDb.prepare(`SELECT COUNT(*) AS c FROM tally_vouchers WHERE voucher_date >= ?`).get(startMs) as { c: number } | undefined)
      ?.c ?? 0
  );

  const channelBreakdown: ChannelPerformanceRow[] = [
    {
      channel: "WhatsApp Business",
      activityLabel: `${msgAgg.inboundCount + msgAgg.outboundCount + broadcastAgg.sentCount} messages`,
      volume: msgAgg.inboundCount + msgAgg.outboundCount + broadcastAgg.sentCount,
      spendPaise: msgAgg.messageCostPaise + broadcastAgg.costPaise,
      valuePaise: collectedWindow.collectedPaise,
      returnRatio:
        msgAgg.messageCostPaise + broadcastAgg.costPaise > 0
          ? Math.round((collectedWindow.collectedPaise / (msgAgg.messageCostPaise + broadcastAgg.costPaise)) * 100) / 100
          : null,
      statusNote: `${optedInCount} opted-in • ${unsubscribedCount} unsubscribed`,
    },
    {
      channel: "Facebook & Instagram Ads",
      activityLabel: `${campaignFallbackAgg.campaignsCount} campaigns`,
      volume: snapAgg.clicks || campaignFallbackAgg.clicks,
      spendPaise: adSpendPaise,
      valuePaise: adRevenuePaise,
      returnRatio: adSpendPaise > 0 ? Math.round((adRevenuePaise / adSpendPaise) * 100) / 100 : null,
      statusNote: adSpendPaise > 0 ? `${snapAgg.clicks || campaignFallbackAgg.clicks} link clicks` : "No ad spend recorded",
    },
    {
      channel: "Tally Prime Billing",
      activityLabel: `${totalVouchersCount} bills & receipts`,
      volume: totalVouchersCount,
      spendPaise: 0,
      valuePaise: collectedWindow.collectedPaise,
      returnRatio: null,
      statusNote: `${tallyLive.unpaidCount} open bills (${formatInr(tallyLive.pendingPaise)} pending)`,
    },
    {
      channel: "Website Sales Tracking",
      activityLabel: `${pixelAgg.totalEvents} tracked events`,
      volume: pixelAgg.totalEvents,
      spendPaise: 0,
      valuePaise: pixelAgg.purchasePaise,
      returnRatio: null,
      statusNote: `${pixelAgg.purchaseCount} verified purchases`,
    },
    {
      channel: "Social Posts (IG / FB / Google)",
      activityLabel: `${socialAgg.totalPosts} posts`,
      volume: socialAgg.reach,
      spendPaise: 0,
      valuePaise: 0,
      returnRatio: null,
      statusNote: `${socialAgg.engagement} likes, comments & shares`,
    },
    {
      channel: "Google Business Reviews",
      activityLabel: `${reviewsCount} total reviews`,
      volume: reviewsCount,
      spendPaise: 0,
      valuePaise: 0,
      returnRatio: null,
      statusNote: reviewsCount > 0 ? `${averageGoogleRating} ★ average (${unrepliedReviewsCount} awaiting reply)` : "No reviews synced yet",
    },
  ];

  // 11. Provider Call Reliability
  const providerRows = logsDb
    .prepare(
      `SELECT provider,
              COUNT(*) AS totalCalls,
              SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) AS okCalls,
              AVG(latency_ms) AS avgLatencyMs
       FROM provider_calls
       WHERE ts >= ?
       GROUP BY provider`
    )
    .all(startMs) as Array<{ provider: string; totalCalls: number; okCalls: number; avgLatencyMs: number }>;

  const providerHealth = providerRows.map((p) => ({
    provider: p.provider,
    totalCalls: Number(p.totalCalls),
    successRatePct:
      Number(p.totalCalls) > 0 ? Math.round((Number(p.okCalls) / Number(p.totalCalls)) * 1000) / 10 : 100,
    avgLatencyMs: Math.round(Number(p.avgLatencyMs ?? 0)),
  }));

  // 12. Real Setup Checklist
  const connectionsCount = Number(
    (ctrlDb.prepare(`SELECT COUNT(*) AS c FROM connections WHERE workspace_id = ?`).get(validId) as { c: number } | undefined)
      ?.c ?? 0
  );
  const tallyCountAll = Number(
    (dataDb.prepare(`SELECT COUNT(*) AS c FROM tally_vouchers`).get() as { c: number } | undefined)?.c ?? 0
  );
  const messagesCountAll = Number(
    (dataDb.prepare(`SELECT COUNT(*) AS c FROM messages`).get() as { c: number } | undefined)?.c ?? 0
  );

  const setupChecklist = [
    {
      key: "wallet",
      title: "Add funds to your Prepaid Wallet",
      done: walletBalanceRow.bal > 0,
      href: "/billing?tab=wallet",
      cta: "Recharge Wallet",
    },
    {
      key: "connections",
      title: "Connect WhatsApp, Meta, or Google Business",
      done: connectionsCount > 0,
      href: "/connections",
      cta: "Connect Account",
    },
    {
      key: "contacts",
      title: "Add or import your customer contacts",
      done: contactsTotalCount > 0,
      href: "/inbox",
      cta: "Add Contacts",
    },
    {
      key: "tally",
      title: "Pair Tally Prime PC or import Tally XML bills",
      done: tallyCountAll > 0,
      href: "/tally",
      cta: "Import Tally Bills",
    },
    {
      key: "messages",
      title: "Send your first customer reply or bill reminder",
      done: messagesCountAll > 0,
      href: "/inbox",
      cta: "Open Messages",
    },
  ];

  const hasAnyData =
    contactsTotalCount > 0 ||
    tallyCountAll > 0 ||
    messagesCountAll > 0 ||
    campaignFallbackAgg.campaignsCount > 0 ||
    reviewsCount > 0 ||
    walletBalanceRow.bal > 0;

  return {
    range,
    daysCount: days,
    hasAnyData,
    kpis: {
      moneyCollectedPaise: collectedWindow.collectedPaise,
      moneyCollectedChangePct: pctChange(collectedWindow.collectedPaise, collectedPrev.collectedPaise),
      pendingReceivablesPaise: tallyLive.pendingPaise,
      unpaidBillsCount: tallyLive.unpaidCount,
      overdueReceivablesPaise: tallyLive.overduePaise,
      overdueBillsCount: tallyLive.overdueCount,
      marketingSpendPaise,
      marketingSpendChangePct: pctChange(adSpendPaise, prevSnapAgg.spendPaise),
      salesLinkedPaise,
      salesLinkedChangePct: pctChange(adRevenuePaise, prevSnapAgg.revPaise),
      returnPerRupeeSpent,
      messagesInCount: msgAgg.inboundCount,
      messagesOutCount: msgAgg.outboundCount,
      conversationsCount: convAgg.totalConvs,
      openConversationsCount: openConversationsNow,
      replyRatePct,
      avgReplyMinutes,
      withinTargetPct,
      walletBalancePaise: walletBalanceRow.bal,
      walletSpend30dPaise: walletSpend30dRow.spent,
      estimatedDaysRemaining,
      contactsTotalCount,
      optedInCount,
      unsubscribedCount,
      averageGoogleRating,
      reviewsCount,
      unrepliedReviewsCount,
    },
    dailySeries,
    funnel,
    receivablesAging,
    channelBreakdown,
    reviewStars,
    providerHealth,
    setupChecklist,
  };
}

export function exportWorkspaceAnalyticsCsv(workspaceId: string, range: AnalyticsDateRange = "30d"): string {
  const report = getWorkspaceAnalytics(workspaceId, range);
  const lines: string[] = [
    "Date,Inbound Messages,Outbound Messages,Ad Spend (INR),Sales Linked (INR),Tally Bills Raised (INR),Payments Collected (INR),Wallet Spent (INR)",
  ];

  for (const d of report.dailySeries) {
    lines.push(
      [
        escapeCsvCellSafe(d.dayKey),
        escapeCsvCellSafe(d.messagesIn),
        escapeCsvCellSafe(d.messagesOut),
        (d.adSpendPaise / 100).toFixed(2),
        (d.salesLinkedPaise / 100).toFixed(2),
        (d.billsRaisedPaise / 100).toFixed(2),
        (d.paymentsCollectedPaise / 100).toFixed(2),
        (d.walletSpentPaise / 100).toFixed(2),
      ].join(",")
    );
  }
  return lines.join("\n");
}

export function getPlatformAdminAnalytics() {
  const ctrl = controlDb();
  const rawCtrl = ctrl.$client;
  const rawIngress = ingressDb().$client;
  const pLogs = platformLogsDb();
  const now = Date.now();

  const totalCatalogServices =
    Number(
      (rawCtrl.prepare("SELECT COUNT(*) AS c FROM services WHERE active = 1").get() as { c: number } | undefined)?.c ??
        15
    ) || 15;

  const totalBusinesses = Number(
    (rawCtrl.prepare("SELECT COUNT(*) AS c FROM workspaces").get() as { c: number } | undefined)?.c ?? 0
  );
  const totalUsers = Number(
    (rawCtrl.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number } | undefined)?.c ?? 0
  );
  const activePlansCount = Number(
    (
      rawCtrl
        .prepare(
          "SELECT COUNT(*) AS c FROM entitlements WHERE status IN ('active','trialing') AND (expires_at IS NULL OR expires_at > ?)"
        )
        .get(now) as { c: number } | undefined
    )?.c ?? 0
  );
  const pendingPlanRequestsCount = Number(
    (rawCtrl.prepare("SELECT COUNT(*) AS c FROM service_plan_requests WHERE status = 'pending_payment'").get() as { c: number } | undefined)
      ?.c ?? 0
  );
  const pendingWalletRequestsCount = Number(
    (rawCtrl.prepare("SELECT COUNT(*) AS c FROM payments WHERE status = 'pending_verification'").get() as { c: number } | undefined)
      ?.c ?? 0
  );
  const totalWalletLiabilityPaise = Number(
    (rawCtrl.prepare("SELECT COALESCE(SUM(amount_paise), 0) AS s FROM ledger_entries").get() as { s: number } | undefined)
      ?.s ?? 0
  );
  const totalInvoicedRevenuePaise = Number(
    (
      rawCtrl
        .prepare(
          `SELECT COALESCE(SUM(total_paise), 0) AS s
           FROM invoices
           WHERE (doc_type = 'tax_invoice' AND status IN ('paid','credited'))
              OR (doc_type = 'credit_note' AND status = 'issued')`
        )
        .get() as { s: number } | undefined
    )?.s ?? 0
  );
  const totalDiskBytes = Number(
    (
      rawCtrl
        .prepare("SELECT COALESCE(SUM(data_size_bytes + logs_size_bytes), 0) AS b FROM tenant_registry")
        .get() as { b: number } | undefined
    )?.b ?? 0
  );

  const webhookStats = rawIngress
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN status IN ('received','enqueued','pending') THEN 1 ELSE 0 END), 0) AS pendingCount,
        COALESCE(SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END), 0) AS processedCount,
        COALESCE(SUM(CASE WHEN status IN ('dead','failed') THEN 1 ELSE 0 END), 0) AS failedCount
       FROM webhook_inbox`
    )
    .get() as { pendingCount: number; processedCount: number; failedCount: number };

  const emailStats = rawCtrl
    .prepare(
      `SELECT
        COUNT(*) AS totalCount,
        COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0) AS sentCount,
        COALESCE(SUM(CASE WHEN status = 'queued_local' THEN 1 ELSE 0 END), 0) AS localPreviewCount,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failedCount
       FROM email_deliveries`
    )
    .get() as { totalCount: number; sentCount: number; localPreviewCount: number; failedCount: number };

  const rawBusinesses = rawCtrl
    .prepare(
      `SELECT
        w.id,
        w.name,
        w.slug,
        w.industry,
        w.gstin,
        w.state_code AS stateCode,
        w.billing_status AS billingStatus,
        w.free_access_until AS freeAccessUntil,
        w.free_access_note AS freeAccessNote,
        w.created_at AS createdAt,
        COALESCE(tr.status, 'active') AS dbStatus,
        COALESCE(tr.data_size_bytes, 0) AS dataSizeBytes,
        COALESCE(tr.logs_size_bytes, 0) AS logsSizeBytes,
        tr.last_backup_at AS lastBackupAt,
        COALESCE((SELECT SUM(amount_paise) FROM ledger_entries le WHERE le.workspace_id = w.id), 0) AS walletBalancePaise,
        COALESCE((SELECT COUNT(*) FROM entitlements e WHERE e.workspace_id = w.id AND e.status IN ('active','trialing') AND (e.expires_at IS NULL OR e.expires_at > ?)), 0) AS activeServicesCount,
        COALESCE((SELECT GROUP_CONCAT(e.service_key, ',') FROM entitlements e WHERE e.workspace_id = w.id AND e.status IN ('active','trialing') AND (e.expires_at IS NULL OR e.expires_at > ?)), '') AS activeServiceKeysCsv,
        COALESCE((SELECT COUNT(*) FROM service_plan_requests spr WHERE spr.workspace_id = w.id AND spr.status = 'pending_payment'), 0) AS pendingRequestsCount,
        COALESCE((SELECT sc.mode FROM storage_configurations sc WHERE sc.workspace_id = w.id), 'rsl_managed') AS storageMode
       FROM workspaces w
       LEFT JOIN tenant_registry tr ON tr.tenant_id = w.id
       ORDER BY w.created_at DESC`
    )
    .all(now, now) as Array<{
    id: string;
    name: string;
    slug: string;
    industry: string | null;
    gstin: string | null;
    stateCode: string;
    billingStatus: string;
    freeAccessUntil: number | null;
    freeAccessNote: string | null;
    createdAt: number;
    dbStatus: string;
    dataSizeBytes: number;
    logsSizeBytes: number;
    lastBackupAt: number | null;
    walletBalancePaise: number;
    activeServicesCount: number;
    activeServiceKeysCsv: string;
    pendingRequestsCount: number;
    storageMode: string;
  }>;

  const businesses = rawBusinesses.map((b) => {
    const hasFreeAllTools = Boolean(b.freeAccessUntil && b.freeAccessUntil > now);
    const freeAccessRemainingDays = hasFreeAllTools
      ? Math.max(1, Math.ceil(((b.freeAccessUntil ?? now) - now) / 86_400_000))
      : 0;
    const effectiveUnlockedCount = hasFreeAllTools
      ? totalCatalogServices
      : b.activeServicesCount;
    return {
      ...b,
      hasFreeAllTools,
      freeAccessRemainingDays,
      effectiveUnlockedCount,
    };
  });

  const freeAccessClientsCount = businesses.filter((b) => b.hasFreeAllTools).length;
  const effectiveUnlockedToolsCount = businesses.reduce(
    (sum, b) => sum + b.effectiveUnlockedCount,
    0
  );

  const recentAdminLogs = pLogs
    .select()
    .from(platformLogsSchema.staffActionLogs)
    .orderBy(desc(platformLogsSchema.staffActionLogs.ts))
    .limit(40)
    .all();

  const docsFeedbackRows = ctrl
    .select()
    .from(controlSchema.docsFeedback)
    .orderBy(desc(controlSchema.docsFeedback.createdAt))
    .limit(30)
    .all();

  const zeroResultSearches = pLogs.$client
    .prepare(
      `SELECT query, COUNT(*) AS searches, MAX(created_at) AS lastSearchedAt
       FROM docs_search_logs
       WHERE result_count = 0
       GROUP BY query
       ORDER BY searches DESC
       LIMIT 20`
    )
    .all() as Array<{ query: string; searches: number; lastSearchedAt: number }>;

  return {
    totals: {
      totalBusinesses,
      totalUsers,
      activePlansCount,
      freeAccessClientsCount,
      effectiveUnlockedToolsCount,
      pendingPlanRequestsCount,
      pendingWalletRequestsCount,
      totalWalletLiabilityPaise,
      totalInvoicedRevenuePaise,
      totalDiskBytes,
    },
    webhookStats,
    emailStats,
    businesses,
    recentAdminLogs,
    docsFeedbackRows,
    zeroResultSearches,
  };
}
