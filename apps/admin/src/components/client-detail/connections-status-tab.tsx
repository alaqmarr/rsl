import { CheckCircle2, HardDrive, Play, PlugZap, Radio, Webhook } from "lucide-react";
import type { StaffClientIntegrationSnapshot } from "@rsl/tenancy";
import { SectionCard, StatusPill } from "@rsl/ui";
import { SubmitButton } from "@/components/ios-feedback";
import {
  staffTestAllClientConnectionsAction,
  staffTestClientConnectionAction,
  staffTestClientStorageVaultAction,
} from "@/lib/actions";

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, idx);
  return `${val >= 10 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

function formatProviderLabel(provider: string, channelKind: string): string {
  const kindMap: Record<string, string> = {
    whatsapp: "WhatsApp Cloud (WABA)",
    facebook_page: "Facebook Page",
    instagram: "Instagram Business",
    meta_ads: "Meta Ads Account",
    gbp: "Google Business Profile",
    google_ads: "Google Ads",
    gdrive: "Google Drive",
    google_sheets: "Google Sheets",
    google_search_console: "Google Search Console",
  };
  if (kindMap[channelKind]) return kindMap[channelKind];
  if (kindMap[provider]) return kindMap[provider];
  return `${provider} (${channelKind})`;
}

function connectionTone(status: string): "emerald" | "amber" | "ruby" | "stone" {
  if (status === "healthy") return "emerald";
  if (status === "expiring") return "amber";
  if (status === "needs_reauth") return "ruby";
  return "stone";
}

function connectionStatusLabel(status: string): string {
  if (status === "healthy") return "Healthy";
  if (status === "expiring") return "Expiring Soon";
  if (status === "needs_reauth") return "Needs Re-Auth";
  return status || "Unknown";
}

export function ClientConnectionsStatusTab({
  workspaceId,
  workspaceName,
  canTestIntegrations,
  snapshot,
}: {
  workspaceId: string;
  workspaceName: string;
  canTestIntegrations: boolean;
  snapshot: StaffClientIntegrationSnapshot;
}) {
  const returnTo = `/clients/${workspaceId}?tab=connections`;
  const healthyConns = snapshot.connections.filter((c) => c.status === "healthy").length;

  return (
    <div className="space-y-6">
      {/* Top Action & Summary Card */}
      <SectionCard
        title={`Live Integration & Credential Diagnostics for ${workspaceName}`}
        subtitle="Verify live OAuth tokens against Meta Graph and Google OAuth2 APIs, validate Cloud Storage Vault write/delete health, and inspect Tally Prime bridge heartbeats."
        action={
          canTestIntegrations ? (
            <form action={staffTestAllClientConnectionsAction}>
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <SubmitButton
                className="adm-btn-primary text-xs"
                spinnerSize="xs"
                pendingText="Testing All Channels & Storage..."
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Test All Client Channels &amp; Storage</span>
              </SubmitButton>
            </form>
          ) : (
            <StatusPill label="Read-Only View" tone="stone" />
          )
        }
      >
        <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3.5">
            <div className="flex items-center justify-between text-zinc-500">
              <span className="font-semibold">Connected Channels</span>
              <PlugZap className="h-3.5 w-3.5 text-indigo-600" />
            </div>
            <div className="mt-1.5 text-lg font-bold text-slate-900 tabular-nums">
              {healthyConns} / {snapshot.connections.length} Healthy
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500">
              {snapshot.connections.length === 0
                ? "No Meta or Google accounts linked yet"
                : `${snapshot.connections.length - healthyConns} channel(s) need attention`}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3.5">
            <div className="flex items-center justify-between text-zinc-500">
              <span className="font-semibold">Cloud Storage Vault</span>
              <HardDrive className="h-3.5 w-3.5 text-emerald-600" />
            </div>
            <div className="mt-1.5 text-lg font-bold text-slate-900">
              {snapshot.storage ? snapshot.storage.displayLabel : "RSL Managed Vault"}
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500">
              {snapshot.storage
                ? `${formatBytes(snapshot.storage.usedBytes)} across ${snapshot.storage.objectCount} file(s)`
                : "Default local/R2 encrypted storage active"}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3.5">
            <div className="flex items-center justify-between text-zinc-500">
              <span className="font-semibold">Tally Desktop Agents</span>
              <Radio className="h-3.5 w-3.5 text-sky-600" />
            </div>
            <div className="mt-1.5 text-lg font-bold text-slate-900 tabular-nums">
              {snapshot.tallyAgents.filter((a) => a.tallyReachable).length} /{" "}
              {snapshot.tallyAgents.length} Online
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500">
              {snapshot.tallyAgents[0]?.activeCompanyName
                ? `Active: ${snapshot.tallyAgents[0].activeCompanyName}`
                : "No desktop Tally bridge paired yet"}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3.5">
            <div className="flex items-center justify-between text-zinc-500">
              <span className="font-semibold">Webhook &amp; API Keys</span>
              <Webhook className="h-3.5 w-3.5 text-amber-600" />
            </div>
            <div className="mt-1.5 text-lg font-bold text-slate-900 tabular-nums">
              {snapshot.activeApiKeysCount} Active Key(s)
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500">
              {snapshot.tallyWebhook
                ? `Tally Webhook: ${snapshot.tallyWebhook.eventsReceivedCount} event(s)`
                : "Tally instant webhook not initialized yet"}
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Connected OAuth / API Channels Table */}
      <SectionCard
        title={`Connected OAuth & API Channels (${snapshot.connections.length})`}
        subtitle="Click 'Test Live API' on any channel to decrypt its vault token, auto-refresh expired Google tokens if needed, and verify live access against Meta Graph or Google OAuth2."
        noPadding={snapshot.connections.length > 0}
      >
        {snapshot.connections.length === 0 ? (
          <p className="text-xs text-zinc-500">
            This client has not connected any Meta, WhatsApp, or Google channels yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-200 bg-zinc-50/90 text-[11px] font-bold tracking-wide text-zinc-500 uppercase">
                <tr>
                  <th className="px-4 py-2.5">Channel / Provider</th>
                  <th className="px-4 py-2.5">Account Name &amp; ID</th>
                  <th className="px-4 py-2.5">Token &amp; Expiry</th>
                  <th className="px-4 py-2.5">Live Status</th>
                  <th className="px-4 py-2.5">Latest Verification Result</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white">
                {snapshot.connections.map((conn) => (
                  <tr key={conn.id} className="hover:bg-zinc-50/60">
                    <td className="px-4 py-3 align-top">
                      <div className="font-semibold text-slate-900">
                        {formatProviderLabel(conn.provider, conn.channelKind)}
                      </div>
                      <div className="font-mono text-[10.5px] text-zinc-500">
                        {conn.provider} / {conn.channelKind}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-semibold text-slate-800">{conn.displayName}</div>
                      <div className="font-mono text-[11px] text-zinc-500">
                        ID: {conn.externalAccountId}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-mono text-[11px] text-zinc-600">
                        {conn.maskedTokenHint}
                      </div>
                      <div className="mt-0.5 text-[10.5px] text-zinc-500">
                        {conn.expiresAt
                          ? `Expires ${new Date(conn.expiresAt).toLocaleDateString("en-IN")}`
                          : "Long-lived / Non-expiring"}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <StatusPill
                        label={connectionStatusLabel(conn.status)}
                        tone={connectionTone(conn.status)}
                      />
                      <div className="mt-1 text-[10.5px] text-zinc-400 tabular-nums">
                        {conn.lastHealthCheckAt
                          ? `Checked ${new Date(conn.lastHealthCheckAt).toLocaleString("en-IN")}`
                          : "Not tested yet"}
                      </div>
                    </td>
                    <td className="max-w-xs px-4 py-3 align-top text-[11.5px] text-zinc-700">
                      {conn.lastLiveCheckMessage ||
                        "Click 'Test Live API' to verify token live against provider endpoint."}
                    </td>
                    <td className="px-4 py-3 text-right align-top">
                      {canTestIntegrations && (
                        <form action={staffTestClientConnectionAction}>
                          <input type="hidden" name="workspaceId" value={workspaceId} />
                          <input type="hidden" name="connectionId" value={conn.id} />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <SubmitButton
                            className="adm-btn-secondary py-1.5 text-[11px]"
                            spinnerSize="xs"
                            pendingText="Testing..."
                          >
                            <Play className="h-3 w-3 text-indigo-600" />
                            <span>Test Live API</span>
                          </SubmitButton>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Cloud Storage Vault & Tally Bridge Status */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <SectionCard
          title="Client Cloud Storage Vault Health"
          subtitle="Tests live S3 SigV4 write + delete on client BYO R2/S3 buckets or verifies RSL Managed Vault readiness"
          action={
            <StatusPill
              label={
                !snapshot.storage || snapshot.storage.status === "healthy"
                  ? "Vault Healthy"
                  : "Needs Check"
              }
              tone={!snapshot.storage || snapshot.storage.status === "healthy" ? "emerald" : "ruby"}
            />
          }
        >
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3.5">
              <div>
                <div className="text-[11px] font-semibold text-zinc-500">Storage Mode</div>
                <div className="mt-0.5 font-mono font-bold text-slate-900">
                  {snapshot.storage?.mode || "rsl_managed"}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-zinc-500">Bucket / Label</div>
                <div className="mt-0.5 font-semibold text-slate-900">
                  {snapshot.storage?.bucketName ||
                    snapshot.storage?.displayLabel ||
                    "RSL Managed Encrypted Vault"}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-zinc-500">Stored Volume</div>
                <div className="mt-0.5 font-semibold text-slate-900 tabular-nums">
                  {formatBytes(snapshot.storage?.usedBytes ?? 0)} (
                  {snapshot.storage?.objectCount ?? 0} objects)
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-zinc-500">Last Verified</div>
                <div className="mt-0.5 text-zinc-700 tabular-nums">
                  {snapshot.storage?.lastVerifiedAt
                    ? new Date(snapshot.storage.lastVerifiedAt).toLocaleString("en-IN")
                    : "Not verified yet"}
                </div>
              </div>
            </div>

            {snapshot.storage?.endpointUrl && (
              <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-[11px] text-zinc-600">
                Endpoint: {snapshot.storage.endpointUrl}
              </div>
            )}

            {canTestIntegrations && (
              <div className="flex justify-end pt-1">
                <form action={staffTestClientStorageVaultAction}>
                  <input type="hidden" name="workspaceId" value={workspaceId} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <SubmitButton
                    className="adm-btn-secondary py-1.5 text-xs"
                    spinnerSize="xs"
                    pendingText="Probing Vault..."
                  >
                    <Play className="h-3 w-3 text-indigo-600" />
                    <span>Test Storage Vault Read/Write</span>
                  </SubmitButton>
                </form>
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title={`Tally Prime Desktop Bridge & Webhook (${snapshot.tallyAgents.length} PC)`}
          subtitle="Real-time heartbeat status reported by the client's desktop Tally connector and instant Tally HTTP webhook"
        >
          <div className="space-y-3 text-xs">
            {snapshot.tallyAgents.length === 0 ? (
              <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3.5 text-zinc-600">
                No Tally Prime desktop connector paired yet for this client.
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
                {snapshot.tallyAgents.map((agent) => (
                  <div key={agent.id} className="space-y-1 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-slate-900">{agent.deviceName}</span>
                      <StatusPill
                        label={
                          agent.tallyReachable
                            ? "Tally XML Reachable"
                            : agent.status === "online"
                              ? "Agent Online (Tally Closed)"
                              : "Offline"
                        }
                        tone={
                          agent.tallyReachable
                            ? "emerald"
                            : agent.status === "online"
                              ? "amber"
                              : "stone"
                        }
                      />
                    </div>
                    <div className="font-mono text-[11px] text-zinc-600">
                      Target: {agent.tallyHost}:{agent.tallyPort}
                      {agent.activeCompanyName ? ` • Company: ${agent.activeCompanyName}` : ""}
                    </div>
                    <div className="text-[11px] text-zinc-500 tabular-nums">
                      {agent.lastHeartbeatAt
                        ? `Last heartbeat ${new Date(agent.lastHeartbeatAt).toLocaleString("en-IN")}`
                        : "Waiting for first heartbeat"}
                      {agent.lastSyncAt
                        ? ` • Last sync ${new Date(agent.lastSyncAt).toLocaleString("en-IN")}`
                        : ""}
                    </div>
                    {agent.lastErrorMessage && (
                      <div className="rounded-md bg-rose-50 px-2.5 py-1.5 text-[11px] font-medium text-rose-700">
                        Last error: {agent.lastErrorMessage}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-900">Instant Tally HTTP Webhook</span>
                <StatusPill
                  label={
                    !snapshot.tallyWebhook
                      ? "Not Configured"
                      : snapshot.tallyWebhook.enabled
                        ? "Enabled"
                        : "Paused"
                  }
                  tone={
                    !snapshot.tallyWebhook
                      ? "stone"
                      : snapshot.tallyWebhook.enabled
                        ? "emerald"
                        : "amber"
                  }
                />
              </div>
              {snapshot.tallyWebhook ? (
                <div className="mt-1.5 space-y-1 text-[11px] text-zinc-600">
                  <div>
                    Events received: <strong>{snapshot.tallyWebhook.eventsReceivedCount}</strong> •
                    Ping tests: <strong>{snapshot.tallyWebhook.pingsReceivedCount}</strong>
                  </div>
                  {snapshot.tallyWebhook.lastEventAt && (
                    <div>
                      Last event:{" "}
                      {new Date(snapshot.tallyWebhook.lastEventAt).toLocaleString("en-IN")}
                    </div>
                  )}
                  {snapshot.tallyWebhook.lastErrorMessage && (
                    <div className="font-medium text-rose-700">
                      Webhook error: {snapshot.tallyWebhook.lastErrorMessage}
                    </div>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-[11px] text-zinc-500">
                  Client has not generated a Tally TDL instant webhook URL yet.
                </p>
              )}
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
