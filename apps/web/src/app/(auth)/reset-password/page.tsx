import { BrandLogo, ThemeToggleButton } from "@rsl/ui";
import { WebResetPasswordForm } from "@/components/auth-forms";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink } from "@/components/ios-feedback";
import { readPasswordResetHandoffEmail } from "@/lib/domains/auth-team";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [sp, handoff] = await Promise.all([searchParams, readPasswordResetHandoffEmail()]);
  const initialEmail = handoff.email || sp.email || "";

  return (
    <div className="rsl-ambient-canvas flex min-h-screen items-center justify-center p-6">
      <div className="rsl-frost-card w-full max-w-md rounded-2xl p-7 sm:p-8">
        <div className="mb-5 flex items-center justify-between gap-2">
          <BrandLogo variant="long" size="sm" subtitle="RSL Marketing & Tally Suite" />
          <ThemeToggleButton compact />
        </div>

        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          Choose a new password
        </h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-zinc-600">
          Enter a strong new password for your RapidShift Labs workspace account.
        </p>

        <div className="mt-4">
          <FlashBanner notice={sp.notice} error={sp.error} />
        </div>

        <WebResetPasswordForm
          initialEmail={initialEmail}
          hasHandoffCookie={handoff.hasHandoffToken}
        />

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
