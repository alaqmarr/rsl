# RSL Marketing Platform — Architecture and Implementation Plan

Owner: Rapid Shift Labs
Target: Multi-tenant SaaS on Next.js 16, SQLite database-per-tenant, deployed on Oracle Cloud Free Tier
Revision: 3 (adds SQLite multi-database design, per-client logging, queue design, customer backups, custom guides system)

---

## Table of contents

1. Premise corrections
2. Product scope and service catalog
3. Tech stack
4. Monorepo layout and dependency rules
5. Bootstrap instructions
6. Environment variables
7. Data architecture: SQLite and multiple databases
8. Domain model by database
9. Authentication and tenancy
10. RBAC
11. Billing, entitlements, and the admin console
12. Logging and diagnostics (per client, per action)
13. Connections (OAuth and token vault)
14. Queue system design
15. Meta (Instagram, Facebook, Pixel, Ads)
16. WhatsApp
17. Tally integration
18. Google Business Profile
19. Unified inbox
20. Public API and API keys manager
21. Storage (Cloudflare R2)
22. Customer backup, export, and restore
23. Guides and documentation system (custom built)
24. UI system
25. Security
26. Platform observability
27. Testing
28. Deployment on Oracle
29. External approvals (start in week 1)
30. Delivery phases with task checklists
31. Items missed in the original brief
32. Engineering rules
33. Definition of done

---

## 1. Premise corrections

| Item | Problem | Correction |
|---|---|---|
| NextAuth | Auth.js v5 stayed in prolonged beta and its maintenance moved under the Better Auth project. No organization, role, or invitation model. | Better Auth with organization and access-control plugins. If NextAuth is kept, you own all tenancy and RBAC code. |
| "Manage everything" across Meta, Google, WhatsApp, Tally | Five products, five approval processes. | Phase delivery (section 30). Ship one revenue-generating service first. |
| Tally to cloud | Tally Prime exposes XML over HTTP on a local port on the customer's machine. A cloud app cannot reach it. | Windows connector agent pushing outbound over HTTPS. |
| WhatsApp on customers' numbers | Requires Meta Tech Provider status, business verification, app review, Embedded Signup. | Start verification in week 1. |
| Google Business Profile API | Approval-gated, low default quotas. | Apply immediately. |
| 8 packages on day 1 | `operations`, `modules`, `core` overlap and are undefined. | Layout in section 4. |
| "animate" | Ambiguous. `tailwindcss-animate` is deprecated for Tailwind v4. | `tw-animate-css`; `motion` only where needed. |
| Webhooks inside the Next.js process | Events drop on deploy, restart, and spikes. | Separate worker process. Routes verify, persist, enqueue. |
| "Multiple databases to avoid clutter" | Clutter is not a valid reason. A schema with `workspaceId` columns is not clutter. The valid reasons are blast-radius isolation, per-customer backup/restore/deletion, and noisy-neighbor containment. The cost is real: migrations fan out to N files, no cross-tenant SQL, handle management, N times the backups, tenant files are bound to a host. | Accept the design because per-customer backup and restore is a hard requirement and one SQLite file per tenant is the natural unit. Section 7 contains the controls that make the cost manageable. |
| "SQLite everywhere" | If the control plane (users, billing, entitlements) is SQLite, web, admin, and worker must run on one host sharing one filesystem. No horizontal scaling, no live failover (Litestream gives restore, not hot standby). | Tenant databases: SQLite. Control plane: SQLite while on a single host, behind a repository interface, with a written trigger for moving it to Postgres (section 7.9). |
| "Queue with SQLite" | A multi-consumer, blocking, delayed, rate-limited queue on SQLite is a hand-rolled queue. | Redis + BullMQ is the queue. SQLite holds the durable record (outbox, job runs). Redis is rebuildable from it (section 14). |
| Prisma on SQLite database-per-tenant | Works through driver adapters, but the migration CLI is single-database. You write a fan-out runner either way. | Drizzle ORM + drizzle-kit with a custom tenant migration runner. If you stay on Prisma, you build the same runner and carry heavier clients. |
| Customer-restorable backups | A customer who can restore their own data file can roll back their wallet balance, re-enable revoked consent, and resurrect sent-message state. | Billing, entitlements, auth, tokens, consent suppressions, and send guards live outside the restorable file (section 7.2, 22.6). |
| "Log each action" | Unstructured logging of everything produces PII leakage, volume, and no usable trail. | Four defined log classes with schemas, retention, and enforced capture (section 12). |
| "Custom guides, no third-party tool" | Writing an API reference renderer, search, and code-sample generator is roughly 2 to 3 weeks of work plus permanent maintenance. | Justified only because guides must be personalised with live workspace state. Boundary defined in section 23.1: libraries allowed, hosted or packaged docs products not. |

---

## 2. Product scope and service catalog

Every capability is a **Service**. A workspace uses a service only while it holds an active **Entitlement**.

| Service key | Name | Depends on | Pricing model (initial) | Metered |
|---|---|---|---|---|
| `inbox` | Unified Inbox | one connection | per seat | seats |
| `meta.pages` | Facebook Pages | meta connection | flat monthly | pages |
| `meta.instagram` | Instagram Management and Publishing | meta connection | flat monthly | accounts, scheduled posts |
| `meta.pixel` | Pixel and Conversions API | meta connection | flat monthly | events/month |
| `meta.ads` | Ads Manager | meta connection | flat monthly + optional % of managed spend | ad accounts |
| `whatsapp.messaging` | WhatsApp Messaging | WABA | prepaid wallet + monthly | conversations, templates |
| `whatsapp.broadcast` | WhatsApp Broadcasts | `whatsapp.messaging` | usage-based | recipients |
| `tally.sync` | Tally Sync | agent paired | flat monthly per company | companies |
| `tally.invoicing` | Tally to WhatsApp Invoices and Reminders | `tally.sync`, `whatsapp.messaging` | flat monthly + wallet | messages |
| `google.reviews` | Google Reviews and Replies | google connection | flat monthly per location | locations |
| `google.autoreply` | Review Auto-Reply (AI drafts) | `google.reviews` | usage-based | drafts |
| `backup.export` | Backup and Export | none | flat monthly, tiered by destinations and frequency | backup runs, GB stored by platform |
| `backup.custom` | Custom Backup Provider | `backup.export` | one-time setup + monthly | provider adapters |
| `api.access` | Public API | none | flat monthly | requests/month |

Guides, status page, and in-app help are free for all workspaces.

Dependencies are enforced server-side: unlocking a service with an unmet prerequisite returns a typed error naming it.

Pricing is data in the control database. Price changes never require a deploy.

---

## 3. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node.js current LTS | Pin in `.nvmrc` and `engines`. |
| Framework | Next.js 16, App Router, React 19, Turbopack | `proxy.ts` replaces `middleware.ts`. |
| Language | TypeScript `strict`, `noUncheckedIndexedAccess` | |
| Package manager | pnpm workspaces + Turborepo | |
| Styling | Tailwind v4, shadcn/ui, `tw-animate-css` | |
| Toasts | Sileo | Wrapped in `@rsl/ui`. |
| Uploads | react-dropzone | UI only; bytes go direct to R2. |
| Auth | Better Auth (organization, access control, 2FA, social) | SQLite adapter via Drizzle. |
| Databases | SQLite via `better-sqlite3` (synchronous, fastest embedded driver for Node) | One control plane, one ingress, one platform-logs, per-tenant `data` and `logs`. |
| ORM and migrations | Drizzle ORM + drizzle-kit, custom fan-out runner | |
| SQLite replication | Litestream (continuous to R2) + scheduled snapshots | Pin a version; verify directory-replication support for the tenant count you expect. |
| SQLite search | FTS5 (inbox search, docs search) | Trigram tokenizer for typo-tolerant docs search. |
| Queue | Redis + BullMQ | `maxmemory-policy noeviction`, AOF `everysec`. |
| Storage | Cloudflare R2 | Presigned PUT/GET. |
| Validation | Zod | Shared across client, actions, API, jobs, docs. |
| Payments | Razorpay | Stripe only for international. |
| Email | Resend or SES | Transactional. |
| Backup crypto | `age-encryption` (age format) or libsodium secretstream | Streaming encryption. |
| Compression | zstd (`node:zlib` zstd support on current Node LTS) | Verify on pinned Node version. |
| Docs content | MDX files in repo, compiled with Next MDX support | Section 23. |
| Observability | Sentry, Pino, OpenTelemetry, bull-board (staff only) | |
| Tests | Vitest, Playwright, MSW | |
| Process manager | PM2 | |

Verify every version with `pnpm view <pkg> version` at scaffold time.

---

## 4. Monorepo layout and dependency rules

```
rsl-marketing/
├─ apps/
│  ├─ web/             customer app (includes authenticated /help routes)
│  ├─ admin/           internal console (includes internal staff docs)
│  ├─ docs/            public documentation site (guides, API reference, changelog)
│  ├─ worker/          BullMQ consumers split by lane (realtime, bulk, maintenance)
│  └─ tally-agent/     Windows service, separate release cycle
├─ packages/
│  ├─ config/          tsconfig, eslint, prettier, tailwind preset
│  ├─ ui/              design system, Sileo wrapper, dropzone wrapper, form kit
│  ├─ core/            env, errors + error catalog, Result, context (AsyncLocalStorage), crypto, ids
│  ├─ tenancy/         tenant registry, provisioning, handle manager, migration runner, routing
│  ├─ database/        Drizzle schemas: control, ingress, platform-logs, tenant-data, tenant-logs
│  ├─ auth/            Better Auth config, session helpers, guards
│  ├─ rbac/            permission catalog, roles, authorize()
│  ├─ billing/         services, prices, entitlements, ledger, invoices, Razorpay
│  ├─ logging/         defineAction/defineRoute/defineJob wrappers, action log, provider-call log, hash chain
│  ├─ queue/           queue registry, job envelopes, fairness, outbox dispatcher, DLQ
│  ├─ connections/     OAuth, token vault, refresh, health checks, rate limiter
│  ├─ inbox/           unified conversation model and reply pipeline
│  ├─ meta/            Graph client; ig, fb, pixel, capi, ads
│  ├─ whatsapp/        Cloud API client, templates, Embedded Signup, sender
│  ├─ google/          Business Profile client
│  ├─ tally/           voucher schema, mapping, sync protocol (shared with agent)
│  ├─ storage/         R2 client, presign, MIME/size policy
│  ├─ backup/          providers (Drive, S3, R2, S3-compatible), packager, crypto, restore
│  ├─ api-keys/        issuance, hashing, scopes, metering, test-mode keys
│  ├─ docs/            content loader, schemas, OpenAPI builder, sample generator, search indexer, linter
│  └─ notifications/   in-app, email, WhatsApp dispatch
├─ content/            all guides, API concept pages, changelog, internal runbooks (MDX)
├─ infra/
│  ├─ pm2/ecosystem.config.cjs
│  ├─ nginx/
│  ├─ litestream/
│  ├─ scripts/         backup, restore, deploy, migrate-tenants
│  └─ runbooks/
├─ .github/workflows/
├─ turbo.json
├─ pnpm-workspace.yaml
└─ package.json
```

