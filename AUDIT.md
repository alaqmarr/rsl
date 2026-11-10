# RSL Marketing Platform — Production Readiness Audit

**Scope:** entire `rslmarketing` pnpm/turbo monorepo — `apps/web` (4500), `apps/admin` (4501), `apps/docs` (4502), `apps/worker` (4510–4512), `apps/tally-agent`, 22 packages (`core`, `auth`, `tenancy`, `database`, `rbac`, `billing`, `queue`, `api-keys`, `whatsapp`, `meta`, `google`, `inbox`, `tally`, `storage`, `backup`, `notifications`, `logging`, `analytics`, `connections`, `config`, `docs`, `ui`), `infra/*` (nginx, pm2, litestream, ssl), `scripts/*`.

**Method:** static read-through of the security-critical path first (env → crypto → ids → sessions → RBAC → tenancy → webhooks → API routes → server actions → UI shell), then breadth passes over packages and infra. Findings cite the file and symbol. Nothing was executed against `.env`, no secrets were read, no data was modified.

**Verdict:** a genuinely ambitious, well-structured multi-tenant SaaS with real depth (envelope encryption, per-tenant SQLite, hash-chained audit logs, signed encrypted backups, HMAC-verified Meta/Razorpay webhooks, PKCE OAuth). It is **not production-ready**. There are several security holes that are exploitable today, a set of data-integrity bugs that silently lose or duplicate work, and structural choices (single-process synchronous SQLite, per-request global-DB writes) that cap it well below a real customer load. Estimated remediation: **~8–12 engineering weeks** for the P0/P1 set before a first paying tenant.

| Area | Grade | One-line reason |
|---|---|---|
| Security | **D** | Printable Turnstile bypass, no login throttling, staff console without MFA, tokens in URLs |
| Data integrity | **C−** | Outbox silently drops unregistered jobs, duplicate webhook processing, no transactions across ledger+invoice |
| Backend scale | **D+** | Synchronous `better-sqlite3` on the request thread, synchronous scrypt, per-request writes to `control.db` |
| Reliability | **C** | Fire-and-forget side effects with `.catch(() => undefined)`, no outbound retries, no DLQ for customer webhooks |
| UI/UX | **B−** | Strong visual system and empty states, but tiny type, no page-level error boundary, weak a11y semantics |
| Code quality | **C** | 4.5k-line action file, triplicated config, phase-numbered source-text tests |
| Ops/production hygiene | **F** | No CI, no lint config, no Dockerfile, no load tests, fabricated `durationMs` in audit logs |

---

## 0. How to read this

- **P0** = exploitable or data-destroying now; block launch.
- **P1** = will bite within weeks of real traffic or is a compliance exposure.
- **P2** = quality/scale debt; fix in the first two months.
- **P3** = polish.

Line numbers are given only where they were confirmed; otherwise the symbol name is authoritative.

---

## 1. P0 — Block launch

### P0-1. CAPTCHA is bypassable with a hard-coded string — in production
`packages/tenancy/src/free-ai-services.ts` → `verifyCloudflareTurnstileToken`:

```ts
if (cfg.secretKey === "1x0000000000000000000000000000000AA" ||
    responseToken === "XXXX.DUMMY.TOKEN.XXXX") {
  return { allowed: true, skipped: false };
}
```

Any unauthenticated client can post `cf-turnstile-response=XXXX.DUMMY.TOKEN.XXXX` and pass the "security check" on login, register, forgot-password and every public form. The Cloudflare always-passes *secret* test key should never be present outside a test build, and the dummy *token* must never be accepted at all.

Worse, the same function **fails open when unconfigured**: `if (!cfg.isReady) return { allowed: true, skipped: true }`. Today, on an environment where the platform Turnstile keys were never seeded (the default after `setup.sh`), there is *zero* bot protection and no signal to the operator that protection is off.

**Fix:** delete both bypass branches; gate the always-passes secret behind `NODE_ENV === "test"`; make unconfigured Turnstile fail **closed** on `register`/`login` (or at minimum surface a blocking admin banner). Add a startup assertion that CAPTCHA is configured in production.

### P0-2. No rate limiting or lockout on password authentication
`packages/auth/src/index.ts` → `signInUser`, `registerUserWithWorkspace`. A repo-wide search for rate limiting returns hits only in `packages/api-keys` (public API keys) and a 5-attempt cap on the **6-digit email code** (`MAX_EMAIL_VERIFICATION_ATTEMPTS` in `packages/notifications`). There is:
- no per-IP or per-account throttle on password sign-in,
- no exponential backoff, no lockout, no captcha-after-N-failures,
- no throttle on registration, password-reset request, or team invites.

Combined with P0-1 this makes credential stuffing and account enumeration trivial, and makes the unauthenticated `/login` server action a CPU-exhaustion vector (see P1-3: `scrypt` is synchronous).

**Fix:** `rate-limiter-flexible` already exists in the tree. Key on `ip + email` for sign-in (e.g. 5/min, 20/hour), `ip` for registration/reset, and lock the account after N failures with a time-boxed cooldown. Do it in the package, not the page, so every entry point is covered.

### P0-3. Outbox jobs are silently acknowledged and dropped when no processor is registered
`packages/queue/src/index.ts` → `processDueSqliteOutboxForTenant`:

```ts
const processor = registeredProcessors.get(row.jobType);
try {
  if (processor) {
    await processor(envelope);
  }
  // ... always marks the row "completed"
```

If a `jobType` has no registered handler — a typo, a new feature shipping its producer before its consumer, a lane-restricted worker (`--lane=bulk` never registers realtime handlers) — the row is marked `completed` with `attempts: 1` and a `jobRuns` row saying `completed`. Nothing is retried, nothing is dead-lettered, nothing is logged as an error. In a system whose entire reliability story is "transactional outbox + durable queue", this is the most dangerous single line in the codebase: it converts "job not available yet" into permanent silent data loss.

**Fix:** throw (or mark `failed`/`dead`) when `processor` is undefined, and let the retry/backoff path handle it. Add an assertion at boot that every `QUEUE_REGISTRY` entry and every `enqueueJob` job type has a handler in the lane that can consume it.

### P0-4. Meta and WhatsApp webhooks process duplicate deliveries
`apps/web/src/app/api/webhooks/meta/route.ts` and `.../whatsapp/route.ts` insert into `ingressSchema.webhookInbox` with `.onConflictDoNothing().run()` and then **ignore the result**:

