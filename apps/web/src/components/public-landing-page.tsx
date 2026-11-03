"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Cloud,
  FileSpreadsheet,
  Inbox,
  Lock,
  MessageSquare,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { BrandLogo, PlatformFooter } from "@rsl/ui";

export interface PublicBundleCardItem {
  key: string;
  name: string;
  tagline: string;
  badgeLabel: string | null;
  includedServiceNames: string[];
  monthlyAmountPaise: number;
  quarterlyAmountPaise: number;
  yearlyAmountPaise: number;
  savingsMonthlyPaise: number;
}

export interface PublicServiceCardItem {
  key: string;
  name: string;
  plainSummary: string;
  category: string;
  monthlyAmountPaise: number;
  quarterlyAmountPaise: number;
  yearlyAmountPaise: number;
  unitAmountPaise: number;
  meteredUnit: string | null;
}

type CycleKey = "monthly" | "quarterly" | "yearly";

function formatInrPlain(paise: number): string {
  const rupees = Math.round(paise / 100);
  return `₹${rupees.toLocaleString("en-IN")}`;
}

export function PublicLandingPage({
  bundles,
  services,
  docsBaseUrl,
}: {
  bundles: PublicBundleCardItem[];
  services: PublicServiceCardItem[];
  docsBaseUrl: string;
}) {
  const [cycle, setCycle] = useState<CycleKey>("monthly");

  const featuredBundles = useMemo(() => {
    const priorityOrder = [
      "tally_whatsapp_pack",
      "whatsapp_growth_pack",
      "all_features",
    ];
    const picked = priorityOrder
      .map((k) => bundles.find((b) => b.key === k))
      .filter((b): b is PublicBundleCardItem => Boolean(b));
    if (picked.length >= 3) return picked;
    return bundles.slice(0, 3);
  }, [bundles]);

  const cycleSuffix =
    cycle === "yearly" ? "/ year" : cycle === "quarterly" ? "/ quarter" : "/ month";

  return (
    <div className="min-h-screen bg-[#F8F9FB] text-slate-900">
      {/* Sticky Public Storefront Header */}
      <header className="sticky top-0 z-30 border-b border-zinc-200/85 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3.5 lg:px-8">
          <Link href="/" className="min-w-0 shrink-0">
            <BrandLogo variant="long" size="md" subtitle="Marketing & Tally Prime Suite" />
          </Link>

          <nav
            aria-label="Public site navigation"
            className="hidden items-center gap-7 text-[13px] font-medium text-zinc-600 md:flex"
          >
            <a href="#features" className="transition hover:text-slate-900">
              Platform Capabilities
            </a>
            <a href="#how-it-works" className="transition hover:text-slate-900">
              3-Minute Tally Setup
            </a>
            <a href="#pricing" className="transition hover:text-slate-900">
              Bundles &amp; Pricing
            </a>
            <a
              href={docsBaseUrl}
              target="_blank"
              rel="noreferrer"
              className="transition hover:text-slate-900"
            >
              Setup Guides ↗
            </a>
          </nav>

          <div className="flex items-center gap-2.5">
            <Link
              href="/login"
              className="rsl-btn-secondary min-h-10 px-4 py-2 text-xs font-semibold"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              className="rsl-btn-primary min-h-10 px-4 py-2 text-xs font-semibold"
            >
              <span>Start 7-Day Free Trial</span>
              <ArrowRight className="ml-1 inline h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-20 px-5 py-12 lg:px-8 lg:py-16">
        {/* Hero Section */}
        <section className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-6">
            <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50/90 px-3.5 py-1 text-xs font-semibold text-emerald-900">
              <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
              <span>7-Day All-Tools Free Trial • Zero Credit Card Needed</span>
            </div>

            <h1 className="text-3xl font-extrabold leading-[1.15] tracking-tight text-slate-900 sm:text-4xl lg:text-[42px]">
              Send Tally Prime GST Bills on WhatsApp Automatically &amp; Collect Payments Faster.
            </h1>

            <p className="max-w-2xl text-[15px] leading-relaxed text-zinc-600">
              Built for Indian wholesalers, manufacturers, retailers, and Chartered Accountants.
              Deliver official PDF tax invoices the moment a bill is saved in Tally Prime, reply to
              WhatsApp &amp; Instagram customers from one shared team inbox, and keep encrypted daily
              backups in your own Google Drive.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link
                href="/register"
                className="rsl-btn-primary inline-flex min-h-11 items-center gap-2 px-6 py-3 text-sm font-semibold"
              >
                <span>Create Free Business Workspace</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#pricing"
                className="rsl-btn-secondary inline-flex min-h-11 items-center px-5 py-3 text-sm font-semibold"
              >
                View Bundles &amp; GST Pricing
              </a>
            </div>

            <div className="grid grid-cols-2 gap-4 border-t border-zinc-200/80 pt-5 text-xs text-zinc-600 sm:grid-cols-4">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span>Balanced Double-Entry Tally XML</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span>Official Meta WhatsApp Cloud API</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span>18% GST Input Tax Credit Invoices</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span>1-Click Google Drive Encrypted Backup</span>
              </div>
            </div>
          </div>

          {/* Interactive Live Product Preview Card */}
          <div className="rounded-3xl border border-zinc-200/90 bg-white p-6 shadow-[0_18px_50px_-14px_rgba(15,23,42,0.12)]">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-4">
              <div>
                <div className="text-[11px] font-bold tracking-wider text-emerald-700 uppercase">
                  Live Tally Prime → WhatsApp Flow
                </div>
                <div className="mt-0.5 text-sm font-bold text-slate-900">
                  Zero manual PDF exports or copy-pasting
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200/80">
                <span className="h-2 w-2 rounded-full bg-emerald-600" />
                Auto-Synced
              </span>
            </div>

            <ol className="mt-4 space-y-3 text-xs">
              <li className="rounded-2xl border border-zinc-200/85 bg-zinc-50/80 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">
                    1. Accountant saves Sales Bill #GST/26-27/0418 in Tally Prime
                  </span>
                  <span className="font-mono font-semibold text-slate-700">₹48,380</span>
                </div>
                <p className="mt-1 text-zinc-600">
                  Lightweight Windows connector reads party phone, due date &amp; multi-page GST PDF automatically.
                </p>
              </li>

              <li className="rounded-2xl border border-emerald-200/90 bg-emerald-50/60 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-950">
                    2. Customer receives Official WhatsApp Invoice PDF in 3 seconds
                  </span>
                  <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    DELIVERED
                  </span>
                </div>
                <p className="mt-1 text-emerald-900/90">
                  &ldquo;Namaste Shree Steels, your GST Invoice #0418 for ₹48,380 is attached. Due: 18 Nov.&rdquo;
                </p>
              </li>

              <li className="rounded-2xl border border-zinc-200/85 bg-zinc-50/80 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">
                    3. Polite due-date follow-up &amp; Shared Team Inbox reply
                  </span>
                  <span className="font-semibold text-emerald-700">Collections +34%</span>
                </div>
                <p className="mt-1 text-zinc-600">
                  When the customer replies with payment proof, your accounts &amp; support team see it immediately.
                </p>
              </li>
            </ol>
          </div>
        </section>

        {/* Bento Grid Capabilities (#features) */}
        <section id="features" className="space-y-6 scroll-mt-24">
          <div className="max-w-2xl">
            <div className="text-xs font-bold tracking-wider text-emerald-700 uppercase">
              Complete 15-Tool Business Suite
            </div>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              Everything your accounts, sales, and customer support teams need — isolated per company.
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-6">
            <div className="rounded-2xl border border-zinc-200/90 bg-white p-6 shadow-2xs md:col-span-4">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-lg font-bold text-slate-900">
                2-Way Tally Prime Live Sync &amp; Receivables Aging
              </h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-zinc-600">
                Sync Sales, Receipts, Credit Notes, Purchase bills, and Ledger Masters across multiple
                Tally companies. Export CA-verified balanced double-entry XML vouchers in Indian
                Standard Time (IST) with zero duplicate entries.
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-slate-700">
                <span className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1">
                  1-Click Windows .bat Pairing
                </span>
                <span className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1">
                  Native Tally PDF Attachment
                </span>
                <span className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1">
                  30 / 60 / 90+ Day Aging Stack
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200/90 bg-white p-6 shadow-2xs md:col-span-2">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-700 ring-1 ring-sky-200/80">
                <Inbox className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-lg font-bold text-slate-900">
                Shared Multi-Channel Inbox
              </h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-zinc-600">
                Assign WhatsApp, Instagram DM, Facebook Page, and Google Review threads across staff
                roles with internal notes, labels, and saved `/shortcut` replies.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200/90 bg-white p-6 shadow-2xs md:col-span-2">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700 ring-1 ring-amber-200/80">
                <Cloud className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-lg font-bold text-slate-900">
                1-Click Google Drive Vault
              </h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-zinc-600">
                Connect your Google Drive in one click — no JSON keys or developer consoles. Every
                `.rslbackup` archive is signed and AES-256-GCM encrypted.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200/90 bg-white p-6 shadow-2xs md:col-span-2">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80">
                <TrendingUp className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-lg font-bold text-slate-900">
                Meta Ads &amp; Google Reviews
              </h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-zinc-600">
                Measure exact Rupee sales collected per ₹1 spent on WhatsApp broadcasts &amp; Meta
                campaigns, and draft polite owner replies to Google Business reviews.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200/90 bg-white p-6 shadow-2xs md:col-span-2">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-800 ring-1 ring-zinc-200">
                <Lock className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-lg font-bold text-slate-900">
                Isolated Per-Business Database
              </h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-zinc-600">
                Your customer contacts, Tally bills, and audit trail live in a dedicated database file
                separated from every other company on the platform.
              </p>
            </div>
          </div>
        </section>

        {/* 3-Minute Setup Steps (#how-it-works) */}
        <section
          id="how-it-works"
          className="rounded-3xl border border-zinc-200/90 bg-white p-7 shadow-2xs lg:p-10 scroll-mt-24"
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-xs font-bold tracking-wider text-emerald-700 uppercase">
                No IT Team Needed
              </div>
              <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
                Go live from Tally Prime to WhatsApp in 3 simple steps
              </h2>
            </div>
            <Link
              href="/register"
              className="rsl-btn-primary min-h-10 px-4 py-2 text-xs font-semibold"
            >
              Start Your 7-Day Free Trial →
            </Link>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              {
                step: "Step 1",
                title: "Create your Business Account (60 sec)",
                detail:
                  "Enter your firm name and GST state. All 15 platform tools unlock immediately for your 7-day starter trial.",
              },
              {
                step: "Step 2",
                title: "Run the 1-Click Tally Connector on Windows",
                detail:
                  "Download your pre-paired launcher from Tally Studio and double-click — no PowerShell or port forwarding required.",
              },
              {
                step: "Step 3",
                title: "Connect Official WhatsApp & Google Drive",
                detail:
                  "Pick starter GST invoice & reminder templates, connect Google Drive in 1 click, and watch collections run automatically.",
              },
            ].map((item) => (
              <div
                key={item.step}
                className="rounded-2xl border border-zinc-200/85 bg-zinc-50/70 p-5"
              >
                <span className="inline-flex rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-900 uppercase">
                  {item.step}
                </span>
                <h3 className="mt-2.5 text-[15px] font-bold text-slate-900">{item.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-600">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Interactive Pricing Section (#pricing) */}
        <section id="pricing" className="space-y-6 scroll-mt-24">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <div className="text-xs font-bold tracking-wider text-emerald-700 uppercase">
                Transparent INR Pricing + 18% GST Input Credit
              </div>
              <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                Start free for 7 days. Pick a value bundle or individual tools anytime.
              </h2>
              <p className="mt-1 text-[13.5px] text-zinc-600">
                Every paid activation includes a statutory SAC 998314 GST Tax Invoice for full 18%
                Input Tax Credit.
              </p>
            </div>

            {/* Interactive Cycle Switcher */}
            <div
              role="group"
              aria-label="Select billing cycle"
              className="inline-flex self-start rounded-2xl border border-zinc-200/90 bg-white p-1.5 shadow-2xs"
            >
              {(
                [
                  { key: "monthly", label: "Monthly", badge: null },
                  { key: "quarterly", label: "Quarterly", badge: "Save ~10%" },
                  { key: "yearly", label: "Yearly", badge: "Save ~20%" },
                ] as const
              ).map((opt) => {
                const active = cycle === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setCycle(opt.key)}
                    aria-pressed={active}
                    className={`inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
                      active
                        ? "bg-slate-900 text-white shadow-xs"
                        : "text-zinc-600 hover:bg-zinc-100 hover:text-slate-900"
                    }`}
                  >
                    <span>{opt.label}</span>
                    {opt.badge && (
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                          active
                            ? "bg-emerald-500 text-white"
                            : "bg-emerald-100 text-emerald-800"
                        }`}
                      >
                        {opt.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3-Tier Featured Bundles */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {featuredBundles.map((bundle) => {
              const isRecommended = bundle.key === "tally_whatsapp_pack";
              const isAllInOne = bundle.key === "all_features";
              const pricePaise =
                cycle === "yearly"
                  ? bundle.yearlyAmountPaise
                  : cycle === "quarterly"
                    ? bundle.quarterlyAmountPaise
                    : bundle.monthlyAmountPaise;

              return (
                <div
                  key={bundle.key}
                  className={`flex flex-col justify-between rounded-3xl border p-6 transition ${
                    isRecommended
                      ? "border-emerald-600 bg-white shadow-[0_18px_45px_-15px_rgba(5,150,105,0.22)] ring-1 ring-emerald-600/20"
                      : isAllInOne
                        ? "border-slate-900/25 bg-slate-900 text-white shadow-lg"
                        : "border-zinc-200/90 bg-white shadow-2xs"
                  }`}
                >
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-bold tracking-wide uppercase ${
                          isRecommended
                            ? "bg-emerald-100 text-emerald-900"
                            : isAllInOne
                              ? "bg-white/15 text-emerald-300"
                              : "bg-zinc-100 text-slate-800"
                        }`}
                      >
                        {isRecommended ? "Recommended for Tally Users" : bundle.badgeLabel || "Value Bundle"}
                      </span>
                      {bundle.savingsMonthlyPaise > 0 && (
                        <span
                          className={`text-[11px] font-semibold ${
                            isAllInOne ? "text-emerald-300" : "text-emerald-700"
                          }`}
                        >
                          Saves {formatInrPlain(bundle.savingsMonthlyPaise)}/mo
                        </span>
                      )}
                    </div>

                    <div>
                      <h3
                        className={`text-lg font-bold tracking-tight ${
                          isAllInOne ? "text-white" : "text-slate-900"
                        }`}
                      >
                        {bundle.name}
                      </h3>
                      <p
                        className={`mt-1 text-xs leading-relaxed ${
                          isAllInOne ? "text-slate-300" : "text-zinc-600"
                        }`}
                      >
                        {bundle.tagline}
                      </p>
                    </div>

                    <div className="border-y border-zinc-200/20 py-3 tabular-nums">
                      <div className="flex items-baseline gap-1.5">
                        <span
                          className={`text-3xl font-extrabold tracking-tight ${
                            isAllInOne ? "text-white" : "text-slate-900"
                          }`}
                        >
                          {formatInrPlain(pricePaise)}
                        </span>
                        <span
                          className={`text-xs font-medium ${
                            isAllInOne ? "text-slate-300" : "text-zinc-600"
                          }`}
                        >
                          {cycleSuffix} + 18% GST
                        </span>
                      </div>
                    </div>

                    <div>
                      <div
                        className={`mb-2 text-[11px] font-bold tracking-wider uppercase ${
                          isAllInOne ? "text-slate-300" : "text-zinc-500"
                        }`}
                      >
                        Includes ({bundle.includedServiceNames.length} tools)
                      </div>
                      <ul className="space-y-1.5 text-xs">
                        {bundle.includedServiceNames.slice(0, 6).map((svcName) => (
                          <li key={svcName} className="flex items-start gap-2">
                            <CheckCircle2
                              className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                                isAllInOne ? "text-emerald-400" : "text-emerald-600"
                              }`}
                            />
                            <span className={isAllInOne ? "text-slate-100" : "text-slate-700"}>
                              {svcName}
                            </span>
                          </li>
                        ))}
                        {bundle.includedServiceNames.length > 6 && (
                          <li
                            className={`pl-5 text-[11px] font-semibold ${
                              isAllInOne ? "text-emerald-300" : "text-emerald-700"
                            }`}
                          >
                            + {bundle.includedServiceNames.length - 6} more tools included
                          </li>
                        )}
                      </ul>
                    </div>
                  </div>

                  <div className="mt-6 pt-2">
                    <Link
                      href="/register"
                      className={`inline-flex min-h-11 w-full items-center justify-center rounded-xl px-4 py-2.5 text-xs font-bold transition ${
                        isAllInOne
                          ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                          : "rsl-btn-primary w-full"
                      }`}
                    >
                      Start 7-Day Free Trial →
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Compact Modular Tools Strip */}
          <div className="rounded-2xl border border-zinc-200/90 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <ReceiptText className="h-4 w-4 text-emerald-600" />
                <span className="text-xs font-bold text-slate-900">
                  Prefer modular a-la-carte plans? Pick any of {services.length} individual tools
                  starting at{" "}
                  {formatInrPlain(
                    Math.min(...services.map((s) => s.monthlyAmountPaise).filter((p) => p > 0))
                  )}
                  /month inside your workspace.
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-600">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                <span>UPI Intent • Razorpay Instant Checkout • Prepaid Wallet (-₹200 Overdraft Buffer)</span>
              </div>
            </div>
          </div>
        </section>
      </main>

      <PlatformFooter
        suiteLabel="RapidShift Labs Marketing & Tally Suite"
        links={[
          { label: "Start 7-Day Free Trial", href: "/register" },
          { label: "Customer Sign In", href: "/login" },
          { label: "Setup Guides & Docs ↗", href: docsBaseUrl, external: true },
        ]}
      />
    </div>
  );
}
