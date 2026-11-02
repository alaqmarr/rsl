import { NextResponse } from "next/server";
import { getEnv } from "@rsl/core";
import { getPlatformQueueOverview, isRedisConfigured } from "@rsl/queue";
import { controlDb, getTenancyHandleMetrics, ingressDb, platformLogsDb } from "@rsl/tenancy";

export async function GET() {
  const env = getEnv();
  const c = controlDb().$client.prepare("PRAGMA quick_check").get() as { quick_check: string };
  const i = ingressDb().$client.prepare("PRAGMA quick_check").get() as { quick_check: string };
  const p = platformLogsDb().$client.prepare("PRAGMA quick_check").get() as { quick_check: string };
  const handles = getTenancyHandleMetrics();
  const queues = getPlatformQueueOverview();

  const healthy = c.quick_check === "ok" && i.quick_check === "ok" && p.quick_check === "ok";
  return NextResponse.json(
    {
      ready: healthy,
      portRangePolicy: "4500-4600_strict",
      webPort: 4500,
      adminPort: 4501,
      docsPort: 4502,
      workerHealthPort: env.WORKER_HEALTH_PORT,
      cleanupHealthPort: env.CLEANUP_SERVICE_PORT,
      controlDb: c.quick_check,
      ingressDb: i.quick_check,
      platformLogsDb: p.quick_check,
      queueMode: isRedisConfigured() ? "bullmq_redis" : "sqlite_durable",
      pendingJobs: queues.pendingCount,
      failedJobs: queues.failedCount,
      tenancyHandles: handles,
      checkedAt: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 }
  );
}
