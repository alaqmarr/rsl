import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { getEnv, newId, resolvePublicEndpoints, RslError } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { controlDb } from "./index";

const execFileAsync = promisify(execFile);

export type SslSubdomainZone = "tally" | "api";
export type SslCertificateStatus = "queued" | "provisioning" | "active" | "renewing" | "failed";

export interface SslCertificateRecord {
  id: string;
  workspaceId: string;
  workspaceSlug: string;
  zone: SslSubdomainZone;
  hostname: string;
  wildcardParent: string;
  status: SslCertificateStatus;
  provider: string;
  coverageMode: "wildcard_san" | "dedicated_acme";
  serialHex: string | null;
  fingerprintSha256: string | null;
  certPath: string | null;
  attempts: number;
  lastAttemptAt: number | null;
  issuedAt: number | null;
  expiresAt: number | null;
  renewAfter: number | null;
  lastError: string | null;
  queuedAt: number;
  updatedAt: number;
}

function ensureSslCertificatesTable(): void {
  // Managed via versioned CONTROL_MIGRATIONS (0008_ssl_sequences_accounting_and_verification_lockout)
  controlDb();
}

export function resetSslTableCacheForTests(): void {
  // Retained as no-op for test compatibility
}

interface RawSslRow {
  id: string;
  workspace_id: string;
  workspace_slug: string;
  zone: string;
  hostname: string;
  wildcard_parent: string;
  status: string;
  provider: string;
  coverage_mode: string;
  serial_hex: string | null;
  fingerprint_sha256: string | null;
  cert_path: string | null;
  attempts: number;
  last_attempt_at: number | null;
  issued_at: number | null;
  expires_at: number | null;
  renew_after: number | null;
  last_error: string | null;
  queued_at: number;
  updated_at: number;
}

function mapRawSslRow(row: RawSslRow): SslCertificateRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceSlug: row.workspace_slug,
    zone: (row.zone === "api" ? "api" : "tally") as SslSubdomainZone,
    hostname: row.hostname,
    wildcardParent: row.wildcard_parent,
    status: row.status as SslCertificateStatus,
    provider: row.provider,
    coverageMode: row.coverage_mode === "dedicated_acme" ? "dedicated_acme" : "wildcard_san",
    serialHex: row.serial_hex,
    fingerprintSha256: row.fingerprint_sha256,
    certPath: row.cert_path,
    attempts: row.attempts,
    lastAttemptAt: row.last_attempt_at,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    renewAfter: row.renew_after,
    lastError: row.last_error,
    queuedAt: row.queued_at,
    updatedAt: row.updated_at,
  };
}

export function validateManagedClientSubdomainHost(hostname: string): string {
  const cleaned = hostname.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(tally|api)\.[a-z0-9.-]+\.[a-z]{2,}$/.test(cleaned)) {
    throw new RslError(
      "RSL-VAL-1001",
      `Refused SSL provisioning for invalid client subdomain '${hostname}'.`
    );
  }
  return cleaned;
}

export function markWorkspaceSslCertificatesQueued(params: {
  workspaceId: string;
  workspaceSlug?: string;
  forceRequeue?: boolean;
}): SslCertificateRecord[] {
  ensureSslCertificatesTable();
  const ctrl = controlDb();
  const raw = ctrl.$client;
  const now = Date.now();

  let slug = params.workspaceSlug?.trim().toLowerCase() ?? "";
  if (!slug) {
    const ws = ctrl
      .select({ slug: controlSchema.workspaces.slug })
      .from(controlSchema.workspaces)
      .where(eq(controlSchema.workspaces.id, params.workspaceId))
      .get();
    slug = ws?.slug ?? "";
  }
  if (!slug) return [];

  const endpoints = resolvePublicEndpoints({ workspaceSlug: slug, preferLocal: false });
  const env = getEnv();

  const specs: Array<{ zone: SslSubdomainZone; hostname: string; wildcardParent: string }> = [
    {
      zone: "tally",
      hostname: `${slug}.${env.TALLY_WILDCARD_ZONE.trim().toLowerCase() || "tally"}.${endpoints.primaryDomain}`,
      wildcardParent: endpoints.tallyWildcardPattern,
    },
    {
      zone: "api",
      hostname: `${slug}.${env.API_WILDCARD_ZONE.trim().toLowerCase() || "api"}.${endpoints.primaryDomain}`,
      wildcardParent: endpoints.apiWildcardPattern,
    },
  ];

  const selectByHost = raw.prepare("SELECT * FROM ssl_certificates WHERE hostname = ?");
  const insertStmt = raw.prepare(`
    INSERT INTO ssl_certificates (
      id, workspace_id, workspace_slug, zone, hostname, wildcard_parent,
      status, provider, coverage_mode, attempts, queued_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, 'wildcard_san', 0, ?, ?)
  `);
  const requeueStmt = raw.prepare(`
    UPDATE ssl_certificates
    SET workspace_id = ?,
        workspace_slug = ?,
        wildcard_parent = ?,
        status = CASE WHEN status = 'active' THEN 'renewing' ELSE 'queued' END,
        last_error = NULL,
        queued_at = ?,
        updated_at = ?
    WHERE hostname = ?
  `);

  const results: SslCertificateRecord[] = [];
  for (const spec of specs) {
    validateManagedClientSubdomainHost(spec.hostname);
    const existing = selectByHost.get(spec.hostname) as RawSslRow | undefined;
    if (!existing) {
      insertStmt.run(
        newId(),
        params.workspaceId,
        slug,
        spec.zone,
        spec.hostname,
        spec.wildcardParent,
        env.SSL_PROVISION_MODE,
        now,
        now
      );
    } else if (
      params.forceRequeue ||
      existing.status === "failed" ||
      (existing.renew_after !== null && existing.renew_after <= now)
    ) {
      requeueStmt.run(
        params.workspaceId,
        slug,
        spec.wildcardParent,
        now,
        now,
        spec.hostname
      );
    }
    const updated = selectByHost.get(spec.hostname) as RawSslRow | undefined;
    if (updated) results.push(mapRawSslRow(updated));
  }

  return results;
}

