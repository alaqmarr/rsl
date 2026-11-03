import { headers } from "next/headers";
import { CheckCircle2, Lock, ShieldCheck } from "lucide-react";
import { countPlatformStaff } from "@rsl/auth";
import { getEnv, resolveEndpointsFromHeaders } from "@rsl/core";
import {
  controlDb,
  getSafePlatformCredentialsAdminSnapshot,
  ingressDb,
  platformLogsDb,
} from "@rsl/tenancy";
import { BrandLogo, FlashBanner } from "@rsl/ui";
import { AdminSetupForm } from "@/components/admin-auth-forms";
import { getOptionalStaffSession } from "@/lib/session";

export default async function PlatformSetupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  // Ensure control-plane SQLite files exist and migrations are up-to-date on fresh boots
  controlDb();
  ingressDb();
  platformLogsDb();

  const sp = await searchParams;
  const hdrs = await headers();
  const env = getEnv();
  const endpoints = resolveEndpointsFromHeaders(hdrs);
  const staffCount = countPlatformStaff();
  const sess = await getOptionalStaffSession();

  const isFirstRun = staffCount === 0;
  const isSuperAdmin = sess?.staff.staffRole === "super_admin";
  const requiresSetupKey = Boolean((env.SETUP_BOOTSTRAP_TOKEN || "").trim()) || env.NODE_ENV === "production";
  const prefilledKey = typeof sp.key === "string" ? sp.key.trim() : "";

  const adminConsoleHref = endpoints.isLocalDev ? "/" : endpoints.adminBaseUrl;
  const adminCredentialsHref = endpoints.isLocalDev
    ? "/credentials"
    : `${endpoints.adminBaseUrl}/credentials`;
  const adminLoginHref = endpoints.isLocalDev ? "/login" : `${endpoints.adminBaseUrl}/login`;
  const credSnap = getSafePlatformCredentialsAdminSnapshot();
  const readyConnectorsCount = [
    credSnap.google.isReady,
    credSnap.smtp.isReady,
    credSnap.r2.isReady,
    credSnap.meta.isReady,
    credSnap.razorpay.isReady,
  ].filter(Boolean).length;

  const readinessModules = [
    {
      step: "01",
      title: "Primary Super Admin",
      status: isFirstRun ? "Action Required" : "Completed & Locked",
      ready: !isFirstRun,
      summary: isFirstRun
        ? "Create the first Super Admin owner account using your private server Setup Key."
        : `${staffCount} staff account(s) provisioned. Unauthenticated bootstrap is permanently locked.`,
    },
    {
      step: "02",
      title: "Domains & Shared-Nginx SSL",
      status: env.SSL_PROVISION_MODE === "certbot_webroot" ? "Automated HTTP-01" : `Mode: ${env.SSL_PROVISION_MODE}`,
      ready: Boolean(env.PRIMARY_DOMAIN),
      summary: `Primary: ${endpoints.primaryDomain} • Client zones: ${endpoints.tallyWildcardPattern} & ${endpoints.apiWildcardPattern}`,
    },
    {
      step: "03",
      title: "Databases, Queue & KMS",
      status: env.REDIS_URL ? "SQLite WAL + Redis 4579" : "SQLite WAL Durable Queue",
      ready: Boolean(env.KMS_MASTER_KEY && env.BACKUP_SIGNING_KEY),
      summary: `Data root: ${env.DATA_DIR} • Envelope KMS v${env.KMS_KEY_VERSION} active`,
    },
    {
      step: "04",
      title: "Database OAuth & API Credentials",
      status:
        readyConnectorsCount > 0
          ? `${readyConnectorsCount} / 5 Active`
          : "Configure in Admin Portal",
      ready: true,
      summary: [
        `Google OAuth: ${credSnap.google.isReady ? "1-Click Ready" : "Pending"}`,
        `SMTP: ${credSnap.smtp.isReady ? "Live" : "Pending"}`,
        `R2 Storage: ${credSnap.r2.isReady ? "Active" : "Pending"}`,
        `Meta App: ${credSnap.meta.isReady ? "Set" : "Pending"}`,
        `Razorpay: ${credSnap.razorpay.isReady ? "Set" : "Optional"}`,
      ].join(" • "),
    },
  ];

  return (
    <div className="min-h-screen bg-[#F8F9FB] px-5 py-10 text-slate-900 sm:px-8 lg:px-10 xl:px-14">
      <div className="w-full">
        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-200/90 bg-white px-6 py-4 shadow-[0_4px_20px_rgba(15,23,42,0.04)]">
          <BrandLogo
            variant="long"
            size="sm"
            subtitle={`Platform Setup & Readiness • setup.${endpoints.primaryDomain}`}
          />
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold ${
              isFirstRun
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            {isFirstRun ? (
              <>
                <ShieldCheck className="h-3.5 w-3.5 text-amber-600" />
                <span>Step 1 of Setup • Awaiting Super Admin</span>
              </>
            ) : (
              <>
                <Lock className="h-3.5 w-3.5 text-emerald-600" />
                <span>Bootstrap Completed & Locked</span>
              </>
            )}
          </span>
        </div>

        <div className="mt-6">
          <FlashBanner notice={sp.notice} error={sp.error} />
        </div>

        {isFirstRun ? (
          <div className="mt-6 grid gap-6 lg:grid-cols-12">
            {/* Left Column: Create First Super Admin Form */}
            <div className="rounded-2xl border border-zinc-200/90 bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.05)] sm:p-8 lg:col-span-7">
              <div className="text-[11px] font-bold tracking-wider text-emerald-700 uppercase">
                Zero-Credential Git Bootstrap
              </div>
              <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900">
                Create Primary Super Admin
              </h1>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
                No credentials are stored in the repository. Enter the one-time{" "}
                <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-slate-800">
                  SETUP_BOOTSTRAP_TOKEN
                </code>{" "}
                printed by <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px]">bash setup.sh</code>{" "}
                to claim ownership and permanently lock public bootstrap.
              </p>

              <AdminSetupForm requiresSetupKey={requiresSetupKey} prefilledKey={prefilledKey} />
            </div>

            {/* Right Column: Modular Setup Architecture Preview */}
            <div className="space-y-3 lg:col-span-5">
              <div className="rounded-2xl border border-zinc-200/90 bg-white p-5">
                <h2 className="text-xs font-bold tracking-wide text-slate-900 uppercase">
                  Setup Module Pipeline
                </h2>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                  Extensible server onboarding modules for RapidShift Labs deployments.
                </p>

                <div className="mt-4 space-y-3">
                  {readinessModules.map((mod) => (
                    <div
                      key={mod.step}
                      className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-900">
                          {mod.step}. {mod.title}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            mod.ready
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {mod.status}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                        {mod.summary}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : !isSuperAdmin ? (
          /* Public / Non-Super-Admin Locked Gate */
          <div className="mt-6 rounded-2xl border border-zinc-200/90 bg-white p-8 text-center shadow-[0_8px_30px_rgba(15,23,42,0.05)]">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
              <Lock className="h-5 w-5" />
            </div>
            <h1 className="mt-4 text-xl font-bold tracking-tight text-slate-900">
              Platform Already Initialized
            </h1>
            <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-zinc-500">
              First-time Super Admin bootstrap has already been completed and permanently locked. Sign in with
              a Super Admin account on the Staff Portal to view setup modules or manage platform settings.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <a href={adminLoginHref} className="adm-btn-primary px-5 py-2.5 text-xs">
                Sign In to Staff Console →
              </a>
            </div>
          </div>
        ) : (
          /* Authenticated Super Admin Setup & Readiness Hub (Ready for Future Module Expansion) */
          <div className="mt-6 space-y-6">
            <div className="rounded-2xl border border-emerald-200/90 bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.05)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Signed in as Super Admin ({sess.staff.email})</span>
                  </div>
                  <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900">
                    Platform Setup & Readiness Hub
                  </h1>
                  <p className="mt-1 text-xs text-zinc-500">
                    Initial bootstrap is complete. Additional configuration modules can be added here as the
                    setup suite expands.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <a href={adminCredentialsHref} className="adm-btn-secondary px-4 py-2.5 text-xs">
                    Manage OAuth &amp; DB Credentials →
                  </a>
                  <a href={adminConsoleHref} className="adm-btn-primary px-5 py-2.5 text-xs">
                    Open Staff Operations Console →
                  </a>
                </div>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {readinessModules.map((mod) => (
                  <div
                    key={mod.step}
                    className="rounded-xl border border-zinc-200/90 bg-zinc-50/60 p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900">
                        Module {mod.step} • {mod.title}
                      </span>
                      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                        {mod.status}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-zinc-600">{mod.summary}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
