import React from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  FileCheck2,
  Lock,
  Mail,
  Phone,
  Scale,
  ShieldCheck,
} from "lucide-react";
import type {
  LegalCategory,
  LegalDocument,
  LegalEntityContext,
} from "@/lib/legal-documents";
import { PrintLegalButton } from "@/components/print-legal-button";

const CATEGORY_ORDER: LegalCategory[] = [
  "Core Agreements",
  "Payments, GST & Refunds",
  "Privacy, Security & Messaging",
];

function renderInlineCodeTokens(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={idx}
          className="rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 font-mono text-[12px] text-slate-800"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export function LegalDocumentView({
  doc,
  allDocs,
  entity,
}: {
  doc: LegalDocument;
  allDocs: LegalDocument[];
  entity: LegalEntityContext;
}) {
  return (
    <div className="w-full px-5 py-8 sm:px-8 lg:px-10 lg:py-12 xl:px-14">
      {/* Mobile Policy Switcher Pills */}
      <nav
        aria-label="Compliance policies mobile navigation"
        className="no-print mb-6 flex gap-2 overflow-x-auto pb-2 lg:hidden"
      >
        <Link
          href="/legal"
          className="shrink-0 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:border-zinc-300"
        >
          All Policies
        </Link>
        {allDocs.map((item) => {
          const active = item.slug === doc.slug;
          return (
            <Link
              key={item.slug}
              href={item.path}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                active
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300"
              }`}
            >
              {item.shortTitle}
            </Link>
          );
        })}
      </nav>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[248px_minmax(0,1fr)] xl:grid-cols-[248px_minmax(0,1fr)_220px]">
        {/* Left Sticky Policy Directory */}
        <aside className="no-print hidden lg:block">
          <div className="sticky top-24 space-y-5 rounded-2xl border border-zinc-200/90 bg-white p-4 shadow-2xs">
            <Link
              href="/legal"
              className="flex items-center justify-between rounded-xl border border-zinc-200/80 bg-zinc-50/80 px-3 py-2 text-xs font-bold text-slate-900 transition hover:border-emerald-300 hover:bg-emerald-50/50"
            >
              <span>Compliance Hub</span>
              <ArrowRight className="h-3.5 w-3.5 text-emerald-700" />
            </Link>

            {CATEGORY_ORDER.map((cat) => {
              const items = allDocs.filter((d) => d.category === cat);
              return (
                <div key={cat}>
                  <div className="px-2 text-[10.5px] font-bold tracking-wider text-zinc-500 uppercase">
                    {cat}
                  </div>
                  <ul className="mt-1.5 space-y-0.5">
                    {items.map((item) => {
                      const active = item.slug === doc.slug;
                      return (
                        <li key={item.slug}>
                          <Link
                            href={item.path}
                            aria-current={active ? "page" : undefined}
                            className={`block rounded-xl px-2.5 py-2 text-[12.5px] font-medium transition ${
                              active
                                ? "bg-emerald-50 font-semibold text-emerald-800 ring-1 ring-emerald-200/80"
                                : "text-zinc-600 hover:bg-zinc-50 hover:text-slate-900"
                            }`}
                          >
                            {item.shortTitle}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Center Printable Legal Document */}
        <article className="rsl-frost-card min-w-0 rounded-3xl p-6 sm:p-10">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200/85 pb-6">
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                  <span>{doc.badge}</span>
                </span>
                <span className="text-xs font-medium text-zinc-500">
                  Effective: {doc.effectiveDate} • Updated: {doc.lastUpdated}
                </span>
              </div>

              <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
                {doc.title}
              </h1>
              <p className="text-sm leading-relaxed text-zinc-600">
                {doc.subtitle}
              </p>
            </div>

            <PrintLegalButton />
          </div>

          {/* Plain-English Summary Box */}
          <section
            aria-label="Plain-English key takeaways"
            className="mt-6 rounded-2xl border border-emerald-200/85 bg-emerald-50/55 p-5"
          >
            <div className="flex items-center gap-2 text-xs font-bold tracking-wide text-emerald-900 uppercase">
              <FileCheck2 className="h-4 w-4 text-emerald-700" />
              <span>Plain-English Summary (Key Takeaways)</span>
            </div>
            <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-emerald-950/90">
              {doc.plainSummary.map((point) => (
                <li key={point} className="flex items-start gap-2.5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{renderInlineCodeTokens(point)}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Numbered Legal Clauses */}
          <div className="mt-8 space-y-8">
            {doc.sections.map((sec) => (
              <section key={sec.id} id={sec.id} className="scroll-mt-24 space-y-3">
                <h2 className="text-[18px] font-bold tracking-tight text-slate-900">
                  <a href={`#${sec.id}`} className="hover:text-emerald-700">
                    {sec.heading}
                  </a>
                </h2>

                {sec.paragraphs.map((p, idx) => (
                  <p key={idx} className="text-[14px] leading-7 text-slate-700">
                    {renderInlineCodeTokens(p)}
                  </p>
                ))}

                {sec.bullets && sec.bullets.length > 0 && (
                  <ul className="space-y-2 pl-1 text-[13.5px] leading-6 text-slate-700">
                    {sec.bullets.map((b, idx) => (
                      <li key={idx} className="flex items-start gap-2.5">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" />
                        <span>{renderInlineCodeTokens(b)}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {sec.table && (
                  <div className="overflow-x-auto rounded-2xl border border-zinc-200/90">
                    <table className="w-full border-collapse text-left text-[13px]">
                      <thead>
                        <tr className="border-b border-zinc-200 bg-zinc-50/90 text-[11.5px] font-bold tracking-wide text-slate-800 uppercase">
                          {sec.table.headers.map((h) => (
                            <th key={h} className="px-4 py-2.5">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200/80 bg-white text-slate-700">
                        {sec.table.rows.map((row, rIdx) => (
                          <tr key={rIdx}>
                            {row.map((cell, cIdx) => (
                              <td
                                key={cIdx}
                                className={`px-4 py-2.5 align-top ${
                                  cIdx === 0 ? "font-semibold text-slate-900" : ""
                                }`}
                              >
                                {renderInlineCodeTokens(cell)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {sec.callout && (
                  <div
                    className={`rounded-2xl border p-4 text-[13px] leading-relaxed ${
                      sec.callout.tone === "amber"
                        ? "border-amber-200 bg-amber-50/70 text-amber-950"
                        : sec.callout.tone === "sky"
                          ? "border-sky-200 bg-sky-50/70 text-sky-950"
                          : "border-emerald-200 bg-emerald-50/70 text-emerald-950"
                    }`}
                  >
                    <div className="font-bold">{sec.callout.title}</div>
                    <p className="mt-1">{renderInlineCodeTokens(sec.callout.body)}</p>
                  </div>
                )}
              </section>
            ))}
          </div>

          {/* Statutory Entity & Grievance Contact Footer Block */}
          <div className="mt-10 rounded-2xl border border-zinc-200/90 bg-zinc-50/80 p-5 text-xs text-zinc-600">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-bold text-slate-900">
                Registered Entity &amp; Compliance Desk - {entity.legalName}
              </div>
              <span className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-800">
                GSTIN: {entity.gstin} ({entity.stateName})
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px]">
              <a
                href={`mailto:${entity.billingEmail}`}
                className="inline-flex items-center gap-1.5 font-medium text-emerald-700 hover:underline"
              >
                <Mail className="h-3.5 w-3.5" />
                <span>Billing &amp; Refunds: {entity.billingEmail}</span>
              </a>
              <a
                href={`mailto:${entity.privacyEmail}`}
                className="inline-flex items-center gap-1.5 font-medium text-emerald-700 hover:underline"
              >
                <Lock className="h-3.5 w-3.5" />
                <span>Privacy &amp; Grievance: {entity.privacyEmail}</span>
              </a>
              <span className="inline-flex items-center gap-1.5 text-slate-700">
                <Phone className="h-3.5 w-3.5 text-zinc-500" />
                <span>Support: {entity.supportPhone}</span>
              </span>
            </div>
          </div>
        </article>

        {/* Right Sticky Section TOC */}
        <aside className="no-print hidden xl:block">
          <div className="sticky top-24 rounded-2xl border border-zinc-200/90 bg-white p-4 shadow-2xs">
            <div className="text-[11px] font-bold tracking-wider text-zinc-500 uppercase">
              On This Page
            </div>
            <ul className="mt-2.5 space-y-1.5 text-[12px]">
              {doc.sections.map((sec) => (
                <li key={sec.id}>
                  <a
                    href={`#${sec.id}`}
                    className="block leading-snug text-zinc-600 transition hover:text-emerald-700"
                  >
                    {sec.heading}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function LegalHubView({
  allDocs,
  entity,
}: {
  allDocs: LegalDocument[];
  entity: LegalEntityContext;
}) {
  return (
    <div className="w-full space-y-10 px-5 py-10 sm:px-8 lg:px-10 lg:py-14 xl:px-14">
      {/* Hero Banner */}
      <section className="rsl-frost-card rounded-3xl p-7 sm:p-10">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900">
          <Scale className="h-3.5 w-3.5 text-emerald-600" />
          <span>Public Trust, Tax &amp; Regulatory Compliance Center</span>
        </div>

        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
          Legal Agreements, Privacy, GST Billing &amp; Compliance Policies
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-zinc-600">
          Transparent legal, billing, refund, and data-protection policies governing{" "}
          <strong>{entity.legalName}</strong> ({entity.primaryDomain}) - aligned with India&apos;s
          DPDP Act 2023, CGST/IGST Act 2017 (SAC 998314), Google API Services Limited Use Policy,
          Meta WhatsApp Business Terms, and RBI-regulated payment standards.
        </p>

        <div className="mt-6 flex flex-wrap gap-2.5 text-xs font-semibold text-slate-700">
          {[
            "DPDP Act 2023 (India)",
            "IT Act 2000 & IT Rules 2021",
            "18% GST SAC 998314 Invoices",
            "Google OAuth Limited Use Compliant",
            "Official Meta WhatsApp Cloud API",
            "Isolated Per-Tenant SQLite Encryption",
          ].map((pill) => (
            <span
              key={pill}
              className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-1.5"
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              <span>{pill}</span>
            </span>
          ))}
        </div>
      </section>

      {/* Grouped Policy Cards */}
      {CATEGORY_ORDER.map((cat) => {
        const docs = allDocs.filter((d) => d.category === cat);
        return (
          <section key={cat} className="space-y-4">
            <h2 className="text-lg font-bold tracking-tight text-slate-900">{cat}</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {docs.map((d) => (
                <Link
                  key={d.slug}
                  href={d.path}
                  className="group flex flex-col justify-between rounded-2xl border border-zinc-200/90 bg-white p-6 shadow-2xs transition hover:border-emerald-500/60 hover:shadow-md"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200/80">
                        {d.badge}
                      </span>
                      <span className="text-[11px] text-zinc-500">Updated {d.lastUpdated}</span>
                    </div>
                    <h3 className="mt-3 text-base font-bold text-slate-900 group-hover:text-emerald-700">
                      {d.title}
                    </h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-zinc-600">{d.subtitle}</p>
                  </div>

                  <div className="mt-5 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700">
                    <span>Read full policy</span>
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      {/* Entity & Nodal Grievance Officer Disclosure */}
      <section className="rounded-3xl border border-zinc-200/90 bg-white p-7 shadow-2xs">
        <h2 className="text-lg font-bold text-slate-900">
          Merchant, GST &amp; Grievance Redressal Contact Disclosure
        </h2>
        <p className="mt-1 text-xs text-zinc-600">
          Published in compliance with Consumer Protection (E-Commerce) Rules, IT Rules 2021, DPDP
          Act 2023, and payment partner verification requirements.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-zinc-200/85 bg-zinc-50/70 p-4">
            <div className="font-semibold text-zinc-500">Legal Entity &amp; GSTIN</div>
            <div className="mt-1 font-bold text-slate-900">{entity.legalName}</div>
            <div className="mt-0.5 font-mono text-zinc-700">
              {entity.gstin} ({entity.stateName})
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200/85 bg-zinc-50/70 p-4">
            <div className="font-semibold text-zinc-500">Billing, Invoices &amp; Refunds</div>
            <a
              href={`mailto:${entity.billingEmail}`}
              className="mt-1 block font-bold text-emerald-700 hover:underline"
            >
              {entity.billingEmail}
            </a>
            <div className="mt-0.5 text-zinc-600">5–7 business day refund SLA</div>
          </div>

          <div className="rounded-2xl border border-zinc-200/85 bg-zinc-50/70 p-4">
            <div className="font-semibold text-zinc-500">Privacy &amp; Data Deletion</div>
            <a
              href={`mailto:${entity.privacyEmail}`}
              className="mt-1 block font-bold text-emerald-700 hover:underline"
            >
              {entity.privacyEmail}
            </a>
            <div className="mt-0.5 text-zinc-600">24h acknowledgment • 15d resolution</div>
          </div>

          <div className="rounded-2xl border border-zinc-200/85 bg-zinc-50/70 p-4">
            <div className="font-semibold text-zinc-500">Customer &amp; Compliance Desk</div>
            <div className="mt-1 font-bold text-slate-900">{entity.supportPhone}</div>
            <div className="mt-0.5 text-zinc-600">Mon–Sat, 10:00 AM – 7:00 PM IST</div>
          </div>
        </div>
      </section>
    </div>
  );
}
