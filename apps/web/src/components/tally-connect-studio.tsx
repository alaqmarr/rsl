"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Cpu,
  FileText,
  Globe,
  HelpCircle,
  Lock,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { IosSpinner, SectionCard, sileo, StatusPill } from "@rsl/ui";
import { CopyTextButton } from "@/components/client-utils";
import {
  generatePairingCodeJsonAction,
  provisionWorkspaceSslJsonAction,
  revokeTallyDeviceJsonAction,
  rotateTallyTokenJsonAction,
  saveTallyCompanyRoutingJsonAction,
  simulateSampleTallyBillJsonAction,
  syncLocalTallyPort9000JsonAction,
  testTallyEndpointHandshakeJsonAction,
  toggleTallyWebhookJsonAction,
} from "@/lib/actions";

export interface TallyWorkflowStepItem {
  step: number;
  key: string;
  title: string;
  status: "complete" | "ready" | "warning" | "pending";
  summary: string;
}

export interface TallyDeviceClientItem {
  id: string;
  deviceName: string;
  osVersion: string | null;
  agentVersion: string;
  tallyReachable: boolean;
  tallyHost: string;
  tallyPort: number;
  activeCompanyName: string | null;
  lastAlterId: number;
  lastHeartbeatAt: number | null;
  lastSyncAt: number | null;
  lastErrorMessage: string | null;
  liveStatus: {
    state: "connected" | "tally_unreachable" | "offline" | "revoked";
    label: string;
    tone: "success" | "warning" | "danger" | "neutral";
    detail: string;
    isOnline: boolean;
  };
}

export interface TallySyncRunItem {
  id: string;
  source: string;
  vouchersUpserted: number;
  durationMs: number;
  status: string;
  errorMessage: string | null;
  createdAt: number;
}

export interface SslCertDisplayItem {
  zone: "tally" | "api";
  hostname: string;
  wildcardParent: string;
  status: "queued" | "provisioning" | "active" | "renewing" | "failed";
  provider: string;
  coverageMode: "wildcard_san" | "dedicated_acme";
  expiresAt: number | null;
}

export interface TallyConnectStudioProps {
  workspaceName: string;
  workspaceSlug: string;
  canManageTally: boolean;
  primaryDomain: string;
  cloudTallyBaseUrl: string;
  cloudApiBaseUrl: string;
  cloudAppBaseUrl: string;
  workspaceSubdomainUrl: string;
  localBaseUrl: string | null;
  isLocalDev: boolean;
  initialPairingCode?: string;
  localPortProbe?: {
    reachable: boolean;
    port: number;
    activeCompanyName: string | null;
    openCompanies?: string[];
    voucherCount: number;
  } | null;
  outdatedTdl?: {
    isOutdated: boolean;
    detectedVersion: string | null;
    latestVersion: string;
  };
  sslCertificates: SslCertDisplayItem[];
  companyRouting: {
    mode: "all" | "selected";
    allowedCompanyNames: string[];
  };
  knownCompanyNames: string[];
  nativePdfCount: number;
  webhookEndpoint: {
    webhookToken: string | null;
    enabled: boolean;
    eventsReceivedCount: number;
    pingsReceivedCount: number;
    lastEventAt: number | null;
    lastPingAt: number | null;
    lastSourceIp: string | null;
    lastUserAgent: string | null;
    lastErrorAt: number | null;
    lastErrorMessage: string | null;
  };
  webhookLiveStatus: {
    state: string;
    label: string;
    tone: "success" | "info" | "warning" | "danger" | "neutral";
    detail: string;
  };
  connectionOverview: {
    overallState: "live_connected" | "handshake_ready" | "attention_needed" | "not_connected";
    overallLabel: string;
    overallTone: "success" | "info" | "warning" | "danger";
    workflowSteps: TallyWorkflowStepItem[];
  };
  devices: TallyDeviceClientItem[];
  syncRuns: TallySyncRunItem[];
}

function mapToneToPill(
  tone: "success" | "info" | "warning" | "danger" | "neutral"
): "emerald" | "sky" | "amber" | "ruby" | "stone" {
  if (tone === "success") return "emerald";
  if (tone === "info") return "sky";
  if (tone === "warning") return "amber";
  if (tone === "danger") return "ruby";
  return "stone";
}

function maskToken(token: string | null): string {
  if (!token || token.length <= 14) return "tlwh_••••••••••••••••••••";
  return `${token.slice(0, 9)}••••••••••••••••${token.slice(-4)}`;
}

