import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, ShieldCheck, Wallet } from "lucide-react";
import { listPublicPricingCatalog, WALLET_OVERDRAFT_LIMIT_PAISE } from "@rsl/billing";
import { formatInr } from "@rsl/core";
import { BrandLogo, PlatformFooter, ThemeToggleButton } from "@rsl/ui";
import { getOptionalWebSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing & Modular GST Plans - RapidShift Labs",
  description:
    "Transparent INR plans for Tally Prime sync, WhatsApp Cloud API billing & reminders, shared team inbox, ad analytics, and encrypted backups - plus a prepaid wallet with -₹200 overdraft buffer.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Pricing & Modular GST Plans - RapidShift Labs",
    description:
      "Monthly, quarterly, and annual INR plans with 18% GST tax invoices and zero hidden platform markups.",
    url: "/pricing",
  },
};

export default async function PublicPricingPage() {
  const [catalog, session] = await Promise.all([
    Promise.resolve(listPublicPricingCatalog()),
    getOptionalWebSession(),
  ]);

  const primaryCtaHref = session ? "/billing" : "/register";
  const primaryCtaLabel = session ? "Manage Workspace Plans" : "Start 7-Day Free Trial";

  return (
    <div className="rsl-ambient-canvas flex min-h-screen flex-col text-slate-900">
      <header className="rsl-frost-header sticky top-0 z-30">
        <div className="flex w-full items-center justify-between gap-4 px-5 py-3.5 sm:px-8 lg:px-12 xl:px-16">
          <Link href="/" className="flex items-center gap-2">
            <BrandLogo variant="long" size="sm" subtitle="Growth & Tally Suite" />
          </Link>
          <nav aria-label="Public navigation" className="flex items-center gap-3 text-xs font-semibold">
            <ThemeToggleButton compact />
            <Link
              href="/"
              className="rounded-lg px-2.5 py-1.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            >
              Overview
            </Link>
            {session ? (
              <Link href="/billing" className="rsl-btn-primary text-xs">
                Open Workspace Billing
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="rounded-lg px-3 py-1.5 text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
                >
                  Sign In
                </Link>
                <Link href="/register" className="rsl-btn-primary text-xs">
                  Start Free Trial
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="w-full flex-1 space-y-12 px-5 py-12 sm:px-8 lg:px-12 xl:px-16">
        <section className="max-w-3xl space-y-4">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" />
            <span>100% Transparent INR Pricing • 18% GST Input Credit Invoices</span>
          </span>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            Pay only for the Tally, WhatsApp &amp; growth modules your firm uses
          </h1>
          <p className="text-sm leading-relaxed text-slate-600">
            Start with a 7-day workspace trial - no card required. Unlock bundled suites for up to
            20% savings, or activate individual modules on Monthly, Quarterly, or Annual billing.
            Every account includes a Prepaid Usage Wallet with a{" "}
            <strong className="text-slate-900">
              -{formatInr(WALLET_OVERDRAFT_LIMIT_PAISE, { showDecimals: true })}
            </strong>{" "}
            emergency overdraft buffer so urgent GST bill reminders never stop mid-day.
          </p>
        </section>

        {/* Bundled Suites */}
        <section aria-labelledby="bundles-heading" className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="bundles-heading" className="text-xl font-bold tracking-tight text-slate-950">
                All-in-One Business Suites
              </h2>
              <p className="mt-1 text-xs text-slate-600">
                Pre-configured module bundles for Indian trading, manufacturing, and retail teams.
              </p>
            </div>
            <span className="text-xs font-medium text-slate-500">
              Prices shown exclude 18% GST (full B2B GSTIN tax invoice issued)
            </span>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            {catalog.bundles.map((bundle) => {
              const isHighlighted = Boolean(bundle.badgeLabel);
              return (
                <article
                  key={bundle.key}
                  className={`flex flex-col justify-between rounded-2xl border bg-white p-6 shadow-xs ${
                    isHighlighted
                      ? "border-emerald-500/80 ring-1 ring-emerald-500/30"
                      : "border-slate-200/90"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-base font-bold text-slate-950">{bundle.name}</h3>
                      {bundle.badgeLabel && (
                        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
                          {bundle.badgeLabel}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-600">{bundle.tagline}</p>

                    <div className="mt-5 border-t border-slate-100 pt-4">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-2xl font-bold text-slate-950 tabular-nums">
                          {formatInr(bundle.monthlyAmountPaise)}
                        </span>
                        <span className="text-xs font-medium text-slate-500">/ month</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 tabular-nums">
                        <span>Quarterly: {formatInr(bundle.quarterlyAmountPaise)}</span>
                        <span>•</span>
                        <span>Annual: {formatInr(bundle.yearlyAmountPaise)}</span>
                      </div>
                      {bundle.savingsMonthlyPaise > 0 && (
                        <p className="mt-1.5 text-xs font-semibold text-emerald-700">
                          Saves {formatInr(bundle.savingsMonthlyPaise)}/mo vs individual modules
                        </p>
                      )}
                    </div>

                    <ul className="mt-5 space-y-2 border-t border-slate-100 pt-4 text-xs text-slate-700">
                      {bundle.includedServiceNames.map((svcName) => (
                        <li key={svcName} className="flex items-start gap-2">
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                          <span>{svcName}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-6 pt-2">
                    <Link
                      href={primaryCtaHref}
                      className={`w-full justify-center text-xs ${
                        isHighlighted ? "rsl-btn-primary" : "rsl-btn-secondary"
                      }`}
                    >
                      <span>{primaryCtaLabel}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* Individual Modular Catalog */}
        <section aria-labelledby="modular-heading" className="space-y-4">
          <div>
            <h2 id="modular-heading" className="text-xl font-bold tracking-tight text-slate-950">
              Individual Add-On &amp; Standalone Modules
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              Mix and match any capability independently as your operations grow.
            </p>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200/90 bg-white shadow-2xs">
            <table className="w-full border-collapse text-left text-xs">
              <caption className="sr-only">
                Modular service pricing across monthly, quarterly, annual, and metered wallet rates
              </caption>
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/90 text-slate-700">
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Module
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Category
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    Monthly
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    Quarterly
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    Annual
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    Metered Usage
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {catalog.services.map((svc) => (
                  <tr key={svc.key}>
                    <td className="px-4 py-3.5">
                      <div className="font-semibold text-slate-900">{svc.name}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{svc.plainSummary}</div>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">{svc.category}</td>
                    <td className="px-4 py-3.5 text-right font-semibold text-slate-900 tabular-nums">
                      {formatInr(svc.monthlyAmountPaise)}
                    </td>
                    <td className="px-4 py-3.5 text-right text-slate-700 tabular-nums">
                      {formatInr(svc.quarterlyAmountPaise)}
                    </td>
                    <td className="px-4 py-3.5 text-right text-slate-700 tabular-nums">
                      {formatInr(svc.yearlyAmountPaise)}
                    </td>
                    <td className="px-4 py-3.5 text-right text-slate-600 tabular-nums">
                      {svc.unitAmountPaise > 0 && svc.meteredUnit
                        ? `${formatInr(svc.unitAmountPaise, { showDecimals: true })} / ${svc.meteredUnit}`
                        : "Included"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Wallet & GST Assurance */}
        <section className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-2xs sm:p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl space-y-2">
              <div className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700 uppercase">
                <Wallet className="h-4 w-4" />
                <span>Prepaid Wallet + Official GST Tax Invoices</span>
              </div>
              <h2 className="text-lg font-bold text-slate-950">
                Top up via UPI QR, Razorpay, or NEFT/RTGS with instant SAC 998314 GST vouchers
              </h2>
              <p className="text-xs leading-relaxed text-slate-600">
                Enter your 15-character GSTIN in Business Settings to receive automatic CGST+SGST or
                IGST tax invoices for every plan activation and prepaid wallet recharge. Questions on
                enterprise volume or multi-branch Tally setups? Write to{" "}
                <a
                  href="mailto:app@rapidshiftlabs.in"
                  className="font-semibold text-emerald-700 underline"
                >
                  app@rapidshiftlabs.in
                </a>
                .
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-3">
              <Link href={primaryCtaHref} className="rsl-btn-primary text-xs">
                {primaryCtaLabel}
              </Link>
              <Link href="/payment-terms" className="rsl-btn-secondary text-xs">
                Payment &amp; GST Terms
              </Link>
            </div>
          </div>
        </section>
      </main>

      <PlatformFooter
        suiteLabel="RapidShift Labs Marketing & Tally Suite"
        links={[
          { label: "Home", href: "/" },
          { label: "Pricing", href: "/pricing" },
          { label: "Privacy Policy", href: "/privacy" },
          { label: "Cookie Policy", href: "/cookies" },
          { label: "Terms & Conditions", href: "/terms" },
          { label: "Payment & GST Terms", href: "/payment-terms" },
          { label: "Refund Policy", href: "/refund-policy" },
          { label: "Legal Hub", href: "/legal" },
        ]}
      />
    </div>
  );
}
