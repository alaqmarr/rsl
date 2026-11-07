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

const isDev = process.env.NODE_ENV !== "production";
const adminCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self' https:",
  "object-src 'none'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com`,
  `connect-src 'self' https:${isDev ? " http: ws: wss:" : ""}`,
  "frame-src 'self' https://challenges.cloudflare.com",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    root: monorepoRoot,
  },
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/brand/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          ...(!isDev
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]
            : []),
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: adminCsp,
          },
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
    "@rsl/auth",
    "@rsl/billing",
    "@rsl/core",
    "@rsl/database",
    "@rsl/logging",
    "@rsl/notifications",
    "@rsl/queue",
    "@rsl/tenancy",
    "@rsl/ui",
    "@rsl/whatsapp",
    "@rsl/tally",
  ],
  env: {
    NEXT_PUBLIC_SENTRY_DSN_ADMIN:
      process.env.NEXT_PUBLIC_SENTRY_DSN_ADMIN || process.env.SENTRY_DSN_ADMIN || "",
  },
};

const shouldWrapSentry =
  process.env.NODE_ENV === "production" && Boolean(process.env.SENTRY_AUTH_TOKEN || process.env.SENTRY_DSN_ADMIN);

export default shouldWrapSentry
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG || "al-aqmar",
      project: "rsl-admin",
      silent: !process.env.CI,
    })
  : nextConfig;
