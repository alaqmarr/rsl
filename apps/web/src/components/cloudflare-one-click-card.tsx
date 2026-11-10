"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Cloud,
  Cpu,
  Database,
  ExternalLink,
  HardDrive,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { WorkspaceCloudflareStatus } from "@rsl/tenancy";
import {
  GuideDrawerButton,
  IosSpinner,
  SectionCard,
  sileo,
  StatusPill,
} from "@rsl/ui";
import {
  connectWorkspaceCloudflareOneClickJsonAction,
  disconnectWorkspaceCloudflareJsonAction,
  probeWorkspaceCloudflareConnectionJsonAction,
  provisionWorkspaceCloudflareResourceJsonAction,
  updateWorkspaceCloudflareWorkloadsJsonAction,
} from "@/lib/actions";

function CloudflareMarkIcon({ className = "h-4 w-4 shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M16.51 16.5H6.22a3.72 3.72 0 0 1-.46-7.41 5.48 5.48 0 0 1 10.56-1.35 4.12 4.12 0 0 1 3.63 4.09c0 .16-.01.32-.03.47A3.24 3.24 0 0 1 16.51 16.5Z" />
    </svg>
  );
}

export function CloudflareOneClickConnectCard({
  initialStatus,
  canManage,
  compact = false,
}: {
  initialStatus: WorkspaceCloudflareStatus;
  canManage: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<WorkspaceCloudflareStatus>(initialStatus);
  const [showConnectDrawer, setShowConnectDrawer] = useState(false);
  const [apiToken, setApiToken] = useState("");
  const [preferredBucketName, setPreferredBucketName] = useState(initialStatus.r2BucketName);
  const [preferredAccountId, setPreferredAccountId] = useState(
    initialStatus.cloudflareAccountId || ""
  );
  const [useClientR2Storage, setUseClientR2Storage] = useState(
    initialStatus.connected ? initialStatus.useClientR2Storage : true
  );
  const [useClientWorkersAi, setUseClientWorkersAi] = useState(
    initialStatus.connected ? initialStatus.useClientWorkersAi : true
  );
  const [useClientWorkersCompute, setUseClientWorkersCompute] = useState(
    initialStatus.connected ? initialStatus.useClientWorkersCompute : true
  );
  const [textModel, setTextModel] = useState(
    initialStatus.textModel || "@cf/meta/llama-3.1-8b-instruct"
  );
  const [aiGatewaySlug, setAiGatewaySlug] = useState(initialStatus.aiGatewaySlug || "");
  const [newResourceName, setNewResourceName] = useState("");
  const [newResourceType, setNewResourceType] = useState<"r2_bucket" | "kv_namespace">(
    "r2_bucket"
  );
  const [isPending, startTransition] = useTransition();

  function openCloudflarePreFilledPopup() {
    window.open(
      status.oneClickTemplateUrl,
      "rsl_cloudflare_oneclick",
      "width=980,height=780,noopener,noreferrer"
    );
    setShowConnectDrawer(true);
  }

  function handleOneClickSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!apiToken.trim()) {
      sileo.error({ title: "Paste the API token from the Cloudflare 1-Click window first." });
      return;
    }

    startTransition(async () => {
      const fd = new FormData();
      fd.set("apiToken", apiToken.trim());
      if (preferredAccountId.trim()) fd.set("preferredAccountId", preferredAccountId.trim());
      if (preferredBucketName.trim()) fd.set("preferredBucketName", preferredBucketName.trim());
      fd.set("autoCreateR2Bucket", "true");
      fd.set("useClientR2Storage", String(useClientR2Storage));
      fd.set("useClientWorkersAi", String(useClientWorkersAi));
      fd.set("useClientWorkersCompute", String(useClientWorkersCompute));
      if (aiGatewaySlug.trim()) fd.set("aiGatewaySlug", aiGatewaySlug.trim());
      if (textModel.trim()) fd.set("textModel", textModel.trim());

      const res = await connectWorkspaceCloudflareOneClickJsonAction(fd);
      if (!res.ok || !res.status) {
        sileo.error({ title: res.message });
        return;
      }

      setStatus(res.status);
      setApiToken("");
      setShowConnectDrawer(false);
      sileo.success({ title: res.message });
      router.refresh();
    });
  }

  function handleSaveWorkloads(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const fd = new FormData();
      fd.set("useClientR2Storage", String(useClientR2Storage));
      fd.set("useClientWorkersAi", String(useClientWorkersAi));
      fd.set("useClientWorkersCompute", String(useClientWorkersCompute));
      fd.set("r2BucketName", preferredBucketName.trim());
      fd.set("textModel", textModel.trim());
      fd.set("aiGatewaySlug", aiGatewaySlug.trim());

      const res = await updateWorkspaceCloudflareWorkloadsJsonAction(fd);
      if (!res.ok || !res.status) {
        sileo.error({ title: res.message });
        return;
      }
      setStatus(res.status);
      sileo.success({ title: res.message });
      router.refresh();
    });
  }

  function handleProvisionResource(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!newResourceName.trim()) {
      sileo.error({ title: "Enter a name for the R2 bucket or Workers KV namespace." });
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("resourceType", newResourceType);
      fd.set("resourceName", newResourceName.trim());

      const res = await provisionWorkspaceCloudflareResourceJsonAction(fd);
      if (!res.ok || !res.status) {
        sileo.error({ title: res.message });
        return;
      }
      setStatus(res.status);
      setPreferredBucketName(res.status.r2BucketName);
      setNewResourceName("");
      sileo.success({ title: res.message });
      router.refresh();
    });
  }

  function handleLiveProbe() {
    startTransition(async () => {
      const res = await probeWorkspaceCloudflareConnectionJsonAction();
      if (!res.ok) {
        sileo.error({ title: res.message });
        return;
      }
      if (res.status) setStatus(res.status);
      sileo.success({ title: res.message });
      router.refresh();
    });
  }

  function handleDisconnect() {
    startTransition(async () => {
      const res = await disconnectWorkspaceCloudflareJsonAction();
      if (!res.ok || !res.status) {
        sileo.error({ title: res.message });
        return;
      }
      setStatus(res.status);
      setShowConnectDrawer(false);
      sileo.info({ title: res.message });
      router.refresh();
    });
  }

  return (
    <SectionCard
      title="Cloudflare 1-Click Cloud (Your R2 Storage, Workers AI & Compute)"
      subtitle="Connect your Cloudflare account in 1 click so R2 object storage, Workers AI inference, and edge compute run on your own account while Turnstile CAPTCHA and baseline security remain managed by RapidShift Labs."
      accent="amber"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <GuideDrawerButton
            label="Need help? • Cloudflare 1-Click Guide"
            badgeText="3 steps"
            guide={{
              eyebrow: "Bring Your Own Cloudflare Cloud",
              title: "1-Click Cloudflare R2, Workers AI & Compute",
              summary:
                "Link your Cloudflare account with a pre-scoped token so R2 buckets, S3 credentials, Workers AI models, and KV compute are provisioned automatically.",
              estimatedTime: "~60 sec",
              steps: [
                {
                  title: "Click 1-Click Authorize on Cloudflare",
                  detail:
                    "Opens Cloudflare's official API Token template with R2 Storage (Edit), Workers AI (Edit), Workers Scripts (Edit), Workers KV (Edit), D1 (Edit), and Account Settings (Read) pre-selected.",
                },
                {
                  title: "Create Token & Paste Back",
                  detail:
                    "Click 'Continue to summary -> Create Token' on Cloudflare and paste the token here. RapidShift automatically discovers your Account ID, derives S3 Access Key ID + SHA-256 Secret Key, and creates your R2 bucket.",
                },
                {
                  title: "Split Responsibility (Ours vs. Yours)",
                  detail:
                    "Turnstile Bot Protection (CAPTCHA) and baseline email routing always stay on RapidShift Labs' platform account. Your connected Cloudflare account powers your R2 files/backups, Workers AI drafts/translations, and edge compute.",
                },
              ],
              fullGuideHref: "/help?slug=storage-r2-and-backups",
              fullGuideLabel: "Open Cloud & R2 Documentation",
            }}
          />
          <StatusPill
            label={
              status.connected
                ? `Connected • ${status.cloudflareAccountName}`
                : "Using RSL Platform Defaults"
            }
            tone={status.connected ? "emerald" : "stone"}
          />
        </div>
      }
    >
      <div className="space-y-4">
        {/* Split-Responsibility Architecture Strip */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rsl-frost-surface rounded-xl p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--ink)]">
                <ShieldCheck className="h-3.5 w-3.5 text-[var(--accent)]" />
                <span>Turnstile CAPTCHA &amp; Security</span>
              </span>
              <span className="rsl-pill rsl-pill-forest !px-2 !py-0.5 !text-[10.5px]">
                RSL Platform (Ours)
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              Bot protection &amp; baseline email routing are always managed by RapidShift Labs.
            </p>
          </div>

          <div className="rsl-frost-surface rounded-xl p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--ink)]">
                <HardDrive className="h-3.5 w-3.5 text-[var(--sunset-orange)]" />
                <span>R2 Object Storage</span>
              </span>
              <span
                className={`rsl-pill !px-2 !py-0.5 !text-[10.5px] ${
                  status.connected && status.useClientR2Storage
                    ? "rsl-pill-sunset"
                    : "rsl-pill-cream"
                }`}
              >
                {status.connected && status.useClientR2Storage
                  ? `Your R2 (${status.r2BucketName})`
                  : "RSL Managed Vault"}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              {status.connected && status.useClientR2Storage
                ? `Zero-egress S3 endpoint active on ${status.cloudflareAccountName}.`
                : "Connect your Cloudflare account to store files & backups in your own R2 bucket."}
            </p>
          </div>

          <div className="rsl-frost-surface rounded-xl p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--ink)]">
                <Sparkles className="h-3.5 w-3.5 text-[var(--sunset-orange)]" />
                <span>Workers AI Inference</span>
              </span>
              <span
                className={`rsl-pill !px-2 !py-0.5 !text-[10.5px] ${
                  status.connected && status.useClientWorkersAi
                    ? "rsl-pill-sunset"
                    : "rsl-pill-cream"
                }`}
              >
                {status.connected && status.useClientWorkersAi
                  ? "Your Cloudflare AI"
                  : "Platform Fallback"}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              {status.connected && status.useClientWorkersAi
                ? `Ad copy, review replies, translations & Whisper run on ${status.textModel}.`
                : "Runs on your own 10,000 free daily Cloudflare AI neurons once connected."}
            </p>
          </div>

          <div className="rsl-frost-surface rounded-xl p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--ink)]">
                <Cpu className="h-3.5 w-3.5 text-[var(--accent)]" />
                <span>Workers Compute, KV &amp; D1</span>
              </span>
              <span
                className={`rsl-pill !px-2 !py-0.5 !text-[10.5px] ${
                  status.connected && status.useClientWorkersCompute
                    ? "rsl-pill-sunset"
                    : "rsl-pill-cream"
                }`}
              >
                {status.connected && status.useClientWorkersCompute
                  ? `${status.workersScripts.length} Workers • ${status.kvNamespaces.length} KV`
                  : "Platform Default"}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              {status.connected
                ? `${status.availableR2Buckets.length} R2 buckets, ${status.kvNamespaces.length} KV namespaces & ${status.d1Databases.length} D1 DBs discovered.`
                : "Auto-discovers & provisions Workers KV and edge compute on your account."}
            </p>
          </div>
        </div>

        {/* Connected State vs. 1-Click Connect CTA */}
        {!status.connected ? (
          <div className="rsl-hero-surface rounded-2xl p-5">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-2">
                  <span className="rsl-pill rsl-pill-sunset">
                    <CloudflareMarkIcon className="h-3.5 w-3.5" />
                    <span>1-Click Pre-Scoped Cloudflare Connect</span>
                  </span>
                </div>
                <h3 className="text-base font-semibold text-[var(--ink-on-dark)]">
                  Use Your Own Cloudflare R2 Storage, Workers AI &amp; Compute in 1 Click
                </h3>
                <p className="max-w-2xl text-xs leading-relaxed text-[var(--ink-on-dark-muted)]">
                  No manual S3 key hashing or hunting for Account IDs. Click{" "}
                  <strong>1-Click Authorize on Cloudflare</strong> to open Cloudflare with all R2,
                  Workers AI, and Compute permissions pre-filled, then paste the token to auto-create
                  your R2 bucket and activate your AI models.
                </p>
              </div>

              {canManage && (
                <div className="flex shrink-0 flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={openCloudflarePreFilledPopup}
                    className="rsl-btn-spark inline-flex items-center gap-2 text-xs font-semibold"
                  >
                    <CloudflareMarkIcon className="h-4 w-4" />
                    <span>1-Click Authorize on Cloudflare</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowConnectDrawer((v) => !v)}
                    className="rsl-btn-secondary !bg-white/10 !text-[var(--butter-cream)] !border-white/20 text-xs"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    <span>{showConnectDrawer ? "Hide Token Step" : "Paste Token"}</span>
                  </button>
                </div>
              )}
            </div>

            {showConnectDrawer && canManage && (
              <form
                onSubmit={handleOneClickSubmit}
                className="mt-4 space-y-4 rounded-xl border border-white/15 bg-black/25 p-4"
              >
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-[var(--butter-cream)]">
                      Step 2: Paste Cloudflare API Token (from 1-Click Popup)
                    </label>
                    <input
                      type="password"
                      value={apiToken}
                      onChange={(e) => setApiToken(e.target.value)}
                      placeholder="Paste token from dash.cloudflare.com/profile/api-tokens..."
                      required
                      className="rsl-input mt-1 w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--butter-cream)]">
                      R2 Bucket (Auto-Created if New)
                    </label>
                    <input
                      type="text"
                      value={preferredBucketName}
                      onChange={(e) => setPreferredBucketName(e.target.value)}
                      placeholder="rsl-vault-workspace"
                      className="rsl-input mt-1 w-full"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--ink-on-dark-muted)]">
                      Cloudflare Account ID (Auto-Discovered if blank)
                    </label>
                    <input
                      type="text"
                      value={preferredAccountId}
                      onChange={(e) => setPreferredAccountId(e.target.value)}
                      placeholder="Optional - auto-detected via API"
                      className="rsl-input mt-1 w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--ink-on-dark-muted)]">
                      Workers AI Text Model
                    </label>
                    <input
                      type="text"
                      value={textModel}
                      onChange={(e) => setTextModel(e.target.value)}
                      placeholder="@cf/meta/llama-3.1-8b-instruct"
                      className="rsl-input mt-1 w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--ink-on-dark-muted)]">
                      AI Gateway Slug (Optional)
                    </label>
                    <input
                      type="text"
                      value={aiGatewaySlug}
                      onChange={(e) => setAiGatewaySlug(e.target.value)}
                      placeholder="Optional caching gateway slug"
                      className="rsl-input mt-1 w-full"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/15 pt-3">
                  <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--ink-on-dark)]">
                    <label className="inline-flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={useClientR2Storage}
                        onChange={(e) => setUseClientR2Storage(e.target.checked)}
                        className="h-4 w-4 rounded"
                      />
                      <span>Use my R2 Storage</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={useClientWorkersAi}
                        onChange={(e) => setUseClientWorkersAi(e.target.checked)}
                        className="h-4 w-4 rounded"
                      />
                      <span>Use my Workers AI</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={useClientWorkersCompute}
                        onChange={(e) => setUseClientWorkersCompute(e.target.checked)}
                        className="h-4 w-4 rounded"
                      />
                      <span>Enable Workers Compute &amp; KV</span>
                    </label>
                  </div>

                  <button
                    type="submit"
                    disabled={isPending}
                    className="rsl-btn-spark inline-flex items-center gap-2 text-xs font-semibold"
                  >
                    {isPending ? <IosSpinner size="xs" /> : <Cloud className="h-4 w-4" />}
                    <span>Complete 1-Click Connect &amp; Auto-Provision</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rsl-frost-surface flex flex-col justify-between gap-4 rounded-2xl p-4 lg:flex-row lg:items-center">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rsl-pill rsl-pill-forest">
                    <CloudflareMarkIcon className="h-3.5 w-3.5" />
                    <span>{status.cloudflareAccountName}</span>
                  </span>
                  <span className="text-xs font-medium text-[var(--ink-muted)] tabular-nums">
                    Account ID: <code>{status.cloudflareAccountId}</code>
                  </span>
                  <span className="text-xs font-medium text-[var(--ink-muted)] tabular-nums">
                    S3 Access Key: <code>{status.maskedS3AccessKeyId}</code>
                  </span>
                </div>
                <p className="text-xs text-[var(--ink-secondary)]">
                  {status.lastVerifyMessage ||
                    `Active R2 Endpoint: ${status.r2EndpointUrl} • Bucket: ${status.r2BucketName}`}
                </p>
              </div>

              {canManage && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={handleLiveProbe}
                    className="rsl-btn-secondary inline-flex items-center gap-1.5 text-xs"
                  >
                    {isPending ? <IosSpinner size="xs" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    <span>Test R2 &amp; Workers AI Live</span>
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => setShowConnectDrawer((v) => !v)}
                    className="rsl-btn-secondary text-xs"
                  >
                    {showConnectDrawer ? "Close Token Update" : "Rotate Token"}
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={handleDisconnect}
                    className="rsl-btn-danger-soft text-xs"
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>

            {!compact && canManage && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {/* Workload Routing & Bucket Selection */}
                <form
                  onSubmit={handleSaveWorkloads}
                  className="rsl-frost-surface space-y-3 rounded-2xl p-4 lg:col-span-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[var(--ink)]">
                      Client Cloud Workload Routing
                    </span>
                    <span className="text-xs text-[var(--ink-muted)]">
                      CAPTCHA stays on RapidShift Labs
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="rsl-label">Active R2 Bucket</label>
                      {status.availableR2Buckets.length > 0 ? (
                        <select
                          value={preferredBucketName}
                          onChange={(e) => setPreferredBucketName(e.target.value)}
                          className="rsl-input w-full"
                        >
                          {status.availableR2Buckets.map((b) => (
                            <option key={b.name} value={b.name}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={preferredBucketName}
                          onChange={(e) => setPreferredBucketName(e.target.value)}
                          className="rsl-input w-full"
                        />
                      )}
                    </div>

                    <div>
                      <label className="rsl-label">Workers AI Text Model</label>
                      <input
                        type="text"
                        value={textModel}
                        onChange={(e) => setTextModel(e.target.value)}
                        className="rsl-input w-full"
                      />
                    </div>

                    <div>
                      <label className="rsl-label">AI Gateway Slug (Optional)</label>
                      <input
                        type="text"
                        value={aiGatewaySlug}
                        onChange={(e) => setAiGatewaySlug(e.target.value)}
                        placeholder="e.g. rsl-ai-gateway"
                        className="rsl-input w-full"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
                    <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-[var(--ink)]">
                      <label className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={useClientR2Storage}
                          onChange={(e) => setUseClientR2Storage(e.target.checked)}
                          className="h-4 w-4 rounded"
                        />
                        <span>R2 Object Storage (Theirs)</span>
                      </label>
                      <label className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={useClientWorkersAi}
                          onChange={(e) => setUseClientWorkersAi(e.target.checked)}
                          className="h-4 w-4 rounded"
                        />
                        <span>Workers AI Inference (Theirs)</span>
                      </label>
                      <label className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={useClientWorkersCompute}
                          onChange={(e) => setUseClientWorkersCompute(e.target.checked)}
                          className="h-4 w-4 rounded"
                        />
                        <span>Workers Compute &amp; KV (Theirs)</span>
                      </label>
                    </div>

                    <button
                      type="submit"
                      disabled={isPending}
                      className="rsl-btn-primary text-xs"
                    >
                      Save Workload Routing
                    </button>
                  </div>
                </form>

                {/* 1-Click Provision New R2 Bucket or Workers KV Namespace */}
                <form
                  onSubmit={handleProvisionResource}
                  className="rsl-frost-surface flex flex-col justify-between space-y-3 rounded-2xl p-4"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink)]">
                      <Database className="h-3.5 w-3.5 text-[var(--sunset-orange)]" />
                      <span>1-Click Provision R2 / KV Resource</span>
                    </div>
                    <div>
                      <label className="rsl-label">Resource Type</label>
                      <select
                        value={newResourceType}
                        onChange={(e) =>
                          setNewResourceType(
                            e.target.value === "kv_namespace" ? "kv_namespace" : "r2_bucket"
                          )
                        }
                        className="rsl-input w-full"
                      >
                        <option value="r2_bucket">Cloudflare R2 Storage Bucket</option>
                        <option value="kv_namespace">Cloudflare Workers KV Namespace</option>
                      </select>
                    </div>
                    <div>
                      <label className="rsl-label">
                        {newResourceType === "r2_bucket" ? "New Bucket Name" : "New KV Title"}
                      </label>
                      <input
                        type="text"
                        value={newResourceName}
                        onChange={(e) => setNewResourceName(e.target.value)}
                        placeholder={
                          newResourceType === "r2_bucket"
                            ? "rsl-invoices-bucket"
                            : "rsl-edge-routing-kv"
                        }
                        className="rsl-input w-full"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isPending}
                    className="rsl-btn-secondary inline-flex w-full items-center justify-center gap-1.5 text-xs"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>
                      {newResourceType === "r2_bucket"
                        ? "Create & Switch R2 Bucket"
                        : "Create Workers KV Namespace"}
                    </span>
                  </button>
                </form>
              </div>
            )}

            {showConnectDrawer && canManage && (
              <form
                onSubmit={handleOneClickSubmit}
                className="rsl-frost-surface space-y-3 rounded-2xl p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[var(--ink)]">
                    Rotate or Switch Cloudflare Account Token
                  </span>
                  <button
                    type="button"
                    onClick={openCloudflarePreFilledPopup}
                    className="rsl-btn-secondary inline-flex items-center gap-1.5 text-xs"
                  >
                    <CloudflareMarkIcon className="h-3.5 w-3.5" />
                    <span>Open Cloudflare 1-Click Token Template ↗</span>
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <input
                    type="password"
                    value={apiToken}
                    onChange={(e) => setApiToken(e.target.value)}
                    placeholder="Paste new Cloudflare API token..."
                    required
                    className="rsl-input min-w-[240px] flex-1"
                  />
                  <button
                    type="submit"
                    disabled={isPending}
                    className="rsl-btn-primary text-xs"
                  >
                    Verify &amp; Save Token
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
