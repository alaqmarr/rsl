import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Fraunces, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { getEnv } from "@rsl/core";
import { BrandLogo, PlatformFooter, ThemeToggleButton } from "@rsl/ui";
import { ActionLink } from "@/components/ios-feedback";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.DOCS_URL || "https://docs.rapidshiftlabs.in"),
  title: "RSL Marketing - Help Guides & API Reference",
  description:
    "Step-by-step setup guides for Tally Prime, WhatsApp bill alerts, backups, GST billing, and the REST API.",
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
    title: "RapidShift Labs - Help Guides & REST API Reference",
    description:
      "Plain-English setup guides for Tally Prime, WhatsApp Business Cloud API, Google Drive backups, and REST API v1.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "RapidShift Labs Guides" }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og-image.png"],
  },
};

const THEME_INIT_SCRIPT = `(function(){try{var d=document.documentElement,s=localStorage.getItem("rsl_theme"),t=s==="dark"||s==="light"?s:d.dataset.theme==="dark"||d.dataset.theme==="light"?d.dataset.theme:window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";d.dataset.theme=t;d.classList.toggle("dark",t==="dark");}catch(e){}})();`;

export default async function DocsRootLayout({ children }: { children: React.ReactNode }) {
  const appUrl = getEnv().APP_URL;
  const cookieStore = await cookies();
  const rawTheme = cookieStore.get("rsl_theme")?.value;
  const dataTheme = rawTheme === "dark" || rawTheme === "light" ? rawTheme : undefined;

  return (
    <html
      lang="en"
      data-theme={dataTheme}
      suppressHydrationWarning
      className={`${display.variable} ${sans.variable} ${mono.variable}${dataTheme === "dark" ? " dark" : ""}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="rsl-ambient-canvas flex min-h-screen w-full flex-col font-sans text-[var(--ink)] antialiased">
        <header className="rsl-frost-header sticky top-0 z-30">
          <div className="flex w-full items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-3.5 lg:px-8 xl:px-12">
            <div className="flex min-w-0 items-center gap-3 sm:gap-6">
              {/* Mobile Navigation Menu Drawer Trigger */}
              <details className="group relative md:hidden">
                <summary
                  aria-label="Open documentation navigation menu"
                  className="inline-flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-xl border border-zinc-200 bg-white text-slate-900 shadow-2xs select-none"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <line x1="4" y1="6" x2="20" y2="6" />
                    <line x1="4" y1="12" x2="20" y2="12" />
                    <line x1="4" y1="18" x2="20" y2="18" />
                  </svg>
                </summary>
                <div className="absolute left-0 mt-2 w-60 rounded-2xl border border-zinc-200 bg-white p-2 shadow-lg">
                  <nav aria-label="Mobile documentation navigation" className="space-y-1 text-[13px]">
                    <ActionLink
                      href="/"
                      className="block rounded-xl px-3 py-2 font-medium text-slate-800 hover:bg-zinc-50"
                    >
                      All Help Guides
                    </ActionLink>
                    <ActionLink
                      href="/api-reference"
                      className="block rounded-xl px-3 py-2 font-medium text-slate-800 hover:bg-zinc-50"
                    >
                      Developer API Reference
                    </ActionLink>
                    <ActionLink
                      href="/errors"
                      className="block rounded-xl px-3 py-2 font-medium text-slate-800 hover:bg-zinc-50"
                    >
                      Common Errors &amp; Fixes
                    </ActionLink>
                    <a
                      href={`${appUrl}/status`}
                      className="block rounded-xl px-3 py-2 font-medium text-emerald-700 hover:bg-emerald-50/70"
                    >
                      Account Status ↗
                    </a>
                  </nav>
                </div>
              </details>

              <ActionLink href="/" className="inline-flex min-w-0 items-center gap-3">
                <BrandLogo variant="long" size="sm" />
                <span className="hidden rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-xs font-semibold text-zinc-600 sm:inline-flex">
                  Help &amp; API
                </span>
              </ActionLink>

              <nav
                aria-label="Primary documentation navigation"
                className="hidden items-center gap-6 text-[13px] font-medium text-zinc-600 md:flex"
              >
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
              <ThemeToggleButton />
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

        <PlatformFooter
          suiteLabel="Help Guides & REST API v1"
          className="mt-16"
          links={[
            { label: "All Guides", href: "/" },
            { label: "Developer API", href: "/api-reference" },
            { label: "Common Errors & Fixes", href: "/errors" },
            { label: "Privacy Policy ↗", href: `${appUrl}/privacy`, external: true },
            { label: "Terms ↗", href: `${appUrl}/terms`, external: true },
            { label: "Compliance ↗", href: `${appUrl}/legal`, external: true },
            { label: "Open Dashboard ↗", href: appUrl, external: true },
          ]}
        />
      </body>
    </html>
  );
}
