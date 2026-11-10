#!/usr/bin/env node
/**
 * Local & staging HTTP load-test harness for RapidShift Labs (`@rsl/web`).
 * Measures latency percentiles (p50 / p95 / p99), throughput (req/s), HTTP status
 * distribution, and SQLite busy / 5xx error rates without external dependencies.
 *
 * Usage:
 *   node scripts/load-test-local.mjs --base=http://127.0.0.1:4500 --concurrency=25 --requests=250
 */
import { performance } from "node:perf_hooks";

function parseArg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (!found) return fallback;
  return found.slice(prefix.length);
}

const baseUrl = String(parseArg("base", process.env.LOADTEST_BASE_URL || "http://127.0.0.1:4500")).replace(/\/+$/, "");
const concurrency = Math.max(1, Math.min(200, Number(parseArg("concurrency", "20")) || 20));
const totalRequests = Math.max(concurrency, Math.min(20_000, Number(parseArg("requests", "200")) || 200));
const timeoutMs = Math.max(1000, Number(parseArg("timeoutMs", "10000")) || 10000);
const pathsRaw = String(parseArg("paths", "/api/health,/pricing,/login"));
const paths = pathsRaw
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

function percentile(sortedValues, pct) {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((pct / 100) * sortedValues.length) - 1)
  );
  return sortedValues[idx];
}

async function runLoadTest() {
  console.log(
    `[loadtest] Target: ${baseUrl} | Concurrency: ${concurrency} | Total requests: ${totalRequests} | Paths: ${paths.join(", ")}`
  );

  // Warmup probe so cold route compilation doesn't skew steady-state percentiles
  try {
    const warmupRes = await fetch(`${baseUrl}${paths[0] || "/api/health"}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    await warmupRes.arrayBuffer();
  } catch (err) {
    console.error(`[loadtest] Target ${baseUrl} is unreachable: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const latenciesMs = [];
  const statusCounts = new Map();
  let sqliteBusyErrors = 0;
  let networkOrTimeoutErrors = 0;
  let nextIndex = 0;

  const startedAt = performance.now();

  async function workerLoop() {
    while (true) {
      const idx = nextIndex++;
      if (idx >= totalRequests) break;

      const targetPath = paths[idx % paths.length];
      const url = `${baseUrl}${targetPath}`;
      const reqStart = performance.now();
      try {
        const res = await fetch(url, {
          headers: {
            Accept: "application/json, text/html;q=0.9",
            "User-Agent": "rsl-local-loadtest/1.0",
          },
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
        });
        const bodyText = await res.text();
        const elapsed = performance.now() - reqStart;
        latenciesMs.push(elapsed);

        statusCounts.set(res.status, (statusCounts.get(res.status) || 0) + 1);
        if (/SQLITE_BUSY|database is locked/i.test(bodyText)) {
          sqliteBusyErrors += 1;
        }
      } catch {
        const elapsed = performance.now() - reqStart;
        latenciesMs.push(elapsed);
        networkOrTimeoutErrors += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => workerLoop()));

  const wallMs = Math.max(1, performance.now() - startedAt);
  latenciesMs.sort((a, b) => a - b);

  const reqPerSec = (totalRequests / (wallMs / 1000)).toFixed(2);
  const p50 = percentile(latenciesMs, 50).toFixed(2);
  const p95 = percentile(latenciesMs, 95).toFixed(2);
  const p99 = percentile(latenciesMs, 99).toFixed(2);
  const maxMs = (latenciesMs[latenciesMs.length - 1] || 0).toFixed(2);

  let server5xxCount = 0;
  const statusSummary = [];
  for (const [status, count] of [...statusCounts.entries()].sort((a, b) => a[0] - b[0])) {
    statusSummary.push(`${status}:${count}`);
    if (status >= 500) server5xxCount += count;
  }

  console.log("------------------------------------------------------------");
  console.log(`[loadtest] Completed ${totalRequests} requests in ${(wallMs / 1000).toFixed(2)}s (${reqPerSec} req/s)`);
  console.log(`[loadtest] Latency (ms): p50=${p50} | p95=${p95} | p99=${p99} | max=${maxMs}`);
  console.log(`[loadtest] Status codes: ${statusSummary.join(", ") || "none"}`);
  console.log(
    `[loadtest] Errors: 5xx=${server5xxCount} | sqlite_busy=${sqliteBusyErrors} | network/timeout=${networkOrTimeoutErrors}`
  );
  console.log("------------------------------------------------------------");

  if (server5xxCount > 0 || sqliteBusyErrors > 0 || networkOrTimeoutErrors > 0) {
    process.exit(1);
  }
}

runLoadTest().catch((err) => {
  console.error("[loadtest] Unexpected failure:", err);
  process.exit(1);
});
