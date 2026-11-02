import { redirect } from "next/navigation";
import { INDIA_GST_STATES } from "@rsl/billing";
import { BrandLogo } from "@rsl/ui";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { registerAction } from "@/lib/actions";
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
          <BrandLogo variant="long" size="sm" subtitle="RSL Marketing & Tally Suite" />
          <ActionLink
            href="/login"
            spinnerSize="xs"
            className="text-xs font-semibold text-emerald-700 hover:underline"
          >
            Already have an account? Sign in
          </ActionLink>
        </div>

        <div className="rounded-2xl border border-zinc-200/90 bg-white p-7 shadow-[0_8px_30px_rgba(15,23,42,0.05)]">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Create your Business Account
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            Set up your business account to view plans, connect Tally Prime, and manage customer messages.
          </p>

          <div className="mt-4">
            <FlashBanner notice={sp.notice} error={sp.error} />
          </div>

          <form action={registerAction} className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-700">
                  Your Full Name
                </label>
                <input name="name" type="text" required className="rsl-input" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-700">Work Email</label>
                <input name="email" type="email" required className="rsl-input" />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-zinc-700">
                Password (minimum 8 characters)
              </label>
              <input name="password" type="password" minLength={8} required className="rsl-input" />
            </div>

            <div className="border-t border-zinc-200/80 pt-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-zinc-700">
                    Business / Firm Name
                  </label>
                  <input name="businessName" type="text" required className="rsl-input" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-zinc-700">
                    Industry (Optional)
                  </label>
                  <input name="industry" type="text" className="rsl-input" />
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-zinc-700">
                    Billing State (for GST)
                  </label>
                  <select name="stateCode" defaultValue="27" className="rsl-input">
                    {INDIAN_STATES.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-zinc-700">
                    GSTIN (Optional)
                  </label>
                  <input
                    name="gstin"
                    type="text"
                    maxLength={15}
                    className="rsl-input font-mono uppercase"
                  />
                </div>
              </div>
            </div>

            <SubmitButton
              className="rsl-btn-primary w-full py-2.5 text-sm"
              pendingText="Creating Account..."
            >
              Create Business Account
            </SubmitButton>
          </form>
        </div>

        <div className="mt-6 flex items-center justify-between px-1 text-[11px] text-zinc-400">
          <BrandLogo variant="mark" size="xs" subtitle="RapidShift Labs" />
          <span>Official GST Invoicing &amp; Tally Suite</span>
        </div>
      </div>
    </div>
  );
}