Scope is `@rsl/*`. Rename to `@rsl-marketing/*` at scaffold time or never.

### Mapping from your original list

| Original | Result |
|---|---|
| `core` | `@rsl/core` |
| `auth` | `@rsl/auth`, `@rsl/rbac` |
| `database` | `@rsl/database`, `@rsl/tenancy` |
| `operations` | `@rsl/queue`, `@rsl/logging`, `@rsl/notifications` |
| `modules` | `@rsl/billing` (entitlements) |
| `connections`, `meta`, `google` | same names |
| new | `whatsapp`, `tally`, `inbox`, `storage`, `backup`, `api-keys`, `docs`, `ui`, `config` |

### Dependency rules (`eslint-plugin-boundaries`)

```
apps → feature packages → rbac, billing, logging, queue, connections → tenancy, database → core
```

- Feature packages (`meta`, `whatsapp`, `google`, `tally`, `inbox`, `backup`) never import each other.
- `core` imports nothing internal.
- Raw `better-sqlite3` or Drizzle client construction outside `@rsl/tenancy` and `@rsl/database` is a lint error.
- Provider SDK types never cross a package boundary.
- `@rsl/docs` may import Zod schemas and the route/error/permission registries; it never imports feature internals.

---

## 5. Bootstrap instructions

```bash
mkdir rsl-marketing && cd rsl-marketing
pnpm init && git init

cat > pnpm-workspace.yaml <<'EOF'
packages:
  - "apps/*"
  - "packages/*"
EOF

pnpm add -D -w turbo typescript prettier

# Apps
pnpm create next-app@latest apps/web   --ts --tailwind --app --turbopack --src-dir --import-alias "@/*" --use-pnpm
pnpm create next-app@latest apps/admin --ts --tailwind --app --turbopack --src-dir --import-alias "@/*" --use-pnpm
pnpm create next-app@latest apps/docs  --ts --tailwind --app --turbopack --src-dir --import-alias "@/*" --use-pnpm

# Web dependencies
pnpm --filter web add better-auth zod sileo react-dropzone tw-animate-css pino ulid
pnpm --filter web add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

# Database package
mkdir -p packages/database packages/tenancy && cd packages/database
pnpm init
pnpm add better-sqlite3 drizzle-orm
pnpm add -D drizzle-kit @types/better-sqlite3
cd ../..

# Worker
mkdir -p apps/worker/src && cd apps/worker
pnpm init
pnpm add bullmq ioredis pino zod better-sqlite3 drizzle-orm
pnpm add -D tsx typescript @types/node
cd ../..

# Backup package
mkdir -p packages/backup && cd packages/backup
pnpm init
pnpm add age-encryption @aws-sdk/client-s3 @aws-sdk/lib-storage @googleapis/drive
cd ../..

# Docs package (build-time tooling only)
mkdir -p packages/docs content/en && cd packages/docs
pnpm init
pnpm add zod gray-matter @next/mdx @mdx-js/loader remark-gfm
cd ../..
```

Host install (Oracle Ubuntu ARM): Redis, Litestream (linux-arm64 release binary), `sqlite3` CLI, PM2, Nginx.

Root scripts: `dev`, `build`, `typecheck`, `lint`, `test`, `db:migrate:control`, `db:migrate:tenants`, `docs:build`, `docs:lint`, `format`.

