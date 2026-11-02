import { BrandLogo } from "@rsl/ui";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { forgotPasswordAction } from "@/lib/actions";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F8F9FB] p-6">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200/90 bg-white p-7 shadow-[0_1px_3px_rgba(15,23,42,0.05)] sm:p-8">
        <div className="mb-5">
          <BrandLogo variant="long" size="sm" subtitle="RSL Marketing & Tally Suite" />
        </div>

        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          Reset your password
        </h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-zinc-600">
          Enter your registered email address and we will send you a 30-minute password reset link.
        </p>

        <div className="mt-4">
          <FlashBanner notice={sp.notice} error={sp.error} />
        </div>

        <form action={forgotPasswordAction} className="mt-4 space-y-4">
          <div>
            <label htmlFor="fp-email" className="rsl-label">
              Email Address
            </label>
            <input
              id="fp-email"
              name="email"
              type="email"
              required
              placeholder="you@yourbusiness.in"
              className="rsl-input"
            />
          </div>
          <SubmitButton className="rsl-btn-primary w-full" pendingText="Sending Reset Link...">
            Send Reset Link
          </SubmitButton>
        </form>

        <div className="mt-5 border-t border-zinc-100 pt-4 text-center">
          <ActionLink
            href="/login"
            className="text-[13px] font-semibold text-emerald-600 hover:text-emerald-700"
          >
            ← Back to Sign In
          </ActionLink>
        </div>
      </div>
    </div>
  );
}
