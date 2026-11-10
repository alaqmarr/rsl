import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { BrandLogo, ThemeToggleButton } from "@rsl/ui";
import {
  AdminMfaChallengeForm,
  AdminStepUpForm,
  AdminTotpEnrollmentPanel,
} from "@/components/admin-mfa-client";
import { staffLogoutAction } from "@/lib/actions";
import { getPendingMfaStaffSession } from "@/lib/session";

export default async function AdminMfaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const pending = await getPendingMfaStaffSession();
  if (!pending) {
    redirect("/login");
  }

  const sp = await searchParams;
  const rawReturn = typeof sp.returnTo === "string" ? sp.returnTo.trim() : "/";
  const returnTo = rawReturn.startsWith("/") && !rawReturn.startsWith("//") ? rawReturn : "/";
  const isStepUp = sp.stepUp === "1";
  const stepUpActive =
    Boolean(pending.stepUpAt) && Date.now() - (pending.stepUpAt ?? 0) <= 15 * 60 * 1000;

  return (
    <div className="rsl-ambient-canvas flex min-h-screen items-center justify-center px-4 py-10 text-slate-900">
      <div className="w-full max-w-lg space-y-5">
        <div className="rsl-frost-card rounded-2xl p-6 sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <BrandLogo variant="long" size="sm" subtitle="Staff Security & MFA" />
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-900">
                <ShieldCheck className="h-3.5 w-3.5 text-indigo-700" />
                <span>{pending.mfaEnrolled ? "TOTP Enrolled" : "MFA Enrollment"}</span>
              </span>
              <ThemeToggleButton compact />
            </div>
          </div>

          <div className="mt-5 border-t border-zinc-100 pt-5">
            {!pending.mfaEnrolled ? (
              <>
                <h1 className="text-lg font-bold tracking-tight text-slate-900">
                  Enroll Multi-Factor Authentication
                </h1>
                <p className="mt-1 text-xs leading-relaxed text-zinc-600">
                  Signed in as <strong>{pending.staff.email}</strong>. Pair an authenticator app to
                  protect client workspaces, billing approvals, and platform credentials.
                </p>
                <div className="mt-5">
                  <AdminTotpEnrollmentPanel returnTo={returnTo} alreadyEnrolled={false} />
                </div>
              </>
            ) : !pending.mfaVerified ? (
              <>
                <h1 className="text-lg font-bold tracking-tight text-slate-900">
                  Two-Step Staff Verification
                </h1>
                <p className="mt-1 text-xs leading-relaxed text-zinc-600">
                  Enter the 6-digit code from your authenticator app for{" "}
                  <strong>{pending.staff.email}</strong>.
                </p>
                <div className="mt-5">
                  <AdminMfaChallengeForm returnTo={returnTo} />
                </div>
              </>
            ) : isStepUp ? (
              <>
                <h1 className="text-lg font-bold tracking-tight text-slate-900">
                  Privileged Step-Up Re-Authentication
                </h1>
                <p className="mt-1 text-xs leading-relaxed text-zinc-600">
                  Sensitive staff actions (client support impersonation, platform API credential
                  changes, and password resets) require fresh confirmation within the last 15
                  minutes.
                </p>
                <div className="mt-5">
                  <AdminStepUpForm returnTo={returnTo} totpEnabled={pending.mfaEnrolled} />
                </div>
              </>
            ) : (
              <div className="space-y-6">
                <div>
                  <h1 className="text-lg font-bold tracking-tight text-slate-900">
                    Staff Multi-Factor &amp; Step-Up Security
                  </h1>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-600">
                    Account: <strong>{pending.staff.email}</strong> • Step-up status:{" "}
                    <strong>{stepUpActive ? "Active (<15m)" : "Expired - re-verify below"}</strong>
                  </p>
                </div>

                <div className="rounded-xl border border-zinc-200 p-4">
                  <h2 className="text-xs font-bold text-slate-900 uppercase">
                    Refresh 15-Minute Privileged Step-Up Window
                  </h2>
                  <div className="mt-3">
                    <AdminStepUpForm returnTo={returnTo} totpEnabled={pending.mfaEnrolled} />
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-200 p-4">
                  <h2 className="text-xs font-bold text-slate-900 uppercase">
                    Rotate Authenticator Device &amp; Recovery Codes
                  </h2>
                  <div className="mt-3">
                    <AdminTotpEnrollmentPanel returnTo={returnTo} alreadyEnrolled={true} />
                  </div>
                </div>

                <a
                  href={returnTo}
                  className="adm-btn-secondary inline-flex min-h-10 w-full items-center justify-center text-xs"
                >
                  ← Back to Staff Console
                </a>
              </div>
            )}
          </div>

          <div className="mt-5 flex items-center justify-between border-t border-zinc-100 pt-4 text-xs text-zinc-500">
            <span>Session bound to {pending.staff.name}</span>
            <form action={staffLogoutAction}>
              <button type="submit" className="font-semibold text-rose-700 hover:underline">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