`turbo.json` minimum:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build", "docs:build"], "outputs": [".next/**", "dist/**"] },
    "docs:build": { "outputs": ["content-build/**"] },
    "typecheck": { "dependsOn": ["^typecheck"] },
    "lint": {},
    "test": { "dependsOn": ["^build"] },
    "dev": { "cache": false, "persistent": true }
  }
}
```

Commit hooks: lefthook or husky running typecheck, lint, and `docs:lint` on staged files. Conventional commits.

---

## 6. Environment variables

All access through `@rsl/core/env`, validated with Zod at boot.

```
# Core
NODE_ENV=
APP_URL=
ADMIN_URL=
DOCS_URL=
LOG_LEVEL=

# Data directories (must be local block storage, never NFS or object-store mounts)
DATA_DIR=/var/lib/rsl
LOG_DIR=/var/log/rsl
BACKUP_STAGING_DIR=/var/lib/rsl/staging
TENANT_DB_MAX_OPEN=200
TENANT_DB_IDLE_CLOSE_MS=300000

# Redis
REDIS_URL=

# Auth
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Encryption
KMS_MASTER_KEY=              # 32-byte base64, versioned
KMS_KEY_VERSION=
BACKUP_SIGNING_KEY=          # HMAC key for backup manifests, versioned
API_KEY_PEPPER=

# Meta
META_APP_ID=
META_APP_SECRET=
META_WEBHOOK_VERIFY_TOKEN=
META_GRAPH_VERSION=
META_CONFIG_ID=

# Google Business Profile and Drive backup
GBP_CLIENT_ID=
GBP_CLIENT_SECRET=
GDRIVE_BACKUP_CLIENT_ID=
GDRIVE_BACKUP_CLIENT_SECRET=

# Payments
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

# Platform storage (R2)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_PRIVATE=
R2_BUCKET_PUBLIC=
R2_BUCKET_PLATFORM_BACKUP=   # your own DR bucket, separate credentials
R2_PUBLIC_BASE_URL=

# Email
EMAIL_FROM=
RESEND_API_KEY=

# Observability
SENTRY_DSN=
OTEL_EXPORTER_OTLP_ENDPOINT=
```

No secret in `NEXT_PUBLIC_*`. `.env.example` is committed and checked for sync in CI.

---

## 7. Data architecture: SQLite and multiple databases

### 7.1 Topology

```
/var/lib/rsl/
├─ platform/
│  ├─ control.db          identity, tenancy, RBAC, billing, ledger, entitlements, connections + token vault,
│  │                      tenant registry, asset routing, API key index, agent devices, backup destinations
│  ├─ ingress.db          raw inbound webhooks before tenant routing; 7-day retention
│  └─ platform-logs.db    staff actions, impersonation, system events, cross-tenant rollups
├─ tenants/
│  └─ <tenantId>/
│     ├─ data.db          restorable business data
│     ├─ logs/
│     │  ├─ current.db    action log, provider calls, job runs, event log, send guards, suppressions, backup runs
│     │  └─ archive/YYYY-MM.db.zst
│     └─ meta.json        tenant id, schema versions, created at (informational; registry is authoritative)
└─ staging/               backup and restore scratch space
```

Permissions: `/var/lib/rsl` owned by the service user, mode `0700`. Tenant ids are ULIDs validated against `^[0-9A-HJKMNP-TV-Z]{26}$` before any path join.

### 7.2 What lives where, and why

| Database | Contents | Restorable by customer | Reason |
|---|---|---|---|
| `control.db` | Auth, memberships, roles, services, prices, entitlements, subscriptions, invoices, payments, **wallet ledger**, connections and encrypted tokens, API key index, backup destination secrets | No | Platform-owned. Rolling it back is fraud (wallet, entitlements) or a security failure (revoked tokens, keys). |
| `ingress.db` | Raw webhooks pending routing | No | Transient. |
| `platform-logs.db` | Staff and system logs | No | Internal. |
| `data.db` | Contacts, conversations, messages, reviews, campaigns, insights, posts, templates, broadcasts, reminder rules, Tally mirror, outbox, settings | **Yes** | The customer's business data. |
| `logs/current.db` | Action log, provider calls, job runs, event log, **send guards**, **suppressions (opt-outs)**, backup runs | No | Append-only history and non-rollbackable state: restoring an old file must not resend invoices or resurrect revoked WhatsApp consent. |

Wallet ledger in `control.db` means all tenants' debits write to one file. Mitigations: WAL, `synchronous=FULL` on this file only, short transactions, and a single-concurrency `billing.ledger` queue so writes are serialized without busy errors.

### 7.3 Pragmas (applied on every connection open)

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;        -- FULL for control.db
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA trusted_schema = OFF;
PRAGMA journal_size_limit = 67108864;
PRAGMA wal_autocheckpoint = 1000;
PRAGMA temp_store = MEMORY;
```

Write transactions use `BEGIN IMMEDIATE` to fail fast on contention instead of deadlocking on lock upgrade. Transactions are short; no network calls inside a transaction, ever.

### 7.4 Handle manager (`@rsl/tenancy`)

```ts
export function tenantDb(ctx: TenantContext, kind: "data" | "logs"): TenantDb;
export function controlDb(): ControlDb;
```

- `TenantContext` comes only from the authenticated session, API key, job envelope, or paired agent. Never from a request parameter.
- LRU cache of open handles capped at `TENANT_DB_MAX_OPEN`; idle handles close after `TENANT_DB_IDLE_CLOSE_MS`; `PRAGMA optimize` runs on close.
- Handle open checks `tenant_registry.status` (`active`, `restoring`, `migrating`, `suspended`, `migration_failed`, `deleted`) and refuses non-active states with a typed error.
- One handle per DB per process. WAL lets web, admin, and worker processes on the same host share files safely.
- Repositories receive a handle, never a raw tenant id string.

### 7.5 Provisioning

1. Workspace created in `control.db`.
2. `@rsl/tenancy` creates the directory, copies the template DB at the latest schema version, sets permissions.
3. Registry row written with schema versions and host.
4. Asset routing rows added as connections attach (`(provider, externalId) → tenantId`), used by webhook routing.

Deletion: mark `deleted`, retain per policy, then crypto-shred (delete files and wrapped keys), write a tombstone to `platform-logs.db`.

### 7.6 Migrations

- Schemas: `tenant-data`, `tenant-logs`, `control`, `ingress`, `platform-logs`, each versioned independently by Drizzle migration folders.
- Control, ingress, platform-logs: `pnpm db:migrate:control` before deploy.
- Tenants: `pnpm db:migrate:tenants` runs a fan-out on the `maintenance` lane.
  - Batches with a concurrency cap; resumable via `tenant_registry.*_schema_version`.
  - Canary first: 5 internal or low-risk tenants, halt on any failure.
  - Pre-migration snapshot (online backup API) kept 7 days.
  - Failure marks the tenant `migration_failed`, isolates only that tenant, alerts staff.
  - Lazy fallback: on open, if the tenant is behind the minimum required version, the handle manager migrates under a per-tenant lock.
- Rules: forward-only, expand/contract, no destructive change and dependent code in the same release.

### 7.7 SQLite tooling

| Need | Tool |
|---|---|
| Driver | `better-sqlite3` |
| Queries and types | Drizzle ORM |
| Migrations | drizzle-kit generate + custom fan-out runner |
| Continuous replication | Litestream to R2 (control, ingress, platform-logs, and tenant files) |
| Consistent snapshots | SQLite online backup API or `VACUUM INTO` |
| Developer inspection | Drizzle Studio (dev only), `sqlite3` CLI, DB Browser or Beekeeper Studio on restored copies |
| Staff production inspection | In-app **Tenant Inspector** in `apps/admin`: allowlisted read-only queries, read-only connection, every use audited. No free-form SQL console in production. |
| Offline analysis | Datasette against restored read-only copies |
| Size and fragmentation | `sqlite3_analyzer`, `dbstat` virtual table in a scheduled job |
| Encryption at rest | Volume encryption (LUKS) plus field-level encryption of secrets. SQLCipher via `better-sqlite3-multiple-ciphers` with per-tenant keys derived by HKDF only if a customer contract requires per-file encryption. |

Never place SQLite files on NFS, SMB, FUSE object-store mounts, or any filesystem without correct POSIX locking.

### 7.8 Maintenance schedule (worker `maintenance` lane)

| Task | Frequency |
|---|---|
| `PRAGMA wal_checkpoint(TRUNCATE)` | Nightly, low-traffic window, staggered per tenant |
| `PRAGMA quick_check` | Weekly per tenant |
| `PRAGMA integrity_check` | Monthly, and on every restore and migration |
| `VACUUM` | When freelist exceeds 30% and free disk exceeds 2x DB size |
| `PRAGMA optimize` | On handle close |
| Size and growth report to `tenant_metrics` | Daily |
| Log rollover to monthly archive | Monthly |

### 7.9 Scale limits and exit triggers

| Signal | Action |
|---|---|
| More than 500 active tenants on one host, or handle cache thrash | Shard tenants across hosts using `tenant_registry.host`; add a routing proxy |
| Busy-timeout errors above 0.1% of writes on `control.db` | Move control plane to Postgres behind the existing repository interface |
| Any tenant DB above 10 GB | Split heavy tables (inbox messages) into a per-tenant `inbox.db` or move the tenant to a dedicated host |
| Requirement for multi-host web/worker | Control plane to Postgres, tenants to libSQL server or per-host sharding |

The `@rsl/tenancy` abstraction contains the blast radius of these moves.

### 7.10 Cross-tenant questions

There is no cross-tenant SQL. Platform reporting uses nightly rollup jobs writing aggregates into `control.db` (`tenant_metrics`, `tenant_health`). Ad-hoc staff investigation of one tenant uses the Tenant Inspector.

---

## 8. Domain model by database

**`control.db`**
- Identity: `User`, `Session`, `Account`, `Verification`, `PlatformStaff`
- Tenancy: `Workspace`, `Membership` (roleId, assetScope), `Invitation`, `TenantRegistry` (id, host, path, status, schema versions, size, last backup), `AssetRouting`
- RBAC: `Role`, `RolePermission`
- Billing: `Service`, `ServicePrice`, `Entitlement`, `Subscription`, `Invoice`, `Payment`, `LedgerEntry` (append-only), `UsageEvent`
- Connections: `Connection` (encrypted tokens, scopes, status, expiry), `Asset`
- Platform: `ApiKey` (prefix, hash, scopes, workspace, mode `live|test`), `AgentDevice`, `BackupDestination` (encrypted config), `ProviderRequest`, `FeatureFlag`, `NotificationPreference`
- Rollups: `TenantMetrics`, `TenantHealth`, `LogAnchor`, `DocsFeedback`, `DocsSearchLog`

**`ingress.db`**: `WebhookInbox` (provider, eventId unique, raw body, headers, signature result, receivedAt, routedTenantId, status)

**`platform-logs.db`**: `StaffActionLog`, `ImpersonationLog`, `SystemEvent`, `TenantDeletionTombstone`

**Tenant `data.db`**
- Inbox: `Contact`, `Conversation`, `Message`, `MessageAttachment`, `Assignment`, `Label`, `InternalNote`, `CannedReply`
- Reviews: `Review`, `ReviewReply`
- Marketing: `Campaign`, `AdSet`, `Ad`, `Creative`, `InsightSnapshot`, `ScheduledPost`, `PostAttempt`
- WhatsApp: `WhatsAppTemplate`, `Broadcast`, `BroadcastRecipient`, `ReminderRule`, `OptIn` (consent evidence)
- Tally: `TallyCompany`, `TallyParty`, `TallyVoucher` (guid, alterId, hash), `SyncRun`
- System: `Outbox`, `Setting`, `SchemaMeta`

**Tenant `logs/current.db`**: `ActionLog`, `ProviderCall`, `JobRun`, `EventLog`, `SendGuard`, `Suppression`, `BackupRun`, `Diagnostic`

Indexes defined up front:
- `ActionLog (ts)`, `(actor_id, ts)`, `(action, ts)`, `(correlation_id)`
- `ProviderCall (correlation_id)`, `(provider, ts)`
- `JobRun (correlation_id)`, `(queue, status, ts)`
- `SendGuard` unique `(idempotency_key)`
- `TallyVoucher` unique `(guid)`
- `WebhookInbox` unique `(provider, event_id)`
- `LedgerEntry` unique `(workspace_id, idempotency_key)`

Money is integer minor units plus ISO currency. IDs are ULIDs (sortable, no collisions across tenant files, safe for merging exports).

---

## 9. Authentication and tenancy

- Better Auth: email + password (argon2), Google login, optional Meta login, TOTP 2FA (mandatory for owners and platform staff). Data in `control.db`.
- `apps/admin` runs a separate auth instance bound to `PlatformStaff`, separate cookie domain.
- Active workspace in session; switching verifies membership.
- Tenant isolation is physical (file per tenant) plus logical:
  - Context from session only; path built from validated ULID.
  - Repositories require a handle, not an id.
  - Isolation tests: for every repository method, create two tenants and assert the handle for A can never read B's file; fuzz path inputs for traversal.
- Invitations: signed, expiring, pre-assigned role. Ownership transfer requires re-authentication.

---

## 10. RBAC

**Scopes**: Platform (`super_admin`, `support`, `finance`); Workspace (`owner`, `admin`, `manager`, `agent`, `analyst`, `billing`, custom).

**Permission format**: `resource:action[.qualifier]`

```
workspace:manage         members:invite          members:remove          roles:manage
billing:view             billing:manage
connections:view         connections:manage
inbox:view  inbox:reply  inbox:assign  inbox:note
reviews:view reviews:reply reviews:autoreply.manage
posts:view posts:create posts:publish posts:schedule
ads:view ads:create ads:budget.edit ads:pause
pixel:view pixel:manage
whatsapp:send whatsapp:template.manage whatsapp:broadcast
tally:view tally:sync.manage tally:invoice.send
backup:view backup:manage backup:restore backup:destination.manage
apikeys:view apikeys:manage
logs:view logs:export
docs:internal.view       (platform staff only)
audit:view
```

| Role | Permissions |
|---|---|
| owner | all |
| admin | all except `billing:manage`, ownership transfer, `backup:restore` |
| manager | inbox, reviews, posts, `ads:view/create/pause`, `whatsapp:send`, `tally:view`, `logs:view` |
| agent | `inbox:view/reply/note`, `reviews:view/reply` |
| analyst | all `*:view`, no mutations |
| billing | `billing:*`, `audit:view` |

Asset scoping: `Membership.assetScope` restricts a member to specific asset ids.

```ts
export async function authorize(ctx: TenantContext, permission: Permission, resource?: { assetId?: string }): Promise<void>;
```

- Called by `defineAction`, `defineRoute`, `defineJob` (section 12.2); handlers cannot skip it.
- No role-name comparisons (`role === "admin"` is a lint error).
- UI uses `useCan()` for visibility only.
- Impersonation: platform staff only, reason required, 30-minute cap, persistent banner, every action logged with `impersonator_id`.
- The permission catalog is a registry consumed by the docs build to generate the role/permission matrix guide (section 23).

---

## 11. Billing, entitlements, and the admin console

### Entitlement check

```ts
await requireEntitlement(ctx.workspaceId, "meta.ads");
await consumeUsage(ctx.workspaceId, "whatsapp.messaging", { quantity: 1, dedupeKey });
```

Server-side at every gated action and job. Missing entitlement returns `EntitlementRequiredError` with the service key.

### Lifecycle

```
trialing → active → past_due → suspended → cancelled
```

- `past_due`: 7-day configurable grace, banner, dunning emails.
- `suspended`: UI read-only, jobs skip with `SUSPENDED` outcome, webhooks still stored, customer backups continue for 30 days so data is never trapped.
- `cancelled`: data retained for the retention window, then crypto-shredded. Customers can always run an export during retention.

### Wallet and ledger

- Prepaid wallet per workspace. `LedgerEntry` append-only, enforced by triggers rejecting UPDATE and DELETE. Balance is the sum.
- Reserve before send, finalize or refund on outcome, idempotency key per operation.
- Ledger lives in `control.db` (section 7.2). Low-balance notices at thresholds; send blocked at zero.

### Razorpay

- Subscriptions for recurring plans, Orders for top-ups and one-time unlocks.
- Webhook: verify signature, persist to `ingress.db`, enqueue; handler job updates `Payment`, `Invoice`, `Entitlement`.
- Daily reconciliation against settlements; drift raises an alert.
- GST invoices: sequential per financial year, GSTIN, HSN/SAC, CGST/SGST/IGST by place of supply, PDF stored in R2.

### Admin console (`apps/admin`)

| Screen | Capabilities |
|---|---|
| Customers | Search, status filter, create workspace for customer |
| Customer detail | Members, connections health, entitlements, wallet, invoices, backup health, tenant DB size, log summary |
| Entitlements | Grant, revoke, extend, override price, set limits, trial toggle |
| Services and pricing | CRUD, `effectiveFrom`, grandfathering |
| Payments | List, failed, dunning, manual record, refunds |
| Wallet | Manual credit/debit with mandatory reason |
| Invoices | Regenerate, resend, credit notes |
| **Log explorer** | Per tenant: action log, provider calls, jobs, events; correlation trace view; support bundle export (section 12.6) |
| **Tenant Inspector** | Read-only allowlisted queries on tenant DBs, audited |
| **Queue console** | bull-board behind staff auth, DLQ replay |
| **Provider requests** | Customer-requested backup providers, status, linked pricing |
| **Docs ops** | Docs feedback, zero-result searches, stale-guide report |
| Platform staff, feature flags, impersonation, system health | As previously defined |

Every mutation writes to `platform-logs.db` and, where tenant-scoped, to the tenant's action log.

---

## 12. Logging and diagnostics (per client, per action)

### 12.1 Log classes

| Class | Where | Purpose | Retention |
|---|---|---|---|
| **Action log** | tenant `logs/current.db` | Who did what, to which resource, outcome | 2 years (immutable) |
| **Provider call log** | tenant `logs/current.db` | Every outbound call to Meta, Google, WhatsApp, Drive, S3: status, latency, rate-limit headers, provider trace id | 30 days (errors 90) |
| **Job run log** | tenant `logs/current.db` | Every job attempt: queue, status, error, idempotency key | 90 days |
| **Event log** | tenant `logs/current.db` (normalized) and `ingress.db` (raw) | Inbound webhooks and their processing outcome | Normalized 90 days, raw 7 days |
| **Diagnostic log** | Pino NDJSON files in `LOG_DIR/<service>/YYYY-MM-DD.ndjson` | Developer-level application logs, always carrying tenant id and request id | 30 days |
| **Platform log** | `platform-logs.db` | Staff actions, impersonation, system events | 2 years |

Per-client segregation is physical: each tenant's action, provider, job, and event logs are in that tenant's own file, separate from its business data, so log volume never bloats `data.db` and one tenant's investigation never touches another's records.

### 12.2 Capture is structural, not optional

Every entry point goes through a wrapper that performs authorize, entitlement check, Zod validation, timing, error mapping, and logging. Handlers cannot opt out.

```ts
export const replyToConversation = defineAction({
  key: "inbox.reply.sent",
  permission: "inbox:reply",
  service: "inbox",
  input: ReplySchema,
  async handler(ctx, input) { /* business logic only */ },
});
```

- `defineAction` for Server Actions, `defineRoute` for Route Handlers and public API, `defineJob` for worker jobs, `defineAgentEndpoint` for Tally agent calls.
- Lint rule: exporting a Server Action, route handler, or job handler not built with these wrappers fails CI.
- Provider clients log through a shared `instrumentedFetch` that writes `ProviderCall` rows; no raw `fetch` to provider hosts (lint).

### 12.3 Request context

`AsyncLocalStorage` carries `{ tenantId, actorType, actorId, impersonatorId, requestId, correlationId, source }`.

- `requestId`: generated at the edge per HTTP request.
- `correlationId`: generated at the first user-initiated action and propagated into job envelopes, provider calls, and webhook processing, so one user action can be traced through every hop.
- Every Pino line, action row, provider row, and job row carries them.

### 12.4 Action log schema (tenant `ActionLog`)

| Column | Notes |
|---|---|
| `id` | ULID |
| `ts` | UTC epoch ms |
| `actor_type` | `user`, `api_key`, `system`, `agent`, `staff`, `webhook` |
| `actor_id`, `impersonator_id` | |
| `source` | `web`, `api`, `worker`, `agent`, `webhook` |
| `action` | Dotted key from a registry, e.g. `inbox.reply.sent` |
| `resource_type`, `resource_id`, `asset_id` | |
| `outcome` | `success`, `denied`, `error`, `skipped` |
| `error_code` | Catalog code (section 12.7) |
| `request_id`, `correlation_id` | |
| `ip`, `user_agent` | Hashed IP option per tenant policy |
| `duration_ms` | |
| `summary` | Redacted before/after summary, never raw bodies |
| `prev_hash`, `hash` | Hash chain (below) |

- Append-only: triggers reject UPDATE and DELETE (retention purge runs as a privileged maintenance routine that archives whole months, never individual rows).
- Tamper evidence: each row stores `hash = H(prev_hash || canonical_row)`. A daily job writes the day's final hash to `control.db.LogAnchor`. Verification recomputes the chain and compares to anchors.
- The action registry (`@rsl/logging`) lists every valid action key with description and severity; docs build uses it to publish the "What is recorded" page.

### 12.5 Provider call log

Columns: `ts`, `provider`, `operation` (route template, never a URL with tokens), `method`, `status`, `latency_ms`, `retry_count`, `rate_limit_state`, `provider_request_id` (e.g., Meta `fbtrace_id`), `error_code`, `correlation_id`. Request and response bodies are stored only on error, redacted, truncated to a size cap, and expire in 14 days.

### 12.6 Viewing, tracing, and support bundles

- **Customer view** (`web`, permission `logs:view`): action log with filters (actor, action, outcome, date, resource). Export requires `logs:export`.
- **Staff Log explorer** (`admin`): choose tenant, time range, outcome, action, error code, correlation id.
- **Trace view**: given a `correlationId`, merges `ActionLog`, `ProviderCall`, `JobRun`, `EventLog` into a timeline.
- **Support bundle**: redacted ZIP of the last N hours for a tenant (logs, queue state, connection health, registry row), created through an audited action, linked to the support ticket.
- Issue detection: nightly and hourly rollups compute per-tenant error rate by integration, job failure rate, and webhook lag into `control.db.TenantHealth`; thresholds raise staff alerts and customer notifications.

### 12.7 Error catalog

All typed errors register in `@rsl/core` with `code` (`RSL-<DOMAIN>-<NNNN>`, e.g. `RSL-WA-1003`), HTTP status, user message, remediation text, `docsSlug`, retryability.

The same catalog feeds: UI toasts (with a "Learn more" link), API error envelope, action and job logs, and generated documentation pages. One source of truth.

### 12.8 Redaction and privacy

- Pino `redact` paths for tokens, API keys, authorization headers, phone numbers, emails, message bodies. A test asserts redaction on every log helper.
- Customer message content is never written to diagnostic logs; action log summaries reference ids.
- Hashed identifiers in diagnostics (HMAC of phone) so staff can correlate without seeing PII.
- Staff access to tenant logs is itself audited and requires a ticket reference.

### 12.9 Rotation and archival

- Monthly job moves rows older than the hot window from `current.db` to `archive/YYYY-MM.db.zst`, keeps the hash chain continuous by recording the boundary hash, and uploads archives to cold storage (R2, platform bucket).
- Archived months are restorable for investigation without bloating the hot file.

---

## 13. Connections (OAuth and token vault)

**Shared flow**
1. Connect → server creates `state` (random, bound to workspace and user, 10-minute expiry) and PKCE verifier where supported.
2. Provider redirect, callback validates state, exchanges code.
3. Asset list fetched; user selects which assets attach.
4. Tokens encrypted into `control.db`, asset routing rows created.

**Vault**
- Envelope encryption: per-record data key, AES-256-GCM, unique IV, master key version stored with ciphertext, rotation supported.
- Decryption only inside `@rsl/connections`; other packages receive an authenticated client.
- Connection tokens are never in tenant files, so tenant backups and exports cannot leak or restore them.

**Meta**: long-lived tokens; prefer System User tokens for ad accounts and WABA where possible; store granted permissions and detect under-scoped connections.

**Google**: offline access, refresh token stored, `invalid_grant` marks `needs_reauth`.

**Health checker (every 6 hours)**: cheap authenticated call per connection; statuses `healthy`, `expiring`, `needs_reauth`, `revoked`, `under_scoped`; notifies owners; feeds the per-integration health page and the guides' live status panels (section 23).

**Rate limiter**: Redis token bucket per `(provider app, asset)`; honors `X-Business-Use-Case-Usage` and `X-App-Usage` headers and backs off dynamically.

**Required callbacks**: Meta deauthorize and data-deletion callbacks with status URL. Disconnect revokes at the provider and purges ciphertext.

---

## 14. Queue system design

### 14.1 Decision

Redis + BullMQ is the queue. SQLite is the durable record. Redis loss must be recoverable from SQLite without losing or duplicating work.

Redis configuration: AOF `appendfsync everysec`, `maxmemory-policy noeviction` (BullMQ requirement), bound to localhost, password set, `maxmemory` below host RAM with alerting at 70%.

### 14.2 Worker topology (isolation by lane)

| Process | Queues | Reason |
|---|---|---|
| `worker-realtime` | `webhooks.*`, `outbound.whatsapp`, `outbound.meta`, `outbound.google`, `billing.ledger` | Latency-sensitive. Must never be starved. |
| `worker-bulk` | `broadcast.fanout`, `insights.sync`, `publishing`, `reminders`, `tally.ingest`, `backup.run`, `uploads.scan`, `docs.reindex` | Throughput work |
| `worker-maintenance` | `tenant.migrate`, `connections.health`, `billing.dunning`, `logs.rollover`, `db.maintenance`, `purge`, `reconcile` | Scheduled housekeeping |

A backup or broadcast can never delay a customer reply, a webhook, or a ledger write.

### 14.3 Job envelope

Every job payload is validated against a Zod schema registered per job type.

```ts
{
  v: 1,
  type: "outbound.whatsapp.send",
  tenantId, correlationId, requestId,
  actor: { type, id },
  idempotencyKey,
  payload: { ... }
}
```

BullMQ `jobId` is deterministic (derived from the idempotency key) so duplicate enqueues collapse.

### 14.4 Transactional outbox

SQLite and Redis cannot commit atomically. Pattern:

1. Business change and an `Outbox` row commit in one tenant `data.db` transaction.
2. After commit, the code enqueues immediately and marks the outbox row `enqueued`.
3. If the process dies between commit and enqueue, the row stays `pending`. A sweeper finds it.
4. To avoid scanning every tenant, writers `SADD outbox:dirty <tenantId>` in Redis after commit; the sweeper only opens tenants in that set (plus a slow full sweep hourly to cover Redis loss).

### 14.5 Idempotency and send guard

- Before any provider send, insert a `SendGuard` row `(idempotency_key, state=reserved)` in the tenant's `logs/current.db` (not restored by backups).
- States: `reserved` → `sent` → `confirmed` | `failed`.
- A retry that finds `sent` or `confirmed` exits successfully. A retry that finds `reserved` older than a threshold marks `uncertain` and does not auto-resend (the provider may have accepted the call); reconciliation uses delivery-status webhooks or a manual action.
- Suppression (opt-out) checks read `Suppression` in the same file.

### 14.6 Fairness and noisy neighbors

OSS BullMQ has no per-group fairness. Controls:

- Per-tenant concurrency semaphore in Redis (key `sem:<queue>:<tenantId>`, TTL-based); an over-limit job is re-delayed with jitter instead of occupying a worker slot.
- Per-`(tenant, provider)` token bucket on top of the global per-app bucket.
- Fan-out for large work: a broadcast creates a parent and child jobs in chunks (e.g., 50 recipients each) using BullMQ flows, so one tenant's 100,000-recipient broadcast interleaves with others.
- Priorities: user-initiated replies above automated reminders above bulk.
- Per-tenant caps by plan, enforced at enqueue and returned to API clients as `429` with `Retry-After`.

### 14.7 Retry and failure classes

| Class | Examples | Behavior |
|---|---|---|
| Retryable | Network, timeout, 429, 5xx | Exponential backoff with jitter, per-queue max attempts |
| Rate limited | Provider throttling | Re-delay to the provider-indicated time, do not consume attempts |
| Non-retryable | Validation, permission, template rejected | `UnrecoverableError`, no retry, log with catalog code |
| Auth failure | Token revoked or expired | Mark connection `needs_reauth`, **pause that connection's jobs** (circuit breaker), notify, resume on reconnect |
| Suspended | Entitlement inactive | Skip with `SUSPENDED` outcome, no retry burn |

### 14.8 Dead letters and replay

- Exhausted jobs move to the BullMQ failed set and are copied into the tenant `JobRun` table with status `dead` and full error context.
- Staff replay from the Queue console; replay re-validates the payload and relies on the idempotency key and send guard to prevent duplicates.
- Dead-letter growth is alerted per queue and per tenant.

### 14.9 Scheduling

- Global schedules (health checks, rollups, dunning, reconcile, purge, log rollover) use BullMQ job schedulers, defined in code and upserted on boot.
- Per-tenant schedules (reminders, content publishing, backups) do not create one repeatable job per tenant. Each tenant's next-due times are indexed in a Redis sorted set (`due:<kind>`, score = timestamp, member = tenantId). A once-per-minute dispatcher pops due members and enqueues per-tenant jobs. The source of truth for schedule definitions stays in `data.db` (and `control.db` for backups); the sorted set is rebuilt on boot from the registry.

### 14.10 Timeouts and shutdown

- Every job runs with an `AbortSignal` and a hard timeout; provider calls inherit it.
- Lock duration tuned per queue; stalled-job detection on; long jobs renew locks.
- Graceful shutdown: stop fetching, finish in-flight jobs up to a deadline, release the rest, close SQLite handles.

### 14.11 Backpressure and recovery

- Enqueue refuses beyond per-queue depth limits for API-originated work.
- `queue.rehydrate` rebuilds Redis from SQLite after loss: pending outbox rows, non-terminal `JobRun` rows, and schedule indexes.
- Metrics per queue: waiting, active, delayed, failed, oldest-job age, per-tenant top consumers. Alerts on oldest-job age and DLQ growth.

### 14.12 Queue registry

| Queue | Concurrency | Rate limit | Attempts | Notes |
|---|---|---|---|---|
| `webhooks.meta` / `.whatsapp` / `.google` / `.razorpay` | 20 | none | 8 | Process from `ingress.db` |
| `outbound.whatsapp` | 10 | per WABA tier and quality rating | 5 | Window and opt-in enforced |
| `outbound.meta` | 10 | per app/asset buckets | 5 | |
| `outbound.google` | 5 | per project QPM | 5 | |
| `billing.ledger` | 1 | none | 10 | Serializes control.db writes |
| `broadcast.fanout` | 4 | per tenant | 3 | Chunked children |
| `insights.sync` | 4 | per ad account | 5 | |
| `publishing` | 4 | per asset | 5 | Status polling |
| `reminders` | 6 | per tenant | 5 | Quiet hours aware |
| `tally.ingest` | 4 | per tenant | 5 | |
| `backup.run` | 2 global, 1 per tenant | none | 3 | Memory and disk bounded |
| `uploads.scan` | 2 | none | 3 | ClamAV |
| `tenant.migrate` | 2 | none | 1 | Halts on failure |
| `connections.health`, `billing.dunning`, `logs.rollover`, `db.maintenance`, `purge`, `reconcile` | 1 to 2 | none | 3 | Scheduled |

---

## 15. Meta (Instagram, Facebook, Pixel, Ads)

Sub-modules in `@rsl/meta`: `graph`, `facebook`, `instagram`, `pixel`, `capi`, `ads`.

**Base client**: pinned Graph version from env, timeout, retry, circuit breaker, typed error mapping to the catalog, appsecret proof, `instrumentedFetch` for provider call logs.

**Facebook Pages**: list, publish, read and reply to comments, hide, delete. Messenger via webhooks into `inbox`.

**Instagram**: Business/Creator accounts linked to Pages. Publishing: container create, poll status, publish; per-format constraints (feed, reel, story, carousel). Comments and DMs via webhooks. Messaging window rules respected.

**Pixel and CAPI**: list and attach pixels; server events with `event_id` for dedup, SHA-256 normalized user data, `test_event_code`, Event Match Quality in UI.

**Ads**: campaign, ad set, ad, creative CRUD, pause/resume, budgets, schedules. Creatives uploaded to R2, validated, pushed to Meta. Insights synced into `InsightSnapshot` on schedule; pages read from the tenant DB only. Budget changes over a threshold require `ads:budget.edit` and are logged with before/after. Rules engine in a later phase.

**App Review inventory** (confirm current list before submission): `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_metadata`, `pages_messaging`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_messages`, `ads_management`, `ads_read`, `business_management`, `whatsapp_business_management`, `whatsapp_business_messaging`. Each needs a screencast and use-case text. The guides in section 23 double as reviewer-facing evidence of the user flow.

