import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Fraunces, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { SileoToastProvider } from "@rsl/ui";
import { readVerifiedAdminFlashToast } from "@/lib/session";
import "sileo/styles.css";
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
  metadataBase: new URL(process.env.ADMIN_URL || "https://admin.rapidshiftlabs.in"),
  title: "RSL Staff Portal - Billing, Plans & Client Operations",
  description:
    "Verify client payments, unlock plans, credit wallets, manage WhatsApp setups, and support customer accounts.",
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
    title: "RapidShift Labs - Staff Operations Portal",
    description: "Staff billing, client support, GST ledger, and platform health console.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "RapidShift Labs" }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og-image.png"],
  },
};

const THEME_INIT_SCRIPT = `(function(){try{var d=document.documentElement,s=localStorage.getItem("rsl_theme"),t=s==="dark"||s==="light"?s:d.dataset.theme==="dark"||d.dataset.theme==="light"?d.dataset.theme:window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";d.dataset.theme=t;d.classList.toggle("dark",t==="dark");}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [verifiedToast, cookieStore] = await Promise.all([
    readVerifiedAdminFlashToast(),
    cookies(),
  ]);
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
      <body className="min-h-screen bg-[var(--canvas)] font-sans text-[var(--ink)] antialiased">
        <SileoToastProvider cookieName="rsl_admin_toast" verifiedToast={verifiedToast} />
        {children}
      </body>
    </html>
  );
}
