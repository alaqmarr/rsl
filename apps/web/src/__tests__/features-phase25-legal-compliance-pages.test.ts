import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canPermissionsAccessWebRoute } from "@rsl/rbac";
import {
  getAllLegalDocuments,
  getLegalDocumentBySlug,
  getLegalEntityContext,
  type LegalDocSlug,
} from "../lib/legal-documents";
import robots from "../app/robots";
import sitemap from "../app/sitemap";

const EXPECTED_SLUGS: LegalDocSlug[] = [
  "privacy",
  "terms",
  "payment-terms",
  "refund-policy",
  "service-delivery",
  "acceptable-use",
  "cookies",
  "data-deletion",
  "dpa",
];

describe("Sprint 9 — Public Legal, Privacy, GST Payment, Refund & Compliance Pages", () => {
  it("resolves live entity context from billing settings and generates all 9 legal documents", () => {
    const entity = getLegalEntityContext();
    expect(entity.legalName.length).toBeGreaterThan(2);
    expect(entity.gstin).toMatch(/^[0-9]{2}[A-Z0-9]{13}$/);
    expect(entity.billingEmail).toContain("@");
    expect(entity.privacyEmail).toContain("@");

    const docs = getAllLegalDocuments(entity);
    expect(docs.map((d) => d.slug)).toEqual(EXPECTED_SLUGS);

    for (const slug of EXPECTED_SLUGS) {
      const resolved = getLegalDocumentBySlug(slug);
      expect(resolved.doc.slug).toBe(slug);
      expect(resolved.doc.path).toBe(`/${slug}`);
      expect(resolved.doc.plainSummary.length).toBeGreaterThanOrEqual(2);
      expect(resolved.doc.sections.length).toBeGreaterThanOrEqual(2);

      const pageFile = path.resolve(
        __dirname,
        "..",
        "app",
        "(legal)",
        slug,
        "page.tsx"
      );
      expect(fs.existsSync(pageFile)).toBe(true);
    }

    const hubPageFile = path.resolve(
      __dirname,
      "..",
      "app",
      "(legal)",
      "legal",
      "page.tsx"
    );
    expect(fs.existsSync(hubPageFile)).toBe(true);
  });

  it("includes statutory Indian GST, Google OAuth Limited Use, Razorpay refund/delivery, and Meta deletion disclosures", () => {
    const privacyText = JSON.stringify(getLegalDocumentBySlug("privacy").doc);
    expect(privacyText).toContain("Digital Personal Data Protection Act");
    expect(privacyText).toContain("Google API Services User Data Policy");
    expect(privacyText).toContain("Limited Use");
    expect(privacyText).toContain("AES-256-GCM");

    const paymentText = JSON.stringify(getLegalDocumentBySlug("payment-terms").doc);
    expect(paymentText).toContain("998314");
    expect(paymentText).toContain("18%");
    expect(paymentText).toContain("-₹200");
    expect(paymentText).toContain("Advance Receipt");

    const refundText = JSON.stringify(getLegalDocumentBySlug("refund-policy").doc);
    expect(refundText).toContain("7-Day");
    expect(refundText).toContain("Section 34");
    expect(refundText).toMatch(/5[–-]7 business days/i);

    const deliveryText = JSON.stringify(getLegalDocumentBySlug("service-delivery").doc);
    expect(deliveryText).toMatch(/no physical shipping/i);

    const deletionText = JSON.stringify(getLegalDocumentBySlug("data-deletion").doc);
    expect(deletionText).toContain("Grievance");
    expect(deletionText).toContain("STOP");

    const cookieText = JSON.stringify(getLegalDocumentBySlug("cookies").doc);
    expect(cookieText).toContain("rsl_session");
    expect(cookieText).toContain("HttpOnly");
  });

  it("registers all 10 legal routes in WEB_ROUTE_ACCESS_RULES while keeping unmapped routes fail-closed", () => {
    const emptyPerms = new Set<string>();
    const publicLegalRoutes = ["/legal", ...EXPECTED_SLUGS.map((s) => `/${s}`)];

    for (const route of publicLegalRoutes) {
      expect(canPermissionsAccessWebRoute(emptyPerms, route)).toBe(true);
    }

    expect(canPermissionsAccessWebRoute(emptyPerms, "/unmapped-shadow-route")).toBe(false);
  });

  it("exposes all compliance URLs in sitemap.xml and robots.txt", () => {
    const sitemapEntries = sitemap();
    const urls = sitemapEntries.map((entry) => entry.url);
    expect(urls.some((u) => u.endsWith("/legal"))).toBe(true);
    for (const slug of EXPECTED_SLUGS) {
      expect(urls.some((u) => u.endsWith(`/${slug}`))).toBe(true);
    }

    const robotsSpec = robots();
    const rule = Array.isArray(robotsSpec.rules) ? robotsSpec.rules[0] : robotsSpec.rules;
    expect(rule?.allow).toContain("/privacy");
    expect(rule?.allow).toContain("/terms");
    expect(rule?.allow).toContain("/payment-terms");
    expect(rule?.allow).toContain("/refund-policy");
    expect(robotsSpec.sitemap).toContain("/sitemap.xml");
  });
});
