import { canRoleAccessWebRoute, formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, PageHeader } from "@rsl/ui";
import { SocialPostsWorkspaceCard } from "@/components/campaigns-views";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink } from "@/components/ios-feedback";
import { MetaFacebookNav } from "@/components/suite-subnav";
import { loadCampaignsWorkspaceContext } from "@/lib/campaigns-data";
import { requireWebSession } from "@/lib/session";

export default async function MetaFacebookPostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/meta/facebook/posts", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Facebook Page Posts"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="Manage Facebook Page Posts"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  const ctx = await loadCampaignsWorkspaceContext(session.workspace.id, session.roleSlug);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Meta -> Facebook"
        title="Facebook Page Posts & Offers"
        subtitle="Schedule updates, showroom announcements, and CTA posts to your connected Facebook Page"
        actions={
          <ActionLink href="/connections/facebook" className="rsl-btn-secondary">
            {ctx.fbPageConn ? "Manage Facebook Page" : "Connect Facebook Page"}
          </ActionLink>
        }
      />

      <MetaFacebookNav active="posts" />
      <FlashBanner notice={sp.notice} error={sp.error} />

      <SocialPostsWorkspaceCard ctx={ctx} scope="facebook" returnPath="/meta/facebook/posts" />
    </div>
  );
}
