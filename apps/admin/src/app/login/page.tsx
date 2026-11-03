import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { countPlatformStaff } from "@rsl/auth";
import { resolveEndpointsFromHeaders } from "@rsl/core";
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

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#F8F9FB] p-6">
      <div className="w-full max-w-[420px] rounded-2xl border border-zinc-200/90 bg-white p-8 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
        <div className="flex items-start justify-between gap-3">
          <BrandLogo variant="long" size="sm" subtitle="Client Billing, Plans & Support" />

          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-800">
            <ShieldCheck className="h-3 w-3 text-emerald-600" />
            <span>Staff Only</span>
          </span>
        </div>

        {isUninitialized ? (
          <div className="mt-6 space-y-4">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Complete Initial Platform Setup
            </h1>
            <p className="text-xs leading-relaxed text-zinc-500">
              No Super Admin account exists in this server database yet. Open the dedicated{" "}
              <span className="font-semibold text-slate-800">
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
                className="block text-center text-[11px] font-medium text-zinc-500 underline hover:text-slate-800"
              >
                DNS for setup.{endpoints.primaryDomain} still propagating? Open /setup here instead
              </a>
            )}
          </div>
        ) : (
          <>
            <h1 className="mt-6 text-xl font-bold tracking-tight text-slate-900">
              Sign in to Staff Portal
            </h1>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              Verify client UPI/NEFT payments, unlock feature plans, issue GST invoices, and assist clients.
            </p>

            <FlashBanner notice={sp.notice} error={sp.error} />

            <AdminLoginForm />
          </>
        )}
      </div>

      <div className="mt-5 flex w-full max-w-[420px] items-center justify-between px-1 text-[11px] text-zinc-400">
        <BrandLogo variant="mark" size="xs" subtitle="RapidShift Labs" />
        <span>Internal Operations Console</span>
      </div>
    </div>
  );
}