function formatTs(ts: number | null): string {
  if (!ts) return "Never";
  return new Date(ts).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeDisplayLocalhostToIpv4(url: string): string {
  return url.replace(/^http:\/\/localhost(?=[:/]|$)/i, "http://127.0.0.1");
}

export function TallyConnectStudio({
  workspaceName,
  workspaceSlug,
  canManageTally,
  primaryDomain,
  cloudTallyBaseUrl,
  cloudApiBaseUrl,
  cloudAppBaseUrl,
  workspaceSubdomainUrl,
  localBaseUrl,
  isLocalDev,
  initialPairingCode,
  localPortProbe,
  outdatedTdl,
  sslCertificates,
  companyRouting,
  knownCompanyNames,
  nativePdfCount,
  webhookEndpoint,
  webhookLiveStatus,
  connectionOverview,
  devices,
  syncRuns,
}: TallyConnectStudioProps) {
  const router = useRouter();

  const [targetMode, setTargetMode] = useState<"cloud" | "local">(
    isLocalDev && localBaseUrl ? "local" : "cloud"
  );
  const [token, setToken] = useState<string | null>(
    canManageTally ? webhookEndpoint.webhookToken : null
  );
  const [enabled, setEnabled] = useState(webhookEndpoint.enabled);
  const [revealToken, setRevealToken] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(
    canManageTally ? (initialPairingCode ?? null) : null
  );
  const [routingMode, setRoutingMode] = useState<"all" | "selected">(companyRouting.mode);
  const [allowedCompaniesText, setAllowedCompaniesText] = useState<string>(
    companyRouting.allowedCompanyNames.join("\n")
  );
  const [lastCheckReceipt, setLastCheckReceipt] = useState<{
    ok: boolean;
    latencyMs?: number;
    message: string;
  } | null>(null);
  const [showSimulator, setShowSimulator] = useState(false);
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);

  const [isTesting, startTest] = useTransition();
  const [isFetchingLocal, startFetchLocal] = useTransition();
  const [isRotating, startRotate] = useTransition();
  const [isToggling, startToggle] = useTransition();
  const [isPairing, startPair] = useTransition();
  const [isSimulating, startSimulate] = useTransition();
  const [isSavingRouting, startSaveRouting] = useTransition();
  const [isProvisioningSsl, startProvisionSsl] = useTransition();
  const [, startDeviceTransition] = useTransition();

  const normalizedLocalBase = localBaseUrl ? normalizeDisplayLocalhostToIpv4(localBaseUrl) : null;
  const activeTallyBase =
    targetMode === "local" && normalizedLocalBase ? normalizedLocalBase : cloudTallyBaseUrl;
  const activeApiBase =
    targetMode === "local" && normalizedLocalBase ? normalizedLocalBase : cloudApiBaseUrl;

  const cleanWebhookEndpoint = `${activeTallyBase}/api/webhooks/tally`;
  const fullWebhookUrlWithToken = token
    ? `${cleanWebhookEndpoint}?token=${token}`
    : `${cleanWebhookEndpoint}?token=<HIDDEN_FOR_READ_ONLY_ROLE>`;
  const pingEndpointUrl = token
    ? `${cleanWebhookEndpoint}?mode=ping&token=${token}`
    : `${cleanWebhookEndpoint}?mode=ping`;
  const otaLatestTdlUrl = token
    ? `${cleanWebhookEndpoint}?mode=tdl-latest&token=${token}`
    : `${cleanWebhookEndpoint}?mode=tdl-latest&token=<YOUR_TALLY_TOKEN>`;
  const workspaceAliasWebhookUrl = `${workspaceSubdomainUrl}/api/webhooks/tally`;
  const restBillEventUrl = `${activeApiBase}/api/v1/tally/bill-event`;
  const agentPairEndpoint = `${activeTallyBase}/api/agent/pair`;
  const agentIngestEndpoint = `${activeTallyBase}/api/agent/ingest`;

  const tdlDownloadHref =
    targetMode === "local" ? "/api/export/tally-tdl?target=local" : "/api/export/tally-tdl";
  const isolatedTdlDownloadHref =
    targetMode === "local"
      ? "/api/export/tally-tdl?target=local&isolated=1"
      : "/api/export/tally-tdl?isolated=1";
  const connectorDownloadHref =
    targetMode === "local"
      ? "/api/export/tally-connector?target=local"
      : "/api/export/tally-connector";
  const installerDownloadHref = (() => {
    const params = new URLSearchParams();
    if (targetMode === "local") params.set("target", "local");
    if (pairingCode) params.set("code", pairingCode);
    const qs = params.toString();
    return qs ? `/api/export/tally-installer?${qs}` : "/api/export/tally-installer";
  })();

  const tallySsl = sslCertificates.find((c) => c.zone === "tally");
  const apiSsl = sslCertificates.find((c) => c.zone === "api");
  const allSslActive =
    sslCertificates.length >= 2 && sslCertificates.every((c) => c.status === "active");

  function handleLiveHandshakeCheck() {
    startTest(async () => {
      const res = await testTallyEndpointHandshakeJsonAction();
      setLastCheckReceipt({
        ok: res.ok,
        latencyMs: res.latencyMs,
        message: res.message,
      });
      if (res.ok) {
        sileo.success({
          title: `Endpoint Verified (${res.latencyMs ?? 1}ms)`,
          description: res.message,
          duration: 5000,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Endpoint Check Failed",
          description: res.message,
          duration: 5500,
        });
      }
    });
  }

  function handleFetchLocalPort9000() {
    startFetchLocal(async () => {
      const res = await syncLocalTallyPort9000JsonAction(localPortProbe?.port ?? 9000);
      if (res.ok) {
        sileo.success({
          title:
            (res.upserted ?? 0) > 0
              ? `Synced ${res.upserted} Bill(s) from Tally Prime`
              : "Tally Prime Checked",
          description: res.message,
          duration: 5500,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Could Not Fetch from Local Tally",
          description: res.message,
          duration: 5500,
        });
      }
    });
  }

  function handleRotateToken() {
    startRotate(async () => {
      const res = await rotateTallyTokenJsonAction();
      if (res.ok && res.webhookToken) {
        setToken(res.webhookToken);
        setRevealToken(true);
        sileo.success({
          title: "Webhook Token Rotated",
          description: res.message,
          duration: 5000,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Could Not Rotate Token",
          description: res.message,
          duration: 5000,
        });
      }
    });
  }

  function handleToggleWebhook() {
    const nextEnabled = !enabled;
    startToggle(async () => {
      const fd = new FormData();
      fd.set("enabled", String(nextEnabled));
      const res = await toggleTallyWebhookJsonAction(fd);
      if (res.ok) {
        setEnabled(nextEnabled);
        sileo.success({
          title: nextEnabled ? "Webhook Resumed" : "Webhook Paused",
          description: res.message,
          duration: 4200,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Update Failed",
          description: res.message,
          duration: 5000,
        });
      }
    });
  }

  function handleGeneratePairingCode() {
    startPair(async () => {
      const res = await generatePairingCodeJsonAction();
      if (res.ok && res.pairingCode) {
        setPairingCode(res.pairingCode);
        sileo.success({
          title: "15-Minute Pairing Code Ready",
          description: `Code ${res.pairingCode} generated for your Windows Tally PC.`,
          duration: 5000,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Could Not Generate Code",
          description: res.message,
          duration: 5000,
        });
      }
    });
  }

  function handleRevokeDevice(deviceId: string) {
    setRevokingDeviceId(deviceId);
    startDeviceTransition(async () => {
      const fd = new FormData();
      fd.set("deviceId", deviceId);
      const res = await revokeTallyDeviceJsonAction(fd);
      setRevokingDeviceId(null);
      if (res.ok) {
        sileo.success({
          title: "Office PC Unpaired",
          description: res.message,
          duration: 4500,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Could Not Unpair PC",
          description: res.message,
          duration: 5000,
        });
      }
    });
  }

  function handleSaveCompanyRouting(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSaveRouting(async () => {
      const res = await saveTallyCompanyRoutingJsonAction(fd);
      if (res.ok) {
        sileo.success({
          title: "Multi-Company Routing Saved",
          description: res.message,
          duration: 5000,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Could Not Save Routing",
          description: res.message,
          duration: 5000,
        });
      }
    });
  }

  function handleProvisionSsl() {
    startProvisionSsl(async () => {
      const res = await provisionWorkspaceSslJsonAction();
      if (res.ok) {
        sileo.success({
          title: "SSL Subdomains Verified",
          description: res.message,
          duration: 5000,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "SSL Queue Error",
          description: res.message,
          duration: 5000,
        });
      }
    });
  }

  function handleSimulateBill(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSimulate(async () => {
      const res = await simulateSampleTallyBillJsonAction(fd);
      if (res.ok) {
        sileo.success({
          title: "Sample Voucher Processed",
          description: res.message,
          duration: 5000,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Simulation Failed",
          description: res.message,
          duration: 5000,
        });
      }
    });
  }

  const pairCmd = `node rsl-tally-connector.mjs --pair ${pairingCode || "RSL-XXXX-XXXX"} --server ${activeTallyBase} --device "${workspaceName} Accounts PC"`;
  const doctorCmd = `node rsl-tally-connector.mjs --doctor --server ${activeTallyBase}`;
  const curlPingCmd = `curl -X POST "${cleanWebhookEndpoint}?mode=ping" -H "X-Tally-Webhook-Token: ${revealToken && token ? token : "<YOUR_TALLY_TOKEN>"}" -H "Content-Type: application/json" -d "{\\"mode\\":\\"ping\\"}"`;
  const otaScheduledTaskCmd = `schtasks /Create /SC DAILY /TN "RSL_Tally_TDL_AutoUpdate" /TR "powershell -NoProfile -WindowStyle Hidden -Command \\"Invoke-WebRequest -UseBasicParsing '${otaLatestTdlUrl}' -OutFile 'C:\\TallyPrime\\rsl-tally-whatsapp.tdl'\\"" /ST 08:30 /F`;

  return (
    <div className="w-full space-y-6">
      {/* 1. LIVE CONNECTION STATUS & 4-STEP WORKFLOW CHECKLIST */}
      <SectionCard
        title="Tally Prime Live Connection Workflow & Readiness"
        subtitle={`Primary domain: ${primaryDomain} • Real-time verification across Tally Prime, native Tally PDF capture (${nativePdfCount} stored), and WhatsApp automation`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill
              label={connectionOverview.overallLabel}
              tone={mapToneToPill(connectionOverview.overallTone)}
            />
            {canManageTally && (
              <button
                type="button"
                disabled={isTesting}
                onClick={handleLiveHandshakeCheck}
                className="rsl-btn-primary inline-flex items-center gap-1.5 text-xs"
              >
                {isTesting && <IosSpinner size="xs" />}
                <span>{isTesting ? "Checking Endpoint..." : "Run Live Endpoint Check"}</span>
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-4">
          {/* Exact Native Tally PDF Preservation Notice */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200/85 bg-emerald-50/65 px-4 py-3 text-xs text-emerald-950">
            <div className="flex items-start gap-2.5">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              <div className="leading-relaxed">
                <strong>100% Exact Tally-Printed Invoice PDF Format Preserved:</strong> RapidShift
                Labs exports your voucher directly through Tally Prime&rsquo;s own{" "}
                <code className="font-mono font-semibold">Voucher</code> print engine (
                <code className="font-mono">$$SysName:PDF</code>) and sends that exact{" "}
                <code className="font-mono">.pdf</code> document over WhatsApp untouched — keeping
                your company logo, GSTIN, e-Invoice IRN/QR, bank details, and custom Tally print
                configuration byte-for-byte.
              </div>
            </div>
            <StatusPill
              label={`${nativePdfCount} Native Tally PDF(s) Stored`}
              tone="emerald"
              showDot={false}
            />
          </div>

          {lastCheckReceipt && (
            <div
              className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
                lastCheckReceipt.ok
                  ? "border-emerald-200 bg-emerald-50/85 text-emerald-950"
                  : "border-rose-200 bg-rose-50/85 text-rose-950"
              }`}
            >
              <div className="flex items-center gap-2.5">
                {lastCheckReceipt.ok ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                )}
                <div>
                  <span className="font-semibold">{lastCheckReceipt.message}</span>
                  {lastCheckReceipt.ok && (
                    <span className="ml-1 text-emerald-800">
                      (Endpoint verification tests your URL &amp; token — to pull existing Tally
                      bills, click <strong>&ldquo;RSL Sync All Bills Now&rdquo;</strong> in Tally
                      Prime or <strong>&ldquo;Fetch Bills from Tally Now&rdquo;</strong>.)
                    </span>
                  )}
                </div>
              </div>
              {lastCheckReceipt.latencyMs !== undefined && (
                <span className="rounded-md bg-white/90 px-2 py-0.5 font-mono text-[11px] font-bold text-slate-800">
                  {lastCheckReceipt.latencyMs} ms HTTP round-trip
                </span>
              )}
            </div>
          )}

          {webhookEndpoint.lastErrorMessage && (
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50/75 px-4 py-3 text-xs text-rose-950">
              <div className="space-y-0.5">
                <div className="font-bold">
                  Last Webhook Delivery Error ({formatTs(webhookEndpoint.lastErrorAt)})
                </div>
                <div className="text-rose-800">{webhookEndpoint.lastErrorMessage}</div>
              </div>
              {canManageTally && (
                <button
                  type="button"
                  onClick={handleLiveHandshakeCheck}
                  className="rsl-btn-secondary py-1 text-[11px]"
                >
                  Re-Verify Now
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {connectionOverview.workflowSteps.map((step) => {
              const pillTone =
                step.status === "complete"
                  ? "emerald"
                  : step.status === "ready"
                    ? "sky"
                    : step.status === "warning"
                      ? "amber"
                      : "stone";
              const pillLabel =
                step.status === "complete"
                  ? "Verified"
                  : step.status === "ready"
                    ? "Ready"
                    : step.status === "warning"
                      ? "Action Needed"
                      : "Pending";

              return (
                <div
                  key={step.key}
                  className="flex min-w-0 flex-col justify-between gap-2.5 rounded-xl border border-zinc-200/85 bg-zinc-50/65 p-3.5 text-xs"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-bold text-zinc-500 uppercase">
                        Step {step.step}
                      </span>
                      <StatusPill label={pillLabel} tone={pillTone} showDot={false} />
                    </div>
                    <div className="font-semibold text-slate-900">{step.title}</div>
                    <p className="leading-relaxed text-zinc-600">{step.summary}</p>
                  </div>
                  {step.key === "whatsapp" && step.status !== "complete" && canManageTally && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Link
                        href="/connections"
                        className="font-semibold text-emerald-700 hover:underline"
                      >
                        Connect WhatsApp →
                      </Link>
                      <span className="text-zinc-300">•</span>
                      <Link
                        href="/whatsapp"
                        className="font-semibold text-emerald-700 hover:underline"
                      >
                        Templates →
                      </Link>
                    </div>
                  )}
                  {step.key === "automation" && step.status !== "complete" && canManageTally && (
                    <div className="pt-1">
                      <Link
                        href="/tally?tab=rules"
                        className="font-semibold text-emerald-700 hover:underline"
                      >
                        Create Automation Rule →
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </SectionCard>

      {/* 2. DEDICATED CLIENT WILDCARD SUBDOMAINS (*.tally.rapidshiftlabs.in & *.api.rapidshiftlabs.in) & QUEUED SSL */}
      <SectionCard
        title="Dedicated Client Wildcard Subdomains & Queued SSL Provisioning"
        subtitle={`Isolated HTTPS client ingress on *.tally.${primaryDomain} & *.api.${primaryDomain} with queued backend SSL provisioning`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {isLocalDev && normalizedLocalBase && (
              <div className="inline-flex rounded-xl border border-zinc-200 bg-zinc-100/80 p-0.5 text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() => setTargetMode("local")}
                  className={`rounded-lg px-2.5 py-1 transition ${
                    targetMode === "local"
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-zinc-600 hover:text-slate-900"
                  }`}
                >
                  This PC (127.0.0.1:4500)
                </button>
                <button
                  type="button"
                  onClick={() => setTargetMode("cloud")}
                  className={`rounded-lg px-2.5 py-1 transition ${
                    targetMode === "cloud"
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-zinc-600 hover:text-slate-900"
                  }`}
                >
                  Cloud ({workspaceSlug}.tally.{primaryDomain})
                </button>
              </div>
            )}
            <StatusPill
              label={allSslActive ? "SSL Active (2/2 Zones)" : "SSL Provisioning Queued"}
              tone={allSslActive ? "emerald" : "sky"}
            />
            {canManageTally && (
              <button
                type="button"
                disabled={isProvisioningSsl}
                onClick={handleProvisionSsl}
                className="rsl-btn-secondary inline-flex items-center gap-1.5 py-1 text-xs"
              >
                {isProvisioningSsl && <IosSpinner size="xs" />}
                <span>{isProvisioningSsl ? "Verifying SSL..." : "Verify / Renew SSL"}</span>
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-4 text-xs">
          {isLocalDev && normalizedLocalBase && (
            <div className="rounded-xl border border-sky-200/90 bg-sky-50/75 px-3.5 py-2.5 text-[11px] leading-relaxed text-sky-950">
              <strong>Local Environment Notice:</strong> You are running locally. The{" "}
              <code className="font-mono">.tdl v2.5</code> add-on automatically uses{" "}
              <code className="font-mono font-semibold">{normalizedLocalBase}</code> (IPv4{" "}
              <code className="font-mono">127.0.0.1</code>) when{" "}
              <strong>This PC (127.0.0.1:4500)</strong> is selected so Tally Prime&rsquo;s Windows
              WinHTTP client never hits IPv6 <code className="font-mono">[::1]</code> loopback
              delays. Switch to <strong>Cloud ({workspaceSlug}.tally.{primaryDomain})</strong> when
              deploying to production.
            </div>
          )}

          {/* Client Subdomain SSL Status Strip */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200/85 bg-zinc-50/70 px-3.5 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <Lock className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <div className="min-w-0">
                  <div className="truncate font-mono text-[11px] font-bold text-slate-900">
                    {tallySsl?.hostname ?? `${workspaceSlug}.tally.${primaryDomain}`}
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    Wildcard Zone: {tallySsl?.wildcardParent ?? `*.tally.${primaryDomain}`} •{" "}
                    {tallySsl?.expiresAt ? `Valid until ${formatTs(tallySsl.expiresAt)}` : "Queued"}
                  </div>
                </div>
              </div>
              <StatusPill
                label={tallySsl?.status === "active" ? "TLS Active" : tallySsl?.status ?? "queued"}
                tone={tallySsl?.status === "active" ? "emerald" : "sky"}
                showDot={false}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200/85 bg-zinc-50/70 px-3.5 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <Lock className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <div className="min-w-0">
                  <div className="truncate font-mono text-[11px] font-bold text-slate-900">
                    {apiSsl?.hostname ?? `${workspaceSlug}.api.${primaryDomain}`}
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    Wildcard Zone: {apiSsl?.wildcardParent ?? `*.api.${primaryDomain}`} •{" "}
                    {apiSsl?.expiresAt ? `Valid until ${formatTs(apiSsl.expiresAt)}` : "Queued"}
                  </div>
                </div>
              </div>
              <StatusPill
                label={apiSsl?.status === "active" ? "TLS Active" : apiSsl?.status ?? "queued"}
                tone={apiSsl?.status === "active" ? "emerald" : "sky"}
                showDot={false}
              />
            </div>
          </div>

          {/* Telemetry Bar */}
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3.5 sm:grid-cols-4">
            <div className="min-w-0">
              <div className="text-[11px] text-zinc-500">Vouchers Received</div>
              <div className="mt-0.5 font-mono text-sm font-bold text-slate-900 tabular-nums">
                {webhookEndpoint.eventsReceivedCount.toLocaleString("en-IN")}
              </div>
              <div className="truncate text-[11px] text-zinc-500">
                Last: {formatTs(webhookEndpoint.lastEventAt)}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-zinc-500">Handshake Checks</div>
              <div className="mt-0.5 font-mono text-sm font-bold text-slate-900 tabular-nums">
                {webhookEndpoint.pingsReceivedCount.toLocaleString("en-IN")}
              </div>
              <div className="truncate text-[11px] text-zinc-500">
                Last: {formatTs(webhookEndpoint.lastPingAt)}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-zinc-500">Client Tally Ingress</div>
              <div className="mt-0.5 truncate font-mono text-xs font-semibold text-emerald-800">
                {workspaceSlug}.tally.{primaryDomain}
              </div>
              <div className="truncate text-[11px] text-zinc-500">
                {cloudAppBaseUrl.replace(/^https?:\/\//, "")}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-zinc-500">Last Client Source</div>
              <div className="mt-0.5 truncate font-mono text-xs font-semibold text-slate-800">
                {webhookEndpoint.lastSourceIp || "Awaiting traffic"}
              </div>
              <div
                className={`truncate text-[11px] ${
                  outdatedTdl?.isOutdated ? "font-bold text-amber-700" : "text-zinc-500"
                }`}
              >
                {webhookEndpoint.lastUserAgent || "TallyPrime-RSL-TDL/2.5"}
                {outdatedTdl?.isOutdated ? ` (Update to v${outdatedTdl.latestVersion})` : ""}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Primary Tally Webhook Endpoint */}
            <div className="min-w-0 space-y-2.5 rounded-xl border border-zinc-200/90 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-emerald-600" />
                  <span className="font-semibold text-slate-900">
                    1. Tally Prime Client Webhook Endpoint
                  </span>
                </div>
                <CopyTextButton
                  text={cleanWebhookEndpoint}
                  label="Copy Endpoint"
                  className="rsl-btn-secondary py-1 text-[11px]"
                />
              </div>
              <div className="break-all rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-[11px] font-semibold text-emerald-800">
                POST {cleanWebhookEndpoint}
              </div>
              {workspaceAliasWebhookUrl !== cleanWebhookEndpoint && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-100 bg-zinc-50/60 px-3 py-1.5 text-[11px] text-zinc-600">
                  <span className="min-w-0 break-all">
                    Cloud Client Endpoint:{" "}
                    <code className="font-mono font-semibold text-slate-800">
                      {cloudTallyBaseUrl}/api/webhooks/tally
                    </code>
                  </span>
                  <CopyTextButton
                    text={`${cloudTallyBaseUrl}/api/webhooks/tally`}
                    label="Copy Cloud URL"
                  />
                </div>
              )}
              <p className="text-[11px] leading-relaxed text-zinc-500">
                Accepts Tally Prime JSON, <code className="font-mono">&lt;ENVELOPE&gt;</code> XML,
                and <code className="font-mono">?mode=voucher-pdf</code> untouched native Tally PDF
                uploads.
              </p>
            </div>

            {/* Secret Token Management */}
            <div className="min-w-0 space-y-2.5 rounded-xl border border-zinc-200/90 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  <span className="font-semibold text-slate-900">
                    2. Secret Tally Token (X-Tally-Webhook-Token)
                  </span>
                </div>
                {canManageTally && token ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setRevealToken((v) => !v)}
                      className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-zinc-100"
                    >
                      {revealToken ? "Hide" : "Reveal"}
                    </button>
                    <CopyTextButton text={token} label="Copy Token" />
                    <CopyTextButton text={fullWebhookUrlWithToken} label="Copy Full URL" />
                  </div>
                ) : (
                  <StatusPill label="Protected Secret" tone="stone" showDot={false} />
                )}
              </div>
              <div className="break-all rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-[11px] font-semibold text-slate-900">
                {canManageTally && revealToken && token ? token : maskToken(token)}
              </div>
              {canManageTally ? (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    disabled={isToggling}
                    onClick={handleToggleWebhook}
                    className="rsl-btn-secondary inline-flex items-center gap-1.5 py-1 text-[11px]"
                  >
                    {isToggling && <IosSpinner size="xs" />}
                    <span>{enabled ? "Pause Webhook" : "Resume Webhook"}</span>
                  </button>
                  <button
                    type="button"
                    disabled={isRotating}
                    onClick={handleRotateToken}
                    className="rsl-btn-secondary inline-flex items-center gap-1.5 py-1 text-[11px]"
                  >
                    {isRotating && <IosSpinner size="xs" />}
                    <span>Rotate Secret Token</span>
                  </button>
                </div>
              ) : (
                <p className="text-[11px] text-zinc-500">
                  Read-only role — ask a Business Owner, Admin, or Manager to reveal or rotate
                  webhook credentials.
                </p>
              )}
            </div>
          </div>

          {/* Secondary Endpoints Row: Ping Check, Windows Agent & REST v1 */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="min-w-0 rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-800">Handshake Ping URL</span>
                {canManageTally && <CopyTextButton text={pingEndpointUrl} label="Copy" />}
              </div>
              <div className="mt-1 break-all font-mono text-[11px] text-zinc-700">
                {cleanWebhookEndpoint}?mode=ping
              </div>
            </div>
            <div className="min-w-0 rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-800">Windows Connector Ingress</span>
                <CopyTextButton text={activeTallyBase} label="Copy Host" />
              </div>
              <div className="mt-1 break-all font-mono text-[11px] text-zinc-700">
                {agentPairEndpoint} • {agentIngestEndpoint}
              </div>
            </div>
            <div className="min-w-0 rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-800">Client REST API v1</span>
                <CopyTextButton text={restBillEventUrl} label="Copy" />
              </div>
              <div className="mt-1 break-all font-mono text-[11px] text-zinc-700">
                POST {restBillEventUrl}
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* 3. MULTI-COMPANY TALLY ROUTING & ZERO-RE-DOWNLOAD OTA AUTO-UPDATER */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Multi-Company Tally Routing */}
        <SectionCard
          title="Multi-Company Tally Routing & Workspace Isolation"
          subtitle="Control what happens when multiple companies are open inside the same Tally Prime instance"
          action={
            <StatusPill
              label={
                routingMode === "selected"
                  ? `Filtered (${companyRouting.allowedCompanyNames.length} Selected)`
                  : "All Open Companies"
              }
              tone="emerald"
              showDot={false}
            />
          }
        >
          <div className="space-y-3.5 text-xs">
            <form onSubmit={handleSaveCompanyRouting} className="space-y-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label
                  className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition ${
                    routingMode === "all"
                      ? "border-slate-900 bg-zinc-50/90"
                      : "border-zinc-200 bg-white hover:bg-zinc-50/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="mode"
                    value="all"
                    checked={routingMode === "all"}
                    disabled={!canManageTally}
                    onChange={() => setRoutingMode("all")}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-semibold text-slate-900">Sync All Open Companies</div>
                    <p className="mt-0.5 text-[11px] text-zinc-600">
                      Accepts bills from every company open in Tally Prime (e.g. Head Office +
                      Branch or split financial year books) with GUID collision safety.
                    </p>
                  </div>
                </label>

                <label
                  className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition ${
                    routingMode === "selected"
                      ? "border-slate-900 bg-zinc-50/90"
                      : "border-zinc-200 bg-white hover:bg-zinc-50/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="mode"
                    value="selected"
                    checked={routingMode === "selected"}
                    disabled={!canManageTally}
                    onChange={() => setRoutingMode("selected")}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-semibold text-slate-900">Only Selected Companies</div>
                    <p className="mt-0.5 text-[11px] text-zinc-600">
                      Restricts this workspace to exact Tally company name(s). Any other open
                      company in Tally is safely ignored.
                    </p>
                  </div>
                </label>
              </div>

              {routingMode === "selected" && (
                <div className="space-y-2 rounded-xl border border-zinc-200/85 bg-zinc-50/60 p-3">
                  <label className="block font-semibold text-slate-900">
                    Allowed Tally Company Names (one per line — exact match to Tally Prime)
                  </label>
                  {knownCompanyNames.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pb-1">
                      <span className="text-[11px] text-zinc-500">Detected companies:</span>
                      {knownCompanyNames.map((name) => (
                        <button
                          key={name}
                          type="button"
                          disabled={!canManageTally}
                          onClick={() => {
                            const lines = allowedCompaniesText
                              .split(/\r?\n/)
                              .map((l) => l.trim())
                              .filter(Boolean);
                            if (!lines.includes(name)) {
                              setAllowedCompaniesText([...lines, name].join("\n"));
                            }
                          }}
                          className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-800 hover:bg-zinc-100"
                        >
                          + {name}
                        </button>
                      ))}
                    </div>
                  )}
                  <textarea
                    name="allowedCompanyNames"
                    rows={3}
                    value={allowedCompaniesText}
                    disabled={!canManageTally}
                    onChange={(e) => setAllowedCompaniesText(e.target.value)}
                    placeholder={`e.g. ${workspaceName}`}
                    className="rsl-input bg-white font-mono text-[11px]"
                  />
                </div>
              )}

              {canManageTally && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="submit"
                    disabled={isSavingRouting}
                    className="rsl-btn-primary inline-flex items-center gap-1.5 text-xs"
                  >
                    {isSavingRouting && <IosSpinner size="xs" />}
                    <span>{isSavingRouting ? "Saving..." : "Save Company Routing"}</span>
                  </button>
                  <a href={isolatedTdlDownloadHref} className="rsl-btn-secondary text-xs">
                    Download Multi-Workspace Isolated .tdl ({workspaceSlug})
                  </a>
                </div>
              )}
            </form>

            <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-3 text-[11px] leading-relaxed text-zinc-600">
              <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                <Building2 className="h-3.5 w-3.5 text-emerald-600" />
                <span>CA Firm / Group PC with Multiple Separate RapidShift Workspaces?</span>
              </div>
              <p className="mt-1">
                Select <strong>Only Selected Companies</strong> above, save, and click{" "}
                <strong>Download Multi-Workspace Isolated .tdl ({workspaceSlug})</strong>. Every TDL
                function &amp; variable is namespaced to{" "}
                <code className="font-mono text-slate-800">{workspaceSlug}</code> so multiple{" "}
                <code className="font-mono">.tdl</code> files load side-by-side in one Tally Prime!
              </p>
            </div>
          </div>
        </SectionCard>

        {/* Zero-Re-Download OTA Auto-Updater */}
        <SectionCard
          title="Zero-Re-Download Architecture (Automatic Future Updates)"
          subtitle="Your team never has to manually re-download .tdl files as new RapidShift features launch"
          action={<StatusPill label="OTA Auto-Update Ready" tone="emerald" showDot={false} />}
        >
          <div className="space-y-3 text-xs">
            <div className="space-y-2 rounded-xl border border-zinc-200/85 bg-zinc-50/70 p-3.5 leading-relaxed text-zinc-700">
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                <RefreshCw className="h-4 w-4 text-emerald-600" />
                <span>How Updates Roll Out Without Touching Tally Prime:</span>
              </div>
              <ul className="list-disc space-y-1.5 pl-4 text-[11px]">
                <li>
                  <strong>1. Thin-Client Server Rules:</strong> All WhatsApp templates, automation
                  rules, overdue schedules, multi-company filters, wallet overdrafts, and PDF
                  routing run 100% on RapidShift Cloud — adding new features requires zero TDL
                  changes.
                </li>
                <li>
                  <strong>2. Automatic OTA Self-Updater in Windows Connector:</strong> When{" "}
                  <code className="font-mono text-slate-900">rsl-tally-connector.mjs</code> (v2.2+)
                  runs on the Tally PC, it checks{" "}
                  <code className="font-mono">?mode=tdl-manifest</code> automatically, updates your
                  local <code className="font-mono">.tdl</code> file over-the-air whenever a newer
                  version ships, AND exports exact native Tally printed PDFs!
                </li>
                <li>
                  <strong>3. Optional 1-Line Windows Auto-Updater (For .tdl-Only PCs):</strong> Run
                  this command once in PowerShell on the Tally PC so Windows automatically refreshes{" "}
                  <code className="font-mono">C:\TallyPrime\rsl-tally-whatsapp.tdl</code> from your
                  endpoint before Tally starts each morning:
                </li>
              </ul>
            </div>

            {canManageTally && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-800">
                    One-Time Windows Scheduled Task (Auto-Updates .tdl Daily):
                  </span>
                  <CopyTextButton text={otaScheduledTaskCmd} label="Copy Auto-Update Cmd" />
                </div>
                <pre className="overflow-x-auto rounded-lg bg-slate-950 p-2.5 font-mono text-[11px] text-zinc-100">
                  <code>{otaScheduledTaskCmd}</code>
                </pre>
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      {/* 4. DETAILED SETUP GUIDE — TWO CONNECTION METHODS SIDE-BY-SIDE */}
      <div id="setup-guide" className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* METHOD A: TALLY PRIME .TDL ADD-ON (v2.5) */}
        <SectionCard
          title="Method A — Tally Prime Cloud Add-On (.tdl v2.5)"
          subtitle="Instant live push on Create, Update, Cancel (Alt+X), Delete (Alt+D) & 1-click full reconcile"
          action={<StatusPill label="v2.5 • Bad-Formula Fixed" tone="emerald" showDot={false} />}
        >
          <div className="space-y-4 text-xs">
            {canManageTally && (
              <div className="flex flex-wrap items-center gap-2">
                <a href={tdlDownloadHref} className="rsl-btn-primary text-xs">
                  Download Pre-Configured .tdl v2.5 (
                  {targetMode === "local" ? "127.0.0.1:4500" : `${workspaceSlug}.tally.${primaryDomain}`}
                  )
                </a>
                {isLocalDev && normalizedLocalBase && (
                  <a
                    href={
                      targetMode === "local"
                        ? "/api/export/tally-tdl"
                        : "/api/export/tally-tdl?target=local"
                    }
                    className="rsl-btn-secondary text-xs"
                  >
                    {targetMode === "local"
                      ? `Also Download for Cloud (${workspaceSlug}.tally.${primaryDomain})`
                      : "Also Download for 127.0.0.1:4500"}
                  </a>
                )}
                <CopyTextButton
                  text={curlPingCmd}
                  label="Copy cURL Test"
                  className="rsl-btn-secondary text-xs"
                />
              </div>
            )}

            <div className="rounded-xl border border-zinc-200/85 bg-zinc-50/70 p-4">
              <div className="font-semibold text-slate-900">
                Complete Step-by-Step Setup in Tally Prime (Release 2.0 – 5.0+)
              </div>
              <ol className="mt-2.5 list-decimal space-y-2.5 pl-4 leading-relaxed text-zinc-700">
                <li>
                  <strong>Enable Tally Port 9000 for Native PDF Capture:</strong> In Tally Prime,
                  press <strong>F1 (Help)</strong> → <strong>Settings</strong> →{" "}
                  <strong>Connectivity</strong> → <strong>Client/Server Configuration</strong> → set{" "}
                  <strong>TallyPrime acts as = Both</strong> and <strong>Port = 9000</strong>. This
                  lets RapidShift capture your exact Tally-printed invoice PDF automatically!
                </li>
                <li>
                  <strong>Save &amp; Overwrite Exact TDL Path:</strong> Save{" "}
                  <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-900">
                    rsl-tally-whatsapp.tdl
                  </code>{" "}
                  to{" "}
                  <code className="font-mono text-slate-900">
                    C:\TallyPrime\rsl-tally-whatsapp.tdl
                  </code>{" "}
                  (overwriting any older copy — do not leave duplicates like{" "}
                  <code className="font-mono">rsl-tally-whatsapp (1).tdl</code> in Downloads).
                </li>
                <li>
                  <strong>Load / Reload into Tally Memory:</strong> Press <strong>F1 (Help)</strong>{" "}
                  → <strong>TDLs &amp; Add-Ons</strong> → <strong>F4 (Manage Local TDLs)</strong> →
                  set <strong>Load selected TDL files on startup = Yes</strong>, enter{" "}
                  <code className="font-mono text-slate-900">
                    C:\TallyPrime\rsl-tally-whatsapp.tdl
                  </code>
                  , and press <strong>Ctrl + A</strong>.
                </li>
                <li>
                  <strong>Step A — Test Connection:</strong> On <strong>Gateway of Tally</strong>,
                  click <strong>&ldquo;RSL Cloud Connection Test&rdquo;</strong>. Tally will verify{" "}
                  <code className="font-mono text-emerald-800">{cleanWebhookEndpoint}</code> and pop
                  up <strong>RSL Cloud Sync — Connected</strong>.
                </li>
                <li>
                  <strong>Step B — Sync &amp; Reconcile All Existing Bills:</strong> Click{" "}
                  <strong>&ldquo;RSL Sync All Bills Now&rdquo;</strong> on Gateway of Tally (or
                  press <code className="font-mono">Alt + R</code> in Day Book) to sync all saved
                  bills AND remove any deleted vouchers!
                </li>
                <li>
                  <strong>Step C — Live Create, Update, Cancel &amp; Delete:</strong> Every Sales
                  (F8), Receipt (F6), or Credit Note (Alt+F6) saved with{" "}
                  <strong>Ctrl + A</strong>, altered, cancelled with <strong>Alt + X</strong>, or
                  deleted with <strong>Alt + D</strong> reflects live in your portal and sends your
                  exact Tally PDF invoice on WhatsApp automatically!
                </li>
              </ol>
            </div>
          </div>
        </SectionCard>

        {/* METHOD B: LOCAL PORT-9000 XML PULL & WINDOWS PC CONNECTOR */}
        <SectionCard
          title={`Method B — Tally Port 9000 & Windows Connector v2.2 (${devices.length} Paired)`}
          subtitle="Recommended for Remote Cloud • Exports exact native Tally PDFs + auto-updates .tdl over-the-air"
          action={
            canManageTally ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <a href={installerDownloadHref} className="rsl-btn-primary py-1.5 text-xs">
                  1-Click Windows Setup (.bat)
                </a>
                <a href={connectorDownloadHref} className="rsl-btn-secondary py-1.5 text-xs">
                  Connector (.mjs)
                </a>
              </div>
            ) : undefined
          }
        >
          <div className="space-y-4 text-xs">
            {isLocalDev && localPortProbe?.reachable && canManageTally && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50/85 p-3.5 text-emerald-950">
                <div className="space-y-0.5">
                  <div className="font-bold">
                    Port {localPortProbe.port} Open Right Now
                    {localPortProbe.activeCompanyName
                      ? ` • Company: "${localPortProbe.activeCompanyName}"`
                      : ""}
                  </div>
                  <p className="text-[11px] text-emerald-900">
                    Pull {localPortProbe.voucherCount} saved bill(s)/receipt(s) + exact native Tally
                    printed PDFs directly from Tally Prime on this PC:
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isFetchingLocal}
                  onClick={handleFetchLocalPort9000}
                  className="rsl-btn-primary inline-flex items-center gap-1.5 text-xs"
                >
                  {isFetchingLocal && <IosSpinner size="xs" />}
                  <span>
                    {isFetchingLocal
                      ? "Fetching..."
                      : `Fetch Bills & Tally PDFs (${localPortProbe.voucherCount})`}
                  </span>
                </button>
              </div>
            )}

            <div className="rounded-xl border border-zinc-200/85 bg-zinc-50/70 p-4">
              <div className="font-semibold text-slate-900">
                Step-by-Step: Pair Windows Connector (Native PDF Export + Multi-Company Sync)
              </div>
              <ol className="mt-2.5 list-decimal space-y-2 pl-4 leading-relaxed text-zinc-700">
                <li>
                  Ensure Tally Prime XML Server is enabled on{" "}
                  <code className="font-mono font-bold text-slate-900">127.0.0.1:9000</code> (F1 →
                  Settings → Connectivity → Client/Server = Both, Port = 9000).
                </li>
                <li>
                  Download{" "}
                  {canManageTally ? (
                    <a
                      href={connectorDownloadHref}
                      className="font-semibold text-emerald-700 underline"
                    >
                      rsl-tally-connector.mjs
                    </a>
                  ) : (
                    <code className="font-mono">rsl-tally-connector.mjs</code>
                  )}{" "}
                  onto the Tally Windows PC (Node.js 20+, zero npm packages needed).
                </li>
                <li>
                  Click <strong>Generate 15-Min PC Pairing Code</strong> below, run the one-time{" "}
                  <code className="font-mono">--pair</code> command, then start{" "}
                  <code className="font-mono">node rsl-tally-connector.mjs</code>. Every 30 seconds
                  it syncs all open Tally companies, reconciles deleted bills, exports Tally&rsquo;s
                  exact printed invoice PDF (<code className="font-mono">%PDF-1.x</code>), and
                  auto-updates your local <code className="font-mono">.tdl</code> file!
                </li>
              </ol>

              {canManageTally && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isPairing}
                    onClick={handleGeneratePairingCode}
                    className="rsl-btn-primary inline-flex items-center gap-1.5 text-xs"
                  >
                    {isPairing && <IosSpinner size="xs" />}
                    <span>Generate 15-Min PC Pairing Code</span>
                  </button>
                </div>
              )}

              {canManageTally && pairingCode && (
                <div className="mt-3 space-y-2 rounded-xl border border-emerald-300 bg-emerald-50/90 p-3.5 text-emerald-950">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">
                      One-Time Pairing Code (Valid 15 Minutes):
                    </span>
                    <CopyTextButton text={pairingCode} label="Copy Code" />
                  </div>
                  <div className="font-mono text-base font-bold tracking-wider text-slate-900">
                    {pairingCode}
                  </div>
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold">
                        Run once in PowerShell / CMD on your Tally PC:
                      </span>
                      <CopyTextButton text={pairCmd} label="Copy Command" />
                    </div>
                    <pre className="overflow-x-auto rounded-lg bg-slate-950 p-2.5 font-mono text-[11px] text-zinc-100">
                      <code>{pairCmd}</code>
                    </pre>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] font-semibold">
                        Verify Port 9000 + Cloud HTTPS anytime:
                      </span>
                      <CopyTextButton text={doctorCmd} label="Copy Doctor Cmd" />
                    </div>
                    <pre className="overflow-x-auto rounded-lg bg-slate-950 p-2.5 font-mono text-[11px] text-emerald-300">
                      <code>{doctorCmd}</code>
                    </pre>
                  </div>
                </div>
              )}
            </div>

            {/* Paired PCs List */}
            <div className="space-y-2">
              <div className="font-semibold text-slate-900">
                Paired Office Computers ({devices.length})
              </div>
              {devices.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/50 p-4 text-zinc-500">
                  No Windows PC paired yet. Use Method A (.tdl v2.5) for instant voucher push, or
                  pair an office PC above for continuous Port 9000 + native Tally PDF cloud sync.
                </div>
              ) : (
                <div className="divide-y divide-zinc-200/80 rounded-xl border border-zinc-200/90 bg-white">
                  {devices.map((d) => {
                    const isRevoking = revokingDeviceId === d.id;
                    return (
                      <div key={d.id} className="space-y-1.5 p-3.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Cpu className="h-4 w-4 text-slate-600" />
                            <span className="font-semibold text-slate-900">{d.deviceName}</span>
                            <StatusPill
                              label={d.liveStatus.label}
                              tone={mapToneToPill(d.liveStatus.tone)}
                            />
                          </div>
                          {canManageTally && (
                            <button
                              type="button"
                              disabled={isRevoking}
                              onClick={() => handleRevokeDevice(d.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100"
                            >
                              {isRevoking && <IosSpinner size="xs" />}
                              <span>Unpair</span>
                            </button>
                          )}
                        </div>
                        <p className="text-[11px] text-zinc-600">{d.liveStatus.detail}</p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                          <span>
                            {d.osVersion || "Windows"} • v{d.agentVersion}
                          </span>
                          <span>• AlterID Cursor: {d.lastAlterId}</span>
                          <span>• Heartbeat: {formatTs(d.lastHeartbeatAt)}</span>
                          {d.lastSyncAt && <span>• Last Sync: {formatTs(d.lastSyncAt)}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </SectionCard>
      </div>

      {/* 5. TROUBLESHOOTING GUIDE: "ENDPOINT VERIFIED, WHY DIDN'T MY BILL REFLECT?" */}
      <SectionCard
        title="Troubleshooting Checklist — “Endpoint Verified, Why Didn’t My Tally Bill Reflect?”"
        subtitle="Check these 6 common causes whenever your connection test passes but a Sales Invoice does not show in Bills & Receipts"
      >
        <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-xl border border-zinc-200/85 bg-zinc-50/60 p-3.5">
            <div className="flex items-center gap-2 font-semibold text-slate-900">
              <HelpCircle className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>1. Reload .tdl v2.5 in Tally Memory</span>
            </div>
            <p className="mt-1.5 leading-relaxed text-zinc-600">
              Check <strong>Last Client Source</strong> above — it must show{" "}
              <code className="font-mono text-slate-900">TallyPrime-RSL-TDL/2.5</code>. Overwrite
              your exact TDL file path and press{" "}
              <strong>F1 → TDLs &amp; Add-Ons → F4 → Ctrl + A</strong> (press <code className="font-mono">Esc</code>{" "}
              if any old dialog is open).
            </p>
          </div>

          <div className="rounded-xl border border-zinc-200/85 bg-zinc-50/60 p-3.5">
            <div className="flex items-center gap-2 font-semibold text-slate-900">
              <HelpCircle className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>2. Push Previously Saved Bills</span>
            </div>
            <p className="mt-1.5 leading-relaxed text-zinc-600">
              <strong>Run Live Endpoint Check</strong> only verifies your token. To sync bills saved
              earlier or remove deleted bills, click{" "}
              <strong>&ldquo;RSL Sync All Bills Now&rdquo;</strong> on Gateway of Tally (or{" "}
              <strong>Fetch Bills &amp; Tally PDFs</strong> above).
            </p>
          </div>

          <div className="rounded-xl border border-zinc-200/85 bg-zinc-50/60 p-3.5">
            <div className="flex items-center gap-2 font-semibold text-slate-900">
              <HelpCircle className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>3. Cloud vs. 127.0.0.1 URL Match</span>
            </div>
            <p className="mt-1.5 leading-relaxed text-zinc-600">
              When testing locally on port 4500, use the{" "}
              <strong>127.0.0.1:4500</strong> <code className="font-mono">.tdl</code>. In
              production, download the{" "}
              <strong>{workspaceSlug}.tally.{primaryDomain}</strong>{" "}
              <code className="font-mono">.tdl</code>.
            </p>
          </div>

          <div className="rounded-xl border border-zinc-200/85 bg-zinc-50/60 p-3.5">
            <div className="flex items-center gap-2 font-semibold text-slate-900">
              <HelpCircle className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>4. Multi-Company Filter Check</span>
            </div>
            <p className="mt-1.5 leading-relaxed text-zinc-600">
              If <strong>Only Selected Companies</strong> is enabled above, make sure the active
              Tally company name matches character-for-character, or switch to{" "}
              <strong>Sync All Open Companies</strong>.
            </p>
          </div>

          <div className="rounded-xl border border-zinc-200/85 bg-zinc-50/60 p-3.5">
            <div className="flex items-center gap-2 font-semibold text-slate-900">
              <HelpCircle className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>5. Optional / ₹0 / Non-Sales Vouchers</span>
            </div>
            <p className="mt-1.5 leading-relaxed text-zinc-600">
              Optional pro-forma quotes (<code className="font-mono">Ctrl + L</code>), ₹0 drafts,
              and Journal/Contra entries are skipped. Cancelled (<code className="font-mono">Alt + X</code>)
              and deleted (<code className="font-mono">Alt + D</code>) bills update live!
            </p>
          </div>

          <div className="rounded-xl border border-zinc-200/85 bg-zinc-50/60 p-3.5">
            <div className="flex items-center gap-2 font-semibold text-slate-900">
              <HelpCircle className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>6. Automatic WhatsApp + Tally PDF</span>
            </div>
            <p className="mt-1.5 leading-relaxed text-zinc-600">
              Ensure: (a) Party Ledger has a 10-digit <strong>Mobile No.</strong>, (b) WhatsApp is
              linked in{" "}
              <Link href="/connections" className="font-semibold text-emerald-700 underline">
                Connected Accounts
              </Link>
              , and (c) an active rule uses a PDF/Invoice template in{" "}
              <Link href="/tally?tab=rules" className="font-semibold text-emerald-700 underline">
                WhatsApp Rules
              </Link>
              .
            </p>
          </div>
        </div>
      </SectionCard>

      {/* 6. RECENT SYNC & WEBHOOK DIAGNOSTICS LOG + COLLAPSIBLE VOUCHER SIMULATOR */}
      <SectionCard
        title={`Recent Sync & Webhook Activity (${syncRuns.length})`}
        subtitle="Audit log of real-time Tally webhook deliveries, Port 9000 fetches, PC connector syncs, and XML/CSV imports"
        action={
          canManageTally ? (
            <button
              type="button"
              onClick={() => setShowSimulator((s) => !s)}
              className="rsl-btn-secondary py-1.5 text-xs"
            >
              {showSimulator ? "Hide Sample Voucher Simulator" : "Simulate Sample Voucher Event"}
            </button>
          ) : undefined
        }
      >
        <div className="space-y-4 text-xs">
          {canManageTally && showSimulator && (
            <form
              onSubmit={handleSimulateBill}
              className="rounded-xl border border-amber-200 bg-amber-50/60 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-semibold text-slate-900">
                    Sandbox Voucher Simulation (Adds a Sample SIM-XXXX Entry)
                  </div>
                  <p className="text-[11px] text-zinc-600">
                    Sends a sample JSON voucher through your HTTP webhook endpoint to test WhatsApp
                    template rule matching end-to-end.
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-4">
                <input
                  name="partyName"
                  defaultValue="Sample Customer"
                  required
                  placeholder="Party Ledger Name"
                  className="rsl-input bg-white"
                />
                <input
                  name="partyPhone"
                  placeholder="WhatsApp (+9198...)"
                  className="rsl-input bg-white"
                />
                <input
                  name="amountRupees"
                  type="number"
                  defaultValue={1850}
                  min={1}
                  required
                  placeholder="Amount ₹"
                  className="rsl-input bg-white tabular-nums"
                />
                <select name="voucherType" defaultValue="Sales" className="rsl-input bg-white">
                  <option value="Sales">Sales Invoice</option>
                  <option value="Receipt">Payment Receipt</option>
                  <option value="CreditNote">Credit Note</option>
                </select>
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  type="submit"
                  disabled={isSimulating}
                  className="rsl-btn-primary inline-flex items-center gap-1.5 text-xs"
                >
                  {isSimulating && <IosSpinner size="xs" />}
                  <span>{isSimulating ? "Simulating..." : "Send Sample Voucher"}</span>
                </button>
              </div>
            </form>
          )}

          {syncRuns.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-zinc-200/80 bg-zinc-50/60 px-4 py-3 text-zinc-600">
              <Activity className="h-4 w-4 shrink-0 text-zinc-400" />
              <span>
                No voucher sync batches recorded yet. Load{" "}
                <code className="font-mono text-slate-800">rsl-tally-whatsapp.tdl</code> (v2.5) in
                Tally Prime and click <strong>&ldquo;RSL Sync All Bills Now&rdquo;</strong> on
                Gateway of Tally, or save a new Sales bill with{" "}
                <code className="font-mono">Ctrl + A</code>.
              </span>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-zinc-200/85">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-200/80 bg-zinc-50/80 text-[11px] tracking-wider text-zinc-500 uppercase">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Timestamp</th>
                    <th className="px-4 py-2.5 font-semibold">Source</th>
                    <th className="px-4 py-2.5 font-semibold">Vouchers Synced</th>
                    <th className="px-4 py-2.5 font-semibold">Latency</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {syncRuns.map((run) => (
                    <tr key={run.id}>
                      <td className="px-4 py-2.5 whitespace-nowrap text-zinc-600 tabular-nums">
                        {formatTs(run.createdAt)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-800 uppercase">
                          {run.source}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-slate-900 tabular-nums">
                        {run.vouchersUpserted} voucher(s)
                      </td>
                      <td className="px-4 py-2.5 font-mono text-zinc-500 tabular-nums">
                        {run.durationMs} ms
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <StatusPill
                          label={run.status === "success" ? "Synced" : run.status}
                          tone={run.status === "success" ? "emerald" : "ruby"}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
