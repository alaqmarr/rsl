import type Database from "better-sqlite3";

export function applyConnectionPragmas(db: Database.Database, kind: "control" | "standard"): void {
  db.pragma("journal_mode = WAL");
  db.pragma(`synchronous = ${kind === "control" ? "FULL" : "NORMAL"}`);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("trusted_schema = OFF");
  db.pragma("journal_size_limit = 67108864");
  db.pragma("wal_autocheckpoint = 1000");
  db.pragma("temp_store = MEMORY");
}

export interface SqlMigration {
  version: number;
  name: string;
  sql: string;
}

export const CONTROL_MIGRATIONS: SqlMigration[] = [
  {
    version: 1,
    name: "0001_control_initial",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        email_verified INTEGER NOT NULL DEFAULT 0,
        password_hash TEXT,
        totp_secret_encrypted TEXT,
        totp_enabled INTEGER NOT NULL DEFAULT 0,
        active_workspace_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        active_workspace_id TEXT,
        impersonator_staff_id TEXT,
        impersonation_reason TEXT,
        ip_address TEXT,
        user_agent TEXT,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        access_token_encrypted TEXT,
        refresh_token_encrypted TEXT,
        expires_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS verifications (
        id TEXT PRIMARY KEY,
        identifier TEXT NOT NULL,
        value_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS platform_staff (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        staff_role TEXT NOT NULL,
        totp_enabled INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS platform_staff_sessions (
        id TEXT PRIMARY KEY,
        staff_id TEXT NOT NULL REFERENCES platform_staff(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        ip_address TEXT,
        user_agent TEXT,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        industry TEXT,
        gstin TEXT,
        state_code TEXT NOT NULL DEFAULT '27',
        currency TEXT NOT NULL DEFAULT 'INR',
        timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
        billing_status TEXT NOT NULL DEFAULT 'active',
        mode TEXT NOT NULL DEFAULT 'live',
        owner_user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        workspace_id TEXT,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        is_system INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS role_permissions (
        id TEXT PRIMARY KEY,
        role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_role_permission ON role_permissions(role_id, permission);

      CREATE TABLE IF NOT EXISTS memberships (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_slug TEXT NOT NULL,
        asset_scope_json TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_workspace_user ON memberships(workspace_id, user_id);

      CREATE TABLE IF NOT EXISTS invitations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        role_slug TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        invited_by_user_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tenant_registry (
        tenant_id TEXT PRIMARY KEY,
        host TEXT NOT NULL DEFAULT 'local',
        data_db_path TEXT NOT NULL,
        logs_db_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        data_schema_version INTEGER NOT NULL DEFAULT 1,
        logs_schema_version INTEGER NOT NULL DEFAULT 1,
        data_size_bytes INTEGER NOT NULL DEFAULT 0,
        logs_size_bytes INTEGER NOT NULL DEFAULT 0,
        last_backup_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS asset_routing (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        external_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_routing_provider_ext ON asset_routing(provider, external_id);

      CREATE TABLE IF NOT EXISTS services (
        key TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        plain_summary TEXT NOT NULL,
        category TEXT NOT NULL,
        depends_on_json TEXT NOT NULL DEFAULT '[]',
        pricing_model TEXT NOT NULL,
        metered_unit TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS service_prices (
        id TEXT PRIMARY KEY,
        service_key TEXT NOT NULL REFERENCES services(key) ON DELETE CASCADE,
        currency TEXT NOT NULL DEFAULT 'INR',
        monthly_amount_paise INTEGER NOT NULL,
        unit_amount_paise INTEGER NOT NULL DEFAULT 0,
        included_units INTEGER NOT NULL DEFAULT 0,
        effective_from INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS entitlements (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        service_key TEXT NOT NULL REFERENCES services(key),
        status TEXT NOT NULL DEFAULT 'active',
        limit_override INTEGER,
        price_override_paise INTEGER,
        activated_at INTEGER NOT NULL,
        expires_at INTEGER,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_entitlement_workspace_service ON entitlements(workspace_id, service_key);

      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        provider TEXT NOT NULL DEFAULT 'razorpay',
        external_subscription_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        current_period_start INTEGER NOT NULL,
        current_period_end INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        invoice_number TEXT NOT NULL UNIQUE,
        financial_year TEXT NOT NULL,
        description TEXT NOT NULL,
        subtotal_paise INTEGER NOT NULL,
        cgst_paise INTEGER NOT NULL DEFAULT 0,
        sgst_paise INTEGER NOT NULL DEFAULT 0,
        igst_paise INTEGER NOT NULL DEFAULT 0,
        total_paise INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'INR',
        hsn_sac TEXT NOT NULL DEFAULT '998314',
        status TEXT NOT NULL DEFAULT 'paid',
        issued_at INTEGER NOT NULL,
        paid_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        invoice_id TEXT,
        provider TEXT NOT NULL DEFAULT 'razorpay',
        external_order_id TEXT,
        external_payment_id TEXT,
        amount_paise INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'INR',
        purpose TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ledger_entries (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        entry_type TEXT NOT NULL,
        amount_paise INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'INR',
        service_key TEXT,
        description TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_workspace_idempotency ON ledger_entries(workspace_id, idempotency_key);
      CREATE INDEX IF NOT EXISTS idx_ledger_workspace_ts ON ledger_entries(workspace_id, created_at);

      CREATE TRIGGER IF NOT EXISTS trg_ledger_entries_no_update
      BEFORE UPDATE ON ledger_entries
      BEGIN
        SELECT RAISE(ABORT, 'Ledger entries are append-only and cannot be modified');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_ledger_entries_no_delete
      BEFORE DELETE ON ledger_entries
      BEGIN
        SELECT RAISE(ABORT, 'Ledger entries are append-only and cannot be deleted');
      END;

      CREATE TABLE IF NOT EXISTS usage_events (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        service_key TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        cost_paise INTEGER NOT NULL DEFAULT 0,
        dedupe_key TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_workspace_dedupe ON usage_events(workspace_id, dedupe_key);

      CREATE TABLE IF NOT EXISTS connections (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        display_name TEXT NOT NULL,
        external_account_id TEXT NOT NULL,
        encrypted_tokens TEXT NOT NULL,
        scopes_granted_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'healthy',
        last_health_check_at INTEGER,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        external_id TEXT NOT NULL,
        name TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'live',
        prefix TEXT NOT NULL,
        secret_hash TEXT NOT NULL,
        scopes_json TEXT NOT NULL DEFAULT '[]',
        rate_limit_per_min INTEGER NOT NULL DEFAULT 120,
        created_by_user_id TEXT NOT NULL,
        last_used_at INTEGER,
        last_used_ip TEXT,
        expires_at INTEGER,
        revoked_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(prefix);

      CREATE TABLE IF NOT EXISTS agent_pairing_codes (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL UNIQUE,
        display_hint TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER,
        created_by_user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_devices (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        device_name TEXT NOT NULL,
        os_version TEXT,
        agent_version TEXT NOT NULL,
        signing_secret_encrypted TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'online',
        last_heartbeat_at INTEGER,
        revoked_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS backup_destinations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        encrypted_config TEXT NOT NULL,
        schedule TEXT NOT NULL DEFAULT 'daily',
        retention_count INTEGER NOT NULL DEFAULT 7,
        encryption_mode TEXT NOT NULL DEFAULT 'platform',
        customer_public_key TEXT,
        status TEXT NOT NULL DEFAULT 'healthy',
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_validated_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS provider_requests (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        provider_name TEXT NOT NULL,
        provider_url TEXT,
        urgency TEXT NOT NULL DEFAULT 'normal',
        contact_email TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'submitted',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS feature_flags (
        key TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        enabled_global INTEGER NOT NULL DEFAULT 0,
        workspace_allowlist_json TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tenant_metrics (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        day_key TEXT NOT NULL,
        contacts_count INTEGER NOT NULL DEFAULT 0,
        messages_count INTEGER NOT NULL DEFAULT 0,
        vouchers_count INTEGER NOT NULL DEFAULT 0,
        data_size_bytes INTEGER NOT NULL DEFAULT 0,
        logs_size_bytes INTEGER NOT NULL DEFAULT 0,
        wallet_balance_paise INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_metrics_day ON tenant_metrics(tenant_id, day_key);

      CREATE TABLE IF NOT EXISTS tenant_health (
        tenant_id TEXT PRIMARY KEY,
        error_rate_24h_bps INTEGER NOT NULL DEFAULT 0,
        failed_jobs_24h INTEGER NOT NULL DEFAULT 0,
        unhealthy_connections INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'healthy',
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS log_anchors (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        day_key TEXT NOT NULL,
        final_hash TEXT NOT NULL,
        row_count INTEGER NOT NULL,
        anchored_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_log_anchor_tenant_day ON log_anchors(tenant_id, day_key);

      CREATE TABLE IF NOT EXISTS docs_feedback (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL,
        helpful INTEGER NOT NULL,
        comment TEXT,
        workspace_id TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS docs_search_logs (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        result_count INTEGER NOT NULL,
        surface TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS storage_configurations (
        workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        mode TEXT NOT NULL DEFAULT 'rsl_managed',
        display_label TEXT NOT NULL DEFAULT 'RSL Managed Cloud Vault',
        endpoint_url TEXT,
        bucket_name TEXT,
        region TEXT DEFAULT 'auto',
        encrypted_credentials TEXT,
        used_bytes INTEGER NOT NULL DEFAULT 0,
        object_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'healthy',
        last_verified_at INTEGER,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS storage_objects (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        checksum_sha256 TEXT NOT NULL,
        storage_mode TEXT NOT NULL,
        object_key TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_storage_objects_ws ON storage_objects(workspace_id, created_at);

      CREATE TABLE IF NOT EXISTS storage_migrations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        from_mode TEXT NOT NULL,
        to_mode TEXT NOT NULL,
        total_objects INTEGER NOT NULL DEFAULT 0,
        copied_objects INTEGER NOT NULL DEFAULT 0,
        bytes_transferred INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'completed',
        error_message TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS email_deliveries (
        id TEXT PRIMARY KEY,
        workspace_id TEXT,
        recipient_email TEXT NOT NULL,
        template_key TEXT NOT NULL,
        subject TEXT NOT NULL,
        rendered_html TEXT NOT NULL,
        transport_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        message_id TEXT,
        error_message TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_email_deliveries_ts ON email_deliveries(created_at);

      CREATE TABLE IF NOT EXISTS schema_meta (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: "0002_tally_and_outbound_webhooks",
    sql: `
      CREATE TABLE IF NOT EXISTS tally_webhook_endpoints (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        webhook_token TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        events_received_count INTEGER NOT NULL DEFAULT 0,
        last_event_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_tally_webhook_workspace ON tally_webhook_endpoints(workspace_id);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_tally_webhook_token ON tally_webhook_endpoints(webhook_token);

      CREATE TABLE IF NOT EXISTS outbound_webhook_endpoints (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        target_url TEXT NOT NULL,
        signing_secret TEXT NOT NULL,
        events_json TEXT NOT NULL DEFAULT '["*"]',
        active INTEGER NOT NULL DEFAULT 1,
        last_delivery_status TEXT,
        last_delivered_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_outbound_webhooks_ws ON outbound_webhook_endpoints(workspace_id);
    `,
  },
  {
    version: 3,
    name: "0003_service_plan_requests",
    sql: `
      CREATE TABLE IF NOT EXISTS service_plan_requests (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        service_key TEXT NOT NULL REFERENCES services(key),
        requested_by_user_id TEXT NOT NULL,
        quoted_monthly_paise INTEGER NOT NULL,
        quoted_unit_paise INTEGER NOT NULL DEFAULT 0,
        customer_note TEXT,
        customer_payment_ref TEXT,
        status TEXT NOT NULL DEFAULT 'pending_payment',
        payment_id TEXT,
        invoice_id TEXT,
        amount_paid_paise INTEGER,
        payment_method TEXT,
        payment_reference TEXT,
        staff_notes TEXT,
        reviewed_by_staff_id TEXT,
        reviewed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_plan_requests_ws ON service_plan_requests(workspace_id, status);
      CREATE INDEX IF NOT EXISTS idx_plan_requests_status ON service_plan_requests(status, created_at);
    `,
  },
  {
    version: 4,
    name: "0004_commercial_bundles_cycles_free_access_reminders",
    sql: `
      ALTER TABLE workspaces ADD COLUMN free_access_until INTEGER;
      ALTER TABLE workspaces ADD COLUMN free_access_note TEXT;
      ALTER TABLE workspaces ADD COLUMN free_access_granted_by TEXT;
      ALTER TABLE workspaces ADD COLUMN auto_billing_reminders INTEGER NOT NULL DEFAULT 1;

      ALTER TABLE service_prices ADD COLUMN quarterly_amount_paise INTEGER;
      ALTER TABLE service_prices ADD COLUMN yearly_amount_paise INTEGER;

      ALTER TABLE entitlements ADD COLUMN billing_cycle TEXT NOT NULL DEFAULT 'monthly';
      ALTER TABLE entitlements ADD COLUMN quarterly_override_paise INTEGER;
      ALTER TABLE entitlements ADD COLUMN yearly_override_paise INTEGER;
      ALTER TABLE entitlements ADD COLUMN bundle_key TEXT;

      ALTER TABLE service_plan_requests ADD COLUMN billing_cycle TEXT NOT NULL DEFAULT 'monthly';
      ALTER TABLE service_plan_requests ADD COLUMN quoted_cycle_paise INTEGER;
      ALTER TABLE service_plan_requests ADD COLUMN bundle_key TEXT;
      ALTER TABLE service_plan_requests ADD COLUMN bundle_name TEXT;
      ALTER TABLE service_plan_requests ADD COLUMN included_keys_json TEXT;

      CREATE TABLE IF NOT EXISTS plan_bundles (
        key TEXT PRIMARY KEY,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        tagline TEXT NOT NULL,
        description TEXT NOT NULL,
        included_keys_json TEXT NOT NULL DEFAULT '[]',
        monthly_amount_paise INTEGER NOT NULL,
        quarterly_amount_paise INTEGER NOT NULL,
        yearly_amount_paise INTEGER NOT NULL,
        badge_label TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_plan_bundles_ws ON plan_bundles(workspace_id, active);

      CREATE TABLE IF NOT EXISTS client_bundle_overrides (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        bundle_key TEXT NOT NULL REFERENCES plan_bundles(key) ON DELETE CASCADE,
        custom_name TEXT,
        included_keys_json TEXT,
        monthly_override_paise INTEGER,
        quarterly_override_paise INTEGER,
        yearly_override_paise INTEGER,
        hidden INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_client_bundle_override ON client_bundle_overrides(workspace_id, bundle_key);

      CREATE TABLE IF NOT EXISTS billing_reminder_logs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        reminder_stage TEXT NOT NULL,
        billing_cycle TEXT NOT NULL DEFAULT 'monthly',
        target_summary TEXT NOT NULL,
        due_at INTEGER NOT NULL,
        amount_paise INTEGER NOT NULL,
        recipient_email TEXT NOT NULL,
        dedupe_key TEXT NOT NULL UNIQUE,
        email_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_billing_reminders_ws ON billing_reminder_logs(workspace_id, created_at);
    `,
  },
  {
    version: 5,
    name: "0005_profile_business_settings_and_connection_metadata",
    sql: `
      ALTER TABLE users ADD COLUMN phone TEXT;
      ALTER TABLE users ADD COLUMN job_title TEXT;

      ALTER TABLE workspaces ADD COLUMN business_phone TEXT;
      ALTER TABLE workspaces ADD COLUMN billing_email TEXT;
      ALTER TABLE workspaces ADD COLUMN website TEXT;
      ALTER TABLE workspaces ADD COLUMN address_line TEXT;
      ALTER TABLE workspaces ADD COLUMN city TEXT;
      ALTER TABLE workspaces ADD COLUMN pincode TEXT;
      ALTER TABLE workspaces ADD COLUMN default_tally_company TEXT;
      ALTER TABLE workspaces ADD COLUMN webhook_verify_token TEXT;

      ALTER TABLE connections ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
    `,
  },
  {
    version: 6,
    name: "0006_tally_connection_diagnostics",
    sql: `
      ALTER TABLE tally_webhook_endpoints ADD COLUMN pings_received_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tally_webhook_endpoints ADD COLUMN last_ping_at INTEGER;
      ALTER TABLE tally_webhook_endpoints ADD COLUMN last_source_ip TEXT;
      ALTER TABLE tally_webhook_endpoints ADD COLUMN last_user_agent TEXT;
      ALTER TABLE tally_webhook_endpoints ADD COLUMN last_error_at INTEGER;
      ALTER TABLE tally_webhook_endpoints ADD COLUMN last_error_message TEXT;

      ALTER TABLE agent_devices ADD COLUMN tally_reachable INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE agent_devices ADD COLUMN tally_host TEXT NOT NULL DEFAULT '127.0.0.1';
      ALTER TABLE agent_devices ADD COLUMN tally_port INTEGER NOT NULL DEFAULT 9000;
      ALTER TABLE agent_devices ADD COLUMN active_company_name TEXT;
      ALTER TABLE agent_devices ADD COLUMN last_alter_id INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE agent_devices ADD COLUMN last_sync_at INTEGER;
      ALTER TABLE agent_devices ADD COLUMN last_error_message TEXT;
    `,
  },
  {
    version: 7,
    name: "0007_platform_credentials_vault",
    sql: `
      CREATE TABLE IF NOT EXISTS platform_credentials (
        provider_key TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        public_config_json TEXT NOT NULL DEFAULT '{}',
        encrypted_secrets TEXT NOT NULL DEFAULT '',
        masked_hints_json TEXT NOT NULL DEFAULT '{}',
        updated_by_staff_id TEXT,
        last_verified_at INTEGER,
        last_verify_status TEXT,
        last_verify_message TEXT,
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 8,
    name: "0008_ssl_sequences_accounting_and_verification_lockout",
    sql: `
      ALTER TABLE verifications ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;

      ALTER TABLE invoices ADD COLUMN doc_type TEXT NOT NULL DEFAULT 'tax_invoice';
      ALTER TABLE invoices ADD COLUMN linked_invoice_id TEXT;
      ALTER TABLE invoices ADD COLUMN external_ref_key TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_external_ref ON invoices(external_ref_key) WHERE external_ref_key IS NOT NULL;

      CREATE TABLE IF NOT EXISTS invoice_sequences (
        series_key TEXT PRIMARY KEY,
        last_value INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      ALTER TABLE ledger_entries ADD COLUMN debit_account TEXT NOT NULL DEFAULT 'customer_wallet';
      ALTER TABLE ledger_entries ADD COLUMN credit_account TEXT NOT NULL DEFAULT 'platform_clearing';

      CREATE TABLE IF NOT EXISTS ssl_certificates (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        workspace_slug TEXT NOT NULL,
        zone TEXT NOT NULL,
        hostname TEXT NOT NULL UNIQUE,
        wildcard_parent TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        provider TEXT NOT NULL DEFAULT 'auto',
        coverage_mode TEXT NOT NULL DEFAULT 'wildcard_san',
        serial_hex TEXT,
        fingerprint_sha256 TEXT,
        cert_path TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at INTEGER,
        issued_at INTEGER,
        expires_at INTEGER,
        renew_after INTEGER,
        last_error TEXT,
        queued_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ssl_certs_workspace ON ssl_certificates(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_ssl_certs_status_renew ON ssl_certificates(status, renew_after);
    `,
  },
];

export const INGRESS_MIGRATIONS: SqlMigration[] = [
  {
    version: 1,
    name: "0001_ingress_initial",
    sql: `
      CREATE TABLE IF NOT EXISTS webhook_inbox (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        event_id TEXT NOT NULL,
        raw_body TEXT NOT NULL,
        headers_json TEXT NOT NULL,
        signature_valid INTEGER NOT NULL,
        routed_tenant_id TEXT,
        status TEXT NOT NULL DEFAULT 'received',
        error_message TEXT,
        received_at INTEGER NOT NULL,
        processed_at INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_provider_event ON webhook_inbox(provider, event_id);
      CREATE INDEX IF NOT EXISTS idx_webhook_status_ts ON webhook_inbox(status, received_at);

      CREATE TABLE IF NOT EXISTS schema_meta (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `,
  },
];

export const PLATFORM_LOGS_MIGRATIONS: SqlMigration[] = [
  {
    version: 1,
    name: "0001_platform_logs_initial",
    sql: `
      CREATE TABLE IF NOT EXISTS staff_action_logs (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        staff_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target_tenant_id TEXT,
        ticket_reference TEXT,
        summary TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        ip_address TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_staff_action_ts ON staff_action_logs(ts);

      CREATE TABLE IF NOT EXISTS impersonation_logs (
        id TEXT PRIMARY KEY,
        staff_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        target_user_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        ended_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS system_events (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        severity TEXT NOT NULL,
        component TEXT NOT NULL,
        message TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_system_events_ts ON system_events(ts);

      CREATE TABLE IF NOT EXISTS tenant_deletion_tombstones (
        tenant_id TEXT PRIMARY KEY,
        workspace_name TEXT NOT NULL,
        deleted_by_actor_id TEXT NOT NULL,
        crypto_shredded_at INTEGER NOT NULL,
        reason TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS schema_meta (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: "0002_docs_search_logs_decoupled",
    sql: `
      CREATE TABLE IF NOT EXISTS docs_search_logs (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        result_count INTEGER NOT NULL,
        surface TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_platform_docs_search_ts ON docs_search_logs(created_at);
    `,
  },
];

export const TENANT_DATA_MIGRATIONS: SqlMigration[] = [
  {
    version: 1,
    name: "0001_tenant_data_initial",
    sql: `
      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone_e164 TEXT,
        email TEXT,
        company_name TEXT,
        instagram_handle TEXT,
        facebook_scoped_id TEXT,
        tally_party_guid TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        lifetime_value_paise INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone_e164);
      CREATE INDEX IF NOT EXISTS idx_contacts_created ON contacts(created_at);

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        channel TEXT NOT NULL,
        asset_id TEXT,
        external_thread_id TEXT,
        subject TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        assigned_user_id TEXT,
        unread_count INTEGER NOT NULL DEFAULT 0,
        last_customer_message_at INTEGER,
        first_reply_time_sec INTEGER,
        sla_target_minutes INTEGER NOT NULL DEFAULT 30,
        sla_breached INTEGER NOT NULL DEFAULT 0,
        linked_voucher_guid TEXT,
        last_message_preview TEXT,
        last_activity_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conversations_status_activity ON conversations(status, last_activity_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations(channel);

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        direction TEXT NOT NULL,
        sender_type TEXT NOT NULL,
        sender_id TEXT,
        body TEXT NOT NULL,
        template_name TEXT,
        delivery_status TEXT NOT NULL DEFAULT 'sent',
        cost_paise INTEGER NOT NULL DEFAULT 0,
        pricing_category TEXT,
        external_message_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conv_ts ON messages(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(created_at);

      CREATE TABLE IF NOT EXISTS message_attachments (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        storage_key TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS labels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color_hex TEXT NOT NULL DEFAULT '#0E8A56',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_labels (
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_conv_label ON conversation_labels(conversation_id, label_id);

      CREATE TABLE IF NOT EXISTS internal_notes (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        author_user_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS canned_replies (
        id TEXT PRIMARY KEY,
        shortcut TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS inbox_search_fts USING fts5(
        entity_type,
        entity_id,
        conversation_id,
        content,
        tokenize='unicode61'
      );

      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY,
        external_review_id TEXT NOT NULL UNIQUE,
        location_name TEXT NOT NULL,
        reviewer_name TEXT NOT NULL,
        rating INTEGER NOT NULL,
        comment TEXT NOT NULL,
        reply_status TEXT NOT NULL DEFAULT 'unreplied',
        published_reply_text TEXT,
        replied_at INTEGER,
        reviewed_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reviews_rating_ts ON reviews(rating, reviewed_at);

      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        channel TEXT NOT NULL,
        objective TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        daily_budget_paise INTEGER NOT NULL DEFAULT 0,
        total_spend_paise INTEGER NOT NULL DEFAULT 0,
        attributed_revenue_paise INTEGER NOT NULL DEFAULT 0,
        impressions INTEGER NOT NULL DEFAULT 0,
        clicks INTEGER NOT NULL DEFAULT 0,
        conversions INTEGER NOT NULL DEFAULT 0,
        start_date INTEGER NOT NULL,
        end_date INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);

      CREATE TABLE IF NOT EXISTS insight_snapshots (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        day_key TEXT NOT NULL,
        spend_paise INTEGER NOT NULL DEFAULT 0,
        revenue_paise INTEGER NOT NULL DEFAULT 0,
        impressions INTEGER NOT NULL DEFAULT 0,
        clicks INTEGER NOT NULL DEFAULT 0,
        leads_count INTEGER NOT NULL DEFAULT 0,
        sales_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_insight_campaign_day ON insight_snapshots(campaign_id, day_key);
      CREATE INDEX IF NOT EXISTS idx_insight_day ON insight_snapshots(day_key);

      CREATE TABLE IF NOT EXISTS scheduled_posts (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        caption TEXT NOT NULL,
        media_url TEXT,
        scheduled_for INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled',
        published_at INTEGER,
        reach_count INTEGER NOT NULL DEFAULT 0,
        engagement_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pixel_events (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE,
        event_name TEXT NOT NULL,
        value_paise INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'INR',
        match_quality_score INTEGER NOT NULL DEFAULT 80,
        customer_hash TEXT,
        occurred_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pixel_occurred ON pixel_events(occurred_at);

      CREATE TABLE IF NOT EXISTS whatsapp_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        language TEXT NOT NULL DEFAULT 'en_IN',
        category TEXT NOT NULL,
        body_text TEXT NOT NULL,
        variables_json TEXT NOT NULL DEFAULT '[]',
        approval_status TEXT NOT NULL DEFAULT 'APPROVED',
        rejection_reason TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS broadcasts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        template_id TEXT NOT NULL REFERENCES whatsapp_templates(id),
        status TEXT NOT NULL DEFAULT 'draft',
        total_recipients INTEGER NOT NULL DEFAULT 0,
        sent_count INTEGER NOT NULL DEFAULT 0,
        delivered_count INTEGER NOT NULL DEFAULT 0,
        read_count INTEGER NOT NULL DEFAULT 0,
        replied_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        estimated_cost_paise INTEGER NOT NULL DEFAULT 0,
        actual_cost_paise INTEGER NOT NULL DEFAULT 0,
        scheduled_at INTEGER,
        completed_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS opt_ins (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        phone_e164 TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'whatsapp',
        source TEXT NOT NULL,
        evidence_note TEXT NOT NULL,
        consented_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_opt_in_phone_channel ON opt_ins(phone_e164, channel);

      CREATE TABLE IF NOT EXISTS reminder_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        trigger_days_offset INTEGER NOT NULL,
        template_name TEXT NOT NULL,
        max_reminders_per_bill INTEGER NOT NULL DEFAULT 3,
        quiet_hours_start INTEGER NOT NULL DEFAULT 20,
        quiet_hours_end INTEGER NOT NULL DEFAULT 9,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tally_companies (
        id TEXT PRIMARY KEY,
        company_guid TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        financial_year_from TEXT NOT NULL,
        last_alter_id INTEGER NOT NULL DEFAULT 0,
        last_synced_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tally_parties (
        id TEXT PRIMARY KEY,
        party_guid TEXT NOT NULL UNIQUE,
        company_id TEXT NOT NULL REFERENCES tally_companies(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        phone_e164 TEXT,
        gstin TEXT,
        closing_balance_paise INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tally_vouchers (
        id TEXT PRIMARY KEY,
        guid TEXT NOT NULL UNIQUE,
        company_id TEXT NOT NULL REFERENCES tally_companies(id) ON DELETE CASCADE,
        voucher_number TEXT NOT NULL,
        voucher_type TEXT NOT NULL,
        party_name TEXT NOT NULL,
        party_phone_e164 TEXT,
        amount_paise INTEGER NOT NULL,
        paid_amount_paise INTEGER NOT NULL DEFAULT 0,
        voucher_date INTEGER NOT NULL,
        due_date INTEGER,
        payment_status TEXT NOT NULL DEFAULT 'unpaid',
        whatsapp_invoice_sent_at INTEGER,
        reminders_sent_count INTEGER NOT NULL DEFAULT 0,
        alter_id INTEGER NOT NULL DEFAULT 1,
        content_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_vouchers_type_status ON tally_vouchers(voucher_type, payment_status);
      CREATE INDEX IF NOT EXISTS idx_vouchers_due_date ON tally_vouchers(due_date);

      CREATE TABLE IF NOT EXISTS sync_runs (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        source TEXT NOT NULL DEFAULT 'agent',
        vouchers_upserted INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'success',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY,
        queue_name TEXT NOT NULL,
        job_type TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        envelope_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_run_at INTEGER NOT NULL,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_outbox_status_next ON outbox(status, next_run_at);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS schema_meta (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: "0002_whatsapp_template_manager_and_tally_automations",
    sql: `
      ALTER TABLE whatsapp_templates ADD COLUMN header_type TEXT NOT NULL DEFAULT 'NONE';
      ALTER TABLE whatsapp_templates ADD COLUMN header_text TEXT;
      ALTER TABLE whatsapp_templates ADD COLUMN footer_text TEXT;
      ALTER TABLE whatsapp_templates ADD COLUMN buttons_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE whatsapp_templates ADD COLUMN variable_mappings_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE whatsapp_templates ADD COLUMN sample_values_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE whatsapp_templates ADD COLUMN meta_template_id TEXT;
      ALTER TABLE whatsapp_templates ADD COLUMN quality_score TEXT NOT NULL DEFAULT 'GREEN';
      ALTER TABLE whatsapp_templates ADD COLUMN last_synced_at INTEGER;
      ALTER TABLE whatsapp_templates ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE IF NOT EXISTS tally_automation_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        trigger_event TEXT NOT NULL,
        template_id TEXT NOT NULL REFERENCES whatsapp_templates(id) ON DELETE CASCADE,
        template_name TEXT NOT NULL,
        min_amount_paise INTEGER NOT NULL DEFAULT 0,
        delay_seconds INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        triggered_count INTEGER NOT NULL DEFAULT 0,
        last_triggered_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tally_auto_event ON tally_automation_rules(trigger_event, active);
    `,
  },
  {
    version: 3,
    name: "0003_tally_pdfs_masterid_currency_and_outbox_lock",
    sql: `
      ALTER TABLE tally_parties ADD COLUMN parent_group TEXT NOT NULL DEFAULT 'Sundry Debtors';

      ALTER TABLE tally_vouchers ADD COLUMN master_id TEXT;
      ALTER TABLE tally_vouchers ADD COLUMN original_currency TEXT NOT NULL DEFAULT 'INR';
      ALTER TABLE tally_vouchers ADD COLUMN original_amount_minor INTEGER;
      ALTER TABLE tally_vouchers ADD COLUMN exchange_rate_micros INTEGER;

      CREATE TABLE IF NOT EXISTS tally_voucher_pdfs (
        voucher_id TEXT PRIMARY KEY,
        voucher_guid TEXT NOT NULL,
        voucher_number TEXT NOT NULL DEFAULT '',
        company_name TEXT NOT NULL DEFAULT 'Primary Tally Company',
        filename TEXT NOT NULL,
        pdf_base64 TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        alter_id INTEGER NOT NULL DEFAULT 0,
        master_id TEXT,
        captured_from TEXT NOT NULL DEFAULT 'tally_native',
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tally_voucher_pdfs_guid ON tally_voucher_pdfs(voucher_guid);

      ALTER TABLE outbox ADD COLUMN locked_at INTEGER;
      ALTER TABLE outbox ADD COLUMN locked_by TEXT;
    `,
  },
  {
    version: 4,
    name: "0004_tally_inventory_godowns_batches_and_line_items",
    sql: `
      ALTER TABLE tally_parties ADD COLUMN email TEXT;
      ALTER TABLE tally_parties ADD COLUMN state_name TEXT;
      ALTER TABLE tally_parties ADD COLUMN address TEXT;
      ALTER TABLE tally_parties ADD COLUMN credit_limit_paise INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tally_parties ADD COLUMN credit_days INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tally_parties ADD COLUMN opening_balance_paise INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE IF NOT EXISTS tally_godowns (
        id TEXT PRIMARY KEY,
        godown_guid TEXT NOT NULL UNIQUE,
        company_id TEXT NOT NULL REFERENCES tally_companies(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        parent_name TEXT NOT NULL DEFAULT 'Primary',
        address TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tally_godowns_company ON tally_godowns(company_id, name);

      CREATE TABLE IF NOT EXISTS tally_stock_items (
        id TEXT PRIMARY KEY,
        item_guid TEXT NOT NULL UNIQUE,
        master_id TEXT,
        company_id TEXT NOT NULL REFERENCES tally_companies(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        sku_code TEXT,
        part_number TEXT,
        stock_group TEXT NOT NULL DEFAULT 'Primary',
        stock_category TEXT,
        uom TEXT NOT NULL DEFAULT 'PCS',
        hsn_code TEXT,
        gst_rate_bps INTEGER NOT NULL DEFAULT 1800,
        selling_price_paise INTEGER NOT NULL DEFAULT 0,
        cost_price_paise INTEGER NOT NULL DEFAULT 0,
        opening_qty REAL NOT NULL DEFAULT 0,
        opening_value_paise INTEGER NOT NULL DEFAULT 0,
        closing_qty REAL NOT NULL DEFAULT 0,
        closing_rate_paise INTEGER NOT NULL DEFAULT 0,
        closing_value_paise INTEGER NOT NULL DEFAULT 0,
        reorder_level_qty REAL NOT NULL DEFAULT 0,
        min_order_qty REAL NOT NULL DEFAULT 0,
        total_sold_qty REAL NOT NULL DEFAULT 0,
        total_sold_paise INTEGER NOT NULL DEFAULT 0,
        total_purchased_qty REAL NOT NULL DEFAULT 0,
        total_purchased_paise INTEGER NOT NULL DEFAULT 0,
        last_sold_at INTEGER,
        last_purchased_at INTEGER,
        synced_from_tally_master INTEGER NOT NULL DEFAULT 0,
        alter_id INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_stock_items_company_group ON tally_stock_items(company_id, stock_group);
      CREATE INDEX IF NOT EXISTS idx_stock_items_company_name ON tally_stock_items(company_id, name);

      CREATE TABLE IF NOT EXISTS tally_stock_balances (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES tally_stock_items(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL REFERENCES tally_companies(id) ON DELETE CASCADE,
        godown_name TEXT NOT NULL DEFAULT 'Main Location',
        batch_name TEXT NOT NULL DEFAULT 'Primary Batch',
        mfg_date INTEGER,
        expiry_date INTEGER,
        closing_qty REAL NOT NULL DEFAULT 0,
        closing_value_paise INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_balance_loc_batch ON tally_stock_balances(item_id, godown_name, batch_name);
      CREATE INDEX IF NOT EXISTS idx_stock_balances_company_godown ON tally_stock_balances(company_id, godown_name);

      CREATE TABLE IF NOT EXISTS tally_voucher_items (
        id TEXT PRIMARY KEY,
        voucher_id TEXT NOT NULL REFERENCES tally_vouchers(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL REFERENCES tally_companies(id) ON DELETE CASCADE,
        stock_item_id TEXT REFERENCES tally_stock_items(id) ON DELETE SET NULL,
        item_name TEXT NOT NULL,
        godown_name TEXT NOT NULL DEFAULT 'Main Location',
        batch_name TEXT NOT NULL DEFAULT 'Primary Batch',
        hsn_code TEXT,
        uom TEXT NOT NULL DEFAULT 'PCS',
        billed_qty REAL NOT NULL DEFAULT 0,
        actual_qty REAL NOT NULL DEFAULT 0,
        rate_paise INTEGER NOT NULL DEFAULT 0,
        discount_bps INTEGER NOT NULL DEFAULT 0,
        gst_rate_bps INTEGER NOT NULL DEFAULT 0,
        amount_paise INTEGER NOT NULL DEFAULT 0,
        voucher_type TEXT NOT NULL,
        voucher_date INTEGER NOT NULL,
        party_name TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_voucher_items_vch ON tally_voucher_items(voucher_id);
      CREATE INDEX IF NOT EXISTS idx_voucher_items_item ON tally_voucher_items(stock_item_id, voucher_date);
    `,
  },
  {
    version: 5,
    name: "0005_tally_client_ledgers_payments_and_settlements",
    sql: `
      ALTER TABLE tally_parties ADD COLUMN pan TEXT;
      ALTER TABLE tally_parties ADD COLUMN contact_person TEXT;
      ALTER TABLE tally_parties ADD COLUMN pincode TEXT;
      ALTER TABLE tally_parties ADD COLUMN synced_from_tally_master INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tally_parties ADD COLUMN total_invoiced_paise INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tally_parties ADD COLUMN total_received_paise INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tally_parties ADD COLUMN unpaid_bills_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tally_parties ADD COLUMN overdue_bills_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tally_parties ADD COLUMN last_voucher_at INTEGER;
      ALTER TABLE tally_parties ADD COLUMN last_payment_at INTEGER;

      ALTER TABLE tally_vouchers ADD COLUMN direct_paid_paise INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tally_vouchers ADD COLUMN narration TEXT;
      ALTER TABLE tally_vouchers ADD COLUMN ledger_account_name TEXT;
      ALTER TABLE tally_vouchers ADD COLUMN bill_allocations_json TEXT NOT NULL DEFAULT '[]';
      UPDATE tally_vouchers SET direct_paid_paise = paid_amount_paise WHERE direct_paid_paise = 0 AND paid_amount_paise > 0;

      CREATE TABLE IF NOT EXISTS tally_bill_settlements (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES tally_companies(id) ON DELETE CASCADE,
        bill_voucher_id TEXT NOT NULL REFERENCES tally_vouchers(id) ON DELETE CASCADE,
        settlement_voucher_id TEXT REFERENCES tally_vouchers(id) ON DELETE CASCADE,
        bill_number TEXT NOT NULL,
        settlement_voucher_number TEXT,
        settlement_voucher_type TEXT NOT NULL,
        party_name TEXT NOT NULL,
        allocation_type TEXT NOT NULL DEFAULT 'agst_ref',
        amount_paise INTEGER NOT NULL,
        settled_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bill_settlements_bill ON tally_bill_settlements(bill_voucher_id);
      CREATE INDEX IF NOT EXISTS idx_bill_settlements_src ON tally_bill_settlements(settlement_voucher_id);
    `,
  },
];

export const TENANT_LOGS_MIGRATIONS: SqlMigration[] = [
  {
    version: 1,
    name: "0001_tenant_logs_initial",
    sql: `
      CREATE TABLE IF NOT EXISTS action_logs (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        impersonator_id TEXT,
        source TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        asset_id TEXT,
        outcome TEXT NOT NULL,
        error_code TEXT,
        request_id TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT,
        duration_ms INTEGER NOT NULL,
        summary TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        hash TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_action_logs_ts ON action_logs(ts);
      CREATE INDEX IF NOT EXISTS idx_action_logs_actor_ts ON action_logs(actor_id, ts);
      CREATE INDEX IF NOT EXISTS idx_action_logs_action_ts ON action_logs(action, ts);
      CREATE INDEX IF NOT EXISTS idx_action_logs_correlation ON action_logs(correlation_id);

      CREATE TRIGGER IF NOT EXISTS trg_action_logs_no_update
      BEFORE UPDATE ON action_logs
      BEGIN
        SELECT RAISE(ABORT, 'Action logs are immutable and cannot be modified');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_action_logs_no_delete
      BEFORE DELETE ON action_logs
      BEGIN
        SELECT RAISE(ABORT, 'Action logs are immutable and cannot be deleted');
      END;

      CREATE TABLE IF NOT EXISTS provider_calls (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        provider TEXT NOT NULL,
        operation TEXT NOT NULL,
        method TEXT NOT NULL,
        status INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        rate_limit_state TEXT,
        provider_request_id TEXT,
        error_code TEXT,
        redacted_error_body TEXT,
        correlation_id TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_provider_calls_correlation ON provider_calls(correlation_id);
      CREATE INDEX IF NOT EXISTS idx_provider_calls_provider_ts ON provider_calls(provider, ts);

      CREATE TABLE IF NOT EXISTS job_runs (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        queue TEXT NOT NULL,
        job_type TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 1,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        error_message TEXT,
        idempotency_key TEXT NOT NULL,
        correlation_id TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_job_runs_correlation ON job_runs(correlation_id);
      CREATE INDEX IF NOT EXISTS idx_job_runs_queue_status_ts ON job_runs(queue, status, ts);

      CREATE TABLE IF NOT EXISTS event_logs (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        provider TEXT NOT NULL,
        event_type TEXT NOT NULL,
        external_event_id TEXT NOT NULL,
        outcome TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        summary TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_event_logs_correlation ON event_logs(correlation_id);

      CREATE TABLE IF NOT EXISTS send_guards (
        idempotency_key TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        recipient_hash TEXT NOT NULL,
        state TEXT NOT NULL,
        external_id TEXT,
        reserved_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_send_guard_key ON send_guards(idempotency_key);

      CREATE TABLE IF NOT EXISTS suppressions (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        identifier TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_suppression_channel_id ON suppressions(channel, identifier);

      CREATE TABLE IF NOT EXISTS backup_runs (
        id TEXT PRIMARY KEY,
        destination_id TEXT,
        destination_name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'backup',
        status TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        checksum_sha256 TEXT,
        artifact_path TEXT,
        error_code TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS schema_meta (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `,
  },
];

export const EXPECTED_TENANT_DATA_TABLES = new Set([
  "contacts",
  "conversations",
  "messages",
  "message_attachments",
  "labels",
  "conversation_labels",
  "internal_notes",
  "canned_replies",
  "inbox_search_fts",
  "inbox_search_fts_data",
  "inbox_search_fts_idx",
  "inbox_search_fts_content",
  "inbox_search_fts_docsize",
  "inbox_search_fts_config",
  "reviews",
  "campaigns",
  "insight_snapshots",
  "scheduled_posts",
  "pixel_events",
  "whatsapp_templates",
  "tally_automation_rules",
  "broadcasts",
  "opt_ins",
  "reminder_rules",
  "tally_companies",
  "tally_parties",
  "tally_godowns",
  "tally_stock_items",
  "tally_stock_balances",
  "tally_vouchers",
  "tally_voucher_items",
  "tally_voucher_pdfs",
  "tally_bill_settlements",
  "sync_runs",
  "outbox",
  "settings",
  "schema_meta",
]);

export function runSqlMigrations(db: Database.Database, migrations: SqlMigration[]): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const row = db.prepare("SELECT MAX(version) as v FROM schema_meta").get() as { v: number | null } | undefined;
  let currentVersion = row?.v ?? 0;

  for (const m of migrations) {
    if (m.version > currentVersion) {
      const tx = db.transaction(() => {
        db.exec(m.sql);
        db.prepare("INSERT OR REPLACE INTO schema_meta (version, applied_at) VALUES (?, ?)").run(
          m.version,
          Date.now()
        );
      });
      tx();
      currentVersion = m.version;
    }
  }

  return currentVersion;
}
