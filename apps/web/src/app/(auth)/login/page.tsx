import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { confirmEmailVerificationCode } from "@rsl/notifications";
import { BrandLogo } from "@rsl/ui";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { loginAction } from "@/lib/actions";
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
          <BrandLogo variant="long" size="md" subtitle="RSL Marketing & Tally Suite" />

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
            ].map((item) => (
              <li key={item} className="flex items-center gap-2.5">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="grid grid-cols-2 gap-4 border-t border-zinc-200/80 pt-6 text-xs text-zinc-500">
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
        <div className="w-full max-w-[400px] lg:hidden">
          <BrandLogo variant="long" size="sm" subtitle="RSL Marketing & Tally Suite" />
        </div>

        <div className="my-auto w-full max-w-[400px] py-6">
          <div className="mb-6">
            <h2 className="text-xl font-bold tracking-tight text-slate-900">
              Sign in to your business
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              New to RSL Marketing?{" "}
              <ActionLink
                href="/register"
                spinnerSize="xs"
                className="font-semibold text-emerald-700 hover:underline"
              >
                Create your business account
              </ActionLink>
            </p>
          </div>

          <FlashBanner notice={verifyBanner} error={sp.error} />

          <form
            action={loginAction}
            className="space-y-4 rounded-2xl border border-zinc-200/90 bg-white p-7 shadow-[0_8px_30px_rgba(15,23,42,0.05)]"
          >
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-zinc-700">Work Email</label>
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@company.in"
                className="rsl-input"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-xs font-semibold text-zinc-700">Password</label>
                <ActionLink
                  href="/forgot-password"
                  spinnerSize="xs"
                  className="text-xs font-semibold text-emerald-700 hover:underline"
                >
                  Forgot password?
                </ActionLink>
              </div>
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="rsl-input"
              />
            </div>

            <SubmitButton className="rsl-btn-primary w-full py-2.5 text-sm" pendingText="Signing in...">
              Sign In
            </SubmitButton>
          </form>
        </div>

        <div className="flex w-full max-w-[400px] items-center justify-between border-t border-zinc-200/80 pt-4 text-[11px] text-zinc-400">
          <BrandLogo variant="mark" size="xs" subtitle="RapidShift Labs" />
          <span>RSL Marketing &amp; Tally Suite</span>
        </div>
      </div>
    </div>
  );
}
