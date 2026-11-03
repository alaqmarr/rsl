#!/usr/bin/env node
/**
 * Pre-compiles RSL background services (`apps/worker` and `infra/pm2/rsl-cleanup-service.ts`)
 * into standalone Node 22 CommonJS bundles (`apps/worker/dist/worker.cjs` and `apps/worker/dist/cleanup.cjs`).
 *
 * Why pre-compiled CommonJS (.cjs)?
 * 1. Eliminates runtime `tsx` / `devDependencies` reliance in production PM2.
 * 2. Eliminates `.mjs` ESM loader issues across PM2 fork containers and Node 22.x minor versions.
 * 3. Eliminates child wrapper processes so SIGINT/SIGTERM and `process.send("ready")` reach Node directly.
 * 4. Cuts worker & cleanup cold-start time from ~6-15s down to <150ms.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const PNPM_VIRTUAL_NODE_MODULES = path.join(REPO_ROOT, "node_modules", ".pnpm", "node_modules");
const WORKER_NODE_MODULES = path.join(REPO_ROOT, "apps", "worker", "node_modules");

const requireFromStore = createRequire(
  fs.existsSync(path.join(PNPM_VIRTUAL_NODE_MODULES, "esbuild", "package.json"))
    ? path.join(PNPM_VIRTUAL_NODE_MODULES, "esbuild", "package.json")
    : path.join(REPO_ROOT, "package.json")
);

const esbuild = requireFromStore("esbuild");

const OUT_DIR = path.join(REPO_ROOT, "apps", "worker", "dist");
fs.mkdirSync(OUT_DIR, { recursive: true });

// Native C++ addons & CJS runtime packages present in node_modules/.pnpm/node_modules
const RUNTIME_EXTERNALS = [
  "better-sqlite3",
  "@sentry/node",
  "bullmq",
  "ioredis",
  "pino",
  "@aws-sdk/client-s3",
  "nodemailer",
];

/**
 * Resolves `@rsl/<pkg>` directly from `packages/<pkg>/src/index.ts` and falls back to
 * `apps/worker/node_modules` for peer-dependent packages like `drizzle-orm` when compiling
 * entrypoints outside `apps/worker` (such as `infra/pm2/rsl-cleanup-service.ts`).
 */
const workspaceResolverPlugin = {
  name: "rsl-workspace-resolver",
  setup(build) {
    build.onResolve({ filter: /^@rsl\// }, (args) => {
      const sub = args.path.slice("@rsl/".length);
      const pkgName = sub.split("/")[0];
      const rest = sub.slice(pkgName.length);
      const pkgDir = path.join(REPO_ROOT, "packages", pkgName);
      if (!rest) {
        const entryTs = path.join(pkgDir, "src", "index.ts");
        if (fs.existsSync(entryTs)) {
          return { path: entryTs };
        }
      } else {
        const subTs = path.join(pkgDir, "src", `${rest.replace(/^\//, "")}.ts`);
        if (fs.existsSync(subTs)) {
          return { path: subTs };
        }
      }
      return null;
    });
  },
};

const CJS_BOOTSTRAP_BANNER = `// Auto-generated RSL production CommonJS runtime bundle
(() => {
  const path = require("node:path");
  const Module = require("node:module");
  const repoRoot = process.env.RSL_APP_DIR || path.resolve(__dirname, "..", "..", "..");
  const extraPaths = [
    path.join(repoRoot, "apps", "worker", "node_modules"),
    path.join(repoRoot, "node_modules", ".pnpm", "node_modules"),
    path.join(repoRoot, "node_modules"),
  ];
  const sep = process.platform === "win32" ? ";" : ":";
  const existing = (process.env.NODE_PATH || "").split(sep).filter(Boolean);
  process.env.NODE_PATH = Array.from(new Set([...extraPaths, ...existing])).join(sep);
  Module._initPaths();
})();
`;

async function buildServiceBundle(entryRel, outFileName) {
  const entryPoint = path.join(REPO_ROOT, entryRel);
  const outfile = path.join(OUT_DIR, outFileName);

  await esbuild.build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    sourcemap: true,
    legalComments: "none",
    logLevel: "warning",
    external: RUNTIME_EXTERNALS,
    nodePaths: [WORKER_NODE_MODULES, PNPM_VIRTUAL_NODE_MODULES],
    plugins: [workspaceResolverPlugin],
    banner: {
      js: CJS_BOOTSTRAP_BANNER,
    },
  });

  const sizeKb = (fs.statSync(outfile).size / 1024).toFixed(1);
  console.log(`[build-runtime] Built apps/worker/dist/${outFileName} (${sizeKb} KB)`);
}

await buildServiceBundle("apps/worker/src/index.ts", "worker.cjs");
await buildServiceBundle("infra/pm2/rsl-cleanup-service.ts", "cleanup.cjs");
