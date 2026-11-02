import {
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";
import {
  canStaffAccessAdminRoute,
  formatStaffRoleLabel,
  listPlatformStaffMembers,
} from "@rsl/auth";
import {
  AccessRestrictedState,
  FlashBanner,
  MetricCard,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@rsl/ui";
import { SubmitButton } from "@/components/ios-feedback";
import {
  staffCreateStaffMemberAction,
  staffUpdateStaffMemberAction,
} from "@/lib/actions";
import { requireStaffSession } from "@/lib/session";

const ROLE_LABELS: Record<string, { label: string; tone: "emerald" | "sky" | "stone"; desc: string }> = {
  super_admin: {
    label: "Super Admin",
    tone: "emerald",
    desc: "Full access to client approvals, pricing, GST invoices, and staff team management.",
  },
  finance: {
    label: "Finance & Billing",
    tone: "sky",
    desc: "Verify UPI/NEFT payments, unlock paid plans, manage wallets, and export GST CSVs.",
  },
  support: {
    label: "Customer Support",
    tone: "stone",
    desc: "Assist clients with Tally Prime setup, WhatsApp templates, password resets, and 30-min support view.",
  },
};

export default async function AdminStaffTeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { staff: currentStaff } = await requireStaffSession();
  if (!canStaffAccessAdminRoute(currentStaff.staffRole, "/staff")) {
    return (
      <AccessRestrictedState
        pageTitle="Staff Team & Roles"
        roleLabel={formatStaffRoleLabel(currentStaff.staffRole)}
        requiredPermissionLabel="Manage internal staff accounts"
        description="Only Super Admins can create staff accounts, modify staff roles, or reset internal staff passwords."
      />
    );
  }
  const sp = await searchParams;
  const members = listPlatformStaffMembers();

  const activeCount = members.filter((m) => m.active).length;
  const superAdminCount = members.filter((m) => m.active && m.staffRole === "super_admin").length;
  const liveSessions = members.reduce((acc, m) => acc + m.activeSessionsCount, 0);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Internal Access & Security"
        title="Staff Team & Roles"
        subtitle="Manage who can sign in to the RSL Staff Portal, assign Finance or Support roles, reset staff passwords, or disable departed team members."
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Active Staff Logins"
          value={String(activeCount)}
          sublabel={`${members.length} total staff record(s)`}
          accent="emerald"
          icon={<Users className="h-4 w-4" />}
        />
        <MetricCard
          label="Super Admins"
          value={String(superAdminCount)}
          sublabel="At least 1 active Super Admin is always protected"
          accent="sky"
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <MetricCard
          label="Open Browser Sessions"
          value={String(liveSessions)}
          sublabel="12-hour signed staff sessions"
          icon={<UserCheck className="h-4 w-4" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.05fr_1.55fr]">
        {/* Add New Staff Member */}
        <SectionCard
          title="Add Staff Team Member"
          subtitle="Create a dedicated Staff Portal login so every payment approval and client action is tracked under their own name"
        >
          <form action={staffCreateStaffMemberAction} className="space-y-3.5 text-xs">
            <div>
              <label className="mb-1 block font-semibold text-zinc-700">Full Name</label>
              <input
                name="name"
                required
                placeholder="Priya Deshmukh"
                className="adm-input"
              />
            </div>

            <div>
              <label className="mb-1 block font-semibold text-zinc-700">Work Email</label>
              <input
                name="email"
                type="email"
                required
                placeholder="priya@rapidshiftlabs.in"
                className="adm-input"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Role</label>
                <select name="staffRole" defaultValue="support" className="adm-input">
                  <option value="super_admin">Super Admin</option>
                  <option value="finance">Finance &amp; Billing</option>
                  <option value="support">Customer Support</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">
                  Initial Password (min 8 chars)
                </label>
                <input
                  name="password"
                  type="text"
                  required
                  minLength={8}
                  placeholder="RslStaff#2026"
                  className="adm-input font-mono"
                />
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3 text-[11px] leading-relaxed text-zinc-600">
              {Object.entries(ROLE_LABELS).map(([key, info]) => (
                <div key={key} className="mb-1 last:mb-0">
                  <strong className="text-slate-900">{info.label}:</strong> {info.desc}
                </div>
              ))}
            </div>

            <SubmitButton className="adm-btn-primary w-full" pendingText="Creating Staff Account...">
              Add Staff Member
            </SubmitButton>
          </form>
        </SectionCard>

        {/* Staff Directory & Controls */}
        <SectionCard
          title={`Staff Accounts (${members.length})`}
          subtitle="Update roles, set a new password, or pause access immediately"
          noPadding
        >
          <div className="divide-y divide-zinc-100">
            {members.map((m) => {
              const roleMeta = ROLE_LABELS[m.staffRole] ?? ROLE_LABELS.support!;
              const isSelf = m.id === currentStaff.id;
              return (
                <div key={m.id} className="space-y-3 px-6 py-4 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{m.name}</span>
                        {isSelf && <StatusPill label="You" tone="emerald" />}
                        <StatusPill label={roleMeta.label} tone={roleMeta.tone} />
                        {!m.active && <StatusPill label="Disabled" tone="ruby" />}
                      </div>
                      <div className="mt-0.5 text-[11px] text-zinc-500">
                        {m.email} • Added{" "}
                        {new Date(m.createdAt).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}{" "}
                        • {m.activeSessionsCount} active session(s)
                      </div>
                    </div>

                    {/* Enable / Disable Toggle */}
                    <form action={staffUpdateStaffMemberAction}>
                      <input type="hidden" name="targetStaffId" value={m.id} />
                      <input type="hidden" name="active" value={m.active ? "false" : "true"} />
                      <SubmitButton
                        className={m.active ? "adm-btn-danger py-1.5 text-xs" : "adm-btn-primary py-1.5 text-xs"}
                        spinnerSize="xs"
                        pendingText="Updating..."
                      >
                        {m.active ? "Disable Login" : "Re-Enable Login"}
                      </SubmitButton>
                    </form>
                  </div>

                  {/* Role & Password Update Row */}
                  <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-zinc-200/70 bg-zinc-50/60 p-2.5">
                    <form
                      action={staffUpdateStaffMemberAction}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <input type="hidden" name="targetStaffId" value={m.id} />
                      <select
                        name="staffRole"
                        defaultValue={m.staffRole}
                        className="adm-input w-44 py-1.5 text-xs"
                      >
                        <option value="super_admin">Super Admin</option>
                        <option value="finance">Finance &amp; Billing</option>
                        <option value="support">Customer Support</option>
                      </select>
                      <SubmitButton
                        className="adm-btn-secondary py-1.5 text-xs"
                        spinnerSize="xs"
                        pendingText="Saving..."
                      >
                        Update Role
                      </SubmitButton>
                    </form>

                    <div className="hidden h-5 w-px bg-zinc-200 sm:block" />

                    <form
                      action={staffUpdateStaffMemberAction}
                      className="flex flex-1 flex-wrap items-center gap-2"
                    >
                      <input type="hidden" name="targetStaffId" value={m.id} />
                      <input
                        name="newPassword"
                        type="text"
                        required
                        minLength={8}
                        placeholder="New password (min 8 chars)"
                        className="adm-input min-w-[180px] flex-1 py-1.5 font-mono text-xs"
                      />
                      <SubmitButton
                        className="adm-btn-secondary py-1.5 text-xs"
                        spinnerSize="xs"
                        pendingText="Resetting..."
                      >
                        Reset Password
                      </SubmitButton>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