---

## 16. WhatsApp

**Onboarding**: Embedded Signup, capture WABA id and phone number id, store as assets, subscribe webhooks, register number.

**Sender rules (`@rsl/whatsapp/sender`)**
- Inside the 24-hour window: free-form allowed. Outside: approved template only.
- Opt-in required for template sends; consent evidence in `OptIn`; opt-outs in `Suppression` (non-restorable file).
- Idempotency via `SendGuard` (section 14.5).
- Delivery webhooks update status (`sent`, `delivered`, `read`, `failed`); error codes map to catalog entries.
- Pricing category recorded per message for wallet debit.

**Templates**: create, edit, track `PENDING | APPROVED | REJECTED | PAUSED`, surface rejection reasons; variable mapping UI from template placeholder to data field.

**Broadcasts**: audience segments with automatic opt-in filtering, throttled by quality rating and tier, pre-flight cost estimate against wallet, pause/cancel, per-recipient status.

**Quality monitoring**: poll quality rating and messaging tier, alert on degradation.

---

## 17. Tally integration

```
Tally Prime (customer PC) ←XML/HTTP localhost:9000→ tally-agent ──HTTPS outbound──► /api/agent/* → tally.ingest
```

**Agent**
- Go (preferred) or Node packaged binary, installed as a Windows service, signed auto-updates.
- Pairing: one-time code (15 minutes) exchanged for a machine-bound device credential, revocable from the web app.
- Every request signed with HMAC over body and timestamp; 5-minute replay window.
- Sync loop: companies → vouchers with `ALTERID` above cursor → content hash → batched deltas → cursor advances on server acknowledgment only.
- Local SQLite queue for unsent batches, backoff, offline tolerance, heartbeat every minute.
- Test cases: special characters in company names, cancelled and deleted vouchers, altered already-sent vouchers, multi-currency, large ranges (chunk by month), Tally busy or closed.

