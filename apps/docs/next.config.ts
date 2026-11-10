import path from "node:path";
import { createRequire } from "node:module";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const monorepoRoot = path.resolve(__dirname, "..", "..");
const requireCjs = createRequire(path.join(monorepoRoot, "package.json"));
const { loadMonorepoRootEnv } = requireCjs(
  path.join(monorepoRoot, "scripts", "load-root-env.cjs")
) as {
  loadMonorepoRootEnv: (opts?: { rootDir?: string }) => Record<string, string>;
};

loadMonorepoRootEnv({ rootDir: monorepoRoot });

const isDev = process.env.NODE_ENV !== "production";
const docsConnectOrigins = [
  "'self'",
  "https://*.ingest.sentry.io",
  "https://*.ingest.us.sentry.io",
  "https://*.ingest.de.sentry.io",
  ...(isDev ? ["http:", "ws:", "wss:"] : []),
].join(" ");

const docsCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  `connect-src ${docsConnectOrigins}`,
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  turbopack: {
    root: monorepoRoot,
  },
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: isDev ? "no-store, must-revalidate" : "public, max-age=31536000, immutable",
          },
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
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-site" },
          { key: "Origin-Agent-Cluster", value: "?1" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: docsCsp,
          },
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
