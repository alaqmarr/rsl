# RapidShift Labs — Full-Stack Performance Audit & Optimization Plan

**Audit Date:** 2026-11-20  
**Scope:** Next.js App Router (`apps/web`, `apps/admin`), UI/CSS (`packages/ui`), SQLite/Drizzle/Tenancy/Billing (`packages/database`, `packages/tenancy`, `packages/billing`), Domain Engines (`packages/tally`, `packages/inbox`, `packages/analytics`, `packages/whatsapp`, `packages/meta`), and Background Worker (`apps/worker`).

---

## 1. Observed Baseline Metrics

### Warm Route Latency (`pnpm dev` on `127.0.0.1:4500` & `4501`)
| App | Route | HTTP | Warm Response Time | Payload Size |
| :--- | :--- | :---: | :---: | :---: |
| Web (`4500`) | `/` | `200` | `1,194 ms` | `93,829 bytes` |
| Web (`4500`) | `/analytics` | `200` | `1,023 ms` | `56,035 bytes` |
| Web (`4500`) | `/tally` | `200` | `870 ms` | `57,286 bytes` |
| Web (`4500`) | `/login` | `200` | `862 ms` | `54,344 bytes` |
| Web (`4500`) | `/billing` | `200` | `837 ms` | `57,325 bytes` |
| Web (`4500`) | `/whatsapp` | `200` | `623 ms` | `56,407 bytes` |
| Admin (`4501`) | `/pricing` | `200` | `901 ms` | `49,861 bytes` |
| Admin (`4501`) | `/clients` | `200` | `481 ms` | `49,828 bytes` |

### Local Data & Bundle Footprint
- **SQLite state (`.rsl-data`)**: `control.db` = `1.06 MB`; `72` tenant folders + `28` staging folders (`58.7 MB` total), with `142` `.db-wal` files (`133` non-zero totaling `3.06 MB`).
- **CSS & Shared Guides**: `packages/ui/src/theme.css` = `56,963 bytes` (`2,115` lines), `apps/web/src/lib/page-guides.ts` = `50,187 bytes`, `apps/web/src/app/globals.css` = `11,599 bytes`, `apps/admin/src/app/globals.css` = `11,424 bytes`, with `43` `backdrop-filter`/`backdrop-blur`/`@keyframes`/`box-shadow` declarations across those stylesheets.
- **Largest Client Modules**:
  - `apps/web/src/components/connections-hub.tsx` (`69,166 B`)
  - `apps/web/src/components/workspace-chrome.tsx` (`62,250 B`)
  - `apps/web/src/components/tally-connect-studio.tsx` (`59,379 B`)
  - `apps/web/src/components/api-tokens-hub.tsx` (`56,744 B`)
  - `apps/web/src/components/profile-settings-client.tsx` (`47,741 B`)
  - `apps/web/src/components/campaigns-views.tsx` (`45,506 B`)
  - `apps/admin/src/components/plans-entitlements-tab.tsx` (`42,016 B`)
  - `apps/web/src/components/business-settings-client.tsx` (`41,234 B`)
  - `apps/web/src/components/plan-activation-modal.tsx` (`38,355 B`)

---

## 2. Critical Bottlenecks

### C1. Unmemoized `ensureServiceCatalogSeeded()` Runs 4+ Queries on Almost Every Request
- **Where**: `packages/billing/src/index.ts:572-601` (`ensureServiceCatalogSeeded`), invoked from 20+ read/entitlement helpers (`listServicesWithWorkspaceState`, `listBundlesWithWorkspaceState`, `hasActiveEntitlement`, `getWorkspacePlansByKeys`, etc.).
- **Bottleneck**: Every invocation runs 4 separate `controlDb()` queries (`COUNT(*)` on `services`, `COUNT(*)` on `plan_bundles`, lookups for `tally_business_suite` and `google.ads`). `listBundlesWithWorkspaceState` (`L1022-1026`) calls `ensureServiceCatalogSeeded()` and then calls `listServicesWithWorkspaceState()`, which calls `ensureServiceCatalogSeeded()` again. Initial seeding also runs outside an explicit transaction.
- **Fix**: Memoize completion in a module-level flag (with test reset hook), cache static `services` / `service_prices` / global `plan_bundles` with invalidation on staff price edits, and wrap cold seeding inside `db.$client.transaction(...).immediate()`.

