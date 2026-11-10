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
const allowedConnectOrigins = [
  "'self'",
  "https://api.razorpay.com",
  "https://lumberjack.razorpay.com",
  "https://checkout.razorpay.com",
  "https://challenges.cloudflare.com",
  "https://*.ingest.sentry.io",
  "https://*.ingest.us.sentry.io",
  "https://*.ingest.de.sentry.io",
  ...(isDev ? ["http:", "ws:", "wss:"] : []),
].join(" ");

const webCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://checkout.razorpay.com https://challenges.cloudflare.com`,
  `connect-src ${allowedConnectOrigins}`,
  "frame-src https://api.razorpay.com https://checkout.razorpay.com https://challenges.cloudflare.com",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  turbopack: {
    root: monorepoRoot,
  },
  async redirects() {
    return [
      { source: "/privacy-policy", destination: "/privacy", permanent: true },
      { source: "/terms-and-conditions", destination: "/terms", permanent: true },
      { source: "/terms-of-service", destination: "/terms", permanent: true },
      { source: "/cancellation-and-refund-policy", destination: "/refund-policy", permanent: true },
      { source: "/refunds", destination: "/refund-policy", permanent: true },
      { source: "/shipping-policy", destination: "/service-delivery", permanent: true },
      { source: "/shipping-and-delivery", destination: "/service-delivery", permanent: true },
      { source: "/cookie-policy", destination: "/cookies", permanent: true },
      { source: "/grievance", destination: "/data-deletion", permanent: true },
      { source: "/compliance", destination: "/legal", permanent: true },
    ];
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
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          { key: "Cross-Origin-Resource-Policy", value: "same-site" },
          { key: "Origin-Agent-Cluster", value: "?1" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: webCsp,
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
