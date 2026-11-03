import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const requireCjs = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

describe("Phase 24 — Production PM2 CommonJS Worker & Cleanup Runtime Verification", () => {
  it("compiles worker.cjs and cleanup.cjs and boots all 4 background services cleanly under PM2 CJS fork semantics", async () => {
    const buildRes = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, "scripts", "build-runtime-services.mjs")],
      { cwd: REPO_ROOT, encoding: "utf8" }
    );
    expect(buildRes.status).toBe(0);

    const workerBundle = path.join(REPO_ROOT, "apps", "worker", "dist", "worker.cjs");
    const cleanupBundle = path.join(REPO_ROOT, "apps", "worker", "dist", "cleanup.cjs");
    expect(fs.existsSync(workerBundle)).toBe(true);
    expect(fs.existsSync(cleanupBundle)).toBe(true);

    const ecoPath = path.join(REPO_ROOT, "infra", "pm2", "ecosystem.config.cjs");
    delete requireCjs.cache[requireCjs.resolve(ecoPath)];
    const eco = requireCjs(ecoPath) as {
      apps: Array<{
        name: string;
        namespace: string;
        cwd: string;
        script: string;
        args?: string;
        interpreter: string;
        env: Record<string, string | number>;
      }>;
    };

    expect(eco.apps.map((a) => a.name)).toEqual([
      "rsl-web",
      "rsl-admin",
      "rsl-docs",
      "rsl-worker-realtime",
      "rsl-worker-bulk",
      "rsl-worker-maintenance",
      "rsl-cleanup",
    ]);

    for (const app of eco.apps) {
      expect(app.namespace).toBe("rsl-marketing");
      expect(app.script.endsWith(".mjs")).toBe(false);
      expect(app.script).not.toBe("pnpm");
      expect(fs.existsSync(app.script)).toBe(true);
    }

    const prodSecrets = {
      NODE_ENV: "production" as const,
      REDIS_URL: "",
      BETTER_AUTH_SECRET: "prod_test_better_auth_secret_32_chars_ok",
      ADMIN_AUTH_SECRET: "prod_test_admin_auth_secret_32_chars_ok!",
      KMS_MASTER_KEY: "prod_test_kms_master_secret_32_chars_ok!",
      BACKUP_SIGNING_KEY: "prod_test_backup_sign_secret_32_chars_ok",
      API_KEY_PEPPER: "prod_test_api_pepper_secret_32_chars_ok!",
    };

    const specs = [
      {
        name: "rsl-worker-realtime",
        cwd: path.join(REPO_ROOT, "apps", "worker"),
        script: workerBundle,
        args: ["--lane=realtime", "--health-port=4560"],
        port: 4560,
        lane: "realtime",
      },
      {
        name: "rsl-worker-bulk",
        cwd: path.join(REPO_ROOT, "apps", "worker"),
        script: workerBundle,
        args: ["--lane=bulk", "--health-port=4561"],
        port: 4561,
        lane: "bulk",
      },
      {
        name: "rsl-worker-maintenance",
        cwd: path.join(REPO_ROOT, "apps", "worker"),
        script: workerBundle,
        args: ["--lane=maintenance", "--health-port=4562"],
        port: 4562,
        lane: "maintenance",
      },
      {
        name: "rsl-cleanup",
        cwd: REPO_ROOT,
        script: cleanupBundle,
        args: [],
        port: 4563,
        lane: null,
      },
    ];

    const children: ChildProcess[] = [];
    try {
      for (const s of specs) {
        const forkHarness = `
          process.argv = [process.execPath, ${JSON.stringify(s.script)}, ...${JSON.stringify(s.args)}];
          require("node:module")._load(${JSON.stringify(s.script)}, null, true);
        `;
        const child = spawn(process.execPath, ["-e", forkHarness], {
          cwd: s.cwd,
          env: {
            ...process.env,
            ...prodSecrets,
            RSL_APP_DIR: REPO_ROOT,
            WORKER_HEALTH_PORT: String(s.port),
            CLEANUP_SERVICE_PORT: String(s.port),
          },
          stdio: "ignore",
        });
        children.push(child);
      }

      for (const s of specs) {
        let healthy = false;
        let payload: Record<string, unknown> = {};
        for (let attempt = 1; attempt <= 40; attempt++) {
          try {
            const res = await fetch(`http://127.0.0.1:${s.port}/health`, {
              headers: { "x-rsl-internal-secret": prodSecrets.ADMIN_AUTH_SECRET },
              signal: AbortSignal.timeout(1500),
            });
            if (res.ok) {
              payload = (await res.json()) as Record<string, unknown>;
              healthy = Boolean(payload.ok);
              break;
            }
          } catch {
            // Wait for background process listen
          }
          await new Promise((r) => setTimeout(r, 400));
        }

        expect(healthy).toBe(true);
        if (s.lane) {
          expect(payload.lanes).toEqual([s.lane]);
        } else {
          expect(payload.service).toBe("rsl-cleanup");
        }

        // Also verify unauthenticated loopback probe (used by ops:verify & pm2-manager) returns HTTP 200
        const publicProbe = await fetch(`http://127.0.0.1:${s.port}/health`, {
          signal: AbortSignal.timeout(1500),
        });
        expect(publicProbe.status).toBe(200);
      }
    } finally {
      for (const c of children) {
        c.kill("SIGTERM");
      }
    }
  }, 45_000);
});
