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
  .map(([code, name]) => ({ code, label: `${code} — ${name}` }));

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
    <div className="flex min-h-screen items-center justify-center bg-[#F8F9FB] px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link href="/">
            <BrandLogo variant="long" size="sm" subtitle="RSL Marketing & Tally Suite" />
          </Link>
          <ActionLink
            href="/login"
            spinnerSize="xs"
            className="text-xs font-semibold text-emerald-700 hover:underline"
          >
            Already have an account? Sign in
          </ActionLink>
        </div>

        <div className="rounded-2xl border border-zinc-200/90 bg-white p-7 shadow-[0_8px_30px_rgba(15,23,42,0.05)]">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            <span>Includes 7-Day All-Tools Free Trial • No Credit Card Required</span>
          </div>

          <h1 className="mt-2.5 text-xl font-bold tracking-tight text-slate-900">
            Create your Business Account
          </h1>
          <p className="mt-1 text-xs text-zinc-600">
            Explore all 15 Tally Prime, WhatsApp, Inbox, and Cloud Backup tools free for 7 days.
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