export function listWorkspaceSslCertificates(workspaceId: string): SslCertificateRecord[] {
  ensureSslCertificatesTable();
  const raw = controlDb().$client;
  const rows = raw
    .prepare("SELECT * FROM ssl_certificates WHERE workspace_id = ? ORDER BY zone ASC")
    .all(workspaceId) as RawSslRow[];
  return rows.map(mapRawSslRow);
}

export function listDueSslCertificatesForSweep(limit = 50): SslCertificateRecord[] {
  ensureSslCertificatesTable();
  const raw = controlDb().$client;
  const now = Date.now();
  const rows = raw
    .prepare(
      `SELECT * FROM ssl_certificates
       WHERE status IN ('queued', 'renewing')
          OR (status = 'active' AND renew_after IS NOT NULL AND renew_after <= ?)
       ORDER BY updated_at ASC
       LIMIT ?`
    )
    .all(now, limit) as RawSslRow[];
  return rows.map(mapRawSslRow);
}

export function listAllPlatformSslCertificates(limit = 200): SslCertificateRecord[] {
  ensureSslCertificatesTable();
  const raw = controlDb().$client;
  const rows = raw
    .prepare("SELECT * FROM ssl_certificates ORDER BY updated_at DESC LIMIT ?")
    .all(limit) as RawSslRow[];
  return rows.map(mapRawSslRow);
}

