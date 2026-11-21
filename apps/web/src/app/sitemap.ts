import type { MetadataRoute } from "next";
import { getEnv } from "@rsl/core";
import { getAllLegalDocuments } from "@/lib/legal-documents";

export default function sitemap(): MetadataRoute.Sitemap {
  const env = getEnv();
  const appUrl = (env.APP_URL || "https://app.rapidshiftlabs.in").replace(/\/+$/, "");
  const now = new Date();
  const legalDocs = getAllLegalDocuments();

  return [
    {
      url: `${appUrl}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${appUrl}/pricing`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.95,
    },
    {
      url: `${appUrl}/register`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${appUrl}/legal`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.85,
    },
    ...legalDocs.map((doc) => ({
      url: `${appUrl}${doc.path}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.75,
    })),
    {
      url: `${appUrl}/login`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];
}