**Server**: `POST /api/agent/pair`, `/heartbeat`, `/vouchers`, `GET /config`. Ingest upserts `TallyVoucher` by `guid`, records `alterId` and `hash`, writes `SyncRun`. Agent endpoints use `defineAgentEndpoint` so every call is logged to the tenant's action log.

**Mapping and sending**
- Rules: voucher type plus conditions maps to a template and variable map.
- Party to phone from the Tally master with manual override and E.164 validation.
- Send idempotency key: `tenantId + voucherGuid + sendKind`. Alterations do not resend unless the rule allows and the user confirms.
- Reminders from the outstanding bills report: days before/after due, max count, quiet hours, timezone; cancelled when a receipt voucher arrives.
- Invoice PDF: server-rendered or from Tally print output via the agent, stored in R2, sent as template document header or media.
- Customer replies land in the inbox with the voucher attached.

**Release**: own versioning and changelog, MSI/NSIS installer, code-signing certificate budgeted. The Tally guide set (section 23) includes firewall, antivirus, and Tally-configuration troubleshooting since this is the highest-support-load integration.

---

## 18. Google Business Profile

- Separate OAuth consent from login, Business Profile scope.
- Accounts, locations, reviews, posts, Q&A, media, insights.
- Reviews ingested by schedule (Pub/Sub notifications where available), deduped by review id, edits detected.
- Replies: human replies from the inbox; AI drafts under `google.autoreply` require approval by default; auto-publish only above a rating threshold the workspace enables explicitly.
- Quota-aware queue with backoff.
- Posts: standard, offer, event; media from R2; scheduled through `publishing`.
- Reporting: rating trend, response rate, response time per location.

---

## 19. Unified inbox

- Model: `Contact` (cross-channel identity), `Conversation` (channel, external thread id, status, assignee, SLA), `Message`.
- Channels: Instagram DMs and comments, Messenger and Facebook comments, WhatsApp, Google reviews.
- Assignment (manual, round-robin, load-based), statuses (`open`, `pending`, `resolved`, `snoozed`), internal notes with mentions, labels, saved filters, canned replies with variables, SLA timers with breach alerts.
- Composer shows channel rules (WhatsApp window indicator, Instagram window) and a template picker outside the window.
- Real-time: Server-Sent Events backed by Redis pub/sub.
- Search: FTS5 virtual table in each tenant's `data.db`.
- Attachments via R2 signed URLs, type validation per channel.
- Every reply, assignment, note, and status change is an action-log entry.

---

## 20. Public API and API keys manager

**Key format**: `rsl_live_<prefix8>_<secret32>` and `rsl_test_<prefix8>_<secret32>`. Secret shown once.

**Storage** (`control.db`): prefix (indexed), SHA-256 hash with `API_KEY_PEPPER`, scopes, workspace, mode, creator, `lastUsedAt`, `expiresAt`, `revokedAt`, per-key rate limit.

**Verification**: lookup by prefix, constant-time hash compare, expiry and revocation, entitlement `api.access`, scope for route, rate limit, usage metering, action log entry.

**Test mode**: `rsl_test_` keys resolve to a sandbox tenant (flagged `mode=test`) with stubbed provider adapters: no real sends, no wallet debit, deterministic fixtures. This powers the "Try it" console and safe integration testing (section 23.6).

**Manager UI**: create with scopes and expiry, rotate (overlap window), revoke, usage chart, last-used IP, outbound webhook endpoints with signing secrets, delivery log, retries, and a "send test event" button.

**API design**
- REST under `/api/v1`, cursor pagination, `Idempotency-Key` header on POST, consistent error envelope carrying catalog `code` and `docs_url`, rate-limit headers.
- Routes are defined with `defineRoute`, which registers: path, method, Zod input and output, required scopes, permission, entitlement, rate limit class, idempotency support, possible error codes, and examples. This registry is the **single source of truth** for the OpenAPI document and the API reference (section 23.4).
- Outbound webhooks: signed (`RSL-Signature` HMAC with timestamp), retried with backoff, event catalog documented from a Zod event registry.

---

## 21. Storage (Cloudflare R2)

- Buckets: private (invoices, media, Tally PDFs, exports), public (only what must be public, custom domain, cached), platform-backup (your DR, separate credentials, object lock if available).
- Key layout: `{tenantId}/{category}/{yyyy}/{mm}/{ulid}.{ext}`.
- Upload: client requests presigned PUT from a Server Action (after `authorize` and category policy on declared type and size), browser uploads directly, client confirms, server `HEAD`s the object, sniffs magic bytes, records the file row.
- Download: short-lived presigned GET only.
- Policy per category: allowed types, max size, max count per tenant.
- ClamAV scan through `uploads.scan`; files quarantined until clean.
- Lifecycle: temp uploads expire in 24 hours; retention per category.
- Media referenced by `data.db` rows is included in customer backups only when the user selects "include files" (section 22.3).

---

## 22. Customer backup, export, and restore

### 22.1 Two separate programs

| Program | Owner | Purpose | Scope |
|---|---|---|---|
| Platform disaster recovery | You | Recover the platform after host loss | All databases via Litestream and snapshots to your R2 bucket |
| Customer backup (`backup.export`) | Customer | Customer-owned copy of their data at a destination they control | Their `data.db` snapshot, optional files, optional action log export |

Platform DR is mandatory and invisible to customers. Customer backup is a paid service.

### 22.2 Destinations

