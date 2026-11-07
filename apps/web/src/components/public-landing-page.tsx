"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  Check,
  ChevronDown,
  Database,
  FileSpreadsheet,
  Lock,
  Mail,
  MessageSquareText,
  QrCode,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { BrandLogo } from "@rsl/ui";

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
type WorkbenchTabKey = "tally" | "whatsapp" | "growth" | "vault";

function formatInrPlain(paise: number): string {
  const rupees = Math.round(paise / 100);
  return `₹${rupees.toLocaleString("en-IN")}`;
}

interface WorkbenchDomain {
  key: WorkbenchTabKey;
  index: string;
  label: string;
  accentHex: string;
  pillClass: string;
  activeTabClass: string;
  headline: string;
  summary: string;
  points: string[];
  previewTitle: string;
  previewMeta: string;
  rows: Array<{
    primary: string;
    secondary: string;
    metric: string;
    status: string;
    statusClass: string;
  }>;
  footnote: string;
}

const WORKBENCH_DOMAINS: WorkbenchDomain[] = [
  {
    key: "tally",
    index: "01",
    label: "Tally Prime & Stock",
    accentHex: "#4338CA",
    pillClass: "bg-indigo-50 text-indigo-800 ring-indigo-200/80",
    activeTabClass: "border-indigo-600 bg-indigo-50/60 text-slate-950",
    headline: "Two-way Tally Prime sync for ledgers, GST vouchers, and godown stock.",
    summary:
      "Reads Sales, Receipts, Payments, Credit Notes, Party Ledgers, and Stock Items directly from your Windows Tally Prime company without manual exports or port forwarding.",
    points: [
      "Marks invoices settled automatically the moment a Receipt voucher is saved in Tally Prime and cancels scheduled overdue reminders.",
      "Tracks closing stock, godown quantities, reorder thresholds, HSN/SAC tax slabs, and 90+ day receivable ageing.",
      "Publishes a 4-tab Google Sheets CA workbook on demand for statutory audit and GSTR reconciliation.",
    ],
    previewTitle: "Party Receivables & Tally Settlement Feed",
    previewMeta: "FY 2026-27 • Auto-Reconciled",
    rows: [
      {
        primary: "Shree Steels Surat",
        secondary: "Bill #GST/26-27/0418 • Bhiwandi Unit-2",
        metric: "₹48,380",
        status: "UPI Link Sent",
        statusClass: "bg-indigo-50 text-indigo-800 ring-indigo-200",
      },
      {
        primary: "Mehta Electricals Pune",
        secondary: "Receipt #RCPT/0912 matched in Tally",
        metric: "₹1,12,600",
        status: "Settled",
        statusClass: "bg-emerald-50 text-emerald-800 ring-emerald-200",
      },
      {
        primary: "Kaveri Polymers Vapi",
        secondary: "Bill #GST/26-27/0391 • 14 days past due",
        metric: "₹74,950",
        status: "Reminder Queued",
        statusClass: "bg-amber-50 text-amber-900 ring-amber-200",
      },
      {
        primary: "Havells 4 Sqmm FR Coil",
        secondary: "HSN 8544 • GST 18% • Main Godown",
        metric: "142 Coils",
        status: "In Stock",
        statusClass: "bg-slate-100 text-slate-700 ring-slate-200",
      },
    ],
    footnote: "Supports multi-company Tally Prime setups with isolated per-voucher idempotency.",
  },
  {
    key: "whatsapp",
    index: "02",
    label: "WhatsApp & Team Inbox",
    accentHex: "#047857",
    pillClass: "bg-emerald-50 text-emerald-800 ring-emerald-200/80",
    activeTabClass: "border-emerald-600 bg-emerald-50/60 text-slate-950",
    headline: "Official Meta WhatsApp Cloud API billing and shared multi-agent customer desk.",
    summary:
      "Dispatches untouched Tally-printed GST PDF invoices with dynamic NPCI 0% MDR UPI payment links, and routes customer replies into a role-scoped team inbox.",
    points: [
      "Strict Meta template approval guardrails with pre-submission risk checks and 9-language regional translation.",
      "Post-delivery wallet settlement: funds are debited only after Meta confirms message acceptance; failed deliveries cost ₹0.",
      "Assign WhatsApp, Instagram DM, Facebook Page, and Google Review conversations across billing, sales, and support staff.",
    ],
    previewTitle: "Meta Template & Team Assignment Queue",
    previewMeta: "WABA Cloud v21.0 • Webhook Signed",
    rows: [
      {
        primary: "rsl_gst_invoice_pdf_v2",
        secondary: "UTILITY • Header: Native Tally PDF + Dynamic UPI Link",
        metric: "₹0.35 / msg",
        status: "Meta Approved",
        statusClass: "bg-emerald-50 text-emerald-800 ring-emerald-200",
      },
      {
        primary: "+91 98250 ••••4 (Accounts)",
        secondary: "Shared UTR 431299018221 for Bill #0418",
        metric: "Assigned: Priya",
        status: "Open Thread",
        statusClass: "bg-sky-50 text-sky-800 ring-sky-200",
      },
      {
        primary: "rsl_polite_due_reminder",
        secondary: "UTILITY • Auto-cancels if Tally Receipt is posted",
        metric: "₹0 on Failure",
        status: "Meta Approved",
        statusClass: "bg-emerald-50 text-emerald-800 ring-emerald-200",
      },
      {
        primary: "Regional Broadcast (Gujarati & Hindi)",
        secondary: "Preserves {{1}}..{{4}} placeholders automatically",
        metric: "418 Recipients",
        status: "Delivered",
        statusClass: "bg-slate-100 text-slate-700 ring-slate-200",
      },
    ],
    footnote: "Every outbound template verifies Meta APPROVED status before dispatch.",
  },
  {
    key: "growth",
    index: "03",
    label: "Ads, SEO & Reviews",
    accentHex: "#6D28D9",
    pillClass: "bg-violet-50 text-violet-800 ring-violet-200/80",
    activeTabClass: "border-violet-600 bg-violet-50/60 text-slate-950",
    headline: "One-click Facebook, Instagram, and Google Ads connected to real collections.",
    summary:
      "Connect your ad accounts, Google Search Console property, and Google Business Profile via clean OAuth sign-in without copying developer tokens or JSON keys.",
    points: [
      "Launch Click-to-WhatsApp Meta campaigns and Google Search campaigns either on your own ad account or through the RapidShift Managed Spend Vault.",
      "Pull live organic keyword clicks, impressions, and average rank directly from Google Search Console.",
      "Monitor Google Business Profile star ratings and publish owner responses from the same workspace.",
    ],
    previewTitle: "Connected Acquisition & Reputation Channels",
    previewMeta: "1-Click OAuth • Zero Manual Tokens",
    rows: [
      {
        primary: "Meta Click-to-WhatsApp Lead Gen",
        secondary: "Direct OAuth • West India Industrial Buyers",
        metric: "42 Leads",
        status: "Active",
        statusClass: "bg-violet-50 text-violet-800 ring-violet-200",
      },
      {
        primary: "Google Search Ads (Cloud Project API)",
        secondary: "High-intent B2B wholesale search queries",
        metric: "CTR 6.4%",
        status: "Synced",
        statusClass: "bg-sky-50 text-sky-800 ring-sky-200",
      },
      {
        primary: "Google Search Console Organic",
        secondary: "Top query: 'cr coil supplier surat'",
        metric: "Pos #2.8",
        status: "Verified",
        statusClass: "bg-emerald-50 text-emerald-800 ring-emerald-200",
      },
      {
        primary: "Google Business Profile Reviews",
        secondary: "4.8 ★ average across 126 verified reviews",
        metric: "100% Replied",
        status: "Monitored",
        statusClass: "bg-amber-50 text-amber-900 ring-amber-200",
      },
    ],
    footnote: "Manual API credential entry stays hidden by default unless unlocked by platform staff.",
  },
  {
    key: "vault",
    index: "04",
    label: "Encrypted Vault & GST",
    accentHex: "#B45309",
    pillClass: "bg-amber-50 text-amber-900 ring-amber-200/80",
    activeTabClass: "border-amber-600 bg-amber-50/60 text-slate-950",
    headline: "Dedicated per-company database file, Google Drive backups, and biometric sign-in.",
    summary:
      "Unlike shared multi-tenant tables, every business workspace runs on its own isolated SQLite database file with signed AES-256-GCM archives to your own Google Drive.",
    points: [
      "Physical tenant isolation (`tenant_<workspace>.db`) keeps your customer ledgers, vouchers, and conversations separated on disk.",
      "Forward supplier PDF bills by email to create draft Tally Purchase entries automatically.",
      "Protect owner and accountant logins with W3C Passkeys (Windows Hello, Touch ID, Android biometrics) and full audit trails.",
    ],
    previewTitle: "Security, Storage & Statutory Controls",
    previewMeta: "AES-256-GCM • DPDP Act Aligned",
    rows: [
      {
        primary: "Dedicated Workspace Database",
        secondary: "Isolated SQLite WAL ledger + immutable audit log",
        metric: "Per-Firm DB",
        status: "Isolated",
        statusClass: "bg-amber-50 text-amber-900 ring-amber-200",
      },
      {
        primary: "Google Drive Nightly Archive",
        secondary: "Signed .rslbackup snapshot in your own Drive",
        metric: "SHA-256 OK",
        status: "Encrypted",
        statusClass: "bg-emerald-50 text-emerald-800 ring-emerald-200",
      },
      {
        primary: "W3C WebAuthn Passkey Login",
        secondary: "Hardware-backed ES256 biometric authentication",
        metric: "Zero OTP Lag",
        status: "Enabled",
        statusClass: "bg-indigo-50 text-indigo-800 ring-indigo-200",
      },
      {
        primary: "Statutory Tax Invoicing",
        secondary: "SAC 998314 • 18% GST Input Tax Credit",
        metric: "GSTN Validated",
        status: "Compliant",
        statusClass: "bg-slate-100 text-slate-700 ring-slate-200",
      },
    ],
    footnote: "Full data export and statutory deletion workflows available inside Settings.",
  },
];

