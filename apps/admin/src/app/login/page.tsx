import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { countPlatformStaff } from "@rsl/auth";
import { resolveEndpointsFromHeaders } from "@rsl/core";
import { getPlatformCloudflareTurnstileConfig } from "@rsl/tenancy";
import { BrandLogo, FlashBanner } from "@rsl/ui";
import { AdminLoginForm } from "@/components/admin-auth-forms";
import { getOptionalStaffSession, isSetupSubdomainHost } from "@/lib/session";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (await isSetupSubdomainHost()) {
    redirect("/setup");
  }

  const sess = await getOptionalStaffSession();
  if (sess) redirect("/");

  const sp = await searchParams;
  const hdrs = await headers();
  const endpoints = resolveEndpointsFromHeaders(hdrs);
  const staffCount = countPlatformStaff();
  const isUninitialized = staffCount === 0;
  const setupHref = endpoints.isLocalDev ? "/setup" : endpoints.setupBaseUrl;
  const turnstile = getPlatformCloudflareTurnstileConfig();

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-[#EEF2F7] p-6"
      style={{
        backgroundImage:
          "radial-gradient(50% 420px at 20% 0%, rgba(67, 56, 202, 0.10) 0%, transparent 72%), radial-gradient(50% 420px at 80% 0%, rgba(15, 23, 42, 0.08) 0%, transparent 72%)",
      }}
    >
      <div className="w-full max-w-[430px] overflow-hidden rounded-2xl border border-slate-200/95 bg-white shadow-[0_24px_55px_-16px_rgba(15,23,42,0.16)]">
        <div className="grid h-1.5 w-full grid-cols-12">
          <div className="col-span-5 bg-[#0B1220]" />
          <div className="col-span-4 bg-[#4338CA]" />
          <div className="col-span-3 bg-[#D97706]" />
        </div>

        <div className="p-8">
          <div className="flex items-start justify-between gap-3">
            <BrandLogo variant="long" size="sm" subtitle="Staff Operations & Billing" />

            <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[10px] font-bold text-indigo-900 uppercase">
              <ShieldCheck className="h-3 w-3 text-indigo-600" />
              <span>Staff Only</span>
            </span>
          </div>

          {isUninitialized ? (
            <div className="mt-6 space-y-4">
              <h1 className="text-xl font-bold tracking-tight text-slate-950">
                Complete Initial Platform Setup
              </h1>
              <p className="text-xs leading-relaxed text-slate-600">
                No Super Admin account exists in this server database yet. Open the dedicated{" "}
                <span className="font-semibold text-slate-900">
                  setup.{endpoints.primaryDomain}
                </span>{" "}
                wizard with your server&apos;s one-time Setup Key to provision the primary Super Admin.
              </p>
              <FlashBanner notice={sp.notice} error={sp.error} />
              <a
                href={setupHref}
                className="adm-btn-primary block w-full py-2.5 text-center text-sm"
              >
                Open Platform Setup Wizard →
              </a>
              {!endpoints.isLocalDev && (
                <a
                  href="/setup"
                  className="block text-center text-[11px] font-medium text-slate-500 underline hover:text-slate-900"
                >
                  DNS for setup.{endpoints.primaryDomain} still propagating? Open /setup here instead
                </a>
              )}
            </div>
          ) : (
            <>
              <h1 className="mt-6 text-xl font-bold tracking-tight text-slate-950">
                Sign in to Staff Control Plane
              </h1>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Verify client UPI/NEFT payments, unlock feature plans, issue GST invoices, and manage credentials.
              </p>

              <FlashBanner notice={sp.notice} error={sp.error} />

              <AdminLoginForm turnstileSiteKey={turnstile.isReady ? turnstile.siteKey : null} />
            </>
          )}
        </div>
      </div>

      <div className="mt-5 flex w-full max-w-[430px] items-center justify-between px-1 text-[11px] text-slate-500">
        <BrandLogo variant="mark" size="xs" subtitle="RapidShift Labs" />
        <span className="font-mono">app@rapidshiftlabs.in</span>
      </div>
    </div>
  );
}