### C2. Admin `ConsoleLayout` Runs 15–18+ Cross-DB Queries on Every Page & Doubles on Subpages
- **Where**: `apps/admin/src/app/(console)/layout.tsx:17-34`, `packages/analytics/src/index.ts:883-1079` (`getPlatformAdminAnalytics`), `apps/admin/src/lib/session.ts:46-60` (`requireStaffSession`), `apps/admin/src/app/(console)/page.tsx:39-50`.
- **Bottleneck**:
  - `requireStaffSession()` is not wrapped in `React.cache()`, and `resolveStaffSessionFromToken` (`packages/auth/src/index.ts:2504-2560`) has no in-memory cache -> double staff DB lookups in layout + page.
  - `ConsoleLayout` invokes `getPlatformAdminAnalytics()` on **every** admin route solely for 3 counters (`pendingPlanRequestsCount`, `pendingWalletRequestsCount`, `totalInvoicedRevenuePaise`) and `quickClients`, running 15+ queries across `control.db`, `ingress.db`, and `platform-logs.db` including 6 correlated per-workspace subqueries, `staffActionLogs`, `docsFeedback`, and `docs_search_logs`. Subpages (`/`, `/clients`, `/invoices`, `/queues`, `/templates`, `/runbooks`) then call `getPlatformAdminAnalytics()` a second time.
- **Fix**: Wrap `requireStaffSession()` and `getPlatformAdminAnalytics()` in `React.cache()`, extract a lightweight `getAdminLayoutSummary()` for `ConsoleLayout`, and replace correlated subqueries in `getPlatformAdminAnalytics()` with `GROUP BY workspace_id` aggregations.

### C3. Web Session Resolution & `DashboardLayout` Duplicate DB Work Per Request
- **Where**: `apps/web/src/lib/session.ts:14-26`, `apps/web/src/app/(dashboard)/layout.tsx:30-67`, `packages/auth/src/index.ts:704-798`.
- **Bottleneck**:
  - `getOptionalWebSession`, `requireWebSession`, and `getWebLocale` lack `React.cache()`, causing duplicate session/locale resolution across root layout, dashboard layout, and pages.
  - On a `resolveUserSessionFromToken` cache miss (`L769-797`), it executes `memberships JOIN workspaces` and then a redundant second `SELECT` on `workspaces`.
  - `DashboardLayout` runs `listServicesWithWorkspaceState()` (9 queries) solely to compute `unlockedToolsCount`, calls `getWorkspaceSetupProgress()` (5 cross-DB queries on 5s TTL miss), and unconditionally queries `getPlatformBillingSettings()` even when `isSuspended === false`.
- **Fix**: Wrap session/locale helpers in `React.cache()`, fetch required `workspaces` fields in the single `memberships JOIN workspaces` query, add a fast `countUnlockedWorkspaceServices()` helper for `DashboardLayout`, and gate `getPlatformBillingSettings()` behind `if (isSuspended)`.

### C4. Synchronous Blocking I/O During SSR (`probeLocalTallyPort9000` & `ensureWorkspaceSslProvisioned`)
- **Where**: `apps/web/src/lib/tally-data.ts:57`, `apps/web/src/app/(dashboard)/connections/[channel]/page.tsx:168-171`, `apps/web/src/app/(dashboard)/inventory/page.tsx:104`, `apps/admin/src/app/(console)/clients/[id]/page.tsx:73`, `packages/tally/src/index.ts:8938-9018`.
- **Bottleneck**:
  - Local dev SSR blocks on `await probeLocalTallyPort9000(9000)`; per-company voucher probes loop sequentially with **no `AbortSignal` timeout** (`L8970-8995`).
  - `/connections/[channel]` and `/clients/[id]` `await ensureWorkspaceSslProvisioned(...)` inline during GET SSR, triggering outbox/ACME writes inside reads.
- **Fix**: Enforce `AbortSignal.timeout(1200)` and `Promise.all` (or move port-9000 probe to an async client fetch / Suspense boundary), and replace SSR `ensureWorkspaceSslProvisioned()` with read-only `listWorkspaceSslCertificates()`.