| Provider | Auth | Notes |
|---|---|---|
| Google Drive | OAuth, narrowest scope `drive.file` (app-created files only), visible folder "RSL Backups" | Resumable uploads; quota and revoked-token errors mapped to catalog; verify via Drive-reported checksum |
| AWS S3 | Preferred: cross-account IAM role with external id. Fallback: access key | Minimal IAM policy published in the guide: `PutObject`, `GetObject`, `ListBucket` on the prefix, `DeleteObject` only if retention pruning is enabled |
| Cloudflare R2 | S3-compatible API token | Customer's own account and bucket |
| Generic S3-compatible | Endpoint, region, key | Backblaze B2, Wasabi, MinIO, DigitalOcean Spaces |
| Later via request | Dropbox, OneDrive, SFTP, WebDAV, others | See 22.8 |

Provider interface (`@rsl/backup`):

```ts
interface BackupProvider {
  validate(config): Promise<ValidationResult>;           // write-read-delete sentinel object
  put(stream, key, meta): Promise<PutResult>;            // streaming, multipart/resumable
  list(prefix): AsyncIterable<RemoteObject>;
  get(key): Promise<ReadableStream>;
  delete(key): Promise<void>;
  quota?(): Promise<Quota>;
}
```

Destination configuration and credentials are stored encrypted in `control.db.BackupDestination`, never in the tenant file. Credentials are shown once, validated on save, and revalidated weekly. Three consecutive failures mark the destination `degraded` and notify owners.

### 22.3 Backup contents

| Included | Excluded |
|---|---|
| `data.db` snapshot (online backup API, integrity-checked) | Connection tokens and credentials |
| Manifest (tenant id, schema versions, app version, created at, checksums, file list) | API key secrets, auth data |
| Optional: R2 files referenced by the data (invoices, media) | Wallet ledger, entitlements, invoices of the platform |
| Optional: action log export (read-only history) | Consent suppressions and send guards (they stay on the platform) |

After a restore, customers reconnect integrations; tokens are not part of any export.

### 22.4 Packaging, encryption, upload

```
snapshot → quick/integrity check → manifest + HMAC signature → tar → zstd → encrypt (streaming) → multipart upload → verify remote size/checksum → record BackupRun
```

- Streams end to end; no full-file buffering in memory; staging space bounded by `BACKUP_STAGING_DIR` quotas.
- Encryption modes:
  - **Platform-managed key** (default): per-backup data key wrapped by a per-workspace key; the platform can restore for the customer.
  - **Customer-held key**: age recipient public key supplied by the customer; the platform cannot decrypt. Losing the private key means losing the backup. The UI says so before enabling.
- Signature: HMAC over manifest and ciphertext digest with `BACKUP_SIGNING_KEY` (versioned) so the platform can prove a restore file originated from it.

### 22.5 Scheduling and retention

- Schedules: manual, daily, weekly, monthly, per destination, timezone-aware. Due times indexed in the Redis sorted set (section 14.9); jobs run in `worker-bulk`, 1 per tenant, 2 global.
- Retention per destination: keep last N or grandfather-father-son. Pruning requires delete permission at the destination; if absent, the UI shows retention as unmanaged.
- Size and frequency limits by plan; platform egress cost tracked per tenant in `UsageEvent`.
- History in `BackupRun` (tenant logs): status, size, duration, destination, error code, checksum. Failure notifications through `notifications`.

### 22.5.1 Portable export (separate from restore-grade backups)

CSV and JSON export of contacts, conversations, reviews, vouchers, and campaigns for DPDP/GDPR requests and migration away. Generated from `data.db` with ULIDs preserved; delivered to a destination or as a time-limited R2 download.

### 22.6 Restore

Restore is the dangerous half and gets the stricter controls.

1. Permission `backup:restore` (owner only by default), re-authentication, and 2FA step-up.
2. Source: a configured destination or an uploaded file. Uploaded or fetched files are untrusted: verify manifest signature and checksums first; **reject any file without a valid platform signature**. (A user-supplied SQLite file is an attack surface: crafted schemas, triggers, and views.)
3. Decrypt (platform-managed key or customer private key supplied in the session, never stored).
4. Open the staged copy with `trusted_schema=OFF`, compare the schema against the expected Drizzle schema (reject extra triggers, views, or tables), run `integrity_check`.
5. Migrate the staged copy to the current schema version.
6. Set tenant status `restoring`: pause the tenant's queues, block UI writes with a maintenance notice.
7. Take a pre-restore snapshot of the live `data.db` (kept 7 days).
8. Atomically swap files, close and reopen handles.
9. Post-restore reconciliation:
   - Reminders and broadcasts stay **paused** until the owner confirms.
   - Provider backfill jobs re-sync data since the backup timestamp (messages, reviews, Tally vouchers).
   - `SendGuard` and `Suppression` (not restored) prevent duplicate sends and honor opt-outs recorded after the backup.
10. Status back to `active`. Everything is logged to the action log and `platform-logs.db`.

Rate limit: restores limited per tenant per day; every restore requires an explicit confirmation naming the backup timestamp.

### 22.7 Admin and monitoring

Per tenant: last success, next run, size trend, destination health, failures, restore history. Staff can force a run, view destination type (never credentials), and open provider requests. Fleet alerts: tenants with no successful backup in twice their schedule interval.

### 22.8 "Backup to any provider on request"

- In-app form creates a `ProviderRequest` (provider name, URL, API type, urgency, contact), visible in the admin queue.
- Triage rule: S3-compatible or WebDAV/SFTP providers are configuration only and enabled by staff with no code. Anything else needs a new adapter implementing `BackupProvider` (typically 1 to 3 days including tests against a sandbox account).
- `backup.custom` is the priced add-on covering adapter work and ongoing maintenance; the request record links to the invoice.
- New adapters ship behind a feature flag per workspace until validated.

---

## 23. Guides and documentation system (custom built)

### 23.1 Boundary

Allowed: build-time libraries (MDX compiler, remark plugins, a syntax highlighter such as Shiki), Zod, SQLite FTS5.
Not allowed: hosted or packaged documentation products or renderers (Scalar, Swagger UI, Redoc, Docusaurus, Mintlify, GitBook, ReadMe, Algolia DocSearch, and similar), and third-party analytics on docs.

Everything user-visible (layout, navigation, API reference renderer, search, code-sample tabs, "Try it" console) is built in `@rsl/ui` and `apps/docs`.

### 23.2 Surfaces

| Surface | App | Audience | Content |
|---|---|---|---|
| Public docs | `apps/docs` at `docs.<domain>` | Prospects, developers, Meta and Google reviewers | Getting started, concept guides, integration guides, API reference, error catalog, changelog, status links |
| In-app help | `apps/web` under `/help/*` and a help drawer | Signed-in users | Same content, **personalized** with workspace state |
| Staff docs | `apps/admin` under `/docs/*` | Platform staff | Runbooks, support playbooks, per-error remediation, tenant investigation guides |

One content source (`content/`), three renderers. Public pages are statically generated and revalidated on deploy.

### 23.3 Content system

```
content/
├─ en/
│  ├─ getting-started/
│  ├─ guides/
│  │  ├─ workspaces-and-roles/
│  │  ├─ services-and-billing/
│  │  ├─ integrations/
│  │  │  ├─ meta-facebook/ meta-instagram/ meta-pixel-capi/ meta-ads/
│  │  │  ├─ whatsapp/ tally/ google-business-profile/
│  │  ├─ inbox/
│  │  ├─ backups/
│  │  ├─ logs-and-audit/
│  │  └─ security-and-privacy/
│  ├─ api/                  hand-written concept pages: auth, keys, scopes, pagination, idempotency, rate limits, errors, webhooks, test mode
│  ├─ reference/            GENERATED, gitignored
│  ├─ errors/               GENERATED from the error catalog
│  └─ changelog/
├─ internal/                staff-only runbooks
```

**Frontmatter (validated by Zod at build)**

```yaml
title: Connect WhatsApp Business
slug: guides/integrations/whatsapp/connect
summary: Onboard a WhatsApp number with Embedded Signup.
service: whatsapp.messaging          # links to the service catalog
requires:
  permissions: [connections:manage]  # checked against the permission registry
  prerequisites: [meta-business-verified]
audience: workspace-admin
lastVerified: 2026-11-01
appVersion: 1.0.0
helpKeys: [whatsapp.connect]         # UI "?" links resolve by key
related: [guides/integrations/whatsapp/templates]
```

**Standard guide structure**: Goal, Before you start (services, permissions, prerequisites generated from frontmatter), Steps, Verify it worked, Common problems (linked to catalog codes), Related guides, Last verified.

**Custom MDX components** (in `@rsl/ui/docs`): `Callout`, `Steps`, `Step`, `Tabs`, `CodeTabs` (curl, JavaScript, Python, PHP, Go), `CodeBlock` with copy, `PermissionBadge`, `ServiceBadge`, `ErrorCode`, `Screenshot` (with caption and freshness date), `Diagram` (SVG from source), `LiveStatus`, `Checklist`.

### 23.4 API reference (custom renderer)

Pipeline: route registry (`defineRoute`) → internal OpenAPI 3.1 document → renderer.

- `/api/v1/openapi.json` is published so customers can import it into their own tools; our renderer does not depend on any external viewer.
- Renderer features:
  - Sidebar by resource, search, deep links per operation.
  - Endpoint page: method badge, path, summary, required scopes and permission, required service, rate-limit class, idempotency support, test-mode behavior.
  - Parameter and body schema trees (collapsible, required markers, enums, defaults, constraints) rendered directly from Zod-derived JSON Schema.
  - Response schemas per status, error codes linked to the catalog.
  - Generated examples (from route-registered examples) and code samples in curl, JavaScript (fetch), Python (requests), PHP (cURL), Go (net/http), produced by an in-house generator from the operation definition.
  - Pagination, idempotency, and auth snippets reused from concept pages.
- **Webhook reference**: event catalog with payload schemas, signature verification samples per language, retry policy, and a replay tester.
- **Deprecation**: operations carry `deprecated`, `sunsetDate`, `replacement`; renderer shows banners; the response includes `Deprecation` and `Sunset` headers.
- **Breaking-change detector**: CI diffs the generated OpenAPI against the last released snapshot and fails on breaking changes inside `/v1`.

### 23.5 Integration guides (content plan)

| Area | Guides |
|---|---|
| Start | What is RSL Marketing, create workspace, invite team, onboarding checklist |
| Roles | Roles and permissions matrix (generated from RBAC registry), asset-scoped access, custom roles |
| Services and billing | How services work, unlock a service, wallet and top-ups, invoices and GST, past-due and suspension behavior, what happens to your data |
| Meta Facebook | Prerequisites (Business Manager, admin role), connect, choose Pages, permission explanations, disconnect, troubleshooting |
| Meta Instagram | Link IG to Page, connect, publishing limits per format, scheduling, comment and DM handling |
| Pixel and CAPI | Select pixel, send server events, deduplication with `event_id`, test events, Event Match Quality |
| Meta Ads | Connect ad account, create campaign, budgets and guardrails, reading insights, approvals |
| WhatsApp | Embedded Signup walkthrough, 24-hour window explained, writing templates that get approved, opt-in and consent, opt-out handling, pricing categories and wallet, quality rating and tier limits, broadcasts |
| Tally | Requirements, install the agent, pair, firewall and antivirus notes, enable Tally XML port, choose companies, map vouchers to templates, reminders, troubleshooting by symptom |
| Google | Prerequisites (verified profile, owner/manager), connect, locations, reply policies, AI draft approval, auto-reply rules |
| Inbox | Assignment, SLA, canned replies, notes, labels, channel-specific limits |
| Backups | Overview and what is included or excluded, Drive setup, S3 setup with IAM policy, R2 setup, S3-compatible setup, encryption modes and key custody, schedules and retention, restore walkthrough and what resumes after restore, request a provider |
| Logs | What is recorded, reading the action log, exporting, retention |
| API | Quickstart, keys and scopes, test mode, pagination, idempotency, rate limits, errors, webhooks and signature verification, changelog |
| Security | Data handling, encryption, retention, deletion, DPDP/GDPR requests, subprocessors |
| Troubleshooting | Auto-generated page per catalog error code, plus symptom-based guides |

