import React from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Mail, Plus } from "lucide-react";
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

function formatInrPlain(paise: number): string {
  const rupees = Math.round(paise / 100);
  return `₹${rupees.toLocaleString("en-IN")}`;
}

export const WORKBENCH_DOMAINS = [
  {
    index: "01",
    title: "Shared team inbox",
    description:
      "Five team members work from one place to view and reply to customer messages, rather than sharing one phone.",
  },
  {
    index: "02",
    title: "Tally + WhatsApp",
    description:
      "Connect your invoicing workflow to WhatsApp to make invoice sharing easier and more consistent.",
  },
  {
    index: "03",
    title: "Overdue invoice reminders",
    description:
      "Review unpaid bills and send payment reminders with one click, without writing the same message each time.",
  },
  {
    index: "04",
    title: "Complete Meta onboarding",
    description:
      "We help with WhatsApp Business API setup, business profile configuration, number connection and templates.",
  },
] as const;

const EXPERIENCE_PILLARS = [
  {
    index: "01",
    title: "Recognizable",
    detail: "Customers know who is messaging them.",
  },
  {
    index: "02",
    title: "Professional",
    detail: "Invoices and follow-ups follow a consistent business process.",
  },
  {
    index: "03",
    title: "Connected",
    detail: "Your team sees the conversation in one shared workspace.",
  },
] as const;

const STORY_STEPS = [
  {
    step: "1",
    title: "Your team makes an invoice",
    detail: "The accounts team prepares the bill in Tally.",
  },
  {
    step: "2",
    title: "Your customer receives it",
    detail:
      "Your connected workflow helps share the invoice over WhatsApp under your configured business identity.",
  },
  {
    step: "3",
    title: "Your team sees what is unpaid",
    detail: "Outstanding and overdue invoices are easy to review.",
  },
  {
    step: "4",
    title: "One click sends a reminder",
    detail: "Select an unpaid invoice and send an approved WhatsApp reminder.",
  },
] as const;

const OPTIONAL_ADDONS = [
  {
    title: "Meta Pixel",
    detail: "Track supported website and conversion events.",
  },
  {
    title: "Meta Ads",
    detail: "Connect eligible ad leads to WhatsApp workflows.",
  },
  {
    title: "Google Ads",
    detail: "Build lead and conversion reporting workflows.",
  },
  {
    title: "Google Business Profile",
    detail: "Connect supported business-profile features.",
  },
  {
    title: "Facebook & Instagram Direct",
    detail: "Support eligible social messaging workflows.",
  },
  {
    title: "Other business systems",
    detail: "Ask us about CRM, ERP and custom integrations.",
  },
] as const;

const PRICING_NOTES = [
  "Messaging charges from Meta and applicable taxes are additional.",
  "Tally licensing and third-party software fees are not included.",
  "Extra features and integrations are priced separately.",
  "Meta controls account, business-name and template approvals.",
] as const;