### C5. Bulk Tally Sync N+1 Queries Without Transactions & Per-Row Retention Sweeps on Reads
- **Where**: `packages/tally/src/index.ts:8212-8693` (`ingestTallyBillEventAndEnqueueAutomation`), `packages/tally/src/inventory.ts:1579-1882` (`upsertParsedTallyMastersForWorkspace`), `packages/tally/src/confidentiality.ts:533-681` (`runWorkspaceDataRetentionSweep`).
- **Bottleneck**:
  - `ingestTallyBillEventAndEnqueueAutomation` loops outside a SQLite transaction, issuing ~15–25 queries/fsyncs per voucher (per-voucher `resolveCanonicalVoucherGuid`, `upsertWorkspaceTallyParty`, line items, PDFs, per-voucher rule/workspace queries in `enqueueMatchingAutomationsForVoucher`, and per-voucher re-selects at `L8605-8614`).
  - `upsertParsedTallyMastersForWorkspace` re-queries all company `tally_vouchers` / `tally_stock_items` inside per-bill and per-item loops.
  - `runWorkspaceDataRetentionSweep` runs 5 individual `DELETE`s per expired voucher in a loop and executes synchronously on Tally/ledger reads.
- **Fix**: Wrap ingestion & master syncs in `db.$client.transaction(...)`, pre-load existing maps before loops, defer party balance updates to batch reconciliation, batch retention `DELETE`s via `inArray`, and move retention sweeps off synchronous read paths.

### C6. Worker Maintenance Cron Serializes Heavy Work Across All Active Tenants
- **Where**: `apps/worker/src/index.ts:372-535`, `655-668`; `packages/queue/src/index.ts:351-474`.
- **Bottleneck**:
  - Every `3s`, `sweepActiveTenantOutboxes` polls `control.db` (`listDueOutboxTenantIds`) and awaits tenants sequentially even when Redis/BullMQ is active, while `withTenantOutboxLock` holds an in-memory lock across slow `fetch()` calls.
  - Every `15s`, `refreshPlatformQueueSummaryCache()` synchronously opens tenant DBs on boot and in cron.
  - Every `30m`, `runScheduledMaintenance` sequentially loops through all active tenants executing `optimizeTenantDatabase` (`VACUUM` / `PRAGMA optimize`), `refreshTenantDiskMetrics`, `refreshWorkspaceAnalyticsRollups` (`30d` & `7d`), `runWorkspaceDataRetentionSweep`, and `sweepDueTallyPaymentReminders`, blocking billing reminders and SSL sweeps.
- **Fix**: Relax SQLite fallback polling to `*/30 * * * * *` when Redis is configured, release `withTenantOutboxLock` right after SQLite row claiming, process `dueTenantIds` and maintenance sweeps with bounded concurrency (`pLimit`), move `VACUUM` to nightly maintenance, and refresh analytics rollups only for tenants with recent writes.

---

## 3. High-Impact Database, Query & Frontend Optimizations

### H1. Missing SQLite Pragmas (`cache_size`, `mmap_size`), Eviction Contention & Migration Checks
- **Where**: `packages/database/src/ddl.ts:3-12`, `packages/tenancy/src/index.ts:139-173, 243-326`.
- **Bottleneck**:
  - `applyConnectionPragmas` omits `cache_size` (defaults to ~2 MiB) and `mmap_size` (defaults to `0`).
  - Evicting an active handle removes the map key before `disposeHandleSafely` closes an in-transaction handle, risking duplicate concurrent handles (`SQLITE_BUSY`), while `close()` runs synchronous `PRAGMA optimize` on eviction.
  - `tenantDataDb` and `tenantLogsDb` execute `runSqlMigrations` unconditionally on handle open even when `dataSchemaVersion` / `logsSchemaVersion` is current.
- **Fix**: Configure bounded `cache_size` and `mmap_size`, track closing handles safely, remove `PRAGMA optimize` from hot eviction, and gate `runSqlMigrations` by version check.

