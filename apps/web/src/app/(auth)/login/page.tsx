import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { confirmEmailVerificationCode } from "@rsl/notifications";
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
    <div className="grid min-h-screen grid-cols-1 bg-[#F8F9FB] lg:grid-cols-[1.05fr_0.95fr]">
      <div className="hidden flex-col justify-between border-r border-zinc-200/90 bg-white p-12 lg:flex">
        <div>
          <Link href="/" className="inline-block">
            <BrandLogo variant="long" size="md" subtitle="RSL Marketing & Tally Suite" />
          </Link>

          <h1 className="mt-14 max-w-md text-3xl font-bold leading-snug tracking-tight text-slate-900">
            Every customer reply, Tally sales bill, and ad rupee — tracked clearly in one place.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-zinc-600">
            Built for Indian businesses that want accurate numbers, private business records, and simple everyday controls without clutter.
          </p>

          <ul className="mt-8 space-y-3 text-xs text-slate-700">
            {[
              "Automatic WhatsApp invoices & receipts the moment Tally Prime saves a bill",
              "Shared WhatsApp, Instagram & Facebook customer inbox for your team",
              "Official 18% GST tax invoices and verified prepaid messaging wallet",
              "7-day all-tools free starter trial included for every new business signup",
            ].map((item) => (
              <li key={item} className="flex items-center gap-2.5">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="grid grid-cols-2 gap-4 border-t border-zinc-200/80 pt-6 text-xs text-zinc-600">
          <div>
            <p className="font-semibold text-slate-900">Private Business Records</p>
            <p className="mt-0.5">
              Your contacts, bills, and backups stay completely separate and private.
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">Tally Prime &amp; WhatsApp</p>
            <p className="mt-0.5">
              Send bills automatically from Tally and follow up on overdue balances in 1 click.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center justify-between p-6 sm:p-12">
        <div className="flex w-full max-w-[400px] items-center justify-between lg:hidden">
          <Link href="/">
            <BrandLogo variant="long" size="sm" subtitle="RSL Marketing & Tally Suite" />
          </Link>
          <Link href="/" className="text-xs font-semibold text-zinc-600 hover:text-slate-900">
            ← Explore Features
          </Link>
        </div>

        <div className="my-auto w-full max-w-[400px] py-6">
          {/* Concise Mobile Value Summary (5.2) */}
          <div className="mb-5 rounded-2xl border border-emerald-200/80 bg-emerald-50/60 p-3.5 text-xs text-emerald-950 lg:hidden">
            <div className="font-semibold">Tally Prime + WhatsApp Automation for Indian Businesses</div>
            <ul className="mt-1.5 space-y-1 text-[11.5px] text-emerald-900/90">
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <span>Auto-send GST bills &amp; overdue reminders on WhatsApp</span>
              </li>
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <span>New businesses get a 7-day all-tools free trial</span>
              </li>
            </ul>
          </div>

          <div className="mb-6">
            <h2 className="text-xl font-bold tracking-tight text-slate-900">
              Sign in to your business
            </h2>
            <p className="mt-1 text-xs text-zinc-600">
              New to RSL Marketing?{" "}
              <ActionLink
                href="/register"
                spinnerSize="xs"
                className="font-semibold text-emerald-700 hover:underline"
              >
                Start your 7-day free trial
              </ActionLink>
            </p>
          </div>

          <FlashBanner notice={verifyBanner} error={sp.error} />

          <WebLoginForm />
        </div>

        <div className="flex w-full max-w-[400px] items-center justify-between border-t border-zinc-200/80 pt-4 text-[11px] text-zinc-500">
          <BrandLogo variant="mark" size="xs" subtitle="RapidShift Labs" />
          <Link href="/" className="hover:text-slate-900 hover:underline">
            Explore Plans &amp; Features →
          </Link>
        </div>
      </div>
    </div>
  );
}
