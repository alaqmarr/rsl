#!/usr/bin/env node
/**
 * Safe, Multi-Tenant Host PM2 Restart & Cleanup Manager for RSL Marketing
 *
 * IRONCLAD SAFETY RULES FOR SHARED SERVERS:
 * 1. NEVER executes `pm2 kill`, `pm2 restart all`, `pm2 stop all`, `pm2 delete all`, or global `pm2 flush`.
 * 2. ONLY operates on the explicit RSL_PM2_APPS allowlist in namespace `rsl-marketing`.
 * 3. ONLY inspects ports strictly inside 4500–4600, and ONLY cleans up orphaned PIDs whose
 *    command line or working directory explicitly belongs to this `rslmarketing` repository.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ECOSYSTEM_PATH = path.join(REPO_ROOT, "infra", "pm2", "ecosystem.config.cjs");

function loadRootDotEnvIntoProcess() {
  const envFile = path.join(REPO_ROOT, ".env");
  if (!fs.existsSync(envFile)) return;
  for (const rawLine of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    if (process.env[key] !== undefined) continue;
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadRootDotEnvIntoProcess();

const PORT_MIN = 4500;
const PORT_MAX = 4600;

const RSL_PORTS = [4500, 4501, 4502, 4510, 4511, 4512, 4520];
const RSL_PM2_APPS = [
  "rsl-web",
  "rsl-admin",
  "rsl-docs",
  "rsl-worker-realtime",
  "rsl-worker-bulk",
  "rsl-worker-maintenance",
  "rsl-cleanup",
];
const RSL_ONLY_CSV = RSL_PM2_APPS.join(",");
const PM2_BIN = process.platform === "win32" ? "pm2.cmd" : "pm2";

function assertSafePort(port) {
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
    throw new Error(`Refusing to inspect port ${port}: outside 4500-4600 range!`);
  }
}

function runPm2(args) {
  const res = spawnSync(PM2_BIN, args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (res.status !== 0) {
    throw new Error(`PM2 command failed: pm2 ${args.join(" ")}`);
  }
}

function getPm2ProcessList() {
  try {
    const out = execFileSync(PM2_BIN, ["jlist"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: process.platform === "win32",
    });
    return JSON.parse(out);
  } catch {
    return [];
  }
}

function assertNextBuildsPresent() {
  const nextApps = ["web", "admin", "docs"];
  for (const app of nextApps) {
    const buildIdFile = path.join(REPO_ROOT, "apps", app, ".next", "BUILD_ID");
    if (!fs.existsSync(buildIdFile)) {
      throw new Error(
        `[rsl-pm2] Refusing to start/reload: missing production Next.js build at apps/${app}/.next/BUILD_ID. Run 'pnpm build' first!`
      );
    }
  }
}

function cleanNextBuildLocks() {
  const nextApps = ["web", "admin", "docs"];
  let cleaned = 0;
  for (const app of nextApps) {
    const traceFile = path.join(REPO_ROOT, "apps", app, ".next", "trace");
    const lockFile = path.join(REPO_ROOT, "apps", app, ".next", "cache", "webpack", "lock");
    for (const target of [traceFile, lockFile]) {
      if (fs.existsSync(target)) {
        try {
          fs.unlinkSync(target);
          cleaned++;
        } catch {
          // Held by active process
        }
      }
    }
  }
  if (cleaned > 0) {
    console.log(`[rsl-pm2] Removed ${cleaned} stale Next.js trace/lock file(s).`);
  }
}

function cleanOrphanedRslPortListeners(managedRslPids) {
  for (const port of RSL_PORTS) {
    assertSafePort(port);
  }

  if (process.platform === "linux") {
    for (const port of RSL_PORTS) {
      try {
        const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
          encoding: "utf8",
        }).trim();
        if (!out) continue;
        for (const pidStr of out.split(/\s+/)) {
          const pid = Number(pidStr);
          if (!pid || managedRslPids.has(pid)) continue;
          const cmdline = fs.existsSync(`/proc/${pid}/cmdline`)
            ? fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ")
            : "";
          const cwd = fs.existsSync(`/proc/${pid}/cwd`) ? fs.readlinkSync(`/proc/${pid}/cwd`) : "";
          if (cmdline.includes("rslmarketing") || cwd.includes("rslmarketing") || cwd.startsWith(REPO_ROOT)) {
            console.log(`[rsl-pm2] Terminating orphaned RSL listener PID ${pid} on port ${port}...`);
            process.kill(pid, "SIGTERM");
          } else {
            console.warn(
              `[rsl-pm2] WARNING: Port ${port} is held by non-RSL PID ${pid} (${cwd}). Leaving it untouched per isolation policy!`
            );
          }
        }
      } catch {
        // lsof returns exit code 1 when port is free
      }
    }
  }
}

function runOneShotDbAndLogCleanup() {
  console.log("[rsl-pm2] Running RSL database, staging & log cleanup (--once)...");
  const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const res = spawnSync(pnpmBin, ["exec", "tsx", "infra/pm2/rsl-cleanup-service.ts", "--once"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (res.status !== 0) {
    console.warn("[rsl-pm2] Warning: one-shot cleanup exited with non-zero code.");
  }
}

async function verifyRslHealth() {
  const endpoints = [
    { name: "rsl-web", url: "http://127.0.0.1:4500/api/health" },
    { name: "rsl-admin", url: "http://127.0.0.1:4501/api/health" },
    { name: "rsl-docs", url: "http://127.0.0.1:4502/api/health" },
    { name: "rsl-worker-realtime", url: "http://127.0.0.1:4510/health" },
    { name: "rsl-worker-bulk", url: "http://127.0.0.1:4511/health" },
    { name: "rsl-worker-maintenance", url: "http://127.0.0.1:4512/health" },
    { name: "rsl-cleanup", url: "http://127.0.0.1:4520/health" },
  ];

  console.log("[rsl-pm2] Verifying RSL health endpoints on ports 4500-4520...");
  for (const ep of endpoints) {
    let healthy = false;
    for (let attempt = 1; attempt <= 8; attempt++) {
      try {
        const res = await fetch(ep.url, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          healthy = true;
          break;
        }
      } catch {
        // Wait for startup
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    console.log(`  ${healthy ? "✓" : "⨯"} ${ep.name.padEnd(24)} -> ${ep.url} (${healthy ? "HEALTHY" : "STARTING/UNREACHABLE"})`);
  }
}

async function main() {
  const action = process.argv[2] || "status";
  const allProcs = getPm2ProcessList();
  const existingRslProcs = allProcs.filter((p) => RSL_PM2_APPS.includes(p.name));
  const managedRslPids = new Set(existingRslProcs.map((p) => p.pid).filter(Boolean));
  const nonRslCount = allProcs.length - existingRslProcs.length;

  console.log(
    `[rsl-pm2] Isolation active: ${existingRslProcs.length} RSL process(es), ${nonRslCount} unrelated PM2 process(es) left completely untouched.`
  );

  switch (action) {
    case "cleanup": {
      cleanOrphanedRslPortListeners(managedRslPids);
      cleanNextBuildLocks();
      runOneShotDbAndLogCleanup();
      break;
    }

    case "start": {
      assertNextBuildsPresent();
      cleanOrphanedRslPortListeners(managedRslPids);
      cleanNextBuildLocks();
      runOneShotDbAndLogCleanup();
      runPm2(["start", ECOSYSTEM_PATH, "--only", RSL_ONLY_CSV, "--update-env"]);
      runPm2(["save"]);
      await verifyRslHealth();
      break;
    }

    case "restart": {
      assertNextBuildsPresent();
      runOneShotDbAndLogCleanup();
      cleanOrphanedRslPortListeners(managedRslPids);
      if (existingRslProcs.length > 0) {
        for (const appName of RSL_PM2_APPS) {
          if (existingRslProcs.some((p) => p.name === appName)) {
            runPm2(["restart", appName, "--update-env"]);
          }
        }
      } else {
        runPm2(["start", ECOSYSTEM_PATH, "--only", RSL_ONLY_CSV, "--update-env"]);
      }
      runPm2(["save"]);
      await verifyRslHealth();
      break;
    }

    case "reload": {
      assertNextBuildsPresent();
      runOneShotDbAndLogCleanup();
      cleanOrphanedRslPortListeners(managedRslPids);
      runPm2(["start", ECOSYSTEM_PATH, "--only", RSL_ONLY_CSV, "--update-env"]);
      runPm2(["save"]);
      await verifyRslHealth();
      break;
    }

    case "stop": {
      for (const appName of RSL_PM2_APPS) {
        if (existingRslProcs.some((p) => p.name === appName)) {
          runPm2(["stop", appName]);
        }
      }
      runPm2(["save"]);
      break;
    }

    case "delete": {
      for (const appName of RSL_PM2_APPS) {
        if (existingRslProcs.some((p) => p.name === appName)) {
          runPm2(["delete", appName]);
        }
      }
      runPm2(["save"]);
      break;
    }

    case "status": {
      for (const p of existingRslProcs) {
        console.log(
          `  • ${String(p.name).padEnd(24)} | pid=${p.pid ?? "-"} | status=${p.pm2_env?.status ?? "unknown"} | restarts=${p.pm2_env?.restart_time ?? 0}`
        );
      }
      if (existingRslProcs.length === 0) {
        console.log("  (No RSL PM2 processes currently registered)");
      }
      await verifyRslHealth();
      break;
    }

    default:
      console.error(`Unknown action '${action}'. Use: start | restart | reload | stop | delete | cleanup | status`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("[rsl-pm2] Error:", err.message || err);
  process.exit(1);
});
