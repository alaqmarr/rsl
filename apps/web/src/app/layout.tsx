import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { SileoToastProvider } from "@rsl/ui";
import "sileo/styles.css";
import "./globals.css";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "https://app.rapidshiftlabs.in"),
  title: "RSL Marketing — Business Growth, Tally Sync & Customer Messages",
  description:
    "Unified customer messages, Tally Prime billing & reminders, WhatsApp broadcasts, ad analytics, and encrypted cloud backups.",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/logo-nobg.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "RapidShift Labs — Tally Prime Sync, WhatsApp Cloud & Growth Suite",
    description:
      "Automate Tally Prime GST invoice PDFs on WhatsApp, manage shared team inbox replies, and protect backups in 1 click.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "RapidShift Labs Suite" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "RapidShift Labs — Tally Prime Sync, WhatsApp Cloud & Growth Suite",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-[#F8F9FB] font-sans text-slate-900 antialiased">
        <SileoToastProvider cookieName="rsl_toast" />
        {children}
      </body>
    </html>
  );
}
