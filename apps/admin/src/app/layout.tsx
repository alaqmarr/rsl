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
  metadataBase: new URL(process.env.ADMIN_URL || "https://admin.rapidshiftlabs.in"),
  title: "RSL Staff Portal — Billing, Plans & Client Operations",
  description:
    "Verify client payments, unlock plans, credit wallets, manage WhatsApp setups, and support customer accounts.",
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
    title: "RapidShift Labs — Staff Operations Portal",
    description: "Staff billing, client support, GST ledger, and platform health console.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "RapidShift Labs" }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-[#F8F9FB] font-sans text-slate-900 antialiased">
        <SileoToastProvider cookieName="rsl_admin_toast" />
        {children}
      </body>
    </html>
  );
}
