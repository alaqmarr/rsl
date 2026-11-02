import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

function loadMonorepoRootEnv(): void {
  const rootEnv = path.resolve(__dirname, "..", "..", ".env");
  if (!fs.existsSync(rootEnv)) return;
  const lines = fs.readFileSync(rootEnv, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) {
      process.env[k] = v;
    }
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
  serverExternalPackages: ["better-sqlite3", "pino", "pino-pretty", "nodemailer"],
  transpilePackages: [
    "@rsl/analytics",
    "@rsl/api-keys",
    "@rsl/auth",
    "@rsl/backup",
    "@rsl/billing",
    "@rsl/connections",
    "@rsl/core",
    "@rsl/database",
    "@rsl/docs",
    "@rsl/google",
    "@rsl/inbox",
    "@rsl/logging",
    "@rsl/meta",
    "@rsl/notifications",
    "@rsl/queue",
    "@rsl/rbac",
    "@rsl/storage",
    "@rsl/tally",
    "@rsl/tenancy",
    "@rsl/ui",
    "@rsl/whatsapp",
  ],
  env: {
    NEXT_PUBLIC_SENTRY_DSN_WEB:
      process.env.NEXT_PUBLIC_SENTRY_DSN_WEB || process.env.SENTRY_DSN_WEB || "",
    NEXT_PUBLIC_APP_RELEASE: process.env.RSL_RELEASE || "rsl-marketing@1.0.0",
  },
};

const shouldWrapSentry =
  process.env.NODE_ENV === "production" && Boolean(process.env.SENTRY_AUTH_TOKEN || process.env.SENTRY_DSN_WEB);

export default shouldWrapSentry
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG || "al-aqmar",
      project: "rsl-web",
      silent: !process.env.CI,
      widenClientFileUpload: true,
    })
  : nextConfig;
