import { notFound } from "next/navigation";
import { ERROR_CATALOG, type ErrorCatalogEntry } from "@rsl/core";
import { SectionCard, StatusPill } from "@rsl/ui";
import { ActionLink } from "@/components/ios-feedback";

const DOMAIN_GUIDE_MAP: Record<
  ErrorCatalogEntry["domain"],
  { slug: string; title: string }
> = {
  auth: { slug: "getting-started", title: "Getting Started & Account Access" },
  permissions: {
    slug: "team-roles-security-and-business-settings",
    title: "Team Roles, Security & Business Settings",
  },
  billing: { slug: "plans-wallet-and-gst", title: "Plans, Prepaid Wallet & GST Invoices" },
  business: { slug: "plans-wallet-and-gst", title: "Plans, Prepaid Wallet & GST Invoices" },
  validation: { slug: "getting-started", title: "Getting Started Guide" },
  whatsapp: { slug: "whatsapp-and-broadcasts", title: "WhatsApp Templates & Broadcasts" },
  meta: {
    slug: "connecting-channels-whatsapp-meta-google",
    title: "Connecting WhatsApp, Meta & Google",
  },
  tally: { slug: "tally-sync-and-import", title: "Tally Prime Sync & XML Import" },
  google: {
    slug: "connecting-channels-whatsapp-meta-google",
    title: "Connecting WhatsApp, Meta & Google",
  },
  backup: { slug: "storage-r2-and-backups", title: "Cloud Storage, Google Drive & Backups" },
  api: { slug: "developer-api", title: "Developer REST API Reference" },
  system: { slug: "getting-started", title: "Getting Started & Support" },
};

export function generateStaticParams() {
  return Object.keys(ERROR_CATALOG).map((code) => ({ code }));
}

export default async function ErrorCodeDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const normalized = decodeURIComponent(code).trim().toUpperCase();
  const entries = Object.values(ERROR_CATALOG) as ErrorCatalogEntry[];
  const entry = entries.find((item) => item.code.toUpperCase() === normalized);

  if (!entry) {
    notFound();
  }

  const relatedGuide = DOMAIN_GUIDE_MAP[entry.domain];
  const siblingErrors = entries.filter(
    (item) => item.domain === entry.domain && item.code !== entry.code
  );

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <ActionLink href="/errors" className="font-semibold text-emerald-700 hover:underline">
          ← All Error Codes
        </ActionLink>
        <span>/</span>
        <span className="font-mono font-semibold text-slate-900">{entry.code}</span>
      </div>

      <div className="rounded-2xl border border-zinc-200/90 bg-white p-6 shadow-2xs sm:p-8">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="rounded-lg bg-slate-900 px-2.5 py-1 font-mono text-xs font-bold text-white">
            {entry.code}
          </span>
          <StatusPill
            label={`HTTP ${entry.httpStatus}`}
            tone={entry.httpStatus >= 500 ? "ruby" : entry.httpStatus >= 400 ? "amber" : "emerald"}
          />
          <StatusPill
            label={entry.retryable ? "Safe to Retry" : "Action Needed Before Retry"}
            tone={entry.retryable ? "emerald" : "sky"}
          />
          <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-[11px] font-semibold text-zinc-600 uppercase">
            {entry.domain}
          </span>
        </div>

        <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">{entry.title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-zinc-700">{entry.userMessage}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <SectionCard
          title="How to Fix This Right Now"
          subtitle="Plain-English resolution step"
        >
          <p className="text-[14px] leading-relaxed text-slate-800">{entry.remediation}</p>
          <div className="mt-4 border-t border-zinc-100 pt-4">
            <ActionLink
              href={`/guides/${relatedGuide.slug}`}
              className="rsl-btn-primary text-xs"
            >
              Open Step-by-Step Guide: {relatedGuide.title} →
            </ActionLink>
          </div>
        </SectionCard>

        <SectionCard
          title="API & Webhook Payload Shape"
          subtitle="Returned when calling REST API v1 endpoints"
        >
          <pre className="overflow-x-auto rounded-xl bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-100">
            <code>
              {JSON.stringify(
                {
                  ok: false,
                  error: {
                    code: entry.code,
                    title: entry.title,
                    message: entry.userMessage,
                    remediation: entry.remediation,
                    docsSlug: entry.docsSlug,
                    retryable: entry.retryable,
                  },
                },
                null,
                2
              )}
            </code>
          </pre>
        </SectionCard>
      </div>

      {siblingErrors.length > 0 && (
        <SectionCard
          title={`Related ${entry.domain.toUpperCase()} Error Codes`}
          subtitle="Other codes in the same feature area"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {siblingErrors.map((sib) => (
              <ActionLink
                key={sib.code}
                href={`/errors/${sib.code}`}
                variant="card"
                className="block rounded-xl border border-zinc-200/90 bg-zinc-50/60 p-3.5 transition hover:border-emerald-300 hover:bg-white"
              >
                <div className="font-mono text-xs font-bold text-emerald-700">{sib.code}</div>
                <div className="mt-1 text-[13px] font-semibold text-slate-900">{sib.title}</div>
                <div className="mt-0.5 text-xs text-zinc-600">{sib.userMessage}</div>
              </ActionLink>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