### 23.6 Personalization and live state (signed-in only)

- **Live status panels**: guides embed `LiveStatus` blocks bound to real state: connection health, scopes granted, assets found, template approval, Tally agent heartbeat, last backup result. A step renders "detected" when the state proves it.
- **Prefilled values**: webhook URLs, verify tokens (masked with reveal), agent pairing code generator, API key prefix, destination setup values. Secrets are never rendered into static HTML; they load client-side after authorization.
- **Role awareness**: steps requiring a permission the viewer lacks show who can perform them.
- **Run diagnostics**: each integration guide has a "Diagnose" button that runs checks (token validity, scopes, webhook subscription, quality rating, agent heartbeat) and links failures to the exact guide section by error code.
- **Sandbox**: "Try it" and guide code samples can run against test mode with `rsl_test_` keys. Live keys require an explicit confirmation step and are never auto-filled.

### 23.7 Contextual help in the product

- Every screen declares `helpKey`s. A "?" control opens the help drawer at the matching guide anchor.
- Toasts and error states render the catalog message plus "Learn more" linking to the generated error page.
- Empty states link to the setup guide for the relevant service.
- Onboarding wizard links each step to its guide.

### 23.8 Search (custom, SQLite FTS5)

- Build step creates `docs-index.db` containing an FTS5 table over title, headings, body, summary, error codes, and API operation ids, with column weights favoring title and headings (BM25).
- A second FTS5 table with the `trigram` tokenizer provides typo-tolerant fallback.
- Synonyms table (e.g., "WABA" to "WhatsApp Business Account", "CAPI" to "Conversions API").
- Role and surface filters (public results exclude internal content; signed-in results are ranked by services the workspace has unlocked).
- Queries and zero-result queries are logged to `control.db.DocsSearchLog` (first-party only) to drive content work.
- Served read-only from `apps/docs` and `apps/web`; reindexed on deploy by `docs.reindex`.

### 23.9 Build pipeline (`pnpm docs:build`)

1. Validate frontmatter (Zod) and component usage.
2. Compile MDX.
3. Generate from registries: API reference (route registry), error pages (error catalog), roles/permissions matrix (RBAC registry), "what is recorded" page (action registry), webhook events (event registry), service pricing pages (service catalog; prices read live at runtime, not baked in).
4. Generate code samples per operation and per language.
5. Build `docs-index.db`.
6. Lint (below).
7. Emit static artifacts.

### 23.10 Quality gates (CI fails on any)

- Every service in the catalog has at least one guide linked by `service`.
- Every API route has registered docs metadata and at least one example.
- Every error code has a user message, remediation text, and generated page.
- Every `helpKey` referenced in the UI resolves to a guide anchor; every guide link and image resolves.
- Every Server Action and permission referenced in guides exists in its registry.
- Code samples: generated samples are executed against the test-mode sandbox in CI; failures block the merge.
- Staleness: `lastVerified` older than 90 days warns, older than 180 days fails for integration guides.
- OpenAPI breaking-change detector (23.4).
- Screenshot freshness: screenshots of **our own UI** are produced by Playwright against the sandbox during the release build (so they never drift). Screenshots of Meta, Google, and Razorpay interfaces are minimized in favor of precise text steps because those UIs change without notice; any retained provider screenshot carries a visible capture date.

### 23.11 Feedback and maintenance

- Per-page "Was this helpful?" with optional reason, stored first-party in `DocsFeedback`; staff Docs ops screen shows lowest-rated pages, zero-result searches, and stale guides.
- Provider changes: a recurring task reviews Meta, Google, and WhatsApp changelogs monthly; affected guides get `lastVerified` bumped or edited. The error catalog covers newly observed provider codes seen in `ProviderCall` logs (weekly unmapped-code report).
- Changelog: `content/changelog/*.mdx` per release, with the OpenAPI diff summary appended automatically.
- Versioning: API docs are versioned per `/vN`; guides follow the app version with `appVersion` metadata.
- Localization scaffold: `content/<locale>/` structure with English first; fallback to English for untranslated pages.
- Accessibility: WCAG 2.2 AA for docs UI, keyboard-navigable search and code tabs, visible focus, reduced motion respected.
- Editorial rules: one task per guide, imperative steps, verify step required, no unexplained provider jargon (glossary linked), no secrets or real customer data in examples.

---

## 24. UI system

- `@rsl/ui`: tokens, light and dark, shadcn primitives, data table (TanStack Table), forms (React Hook Form + Zod), empty/loading/error states, command palette, destructive-action confirmation, docs components.
- Toasts: `notify.success|error|promise` over Sileo; Server Actions return `Result`; errors render catalog message plus help link.
- Dropzone: `<FileDropzone policy="invoice-pdf" ... />` wrapping react-dropzone with presign, progress, retry, validation messages.
- Animation: `tw-animate-css`; `motion` only for inbox and wizard layout transitions; respects `prefers-reduced-motion`.
- Layout: workspace switcher, service-driven sidebar (locked services show unlock cards), global search (app plus docs), notification center, help drawer.
- Server components by default; client islands for interaction; streaming with Suspense; no live provider calls in render paths.
- Admin uses a distinct accent so staff never confuse environments.

---

## 25. Security

- Headers: strict CSP with nonces, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, frame-ancestors none.
- CSRF: Server Action origin checks plus SameSite cookies; mutating Route Handlers require a token or bearer auth.
- Rate limiting (Redis sliding window): login, reset, invites, public API, webhook endpoints, docs search, docs "Try it".
- Input: Zod at every boundary; no `dangerouslySetInnerHTML` without sanitizer; MDX content compiled at build from repo only (no user-authored MDX at runtime).
- Secrets: never in repo; root-owned env file `0600` or OCI Vault.
- Dependencies: Renovate or Dependabot, `pnpm audit`, `--frozen-lockfile`, gitleaks in CI.
- SSRF protection on any server fetch of user-supplied URLs (backup endpoints, outbound webhooks): allowlist, block private and link-local ranges, resolve-then-connect check.
- SQLite file security: directory mode `0700`, service-user ownership, path built only from validated ULIDs, restore-time schema allowlist (section 22.6), `trusted_schema=OFF`.
- PII: field-level encryption for phone numbers and Tally party data where feasible; redaction enforced by tests.
- Tamper evidence: action log hash chain with daily anchors.
- Compliance: privacy policy, terms, DPA, deletion flow, consent records, DPDP and GDPR export and delete, retention schedule.
- Host: firewall plus OCI security lists (80/443, SSH from allowlist), fail2ban, unattended security updates, SSH keys only, Redis bound to localhost with auth.

---

## 26. Platform observability

- Logging: Pino JSON with request id, tenant id, actor id, job id; ship to a log store (Loki, Better Stack, or Axiom). Tenant id is a field, not a label, to avoid label-cardinality blowups.
- Errors: Sentry for all apps, source maps in CI.
- Tracing: OpenTelemetry spans around provider calls and job handlers, with correlation id as an attribute.
- Metrics: queue depth and oldest-job age, job latency, failure rate, webhook lag, provider error rate, SQLite busy-timeout count, WAL size, handle cache hit rate, tenant DB sizes, backup success rate, docs search zero-result rate.
- Alerts: DLQ growth, signature-failure spikes, token-health failures, backup failure or staleness, disk usage, WAL growth, Redis memory, reconciliation drift, anchor-chain mismatch.
- Health: `/api/health` (liveness), `/api/ready` (control DB, Redis, R2, a sample tenant open).
- Public status page with per-provider integration state.

---

## 27. Testing

| Layer | Tooling | Coverage |
|---|---|---|
| Unit | Vitest | rbac, ledger math, token vault, mapping, 24h window, hash chain, backup crypto, docs generators |
| Integration | Vitest + real SQLite files + Redis container | repositories, tenant isolation, migration runner, outbox sweeper, queue handlers, idempotency, send guard |
| Tenancy | Vitest | path traversal fuzz, cross-tenant handle access, status gating (`restoring`, `migrating`) |
| Backup and restore | Vitest + MinIO container + Drive mock | round trip for each provider, signature rejection, malicious SQLite rejection, restore does not resend or resurrect opt-outs, wallet unaffected |
| Provider mocks | MSW with recorded fixtures | Meta, Google, WhatsApp, Razorpay, Drive, S3 incl. throttling and expiry |
| Queue | Vitest | retry classes, fairness, rehydrate from SQLite after Redis flush, DLQ replay |
| End to end | Playwright | signup, invite, role gating, unlock service, connect (mocked), inbox reply, backup and restore, guide personalization |
| Docs | Vitest + CI scripts | frontmatter, link and helpKey resolution, sample execution against sandbox, OpenAPI diff |
| Contract | Zod schema snapshots | public API, agent protocol, webhook events |
| Security | CI | audit, secret scan, CSP smoke test |
| Load | k6 | webhook burst, inbox listing, many-tenant handle cache, concurrent backups |
| Restore drill | scripted | monthly platform DR restore into scratch host |

CI blocks merge on typecheck, lint, tests, migration drift for all five schemas, `.env.example` sync, and `docs:lint`.

---

## 28. Deployment on Oracle Cloud Free Tier

