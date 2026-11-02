import Link from "next/link";
import { listWorkspaceTeam } from "@rsl/auth";
import { listRecentEmails } from "@rsl/notifications";
import { canRoleAccessWebRoute, canRolePerform, formatRoleLabel, SYSTEM_ROLES } from "@rsl/rbac";
import { AccessRestrictedState, PageHeader, SectionCard, StatusPill } from "@rsl/ui";
import { CopyTextButton } from "@/components/client-utils";
import { FlashBanner } from "@/components/flash-banner";
import { SubmitButton } from "@/components/ios-feedback";
import { SettingsNav } from "@/components/settings-nav";
import {
  inviteTeamMemberAction,
  removeTeamMemberAction,
  resendInvitationAction,
  revokeInvitationAction,
  updateTeamMemberRoleAction,
} from "@/lib/actions";
import { requireWebSession } from "@/lib/session";

function formatEmailStatus(
  transportMode: string,
  status: string
): {
  label: string;
  tone: "emerald" | "stone" | "ruby";
} {
  if (status === "failed") return { label: "Failed", tone: "ruby" };
  if (transportMode === "local_preview") return { label: "Saved in Preview", tone: "stone" };
  return { label: "Sent", tone: "emerald" };
}

export default async function TeamAndRolesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/settings/team", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Team Members & Role Permissions"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="Invite or manage team members"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  const team = listWorkspaceTeam(session.workspace.id);
  const emails = listRecentEmails(session.workspace.id, 15);
  const roleNameBySlug = new Map<string, string>(SYSTEM_ROLES.map((r) => [r.slug, r.name]));

  const canManageRoles = canRolePerform(session.roleSlug, "members:invite", session.workspace.id);
  const canRemoveMembers = canRolePerform(session.roleSlug, "members:remove", session.workspace.id);
  const assignableRoles =
    session.roleSlug === "owner"
      ? SYSTEM_ROLES
      : SYSTEM_ROLES.filter((r) => r.slug !== "owner");

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Settings & Account"
        title="Team Members & Role Permissions"
        subtitle="Invite colleagues with role-scoped access to Shared Inbox, Tally Prime sync, campaigns, or billing."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/settings/profile" className="rsl-btn-secondary">
              My Profile
            </Link>
            <Link href="/settings/business" className="rsl-btn-secondary">
              Business &amp; GST Settings
            </Link>
          </div>
        }
      />

      <SettingsNav />

      <FlashBanner notice={sp.notice} error={sp.error} />

      {sp.inviteLink && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/85 p-4 text-[13px] text-emerald-950 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">
              Direct Team Invitation Link (Share on WhatsApp or Email):
            </div>
            <CopyTextButton
              text={sp.inviteLink}
              label="Copy Invite Link"
              copiedLabel="Copied Link"
            />
          </div>
          <div className="mt-2 select-all break-all rounded-lg border border-emerald-200 bg-white px-3.5 py-2 font-mono text-xs font-semibold text-slate-900">
            {sp.inviteLink}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-6">
          <SectionCard
            title="Invite a Team Member"
            subtitle="Choose what they can access and send an email invitation (or set a starting password)"
          >
            {!canManageRoles ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-[13px] text-amber-950">
                Only the Business Owner or an Admin can invite new colleagues or change team roles.
              </div>
            ) : (
              <form action={inviteTeamMemberAction} className="space-y-3.5 text-[13px]">
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <div>
                    <label className="rsl-label">Full Name</label>
                    <input name="name" placeholder="Staff member name" className="rsl-input" />
                  </div>
                  <div>
                    <label className="rsl-label">Work Email *</label>
                    <input
                      name="email"
                      type="email"
                      required
                      placeholder="staff@company.com"
                      className="rsl-input"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <div>
                    <label className="rsl-label">Access Role</label>
                    <select name="roleSlug" defaultValue="agent" className="rsl-input">
                      {assignableRoles.map((r) => (
                        <option key={r.slug} value={r.slug}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="rsl-label">Starting Password (Optional)</label>
                    <input
                      name="initialPassword"
                      type="password"
                      placeholder="8+ chars (or leave blank for invite link)"
                      className="rsl-input"
                    />
                  </div>
                </div>
                <SubmitButton className="rsl-btn-primary" pendingText="Sending Invite...">
                  Add Team Member
                </SubmitButton>
              </form>
            )}
          </SectionCard>
        </div>

        <div className="min-w-0 xl:col-span-6">
          <SectionCard
            title="Role Access Guide"
            subtitle="Assign least-privilege roles based on each colleague's daily responsibilities"
          >
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 text-xs">
              {SYSTEM_ROLES.map((role) => (
                <div
                  key={role.slug}
                  className="rounded-xl border border-zinc-200/85 bg-zinc-50/60 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900">{role.name}</span>
                    <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-500 uppercase ring-1 ring-zinc-200">
                      {role.slug}
                    </span>
                  </div>
                  <p className="mt-1 leading-relaxed text-zinc-600">{role.description}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>

      {/* Full-width Team Members & Pending Invitations Table */}
      <SectionCard
        title={`Active Team Members (${team.members.length})`}
        subtitle="Update roles or revoke access when a colleague changes responsibilities"
        noPadding
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-zinc-200/80 bg-zinc-50/75 text-[11px] tracking-wider text-zinc-500 uppercase">
              <tr>
                <th className="px-5 py-3 font-semibold sm:px-6">Name</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">Current Role</th>
                <th className="px-5 py-3 text-right font-semibold sm:px-6">Manage Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {team.members.map((m) => {
                const isPrimaryOwner = m.userId === session.workspace.ownerUserId;
                return (
                  <tr key={m.membershipId}>
                    <td className="px-5 py-3.5 font-semibold text-slate-900 sm:px-6">
                      <div className="flex items-center gap-2">
                        <span>{m.name}</span>
                        {isPrimaryOwner && (
                          <StatusPill label="Primary Owner" tone="emerald" showDot={false} />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-zinc-600">{m.email}</td>
                    <td className="px-4 py-3.5">
                      <StatusPill
                        label={roleNameBySlug.get(m.roleSlug) ?? m.roleSlug}
                        tone="emerald"
                      />
                    </td>
                    <td className="px-5 py-3.5 text-right sm:px-6">
                      {isPrimaryOwner ? (
                        <span className="text-xs text-zinc-400">Protected Account Owner</span>
                      ) : (
                        <div className="inline-flex flex-wrap items-center justify-end gap-2">
                          {canManageRoles && (
                            <form
                              action={updateTeamMemberRoleAction}
                              className="inline-flex items-center gap-1.5"
                            >
                              <input type="hidden" name="membershipId" value={m.membershipId} />
                              <select
                                name="roleSlug"
                                defaultValue={m.roleSlug}
                                aria-label={`Role for ${m.name}`}
                                className="rsl-input w-auto py-1.5 text-xs"
                              >
                                {assignableRoles.map((r) => (
                                  <option key={r.slug} value={r.slug}>
                                    {r.name}
                                  </option>
                                ))}
                              </select>
                              <SubmitButton
                                spinnerSize="xs"
                                pendingText="Saving..."
                                className="rsl-btn-secondary py-1.5 text-xs"
                              >
                                Update Role
                              </SubmitButton>
                            </form>
                          )}
                          {canRemoveMembers && (
                            <form action={removeTeamMemberAction} className="inline">
                              <input type="hidden" name="membershipId" value={m.membershipId} />
                              <SubmitButton
                                spinnerSize="xs"
                                pendingText="Removing..."
                                className="rsl-btn-danger-soft py-1.5 text-xs"
                              >
                                Remove
                              </SubmitButton>
                            </form>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {team.invites.length > 0 && (
          <div className="border-t border-zinc-200/80 bg-zinc-50/50 px-5 py-4 sm:px-6">
            <div className="mb-2.5 text-xs font-semibold text-slate-900">
              Pending Email Invitations ({team.invites.length})
            </div>
            <ul className="divide-y divide-zinc-200/60 text-xs">
              {team.invites.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <span className="font-semibold text-slate-900">{inv.email}</span>
                    <span className="ml-2 text-zinc-500">
                      • Role: {roleNameBySlug.get(inv.roleSlug) ?? inv.roleSlug}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {canManageRoles && (
                      <form action={resendInvitationAction}>
                        <input type="hidden" name="invitationId" value={inv.id} />
                        <SubmitButton
                          spinnerSize="xs"
                          pendingText="Resending..."
                          className="rsl-btn-secondary py-1 text-[11px]"
                        >
                          Resend Link
                        </SubmitButton>
                      </form>
                    )}
                    {canRemoveMembers && (
                      <form action={revokeInvitationAction}>
                        <input type="hidden" name="invitationId" value={inv.id} />
                        <SubmitButton
                          spinnerSize="xs"
                          pendingText="Cancelling..."
                          className="rsl-btn-danger-soft py-1 text-[11px]"
                        >
                          Cancel Invite
                        </SubmitButton>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title={`Recent Account Emails (${emails.length})`}
        subtitle="Team invitations, verification codes, and billing notifications sent for this business"
        noPadding
      >
        {emails.length === 0 ? (
          <div className="p-6 text-[13px] text-zinc-500">
            No emails sent for this business yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-zinc-200/80 bg-zinc-50/75 text-[11px] tracking-wider text-zinc-500 uppercase">
                <tr>
                  <th className="px-5 py-3 font-semibold sm:px-6">Subject</th>
                  <th className="px-4 py-3 font-semibold">Sent To</th>
                  <th className="px-5 py-3 font-semibold sm:px-6">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {emails.map((em) => {
                  const badge = formatEmailStatus(em.transportMode, em.status);
                  return (
                    <tr key={em.id}>
                      <td className="px-5 py-3.5 font-semibold text-slate-900 sm:px-6">
                        {em.subject}
                      </td>
                      <td className="px-4 py-3.5 text-zinc-600">{em.recipientEmail}</td>
                      <td className="px-5 py-3.5 sm:px-6">
                        <StatusPill label={badge.label} tone={badge.tone} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
