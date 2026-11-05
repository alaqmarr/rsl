import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";

// Inbox & Contacts
export const contacts = sqliteTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    phoneE164: text("phone_e164"),
    email: text("email"),
    companyName: text("company_name"),
    instagramHandle: text("instagram_handle"),
    facebookScopedId: text("facebook_scoped_id"),
    tallyPartyGuid: text("tally_party_guid"),
    tagsJson: text("tags_json").notNull().default("[]"),
    lifetimeValuePaise: integer("lifetime_value_paise").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("idx_contacts_phone").on(t.phoneE164),
    index("idx_contacts_created").on(t.createdAt),
  ]
);

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(), // whatsapp | instagram | facebook | google_review
    assetId: text("asset_id"),
    externalThreadId: text("external_thread_id"),
    subject: text("subject"),
    status: text("status").notNull().default("open"), // open | pending | resolved | snoozed
    assignedUserId: text("assigned_user_id"),
    unreadCount: integer("unread_count").notNull().default(0),
    lastCustomerMessageAt: integer("last_customer_message_at"),
    firstReplyTimeSec: integer("first_reply_time_sec"),
    slaTargetMinutes: integer("sla_target_minutes").notNull().default(30),
    slaBreached: integer("sla_breached", { mode: "boolean" }).notNull().default(false),
    linkedVoucherGuid: text("linked_voucher_guid"),
    lastMessagePreview: text("last_message_preview"),
    lastActivityAt: integer("last_activity_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_conversations_status_activity").on(t.status, t.lastActivityAt),
    index("idx_conversations_channel").on(t.channel),
  ]
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(), // inbound | outbound
    senderType: text("sender_type").notNull(), // customer | team_member | template_automation
    senderId: text("sender_id"),
    body: text("body").notNull(),
    templateName: text("template_name"),
    deliveryStatus: text("delivery_status").notNull().default("sent"), // queued | sent | delivered | read | failed
    costPaise: integer("cost_paise").notNull().default(0),
    pricingCategory: text("pricing_category"), // utility | marketing | service
    externalMessageId: text("external_message_id"),
    broadcastId: text("broadcast_id"),
    errorDetail: text("error_detail"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_messages_conv_ts").on(t.conversationId, t.createdAt),
    index("idx_messages_ts").on(t.createdAt),
    index("idx_messages_ext_id").on(t.externalMessageId),
  ]
);