**Topology (single ARM VM to start)**: Nginx with TLS (Cloudflare in front or Let's Encrypt), PM2 processes, Redis and Litestream on the host, data on a block volume mounted at `/var/lib/rsl`.

```js
// infra/pm2/ecosystem.config.cjs
module.exports = {
  apps: [
    { name: "rsl-web",   cwd: "apps/web",    script: "pnpm", args: "start -p 3000", max_memory_restart: "700M" },
    { name: "rsl-admin", cwd: "apps/admin",  script: "pnpm", args: "start -p 3001", max_memory_restart: "500M" },
    { name: "rsl-docs",  cwd: "apps/docs",   script: "pnpm", args: "start -p 3002", max_memory_restart: "300M" },
    { name: "rsl-worker-realtime",    cwd: "apps/worker", script: "dist/realtime.js",    max_memory_restart: "600M" },
    { name: "rsl-worker-bulk",        cwd: "apps/worker", script: "dist/bulk.js",        max_memory_restart: "900M" },
    { name: "rsl-worker-maintenance", cwd: "apps/worker", script: "dist/maintenance.js", max_memory_restart: "500M" }
  ]
};
```

**Deploy procedure**
1. GitHub Actions builds on push to `main`, runs all checks including `docs:build`.
2. Artifact uploaded; `pnpm install --frozen-lockfile --prod`.
3. `db:migrate:control` runs before reload.
4. `pm2 reload` web, admin, docs; workers drain gracefully (section 14.10).
5. `db:migrate:tenants` fan-out runs on the maintenance lane after the new code is live (code stays compatible with N and N+1 schema via expand/contract).
6. Health check on `/api/ready`; automatic rollback to the previous release symlink on failure.

**Platform backups (disaster recovery)**
- Litestream continuously replicates `control.db`, `ingress.db`, `platform-logs.db`, and tenant databases to the platform-backup R2 bucket.
- Daily full snapshots of every database via the online backup API, retained 7 daily, 4 weekly, 6 monthly; object lock where available.
- Redis is rebuildable from SQLite (section 14.11); AOF is a convenience, not the record.
- Monthly restore drill into a scratch VM with a recorded result.
- Rebuild runbook: new VM to running platform in under 2 hours. Oracle free instances can be reclaimed, so this is mandatory.

**Capacity triggers** (move to paid infrastructure): 20 active workspaces, queue oldest-job age above 30 seconds, WAL growth or busy-timeout alerts, volume above 70% full, or any trigger in section 7.9.

---

## 29. External approvals (start in week 1)

| Item | Action | Lead time |
|---|---|---|
| Meta Business Verification | Submit legal documents for Rapid Shift Labs | days to weeks |
| Meta Tech Provider enrollment | Needed for third-party WhatsApp onboarding | weeks |
| Meta App Review per permission | Demo, screencasts, privacy policy, data deletion URL | multiple rounds |
| Google Business Profile API access | Application with use case | weeks |
| Google OAuth verification (Business Profile scope) | Verified domain, privacy policy | weeks |
| Google OAuth for Drive backup (`drive.file`) | Consent screen configuration; confirm current verification requirements for the scope | days to weeks |
| Razorpay live activation | KYC | days |
| WhatsApp display name and templates | Per customer number | days |
| Code-signing certificate (Tally agent) | Purchase and validate | days to weeks |
| Domains, SPF/DKIM/DMARC, `docs.` subdomain | Configure | hours |

Without these, features work only for your own test assets.

---

## 30. Delivery phases with task checklists

Timeline lengthened from revision 2 because tenancy, logging, queue, and docs foundations move into Phase 0.

### Phase 0: Foundation (weeks 1 to 3)
- [ ] Monorepo, Turborepo, shared configs, eslint boundaries, lefthook
- [ ] `@rsl/core`: env, errors **and error catalog**, Result, AsyncLocalStorage context, crypto
- [ ] `@rsl/database` and `@rsl/tenancy`: five schemas, provisioning, handle manager, pragmas, registry, migration runner with canary and lazy fallback, isolation tests
- [ ] `@rsl/logging`: `defineAction` / `defineRoute` / `defineJob`, action log with hash chain and anchors, `instrumentedFetch`, redaction tests, lint rules
- [ ] `@rsl/queue`: registry, envelopes, outbox and sweeper, send guard, fairness primitives, DLQ, rehydrate, three worker lanes
- [ ] `@rsl/auth`, `@rsl/rbac` (registry-driven), audit viewers
- [ ] `@rsl/ui` base and docs components
- [ ] `@rsl/docs` skeleton: content schema, MDX pipeline, route/error/permission/action registries wired, FTS5 indexer, `docs:lint` in CI, 5 seed guides (getting started, roles, services)
- [ ] Platform DR: Litestream to R2 and snapshot schedule, first restore drill
- [ ] CI, preview deployments, `.env.example` check
- [ ] Submit Meta, Google, Razorpay applications
- Exit: login, invite, role-gated page; every action produces a log row with correlation id; tenant isolation, migration, and Redis-flush recovery tests pass; DR restore drill passed

### Phase 1: Billing and admin (weeks 4 to 5)
- [ ] Service catalog, prices, entitlements, ledger with triggers, `billing.ledger` queue
- [ ] Razorpay subscriptions, orders, webhook pipeline via `ingress.db`, reconciliation
- [ ] GST invoices to R2, dunning and suspension jobs
- [ ] `apps/admin`: customers, entitlements, pricing, payments, wallet, impersonation, **Log explorer and trace view**, Tenant Inspector, Queue console
- [ ] Guides: services and billing, wallet, invoices, suspension behavior
- Exit: create customer, unlock service, record payment, suspend, restore; staff can trace any action by correlation id

### Phase 2: Connections and customer backups (weeks 6 to 8)
- [ ] OAuth framework, token vault, Meta and Google connectors, asset selection, health checker, callbacks
- [ ] `@rsl/backup`: packager, crypto, signing, S3, R2, S3-compatible, Google Drive providers, schedules, retention, destination validation
- [ ] Restore pipeline with signature check, schema allowlist, status gating, post-restore reconciliation
- [ ] Portable export, provider-request form and admin queue
- [ ] Guides: connect Meta and Google, backups (all providers), restore, key custody
- Exit: connect and revoke cleanly; backup to each provider and restore into a fresh tenant with wallet, opt-outs, and send guards unaffected

### Phase 3: Revenue wedge, Tally and WhatsApp (weeks 9 to 12)
- [ ] `@rsl/whatsapp`: client, Embedded Signup, templates, sender, window and opt-in enforcement, wallet debit, delivery tracking
- [ ] `@rsl/tally` and `apps/tally-agent`: pairing, polling, local queue, signed installer
- [ ] Ingest pipeline, mapping UI, invoice sending, reminders, minimal inbox view
- [ ] Guides: WhatsApp (complete set), Tally (complete set with symptom-based troubleshooting), live status panels and Diagnose buttons for both
- Exit: one paying customer sending real invoices and reminders; guide-only onboarding of a second customer without live support

### Phase 4: Inbox and reviews (weeks 13 to 16)
- [ ] Meta messaging and comments webhooks, inbox UI, assignment, notes, labels, SLA, SSE, FTS5 search
- [ ] `@rsl/google`: locations, reviews, replies, AI drafts with approval
- [ ] Guides: inbox, Google Business Profile
- Exit: team replies across channels with full action trail

### Phase 5: Publishing and Pixel (weeks 17 to 19)
- [ ] Content calendar, IG and FB publishing, Pixel and CAPI
- [ ] Guides: Instagram, Facebook, Pixel and CAPI
- Exit: scheduled posts publish reliably; CAPI events deduplicate

### Phase 6: Ads (week 20 onward)
- [ ] Campaign management, insights sync, reporting, budget guardrails, rules engine
- [ ] Guides: Meta Ads
- Exit: create, edit, pause campaigns; reporting reconciles with Ads Manager

### Phase 7: Public API, docs completion, hardening
- [ ] Public API v1, API keys manager, test-mode sandbox, outbound webhooks
- [ ] Full API reference renderer, "Try it" console, code-sample generation and CI execution, webhook replay tester, OpenAPI diff gate
- [ ] Docs feedback loop, Docs ops screen, staleness gates enforced
- [ ] Load tests, security review, restore drills, penetration checklist
- Exit: checklist cleared and documented; external developer completes the API quickstart unaided

Note: the API route registry and `defineRoute` exist from Phase 0, so the agent endpoints and internal routes are documented continuously; Phase 7 completes the public surface and the renderer polish.

---

## 31. Items missed in the original brief

- Tenant isolation at file level plus tests
- Four-class logging with correlation ids and tamper-evident action log
- Webhook ingestion with dead-letter queue and replay
- Idempotency and send guards on every outbound action
- Transactional outbox bridging SQLite and Redis
- Message deduplication and delivery tracking
- Content scheduling calendar with timezone handling
- Inbox assignment, notes, labels, SLA, canned replies, auto-assign
- Notification system with user preferences
- Opt-in and opt-out records for WhatsApp, protected from restore rollback
- Compliance pages, data deletion, DPDP and GDPR export
- Platform DR and customer backups as separate programs, with tested restores
- Restore-time security (signature, schema allowlist) and post-restore reconciliation
- Feature flags and staged rollouts
- Abuse protection and rate limiting
- CSP, CSRF, upload validation, virus scanning
- Per-integration health dashboard and public status page
- Onboarding wizard linked to guides
- Error catalog shared by UI, API, logs, and docs
- Docs quality gates, sandbox, and feedback loop
- i18n scaffolding and timezone-aware reporting
- CI/CD with five-schema migration checks and zero-downtime reload
- GST-compliant invoicing
- Code signing for the Tally agent
- Support tooling: impersonation, Tenant Inspector, support bundles
- Customer-facing terms covering Meta and Google policy obligations
- Cost model: per-customer margin including WhatsApp fees, AI usage, storage, backup egress

---

## 32. Engineering rules

1. Every external call has timeout, retry with backoff, circuit breaker, typed error mapping, and a provider-call log row.
2. Provider SDK types never leave their package.
3. All env access through the validated `@rsl/core` env module.
4. Migrations are forward-only, expand/contract, versioned per database.
5. Webhook handlers verify, persist to `ingress.db`, enqueue. No business logic.
6. Tokens, API keys, and PII never appear in logs; redaction is tested.
7. Entitlement and permission checks run server-side through the `define*` wrappers. UI hiding is cosmetic.
8. No SQLite client construction outside `@rsl/tenancy` and `@rsl/database`.
9. Tenant context comes only from the session, API key, job envelope, or paired agent.
10. No network calls inside a SQLite transaction.
11. Money is integer minor units; the ledger is append-only and lives in `control.db`.
12. Every outbound side effect carries an idempotency key and passes the send guard.
13. State that must not roll back (ledger, entitlements, tokens, send guards, suppressions, logs) never lives in the restorable file.
14. No live provider calls in page render paths.
15. Every typed error has a catalog entry with remediation text and a generated docs page.
16. No hosted documentation product or third-party docs analytics.
17. Every feature ships with permission keys, service key, action keys, error codes, tests, and a guide.

---

## 33. Definition of done (per feature)

- [ ] Permission keys defined and enforced through `authorize()` inside a `define*` wrapper
- [ ] Service key and entitlement gate applied server-side
- [ ] Zod validation on all inputs
- [ ] Action keys registered; actions appear in the tenant action log with correlation id
- [ ] Provider calls logged through `instrumentedFetch`; errors mapped to catalog codes with remediation text
- [ ] Jobs defined with envelopes, idempotency key, retry class, and queue lane
- [ ] Tenant isolation test added; restore-safety reviewed if the feature adds state (decide: restorable `data.db` or non-restorable)
- [ ] Loading, empty, and error states implemented
- [ ] Unit and integration tests; Playwright path for the primary flow
- [ ] Logs free of secrets and PII
- [ ] Metrics and alerts for new queues or integrations
- [ ] Guide written with frontmatter, steps, verify step, common problems, and `lastVerified`; `helpKey`s wired in the UI
- [ ] API routes (if any) registered with examples; generated reference page reviewed
- [ ] Runbook entry for staff
