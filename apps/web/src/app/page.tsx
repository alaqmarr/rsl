import type { Metadata } from "next";
import { listPublicPricingCatalog } from "@rsl/billing";
import { getEnv } from "@rsl/core";
import { PublicLandingPage } from "@/components/public-landing-page";
import { getOptionalWebSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    absolute: "RapidShift Labs - Your brand. Your customers. Your WhatsApp.",
  },
  description:
    "A customer-first WhatsApp Business, Tally invoice sharing, one-click overdue payment reminder, and 5-user shared inbox platform built around your own business identity.",
  keywords: [
    "WhatsApp Business Automation",
    "Tally Prime WhatsApp invoice sharing",
    "Overdue invoice reminder WhatsApp",
    "Shared 5 user WhatsApp inbox",
    "Official Meta Cloud API India",
    "RapidShift Labs",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "RapidShift Labs",
    locale: "en_IN",
    title: "RapidShift Labs - Your brand. Your customers. Your WhatsApp.",
    description:
      "Use your own approved WhatsApp business profile, Tally invoice workflow, overdue reminders, and 5-user team inbox starting at ₹4,999/month.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "RapidShift Labs - WhatsApp Business Automation & Tally Sync",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "RapidShift Labs - Your brand. Your customers. Your WhatsApp.",
    description:
      "Customer-first WhatsApp Business automation, Tally Prime invoicing, and shared 5-user inbox.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

function buildHomepageJsonLd(appUrl: string, docsUrl: string) {
  const baseUrl = appUrl.replace(/\/+$/, "");
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${baseUrl}/#organization`,
        name: "RapidShift Labs",
        url: baseUrl,
        logo: `${baseUrl}/icon-512.png`,
        email: "app@rapidshiftlabs.in",
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "sales",
          email: "app@rapidshiftlabs.in",
          areaServed: "IN",
          availableLanguage: ["English", "Hindi"],
        },
        sameAs: [docsUrl],
      },
      {
        "@type": "WebSite",
        "@id": `${baseUrl}/#website`,
        url: baseUrl,
        name: "RapidShift Labs",
        publisher: {
          "@id": `${baseUrl}/#organization`,
        },
        inLanguage: "en-IN",
      },
      {
        "@type": "SoftwareApplication",
        name: "RapidShift Labs WhatsApp Business & Tally Suite",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web, Windows",
        url: baseUrl,
        provider: {
          "@id": `${baseUrl}/#organization`,
        },
        featureList: [
          "Shared 5-user WhatsApp team inbox",
          "Tally Prime + WhatsApp invoice workflow",
          "One-click overdue invoice payment reminders",
          "Complete Meta Cloud API & profile onboarding",
        ],
        offers: {
          "@type": "Offer",
          price: "4999",
          priceCurrency: "INR",
          availability: "https://schema.org/InStock",
          url: `${baseUrl}/pricing`,
        },
      },
    ],
  };
}

/**
 * Root Server Page (`/`).
 * Public visitors render the SSR `<PublicLandingPage />` directly with JSON-LD SEO markup.
 * Signed-in workspace users dynamically receive the authenticated workspace overview.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getOptionalWebSession();
  if (!session) {
    const env = getEnv();
    const appUrl = env.APP_URL || "https://app.rapidshiftlabs.in";
    const catalog = listPublicPricingCatalog();
    const jsonLd = buildHomepageJsonLd(appUrl, env.DOCS_URL);

    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <PublicLandingPage
          bundles={catalog.bundles}
          services={catalog.services}
          docsBaseUrl={env.DOCS_URL}
        />
      </>
    );
  }

  const [{ default: DashboardLayout }, { default: BusinessOverviewPage }] = await Promise.all([
    import("./(dashboard)/layout"),
    import("./(dashboard)/_overview"),
  ]);

  return (
    <DashboardLayout>
      <BusinessOverviewPage searchParams={searchParams} />
    </DashboardLayout>
  );
}