export const messageAttachments = sqliteTable("message_attachments", {
  id: text("id").primaryKey(),
  messageId: text("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: text("storage_key").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const labels = sqliteTable("labels", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  colorHex: text("color_hex").notNull().default("#0E8A56"),
  createdAt: integer("created_at").notNull(),
});

export const conversationLabels = sqliteTable(
  "conversation_labels",
  {
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    labelId: text("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("uq_conv_label").on(t.conversationId, t.labelId)]
);

export const internalNotes = sqliteTable("internal_notes", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  authorUserId: text("author_user_id").notNull(),
  authorName: text("author_name").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const cannedReplies = sqliteTable("canned_replies", {
  id: text("id").primaryKey(),
  shortcut: text("shortcut").notNull().unique(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
});

// Google Business Reviews
export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    externalReviewId: text("external_review_id").notNull().unique(),
    locationName: text("location_name").notNull(),
    reviewerName: text("reviewer_name").notNull(),
    rating: integer("rating").notNull(), // 1 to 5
    comment: text("comment").notNull(),
    replyStatus: text("reply_status").notNull().default("unreplied"), // unreplied | draft_ready | replied
    publishedReplyText: text("published_reply_text"),
    repliedAt: integer("replied_at"),
    reviewedAt: integer("reviewed_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_reviews_rating_ts").on(t.rating, t.reviewedAt)]
);

// Marketing, Campaigns, Scheduled Social Posts & Website Sales Tracking
export const campaigns = sqliteTable(
  "campaigns",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    channel: text("channel").notNull(), // meta_ads | instagram | facebook | google_ads | whatsapp_broadcast
    objective: text("objective").notNull(), // messages | website_sales | lead_generation | awareness | search_leads | pmax_local | call_ads
    billingMode: text("billing_mode").notNull().default("direct_client"), // direct_client | rsl_managed_vault
    status: text("status").notNull().default("active"), // active | paused | completed | draft
    dailyBudgetPaise: integer("daily_budget_paise").notNull().default(0),
    lifetimeBudgetPaise: integer("lifetime_budget_paise").notNull().default(0),
    vaultAllocatedPaise: integer("vault_allocated_paise").notNull().default(0),
    totalSpendPaise: integer("total_spend_paise").notNull().default(0),
    attributedRevenuePaise: integer("attributed_revenue_paise").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    conversions: integer("conversions").notNull().default(0),
    externalAccountId: text("external_account_id"),
    externalCampaignId: text("external_campaign_id"),
    externalAdsetId: text("external_adset_id"),
    externalCreativeId: text("external_creative_id"),
    externalAdId: text("external_ad_id"),
    headline: text("headline"),
    primaryText: text("primary_text"),
    callToAction: text("call_to_action"),
    destinationUrl: text("destination_url"),
    whatsappPhoneE164: text("whatsapp_phone_e164"),
    mediaUrl: text("media_url"),
    targetLocationsJson: text("target_locations_json").notNull().default("[]"),
    targetKeywordsJson: text("target_keywords_json").notNull().default("[]"),
    ageMin: integer("age_min").notNull().default(18),
    ageMax: integer("age_max").notNull().default(65),
    syncStatus: text("sync_status").notNull().default("local_draft"), // live_synced | paused_live | cap_exhausted | sandbox_simulated | api_error | local_draft
    lastSyncMessage: text("last_sync_message"),
    lastSyncedAt: integer("last_synced_at"),
    startDate: integer("start_date").notNull(),
    endDate: integer("end_date"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("idx_campaigns_status").on(t.status),
    index("idx_campaigns_ext_id").on(t.externalCampaignId),
  ]
);

export const insightSnapshots = sqliteTable(
  "insight_snapshots",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    dayKey: text("day_key").notNull(), // YYYY-MM-DD
    spendPaise: integer("spend_paise").notNull().default(0),
    revenuePaise: integer("revenue_paise").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    leadsCount: integer("leads_count").notNull().default(0),
    salesCount: integer("sales_count").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_insight_campaign_day").on(t.campaignId, t.dayKey),
    index("idx_insight_day").on(t.dayKey),
  ]
);

export const scheduledPosts = sqliteTable("scheduled_posts", {
  id: text("id").primaryKey(),
  channel: text("channel").notNull(), // instagram_feed | instagram_reel | facebook_page | google_post
  caption: text("caption").notNull(),
  mediaUrl: text("media_url"),
  mediaType: text("media_type").notNull().default("NONE"), // NONE | IMAGE | VIDEO
  ctaUrl: text("cta_url"),
  ctaType: text("cta_type"), // LEARN_MORE | BOOK | ORDER | SHOP | CALL
  externalPostId: text("external_post_id"),
  externalPermalink: text("external_permalink"),
  lastError: text("last_error"),
  scheduledFor: integer("scheduled_for").notNull(),
  status: text("status").notNull().default("scheduled"), // draft | scheduled | published | failed
  publishedAt: integer("published_at"),
  reachCount: integer("reach_count").notNull().default(0),
  engagementCount: integer("engagement_count").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const pixelEvents = sqliteTable(
  "pixel_events",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().unique(), // deduplication key
    eventName: text("event_name").notNull(), // Purchase | Lead | AddToCart | ViewContent
    valuePaise: integer("value_paise").notNull().default(0),
    currency: text("currency").notNull().default("INR"),
    matchQualityScore: integer("match_quality_score").notNull().default(80), // 0-100
    customerHash: text("customer_hash"),
    sourceUrl: text("source_url"),
    orderRef: text("order_ref"),
    capiStatus: text("capi_status").notNull().default("local_only"), // sent_live | sandbox_simulated | failed | local_only
    capiResponseDetail: text("capi_response_detail"),
    occurredAt: integer("occurred_at").notNull(),
  },
  (t) => [index("idx_pixel_occurred").on(t.occurredAt)]
);

// WhatsApp Business API Templates, Broadcasts, Reminders & Opt-In Proof
export const whatsappTemplates = sqliteTable("whatsapp_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  language: text("language").notNull().default("en_IN"),
  category: text("category").notNull(), // utility | marketing | authentication
  headerType: text("header_type").notNull().default("NONE"), // NONE | TEXT | DOCUMENT | IMAGE
  headerText: text("header_text"),
  bodyText: text("body_text").notNull(),
  footerText: text("footer_text"),
  buttonsJson: text("buttons_json").notNull().default("[]"),
  variablesJson: text("variables_json").notNull().default("[]"),
  variableMappingsJson: text("variable_mappings_json").notNull().default("{}"),
  sampleValuesJson: text("sample_values_json").notNull().default("{}"),
  approvalStatus: text("approval_status").notNull().default("APPROVED"), // DRAFT | PENDING | APPROVED | REJECTED | PAUSED
  metaTemplateId: text("meta_template_id"),
  qualityScore: text("quality_score").notNull().default("GREEN"),
  rejectionReason: text("rejection_reason"),
  lastSyncedAt: integer("last_synced_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull().default(0),
});

// Tally-to-WhatsApp Event Automation Rules (Instant Bill / Receipt Notifications via Worker)
export const tallyAutomationRules = sqliteTable(
  "tally_automation_rules",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    triggerEvent: text("trigger_event").notNull(), // Sales | Receipt | CreditNote | Purchase | All
    templateId: text("template_id")
      .notNull()
      .references(() => whatsappTemplates.id, { onDelete: "cascade" }),
    templateName: text("template_name").notNull(),
    minAmountPaise: integer("min_amount_paise").notNull().default(0),
    delaySeconds: integer("delay_seconds").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    triggeredCount: integer("triggered_count").notNull().default(0),
    lastTriggeredAt: integer("last_triggered_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_tally_auto_event").on(t.triggerEvent, t.active)]
);

export const broadcasts = sqliteTable("broadcasts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  templateId: text("template_id")
    .notNull()
    .references(() => whatsappTemplates.id),
  status: text("status").notNull().default("draft"), // draft | sending | completed | paused | cancelled
  totalRecipients: integer("total_recipients").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  deliveredCount: integer("delivered_count").notNull().default(0),
  readCount: integer("read_count").notNull().default(0),
  repliedCount: integer("replied_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  estimatedCostPaise: integer("estimated_cost_paise").notNull().default(0),
  actualCostPaise: integer("actual_cost_paise").notNull().default(0),
  scheduledAt: integer("scheduled_at"),
  completedAt: integer("completed_at"),
  createdAt: integer("created_at").notNull(),
});

export const optIns = sqliteTable(
  "opt_ins",
  {
    id: text("id").primaryKey(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    phoneE164: text("phone_e164").notNull(),
    channel: text("channel").notNull().default("whatsapp"),
    source: text("source").notNull(), // website_checkout | store_invoice | inbound_whatsapp | manual_written
    evidenceNote: text("evidence_note").notNull(),
    consentedAt: integer("consented_at").notNull(),
  },
  (t) => [uniqueIndex("uq_opt_in_phone_channel").on(t.phoneE164, t.channel)]
);

export const reminderRules = sqliteTable("reminder_rules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  triggerDaysOffset: integer("trigger_days_offset").notNull(), // -3 = 3 days before due, +7 = 7 days overdue
  templateName: text("template_name").notNull(),
  maxRemindersPerBill: integer("max_reminders_per_bill").notNull().default(3),
  quietHoursStart: integer("quiet_hours_start").notNull().default(20), // 8 PM
  quietHoursEnd: integer("quiet_hours_end").notNull().default(9), // 9 AM
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
});

// Tally Prime Sync Mirror
export const tallyCompanies = sqliteTable("tally_companies", {
  id: text("id").primaryKey(),
  companyGuid: text("company_guid").notNull().unique(),
  name: text("name").notNull(),
  financialYearFrom: text("financial_year_from").notNull(),
  lastAlterId: integer("last_alter_id").notNull().default(0),
  lastSyncedAt: integer("last_synced_at"),
  createdAt: integer("created_at").notNull(),
});

export const tallyParties = sqliteTable("tally_parties", {
  id: text("id").primaryKey(),
  partyGuid: text("party_guid").notNull().unique(),
  companyId: text("company_id")
    .notNull()
    .references(() => tallyCompanies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  parentGroup: text("parent_group").notNull().default("Sundry Debtors"),
  phoneE164: text("phone_e164"),
  email: text("email"),
  gstin: text("gstin"),
  pan: text("pan"),
  contactPerson: text("contact_person"),
  stateName: text("state_name"),
  pincode: text("pincode"),
  address: text("address"),
  creditLimitPaise: integer("credit_limit_paise").notNull().default(0),
  creditDays: integer("credit_days").notNull().default(0),
  openingBalancePaise: integer("opening_balance_paise").notNull().default(0),
  closingBalancePaise: integer("closing_balance_paise").notNull().default(0),
  syncedFromTallyMaster: integer("synced_from_tally_master", { mode: "boolean" })
    .notNull()
    .default(false),
  totalInvoicedPaise: integer("total_invoiced_paise").notNull().default(0),
  totalReceivedPaise: integer("total_received_paise").notNull().default(0),
  unpaidBillsCount: integer("unpaid_bills_count").notNull().default(0),
  overdueBillsCount: integer("overdue_bills_count").notNull().default(0),
  lastVoucherAt: integer("last_voucher_at"),
  lastPaymentAt: integer("last_payment_at"),
  updatedAt: integer("updated_at").notNull(),
});

export const tallyGodowns = sqliteTable(
  "tally_godowns",
  {
    id: text("id").primaryKey(),
    godownGuid: text("godown_guid").notNull().unique(),
    companyId: text("company_id")
      .notNull()
      .references(() => tallyCompanies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    parentName: text("parent_name").notNull().default("Primary"),
    address: text("address"),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_tally_godowns_company").on(t.companyId, t.name)]
);

export const tallyStockItems = sqliteTable(
  "tally_stock_items",
  {
    id: text("id").primaryKey(),
    itemGuid: text("item_guid").notNull().unique(),
    masterId: text("master_id"),
    companyId: text("company_id")
      .notNull()
      .references(() => tallyCompanies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    skuCode: text("sku_code"),
    partNumber: text("part_number"),
    stockGroup: text("stock_group").notNull().default("Primary"),
    stockCategory: text("stock_category"),
    uom: text("uom").notNull().default("PCS"),
    hsnCode: text("hsn_code"),
    gstRateBps: integer("gst_rate_bps").notNull().default(1800),
    sellingPricePaise: integer("selling_price_paise").notNull().default(0),
    costPricePaise: integer("cost_price_paise").notNull().default(0),
    openingQty: real("opening_qty").notNull().default(0),
    openingValuePaise: integer("opening_value_paise").notNull().default(0),
    closingQty: real("closing_qty").notNull().default(0),
    closingRatePaise: integer("closing_rate_paise").notNull().default(0),
    closingValuePaise: integer("closing_value_paise").notNull().default(0),
    reorderLevelQty: real("reorder_level_qty").notNull().default(0),
    minOrderQty: real("min_order_qty").notNull().default(0),
    totalSoldQty: real("total_sold_qty").notNull().default(0),
    totalSoldPaise: integer("total_sold_paise").notNull().default(0),
    totalPurchasedQty: real("total_purchased_qty").notNull().default(0),
    totalPurchasedPaise: integer("total_purchased_paise").notNull().default(0),
    lastSoldAt: integer("last_sold_at"),
    lastPurchasedAt: integer("last_purchased_at"),
    syncedFromTallyMaster: integer("synced_from_tally_master", { mode: "boolean" })
      .notNull()
      .default(false),
    alterId: integer("alter_id").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("idx_stock_items_company_group").on(t.companyId, t.stockGroup),
    index("idx_stock_items_company_name").on(t.companyId, t.name),
  ]
);

export const tallyStockBalances = sqliteTable(
  "tally_stock_balances",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => tallyStockItems.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => tallyCompanies.id, { onDelete: "cascade" }),
    godownName: text("godown_name").notNull().default("Main Location"),
    batchName: text("batch_name").notNull().default("Primary Batch"),
    mfgDate: integer("mfg_date"),
    expiryDate: integer("expiry_date"),
    closingQty: real("closing_qty").notNull().default(0),
    closingValuePaise: integer("closing_value_paise").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_stock_balance_loc_batch").on(t.itemId, t.godownName, t.batchName),
    index("idx_stock_balances_company_godown").on(t.companyId, t.godownName),
  ]
);

export const tallyVoucherItems = sqliteTable(
  "tally_voucher_items",
  {
    id: text("id").primaryKey(),
    voucherId: text("voucher_id")
      .notNull()
      .references(() => tallyVouchers.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => tallyCompanies.id, { onDelete: "cascade" }),
    stockItemId: text("stock_item_id").references(() => tallyStockItems.id, {
      onDelete: "set null",
    }),
    itemName: text("item_name").notNull(),
    godownName: text("godown_name").notNull().default("Main Location"),
    batchName: text("batch_name").notNull().default("Primary Batch"),
    hsnCode: text("hsn_code"),
    uom: text("uom").notNull().default("PCS"),
    billedQty: real("billed_qty").notNull().default(0),
    actualQty: real("actual_qty").notNull().default(0),
    ratePaise: integer("rate_paise").notNull().default(0),
    discountBps: integer("discount_bps").notNull().default(0),
    gstRateBps: integer("gst_rate_bps").notNull().default(0),
    amountPaise: integer("amount_paise").notNull().default(0),
    voucherType: text("voucher_type").notNull(),
    voucherDate: integer("voucher_date").notNull(),
    partyName: text("party_name").notNull(),
  },
  (t) => [
    index("idx_voucher_items_vch").on(t.voucherId),
    index("idx_voucher_items_item").on(t.stockItemId, t.voucherDate),
  ]
);

export const tallyVouchers = sqliteTable(
  "tally_vouchers",
  {
    id: text("id").primaryKey(),
    guid: text("guid").notNull().unique(),
    masterId: text("master_id"),
    companyId: text("company_id")
      .notNull()
      .references(() => tallyCompanies.id, { onDelete: "cascade" }),
    voucherNumber: text("voucher_number").notNull(),
    voucherType: text("voucher_type").notNull(), // Sales | Receipt | Payment | CreditNote | DebitNote | Purchase
    partyName: text("party_name").notNull(),
    partyPhoneE164: text("party_phone_e164"),
    amountPaise: integer("amount_paise").notNull(),
    paidAmountPaise: integer("paid_amount_paise").notNull().default(0),
    directPaidPaise: integer("direct_paid_paise").notNull().default(0),
    narration: text("narration"),
    ledgerAccountName: text("ledger_account_name"),
    billAllocationsJson: text("bill_allocations_json").notNull().default("[]"),
    originalCurrency: text("original_currency").notNull().default("INR"),
    originalAmountMinor: integer("original_amount_minor"),
    exchangeRateMicros: integer("exchange_rate_micros"),
    voucherDate: integer("voucher_date").notNull(),
    dueDate: integer("due_date"),
    paymentStatus: text("payment_status").notNull().default("unpaid"), // unpaid | partial | paid | cancelled
    whatsappInvoiceSentAt: integer("whatsapp_invoice_sent_at"),
    remindersSentCount: integer("reminders_sent_count").notNull().default(0),
    alterId: integer("alter_id").notNull().default(1),
    contentHash: text("content_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("idx_vouchers_type_status").on(t.voucherType, t.paymentStatus),
    index("idx_vouchers_due_date").on(t.dueDate),
  ]
);

export const tallyBillSettlements = sqliteTable(
  "tally_bill_settlements",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => tallyCompanies.id, { onDelete: "cascade" }),
    billVoucherId: text("bill_voucher_id")
      .notNull()
      .references(() => tallyVouchers.id, { onDelete: "cascade" }),
    settlementVoucherId: text("settlement_voucher_id").references(() => tallyVouchers.id, {
      onDelete: "cascade",
    }),
    billNumber: text("bill_number").notNull(),
    settlementVoucherNumber: text("settlement_voucher_number"),
    settlementVoucherType: text("settlement_voucher_type").notNull(),
    partyName: text("party_name").notNull(),
    allocationType: text("allocation_type").notNull().default("agst_ref"),
    amountPaise: integer("amount_paise").notNull(),
    settledAt: integer("settled_at").notNull(),
  },
  (t) => [
    index("idx_bill_settlements_bill").on(t.billVoucherId),
    index("idx_bill_settlements_src").on(t.settlementVoucherId),
  ]
);

export const tallyVoucherPdfs = sqliteTable(
  "tally_voucher_pdfs",
  {
    voucherId: text("voucher_id").primaryKey(),
    voucherGuid: text("voucher_guid").notNull(),
    voucherNumber: text("voucher_number").notNull().default(""),
    companyName: text("company_name").notNull().default("Primary Tally Company"),
    filename: text("filename").notNull(),
    pdfBase64: text("pdf_base64").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    alterId: integer("alter_id").notNull().default(0),
    masterId: text("master_id"),
    capturedFrom: text("captured_from").notNull().default("tally_native"),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_tally_voucher_pdfs_guid").on(t.voucherGuid)]
);

export const syncRuns = sqliteTable("sync_runs", {
  id: text("id").primaryKey(),
  companyId: text("company_id"),
  source: text("source").notNull().default("agent"), // agent | manual
  vouchersUpserted: integer("vouchers_upserted").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  status: text("status").notNull().default("success"),
  createdAt: integer("created_at").notNull(),
});

// Transactional Outbox & Tenant Settings
export const outbox = sqliteTable(
  "outbox",
  {
    id: text("id").primaryKey(),
    queueName: text("queue_name").notNull(),
    jobType: text("job_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    envelopeJson: text("envelope_json").notNull(),
    status: text("status").notNull().default("pending"), // pending | processing | enqueued | completed | failed
    attempts: integer("attempts").notNull().default(0),
    nextRunAt: integer("next_run_at").notNull(),
    lockedAt: integer("locked_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_outbox_status_next").on(t.status, t.nextRunAt)]
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const schemaMeta = sqliteTable("schema_meta", {
  version: integer("version").primaryKey(),
  appliedAt: integer("applied_at").notNull(),
});