export function PublicLandingPage({
  bundles,
  services,
  docsBaseUrl,
}: {
  bundles: PublicBundleCardItem[];
  services: PublicServiceCardItem[];
  docsBaseUrl: string;
}) {
  const [cycle, setCycle] = useState<CycleKey>("yearly");
  const [activeTab, setActiveTab] = useState<WorkbenchTabKey>("tally");

  const featuredBundles = useMemo(() => {
    const priorityOrder = [
      "tally_business_suite",
      "tally_whatsapp_pack",
      "all_features",
    ];
    const picked = priorityOrder
      .map((k) => bundles.find((b) => b.key === k))
      .filter((b): b is PublicBundleCardItem => Boolean(b));
    if (picked.length >= 3) return picked;
    return bundles.slice(0, 3);
  }, [bundles]);

  const secondaryBundles = useMemo(() => {
    const featuredKeys = new Set(featuredBundles.map((b) => b.key));
    return bundles.filter((b) => !featuredKeys.has(b.key));
  }, [bundles, featuredBundles]);

  const currentDomain =
    WORKBENCH_DOMAINS.find((d) => d.key === activeTab) ?? WORKBENCH_DOMAINS[0]!;

  const cycleSuffix =
    cycle === "yearly" ? "/ year" : cycle === "quarterly" ? "/ quarter" : "/ month";

  const minServiceMonthly = useMemo(() => {
    const positive = services.map((s) => s.monthlyAmountPaise).filter((p) => p > 0);
    return positive.length > 0 ? Math.min(...positive) : 19900;
  }, [services]);

  return (
    <div className="relative min-h-screen w-full overflow-x-clip bg-[#F1F5F9] text-slate-900">
      {/* Subtle Multi-Tone Ambient Top Wash (Z-0 Canvas Depth) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[560px]"
        style={{
          background:
            "radial-gradient(60% 55% at 18% 0%, rgba(67, 56, 202, 0.08) 0%, transparent 70%), radial-gradient(50% 50% at 82% 5%, rgba(4, 120, 87, 0.08) 0%, transparent 70%)",
        }}
      />

      {/* Top 3-Tone Architectural Seam */}
      <div className="relative z-40 grid h-1 w-full grid-cols-12">
        <div className="col-span-6 bg-[#0B1220]" />
        <div className="col-span-3 bg-[#4338CA]" />
        <div className="col-span-3 bg-[#047857]" />
      </div>

      {/* Sticky Storefront Masthead (Z-40) */}
      <header className="sticky top-0 z-40 w-full border-b border-slate-200/90 bg-white/92 shadow-[0_4px_24px_-12px_rgba(15,23,42,0.08)] backdrop-blur-xl">
        <div className="flex w-full items-center justify-between gap-4 px-5 py-3.5 sm:px-8 lg:px-12 xl:px-16">
          <Link href="/" className="min-w-0 shrink-0">
            <BrandLogo variant="long" size="md" subtitle="Accounting, Messaging & Growth Desk" />
          </Link>

          <nav
            aria-label="Public site navigation"
            className="hidden items-center gap-7 text-[13px] font-semibold text-slate-600 md:flex"
          >
            <a href="#features" className="transition hover:text-slate-950">
              Product Workbench
            </a>
            <a href="#how-it-works" className="transition hover:text-slate-950">
              10-Min Rollout
            </a>
            <a href="#pricing" className="transition hover:text-slate-950">
              INR Pricing
            </a>
            <a
              href={docsBaseUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 transition hover:text-slate-950"
            >
              <span>Documentation</span>
              <ArrowUpRight className="h-3.5 w-3.5 text-slate-400" />
            </a>
            <Link href="/legal" className="transition hover:text-slate-950">
              Compliance
            </Link>
          </nav>

          <div className="flex items-center gap-2.5">
            <Link
              href="/login"
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-300/90 bg-white px-4 py-2 text-xs font-semibold text-slate-800 shadow-2xs transition hover:border-slate-400 hover:bg-slate-50"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-[#0B1220] px-4 py-2 text-xs font-semibold text-white shadow-[0_6px_16px_-4px_rgba(11,18,32,0.35)] transition hover:bg-slate-800"
            >
              <span>Open 7-Day Trial</span>
              <ArrowRight className="h-3.5 w-3.5 text-emerald-400" />
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10 w-full space-y-20 px-5 py-12 sm:px-8 lg:space-y-24 lg:px-12 lg:py-16 xl:px-16">
        {/* Split Hero with Multi-Plane Z-Axis Live Operational Stage */}
        <section className="grid w-full grid-cols-1 items-center gap-12 lg:grid-cols-[1.06fr_0.94fr] xl:gap-16">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2.5 rounded-lg border border-slate-300/80 bg-white/90 px-3 py-1.5 shadow-2xs">
              <span className="h-2 w-2 rounded-full bg-emerald-600" />
              <span className="font-mono text-[11px] font-semibold tracking-wider text-slate-700 uppercase">
                Indian Accounting, Messaging &amp; Collections Suite
              </span>
            </div>

            <h1 className="text-3xl font-extrabold leading-[1.12] tracking-tight text-slate-950 sm:text-4xl xl:text-[44px]">
              Tally Prime ledgers, WhatsApp GST billing, and ad collections in one working desk.
            </h1>

            <p className="text-[15.5px] leading-[1.68] text-slate-600">
              Built for Indian wholesalers, manufacturers, distributors, and Chartered Accountants.
              Deliver original Tally-printed PDF tax invoices over official WhatsApp Cloud API with
              0% fee NPCI UPI links, reconcile receipts automatically, and run Meta &amp; Google
              campaigns from an isolated company database.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link
                href="/register"
                className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-emerald-700 px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_-6px_rgba(4,120,87,0.45)] transition hover:-translate-y-0.5 hover:bg-emerald-800"
              >
                <span>Create Business Workspace</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#pricing"
                className="inline-flex min-h-12 items-center rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 shadow-xs transition hover:border-slate-400 hover:bg-slate-50"
              >
                Compare INR Plans
              </a>
              <span className="text-xs font-medium text-slate-500">
                7-day full-suite access • No card required at signup
              </span>
            </div>

            {/* Clean Architectural Fact Strip */}
            <div className="grid grid-cols-1 gap-4 border-t border-slate-200/90 pt-6 sm:grid-cols-3">
              <div className="border-l-2 border-indigo-600 pl-3.5">
                <div className="text-xs font-bold text-slate-900">Two-Way Tally Prime XML</div>
                <div className="mt-0.5 text-xs text-slate-600">
                  Sales, Receipts, Ledgers, HSN slabs &amp; Godown stock
                </div>
              </div>
              <div className="border-l-2 border-emerald-600 pl-3.5">
                <div className="text-xs font-bold text-slate-900">Post-Delivery Wallet Billing</div>
                <div className="mt-0.5 text-xs text-slate-600">
                  Meta-approved templates only; ₹0 charged on failed sends
                </div>
              </div>
              <div className="border-l-2 border-amber-600 pl-3.5">
                <div className="text-xs font-bold text-slate-900">Per-Company Vault + GST ITC</div>
                <div className="mt-0.5 text-xs text-slate-600">
                  Dedicated SQLite file, Google Drive backup &amp; SAC 998314
                </div>
              </div>
            </div>
          </div>

          {/* Right: 3-Layer Z-Axis Stacked Product Stage */}
          <div className="relative pt-1 pb-2">
            {/* Plane 1 (Z-10 Base Layer): Deep Midnight-Indigo Tally Prime Voucher Card */}
            <div className="relative z-10 rounded-2xl border border-slate-800 bg-gradient-to-br from-[#0B1220] via-[#111A2E] to-[#1B2544] p-5 text-white shadow-[0_24px_48px_-16px_rgba(11,18,32,0.45)] sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3.5">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-indigo-400" />
                  <span className="font-mono text-[11px] font-semibold tracking-wider text-indigo-200 uppercase">
                    Tally Prime • Sales Voucher #GST/26-27/0418
                  </span>
                </div>
                <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 font-mono text-[10.5px] font-semibold text-emerald-300 ring-1 ring-emerald-400/30">
                  XML BALANCED
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
                <div>
                  <div className="text-[10.5px] text-slate-400">Party Ledger</div>
                  <div className="mt-0.5 font-semibold text-white">Shree Steels Surat</div>
                  <div className="font-mono text-[10.5px] text-slate-400">24AABCS1429B1Z1</div>
                </div>
                <div>
                  <div className="text-[10.5px] text-slate-400">Dispatch Godown</div>
                  <div className="mt-0.5 font-semibold text-slate-100">Bhiwandi Unit-2</div>
                  <div className="font-mono text-[10.5px] text-slate-400">HSN 7209 • 18% GST</div>
                </div>
                <div className="col-span-2 sm:col-span-1 sm:text-right">
                  <div className="text-[10.5px] text-slate-400">Invoice Receivable</div>
                  <div className="mt-0.5 font-mono text-lg font-bold text-white">₹48,380.00</div>
                  <div className="text-[10.5px] text-amber-300">Due 18 Nov 2026</div>
                </div>
              </div>
            </div>

            {/* Plane 2 (Z-20 Elevated Middle Layer): Official WhatsApp PDF + NPCI UPI Card */}
            <div className="relative z-20 -mt-4 ml-3 rounded-2xl border border-slate-200/95 bg-white p-5 shadow-[0_22px_50px_-14px_rgba(15,23,42,0.22)] sm:ml-8 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                    <MessageSquareText className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-xs font-bold text-slate-900">
                      WhatsApp Cloud API • Official Invoice Dispatch
                    </div>
                    <div className="font-mono text-[10.5px] text-slate-500">
                      Template: rsl_gst_invoice_pdf_v2 • +91 98250 ••••4
                    </div>
                  </div>
                </div>
                <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10.5px] font-bold text-emerald-800 ring-1 ring-emerald-200">
                  DELIVERED • 2.4s
                </span>
              </div>

              <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-3 text-xs leading-relaxed text-slate-700">
                  <div className="mb-1.5 inline-flex items-center gap-1.5 rounded bg-white px-2 py-0.5 font-mono text-[10.5px] font-semibold text-indigo-700 ring-1 ring-slate-200">
                    PDF ATTACHED: GST_0418_ShreeSteels.pdf (2 Pages)
                  </div>
                  <p>
                    Dear Shree Steels Surat, Tax Invoice <strong>#GST/26-27/0418</strong> for{" "}
                    <strong>₹48,380</strong> is attached. Pay directly via verified NPCI UPI link with
                    zero gateway fee.
                  </p>
                </div>

                <div className="flex items-center gap-2.5 rounded-xl border border-indigo-200/80 bg-indigo-50/50 px-3.5 py-3 sm:flex-col sm:text-center">
                  <QrCode className="h-7 w-7 shrink-0 text-indigo-700" />
                  <div>
                    <div className="text-[10.5px] font-bold text-indigo-950 uppercase">
                      NPCI UPI QR
                    </div>
                    <div className="font-mono text-[10px] font-semibold text-indigo-700">
                      0% MDR Fee
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Plane 3 (Z-30 Top Floating Chip): Automatic Paid-in-Tally Reconciliation */}
            <div className="relative z-30 -mt-3 mr-2 ml-auto flex max-w-md items-center gap-3 rounded-xl border border-amber-300/90 bg-gradient-to-r from-amber-50 via-white to-emerald-50 px-4 py-2.5 shadow-[0_14px_30px_-8px_rgba(15,23,42,0.18)]">
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                <Check className="h-3.5 w-3.5" />
              </span>
              <div className="text-xs">
                <span className="font-bold text-slate-900">Tally Receipt #RCPT/0912 synced:</span>{" "}
                <span className="text-slate-600">
                  Bill marked Paid and scheduled overdue reminder cancelled.
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Interactive 4-Domain Product Workbench (#features) */}
        <section id="features" className="w-full space-y-6 scroll-mt-24">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <div className="font-mono text-xs font-bold tracking-wider text-indigo-700 uppercase">
                Unified 4-Domain Architecture
              </div>
              <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl">
                One operational desk across accounting, WhatsApp, ads, and compliance.
              </h2>
            </div>
            <p className="max-w-xl text-sm text-slate-600">
              Select a domain below to inspect the exact workflows included in every workspace. No
              bolt-on spreadsheets or third-party webhook glue required.
            </p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200/95 bg-white shadow-[0_18px_42px_-16px_rgba(15,23,42,0.12)]">
            {/* Domain Selector Bar */}
            <div
              role="tablist"
              aria-label="Platform product domains"
              className="grid grid-cols-2 border-b border-slate-200 bg-slate-50/70 lg:grid-cols-4"
            >
              {WORKBENCH_DOMAINS.map((dom) => {
                const isActive = dom.key === currentDomain.key;
                return (
                  <button
                    key={dom.key}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTab(dom.key)}
                    className={`flex items-center gap-2.5 border-b-2 px-4 py-4 text-left transition sm:px-6 ${
                      isActive
                        ? dom.activeTabClass
                        : "border-transparent text-slate-600 hover:bg-white/80 hover:text-slate-900"
                    }`}
                  >
                    <span
                      className="rounded px-1.5 py-0.5 font-mono text-[11px] font-bold"
                      style={{
                        backgroundColor: isActive ? dom.accentHex : "#E2E8F0",
                        color: isActive ? "#FFFFFF" : "#334155",
                      }}
                    >
                      {dom.index}
                    </span>
                    <span className="text-xs font-bold sm:text-[13.5px]">{dom.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Active Domain Split Showcase */}
            <div className="grid grid-cols-1 gap-8 p-6 sm:p-8 lg:grid-cols-[1.02fr_0.98fr] lg:p-10">
              <div className="flex flex-col justify-between space-y-6">
                <div className="space-y-4">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[11px] font-bold ring-1 ${currentDomain.pillClass}`}
                  >
                    DOMAIN {currentDomain.index} • {currentDomain.label.toUpperCase()}
                  </span>

                  <h3 className="text-xl font-extrabold leading-snug tracking-tight text-slate-950 sm:text-2xl">
                    {currentDomain.headline}
                  </h3>

                  <p className="text-sm leading-relaxed text-slate-600">{currentDomain.summary}</p>

                  <ul className="space-y-3 pt-1">
                    {currentDomain.points.map((pt) => (
                      <li key={pt} className="flex items-start gap-2.5 text-[13.5px] text-slate-700">
                        <span
                          className="mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white"
                          style={{ backgroundColor: currentDomain.accentHex }}
                        >
                          <Check className="h-2.5 w-2.5" />
                        </span>
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 text-xs text-slate-500">
                  <span>{currentDomain.footnote}</span>
                  <Link
                    href="/register"
                    className="inline-flex items-center gap-1 font-bold text-slate-900 hover:underline"
                  >
                    <span>Test in 7-day trial</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>

              {/* Structured Live Operational Ledger Preview */}
              <div className="rounded-xl border border-slate-200/95 bg-[#F8FAFC] p-4 shadow-inner sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/90 pb-3">
                  <div className="text-xs font-bold text-slate-900">
                    {currentDomain.previewTitle}
                  </div>
                  <span className="font-mono text-[11px] font-medium text-slate-500">
                    {currentDomain.previewMeta}
                  </span>
                </div>

                <div className="mt-3 divide-y divide-slate-200/80 rounded-lg border border-slate-200/90 bg-white">
                  {currentDomain.rows.map((row) => (
                    <div
                      key={row.primary}
                      className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold text-slate-900">
                          {row.primary}
                        </div>
                        <div className="mt-0.5 truncate text-[11.5px] text-slate-500">
                          {row.secondary}
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <span className="font-mono text-xs font-bold text-slate-800">
                          {row.metric}
                        </span>
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10.5px] font-bold ring-1 ${row.statusClass}`}
                        >
                          {row.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Dark Architectural 3-Step Rollout Band (#how-it-works) */}
        <section
          id="how-it-works"
          className="w-full overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-br from-[#0B1220] via-[#0F172A] to-[#172038] p-7 text-white shadow-[0_22px_50px_-18px_rgba(11,18,32,0.5)] scroll-mt-24 sm:p-10"
        >
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
            <div>
              <div className="font-mono text-xs font-semibold tracking-wider text-emerald-400 uppercase">
                10-Minute Office Rollout
              </div>
              <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
                Connect Tally Prime, WhatsApp, and Google without an IT team.
              </h2>
            </div>
            <Link
              href="/register"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-xs font-bold text-slate-950 shadow-sm transition hover:bg-slate-100"
            >
              <span>Create Trial Workspace</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="mt-7 grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
              <div className="flex items-center justify-between">
                <span className="rounded-md bg-indigo-500/20 px-2.5 py-1 font-mono text-xs font-bold text-indigo-300 ring-1 ring-indigo-400/30">
                  STEP 01
                </span>
                <Building2 className="h-4 w-4 text-indigo-300" />
              </div>
              <h3 className="mt-3.5 text-base font-bold text-white">
                Register your firm &amp; GSTIN
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                Enter your legal business name, PIN code, and optional GSTIN. Your isolated database
                file and 7-day full-suite trial provision immediately.
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
              <div className="flex items-center justify-between">
                <span className="rounded-md bg-emerald-500/20 px-2.5 py-1 font-mono text-xs font-bold text-emerald-300 ring-1 ring-emerald-400/30">
                  STEP 02
                </span>
                <Database className="h-4 w-4 text-emerald-300" />
              </div>
              <h3 className="mt-3.5 text-base font-bold text-white">
                Pair the Windows Tally Connector
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                Download your pre-paired launcher from Tally Studio on the accountant PC. Outbound
                HTTPS syncs vouchers, PDFs, and stock without firewall changes.
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
              <div className="flex items-center justify-between">
                <span className="rounded-md bg-amber-500/20 px-2.5 py-1 font-mono text-xs font-bold text-amber-300 ring-1 ring-amber-400/30">
                  STEP 03
                </span>
                <TrendingUp className="h-4 w-4 text-amber-300" />
              </div>
              <h3 className="mt-3.5 text-base font-bold text-white">
                One-Click Meta &amp; Google Sign-In
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                Authorize WhatsApp Cloud API, Facebook/Instagram Ads, Google Ads, and Google Drive
                backups with standard OAuth popups in Connection Hub.
              </p>
            </div>
          </div>
        </section>

        {/* Focused INR Pricing Section (#pricing) */}
        <section id="pricing" className="w-full space-y-8 scroll-mt-24">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
            <div>
              <div className="font-mono text-xs font-bold tracking-wider text-emerald-700 uppercase">
                Statutory INR Pricing • SAC 998314
              </div>
              <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl">
                Straightforward plans with 18% GST Input Tax Credit.
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Try every tool free for 7 days. Activate a suite below or pick individual modules
                inside your workspace anytime.
              </p>
            </div>

            {/* Tactile Segmented Billing Cycle Switcher */}
            <div
              role="group"
              aria-label="Select billing cycle"
              className="inline-flex self-start rounded-xl border border-slate-300/90 bg-white p-1 shadow-xs"
            >
              {(
                [
                  { key: "monthly", label: "Monthly", badge: null },
                  { key: "quarterly", label: "Quarterly", badge: "-10%" },
                  { key: "yearly", label: "Yearly", badge: "-20%" },
                ] as const
              ).map((opt) => {
                const active = cycle === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setCycle(opt.key)}
                    aria-pressed={active}
                    className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition ${
                      active
                        ? "bg-[#0B1220] text-white shadow-xs"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                    }`}
                  >
                    <span>{opt.label}</span>
                    {opt.badge && (
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                          active
                            ? "bg-emerald-500 text-slate-950"
                            : "bg-emerald-50 text-emerald-800"
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

          {/* 3 Primary Suites with Z-Axis Elevation */}
          <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-3">
            {featuredBundles.map((bundle) => {
              const isRecommended = bundle.key === "tally_whatsapp_pack";
              const isTallySuite = bundle.key === "tally_business_suite";
              const isAllInOne = bundle.key === "all_features";

              const pricePaise =
                cycle === "yearly"
                  ? bundle.yearlyAmountPaise
                  : cycle === "quarterly"
                    ? bundle.quarterlyAmountPaise
                    : bundle.monthlyAmountPaise;
              const effectiveMonthlyPaise =
                cycle === "yearly"
                  ? Math.round(bundle.yearlyAmountPaise / 12)
                  : cycle === "quarterly"
                    ? Math.round(bundle.quarterlyAmountPaise / 3)
                    : bundle.monthlyAmountPaise;

              return (
                <div
                  key={bundle.key}
                  className={`relative flex flex-col justify-between overflow-hidden rounded-2xl border transition ${
                    isRecommended
                      ? "z-20 border-emerald-600 bg-white shadow-[0_24px_50px_-14px_rgba(4,120,87,0.22)] lg:-translate-y-1.5"
                      : isAllInOne
                        ? "z-10 border-slate-800 bg-[#0B1220] text-white shadow-[0_20px_42px_-16px_rgba(11,18,32,0.45)]"
                        : "z-10 border-slate-200/95 bg-white shadow-[0_12px_30px_-14px_rgba(15,23,42,0.1)]"
                  }`}
                >
                  {/* Top Chromatic Rule */}
                  <div
                    className="h-1.5 w-full"
                    style={{
                      background: isRecommended
                        ? "linear-gradient(90deg, #4338CA 0%, #047857 100%)"
                        : isAllInOne
                          ? "linear-gradient(90deg, #D97706 0%, #10B981 100%)"
                          : "#4338CA",
                    }}
                  />

                  <div className="flex flex-1 flex-col justify-between p-6 sm:p-7">
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span
                          className={`rounded-md px-2.5 py-0.5 font-mono text-[10.5px] font-bold uppercase ${
                            isRecommended
                              ? "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200"
                              : isAllInOne
                                ? "bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/30"
                                : "bg-indigo-50 text-indigo-900 ring-1 ring-indigo-200"
                          }`}
                        >
                          {isRecommended
                            ? "Most Chosen Suite"
                            : isTallySuite
                              ? "Core Accounting Desk"
                              : bundle.badgeLabel || "Complete Suite"}
                        </span>

                        {bundle.savingsMonthlyPaise > 0 && (
                          <span
                            className={`font-mono text-[11px] font-semibold ${
                              isAllInOne ? "text-emerald-300" : "text-emerald-700"
                            }`}
                          >
                            Saves {formatInrPlain(bundle.savingsMonthlyPaise)}/mo
                          </span>
                        )}
                      </div>

                      <div>
                        <h3
                          className={`text-lg font-extrabold tracking-tight ${
                            isAllInOne ? "text-white" : "text-slate-950"
                          }`}
                        >
                          {bundle.name}
                        </h3>
                        <p
                          className={`mt-1 text-xs leading-relaxed ${
                            isAllInOne ? "text-slate-300" : "text-slate-600"
                          }`}
                        >
                          {bundle.tagline}
                        </p>
                      </div>

                      <div
                        className={`border-y py-3.5 tabular-nums ${
                          isAllInOne ? "border-white/10" : "border-slate-100"
                        }`}
                      >
                        <div className="flex items-baseline gap-1.5">
                          <span
                            className={`font-mono text-3xl font-extrabold tracking-tight ${
                              isAllInOne ? "text-white" : "text-slate-950"
                            }`}
                          >
                            {formatInrPlain(pricePaise)}
                          </span>
                          <span
                            className={`text-xs font-medium ${
                              isAllInOne ? "text-slate-300" : "text-slate-500"
                            }`}
                          >
                            {cycleSuffix} + 18% GST
                          </span>
                        </div>
                        {cycle !== "monthly" && (
                          <div
                            className={`mt-1 text-[11.5px] font-semibold ${
                              isAllInOne ? "text-emerald-300" : "text-emerald-700"
                            }`}
                          >
                            Effective {formatInrPlain(effectiveMonthlyPaise)}/month billed{" "}
                            {cycle === "yearly" ? "annually" : "quarterly"}
                          </div>
                        )}
                      </div>

                      <div>
                        <div
                          className={`mb-2.5 font-mono text-[10.5px] font-bold tracking-wider uppercase ${
                            isAllInOne ? "text-slate-400" : "text-slate-500"
                          }`}
                        >
                          Included Modules ({bundle.includedServiceNames.length})
                        </div>
                        <ul className="space-y-2 text-xs">
                          {bundle.includedServiceNames.slice(0, 6).map((svcName) => (
                            <li key={svcName} className="flex items-start gap-2">
                              <Check
                                className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                                  isAllInOne ? "text-emerald-400" : "text-emerald-600"
                                }`}
                              />
                              <span className={isAllInOne ? "text-slate-200" : "text-slate-700"}>
                                {svcName}
                              </span>
                            </li>
                          ))}
                          {bundle.includedServiceNames.length > 6 && (
                            <li
                              className={`pl-5 text-[11px] font-semibold ${
                                isAllInOne ? "text-amber-300" : "text-indigo-700"
                              }`}
                            >
                              + {bundle.includedServiceNames.length - 6} additional modules included
                            </li>
                          )}
                        </ul>
                      </div>
                    </div>

                    <div className="mt-6 pt-2">
                      <Link
                        href="/register"
                        className={`inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-bold transition ${
                          isRecommended
                            ? "bg-emerald-700 text-white shadow-[0_8px_20px_-4px_rgba(4,120,87,0.45)] hover:bg-emerald-800"
                            : isAllInOne
                              ? "bg-white text-slate-950 hover:bg-slate-100"
                              : "bg-[#0B1220] text-white hover:bg-slate-800"
                        }`}
                      >
                        <span>Start 7-Day Free Trial</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Collapsible Drawer for Secondary Channel Packs & Modular Tools (Keeps Default View Clean) */}
          <details className="group overflow-hidden rounded-2xl border border-slate-200/95 bg-white shadow-xs">
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-4 px-6 py-4 transition hover:bg-slate-50/80">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-md bg-indigo-50 px-2.5 py-1 font-mono text-[11px] font-bold text-indigo-800 ring-1 ring-indigo-200">
                  MODULAR &amp; CHANNEL PACKS
                </span>
                <span className="text-sm font-bold text-slate-900">
                  Compare {secondaryBundles.length} specialized channel packs &amp; {services.length}{" "}
                  individual tools (from {formatInrPlain(minServiceMonthly)}/mo)
                </span>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-700">
                <span>Expand Rate Table</span>
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              </span>
            </summary>

            <div className="space-y-6 border-t border-slate-200 bg-slate-50/60 p-6">
              {secondaryBundles.length > 0 && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {secondaryBundles.map((bundle) => {
                    const pricePaise =
                      cycle === "yearly"
                        ? bundle.yearlyAmountPaise
                        : cycle === "quarterly"
                          ? bundle.quarterlyAmountPaise
                          : bundle.monthlyAmountPaise;
                    return (
                      <div
                        key={bundle.key}
                        className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-2xs"
                      >
                        <div className="space-y-1.5">
                          <span className="inline-block rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-700 uppercase">
                            {bundle.badgeLabel || "Channel Pack"}
                          </span>
                          <div className="text-sm font-bold text-slate-950">{bundle.name}</div>
                          <p className="text-xs leading-relaxed text-slate-600">{bundle.tagline}</p>
                        </div>
                        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                          <div className="tabular-nums">
                            <span className="font-mono text-base font-extrabold text-slate-950">
                              {formatInrPlain(pricePaise)}
                            </span>
                            <span className="ml-1 text-[11px] text-slate-500">{cycleSuffix}</span>
                          </div>
                          <Link
                            href="/register"
                            className="text-xs font-bold text-indigo-700 hover:underline"
                          >
                            Start Trial →
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {services.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold tracking-wider text-slate-600 uppercase">
                        <th className="px-4 py-3">Individual Module</th>
                        <th className="px-4 py-3">Summary</th>
                        <th className="px-4 py-3 text-right">Monthly Rate (+ GST)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {services.map((svc) => (
                        <tr key={svc.key} className="hover:bg-slate-50/70">
                          <td className="px-4 py-2.5 font-bold text-slate-900">{svc.name}</td>
                          <td className="px-4 py-2.5 text-slate-600">{svc.plainSummary}</td>
                          <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900">
                            {svc.monthlyAmountPaise > 0
                              ? `${formatInrPlain(svc.monthlyAmountPaise)}/mo`
                              : "Usage Wallet"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-700" />
                  <span>
                    Pay via Direct Bank/UPI UTR (0% gateway fee) or instant checkout inside Plans
                    &amp; Wallet.
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-indigo-700" />
                  <span>Prepaid messaging wallet includes a -₹200 emergency continuity buffer.</span>
                </div>
              </div>
            </div>
          </details>
        </section>
      </main>

      {/* Structured Corporate Storefront Footer */}
      <footer className="relative z-10 mt-12 w-full border-t border-slate-200/95 bg-white">
        <div className="grid w-full grid-cols-1 gap-8 px-5 py-12 sm:px-8 md:grid-cols-12 lg:px-12 xl:px-16">
          <div className="space-y-3 md:col-span-5">
            <BrandLogo variant="long" size="md" subtitle="RapidShift Labs • Accounting & Growth Suite" />
            <p className="max-w-md text-xs leading-relaxed text-slate-600">
              Isolated multi-company Tally Prime synchronization, official Meta WhatsApp Cloud API
              billing, ad collections, and encrypted Google Drive vaults for Indian businesses.
            </p>
            <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800">
              <Mail className="h-3.5 w-3.5 text-indigo-700" />
              <span>Support &amp; Onboarding Desk:</span>
              <a
                href="mailto:app@rapidshiftlabs.in"
                className="font-mono text-indigo-700 underline hover:text-indigo-900"
              >
                app@rapidshiftlabs.in
              </a>
            </div>
          </div>

          <div className="space-y-2.5 text-xs md:col-span-2">
            <div className="font-mono text-[11px] font-bold tracking-wider text-slate-900 uppercase">
              Platform
            </div>
            <ul className="space-y-2 text-slate-600">
              <li>
                <a href="#features" className="hover:text-slate-950">
                  Product Workbench
                </a>
              </li>
              <li>
                <a href="#how-it-works" className="hover:text-slate-950">
                  10-Min Rollout
                </a>
              </li>
              <li>
                <a href="#pricing" className="hover:text-slate-950">
                  INR Suites &amp; Rates
                </a>
              </li>
              <li>
                <a
                  href={docsBaseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-slate-950"
                >
                  Setup Documentation ↗
                </a>
              </li>
            </ul>
          </div>

          <div className="space-y-2.5 text-xs md:col-span-3">
            <div className="font-mono text-[11px] font-bold tracking-wider text-slate-900 uppercase">
              Legal &amp; Statutory
            </div>
            <ul className="space-y-2 text-slate-600">
              <li>
                <Link href="/privacy" className="hover:text-slate-950">
                  Privacy Policy (DPDP Act &amp; Google Limited Use)
                </Link>
              </li>
              <li>
                <Link href="/terms" className="hover:text-slate-950">
                  Terms &amp; Conditions
                </Link>
              </li>
              <li>
                <Link href="/payment-terms" className="hover:text-slate-950">
                  Payment &amp; GST Terms (SAC 998314)
                </Link>
              </li>
              <li>
                <Link href="/refund-policy" className="hover:text-slate-950">
                  Refund &amp; Cancellation Policy
                </Link>
              </li>
              <li>
                <Link href="/data-deletion" className="hover:text-slate-950">
                  Data Deletion &amp; Compliance Center
                </Link>
              </li>
            </ul>
          </div>

          <div className="space-y-2.5 text-xs md:col-span-2">
            <div className="font-mono text-[11px] font-bold tracking-wider text-slate-900 uppercase">
              Workspace Access
            </div>
            <ul className="space-y-2 text-slate-600">
              <li>
                <Link href="/login" className="font-semibold text-slate-900 hover:underline">
                  Customer Sign In →
                </Link>
              </li>
              <li>
                <Link href="/register" className="font-semibold text-emerald-700 hover:underline">
                  Start 7-Day Trial →
                </Link>
              </li>
              <li>
                <Link href="/service-delivery" className="hover:text-slate-950">
                  Service Delivery SLA
                </Link>
              </li>
              <li>
                <Link href="/legal" className="hover:text-slate-950">
                  All Legal Documents
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-slate-200/80 bg-slate-50/70 px-5 py-4 text-xs text-slate-500 sm:px-8 lg:px-12 xl:px-16">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              &copy; {new Date().getFullYear()} RapidShift Labs. Dedicated per-business database
              isolation.
            </span>
            <span className="font-mono text-[11px]">
              Official Meta Cloud API • Google Cloud OAuth 2.0 • Tally Prime XML
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
