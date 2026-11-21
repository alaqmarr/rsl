import type { Metadata } from "next";
import { Bebas_Neue, Cinzel, Geist_Mono } from "next/font/google";
import { SileoToastProvider } from "@rsl/ui";
import { readVerifiedAdminFlashToast } from "@/lib/session";
import "sileo/styles.css";
import "./globals.css";

const display = Cinzel({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-cinzel",
  display: "swap",
});

const bebas = Bebas_Neue({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-bebas-neue",
  display: "swap",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-geist-mono",
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

const LIGHT_MODE_SCRIPT = `(function(){try{var d=document.documentElement;d.dataset.theme="light";d.classList.remove("dark");localStorage.setItem("rsl_theme","light");}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const verifiedToast = await readVerifiedAdminFlashToast();

  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${display.variable} ${bebas.variable} ${mono.variable}`}
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
        <SileoToastProvider cookieName="rsl_admin_toast" verifiedToast={verifiedToast} />
        {children}
      </body>
    </html>
  );
}
