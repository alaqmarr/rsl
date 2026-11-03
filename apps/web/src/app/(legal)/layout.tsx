import React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getEnv } from "@rsl/core";
import { BrandLogo, PlatformFooter } from "@rsl/ui";
import { getOptionalWebSession } from "@/lib/session";

export default async function LegalPublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getOptionalWebSession();
  const docsUrl = getEnv().DOCS_URL;

  return (
    <div className="flex min-h-screen flex-col bg-[#F8F9FB] text-slate-900">
      <header className="no-print sticky top-0 z-30 border-b border-zinc-200/85 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <Link href="/" className="min-w-0 shrink-0">
              <BrandLogo variant="long" size="sm" subtitle="Marketing & Tally Prime Suite" />
            </Link>
            <Link
              href="/legal"
              className="hidden rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11.5px] font-semibold text-zinc-700 transition hover:border-emerald-300 hover:text-emerald-800 sm:inline-flex"
            >
              Legal &amp; Compliance
            </Link>
          </div>

          <nav
            aria-label="Quick legal navigation"
            className="hidden items-center gap-5 text-[12.5px] font-medium text-zinc-600 lg:flex"
          >
            <Link href="/privacy" className="transition hover:text-slate-900">
              Privacy
            </Link>
            <Link href="/terms" className="transition hover:text-slate-900">
              Terms
            </Link>
            <Link href="/payment-terms" className="transition hover:text-slate-900">
              Payment &amp; GST
            </Link>
            <Link href="/refund-policy" className="transition hover:text-slate-900">
              Refunds
            </Link>
            <Link href="/data-deletion" className="transition hover:text-slate-900">
              Data Deletion
            </Link>
          </nav>

          <div className="flex shrink-0 items-center gap-2.5">
            {session ? (
              <Link
                href="/"
                className="rsl-btn-primary inline-flex min-h-9 items-center gap-1.5 px-4 py-2 text-xs font-semibold"
              >
                <span>← Back to Workspace</span>
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="rsl-btn-secondary min-h-9 px-3.5 py-1.5 text-xs font-semibold"
                >
                  Sign In
                </Link>
                <Link
                  href="/register"
                  className="rsl-btn-primary inline-flex min-h-9 items-center gap-1 px-3.5 py-1.5 text-xs font-semibold"
                >
                  <span>Start Free Trial</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <PlatformFooter
        suiteLabel="RapidShift Labs Marketing & Tally Suite"
        links={[
          { label: "Compliance Hub", href: "/legal" },
          { label: "Privacy Policy", href: "/privacy" },
          { label: "Terms & Conditions", href: "/terms" },
          { label: "Payment & GST Terms", href: "/payment-terms" },
          { label: "Refund Policy", href: "/refund-policy" },
          { label: "Service Delivery", href: "/service-delivery" },
          { label: "Acceptable Use", href: "/acceptable-use" },
          { label: "Cookie Policy", href: "/cookies" },
          { label: "Data Deletion", href: "/data-deletion" },
          { label: "DPA & Security", href: "/dpa" },
          { label: "Help Guides ↗", href: docsUrl, external: true },
        ]}
      />
    </div>
  );
}
