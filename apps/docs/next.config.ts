import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

function loadMonorepoRootEnv(): void {
  const rootEnv = path.resolve(__dirname, "..", "..", ".env");
  if (!fs.existsSync(rootEnv)) return;
  for (const raw of fs.readFileSync(rootEnv, "utf8").split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

loadMonorepoRootEnv();

const monorepoRoot = path.resolve(__dirname, "..", "..");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    root: monorepoRoot,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  serverExternalPackages: ["better-sqlite3", "pino", "pino-pretty"],
  transpilePackages: [
    "@rsl/billing",
    "@rsl/core",
    "@rsl/database",
    "@rsl/docs",
    "@rsl/logging",
    "@rsl/rbac",
    "@rsl/tenancy",
    "@rsl/ui",
  ],
  env: {
    NEXT_PUBLIC_SENTRY_DSN_DOCS:
      process.env.NEXT_PUBLIC_SENTRY_DSN_DOCS || process.env.SENTRY_DSN_DOCS || "",
  },
};

const shouldWrapSentry =
  process.env.NODE_ENV === "production" && Boolean(process.env.SENTRY_AUTH_TOKEN || process.env.SENTRY_DSN_DOCS);

export default shouldWrapSentry
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG || "al-aqmar",
      project: "rsl-docs",
      silent: !process.env.CI,
    })
  : nextConfig;
