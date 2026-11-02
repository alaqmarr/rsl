// PM2 Ecosystem for RSL Marketing Platform (Local & Oracle Cloud Ubuntu 24.04 LTS)
// STRICT ISOLATION GUARANTEES:
// 1. ALL ports are strictly within 4500–4600 (4500, 4501, 4502, 4510, 4511, 4512, 4520).
// 2. Every process is isolated in namespace "rsl-marketing" with explicit rsl-* names
//    and isolated logs under LOG_DIR/pm2 so other PM2 apps on the server are NEVER touched.
// 3. Automatically loads root .env (/opt/rslmarketing/.env) into all 7 RSL services.

const path = require("node:path");
const fs = require("node:fs");

const REPO_ROOT = process.env.RSL_APP_DIR || path.resolve(__dirname, "..", "..");

function parseRootDotEnv(envFilePath) {
  const parsed = {};
  if (!fs.existsSync(envFilePath)) return parsed;
  const content = fs.readFileSync(envFilePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    parsed[key] = val;
  }
  return parsed;
}

const fileEnv = parseRootDotEnv(path.join(REPO_ROOT, ".env"));
const effectiveLogDir = process.env.LOG_DIR || fileEnv.LOG_DIR;
const LOG_ROOT = effectiveLogDir
  ? path.resolve(REPO_ROOT, effectiveLogDir)
  : path.join(REPO_ROOT, ".rsl-logs");
const PM2_LOG_DIR = path.join(LOG_ROOT, "pm2");

fs.mkdirSync(PM2_LOG_DIR, { recursive: true });

const sharedEnv = {
  ...fileEnv,
  NODE_ENV: "production",
  PRIMARY_DOMAIN: process.env.PRIMARY_DOMAIN || fileEnv.PRIMARY_DOMAIN || "rapidshiftlabs.in",
  APP_URL: process.env.APP_URL || fileEnv.APP_URL || "https://app.rapidshiftlabs.in",
  ADMIN_URL: process.env.ADMIN_URL || fileEnv.ADMIN_URL || "https://admin.rapidshiftlabs.in",
  DOCS_URL: process.env.DOCS_URL || fileEnv.DOCS_URL || "https://docs.rapidshiftlabs.in",
  SETUP_URL: process.env.SETUP_URL || fileEnv.SETUP_URL || "https://setup.rapidshiftlabs.in",
};

function sharedPm2Fields(name, maxMemory) {
  return {
    name,
    namespace: "rsl-marketing",
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    max_restarts: 15,
    min_uptime: "10s",
    exp_backoff_restart_delay: 250,
    kill_timeout: 8000,
    listen_timeout: 15000,
    max_memory_restart: maxMemory,
    out_file: path.join(PM2_LOG_DIR, `${name}.out.log`),
    error_file: path.join(PM2_LOG_DIR, `${name}.err.log`),
    pid_file: path.join(PM2_LOG_DIR, `${name}.pid`),
    merge_logs: true,
    time: true,
  };
}

module.exports = {
  apps: [
    {
      ...sharedPm2Fields("rsl-web", "900M"),
      cwd: path.join(REPO_ROOT, "apps", "web"),
      script: "node_modules/next/dist/bin/next",
      args: "start --port 4500",
      env: {
        ...sharedEnv,
        PORT: 4500,
      },
    },
    {
      ...sharedPm2Fields("rsl-admin", "512M"),
      cwd: path.join(REPO_ROOT, "apps", "admin"),
      script: "node_modules/next/dist/bin/next",
      args: "start --port 4501",
      env: {
        ...sharedEnv,
        PORT: 4501,
      },
    },
    {
      ...sharedPm2Fields("rsl-docs", "384M"),
      cwd: path.join(REPO_ROOT, "apps", "docs"),
      script: "node_modules/next/dist/bin/next",
      args: "start --port 4502",
      env: {
        ...sharedEnv,
        PORT: 4502,
      },
    },
    {
      ...sharedPm2Fields("rsl-worker-realtime", "512M"),
      cwd: path.join(REPO_ROOT, "apps", "worker"),
      script: "pnpm",
      args: "start:realtime",
      env: {
        ...sharedEnv,
        WORKER_HEALTH_PORT: 4510,
      },
    },
    {
      ...sharedPm2Fields("rsl-worker-bulk", "512M"),
      cwd: path.join(REPO_ROOT, "apps", "worker"),
      script: "pnpm",
      args: "start:bulk",
      env: {
        ...sharedEnv,
        WORKER_HEALTH_PORT: 4511,
      },
    },
    {
      ...sharedPm2Fields("rsl-worker-maintenance", "384M"),
      cwd: path.join(REPO_ROOT, "apps", "worker"),
      script: "pnpm",
      args: "start:maintenance",
      env: {
        ...sharedEnv,
        WORKER_HEALTH_PORT: 4512,
      },
    },
    {
      ...sharedPm2Fields("rsl-cleanup", "256M"),
      cwd: REPO_ROOT,
      script: "pnpm",
      args: "exec tsx infra/pm2/rsl-cleanup-service.ts",
      env: {
        ...sharedEnv,
        CLEANUP_SERVICE_PORT: 4520,
      },
    },
  ],
};