### H2. Missing Indexes Across `control.db`, Tenant `data.db`, and `platform-logs.db`
- **Control DB (`control.ts` / `ddl.ts`)**:
  - `invoices`: add `(workspace_id, issued_at DESC)`, `(issued_at DESC)`, `(linked_invoice_id, doc_type)`.
  - `payments`: add `(workspace_id, created_at DESC)`, `(status, created_at DESC)`, `(invoice_id)`, `(external_order_id)`, `(workspace_id, external_payment_id)`.
  - `connections`: **zero secondary indexes** -> add `(workspace_id, provider, updated_at DESC)` and `(provider, external_account_id)`.
  - `assets`: **zero secondary indexes** -> add `(workspace_id, asset_type, active)` and `(connection_id)`.
  - `service_plan_requests`: add `(workspace_id, created_at DESC)`.
  - `entitlements`: add `(bundle_key, status)`, `(status, expires_at)`.
  - `api_keys` & `agent_devices`: add `(workspace_id, created_at DESC)`.
  - `sessions`: add `(active_workspace_id)`.
  - `email_deliveries`: add `(workspace_id, created_at DESC)`.
  - `ledger_entries`: add covering index `(workspace_id, created_at, amount_paise)`.
- **Tenant Data DB (`tenant-data.ts` / `ddl.ts`)**:
  - `contacts`: add partial indexes on `instagram_handle`, `facebook_scoped_id`, `email`.
  - `conversations`: add `(contact_id, channel)`, `(last_activity_at DESC)`, `(linked_voucher_guid)`, `(assigned_user_id, last_activity_at DESC)`.
  - `messages`: drop duplicate index `idx_messages_created` (`ddl.ts:1586`, identical to `idx_messages_ts` at `ddl.ts:1048`).
  - `tally_vouchers`: add `(company_id, voucher_date, created_at)`, `(company_id, master_id)`, `(company_id, party_name)`, `(voucher_number)`, `(created_at)`.
  - `tally_parties`: add `(company_id, name)`, `(closing_balance_paise DESC)`.
  - `tally_voucher_pdfs`: add `(updated_at)`, split `OR` query (`voucher_id = ? OR voucher_guid = ?`).
  - `scheduled_posts`: add `(status, scheduled_for)`.
  - `outbox`: add `(status, queue_name, next_run_at)` and `(updated_at DESC)`.
- **Platform Logs DB (`platform-logs.ts` / `ddl.ts`)**:
  - `impersonation_logs`: **zero secondary indexes** -> add `(workspace_id, started_at DESC)` and `(staff_id, workspace_id, ended_at)`.
  - `staff_action_logs`: add `(target_tenant_id, ts DESC)`.

### H3. Full-Table `.all()` Scans, `O(N × M)` Lookups & JS Aggregations
- `packages/tally/src/ledgers.ts:735-828` (`getWorkspacePartiesLedgerSummary`): queries ALL `tally_vouchers` twice and ALL `tally_parties` twice; `reconcileCompanyBillSettlementsAndPartyBalances` (`L342-689`) has `O(S × B)` and `O(P × V)` nested loops.
- `packages/tally/src/inventory.ts:2908-2995` (`getWorkspaceInventorySummary`): loads full `tally_godowns`, `tally_stock_items`, `tally_stock_balances`, `tally_vouchers`, applies `LIMIT` before JS company filter, and runs `O(balances × items)` `rawItems.find()`.
- `packages/tally/src/index.ts:1561-1673` (`getTallyWorkspaceSummary`): loads all `tally_voucher_pdfs`, `tally_voucher_items`, `tally_parties`, `tally_bill_settlements` despite voucher pagination (`200`), and counts stock items via `.all().length`.
- `packages/tally/src/index.ts:2766-2860` (`sweepDueTallyPaymentReminders`): scans all `Sales` vouchers (`paid` included) and calls `getWalletBalancePaise()` inside the per-voucher loop.
- `apps/admin/src/app/(console)/clients/[id]/page.tsx:97-103`: loads every `users` row globally into memory (`db.select().from(controlSchema.users).all()`).
- `packages/billing/src/index.ts`: `listAllPlatformInvoices` (`L4353-4403`), `listPlatformPlanRequests` (`L2877-2927`), `getAdSpendVaultSummary` (`L2388-2419`), `listBundlesWithWorkspaceState` (`L1022-1060`) load unpaginated tables or run redundant queries before JS filtering/summing.
- `packages/analytics/src/index.ts`: `computeWorkspaceAnalyticsWatermark` (`L125-153`) runs 10 `COUNT`/`MAX` subqueries before checking `analytics_rollups` cache TTL, and `L371-399` computes 5 receivables ageing buckets in JS.
- `packages/whatsapp/src/index.ts`: `getWhatsAppWorkspaceData` (`L295-335`) & `launchWhatsAppBroadcast` (`L1866-1883`) load full tables into JS; `listAllPlatformWhatsAppTemplates` (`L1980-2014`) loops every tenant synchronously.
- `packages/inbox/src/index.ts:441-449`: `"unassigned"` filter fetches `LIMIT 200` at `OFFSET 0` before JS filtering/slicing.

