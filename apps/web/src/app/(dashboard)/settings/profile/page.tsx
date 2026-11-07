import { listUserActiveSessions, listUserPasskeys } from "@rsl/auth";
import { listUserWebPushSubscriptions } from "@rsl/notifications";
import { SYSTEM_ROLES } from "@rsl/rbac";
import { PageHeader } from "@rsl/ui";
import { FlashBanner } from "@/components/flash-banner";
import { ProfileSettingsClient } from "@/components/profile-settings-client";
import { SettingsNav } from "@/components/settings-nav";
import { requireWebSession } from "@/lib/session";

export default async function ClientProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;
  const activeSessions = listUserActiveSessions(session.user.id, session.sessionId);
  const passkeys = listUserPasskeys(session.user.id);
  const pushSubscriptions = listUserWebPushSubscriptions(session.user.id, session.workspace.id);
  const currentRoleLabel =
    SYSTEM_ROLES.find((r) => r.slug === session.roleSlug)?.name ?? session.roleSlug;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Settings & Account"
        title="My Profile & Account Security"
        subtitle="Manage your personal identity, work email verification, account password, active device sessions, and linked business workspaces."
      />

      <SettingsNav />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <ProfileSettingsClient
        user={{
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          phone: session.user.phone,
          jobTitle: session.user.jobTitle,
          emailVerified: session.user.emailVerified,
          createdAt: session.user.createdAt,
        }}
        currentRoleLabel={currentRoleLabel}
        activeWorkspaceId={session.workspace.id}
        workspaces={session.workspaces.map((w) => ({
          id: w.id,
          name: w.name,
          slug: w.slug,
          roleSlug: w.roleSlug,
          billingStatus: w.billingStatus,
        }))}
        sessions={activeSessions}
        passkeys={passkeys}
        pushSubscriptions={pushSubscriptions}
      />
    </div>
  );
}
