import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { confirmEmailVerificationCode } from "@rsl/notifications";
import { getPlatformCloudflareTurnstileConfig } from "@rsl/tenancy";
import { BrandLogo } from "@rsl/ui";
import { WebLoginForm } from "@/components/auth-forms";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink } from "@/components/ios-feedback";
import { getOptionalWebSession } from "@/lib/session";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const existing = await getOptionalWebSession();
  if (existing) {
    redirect("/");
  }

  const sp = await searchParams;
  let verifyBanner = sp.notice;
  if (sp.verifyEmail && sp.code) {
    const ok = confirmEmailVerificationCode(sp.verifyEmail, sp.code);
    verifyBanner = ok
      ? `Email address ${sp.verifyEmail} verified. You can sign in below.`
      : "Verification link expired or already used.";
  }

  return (
    <div className="grid min-h-screen grid-cols-1 bg-[#F1F5F9] lg:grid-cols-[1.04fr_0.96fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-slate-800 bg-gradient-to-br from-[#0B1220] via-[#111A2E] to-[#1E1B4B] p-12 text-white lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-24 h-80 w-80 rounded-full bg-indigo-500/15 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-emerald-500/12 blur-3xl"
        />

        <div className="relative z-10">
          <div className="dark inline-block">
            <Link href="/" className="inline-block">
              <BrandLogo variant="long" size="md" subtitle="Accounting, Messaging & Growth Suite" />
            </Link>
          </div>

          <h1 className="mt-14 max-w-md text-3xl font-extrabold leading-snug tracking-tight text-white">
            Every customer reply, Tally sales bill, and ad rupee in one working desk.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-300">
            Built for Indian businesses that require accurate ledgers, isolated company databases, and straightforward everyday controls.
          </p>

          <ul className="mt-8 space-y-3 text-xs text-slate-200">
            {[
              "Automatic WhatsApp GST invoices & receipts when Tally Prime saves a voucher",
              "Shared WhatsApp, Instagram, Facebook & Google Review inbox for your team",
              "Statutory SAC 998314 GST tax invoices and post-delivery messaging wallet",
              "7-day full-suite trial included for every new business workspace",
            ].map((item) => (
              <li key={item} className="flex items-center gap-2.5">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative z-10 grid grid-cols-2 gap-4 border-t border-white/10 pt-6 text-xs text-slate-300">
          <div>
            <p className="font-semibold text-white">Isolated Business Vault</p>
            <p className="mt-0.5 text-slate-400">
              Dedicated database file per company with encrypted Google Drive backups.
            </p>
          </div>
          <div>
            <p className="font-semibold text-white">Support &amp; Onboarding</p>
            <p className="mt-0.5 font-mono text-indigo-300">app@rapidshiftlabs.in</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center justify-between p-6 sm:p-12">
        <div className="flex w-full max-w-[420px] items-center justify-between lg:hidden">
          <Link href="/">
            <BrandLogo variant="long" size="sm" subtitle="Accounting & Tally Suite" />
          </Link>
          <Link href="/" className="text-xs font-semibold text-indigo-700 hover:text-indigo-900">
            ← Product Overview
          </Link>
        </div>

        <div className="my-auto w-full max-w-[420px] py-6">
          <div className="overflow-hidden rounded-2xl border border-slate-200/95 bg-white shadow-[0_20px_45px_-16px_rgba(15,23,42,0.14)]">
            <div className="grid h-1 w-full grid-cols-12">
              <div className="col-span-6 bg-[#0B1220]" />
              <div className="col-span-3 bg-[#4338CA]" />
              <div className="col-span-3 bg-[#047857]" />
            </div>

            <div className="p-6 sm:p-8">
              <div className="mb-5 rounded-xl border border-indigo-200/80 bg-indigo-50/60 p-3 text-xs text-indigo-950 lg:hidden">
                <div className="font-semibold">Tally Prime + WhatsApp Billing Desk</div>
                <p className="mt-0.5 text-[11.5px] text-indigo-900/90">
                  Auto-send GST bills on WhatsApp and reconcile receipts in real time.
                </p>
              </div>

              <div className="mb-6">
                <h2 className="text-xl font-bold tracking-tight text-slate-950">
                  Sign in to your workspace
                </h2>
                <p className="mt-1 text-xs text-slate-600">
                  New to RapidShift Labs?{" "}
                  <ActionLink
                    href="/register"
                    spinnerSize="xs"
                    className="font-semibold text-indigo-700 hover:underline"
                  >
                    Create your 7-day trial workspace
                  </ActionLink>
                </p>
              </div>

              <FlashBanner notice={verifyBanner} error={sp.error} />

              <WebLoginForm
                turnstileSiteKey={
                  getPlatformCloudflareTurnstileConfig().isReady
                    ? getPlatformCloudflareTurnstileConfig().siteKey
                    : null
                }
              />
            </div>
          </div>
        </div>

        <div className="flex w-full max-w-[420px] flex-wrap items-center justify-between gap-2 border-t border-slate-200/90 pt-4 text-[11px] text-slate-500">
          <BrandLogo variant="mark" size="xs" subtitle="RapidShift Labs" />
          <div className="flex flex-wrap items-center gap-3">
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
