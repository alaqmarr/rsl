import type { MetadataRoute } from "next";
import { getEnv } from "@rsl/core";

export default function robots(): MetadataRoute.Robots {
  const env = getEnv();
  const appUrl = (env.APP_URL || "https://app.rapidshiftlabs.in").replace(/\/+$/, "");

  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          "/legal",
          "/privacy",
          "/terms",
          "/payment-terms",
          "/refund-policy",
          "/service-delivery",
          "/acceptable-use",
          "/cookies",
          "/data-deletion",
          "/dpa",
          "/login",
          "/register",
        ],
        disallow: ["/api/", "/accept-invite", "/reset-password"],
      },
    ],
    sitemap: `${appUrl}/sitemap.xml`,
  };
}
