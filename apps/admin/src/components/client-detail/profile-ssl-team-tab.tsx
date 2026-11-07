import { INDIA_GST_STATES } from "@rsl/billing";
import { SectionCard, StatusPill } from "@rsl/ui";
import { SubmitButton } from "@/components/ios-feedback";
import {
  staffProvisionClientSslAction,
  staffResetClientPasswordAction,
  staffToggleManualCredentialsAction,
  staffUpdateClientProfileAction,
  staffVerifyClientEmailAction,
} from "@/lib/actions";

function formatRoleLabel(roleSlug: string): string {
  const normalized = roleSlug.trim().toLowerCase();
  const labels: Record<string, string> = {
    owner: "Business Owner",
    admin: "Workspace Admin",
    manager: "Team Manager",
    agent: "Support Executive",
    support: "Support Executive",
    analyst: "Analyst",
    billing: "Finance & Billing",
    member: "Team Member",
    viewer: "Read-Only Viewer",
  };
  if (labels[normalized]) return labels[normalized];
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export interface ClientSslCertInfo {
  zone: string;
  status: string;
  wildcardParent: string | null;
  coverageMode: string | null;
  expiresAt: number | null;
  lastError: string | null;
}

export interface ClientTeamMemberInfo {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  roleSlug: string;
  emailVerified: boolean;
}

export function ClientProfileSslTeamTab({
  workspace,
  isPaused,
  canManageClients,
  canProvisionSsl,
  clientEndpoints,
  sslCerts,
  teamMembers,
}: {
  workspace: {
    id: string;
    name: string;
    slug: string;
    industry: string | null;
    stateCode: string;
    gstin: string | null;
    allowManualCredentials?: boolean;
  };
  isPaused: boolean;
  canManageClients: boolean;
  canProvisionSsl: boolean;
  clientEndpoints: {
    tallyWildcardPattern: string;
    apiWildcardPattern: string;
    clientTallySubdomainHost: string;
    clientApiSubdomainHost: string;
  };
  sslCerts: ClientSslCertInfo[];
  teamMembers: ClientTeamMemberInfo[];
}) {
  const returnToProfile = `/clients/${workspace.id}?tab=profile`;
  const manualEnabled = Boolean(workspace.allowManualCredentials);

  return (
    <div className="space-y-6">
      <SectionCard
        title="Connection Suite Policy — Manual API Credential Entry"
        subtitle="By default, clients only see clean 1-click Facebook & Google sign-in buttons. Enable manual credential entry only when a specific client requires custom System User Tokens or support-assisted manual overrides."
        action={
          <StatusPill
            label={
              manualEnabled
                ? "Manual Credentials Enabled"
                : "1-Click Sign-In Only (Default)"
            }
            tone={manualEnabled ? "amber" : "emerald"}
          />
        }
      >
        <div className="flex flex-col justify-between gap-4 rounded-xl border border-zinc-200/90 bg-zinc-50/70 p-4 sm:flex-row sm:items-center">
          <div className="space-y-1 text-xs">
            <div className="font-bold text-slate-900">
              {manualEnabled
                ? "Support Manual Credential Override is ACTIVE for this client"
                : "Strict 1-Click OAuth Mode is ACTIVE for this client"}
            </div>
            <p className="max-w-2xl leading-relaxed text-zinc-600">
              {manualEnabled
                ? "This client can currently view the collapsible 'Manual API Credentials Override' section on Connected Channels & API Tokens and submit custom access tokens."
                : "All raw token forms, webhook callback URLs, and manual credential inputs are hidden and blocked on the server for this client."}
            </p>
          </div>
          {canProvisionSsl && (
            <form action={staffToggleManualCredentialsAction} className="shrink-0">
              <input type="hidden" name="workspaceId" value={workspace.id} />
              <input
                type="hidden"
                name="enabled"
                value={manualEnabled ? "false" : "true"}
              />
              <input type="hidden" name="returnTo" value={returnToProfile} />
              <SubmitButton
                className={
                  manualEnabled
                    ? "adm-btn-secondary text-xs"
                    : "adm-btn-dark text-xs"
                }
                spinnerSize="xs"
                pendingText="Updating Policy..."
              >
                {manualEnabled
                  ? "Disable Manual Credentials (1-Click Only)"
                  : "Enable Manual Credentials for Client"}
              </SubmitButton>
            </form>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Client Wildcard Subdomains & Queued SSL Certificates"
        subtitle={`Dedicated HTTPS ingress endpoints under ${clientEndpoints.tallyWildcardPattern} and ${clientEndpoints.apiWildcardPattern} managed automatically through the backend SSL queue`}
        action={
          canProvisionSsl ? (
            <form action={staffProvisionClientSslAction}>
              <input type="hidden" name="workspaceId" value={workspace.id} />
              <input type="hidden" name="returnTo" value={returnToProfile} />
              <SubmitButton
                className="adm-btn-secondary py-1.5 text-xs"
                spinnerSize="xs"
                pendingText="Verifying SSL..."
              >
                Verify / Re-Queue SSL Certificates
              </SubmitButton>
            </form>
          ) : undefined
        }
      >
        <div className="grid grid-cols-1 gap-4 text-xs lg:grid-cols-2">
          {[
            {
              zone: "tally" as const,
              title: "Tally Prime Webhook Subdomain",
              sampleUrl: `https://${clientEndpoints.clientTallySubdomainHost}/api/webhooks/tally`,
            },
            {
              zone: "api" as const,
              title: "Developer & Webhook API Subdomain",
              sampleUrl: `https://${clientEndpoints.clientApiSubdomainHost}/api/v1`,
            },
          ].map((endpoint) => {
            const cert = sslCerts.find((c) => c.zone === endpoint.zone);
            const status = cert?.status ?? "queued";
            return (
              <div
                key={endpoint.zone}
                className="space-y-2 rounded-xl border border-zinc-200/90 bg-zinc-50/70 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-900">{endpoint.title}</span>
                  <StatusPill
                    label={
                      status === "active"
                        ? "HTTPS Active"
                        : status === "failed"
                          ? "Provision Failed"
                          : "Queued in SSL Worker"
                    }
                    tone={
                      status === "active"
                        ? "emerald"
                        : status === "failed"
                          ? "ruby"
                          : "amber"
                    }
                  />
                </div>
                <div className="font-mono text-[11.5px] font-semibold text-slate-900 break-all">
                  {endpoint.sampleUrl}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                  <span>
                    Wildcard:{" "}
                    <strong className="font-mono text-slate-700">
                      {cert?.wildcardParent ?? `*.${endpoint.zone}.rapidshiftlabs.in`}
                    </strong>
                  </span>
                  <span>
                    Mode:{" "}
                    <strong className="text-slate-700">
                      {cert?.coverageMode === "dedicated_acme"
                        ? "Dedicated ACME TLS"
                        : "Wildcard SAN TLS"}
                    </strong>
                  </span>
                  {cert?.expiresAt && (
                    <span>
                      Valid until{" "}
                      <strong className="text-slate-700 tabular-nums">
                        {new Date(cert.expiresAt).toLocaleDateString("en-IN")}
                      </strong>
                    </span>
                  )}
                </div>
                {cert?.lastError && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700">
                    {cert.lastError}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1.25fr]">
        <SectionCard
          title="Client Business & GST Details"
          subtitle={
            canManageClients
              ? "Changes apply immediately to future GST tax invoices and account status"
              : "Read-only client business profile"
          }
        >
          {canManageClients ? (
            <form action={staffUpdateClientProfileAction} className="space-y-3.5 text-xs">
              <input type="hidden" name="workspaceId" value={workspace.id} />
              <input type="hidden" name="returnTo" value={returnToProfile} />
              <div>
                <label htmlFor="prof-biz-name" className="mb-1 block font-semibold text-slate-800">
                  Business Name *
                </label>
                <input
                  id="prof-biz-name"
                  name="name"
                  required
                  defaultValue={workspace.name}
                  className="adm-input"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="prof-industry" className="mb-1 block font-semibold text-slate-800">
                    Industry
                  </label>
                  <input
                    id="prof-industry"
                    name="industry"
                    defaultValue={workspace.industry ?? ""}
                    placeholder="Retail / Wholesale / Services"
                    className="adm-input"
                  />
                </div>
                <div>
                  <label htmlFor="prof-state" className="mb-1 block font-semibold text-slate-800">
                    Billing State (for GST)
                  </label>
                  <select
                    id="prof-state"
                    name="stateCode"
                    defaultValue={workspace.stateCode || "27"}
                    className="adm-input"
                  >
                    {Object.entries(INDIA_GST_STATES)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([code, stateName]) => (
                        <option key={code} value={code}>
                          {code} — {stateName}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="prof-gstin" className="mb-1 block font-semibold text-slate-800">
                    GSTIN
                  </label>
                  <input
                    id="prof-gstin"
                    name="gstin"
                    defaultValue={workspace.gstin ?? ""}
                    placeholder="27AAAAA0000A1Z5"
                    className="adm-input font-mono uppercase"
                  />
                </div>
                <div>
                  <label htmlFor="prof-status" className="mb-1 block font-semibold text-slate-800">
                    Account Status
                  </label>
                  <select
                    id="prof-status"
                    name="billingStatus"
                    defaultValue={isPaused ? "suspended" : "active"}
                    className="adm-input"
                  >
                    <option value="active">Active</option>
                    <option value="suspended">Paused / Suspended</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end pt-1">
                <SubmitButton className="adm-btn-primary" pendingText="Saving...">
                  Save Business Profile
                </SubmitButton>
              </div>
            </form>
          ) : (
            <div className="space-y-2.5 text-xs text-zinc-700">
              <div>
                <span className="text-zinc-500">Business Name:</span>{" "}
                <strong className="text-slate-900">{workspace.name}</strong>
              </div>
              <div>
                <span className="text-zinc-500">Workspace Slug:</span>{" "}
                <strong className="font-mono text-slate-900">{workspace.slug}</strong>
              </div>
              <div>
                <span className="text-zinc-500">Industry:</span>{" "}
                <strong className="text-slate-900">{workspace.industry || "Not specified"}</strong>
              </div>
              <div>
                <span className="text-zinc-500">Billing State:</span>{" "}
                <strong className="text-slate-900">{workspace.stateCode || "27"}</strong>
              </div>
              <div>
                <span className="text-zinc-500">GSTIN:</span>{" "}
                <strong className="font-mono text-slate-900">
                  {workspace.gstin || "Unregistered"}
                </strong>
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title={`Client Team Logins (${teamMembers.length})`}
          subtitle={
            canManageClients
              ? "Reset a client user's password (minimum 8 characters) or verify their email address directly during a support call"
              : "Read-only team member directory for this client"
          }
          noPadding
        >
          <div className="divide-y divide-zinc-100">
            {teamMembers.map((m) => (
              <div key={m.membershipId} className="space-y-3 p-5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-bold text-slate-900">{m.name}</div>
                    <div className="text-zinc-500">
                      {m.email} • Role: <strong>{formatRoleLabel(m.roleSlug)}</strong>
                    </div>
                  </div>
                  <StatusPill
                    label={m.emailVerified ? "Email Verified" : "Unverified"}
                    tone={m.emailVerified ? "emerald" : "amber"}
                  />
                </div>

                {canManageClients && (
                  <div className="flex flex-wrap items-center gap-2">
                    <form
                      action={staffResetClientPasswordAction}
                      className="flex flex-1 flex-wrap items-center gap-2"
                    >
                      <input type="hidden" name="workspaceId" value={workspace.id} />
                      <input type="hidden" name="userId" value={m.userId} />
                      <input type="hidden" name="returnTo" value={returnToProfile} />
                      <input
                        name="newPassword"
                        type="text"
                        required
                        minLength={8}
                        aria-label={`New password for ${m.email}`}
                        placeholder="Set new password (min 8 chars)"
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

                    {!m.emailVerified && (
                      <form action={staffVerifyClientEmailAction}>
                        <input type="hidden" name="workspaceId" value={workspace.id} />
                        <input type="hidden" name="userId" value={m.userId} />
                        <input type="hidden" name="returnTo" value={returnToProfile} />
                        <SubmitButton
                          className="adm-btn-primary py-1.5 text-xs"
                          spinnerSize="xs"
                          pendingText="Verifying..."
                        >
                          Verify Email
                        </SubmitButton>
                      </form>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
