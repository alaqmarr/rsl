import type { Metadata } from "next";
import { Bebas_Neue, Cinzel, Cookie, Geist_Mono } from "next/font/google";
import { SileoToastProvider } from "@rsl/ui";
import { DpdpConsentBanner } from "@/components/dpdp-consent-banner";
import { getWebLocale, readVerifiedWebFlashToast } from "@/lib/session";
import "sileo/styles.css";
import "./globals.css";

const display = Cinzel({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-cinzel",
  display: "swap",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-geist-mono",
  display: "swap",
});

const cursive = Cookie({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-cookie",
  display: "swap",
});

const bebas = Bebas_Neue({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-bebas-neue",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "https://app.rapidshiftlabs.in"),
  applicationName: "RapidShift Labs",
  title: {
    default: "RapidShift Labs - WhatsApp Business Automation & Tally Sync",
    template: "%s | RapidShift Labs",
  },
  description:
    "Unified customer messages, Tally Prime billing & reminders, WhatsApp broadcasts, ad analytics, and encrypted cloud backups.",
  keywords: [
    "WhatsApp Business Automation",
    "Tally Prime WhatsApp integration",
    "Overdue invoice reminder WhatsApp",
    "Shared WhatsApp team inbox",
    "WhatsApp Cloud API India",
    "RapidShift Labs",
  ],
  authors: [{ name: "RapidShift Labs", url: "https://rapidshiftlabs.in" }],
  creator: "RapidShift Labs",
  publisher: "RapidShift Labs",
  category: "Business Software",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/logo-nobg.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "RapidShift Labs",
    locale: "en_IN",
    title: "RapidShift Labs - Tally Prime Sync, WhatsApp Cloud & Growth Suite",
    description:
      "Automate Tally Prime GST invoice PDFs on WhatsApp, manage shared team inbox replies, and protect backups in 1 click.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "RapidShift Labs Suite" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "RapidShift Labs - Tally Prime Sync, WhatsApp Cloud & Growth Suite",
    description:
      "Automate Tally Prime GST invoice PDFs on WhatsApp, manage shared team inbox replies, and protect backups in 1 click.",
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

const LIGHT_MODE_SCRIPT = `(function(){try{var d=document.documentElement;d.dataset.theme="light";d.classList.remove("dark");localStorage.setItem("rsl_theme","light");}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, verifiedToast] = await Promise.all([
    getWebLocale(),
    readVerifiedWebFlashToast(),
  ]);

  return (
    <html
      lang={locale}
      data-theme="light"
      suppressHydrationWarning
      className={`${display.variable} ${mono.variable} ${cursive.variable} ${bebas.variable}`}
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Xmind:wght@400;500;600;700&display=swap"
        />
        <script dangerouslySetInnerHTML={{ __html: LIGHT_MODE_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-[var(--canvas)] font-sans text-[var(--ink)] antialiased">
        <SileoToastProvider cookieName="rsl_toast" verifiedToast={verifiedToast} />
        {children}
        <DpdpConsentBanner />
      </body>
    </html>
  );
}