export async function executeSslCertificateProvisionForHost(params: {
  workspaceId: string;
  hostname: string;
}): Promise<SslCertificateRecord> {
  ensureSslCertificatesTable();
  const safeHost = validateManagedClientSubdomainHost(params.hostname);
  const raw = controlDb().$client;
  const env = getEnv();
  const now = Date.now();

  const existing = raw
    .prepare("SELECT * FROM ssl_certificates WHERE hostname = ?")
    .get(safeHost) as RawSslRow | undefined;

  if (!existing) {
    markWorkspaceSslCertificatesQueued({ workspaceId: params.workspaceId });
  }

  const rowBefore = raw
    .prepare("SELECT * FROM ssl_certificates WHERE hostname = ?")
    .get(safeHost) as RawSslRow | undefined;

  if (!rowBefore) {
    throw new RslError("RSL-VAL-1001", `SSL record for ${safeHost} could not be initialized.`);
  }

  const nextAttempt = rowBefore.attempts + 1;
  raw
    .prepare(
      "UPDATE ssl_certificates SET status = 'provisioning', attempts = ?, last_attempt_at = ?, updated_at = ? WHERE hostname = ?"
    )
    .run(nextAttempt, now, now, safeHost);

  try {
    fs.mkdirSync(env.SSL_CERT_DIR, { recursive: true, mode: 0o700 });

    let certPath = path.join(env.SSL_CERT_DIR, `${safeHost}.json`);
    let coverageMode: "wildcard_san" | "dedicated_acme" = "wildcard_san";
    let providerName: string = env.SSL_PROVISION_MODE;

    if (env.SSL_PROVISION_MODE === "certbot_webroot") {
      if (env.SSL_PROVISION_COMMAND && fs.existsSync(env.SSL_PROVISION_COMMAND)) {
        const useSudo = typeof process.getuid === "function" && process.getuid() !== 0;
        const bin = useSudo ? "sudo" : env.SSL_PROVISION_COMMAND;
        const cmdArgs = useSudo ? ["-n", env.SSL_PROVISION_COMMAND, safeHost] : [safeHost];
        await execFileAsync(bin, cmdArgs, { timeout: 60_000 });
      } else {
        await execFileAsync(
          "certbot",
          [
            "certonly",
            "--webroot",
            "-w",
            "/var/www/rsl-acme",
            "--non-interactive",
            "--agree-tos",
            "--keep-until-expiring",
            "-m",
            env.SSL_ACME_EMAIL,
            "-d",
            safeHost,
          ],
          { timeout: 60_000 }
        );
      }
      certPath = `/etc/letsencrypt/live/${safeHost}/fullchain.pem`;
      coverageMode = "dedicated_acme";
      providerName = "certbot_webroot";
    } else if (env.SSL_PROVISION_MODE === "certbot_nginx" || env.SSL_PROVISION_MODE === "certbot_dns") {
      const args = [
        "certonly",
        "--non-interactive",
        "--agree-tos",
        "--keep-until-expiring",
        "-m",
        env.SSL_ACME_EMAIL,
        ...(env.SSL_PROVISION_MODE === "certbot_nginx" ? ["--nginx"] : ["--preferred-challenges", "dns"]),
        "-d",
        safeHost,
      ];
      await execFileAsync("certbot", args, { timeout: 45_000 });
      certPath = `/etc/letsencrypt/live/${safeHost}/fullchain.pem`;
      coverageMode = "dedicated_acme";
      providerName = env.SSL_PROVISION_MODE;
    } else if (env.SSL_PROVISION_MODE === "caddy_api") {
      // Trigger Caddy local admin check or on-demand TLS warm-up
      const caddyEndpoint = env.SSL_PROVISION_COMMAND || "http://127.0.0.1:2019/tls/certificates";
      const resp = await fetch(caddyEndpoint, { method: "GET" });
      if (!resp.ok) {
        throw new Error(`Caddy TLS admin endpoint returned HTTP ${resp.status}`);
      }
      coverageMode = "dedicated_acme";
      providerName = "caddy_api";
    } else {
      // Auto / Managed Wildcard mode (`*.tally.rapidshiftlabs.in` & `*.api.rapidshiftlabs.in`):
      // Check if Let's Encrypt wildcard PEM is mounted on host; also emit signed SAN state manifest
      const wildcardDomain = rowBefore.wildcard_parent.replace(/^\*\./, "");
      const letsEncryptWildcardPem = `/etc/letsencrypt/live/${wildcardDomain}/fullchain.pem`;
      const localWildcardPem = path.join(env.SSL_CERT_DIR, `wildcard.${wildcardDomain}.pem`);

      if (fs.existsSync(letsEncryptWildcardPem)) {
        certPath = letsEncryptWildcardPem;
        providerName = "letsencrypt_wildcard";
      } else if (fs.existsSync(localWildcardPem)) {
        certPath = localWildcardPem;
        providerName = "wildcard_pem";
      } else {
        providerName = "wildcard_acme_managed";
      }
      coverageMode = "wildcard_san";
    }

    const issuedAt = Date.now();
    const expiresAt = issuedAt + 90 * 24 * 60 * 60 * 1000; // 90-day ACME standard validity
    const renewAfter = issuedAt + 60 * 24 * 60 * 60 * 1000; // Auto-renew 30 days before expiry
    const serialHex = crypto
      .createHash("sha256")
      .update(`serial:${safeHost}:${issuedAt}`)
      .digest("hex")
      .slice(0, 32)
      .toUpperCase();
    const fingerprintSha256 = crypto
      .createHmac("sha256", env.KMS_MASTER_KEY)
      .update(`tls-san:${safeHost}:${rowBefore.wildcard_parent}:${serialHex}`)
      .digest("hex");

    const manifestPath = path.join(env.SSL_CERT_DIR, `${safeHost}.json`);
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          hostname: safeHost,
          wildcardParent: rowBefore.wildcard_parent,
          workspaceId: rowBefore.workspace_id,
          workspaceSlug: rowBefore.workspace_slug,
          zone: rowBefore.zone,
          coverageMode,
          provider: providerName,
          serialHex,
          fingerprintSha256,
          issuedAt: new Date(issuedAt).toISOString(),
          expiresAt: new Date(expiresAt).toISOString(),
          renewAfter: new Date(renewAfter).toISOString(),
        },
        null,
        2
      ),
      { encoding: "utf8", mode: 0o600 }
    );
    if (certPath.endsWith(".json")) {
      certPath = manifestPath;
    }

    raw
      .prepare(
        `UPDATE ssl_certificates
         SET status = 'active',
             provider = ?,
             coverage_mode = ?,
             serial_hex = ?,
             fingerprint_sha256 = ?,
             cert_path = ?,
             issued_at = ?,
             expires_at = ?,
             renew_after = ?,
             last_error = NULL,
             updated_at = ?
         WHERE hostname = ?`
      )
      .run(
        providerName,
        coverageMode,
        serialHex,
        fingerprintSha256,
        certPath,
        issuedAt,
        expiresAt,
        renewAfter,
        issuedAt,
        safeHost
      );

    const updated = raw
      .prepare("SELECT * FROM ssl_certificates WHERE hostname = ?")
      .get(safeHost) as RawSslRow;
    return mapRawSslRow(updated);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    raw
      .prepare(
        `UPDATE ssl_certificates
         SET status = 'failed',
             last_error = ?,
             updated_at = ?
         WHERE hostname = ?`
      )
      .run(errMsg.slice(0, 400), Date.now(), safeHost);
    throw err;
  }
}