### H4. Client Bundle Bloat & Over-Broad `"use client"` Boundaries
- `apps/web/src/components/public-landing-page.tsx`: 725-line static marketing component marked `"use client"` (only `ThemeToggleButton` needs client JS).
- `apps/web/src/components/workspace-chrome.tsx` & `apps/admin/src/components/admin-nav.tsx`: bundle entire guide dictionaries (`page-guides.ts` `50 KB`, `nav-routes.ts` 455 lines) into every dashboard/console page instead of splitting metadata from lazy `GuideDrawer` content.
- `apps/web/src/components/plan-activation-modal.tsx` & `apps/web/src/lib/billing-data.ts`: eagerly imports `qrcode`, mounts ~20 modal instances on `/billing`, and runs all 11 billing queries across `/billing`, `/billing/wallet`, and `/billing/invoices`.

---

## 4. Medium / Low Priority Optimizations

1. **Bounded-Concurrent External `fetch()` Loops**: `executeWhatsAppBroadcastChunkJob` (`packages/whatsapp/src/index.ts:1723-1754`), `installStarterTallyTemplates` (`L822-915`), `sweepDueScheduledPostsAsync` (`packages/meta/src/index.ts:1444-1482`), local Tally port-9000 PDF exports (`packages/tally/src/index.ts:8883-9159`), and dual R2 + Google Drive backup uploads (`apps/worker/src/index.ts:123-141`).
2. **Webhook Hot-Path Batching**: `processWhatsAppWebhookPayload` (`packages/inbox/src/webhook-processors.ts:219-701`) falls back to scanning all WhatsApp `connections` (`JSON.parse`) and processes statuses/messages without a single transaction; `sweepPendingWebhookInbox` awaits rows sequentially.
3. **UI Pagination & Polling**: Paginate large tables (`/tally/parties`, `/inventory`, `/admin/clients`, `/admin/invoices`, `/admin/templates`), lazy-load inbox `<select>` contact options (`150` DOM nodes), and increase `tally-live-sync-bar.tsx` `4s` polling / avoid full `router.refresh()` when unchanged.
4. **CSS & Font Pruning**: Scope `Fraunces` font to marketing/public routes if unused in dashboard/admin shells, restrict `backdrop-filter` blur surfaces to sticky bars/overlays rather than repeating list cards, convert raw `<img>` brand logos to `next/image`, and move heavy `fs.statSync` / `fs.rmSync` calls in `packages/tenancy` to `fs.promises`.

---

## Recommended Implementation Phases
1. **Phase 1 — Quick SSR & React Wins**: Memoize `ensureServiceCatalogSeeded()`, wrap `getOptionalWebSession` / `requireWebSession` / `requireStaffSession` / `getPlatformAdminAnalytics` in `React.cache()`, parallelize independent Server Component queries with `Promise.all`, strip `"use client"` from `PublicLandingPage`, dynamic-import `qrcode` & `GuideDrawer`, and remove blocking SSL provisioning & hung port-9000 probes from SSR.
2. **Phase 2 — Database Speed & Zero Full-Table Scans**: Add `cache_size` / `mmap_size` PRAGMAs, gate `runSqlMigrations` by schema version, ship versioned SQLite index migrations across `control.db`, `tenant data.db`, and `platform-logs.db`, eliminate `O(N²)` / full `.all()` scans in `tally`, `billing`, `analytics`, `inbox`, `whatsapp`, and `admin/clients/[id]`.
3. **Phase 3 — Separate Pages (Zero Tabs) & Concurrent Worker**: Move all remaining UI tab switchers in `apps/web` and `apps/admin` into dedicated Next.js App Router pages, parallelize worker sweeps with bounded concurrency, and shift `VACUUM` off the 30-minute loop.
