import { newId, type ActorType } from "@rsl/core";
import {
  executeSslCertificateProvisionForHost,
  listDueSslCertificatesForSweep,
  listWorkspaceSslCertificates,
  markWorkspaceSslCertificatesQueued,
  type SslCertificateRecord,
} from "@rsl/tenancy";
import {
  enqueueJob,
  isRedisConfigured,
  processDueSqliteOutboxForTenant,
  registerJobProcessor,
} from "./index";

let sslProcessorRegistered = false;

export function ensureSslProvisionProcessorRegistered(): void {
  if (sslProcessorRegistered) return;
  registerJobProcessor("ssl.certificate.provision", async (envelope) => {
    const hostname = String(envelope.payload.hostname ?? "").trim();
    if (!hostname) return;
    await executeSslCertificateProvisionForHost({
      workspaceId: envelope.tenantId,
      hostname,
    });
  });
  sslProcessorRegistered = true;
}

export async function enqueueWorkspaceSslProvisioning(params: {
  workspaceId: string;
  workspaceSlug?: string;
  actorType?: ActorType;
  actorId?: string;
  forceRenew?: boolean;
  processInlineIfLocal?: boolean;
}): Promise<{
  queuedJobs: number;
  certificates: SslCertificateRecord[];
}> {
  ensureSslProvisionProcessorRegistered();

  const records = markWorkspaceSslCertificatesQueued({
    workspaceId: params.workspaceId,
    workspaceSlug: params.workspaceSlug,
    forceRequeue: params.forceRenew ?? false,
  });

  const corr = newId();
  let queuedJobs = 0;
  const bucket = Math.floor(Date.now() / (params.forceRenew ? 1000 : 60_000));

  for (const cert of records) {
    if (cert.status === "queued" || cert.status === "renewing") {
      await enqueueJob({
        queue: "ssl.provision",
        jobType: "ssl.certificate.provision",
        tenantId: params.workspaceId,
        correlationId: corr,
        requestId: corr,
        actorType: params.actorType ?? "system",
        actorId: params.actorId ?? "ssl_queue_manager",
        idempotencyKey: `ssl_prov:${params.workspaceId}:${cert.hostname}:${bucket}`,
        payload: {
          hostname: cert.hostname,
          zone: cert.zone,
          wildcardParent: cert.wildcardParent,
          workspaceSlug: cert.workspaceSlug,
        },
      });
      queuedJobs++;
    }
  }

  if ((params.processInlineIfLocal ?? true) && !isRedisConfigured() && queuedJobs > 0) {
    await processDueSqliteOutboxForTenant(params.workspaceId);
  }

  return {
    queuedJobs,
    certificates: listWorkspaceSslCertificates(params.workspaceId),
  };
}

export async function ensureWorkspaceSslProvisioned(
  workspaceId: string,
  workspaceSlug?: string
): Promise<SslCertificateRecord[]> {
  ensureSslProvisionProcessorRegistered();
  const existing = listWorkspaceSslCertificates(workspaceId);
  const now = Date.now();
  const needsQueue =
    existing.length < 2 ||
    existing.some(
      (c) =>
        c.status === "queued" ||
        c.status === "renewing" ||
        (c.renewAfter !== null && c.renewAfter <= now)
    );

  if (needsQueue) {
    const res = await enqueueWorkspaceSslProvisioning({
      workspaceId,
      workspaceSlug,
      actorType: "system",
      actorId: "ssl_auto_provisioner",
      processInlineIfLocal: true,
    });
    return res.certificates;
  }

  return existing;
}

export async function sweepDueSslProvisioningJobs(limit = 50): Promise<{
  enqueued: number;
  processedTenants: number;
}> {
  ensureSslProvisionProcessorRegistered();
  const due = listDueSslCertificatesForSweep(limit);
  if (due.length === 0) {
    return { enqueued: 0, processedTenants: 0 };
  }

  const byWorkspace = new Set<string>();
  let enqueued = 0;

  for (const cert of due) {
    byWorkspace.add(cert.workspaceId);
    const corr = newId();
    await enqueueJob({
      queue: "ssl.provision",
      jobType: "ssl.certificate.provision",
      tenantId: cert.workspaceId,
      correlationId: corr,
      requestId: corr,
      actorType: "system",
      actorId: "ssl_renewal_sweeper",
      idempotencyKey: `ssl_sweep:${cert.workspaceId}:${cert.hostname}:${Math.floor(Date.now() / 60_000)}`,
      payload: {
        hostname: cert.hostname,
        zone: cert.zone,
        wildcardParent: cert.wildcardParent,
        workspaceSlug: cert.workspaceSlug,
      },
    });
    enqueued++;
  }

  let processedTenants = 0;
  if (!isRedisConfigured()) {
    for (const workspaceId of byWorkspace) {
      await processDueSqliteOutboxForTenant(workspaceId);
      processedTenants++;
    }
  }

  return { enqueued, processedTenants };
}
