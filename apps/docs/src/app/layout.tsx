import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { BrandLogo } from "@rsl/ui";
import { ActionLink } from "@/components/ios-feedback";
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
  title: "RSL Marketing — Help Guides & API Reference",
  description:
    "Step-by-step setup guides for Tally Prime, WhatsApp bill alerts, backups, GST billing, and the REST API.",
  icons: {
    icon: [
      { url: "/logo-nobg.svg", type: "image/svg+xml" },
      { url: "/logo-nobg.png", type: "image/png" },
    ],
    shortcut: "/logo-nobg.png",
    apple: "/logo.png",
  },
};

export default function DocsRootLayout({ children }: { children: React.ReactNode }) {
  const appUrl = process.env.APP_URL || "http://localhost:4500";
  const year = new Date().getFullYear();

  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="flex min-h-screen w-full flex-col bg-[#F8F9FB] font-sans text-slate-900 antialiased">
        <header className="sticky top-0 z-30 border-b border-zinc-200/90 bg-white/95 backdrop-blur-md">
          <div className="flex w-full items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-3.5 lg:px-8 xl:px-12">
            <div className="flex min-w-0 items-center gap-5 sm:gap-6">
              <ActionLink href="/" className="inline-flex min-w-0 items-center gap-3">
                <BrandLogo variant="long" size="sm" />
                <span className="hidden rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-[11px] font-semibold text-zinc-600 sm:inline-flex">
                  Help &amp; API
                </span>
              </ActionLink>
              <nav className="hidden items-center gap-6 text-[13px] font-medium text-zinc-600 md:flex">
                <ActionLink href="/" className="transition hover:text-emerald-600">
                  All Guides
                </ActionLink>
                <ActionLink href="/api-reference" className="transition hover:text-emerald-600">
                  Developer API
                </ActionLink>
                <ActionLink href="/errors" className="transition hover:text-emerald-600">
                  Common Errors &amp; Fixes
                </ActionLink>
              </nav>
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              <a href={`${appUrl}/status`} className="rsl-btn-secondary hidden sm:inline-flex">
                Account Status
              </a>
              <a href={appUrl} className="rsl-btn-primary">
                Open Dashboard →
              </a>
            </div>
          </div>
        </header>

        <main className="w-full flex-1 px-4 py-8 sm:px-6 lg:px-8 xl:px-12">{children}</main>

        <footer className="mt-16 border-t border-zinc-200/90 bg-white py-6">
          <div className="flex w-full flex-col justify-between gap-4 px-4 text-[13px] text-zinc-500 sm:flex-row sm:items-center sm:px-6 lg:px-8 xl:px-12">
            <div className="flex flex-wrap items-center gap-3">
              <BrandLogo variant="long" size="xs" />
              <span className="hidden text-zinc-300 sm:inline">•</span>
              <p className="text-xs sm:text-[13px]">
                © {year} RapidShift Labs — Built for Indian businesses running Tally Prime,
                WhatsApp, Meta &amp; Google.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-5 text-xs font-medium text-zinc-600 sm:text-[13px]">
              <ActionLink href="/" className="hover:text-slate-900">
                All Guides
              </ActionLink>
              <ActionLink href="/api-reference" className="hover:text-slate-900">
                Developer API
              </ActionLink>
              <ActionLink href="/errors" className="hover:text-slate-900">
                Common Errors &amp; Fixes
              </ActionLink>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
