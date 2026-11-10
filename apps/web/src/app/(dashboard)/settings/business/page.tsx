import { headers } from "next/headers";
import { INDIA_GST_STATES } from "@rsl/billing";
import { resolveEndpointsFromHeaders } from "@rsl/core";
import { canRoleAccessWebRoute, canRolePerform, formatRoleLabel } from "@rsl/rbac";
import {
  getWorkspaceConfidentialityPolicy,
  isConfidentialityUnmaskActive,
  shouldMaskWorkspacePortalData,
} from "@rsl/tally";
import { listWorkspaceSslCertificates } from "@rsl/tenancy";
import { AccessRestrictedState, PageHeader } from "@rsl/ui";
import { BusinessSettingsClient } from "@/components/business-settings-client";
import { ConfidentialityVaultCard } from "@/components/confidentiality-vault-card";
import { FlashBanner } from "@/components/flash-banner";
import { SettingsNav } from "@/components/settings-nav";
import { requireWebSession } from "@/lib/session";

const GST_STATE_OPTIONS = Object.entries(INDIA_GST_STATES).sort(([a], [b]) =>
  a.localeCompare(b)
) as Array<[string, string]>;

export default async function BusinessSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/settings/business", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Business Settings & GST Configuration"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="Edit business profile or view billing details"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  const hdrs = await headers();
  const endpoints = resolveEndpointsFromHeaders(hdrs, {
    workspaceSlug: session.workspace.slug,
  });
  const sslCerts = listWorkspaceSslCertificates(session.workspace.id);

  const canEditBusiness = canRolePerform(
    session.roleSlug,
    "workspace:manage",
    session.workspace.id
  );
  const canProvisionSsl =
    canEditBusiness ||
    canRolePerform(session.roleSlug, "tally:sync.manage", session.workspace.id) ||
    canRolePerform(session.roleSlug, "apikeys:manage", session.workspace.id);
  const canAccessBilling = canRoleAccessWebRoute(
    session.roleSlug,
    "/billing",
    session.workspace.id
  );
  const canAccessTokens = canRoleAccessWebRoute(
    session.roleSlug,
    "/settings/tokens",
    session.workspace.id
  );
  const canManageConfidentiality = canRolePerform(
    session.roleSlug,
    "workspace:manage",
    session.workspace.id
  );
  const confidentialityPolicy = getWorkspaceConfidentialityPolicy(session.workspace.id);
  const unmaskStatus = isConfidentialityUnmaskActive(session.workspace.id, session.user.id);
  const isMaskedInPortal = shouldMaskWorkspacePortalData(session.workspace.id, {
    userId: session.user.id,
    unmaskSessionActive: unmaskStatus.active,
    policy: confidentialityPolicy,
  });

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Settings & Account"
        title="Business Settings, Client Domains & GST Configuration"
        subtitle="Manage your legal business name, registered billing address, 15-character GSTIN, dedicated *.tally.rapidshiftlabs.in & *.api.rapidshiftlabs.in SSL subdomains, and multi-business workspaces."
      />

      <SettingsNav />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <ConfidentialityVaultCard
        initialPolicy={confidentialityPolicy}
        isMasked={isMaskedInPortal}
        unmaskActive={unmaskStatus.active}
        unmaskExpiresAt={unmaskStatus.expiresAt}
        canManageSettings={canManageConfidentiality}
      />

      <BusinessSettingsClient
        workspace={{
          id: session.workspace.id,
          name: session.workspace.name,
          slug: session.workspace.slug,
          industry: session.workspace.industry,
          businessPhone: session.workspace.businessPhone,
          billingEmail: session.workspace.billingEmail,
          website: session.workspace.website,
          addressLine: session.workspace.addressLine,
          city: session.workspace.city,
          pincode: session.workspace.pincode,
          defaultTallyCompany: session.workspace.defaultTallyCompany,
          stateCode: session.workspace.stateCode,
          gstin: session.workspace.gstin,
          upiVpa: session.workspace.upiVpa,
          upiPayeeName: session.workspace.upiPayeeName,
          bankName: session.workspace.bankName,
          bankBranch: session.workspace.bankBranch,
          bankAccountNumber: session.workspace.bankAccountNumber,
          bankIfsc: session.workspace.bankIfsc,
          timezone: session.workspace.timezone,
          billingStatus: session.workspace.billingStatus,
          createdAt: session.workspace.createdAt,
        }}
        gstStates={GST_STATE_OPTIONS}
        canEditBusiness={canEditBusiness}
        isOwner={session.roleSlug === "owner" && !session.impersonatorStaffId}
        canProvisionSsl={canProvisionSsl}
        canAccessBilling={canAccessBilling}
        canAccessTokens={canAccessTokens}
        clientSubdomains={{
          tallyHost:
            endpoints.clientTallySubdomainHost ||
            `${session.workspace.slug}.tally.rapidshiftlabs.in`,
          apiHost:
            endpoints.clientApiSubdomainHost ||
            `${session.workspace.slug}.api.rapidshiftlabs.in`,
          tallyWebhookUrl: endpoints.tallyWebhookUrl,
          apiBaseUrl: endpoints.apiCloudBaseUrl,
          certificates: sslCerts.map((c) => ({
            zone: c.zone,
            hostname: c.hostname,
            status: c.status,
            provider: c.provider,
            coverageMode: c.coverageMode,
            expiresAt: c.expiresAt,
          })),
        }}
        workspaces={session.workspaces.map((w) => ({
          id: w.id,
          name: w.name,
          slug: w.slug,
          roleSlug: w.roleSlug,
          billingStatus: w.billingStatus,
        }))}
      />
    </div>
  );
}
