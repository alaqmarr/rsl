import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

// Identity
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  jobTitle: text("job_title"),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  passwordHash: text("password_hash"),
  totpSecretEncrypted: text("totp_secret_encrypted"),
  totpEnabled: integer("totp_enabled", { mode: "boolean" }).notNull().default(false),
  activeWorkspaceId: text("active_workspace_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    activeWorkspaceId: text("active_workspace_id"),
    impersonatorStaffId: text("impersonator_staff_id"),
    impersonationReason: text("impersonation_reason"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_sessions_user").on(t.userId)]
);

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  providerId: text("provider_id").notNull(),
  accountId: text("account_id").notNull(),
  accessTokenEncrypted: text("access_token_encrypted"),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  expiresAt: integer("expires_at"),
  createdAt: integer("created_at").notNull(),
});

export const verifications = sqliteTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  valueHash: text("value_hash").notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const platformStaff = sqliteTable("platform_staff", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  staffRole: text("staff_role").notNull(), // super_admin | support | finance
  totpEnabled: integer("totp_enabled", { mode: "boolean" }).notNull().default(false),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
});

export const platformStaffSessions = sqliteTable("platform_staff_sessions", {
  id: text("id").primaryKey(),
  staffId: text("staff_id")
    .notNull()
    .references(() => platformStaff.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

// Tenancy & RBAC
export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(), // 26-char ULID
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  industry: text("industry"),
  businessPhone: text("business_phone"),
  billingEmail: text("billing_email"),
  website: text("website"),
  addressLine: text("address_line"),
  city: text("city"),
  pincode: text("pincode"),
  defaultTallyCompany: text("default_tally_company"),
  webhookVerifyToken: text("webhook_verify_token"),
  gstin: text("gstin"),
  upiVpa: text("upi_vpa"),
  upiPayeeName: text("upi_payee_name"),
  bankName: text("bank_name"),
  bankBranch: text("bank_branch"),
  bankAccountNumber: text("bank_account_number"),
  bankIfsc: text("bank_ifsc"),
  stateCode: text("state_code").notNull().default("27"), // e.g. 27 = Maharashtra
  currency: text("currency").notNull().default("INR"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  billingStatus: text("billing_status").notNull().default("active"), // trialing | active | past_due | suspended | cancelled
  mode: text("mode").notNull().default("live"), // live | test
  ownerUserId: text("owner_user_id").notNull(),
  freeAccessUntil: integer("free_access_until"),
  freeAccessNote: text("free_access_note"),
  freeAccessGrantedBy: text("free_access_granted_by"),
  autoBillingReminders: integer("auto_billing_reminders", { mode: "boolean" }).notNull().default(true),
  allowManualCredentials: integer("allow_manual_credentials", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const roles = sqliteTable("roles", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id"), // null = system built-in role
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    id: text("id").primaryKey(),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
  },
  (t) => [uniqueIndex("uq_role_permission").on(t.roleId, t.permission)]
);

export const memberships = sqliteTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleSlug: text("role_slug").notNull(),
    assetScopeJson: text("asset_scope_json"), // null = all assets, JSON array of asset IDs otherwise
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("uq_membership_workspace_user").on(t.workspaceId, t.userId)]
);

export const invitations = sqliteTable("invitations", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  roleSlug: text("role_slug").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  invitedByUserId: text("invited_by_user_id").notNull(),
  status: text("status").notNull().default("pending"), // pending | accepted | expired | revoked
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const tenantRegistry = sqliteTable("tenant_registry", {
  tenantId: text("tenant_id").primaryKey(), // matches workspaces.id
  host: text("host").notNull().default("local"),
  dataDbPath: text("data_db_path").notNull(),
  logsDbPath: text("logs_db_path").notNull(),
  status: text("status").notNull().default("active"), // active | restoring | migrating | suspended | migration_failed | deleted
  dataSchemaVersion: integer("data_schema_version").notNull().default(1),
  logsSchemaVersion: integer("logs_schema_version").notNull().default(1),
  dataSizeBytes: integer("data_size_bytes").notNull().default(0),
  logsSizeBytes: integer("logs_size_bytes").notNull().default(0),
  lastBackupAt: integer("last_backup_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const assetRouting = sqliteTable(
  "asset_routing",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(), // meta | whatsapp | google | tally
    externalId: text("external_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("uq_asset_routing_provider_ext").on(t.provider, t.externalId)]
);

// Billing, Entitlements & Wallet Ledger
export const services = sqliteTable("services", {
  key: text("key").primaryKey(), // e.g. inbox, whatsapp.messaging, tally.sync
  name: text("name").notNull(),
  plainSummary: text("plain_summary").notNull(),
  category: text("category").notNull(),
  dependsOnJson: text("depends_on_json").notNull().default("[]"),
  pricingModel: text("pricing_model").notNull(), // flat_monthly | per_seat | usage | wallet_plus_monthly
  meteredUnit: text("metered_unit").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const servicePrices = sqliteTable("service_prices", {
  id: text("id").primaryKey(),
  serviceKey: text("service_key")
    .notNull()
    .references(() => services.key, { onDelete: "cascade" }),
  currency: text("currency").notNull().default("INR"),
  monthlyAmountPaise: integer("monthly_amount_paise").notNull(),
  quarterlyAmountPaise: integer("quarterly_amount_paise"),
  yearlyAmountPaise: integer("yearly_amount_paise"),
  unitAmountPaise: integer("unit_amount_paise").notNull().default(0),
  includedUnits: integer("included_units").notNull().default(0),
  effectiveFrom: integer("effective_from").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const entitlements = sqliteTable(
  "entitlements",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    serviceKey: text("service_key")
      .notNull()
      .references(() => services.key),
    status: text("status").notNull().default("active"), // trialing | active | past_due | suspended | cancelled
    billingCycle: text("billing_cycle").notNull().default("monthly"), // monthly | quarterly | yearly
    limitOverride: integer("limit_override"),
    priceOverridePaise: integer("price_override_paise"),
    quarterlyOverridePaise: integer("quarterly_override_paise"),
    yearlyOverridePaise: integer("yearly_override_paise"),
    bundleKey: text("bundle_key"),
    activatedAt: integer("activated_at").notNull(),
    expiresAt: integer("expires_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("uq_entitlement_workspace_service").on(t.workspaceId, t.serviceKey)]
);

export const subscriptions = sqliteTable("subscriptions", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("razorpay"),
  externalSubscriptionId: text("external_subscription_id"),
  status: text("status").notNull().default("active"),
  currentPeriodStart: integer("current_period_start").notNull(),
  currentPeriodEnd: integer("current_period_end").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const invoices = sqliteTable("invoices", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  invoiceNumber: text("invoice_number").notNull().unique(), // sequential GST invoice e.g. RSL/26-27/0001, ADV/26-27/0001, CN/26-27/0001
  docType: text("doc_type").notNull().default("tax_invoice"), // tax_invoice | advance_receipt | credit_note
  linkedInvoiceId: text("linked_invoice_id"),
  externalRefKey: text("external_ref_key"),
  financialYear: text("financial_year").notNull(),
  description: text("description").notNull(),
  subtotalPaise: integer("subtotal_paise").notNull(),
  cgstPaise: integer("cgst_paise").notNull().default(0),
  sgstPaise: integer("sgst_paise").notNull().default(0),
  igstPaise: integer("igst_paise").notNull().default(0),
  totalPaise: integer("total_paise").notNull(),
  currency: text("currency").notNull().default("INR"),
  hsnSac: text("hsn_sac").notNull().default("998314"),
  status: text("status").notNull().default("paid"), // draft | issued | paid | void | credit_note
  issuedAt: integer("issued_at").notNull(),
  paidAt: integer("paid_at"),
});

export const invoiceSequences = sqliteTable(
  "invoice_sequences",
  {
    seriesKey: text("series_key").primaryKey(), // e.g. tax_invoice:26-27 | advance_receipt:26-27 | credit_note:26-27
    lastValue: integer("last_value").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  }
);

export const payments = sqliteTable("payments", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  invoiceId: text("invoice_id"),
  provider: text("provider").notNull().default("razorpay"),
  externalOrderId: text("external_order_id"),
  externalPaymentId: text("external_payment_id"),
  amountPaise: integer("amount_paise").notNull(),
  currency: text("currency").notNull().default("INR"),
  purpose: text("purpose").notNull(), // wallet_topup | plan_activation | invoice_payment
  status: text("status").notNull(), // pending | captured | failed | refunded
  createdAt: integer("created_at").notNull(),
});

export const ledgerEntries = sqliteTable(
  "ledger_entries",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    entryType: text("entry_type").notNull(), // credit | debit | reserve | release | refund | staff_adjustment
    amountPaise: integer("amount_paise").notNull(), // positive for credit/release/refund, negative for debit/reserve
    debitAccount: text("debit_account").notNull().default("customer_wallet"),
    creditAccount: text("credit_account").notNull().default("platform_clearing"),
    currency: text("currency").notNull().default("INR"),
    serviceKey: text("service_key"),
    description: text("description").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    actorId: text("actor_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_ledger_workspace_idempotency").on(t.workspaceId, t.idempotencyKey),
    index("idx_ledger_workspace_ts").on(t.workspaceId, t.createdAt),
  ]
);

export const usageEvents = sqliteTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    serviceKey: text("service_key").notNull(),
    quantity: integer("quantity").notNull(),
    costPaise: integer("cost_paise").notNull().default(0),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("uq_usage_workspace_dedupe").on(t.workspaceId, t.dedupeKey)]
);

// Connections & Encrypted Token Vault
export const connections = sqliteTable("connections", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // meta | whatsapp | google | gdrive
  displayName: text("display_name").notNull(),
  externalAccountId: text("external_account_id").notNull(),
  encryptedTokens: text("encrypted_tokens").notNull(), // AES-256-GCM envelope
  scopesGrantedJson: text("scopes_granted_json").notNull().default("[]"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  status: text("status").notNull().default("healthy"), // healthy | expiring | needs_reauth | revoked | under_scoped
  lastHealthCheckAt: integer("last_health_check_at"),
  expiresAt: integer("expires_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  connectionId: text("connection_id")
    .notNull()
    .references(() => connections.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  assetType: text("asset_type").notNull(), // fb_page | ig_account | ad_account | pixel | waba_phone | gbp_location
  externalId: text("external_id").notNull(),
  name: text("name").notNull(),
  metadataJson: text("metadata_json").notNull().default("{}"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
});

// Public API Keys, Tally Devices, Backups, Flags
export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mode: text("mode").notNull().default("live"), // live | test
    prefix: text("prefix").notNull(), // 8-char lookup prefix
    secretHash: text("secret_hash").notNull(),
    scopesJson: text("scopes_json").notNull().default("[]"),
    rateLimitPerMin: integer("rate_limit_per_min").notNull().default(120),
    createdByUserId: text("created_by_user_id").notNull(),
    lastUsedAt: integer("last_used_at"),
    lastUsedIp: text("last_used_ip"),
    expiresAt: integer("expires_at"),
    revokedAt: integer("revoked_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_api_keys_prefix").on(t.prefix)]
);

export const agentPairingCodes = sqliteTable("agent_pairing_codes", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull().unique(),
  displayHint: text("display_hint").notNull(),
  expiresAt: integer("expires_at").notNull(),
  consumedAt: integer("consumed_at"),
  createdByUserId: text("created_by_user_id").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const agentDevices = sqliteTable("agent_devices", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  deviceName: text("device_name").notNull(),
  osVersion: text("os_version"),
  agentVersion: text("agent_version").notNull(),
  signingSecretEncrypted: text("signing_secret_encrypted").notNull(),
  status: text("status").notNull().default("online"), // online | offline | revoked
  tallyReachable: integer("tally_reachable", { mode: "boolean" }).notNull().default(false),
  tallyHost: text("tally_host").notNull().default("127.0.0.1"),
  tallyPort: integer("tally_port").notNull().default(9000),
  activeCompanyName: text("active_company_name"),
  lastAlterId: integer("last_alter_id").notNull().default(0),
  lastHeartbeatAt: integer("last_heartbeat_at"),
  lastSyncAt: integer("last_sync_at"),
  lastErrorMessage: text("last_error_message"),
  revokedAt: integer("revoked_at"),
  createdAt: integer("created_at").notNull(),
});

export const backupDestinations = sqliteTable("backup_destinations", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  provider: text("provider").notNull(), // local_vault | s3 | r2 | gdrive | s3_compatible
  encryptedConfig: text("encrypted_config").notNull(),
  schedule: text("schedule").notNull().default("daily"), // manual | daily | weekly | monthly
  retentionCount: integer("retention_count").notNull().default(7),
  encryptionMode: text("encryption_mode").notNull().default("platform"), // platform | customer_key
  customerPublicKey: text("customer_public_key"),
  status: text("status").notNull().default("healthy"), // healthy | degraded
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastValidatedAt: integer("last_validated_at"),
  createdAt: integer("created_at").notNull(),
});

export const providerRequests = sqliteTable("provider_requests", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  providerName: text("provider_name").notNull(),
  providerUrl: text("provider_url"),
  urgency: text("urgency").notNull().default("normal"),
  contactEmail: text("contact_email").notNull(),
  status: text("status").notNull().default("submitted"), // submitted | reviewing | enabled | custom_quoted
  createdAt: integer("created_at").notNull(),
});

export const featureFlags = sqliteTable("feature_flags", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
  enabledGlobal: integer("enabled_global", { mode: "boolean" }).notNull().default(false),
  workspaceAllowlistJson: text("workspace_allowlist_json").notNull().default("[]"),
  updatedAt: integer("updated_at").notNull(),
});

// Rollups, Anchors & Docs Telemetry
export const tenantMetrics = sqliteTable(
  "tenant_metrics",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    dayKey: text("day_key").notNull(), // YYYY-MM-DD
    contactsCount: integer("contacts_count").notNull().default(0),
    messagesCount: integer("messages_count").notNull().default(0),
    vouchersCount: integer("vouchers_count").notNull().default(0),
    dataSizeBytes: integer("data_size_bytes").notNull().default(0),
    logsSizeBytes: integer("logs_size_bytes").notNull().default(0),
    walletBalancePaise: integer("wallet_balance_paise").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("uq_tenant_metrics_day").on(t.tenantId, t.dayKey)]
);

export const tenantHealth = sqliteTable("tenant_health", {
  tenantId: text("tenant_id").primaryKey(),
  errorRate24h: integer("error_rate_24h_bps").notNull().default(0), // basis points
  failedJobs24h: integer("failed_jobs_24h").notNull().default(0),
  unhealthyConnections: integer("unhealthy_connections").notNull().default(0),
  status: text("status").notNull().default("healthy"), // healthy | warning | critical
  updatedAt: integer("updated_at").notNull(),
});

export const logAnchors = sqliteTable(
  "log_anchors",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    dayKey: text("day_key").notNull(), // YYYY-MM-DD
    finalHash: text("final_hash").notNull(),
    rowCount: integer("row_count").notNull(),
    anchoredAt: integer("anchored_at").notNull(),
  },
  (t) => [uniqueIndex("uq_log_anchor_tenant_day").on(t.tenantId, t.dayKey)]
);

export const docsFeedback = sqliteTable("docs_feedback", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  helpful: integer("helpful", { mode: "boolean" }).notNull(),
  comment: text("comment"),
  workspaceId: text("workspace_id"),
  createdAt: integer("created_at").notNull(),
});

export const docsSearchLogs = sqliteTable("docs_search_logs", {
  id: text("id").primaryKey(),
  query: text("query").notNull(),
  resultCount: integer("result_count").notNull(),
  surface: text("surface").notNull(), // public | help | admin
  createdAt: integer("created_at").notNull(),
});

// Dual-Mode Storage (RSL Managed Paid R2 vs Client's Personal Cloudflare R2 / S3) & Seamless Migrations
export const storageConfigurations = sqliteTable("storage_configurations", {
  workspaceId: text("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  mode: text("mode").notNull().default("rsl_managed"), // rsl_managed | client_r2 | client_s3
  displayLabel: text("display_label").notNull().default("RSL Managed Cloud Vault"),
  endpointUrl: text("endpoint_url"),
  bucketName: text("bucket_name"),
  region: text("region").default("auto"),
  encryptedCredentials: text("encrypted_credentials"), // AES-256-GCM wrapped R2/S3 keys when client_byo
  usedBytes: integer("used_bytes").notNull().default(0),
  objectCount: integer("object_count").notNull().default(0),
  status: text("status").notNull().default("healthy"),
  lastVerifiedAt: integer("last_verified_at"),
  updatedAt: integer("updated_at").notNull(),
});

export const storageObjects = sqliteTable(
  "storage_objects",
  {
    id: text("id").primaryKey(), // e.g. ast_shreegan_...
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    category: text("category").notNull(), // tally_pdf | backup_archive | media | export | gst_invoice
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    storageMode: text("storage_mode").notNull(), // rsl_managed | client_r2 | client_s3
    objectKey: text("object_key").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_storage_objects_ws").on(t.workspaceId, t.createdAt)]
);

export const storageMigrations = sqliteTable("storage_migrations", {
  id: text("id").primaryKey(), // mig_<client>_...
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  fromMode: text("from_mode").notNull(),
  toMode: text("to_mode").notNull(),
  totalObjects: integer("total_objects").notNull().default(0),
  copiedObjects: integer("copied_objects").notNull().default(0),
  bytesTransferred: integer("bytes_transferred").notNull().default(0),
  status: text("status").notNull().default("completed"), // running | completed | failed
  errorMessage: text("error_message"),
  startedAt: integer("started_at").notNull(),
  completedAt: integer("completed_at"),
});

// Nodemailer + Gmail SMTP Email Delivery & Preview Log
export const emailDeliveries = sqliteTable(
  "email_deliveries",
  {
    id: text("id").primaryKey(), // eml_<client>_...
    workspaceId: text("workspace_id"),
    recipientEmail: text("recipient_email").notNull(),
    templateKey: text("template_key").notNull(), // email_verification | password_reset | team_invite | billing_alert | backup_report
    subject: text("subject").notNull(),
    renderedHtml: text("rendered_html").notNull(),
    transportMode: text("transport_mode").notNull(), // gmail_smtp | client_smtp | local_outbox
    status: text("status").notNull(), // sent | queued_local | failed
    messageId: text("message_id"),
    errorMessage: text("error_message"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_email_deliveries_ts").on(t.createdAt)]
);

// Tally Prime Instant Webhook Routing & Outbound Customer Webhooks
export const tallyWebhookEndpoints = sqliteTable(
  "tally_webhook_endpoints",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    webhookToken: text("webhook_token").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    eventsReceivedCount: integer("events_received_count").notNull().default(0),
    pingsReceivedCount: integer("pings_received_count").notNull().default(0),
    lastEventAt: integer("last_event_at"),
    lastPingAt: integer("last_ping_at"),
    lastSourceIp: text("last_source_ip"),
    lastUserAgent: text("last_user_agent"),
    lastErrorAt: integer("last_error_at"),
    lastErrorMessage: text("last_error_message"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_tally_webhook_workspace").on(t.workspaceId),
    uniqueIndex("uq_tally_webhook_token").on(t.webhookToken),
  ]
);

export const outboundWebhookEndpoints = sqliteTable(
  "outbound_webhook_endpoints",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    targetUrl: text("target_url").notNull(),
    signingSecret: text("signing_secret").notNull(),
    eventsJson: text("events_json").notNull().default('["*"]'),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    lastDeliveryStatus: text("last_delivery_status"),
    lastDeliveredAt: integer("last_delivered_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_outbound_webhooks_ws").on(t.workspaceId)]
);

// Customer Plan & Feature Activation Requests (Unlocked ONLY after Staff records payment)
export const servicePlanRequests = sqliteTable(
  "service_plan_requests",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    serviceKey: text("service_key")
      .notNull()
      .references(() => services.key),
    requestedByUserId: text("requested_by_user_id").notNull(),
    billingCycle: text("billing_cycle").notNull().default("monthly"), // monthly | quarterly | yearly
    quotedMonthlyPaise: integer("quoted_monthly_paise").notNull(),
    quotedCyclePaise: integer("quoted_cycle_paise"),
    quotedUnitPaise: integer("quoted_unit_paise").notNull().default(0),
    bundleKey: text("bundle_key"),
    bundleName: text("bundle_name"),
    includedKeysJson: text("included_keys_json"),
    customerNote: text("customer_note"),
    customerPaymentRef: text("customer_payment_ref"),
    status: text("status").notNull().default("pending_payment"), // pending_payment | activated | declined | revoked
    paymentId: text("payment_id"),
    invoiceId: text("invoice_id"),
    amountPaidPaise: integer("amount_paid_paise"),
    paymentMethod: text("payment_method"), // upi | bank_transfer | razorpay | cash | cheque
    paymentReference: text("payment_reference"),
    staffNotes: text("staff_notes"),
    reviewedByStaffId: text("reviewed_by_staff_id"),
    reviewedAt: integer("reviewed_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("idx_plan_requests_ws").on(t.workspaceId, t.status),
    index("idx_plan_requests_status").on(t.status, t.createdAt),
  ]
);

export const planBundles = sqliteTable(
  "plan_bundles",
  {
    key: text("key").primaryKey(),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tagline: text("tagline").notNull(),
    description: text("description").notNull(),
    includedKeysJson: text("included_keys_json").notNull().default("[]"),
    monthlyAmountPaise: integer("monthly_amount_paise").notNull(),
    quarterlyAmountPaise: integer("quarterly_amount_paise").notNull(),
    yearlyAmountPaise: integer("yearly_amount_paise").notNull(),
    badgeLabel: text("badge_label"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_plan_bundles_ws").on(t.workspaceId, t.active)]
);

export const clientBundleOverrides = sqliteTable(
  "client_bundle_overrides",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    bundleKey: text("bundle_key")
      .notNull()
      .references(() => planBundles.key, { onDelete: "cascade" }),
    customName: text("custom_name"),
    includedKeysJson: text("included_keys_json"),
    monthlyOverridePaise: integer("monthly_override_paise"),
    quarterlyOverridePaise: integer("quarterly_override_paise"),
    yearlyOverridePaise: integer("yearly_override_paise"),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("uq_client_bundle_override").on(t.workspaceId, t.bundleKey)]
);

export const billingReminderLogs = sqliteTable(
  "billing_reminder_logs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    reminderStage: text("reminder_stage").notNull(), // upcoming_7d | due_soon_1d | overdue | manual
    billingCycle: text("billing_cycle").notNull().default("monthly"),
    targetSummary: text("target_summary").notNull(),
    dueAt: integer("due_at").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    emailId: text("email_id"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_billing_reminders_ws").on(t.workspaceId, t.createdAt)]
);

// Database-Controlled Platform Credentials & OAuth Vault (Super Admin managed)
export const platformCredentials = sqliteTable("platform_credentials", {
  providerKey: text("provider_key").primaryKey(), // google_oauth | smtp_email | cloudflare_r2 | meta_app | razorpay
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  publicConfigJson: text("public_config_json").notNull().default("{}"),
  encryptedSecrets: text("encrypted_secrets").notNull().default(""), // AES-256-GCM envelope via encryptEnvelope()
  maskedHintsJson: text("masked_hints_json").notNull().default("{}"),
  updatedByStaffId: text("updated_by_staff_id"),
  lastVerifiedAt: integer("last_verified_at"),
  lastVerifyStatus: text("last_verify_status"), // healthy | error
  lastVerifyMessage: text("last_verify_message"),
  updatedAt: integer("updated_at").notNull(),
});

export const sslCertificates = sqliteTable(
  "ssl_certificates",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    workspaceSlug: text("workspace_slug").notNull(),
    zone: text("zone").notNull(), // tally | api
    hostname: text("hostname").notNull().unique(),
    wildcardParent: text("wildcard_parent").notNull(),
    status: text("status").notNull().default("queued"), // queued | provisioning | active | renewing | failed
    provider: text("provider").notNull().default("auto"),
    coverageMode: text("coverage_mode").notNull().default("wildcard_san"),
    serialHex: text("serial_hex"),
    fingerprintSha256: text("fingerprint_sha256"),
    certPath: text("cert_path"),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: integer("last_attempt_at"),
    issuedAt: integer("issued_at"),
    expiresAt: integer("expires_at"),
    renewAfter: integer("renew_after"),
    lastError: text("last_error"),
    queuedAt: integer("queued_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("idx_ssl_certs_workspace").on(t.workspaceId),
    index("idx_ssl_certs_status_renew").on(t.status, t.renewAfter),
  ]
);

// Isolated 0-Overdraft RSL Managed Ad Spend Vault Ledger (strictly separate from customer_wallet)
export const adSpendLedger = sqliteTable(
  "ad_spend_ledger",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    entryType: text("entry_type").notNull(), // deposit | allocate | release | refund | staff_adjustment
    amountPaise: integer("amount_paise").notNull(), // positive = deposit/release/refund, negative = allocate/adjustment
    currency: text("currency").notNull().default("INR"),
    provider: text("provider").notNull().default("vault"), // vault | meta_ads | google_ads
    campaignId: text("campaign_id"),
    externalCampaignId: text("external_campaign_id"),
    paymentId: text("payment_id"),
    description: text("description").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    actorId: text("actor_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_ad_spend_ledger_idempotency").on(t.workspaceId, t.idempotencyKey),
    index("idx_ad_spend_ledger_ws_ts").on(t.workspaceId, t.createdAt),
    index("idx_ad_spend_ledger_campaign").on(t.workspaceId, t.campaignId),
  ]
);

// W3C WebAuthn Passkeys (Windows Hello, Touch ID, Android Biometrics)
export const userPasskeys = sqliteTable(
  "user_passkeys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull().unique(),
    publicKeySpki: text("public_key_spki").notNull(),
    algorithm: integer("algorithm").notNull().default(-7), // -7 = ES256, -257 = RS256
    signCount: integer("sign_count").notNull().default(0),
    transportsJson: text("transports_json").notNull().default("[]"),
    deviceLabel: text("device_label").notNull().default("Passkey"),
    lastUsedAt: integer("last_used_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_user_passkeys_user").on(t.userId)]
);

// W3C Web Push (VAPID) Browser & Mobile PWA Subscriptions
export const webPushSubscriptions = sqliteTable(
  "web_push_subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dhKey: text("p256dh_key").notNull(),
    authKey: text("auth_key").notNull(),
    userAgent: text("user_agent"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    lastDeliveredAt: integer("last_delivered_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_web_push_ws_active").on(t.workspaceId, t.active),
    index("idx_web_push_user").on(t.userId),
  ]
);