```ts
ingressDb().insert(ingressSchema.webhookInbox).values({...}).onConflictDoNothing().run();
// no `if (inserted.changes === 0) return`
```

Razorpay does this correctly (`if (inserted.changes === 0) return deduplicated`). The other two do not. Meta retries webhooks aggressively (and redelivers on any non-2xx/slow response), so a retried `messages` event creates a second contact-message row, increments `conversations.unreadCount` twice, and — for leadgen — increments `campaigns.conversions` twice. Duplicate customer messages and inflated attribution are customer-visible.

**Fix:** capture the insert result and early-return 200 on `changes === 0`, exactly like the Razorpay route. Additionally key `eventId` on the *provider event id* where one exists rather than a hash of the body (Meta's `entry[].changes[].value.messages[].id`).

### P0-5. Inbound webhooks do heavy synchronous work inline, with no queue usage at all
`QUEUE_REGISTRY` defines `webhooks.meta` (concurrency 20), `webhooks.whatsapp` (20), `webhooks.razorpay`, `webhooks.google` — **none of these queues is ever enqueued to.** The route handlers do everything inline:

- WhatsApp: resolve tenant by scanning connections, decrypt token, `fetch` Graph API for media, `transcribeCloudflareWorkersAiAudio` (15s timeout), then per-message contact/conversation/message upserts + FTS inserts + web-push dispatch.
- Meta: decrypt creds, `fetch` the Graph leadgen endpoint with `AbortSignal.timeout(8000)`, then the same upsert fan-out.

Meta requires a 200 within ~5 seconds and disables/retries subscriptions that don't comply. A single cold tenant (LRU-evicted SQLite handle → open + migrate) plus one 8s Graph call already breaches that. Everything is wrapped in `catch {}` with the comment "raw event is safely stored in ingress.db" — so Meta gets a 200, thinks delivery succeeded, and the message is never processed because there is **no worker that replays `webhookInbox` rows**. The inbox is a write-only table.

**Fix:** verify signature → insert inbox row → enqueue `webhooks.whatsapp` → return 200 immediately. Add an ingress sweeper (or process from the existing outbox cron) that picks up `webhookInbox` rows where `status = 'received'` and reprocesses with retry.

### P0-6. Staff console has no MFA
`apps/admin` authenticates with email + password + Turnstile only (`staffLoginFormStateAction`, `packages/auth/src/index.ts` → `signInPlatformStaff`). This console can impersonate any tenant (`createImpersonationSession`), reset any customer's password (`staffResetClientUserPassword`), read/change platform credentials (Razorpay, Meta app secret, R2, SMTP, VAPID), grant free all-tools access, and restore/optimise any customer database. A single phished staff password — with CAPTCHA bypassable per P0-1 — is full platform compromise across every tenant. Customers have passkeys (`packages/auth/src/passkeys.ts`); staff do not.

**Fix:** require TOTP or WebAuthn for `platform_staff` before `resolveStaffSessionFromToken` returns a session usable for elevated permissions; add `step_up_at` to the staff session and require re-auth for impersonation, credential edits and restores.

### P0-7. First-run Super Admin bootstrap is a race
`packages/auth/src/index.ts` → `bootstrapFirstPlatformStaff` is gated by `countPlatformStaff() === 0`, and the setup subdomain is proxied to the admin app (`infra/nginx/rsl-marketing.conf`, `setup.rapidshiftlabs.in` → 4501). Two concurrent requests during the first-run window can both observe `0` and both create a super admin; the loser is not rejected, it is merely ignored. There is no one-time setup token, no signed bootstrap URL, and no lock.

**Fix:** `INSERT ... WHERE (SELECT COUNT(*) FROM platform_staff) = 0` inside `BEGIN IMMEDIATE`, or a `setup_state` row that is atomically claimed; generate a one-time setup token during `setup.sh` and require it in the form.

### P0-8. Verification codes and password-reset tokens travel in URLs
`packages/notifications/src/index.ts`:

```ts
const verifyUrl = `${APP_URL}/login?verifyEmail=${email}&code=${code}`;
const resetUrl  = `${APP_URL}/reset-password?email=${email}&token=${rawResetToken}`;
```

The 6-digit code and the reset token land in browser history, in `Referer` headers sent to third-party assets, in nginx access logs, in Sentry breadcrumbs, and in any corporate proxy log. `apps/web/src/lib/actions.ts` → `resetPasswordAction` re-emits the token in the redirect URL on every validation error, multiplying the exposure. A 6-digit code with a 30-minute TTL and a 5-attempt cap is also brute-forceable if the log leaks the email.

**Fix:** POST the code/token in the form body (or set a short-lived HttpOnly cookie on the verification link) and strip it from the URL immediately via `history.replaceState`. Never re-render the token into an error redirect.

### P0-9. Public bill-payment page exposes bank details with a 30-day shareable link
`packages/tally/src/free-tally-tools.ts` → `getPublicTallyBillPaymentView` returns `bankAccountNumber`, `bankIfsc`, `bankName`, `gstin`, phone, full line items and balance, authorised by a query-string HMAC with a **30-day** TTL (`buildSignedPublicTallyBillPayUrl`, default `ttlMs = 30 * 24 * 3600_000`). The signature is derived from `KMS_MASTER_KEY` — the same key that wraps tenant data encryption — so key reuse spans a public capability token and the data-encryption root. WhatsApp forwards, shared screenshots and email archiving turn this into a durable financial-data leak. `apps/web/src/app/api/media/[workspaceId]/[objectId]/route.ts` has the same no-expiry HMAC pattern for media objects, with `Cache-Control: immutable`.

**Fix:** separate derived keys per purpose (`HKDF(KMS_MASTER_KEY, "public-bill-link")`), shorten TTLs to 72h, drop full account numbers from the public view (mask to last 4 + UPI VPA), and add a revocation counter so a rotated link invalidates old ones.

---

## 2. P1 — Fix before real traffic

### P1-1. `emailVerified` is set at registration, so email verification means nothing
`registerUserWithWorkspace` writes `emailVerified: true` at creation and then `actions.ts` fires `sendEmailVerificationCode(...).catch(() => {})`. The user is fully "verified" before receiving anything, verification failures are swallowed, and there is no gate anywhere that depends on the flag. Consequences: typos create permanently unreachable accounts (no password recovery, no billing email), and team invites/Meta/Google account emails can be unowned addresses. Pick a policy — either verify-before-access or verify-before-billing — and enforce it in one place.

### P1-2. Two registration/login entry points, one of them without CAPTCHA or validation
`apps/web/src/lib/actions.ts` exports both `registerFormStateAction`/`loginFormStateAction` (Turnstile + validation) and `registerAction`/`loginAction` (no Turnstile, minimal validation, `goWithError` redirects). The unguarded pair is still exported from a `"use server"` module, i.e. it is a reachable POST endpoint. Dead-but-exported server actions are a classic Next.js foot-gun. Delete them, or add a same-origin + Turnstile assertion inside every action.

### P1-3. `scrypt` and `better-sqlite3` run synchronously on the request thread
`packages/core/src/crypto.ts` uses `scryptSync` with `N=16384` (~40–80 ms of pure CPU per hash on typical cloud vCPU). `hashPassword` runs on register, login, password change, password reset, staff reset, and staff create — all inside async route handlers and server actions. OWASP's current interactive recommendation is `N=2^17, r=8, p=1`, so the parameters are also ~8× weaker than guidance. Meanwhile every query is `better-sqlite3` (synchronous), so a single Node process serialises hashing *and* all database I/O. Login is therefore both a DoS vector (P0-2) and the slowest endpoint in the product.

**Fix:** move to `scrypt` (async) or Argon2id at OWASP parameters, run it off the request path where possible, and put a hard concurrency cap on auth operations.

### P1-4. `control.db` takes a write on every authenticated API request
`packages/api-keys/src/index.ts` → `authenticatePublicApiKey` ends with:

```ts
db.update(controlSchema.apiKeys).set({ lastUsedAt: now, lastUsedIp: ... })
  .where(eq(id, candidate.id)).run();
```

Every single API call writes to the one global SQLite file that also holds sessions, wallets, entitlements, RBAC, invoices and tenant registry. Under any real API throughput this produces `SQLITE_BUSY`, WAL growth, and head-of-line blocking for page renders. `getPermissionsForRole`, `resolveUserSessionFromToken`, wallet reads and `verifyActiveTenantStatus` also hit `control.db` per request.

**Fix:** batch `lastUsedAt` (in-memory, flush every 30–60 s), cache role→permission sets and session→context for a few seconds, and move to a real RDBMS (Postgres) for the control plane before multi-tenant scale. Per-tenant SQLite is defensible; a global synchronous SQLite control plane is not.

### P1-5. `/api/ready` is a public, expensive, and revealing readiness probe
`apps/web/src/app/api/ready/route.ts` runs `PRAGMA quick_check` on three databases and calls `getPlatformQueueOverview()`, which iterates **every active tenant**, opens each tenant DB, reads up to 200 outbox rows per tenant, and appends dead letters. `quick_check` is O(pages). A load balancer probing every 5 s therefore performs a full-file scan plus an O(tenants) fan-out constantly, thrashing the `TENANT_DB_MAX_OPEN` LRU and WAL checkpoints. The response also discloses ports (`4500/4501/4502/4510/4511/4512/4520`), queue counts, handle metrics and schema state to anyone.

**Fix:** split `/api/health` (cheap, `SELECT 1`) from `/api/ready`; make ready check a single cheap query plus a cached queue snapshot refreshed by the worker; require the internal secret (the worker already implements exactly this pattern in `apps/worker/src/index.ts` with `x-rsl-internal-secret`); stop echoing ports and counts publicly.

### P1-6. Server actions accept unvalidated money and enum casts
Examples in `apps/web/src/lib/actions.ts`:
- `submitRechargeRequestAction` / `submitAdSpendRechargeRequestAction` / `createOnlineRazorpayOrderAction`: `const rupees = Number(formData.get("amountRupees") || 0)` → no finite check, no min/max, no `utrOrReference` format check, no duplicate-UTR rejection. `NaN`/`Infinity`/negative values flow into `rupeesToPaise` and then into a `pending_verification` row.
- `changeConversationStatusAction`: `String(formData.get("status")) as "open"|"pending"|"resolved"|"snoozed"` — a cast, not a validation.
- `startConversationAction`: same for `channel` and `direction`.
- `recordTallyVoucherAction`: `Math.round(qty * rate * (1 + gst/100) * 100) / 100` — money arithmetic in floats, then `rupeesToPaise` again.
- `apps/web/src/app/api/v1/vouchers/route.ts` and `.../contacts/route.ts` cast `await req.json()` to `Record<string, unknown>` and coerce by hand — no zod, unlike `pixel/events` which does it properly. `POST /api/v1/vouchers` will happily accept `amountRupees: "abc"` → `NaN`.

**Fix:** one zod schema per action/route (the pattern already exists in `defineAction` inputs — use it everywhere), reject non-finite money at the boundary, and keep all arithmetic in integer paise.

### P1-7. Wallet credit trusts client-supplied notes and is not transactional
`apps/web/src/app/api/webhooks/razorpay/route.ts`:

```ts
const creditPaise = Number(entity?.notes?.walletCreditPaise || 0);
...
const inv = createAdvanceReceiptVoucher({ ..., amountPaise: creditPaise, ... });
creditWallet({ ..., amountPaise: creditPaise, idempotencyKey: `rzp_payment:${paymentId}` });
```

`notes` originates at order creation, so if any flow lets a caller influence `notes` (or if an order is created with a mismatched amount), the webhook credits whatever the note says rather than what Razorpay actually captured. The invoice is created *before* the wallet credit with no shared transaction: a crash between the two yields a GST invoice with no wallet credit, or vice-versa on retry. The captured `amount` from `entity.amount` is available and should be authoritative.

**Fix:** verify `entity.amount === order.amount` and derive `creditPaise` from `entity.amount` (minus gateway fee policy), wrap invoice+ledger in one `BEGIN IMMEDIATE` transaction, and reconcile `payments` rows by `externalOrderId` first.

### P1-8. Tally ingress authenticates with a bearer token in the query string and has no replay protection
`apps/web/src/app/api/webhooks/tally/route.ts` → `resolveWebhookCaller` accepts `?token=tlwh_...` or `X-Tally-Webhook-Token`, with no HMAC over the payload, no timestamp, no nonce, and no replay window. This endpoint writes vouchers, marks bills paid, records receipts, accepts native PDF uploads (`application/pdf`), and can generate TDL add-ons. A token in a query string is routinely captured by nginx logs, Tally's own HTTP logging, and support screenshots. Anyone who obtains it can rewrite a tenant's receivables.

**Fix:** sign the body (`X-RSL-Timestamp` + `HMAC-SHA256(timestamp + body)`), reject skew > 5 min, keep the token but move it to a header only, and make PDF uploads idempotent by `voucherGuid`.

### P1-9. RBAC trusts the caller-provided context
`packages/rbac/src/index.ts` → `authorize`:

```ts
if (ctx.actorType === "system" || ctx.actorType === "webhook" || ctx.actorType === "agent") return;
const resolvedRole = ctx.roleSlug ?? lookupMembership(...);
```

Every context that supplies `roleSlug` is fully trusted, and `authenticatePublicApiKey` supplies `roleSlug: "owner"`. So a scoped API key that only has `contacts:read` becomes an *owner* the moment it reaches any `defineAction` — scope is enforced only at the HTTP route, not at the action. Any new route that forgets a scope check, or any action reachable through a differently-scoped route, is a privilege escalation. The `actorType` short-circuit has the same shape: `agent`/`webhook` contexts skip RBAC entirely.

**Fix:** remove `roleSlug` from `TenantContext` (always resolve from the DB, cache it), add an explicit `apiKeyScopes` field and enforce it in `defineAction`, and make `actorType: "system"` a distinct, auditable capability rather than a bypass.

### P1-10. Session handling lacks rotation, binding and step-up
`apps/web/src/lib/session.ts` sets a 30-day `rsl_session` cookie (`httpOnly`, `sameSite: "lax"`, `secure` in prod) and nothing else. There is no rotation on privilege change, no binding to user-agent/IP, no idle timeout, no absolute lifetime shorter than 30 days, no "sign out all devices" surfaced after suspicious activity, and `sameSite: "lax"` (not `strict`) is combined with **no `middleware.ts` anywhere in the repo** and no CSRF token on cookie-authenticated route handlers. Next.js protects Server Actions with an Origin check, but `/api/auth/impersonate` (POST), `/api/export/*` and `/api/pdf/*` (GET, cookie-authenticated, data-bearing) are plain route handlers. `GET /api/auth/impersonate?exit=1` mutates state (signs the user out) via GET.

**Fix:** add `middleware.ts` that enforces auth + same-origin for `/api/**` mutations and sets `sameSite: "strict"` for sensitive cookies; rotate session ids on login and on role change; make `exit` a POST; and add step-up re-auth before destructive operations.

### P1-11. The impersonation endpoint accepts a raw session token
`apps/web/src/app/api/auth/impersonate/route.ts`:

```ts
const resolvedToken = code ? consumeImpersonationHandoffCode(code) : rawToken;
```

The single-use 60 s handoff code was designed precisely so the customer's raw token never leaves the staff console — but the same endpoint happily accepts a raw token supplied in JSON/form body, with no origin check, and sets a 30-minute session cookie from it. That defeats the control and turns any token leak (log, clipboard, support screenshot) into a silent support session.

**Fix:** remove the `rawToken` branch entirely; only `consumeImpersonationHandoffCode` may mint a cookie, and only on a same-origin POST.

### P1-12. Audit-log metrics are fabricated
`apps/web/src/lib/actions.ts` and `apps/worker/src/index.ts` hard-code `durationMs: 4`, `5`, `6`, `12` in `appendActionLog` calls. These values are presented in the UI as activity history and exported as CSV, and are hash-anchored into the tamper-evident log chain. A compliance artefact containing invented timings undermines the whole chain-of-custody story. Measure the real duration (or omit the field).

### P1-13. Sign-out/session revocation doesn't cover the impersonated session cleanly
`endSupportSession` calls `signOutSession(existingToken)` on the *current* cookie, which is the impersonated customer session, not the staff session — so ending a support session deletes the customer's session row (forcing them to re-login) while leaving the staff console untouched. Combined with `setWebSessionCookie(resolvedToken, 30*60)`, an "End Support Session" click can log the customer out of their own device. Verify the intended semantics and revoke only the impersonation grant.

### P1-14. Nothing protects customer-facing webhook consumers
`packages/api-keys/src/index.ts` → `dispatchWorkspaceWebhookEvent` is called as `void ... .catch(() => 0)` from both inbound webhook handlers. It:
- has a single 4 s attempt, no retry, no backoff, no DLQ, no persistence of the delivery,
- only records the *last* status on the endpoint row,
- is invoked from inside request handlers where the process may die before the fetch resolves.

`WEBHOOK_EVENTS` advertises reliable signed deliveries; customers building on it will lose events silently. **Fix:** enqueue a `webhooks.outbound` job, persist attempts, retry with exponential backoff, and expose the delivery log in the UI.

---

## 3. Architecture and backend bottlenecks

### 3.1 The core impedance mismatch: synchronous SQLite in an async server
Every data access goes through `better-sqlite3` (`.run()`, `.get()`, `.all()` — all blocking). In Next.js App Router, RSC render and route handlers are async but run on the same single Node thread. A typical dashboard render (`apps/web/src/app/(dashboard)/layout.tsx`) performs, before any page code:

`resolveUserSessionFromToken` → `getPermissionsForRole` (may seed roles) → `getWalletBalancePaise` → `getWorkspaceAvailableSpend` → `listServicesWithWorkspaceState` (catalog + entitlements) → `getWorkspaceSetupProgress` → `getPlatformBillingSettings`

then the page itself runs `getWorkspaceAnalytics` (multiple range scans over vouchers/messages) plus `getTallyWorkspaceSummary` (loads all vouchers). That is easily 15–40 synchronous queries per navigation, each blocking the loop. With PM2 `instances: 1` for `rsl-web`, the whole product has the throughput of one thread.

**Measured-shape risks (not benchmarked here):**
- Login: 1 scrypt (40–80 ms) + 3–5 queries → ~100 ms of pure CPU per attempt.
- WhatsApp inbound: token decrypt + optional 8–15 s external fetch + 5–15 writes + FTS insert, all inline.
- `/api/ready`: 3 × `quick_check` + O(tenants) DB opens.

**Recommendations (in order of leverage):** (1) move the control plane to Postgres; (2) cache session/permission/wallet reads with a short TTL and a per-request memo; (3) move hashing off-thread; (4) split read models (analytics) into precomputed tables refreshed by the worker instead of on-render scans; (5) run multiple web instances behind nginx once SQLite writes are gone from the read path.

### 3.2 Worker scheduling is effectively single-threaded and self-competing
`apps/worker/src/index.ts` registers three lanes, but:
- The BullMQ processor **ignores the job** and calls `processDueSqliteOutboxForTenant(parsed.tenantId)` — so a job for one tenant drains that tenant's entire outbox, and with `concurrency: 20` on `webhooks.*` you get 20 workers all draining the same tenant. Queue-level concurrency and lane separation are cosmetic.
- `*/3 * * * * *` `sweepActiveTenantOutboxes` loops **every active tenant** every 3 seconds regardless of pending work. With 500 tenants that is 500 DB opens + up to 25 claimed rows each, every 3 s, forever.
- The same process also owns the 1-minute post publisher, hourly ad-insights sync (external API fan-out per tenant), 30-minute maintenance (WAL checkpoint + `optimize` + reminders + posts), 02:30 backups (SQLite backup + zstd + encrypt + R2 upload + Drive upload per tenant), and 00:05 log anchoring. `Cron(..., { protect: true })` prevents overlap *of the same job*, not across jobs. A 500-tenant nightly backup blocks the 3-second outbox sweep for hours → WhatsApp bill automation silently stalls overnight.

**Fix:** separate processes per concern (already have lanes — actually honour them), drive outbox processing from `nextRunAt` indexes rather than a full tenant sweep, shard the nightly backup, and move external-API fan-out to per-tenant jobs on the bulk lane.

### 3.3 Control-plane write amplification
Beyond P1-4: `getWorkspaceStorageStatus` inserts a `storage_configurations` row when missing (a write on a read path), `verifyActiveTenantStatus` writes `dataSchemaVersion` to the control DB on **every tenant open** (per the tenancy module), and `ensureSystemRolesSeeded` runs a per-role select on first touch per process. Under multi-instance deployment these become write storms and lock contention. Make migrations write once, make defaults read-only, and cache.

### 3.4 Memory and connection ceilings
- `TENANT_DB_MAX_OPEN` default 200 open SQLite handles per process with a 5-minute TTL. 200 handles × (page cache + WAL + statement cache) is substantial; combined with 3 web/worker processes on one box this is the real memory ceiling, not the PM2 `max_memory_restart` numbers.
- `serverExternalPackages` includes `better-sqlite3`, and the lockfile resolves **two** `better-sqlite3`/`drizzle-orm` versions (12.11.1 and 13.0.3 observed across apps vs packages). Duplicate native modules mean two compiled binaries, larger images, and a real risk of ABI mismatch after a Node upgrade. Pin one version via `pnpm.overrides`.
- No Redis in the default `setup.sh` path beyond an isolated local instance; when `REDIS_URL` is empty the entire queue degrades to SQLite polling with 3-second granularity and no cross-process coordination. That is a dev mode being shipped as a production mode.

### 3.5 Storage has no delete, no quota enforcement, no cost control
`packages/storage/src/index.ts` can write and read objects, and can migrate them between backends, but there is **no delete**. `storageConfigurations.usedBytes` and `objectCount` only increase. `consumeUsage` for managed storage is metered only when `bytes > 1 MB` and quantity is `ceil(bytes / 1 GB)` — i.e. anything under 1 GB bills 0, and 1.1 GB bills 1 GB. GDPR/DPDP erasure requests cannot be honoured for stored objects.

### 3.6 Multi-tenancy is file-based; there is no erasure or export lifecycle
`resolveSafeTenantDir` correctly blocks traversal, and per-tenant `data.db`/logs isolation is real. But nothing implements tenant deletion: no purge job, no retention policy, no crypto-shredding, no "delete my account" flow, and no documented backups-retention/rotation. For an Indian SaaS holding GST invoices and customer phone numbers, DPDP right-to-erasure and breach-notification duties are unaddressed in code.

---

## 4. Connection and integration issues

| # | Issue | Where |
|---|---|---|
| 1 | Outbound fetches have timeouts but **no retries**; failures are swallowed (`catch {}`, `.catch(() => undefined)`) on push notifications, Google Drive upload, billing emails, review sync, template sync. | `apps/web/src/app/api/webhooks/*`, `apps/worker/src/index.ts`, `packages/google`, `packages/notifications` |
| 2 | Google OAuth: if refresh fails the connection row stays `healthy`; UI shows "connected" while every call 401s. | `packages/connections` (refresh flow) |
| 3 | Meta token health is only checked by a 6-hour sweep; a revoked token mid-broadcast fails per message instead of pausing the broadcast. | `QUEUE_REGISTRY["connections.health"]`, `packages/whatsapp` |
| 4 | WhatsApp sandbox detection is a string prefix on the decrypted token (`/^(rsl_sandbox_|sandbox_|test_)/i`). A real token that ever begins with `test_` silently becomes a fake sender reporting "sent". | `packages/whatsapp`, `packages/connections` |
| 5 | Tally agent pairing uses a 15-minute code, but the resulting device signing secret is only used for a manifest HMAC — the actual voucher POST is still bearer-token only (P1-8). | `packages/tally`, `apps/web/src/app/api/webhooks/tally` |
| 6 | Razorpay: keys, webhook secret and checkout config come from the control DB; if the platform keys are unset the UI still renders a "Pay online" path that fails at click time. | `packages/billing`, `apps/web/src/app/(dashboard)/billing/page.tsx` |
| 7 | `resolveEndpointsFromHeaders` builds public URLs from request headers. It is host-validated in OAuth (`isTrustedPlatformHost`) but the export/PDF/Tally routes call it without that guard, so a spoofed `X-Forwarded-Host` can change generated download/ingress URLs. | `apps/web/src/app/api/export/[kind]/route.ts`, `.../api/pdf/[kind]/route.ts` |
| 8 | No SMTP connection pooling: `nodemailer.createTransport` per email, plus React Email render per email, inside request handlers. | `packages/notifications` |
| 9 | Web push has no retry and no subscription cleanup on 404/410, so dead endpoints accumulate and every send pays the cost. | `packages/notifications/src/web-push` |
| 10 | No egress allow-list or proxy: Worker/Next instances can reach arbitrary hosts; combined with tenant-supplied webhook URLs this is an SSRF surface that is only partially mitigated (see below). | platform-wide |

**Credit where due:** `assertSafeOutboundWebhookTarget` in `packages/api-keys` is genuinely good — it blocks private/reserved IPv4 and IPv6 (including `::ffff:` mapped, CGNAT, metadata), enforces HTTPS, does DNS resolution and re-checks every resolved address, and uses `redirect: "error"`. Keep it; extend the same helper to every tenant-supplied URL (Google Sheet IDs, Meta asset IDs, Tally endpoints).

---

## 5. UI/UX, accessibility and front-end faults

**What's good:** a real design system (`packages/ui`), consistent cards/metrics/pills, meaningful empty states (`EmptyWorkspaceState`, `AccessRestrictedState`), pending states on every submit (`SubmitButton`/`PendingSubmitButton`), a command palette with focus trap, page guides with prerequisites/steps/common mistakes, mobile master-detail for the inbox, and permission-aware navigation. That is above average for an internal build.

**Faults:**

1. **No page-level error boundary in `apps/web`.** `apps/admin` has `(console)/error.tsx`; `apps/web` has only `global-error.tsx` + `loading.tsx`. Any thrown error in a dashboard page (a `better-sqlite3` `SQLITE_BUSY`, an `RslError`, a bad date) replaces the entire app shell with the global fallback — losing nav and the user's place. Add `(dashboard)/error.tsx` and route-level `error.tsx` for `/tally`, `/inbox`, `/billing`, `/campaigns`.
2. **Body text is routinely 10–11 px.** Sidebar headings `text-[10px]`, metric sublabels `text-[10.5px]`, inbox metadata `text-[11px]`, table headers `text-[11px]`. Below 12 px on a 1080p laptop this is a legibility problem, and it is the dominant typographic scale in the chrome.
3. **Marketing page is served from inside the authenticated route group.** `apps/web/src/app/(dashboard)/page.tsx` returns `<PublicLandingPage/>` when there's no session, so anonymous `/` renders within the dashboard layout (`layout.tsx` returns bare `{children}` when no session). There is no `middleware.ts` split, no `/pricing` route, and marketing SEO metadata competes with app metadata in the same route. Public pages also pull the dashboard's dependency graph.
4. **Timezones.** Audit log timestamps use `new Date(ts).toLocaleString("en-IN")` with no `timeZone`, so server-rendered lists show server time while client-rendered ones show browser time. For an India-first product, every timestamp should render in `Asia/Kolkata` explicitly.
5. **Money formatting is inconsistent.** `formatInr` in most places; `₹${v.toLocaleString("en-IN")}` in chart tooltips; manual `₹` in wallet copy; `Math.round(paise/100)` on the cashflow chart (silently drops paise). One formatter, integer paise, no ad-hoc `₹` strings.
6. **Destructive actions without confirmation.** Delete canned reply, delete Tally automation rule, delete API key, delete webhook endpoint all submit immediately. Only the WhatsApp reminder and the backup restore have confirm dialogs. Add an undo or a confirm for anything that deletes.
7. **`<details open={...}>` in the inbox is not a controlled component.** React re-renders reset the native open state, so "Expand Tools" can snap shut after any parent re-render (e.g. a filter navigation). Use state + `onToggle`.
8. **Charts are canvas-only with no accessible fallback.** `DualSeriesAreaChart` / `InteractiveAreaChartCanvas` expose no `<table>`, no `aria-label` summary, no keyboard data point navigation. Analytics is effectively unusable with a screen reader.
9. **Command palette semantics.** `role="listbox"` with `button role="option"` and `aria-selected`, but no `aria-activedescendant`, no `id` per option, and the input is not `role="combobox"`. Focus is trapped (good) but the announced state is wrong.
10. **Tables lack `scope`/`caption`.** `<th>` in the overdue-bills and receivables tables have no `scope="col"`; numeric columns are not right-aligned consistently.
11. **Mobile hides the wallet balance.** `TopWorkspaceBar` renders the wallet chip `hidden md:inline-flex`, so the single most important commercial signal is invisible on phones while the sidebar card with the same number is behind a hamburger.
12. **Flash toasts are unsigned and client-parsable.** `rsl_toast` / `rsl_admin_toast` are `httpOnly: false` base64 JSON (`actions.ts`, `setWebFlashToastCookie`). Any script (or the user) can forge a success toast — e.g. "Payment verified" — inside the authenticated app. Sign the payload or store it server-side keyed by session.
13. **`lang="en"` hardcoded, no i18n.** Despite Bhashini/translation infrastructure and an explicitly Indian SMB audience, the UI is English-only, including all error strings, and `formatInr`/dates are the only localisation.
14. **No dark mode** anywhere (the design uses light surfaces exclusively), and no `prefers-color-scheme` handling.
15. **No cookie/consent banner** for DPDP/GDPR despite a cookie policy page and web-push opt-in.
16. **`TurnstileWidget` silently renders nothing** when the site key is absent, so an operator sees a normal login form with no indication that bot protection is disabled (ties to P0-1).
17. **Password UX gaps:** no strength meter, no caps-lock hint, no inline confirmation on reset, and the reset form pre-fills email+token from the (leaky) query string.
18. **`text-[10px]` uppercase tracking labels + 8 distinct accent hues in the sidebar** create a busy, "generated dashboard" look; the colour coding has no legend and no meaning beyond decoration.
19. **Duplicated help/nav content.** `apps/web/src/components/workspace-chrome.tsx` embeds `helpTitle/helpSummary/helpSteps` for every nav item *and* duplicates the same content in `apps/web/src/lib/page-guides.ts`. Two sources of truth for user-facing documentation will drift, and both ship to the client bundle.
20. **Print/export parity.** GST invoices and Tally vouchers have PDF export, but the on-screen invoice view (`/billing/invoices/[id]`) and the PDF are generated by separate code paths — expect divergence in totals/HSN formatting.

---

## 6. AI-generated-code patterns detected

Yes, clearly — this codebase reads as heavily LLM-assisted, and in ways that have real consequences.

1. **Requirements-document identifiers embedded in source.** Comments like `// Security (SEC-02)`, `(P2-08 / SEC-09)`, `(Section 14.5)`, `(P0-04)`, `(Section 22.6 step 9)`, `(P1-09)` appear across `apps/web/src/app/api/**`, `packages/queue`, `packages/backup`, `apps/admin/src/lib/session.ts`. These refer to a plan document (`RSL-MARKETING-PLAN.md`) that is not in the code, so the comment is unverifiable and will be stale forever. Worse, several of them assert a control that is only partially implemented (e.g. "SEC-06: revoke all active sessions on password reset" is true, while "P2-08: reject before touching ingress.db" is only true for signature validity, not for duplicate processing).
2. **Test suites that assert on source text rather than behaviour.** `apps/web/src/__tests__/features-phase21-security-rbac-auth.test.ts` reads `session.ts` and asserts `expect(setJarPart).not.toContain("domain:")`; reads `nginx.conf` and asserts it contains `Strict-Transport-Security`; requires `ecosystem.config.cjs` and asserts `apps.length === 7`. These pass when the behaviour is broken and fail when the code is reformatted. ~30 files named `features-phase{9..35}*.test.ts` follow this pattern — tests generated from the same plan as the code, validating the plan's vocabulary rather than the system.
3. **Fake AI fallbacks sold as AI.** `translateIndianBusinessText` falls back to `local_phrasebook`, which prepends "नमस्ते" / appends "धन्यवाद" and returns `ok: true`. If the UI does not surface `provider`, an untranslated English message is presented as Hindi. Same shape in `generateSmartAdCopy` → `template_engine` (a canned sentence), `generateSmartReviewDraft`, and supplier-bill "AI extraction" which silently degrades to a regex. This is the most damaging pattern in the product because it is a customer-trust issue, not a code-style one.
4. **Demo data reachable in product surfaces.** `packages/google/src/free-google-tools.ts` returns hardcoded Search Console metrics (`totalClicks28d: 428`, query `"wholesale hardware dealer near me"`) whenever the token starts with `rsl_sandbox_`; `syncWorkspaceCaGoogleSheet` fabricates a spreadsheet URL (`sb_sheet_...`); `packages/whatsapp` fabricates `meta_tmpl_sb_*` ids and marks them `APPROVED`. If a workspace is ever flipped to sandbox, dashboards show invented numbers with no visual marker.
5. **Feature naming by price tier instead of domain.** `free-ai-services.ts`, `free-google-tools.ts`, `free-tally-tools.ts` — modules grouped by "what is free" rather than bounded context. That is the shape you get when an agent optimises a file layout against a product narrative.
6. **Dead code preserved only to keep an import alive.** `void formatInrFromPaise(0); // ensure currency util imported cleanly` at the end of `syncWorkspaceCaGoogleSheet`.
7. **God modules.** `apps/web/src/lib/actions.ts` is **4,545 lines** with 100+ server actions covering auth, billing, wallet, inbox, Tally, WhatsApp, storage and backup in one `"use server"` file. `packages/auth/src/index.ts` is 1,855 lines. `packages/tally/src/index.ts` is similarly monolithic. That is not "many small functions"; it is one module per app, which destroys review quality, tree-shaking and incremental builds.
8. **Triplication.** The exact same custom `.env` parser is copy-pasted into `apps/web/next.config.ts`, `apps/admin/next.config.ts`, `apps/docs/next.config.ts`, `infra/pm2/ecosystem.config.cjs`, plus `packages/core/src/env.ts` and `setup.sh` — six implementations with different quoting/escaping rules. A value containing `#`, a trailing space, or `=` will parse differently depending on which loader sees it first.
9. **Marketing voice inside error messages and logs.** Strings like "— ₹0.00 deducted", "0-overdraft Managed Ad Spend Vault", "exactly untouched native Tally PDF", "1-Click" appear in worker skip reasons, API errors and code comments. Operator-facing logs should be neutral and machine-greppable, not promotional.
10. **Em-dash-heavy, uniformly enthusiastic prose** in comments and user strings (`"every figure comes directly from your real business records"`, `"Never estimated or sample numbers"`) — copy that asserts a guarantee the sandbox paths in #4 quietly break.

**Practical implication:** treat the phase-numbered tests as documentation, not coverage. You currently have no test that would fail if webhook dedupe, outbox dispatch, RBAC or the public bill page regressed.

---

## 7. Security hardening gaps (beyond P0/P1)

- **CSP is weak by construction.** `script-src 'self' 'unsafe-inline'` and `style-src 'self' 'unsafe-inline'` with no nonces/hashes; `connect-src https:` allows exfiltration to any HTTPS origin; `form-action 'self' https:` permits form posts to arbitrary HTTPS. A stored-XSS anywhere then has a working exfil channel. Move to nonce-based CSP (`middleware.ts` + `nonce` on script tags) and narrow `connect-src` to the actual providers (Meta, Google, Razorpay, Cloudflare, Sentry).
- **Missing security headers:** no `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `Origin-Agent-Cluster`, and no `Cache-Control: no-store` on authenticated HTML (Next.js sets `private` but be explicit).
- **Webhook signature comparison.** `verifyHmac` is used correctly (hex compare via `crypto.timingSafeEqual` in `api-keys`; verify `packages/core`'s implementation does too, since it's used for Meta/Tally/Razorpay).
- **`RslError.toPublicObject()` includes `details`.** Internal detail (SQLite messages, provider error bodies, table names) reaches API consumers. Map to catalog `userMessage` only in production; log `details` server-side.
- **Unvalidated `Bearer` fallbacks.** `POST /api/v1/pixel/events` falls back to `contacts:write` scope when `pixel:write` is missing — intentional for migration, but it means a contacts key can ingest conversion data (and spend attribution) indefinitely. Add a deprecation deadline.
- **`rate-limiter-flexible` insurance limiter.** `RateLimiterRedis` falls back to a **per-process in-memory** limiter when Redis is down (`insuranceLimiter`). With N instances, the effective limit becomes N × configured — fine at 1 process, wrong at 3.
- **No account-enumeration protection on registration.** `registerUserWithWorkspace` returns a distinct error for an existing email; only password-reset is genericised. Acceptable, but pair it with throttling.
- **`hashPassword` pepper/secret handling.** `deterministicDevSecret()` derives dev secrets from `sha256("rsl-dev-<seed>-<REPO_ROOT>")`. If `NODE_ENV` is ever not `production` on a production host (PM2 sets it, but dev/PM2 misconfig happens), every "secret" becomes predictable from a public repo path. Add a hard boot assertion: if `PRIMARY_DOMAIN` contains the production domain and `NODE_ENV !== "production"`, refuse to start.
- **`.env` in the repo folder** is read by four custom parsers and by PM2 at config-evaluation time; PM2 additionally injects it into every process. There is no secret manager, no rotation procedure, no per-environment separation, and `setup.sh` writes sudoers NOPASSWD for the SSL script.
- **File upload and CSV import.** `importContactsCsvAction` / `bulkImportContactsCsv` parse CSV by hand (regex split) with no size cap, no row cap, no MIME sniffing, and no dedupe against existing phone numbers. A 20 MB paste is a synchronous transaction on the request thread.

---

## 8. What a production-grade version is still missing

**Delivery and operations**
- [ ] CI pipeline (there is **no `.github/`**, no `Dockerfile`, no `*.yml` anywhere except the lockfile/workspace file)
- [ ] Lint configuration (no `eslint.config.*` / `.eslintrc*` present, yet `pnpm lint` is a script)
- [ ] Typecheck as a merge gate (`pnpm typecheck` exists; nothing runs it)
- [ ] `pnpm audit` / Dependabot / SBOM
- [ ] Pinned native dependency (`better-sqlite3` dual-resolution)
- [ ] Staging environment with production-like data volume
- [ ] Documented migration + **rollback** procedure (migrations are forward-only via `db:migrate`)
- [ ] Load test at target tenant count (the 3 s outbox sweep and per-request control-DB writes will fail first)
- [ ] Graceful shutdown/drain for the three Next apps (worker has it; web does not)
- [ ] Log aggregation + retention (PM2 `merge_logs` into local files only)
- [ ] Metrics/tracing beyond Sentry errors (no RED/USE dashboards, no per-tenant latency)
- [ ] Runbooks: restore drill, token rotation, Provider outage, queue backlog

**Security and compliance**
- [ ] MFA for staff, step-up auth for destructive admin actions
- [ ] Real rate limiting on auth and public forms
- [ ] CSRF/origin enforcement in middleware
- [ ] Nonce-based CSP
- [ ] Secret manager + rotation (KMS master key, backup signing key, API pepper, provider tokens)
- [ ] Column-level encryption for PII (phone, GSTIN) or documented DPDP posture
- [ ] Audit trail for **staff** actions exposed to customers (there is a platform log, but no customer-facing "who accessed my data")
- [ ] Data-retention schedule, erasure workflow, tenant deletion (crypto-shred + purge)
- [ ] Processor/sub-processor list and DPAs (Cloudflare, Meta, Google, Razorpay, SMTP, Sentry)
- [ ] Breach-notification procedure
- [ ] Penetration test before launch

**Product/engineering**
- [ ] Real test coverage for money, RBAC, webhooks, tenancy (behavioural, not source-text)
- [ ] E2E suite (Playwright) for onboarding → Tally sync → WhatsApp send → wallet
- [ ] Feature flags / staged rollout
- [ ] Public API versioning policy + OpenAPI spec generated from the zod schemas
- [ ] Idempotency-Key header support on all public POSTs
- [ ] Pagination on every list (inbox, contacts, activity, vouchers are hard-capped at 25/100/150/1000)
- [ ] Error budget/SLOs and alerting
- [ ] i18n scaffolding (Hindi at minimum)
- [ ] Accessibility audit (WCAG 2.2 AA) — charts, palette, tables, contrast
- [ ] Onboarding/verification email deliverability setup (SPF/DKIM/DMARC, bounce handling)
- [ ] Support tooling: customer-facing status page, incident comms

---

## 9. Suggested remediation sequence

**Sprint 1 — "don't get owned" (≈1 week)**
P0-1 (Turnstile), P0-2 (auth throttling), P0-6 (staff MFA), P0-7 (bootstrap race), P1-2 (delete unguarded auth actions), P1-11 (raw token branch), P1-10 (middleware + CSRF + strict cookies).

**Sprint 2 — "don't lose data" (≈2 weeks)**
P0-3 (outbox silent drop), P0-4 (webhook dedupe), P0-5 (queue the webhooks + ingress sweeper), P1-7 (Razorpay transactional credit), P1-14 (outbound webhook retries), P1-12 (real durations), add behavioural tests for all of the above.

**Sprint 3 — "make it fast enough" (≈2–3 weeks)**
P1-4 (batch `lastUsedAt`, cache RBAC/session), P1-5 (split health/ready, internal secret), P1-3 (async/stronger hashing), precompute analytics, fix the worker's tenant sweep, single `better-sqlite3` version.

**Sprint 4 — "make it honest" (≈1 week)**
Remove or clearly label sandbox/demo data (AI pattern #3/#4), surface AI `provider` in the UI, delete dead paths, split `actions.ts` into domain modules, replace phase-numbered source-text tests with behaviour tests.

**Sprint 5 — "make it operable" (≈2 weeks)**
CI + lint + typecheck gates, images, staging, load test, restore drill, runbooks, metrics.

**Sprint 6 — "make it sellable" (≈2 weeks)**
Tenant deletion/erasure, retention, DPDP artefacts, MFA step-up UX, a11y pass, i18n scaffold, pagination, OpenAPI.

---

## 10. Quick wins (a day or less each, high value)

1. Delete the Turnstile dummy-token branch. (P0-1)
2. `if (inserted.changes === 0) return NextResponse.json({ ok: true, deduplicated: true })` in the Meta and WhatsApp routes. (P0-4)
3. Throw when `processor` is undefined in `processDueSqliteOutboxForTenant`. (P0-3)
4. Add `apps/web/src/app/(dashboard)/error.tsx`. (UX #1)
5. Replace hardcoded `durationMs` with `Date.now() - started`. (P1-12)
6. Remove `registerAction`/`loginAction` or route them through the guarded implementations. (P1-2)
7. Add `timeZone: "Asia/Kolkata"` to every `toLocaleString`. (UX #4)
8. Move the verification code and reset token out of the URL. (P0-8)
9. Add `scope="col"` to table headers and a `<caption>` to the two dashboard tables. (UX #10)
10. Remove the `rawToken` branch from the impersonation route. (P1-11)

---

*Report produced from static analysis only. No runtime profiling, penetration testing, or dependency-vulnerability scanning was performed — the performance figures above are derived from code structure and known characteristics of the libraries in use, not measurements. A load test against a staging copy is required before treating any of the scale findings as final.*
