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
  title: "RSL Staff Portal — Billing, Plans & Client Operations",
  description:
    "Verify client payments, unlock plans, credit wallets, manage WhatsApp setups, and support customer accounts.",
  icons: {
    icon: [
      { url: "/logo-nobg.svg", type: "image/svg+xml" },
      { url: "/logo-nobg.png", type: "image/png" },
    ],
    shortcut: "/logo-nobg.png",
    apple: "/logo.png",
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