export function PublicLandingPage({
  bundles,
  services,
  docsBaseUrl,
}: {
  bundles: PublicBundleCardItem[];
  services: PublicServiceCardItem[];
  docsBaseUrl: string;
}) {
  return (
    <div className="rsl-lp-shell min-h-screen w-full overflow-x-clip antialiased">
      {/* Top Bar */}
      <header className="sticky top-0 z-40 w-full border-b border-[var(--lp-border)] bg-[var(--lp-header-bg)] backdrop-blur-md">
        <div className="flex w-full items-center justify-between gap-4 px-5 py-3.5 sm:px-10 lg:px-16 xl:px-24">
          <Link href="/" className="min-w-0 shrink-0">
            <BrandLogo variant="long" size="md" subtitle="WhatsApp Business Automation" />
          </Link>

          <nav
            aria-label="Primary navigation"
            className="hidden items-center gap-7 font-bebas text-[15px] tracking-[0.06em] text-[var(--lp-ink-2)] md:flex"
          >
            <a href="#difference" className="transition hover:text-[var(--lp-ink)]">
              The Difference
            </a>
            <a href="#how-it-works" className="transition hover:text-[var(--lp-ink)]">
              How It Works
            </a>
            <a href="#included" className="transition hover:text-[var(--lp-ink)]">
              Included
            </a>
            <a href="#add-ons" className="transition hover:text-[var(--lp-ink)]">
              Add-Ons
            </a>
            <a href="#pricing" className="transition hover:text-[var(--lp-ink)]">
              Pricing
            </a>
            <a
              href={docsBaseUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 transition hover:text-[var(--lp-ink)]"
            >
              <span>Docs</span>
              <ArrowUpRight className="h-3.5 w-3.5 text-[var(--lp-ink-3)]" />
            </a>
          </nav>

          <div className="flex items-center gap-2.5">
            <Link
              href="/login"
              className="inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--lp-border)] bg-[var(--lp-surface)] px-4 font-bebas text-sm tracking-[0.06em] text-[var(--lp-ink)] transition hover:bg-[var(--lp-recessed)]"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-[var(--lp-cta-bg)] px-4 font-bebas text-sm tracking-[0.06em] text-[var(--lp-cta-fg)] transition hover:bg-[var(--lp-cta-hover)]"
            >
              <span>Start Setup</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      <main className="w-full">
        {/* 01 / HERO */}
        <section className="relative w-full overflow-hidden border-b border-[var(--lp-border)] bg-[var(--lp-canvas)] px-5 py-16 sm:px-10 sm:py-22 lg:px-16 lg:py-26 xl:px-24">
          <div
            aria-hidden="true"
            className="rsl-lp-hero-glow pointer-events-none absolute -top-24 right-8 h-[460px] w-[460px] rounded-full opacity-80"
          />

          <div className="relative z-10 grid w-full grid-cols-1 items-center gap-12 lg:grid-cols-[1.18fr_0.82fr]">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 font-bebas text-sm tracking-[0.14em] text-[var(--lp-brass)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--lp-accent)]" />
                <span>Personal to Your Business</span>
              </div>

              <h1 className="font-bebas text-5xl font-normal tracking-[0.02em] text-[var(--lp-ink)] leading-[1.02] sm:text-6xl xl:text-[4.5rem]">
                Your brand.
                <br />
                Your customers.
                <br />
                <span className="inline-block bg-gradient-to-r from-[var(--lp-accent)] to-[var(--lp-accent-2)] bg-clip-text pr-2 font-cursive text-[0.98em] font-normal tracking-normal text-transparent leading-[1.15]">
                  Your WhatsApp.
                </span>
              </h1>

              <div className="h-[2px] w-12 rounded-full bg-[var(--lp-accent)]/60" />

              <p className="max-w-xl text-base leading-relaxed text-[var(--lp-ink-2)] sm:text-lg">
                A connected WhatsApp experience that feels like a natural part of{" "}
                <span className="font-semibold text-[var(--lp-ink)]">YOUR business</span> - not
                another software company speaking for you.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link
                  href="/register"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--lp-cta-bg)] px-6 font-bebas text-base tracking-[0.06em] text-[var(--lp-cta-fg)] shadow-sm transition hover:bg-[var(--lp-cta-hover)]"
                >
                  <span>Start 7-Day Free Trial</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <a
                  href="#pricing"
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--lp-border)] bg-[var(--lp-surface)] px-5 font-bebas text-base tracking-[0.06em] text-[var(--lp-ink)] transition hover:bg-[var(--lp-recessed)]"
                >
                  See Pricing (₹4,999/mo)
                </a>
              </div>

              <div className="pt-3 font-bebas text-[13px] tracking-[0.1em] text-[var(--lp-ink-3)]">
                Built for you / Powered by RapidShift Labs •{" "}
                <a
                  href="mailto:app@rapidshiftlabs.in"
                  className="text-[var(--lp-accent)] underline-offset-4 hover:underline"
                >
                  app@rapidshiftlabs.in
                </a>
              </div>
            </div>

            <div className="rsl-lp-obsidian-card relative overflow-hidden rounded-3xl p-8 shadow-xl sm:p-10">
              <div
                aria-hidden="true"
                className="rsl-lp-card-glow pointer-events-none absolute -top-20 -right-16 h-56 w-56 rounded-full"
              />
              <div className="relative z-10">
                <div className="rsl-lp-kicker-dark font-bebas text-sm tracking-[0.14em]">
                  A Customer-First Experience
                </div>
                <p className="mt-4 font-bebas text-[1.75rem] font-normal leading-[1.15] tracking-[0.02em] sm:text-[2.1rem]">
                  Your customers see your business identity, your invoices, and your messages -
                  while your team manages everything behind the scenes.
                </p>
                <p className="rsl-lp-divider-dark rsl-lp-muted-dark mt-6 border-t pt-4 text-xs leading-relaxed">
                  Configured with your eligible WhatsApp Business number and approved business
                  profile. Meta controls naming and template approvals.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 02 / THE DIFFERENCE */}
        <section
          id="difference"
          className="w-full scroll-mt-20 border-b border-[var(--lp-border)] bg-[var(--lp-surface)] px-5 py-16 sm:px-10 sm:py-20 lg:px-16 xl:px-24"
        >
          <div className="w-full space-y-10">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--lp-border)] pb-6">
              <div>
                <div className="font-bebas text-sm tracking-[0.14em] text-[var(--lp-brass)]">
                  Why Your Brand Matters
                </div>
                <h2 className="mt-2 font-bebas text-4xl font-normal tracking-[0.02em] text-[var(--lp-ink)] sm:text-5xl">
                  Let customers{" "}
                  <span className="inline-block bg-gradient-to-r from-[var(--lp-accent)] to-[var(--lp-accent-2)] bg-clip-text pr-1.5 font-cursive text-[1.06em] font-normal tracking-normal text-transparent">
                    recognize you.
                  </span>
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--lp-ink-2)] sm:text-base">
                  People trust familiar names. Your customer experience should look and feel like it
                  belongs to your company.
                </p>
              </div>
              <span className="font-bebas text-sm tracking-[0.12em] text-[var(--lp-ink-3)]">
                01 / The Difference
              </span>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-recessed)] p-7 sm:p-8">
                <div className="font-bebas text-xs tracking-[0.14em] text-[var(--lp-ink-3)]">
                  Generic Feel
                </div>
                <h3 className="mt-2 font-bebas text-2xl font-normal tracking-[0.02em] text-[var(--lp-ink)] sm:text-[1.75rem]">
                  Someone else&apos;s platform
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--lp-ink-2)]">
                  Customers may feel disconnected when a service appears to revolve around an
                  unfamiliar software provider.
                </p>
              </div>

              <div className="rounded-2xl border border-[var(--lp-accent-border)] bg-[var(--lp-accent-soft)] p-7 sm:p-8">
                <div className="font-bebas text-xs tracking-[0.14em] text-[var(--lp-accent)]">
                  Your Business First
                </div>
                <h3 className="mt-2 font-bebas text-2xl font-normal tracking-[0.02em] text-[var(--lp-ink)] sm:text-[1.75rem]">
                  Your own business identity
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--lp-ink-2)]">
                  Use your approved WhatsApp business profile and number, with your customer
                  communication centered on your brand.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 divide-y divide-[var(--lp-border)] border-y border-[var(--lp-border)] md:grid-cols-3 md:divide-x md:divide-y-0">
              {EXPERIENCE_PILLARS.map((pillar) => (
                <div key={pillar.index} className="py-6 md:px-6 md:first:pl-0 md:last:pr-0">
                  <div className="font-bebas text-base tracking-[0.1em] text-[var(--lp-brass)]">
                    {pillar.index}
                  </div>
                  <div className="mt-1 font-bebas text-xl tracking-[0.03em] text-[var(--lp-ink)]">
                    {pillar.title}
                  </div>
                  <p className="mt-1 text-sm text-[var(--lp-ink-2)]">{pillar.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 03 / HOW IT WORKS */}
        <section
          id="how-it-works"
          className="w-full scroll-mt-20 border-b border-[var(--lp-border)] bg-[var(--lp-canvas)] px-5 py-16 sm:px-10 sm:py-20 lg:px-16 xl:px-24"
        >
          <div className="w-full space-y-10">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--lp-border)] pb-6">
              <div>
                <div className="font-bebas text-sm tracking-[0.14em] text-[var(--lp-brass)]">
                  A Simple Everyday Story
                </div>
                <h2 className="mt-2 font-bebas text-4xl font-normal tracking-[0.02em] text-[var(--lp-ink)] sm:text-5xl">
                  From invoice to{" "}
                  <span className="inline-block bg-gradient-to-r from-[var(--lp-accent)] to-[var(--lp-accent-2)] bg-clip-text pr-1.5 font-cursive text-[1.06em] font-normal tracking-normal text-transparent">
                    follow-up.
                  </span>
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--lp-ink-2)] sm:text-base">
                  Imagine a customer buys something from your company. Here is what happens next -
                  without endless copying, calling, or chasing.
                </p>
              </div>
              <span className="font-bebas text-sm tracking-[0.12em] text-[var(--lp-ink-3)]">
                02 / See It In Action
              </span>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
              {STORY_STEPS.map((item) => (
                <div
                  key={item.step}
                  className="rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-surface)] p-6 transition hover:border-[var(--lp-accent-border)]"
                >
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--lp-border)] bg-[var(--lp-recessed)] font-bebas text-base tracking-[0.06em] text-[var(--lp-accent)]">
                    0{item.step}
                  </span>
                  <h3 className="mt-4 font-bebas text-xl font-normal tracking-[0.03em] text-[var(--lp-ink)]">
                    {item.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--lp-ink-2)]">
                    {item.detail}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex flex-col justify-between gap-2 rounded-2xl border border-[var(--lp-border)] border-l-4 border-l-[var(--lp-accent)] bg-[var(--lp-surface)] px-7 py-5 sm:flex-row sm:items-center sm:px-8">
              <div className="font-bebas text-xl tracking-[0.03em] text-[var(--lp-ink)] sm:text-2xl">
                The goal:{" "}
                <span className="font-cursive text-[1.55rem] font-normal tracking-normal text-[var(--lp-accent)] sm:text-[1.8rem]">
                  less admin, clearer communication, better follow-up.
                </span>
              </div>
              <p className="text-xs text-[var(--lp-ink-3)] sm:max-w-xs sm:text-right">
                Delivery follows configured workflow and Meta template rules.
              </p>
            </div>
          </div>
        </section>

        {/* 04 / WHAT IS INCLUDED */}
        <section
          id="included"
          className="w-full scroll-mt-20 border-b border-[var(--lp-border)] bg-[var(--lp-surface)] px-5 py-16 sm:px-10 sm:py-20 lg:px-16 xl:px-24"
        >
          <div className="w-full space-y-10">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--lp-border)] pb-6">
              <div>
                <div className="font-bebas text-sm tracking-[0.14em] text-[var(--lp-brass)]">
                  One Standard Suite
                </div>
                <h2 className="mt-2 font-bebas text-4xl font-normal tracking-[0.02em] text-[var(--lp-ink)] sm:text-5xl">
                  Everything{" "}
                  <span className="inline-block bg-gradient-to-r from-[var(--lp-accent)] to-[var(--lp-accent-2)] bg-clip-text pr-1.5 font-cursive text-[1.06em] font-normal tracking-normal text-transparent">
                    your team needs.
                  </span>
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--lp-ink-2)] sm:text-base">
                  Four essentials, set up together and designed around the way your business
                  communicates.
                </p>
              </div>
              <span className="font-bebas text-sm tracking-[0.12em] text-[var(--lp-ink-3)]">
                03 / What Is Included
              </span>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {WORKBENCH_DOMAINS.map((item) => (
                <div
                  key={item.index}
                  className="rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-canvas)] p-7"
                >
                  <div className="font-bebas text-base tracking-[0.1em] text-[var(--lp-brass)]">
                    {item.index}
                  </div>
                  <h3 className="mt-2 font-bebas text-2xl font-normal tracking-[0.03em] text-[var(--lp-ink)] sm:text-[1.75rem]">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--lp-ink-2)]">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between border-t border-[var(--lp-border)] pt-5 font-bebas text-sm tracking-[0.12em] text-[var(--lp-accent)]">
              <span>Included: Up to 5 team users</span>
              <span className="text-[var(--lp-ink-3)]">Standard Team Workspace</span>
            </div>
          </div>
        </section>

        {/* 05 / OPTIONAL ADD-ONS */}
        <section
          id="add-ons"
          className="w-full scroll-mt-20 border-b border-[var(--lp-border)] bg-[var(--lp-canvas)] px-5 py-16 sm:px-10 sm:py-20 lg:px-16 xl:px-24"
        >
          <div className="w-full space-y-10">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--lp-border)] pb-6">
              <div>
                <div className="font-bebas text-sm tracking-[0.14em] text-[var(--lp-brass)]">
                  Built Around Your Needs
                </div>
                <h2 className="mt-2 font-bebas text-4xl font-normal tracking-[0.02em] text-[var(--lp-ink)] sm:text-5xl">
                  Want more?{" "}
                  <span className="inline-block bg-gradient-to-r from-[var(--lp-accent)] to-[var(--lp-accent-2)] bg-clip-text pr-1.5 font-cursive text-[1.06em] font-normal tracking-normal text-transparent">
                    We can build it.
                  </span>
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--lp-ink-2)] sm:text-base">
                  Start with the essentials. Add custom connections only when your business needs
                  them - no confusing bundle of unused features.
                </p>
              </div>
              <span className="font-bebas text-sm tracking-[0.12em] text-[var(--lp-ink-3)]">
                04 / Grow Your Way
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {OPTIONAL_ADDONS.map((addon) => (
                <div
                  key={addon.title}
                  className="rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-surface)] p-6 transition hover:border-[var(--lp-accent-border)]"
                >
                  <div className="flex items-center gap-2 font-bebas text-xl tracking-[0.03em] text-[var(--lp-ink)]">
                    <Plus className="h-4 w-4 shrink-0 text-[var(--lp-accent)]" />
                    <span>{addon.title}</span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--lp-ink-2)]">
                    {addon.detail}
                  </p>
                </div>
              ))}
            </div>

            <p className="text-sm font-medium text-[var(--lp-ink-2)]">
              Every additional integration or custom feature is scoped and quoted separately before
              development.
            </p>
          </div>
        </section>

        {/* 06 / PRICING */}
        <section
          id="pricing"
          className="w-full scroll-mt-20 bg-[var(--lp-surface)] px-5 py-16 sm:px-10 sm:py-20 lg:px-16 xl:px-24"
        >
          <div className="w-full space-y-10">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--lp-border)] pb-6">
              <div>
                <div className="font-bebas text-sm tracking-[0.14em] text-[var(--lp-brass)]">
                  Clear Pricing
                </div>
                <h2 className="mt-2 font-bebas text-4xl font-normal tracking-[0.02em] text-[var(--lp-ink)] sm:text-5xl">
                  One suite.{" "}
                  <span className="inline-block bg-gradient-to-r from-[var(--lp-accent)] to-[var(--lp-accent-2)] bg-clip-text pr-1.5 font-cursive text-[1.06em] font-normal tracking-normal text-transparent">
                    One simple plan.
                  </span>
                </h2>
                <p className="mt-2 text-sm text-[var(--lp-ink-2)] sm:text-base">
                  Your brand-led WhatsApp workflow, supported by RapidShift Labs.
                </p>
              </div>
              <span className="font-bebas text-sm tracking-[0.12em] text-[var(--lp-ink-3)]">
                05 / Pricing
              </span>
            </div>

            <div className="rsl-lp-obsidian-card relative overflow-hidden rounded-3xl p-8 shadow-xl sm:p-11">
              <div className="rsl-lp-kicker-dark font-bebas text-sm tracking-[0.14em]">
                Standard Five-User Package
              </div>

              <div className="rsl-lp-divider-dark mt-7 grid grid-cols-1 gap-8 border-b pb-8 sm:grid-cols-2">
                <div>
                  <div className="font-bebas text-5xl font-normal tracking-[0.065em] sm:text-6xl">
                    ₹9,000
                  </div>
                  <div className="rsl-lp-muted-dark mt-1 text-sm">One-time setup</div>
                </div>
                <div className="rsl-lp-divider-dark sm:border-l sm:pl-10">
                  <div className="rsl-lp-price-num font-bebas text-5xl font-normal tracking-[0.065em] sm:text-6xl">
                    ₹4,999
                  </div>
                  <div className="rsl-lp-muted-dark mt-1 text-sm">Per month</div>
                </div>
              </div>

              <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
                <div className="font-bebas text-lg tracking-[0.05em]">
                  All 4 standard features • 5 team users
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    href="/register"
                    className="rsl-lp-btn-light inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-5 font-bebas text-base tracking-[0.06em] transition"
                  >
                    <span>Start 7-Day Trial</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                  <a
                    href="mailto:app@rapidshiftlabs.in"
                    className="rsl-lp-btn-ghost-dark inline-flex min-h-10 items-center gap-2 rounded-xl px-4 font-bebas text-base tracking-[0.06em] transition"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    <span>Discuss Setup</span>
                  </a>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="font-bebas text-sm tracking-[0.14em] text-[var(--lp-brass)]">
                  What You Should Know
                </div>
                <ul className="space-y-2.5 text-sm text-[var(--lp-ink-2)]">
                  {PRICING_NOTES.map((note) => (
                    <li key={note} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--lp-accent)]" />
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-recessed)] p-7">
                <h3 className="font-cursive text-[2.05rem] font-normal leading-tight tracking-normal text-[var(--lp-ink)]">
                  Let&apos;s make your business easier to reach.
                </h3>
                <p className="mt-2 text-sm text-[var(--lp-ink-2)]">
                  Email{" "}
                  <a
                    href="mailto:app@rapidshiftlabs.in"
                    className="font-semibold text-[var(--lp-accent)] underline underline-offset-4"
                  >
                    app@rapidshiftlabs.in
                  </a>{" "}
                  to discuss your setup.
                </p>
              </div>
            </div>

            {(bundles.length > 0 || services.length > 0) && (
              <details className="group rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-canvas)]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-4 text-xs font-semibold text-[var(--lp-ink-2)] transition hover:text-[var(--lp-ink)]">
                  <span>
                    Compare optional add-on connections &amp; self-serve catalog ({services.length}{" "}
                    modules available in workspace)
                  </span>
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                </summary>
                <div className="space-y-5 border-t border-[var(--lp-border)] p-6 text-xs">
                  {bundles.length > 0 && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {bundles.map((b) => (
                        <div
                          key={b.key}
                          className="rounded-xl border border-[var(--lp-border)] bg-[var(--lp-surface)] p-4"
                        >
                          <div className="font-bebas text-lg tracking-[0.03em] text-[var(--lp-ink)]">
                            {b.name}
                          </div>
                          <p className="mt-1 text-[var(--lp-ink-3)]">{b.tagline}</p>
                          <div className="mt-3 font-bebas text-lg tracking-[0.04em] text-[var(--lp-ink)]">
                            {formatInrPlain(b.monthlyAmountPaise)} / month (+ GST)
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {services.length > 0 && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {services.map((s) => (
                        <div
                          key={s.key}
                          className="rounded-xl border border-[var(--lp-border)] bg-[var(--lp-surface)] p-4"
                        >
                          <div className="font-bebas text-lg tracking-[0.03em] text-[var(--lp-ink)]">
                            {s.name}
                          </div>
                          <p className="mt-1 text-[var(--lp-ink-3)]">{s.plainSummary}</p>
                          <div className="mt-2 font-bebas text-base tracking-[0.04em] text-[var(--lp-accent)]">
                            {formatInrPlain(s.monthlyAmountPaise)} / month (+ GST)
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-[var(--lp-border)] bg-[var(--lp-canvas)]">
        <div className="grid w-full grid-cols-1 gap-8 px-5 py-12 sm:px-10 md:grid-cols-12 lg:px-16 xl:px-24">
          <div className="space-y-3 md:col-span-5">
            <BrandLogo variant="long" size="md" subtitle="RapidShift Labs • WhatsApp Business Automation" />
            <p className="max-w-md text-xs leading-relaxed text-[var(--lp-ink-2)]">
              A customer-first WhatsApp, Tally invoice, and shared team inbox experience built
              around your own business identity.
            </p>
            <a
              href="mailto:app@rapidshiftlabs.in"
              className="inline-flex items-center gap-2 font-bebas text-sm tracking-[0.08em] text-[var(--lp-accent)] underline underline-offset-4"
            >
              app@rapidshiftlabs.in
            </a>
          </div>

          <div className="space-y-2 text-xs md:col-span-2">
            <div className="font-bebas text-sm tracking-[0.1em] text-[var(--lp-ink)]">Suite</div>
            <ul className="space-y-1.5 text-[var(--lp-ink-2)]">
              <li>
                <a href="#difference" className="hover:text-[var(--lp-ink)]">
                  The Difference
                </a>
              </li>
              <li>
                <a href="#how-it-works" className="hover:text-[var(--lp-ink)]">
                  How It Works
                </a>
              </li>
              <li>
                <a href="#included" className="hover:text-[var(--lp-ink)]">
                  What Is Included
                </a>
              </li>
              <li>
                <a href="#pricing" className="hover:text-[var(--lp-ink)]">
                  Pricing
                </a>
              </li>
            </ul>
          </div>

          <div className="space-y-2 text-xs md:col-span-3">
            <div className="font-bebas text-sm tracking-[0.1em] text-[var(--lp-ink)]">
              Legal &amp; Compliance
            </div>
            <ul className="space-y-1.5 text-[var(--lp-ink-2)]">
              <li>
                <Link href="/privacy" className="hover:text-[var(--lp-ink)]">
                  Privacy Policy (DPDP Act &amp; Google Limited Use)
                </Link>
              </li>
              <li>
                <Link href="/terms" className="hover:text-[var(--lp-ink)]">
                  Terms &amp; Conditions
                </Link>
              </li>
              <li>
                <Link href="/payment-terms" className="hover:text-[var(--lp-ink)]">
                  Payment &amp; GST Terms (SAC 998314)
                </Link>
              </li>
              <li>
                <Link href="/refund-policy" className="hover:text-[var(--lp-ink)]">
                  Refund &amp; Cancellation Policy
                </Link>
              </li>
              <li>
                <Link href="/data-deletion" className="hover:text-[var(--lp-ink)]">
                  Data Deletion Center
                </Link>
              </li>
            </ul>
          </div>

          <div className="space-y-2 text-xs md:col-span-2">
            <div className="font-bebas text-sm tracking-[0.1em] text-[var(--lp-ink)]">Access</div>
            <ul className="space-y-1.5 text-[var(--lp-ink-2)]">
              <li>
                <Link href="/login" className="font-semibold text-[var(--lp-ink)] hover:underline">
                  Customer Sign In →
                </Link>
              </li>
              <li>
                <Link
                  href="/register"
                  className="font-semibold text-[var(--lp-accent)] hover:underline"
                >
                  Start 7-Day Trial →
                </Link>
              </li>
              <li>
                <a
                  href={docsBaseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-[var(--lp-ink)]"
                >
                  Documentation ↗
                </a>
              </li>
              <li>
                <Link href="/legal" className="hover:text-[var(--lp-ink)]">
                  All Legal Documents
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-[var(--lp-border)] px-5 py-4 text-xs text-[var(--lp-ink-3)] sm:px-10 lg:px-16 xl:px-24">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              &copy; {new Date().getFullYear()} RapidShift Labs. WhatsApp Business Automation.
            </span>
            <span className="font-bebas text-xs tracking-[0.12em]">
              Official Meta Cloud API • Tally Prime Integration
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
