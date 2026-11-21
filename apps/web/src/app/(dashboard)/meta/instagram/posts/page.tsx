import { canRoleAccessWebRoute, formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, PageHeader } from "@rsl/ui";
import { SocialPostsWorkspaceCard } from "@/components/campaigns-views";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink } from "@/components/ios-feedback";
import { MetaInstagramNav } from "@/components/suite-subnav";
import { loadCampaignsWorkspaceContext } from "@/lib/campaigns-data";
import { requireWebSession } from "@/lib/session";

export default async function MetaInstagramPostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/meta/instagram/posts", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Instagram Posts & Reels"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="Manage Instagram Posts & Reels"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  const ctx = await loadCampaignsWorkspaceContext(session.workspace.id, session.roleSlug);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Meta -> Instagram"
        title="Instagram Posts & Reels"
        subtitle="Schedule and publish Photos and MP4 Reels to your connected Instagram Business profile"
        actions={
          <ActionLink href="/connections/instagram" className="rsl-btn-secondary">
            {ctx.igConn ? "Manage Instagram Account" : "Connect Instagram"}
          </ActionLink>
        }
      />

      <MetaInstagramNav active="posts" />
      <FlashBanner notice={sp.notice} error={sp.error} />

      <SocialPostsWorkspaceCard ctx={ctx} scope="instagram" returnPath="/meta/instagram/posts" />
    </div>
  );
}
