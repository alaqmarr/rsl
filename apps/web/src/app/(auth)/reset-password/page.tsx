import { BrandLogo } from "@rsl/ui";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { resetPasswordAction } from "@/lib/actions";

export default async function ResetPasswordPage({
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
          Choose a new password
        </h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-zinc-600">
          Confirm your email address, one-time reset code, and new password below.
        </p>

        <div className="mt-4">
          <FlashBanner notice={sp.notice} error={sp.error} />
        </div>

        <form action={resetPasswordAction} className="mt-4 space-y-4">
          <div>
            <label htmlFor="rp-email" className="rsl-label">
              Email Address
            </label>
            <input
              id="rp-email"
              name="email"
              type="email"
              defaultValue={sp.email || ""}
              required
              className="rsl-input"
            />
          </div>
          <div>
            <label htmlFor="rp-token" className="rsl-label">
              One-Time Reset Code
            </label>
            <input
              id="rp-token"
              name="token"
              type="text"
              defaultValue={sp.token || ""}
              required
              className="rsl-input font-mono"
            />
          </div>
          <div>
            <label htmlFor="rp-password" className="rsl-label">
              New Password (8+ characters)
            </label>
            <input
              id="rp-password"
              name="newPassword"
              type="password"
              minLength={8}
              required
              className="rsl-input"
            />
          </div>
          <SubmitButton className="rsl-btn-primary w-full" pendingText="Saving Password...">
            Save New Password
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
