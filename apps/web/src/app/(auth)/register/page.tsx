import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { INDIA_GST_STATES } from "@rsl/billing";
import { getPlatformCloudflareTurnstileConfig } from "@rsl/tenancy";
import { BrandLogo } from "@rsl/ui";
import { WebRegisterForm } from "@/components/auth-forms";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink } from "@/components/ios-feedback";
import { getOptionalWebSession } from "@/lib/session";

const INDIAN_STATES = Object.entries(INDIA_GST_STATES)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([code, name]) => ({ code, label: `${code} - ${name}` }));

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const existing = await getOptionalWebSession();
  if (existing) {
    redirect("/");
  }

  const sp = await searchParams;

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-[#F1F5F9] px-4 py-10"
      style={{
        backgroundImage:
          "radial-gradient(50% 420px at 20% 0%, rgba(67, 56, 202, 0.08) 0%, transparent 70%), radial-gradient(50% 420px at 80% 0%, rgba(4, 120, 87, 0.08) 0%, transparent 70%)",
      }}
    >
      <div className="w-full max-w-lg">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link href="/">
            <BrandLogo variant="long" size="sm" subtitle="Accounting, Messaging & Growth Suite" />
          </Link>
          <ActionLink
            href="/login"
            spinnerSize="xs"
            className="text-xs font-semibold text-indigo-700 hover:underline"
          >
            Already have a workspace? Sign in
          </ActionLink>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200/95 bg-white shadow-[0_22px_50px_-16px_rgba(15,23,42,0.14)]">
          <div className="grid h-1.5 w-full grid-cols-12">
            <div className="col-span-6 bg-[#0B1220]" />
            <div className="col-span-3 bg-[#4338CA]" />
            <div className="col-span-3 bg-[#047857]" />
          </div>

          <div className="p-7 sm:p-8">
            <div className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-900">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              <span>7-Day Full-Suite Trial • Zero Card Required</span>
            </div>

            <h1 className="mt-3 text-xl font-bold tracking-tight text-slate-950">
              Create your Business Workspace
            </h1>
            <p className="mt-1 text-xs text-slate-600">
              Provision your isolated database file and unlock Tally Prime sync, WhatsApp Cloud API, Inbox, and Google Drive backups for 7 days.
            </p>

            <div className="mt-4">
              <FlashBanner notice={sp.notice} error={sp.error} />
            </div>

            <WebRegisterForm
              indianStates={INDIAN_STATES}
              turnstileSiteKey={
                getPlatformCloudflareTurnstileConfig().isReady
                  ? getPlatformCloudflareTurnstileConfig().siteKey
                  : null
              }
            />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-zinc-500">
          <BrandLogo variant="mark" size="xs" subtitle="RapidShift Labs" />
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/" className="hover:text-slate-900 hover:underline">
              Overview &amp; Pricing
            </Link>
            <Link href="/privacy" className="hover:text-slate-900 hover:underline">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-slate-900 hover:underline">
              Terms
            </Link>
            <Link href="/refund-policy" className="hover:text-slate-900 hover:underline">
              Refunds
            </Link>
            <Link href="/legal" className="hover:text-slate-900 hover:underline">
              Compliance
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
