import { NextRequest, NextResponse } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isExternalApiPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/webhooks/") ||
    pathname.startsWith("/api/agent/") ||
    pathname.startsWith("/api/v1/") ||
    pathname === "/api/auth/impersonate"
  );
}

function isSameOriginMutation(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const expectedHost = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "")
    .split(",")[0]!
    .trim()
    .toLowerCase();

  if (origin) {
    try {
      const parsedOrigin = new URL(origin);
      return parsedOrigin.host.toLowerCase() === expectedHost;
    } catch {
      return false;
    }
  }

  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") {
    return false;
  }
  return true;
}

function buildWebCspHeader(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production";
  const connectSrc = [
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

  const scriptSrc = isDev
    ? `'self' 'nonce-${nonce}' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://challenges.cloudflare.com`
    : `'self' 'nonce-${nonce}' 'strict-dynamic' https://checkout.razorpay.com https://challenges.cloudflare.com`;

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "style-src 'self' 'unsafe-inline'",
    `script-src ${scriptSrc}`,
    `connect-src ${connectSrc}`,
    "frame-src https://api.razorpay.com https://checkout.razorpay.com https://challenges.cloudflare.com",
  ].join("; ");
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Enforce CSRF same-origin verification on cookie-authenticated API mutations
  if (
    pathname.startsWith("/api/") &&
    MUTATING_METHODS.has(req.method.toUpperCase()) &&
    !isExternalApiPath(pathname) &&
    !isSameOriginMutation(req)
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "RSL-AUTH-1001",
          message: "Cross-origin state-changing request rejected.",
        },
      },
      { status: 403 }
    );
  }

  const nonce = btoa(crypto.randomUUID());
  const csp = buildWebCspHeader(nonce);

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  response.headers.set("Cross-Origin-Resource-Policy", "same-site");
  response.headers.set("Origin-Agent-Cluster", "?1");

  const hasSessionCookie = Boolean(req.cookies.get("rsl_session")?.value);
  if (hasSessionCookie || pathname.startsWith("/api/")) {
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
  }

  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|brand/|favicon.ico|icon-192.png|apple-touch-icon.png|logo.png|logo-nobg.png|long-logo.png|long-logo-nobg.png|email-logo.png|og-image.png|site.webmanifest).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
