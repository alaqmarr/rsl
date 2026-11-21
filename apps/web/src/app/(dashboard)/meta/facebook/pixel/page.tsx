import { canRoleAccessWebRoute, formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, PageHeader } from "@rsl/ui";
import { PixelConversionsWorkspace } from "@/components/campaigns-views";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink } from "@/components/ios-feedback";
import { MetaFacebookNav } from "@/components/suite-subnav";
import { loadCampaignsWorkspaceContext } from "@/lib/campaigns-data";
import { requireWebSession } from "@/lib/session";

export default async function MetaFacebookPixelPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/meta/facebook/pixel", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Website Pixel & Conversions API"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="Manage Meta Pixel & CAPI"
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
        title="Meta Pixel & Conversions API (CAPI)"
        subtitle="Send deduplicated SHA-256 hashed Purchase and Lead events from your checkout straight to Meta"
        actions={
          <ActionLink href="/settings/api-keys" className="rsl-btn-secondary">
            Issue Pixel API Key →
          </ActionLink>
        }
      />

      <MetaFacebookNav active="pixel" />
      <FlashBanner notice={sp.notice} error={sp.error} />

      <PixelConversionsWorkspace ctx={ctx} returnPath="/meta/facebook/pixel" />
    </div>
  );
}
