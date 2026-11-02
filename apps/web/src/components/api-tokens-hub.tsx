"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmptyWorkspaceState, IosSpinner, MetricCard, SectionCard, sileo, StatusPill } from "@rsl/ui";
import type { ConnectionChannelKind } from "@rsl/connections";
import { ApiSandbox } from "@/components/api-sandbox";
import { CopyTextButton } from "@/components/client-utils";
import { PlanActivationModal } from "@/components/plan-activation-modal";
import {
  createOutboundWebhookJsonAction,
  deleteOutboundWebhookJsonAction,
  disconnectConnectionJsonAction,
  issueApiKeyJsonAction,
  revokeApiKeyJsonAction,
  rotateApiKeyJsonAction,
  rotateMetaVerifyTokenJsonAction,
  rotateTallyTokenJsonAction,
  testOutboundWebhookJsonAction,
  testTallyEndpointHandshakeJsonAction,
  updateConnectionJsonAction,
  verifyConnectionLiveJsonAction,
} from "@/lib/actions";

export interface TokenChannelItem {
  id: string;
  provider: string;
  channelKind: ConnectionChannelKind;
  displayName: string;
  externalAccountId: string;
  maskedTokenHint: string;
  status: string;
  lastHealthCheckAt: number | null;
  lastLiveCheckMessage?: string;
  tokenMode?: "live" | "sandbox";
}

export interface TokenApiKeyItem {
  id: string;
  name: string;
  maskedKey: string;
  scopes: string[];
  rateLimitPerMin: number;
  lastUsedAt: number | null;
  lastUsedIp: string | null;
  status: string;
}

export interface TokenOutboundWebhookItem {
  id: string;
  name: string;
  targetUrl: string;
  signingSecret: string;
  events: string[];
  lastDeliveryStatus: string | null;
}

export interface ApiTokensHubProps {
  workspaceSlug: string;
  channels: TokenChannelItem[];
  canManageConnections: boolean;
  tallyToken: string;
  tallyWebhookUrl: string;
  tallyCleanEndpointUrl?: string;
  tallyLiveStatusLabel?: string;
  tallyLiveStatusDetail?: string;
  tallyLiveStatusTone?: "success" | "info" | "warning" | "danger" | "neutral";
  tallyEventsCount?: number;
  tallyPingsCount?: number;
  canManageTally: boolean;
  metaVerifyToken: string;
  whatsappWebhookUrl: string;
  metaWebhookUrl: string;
  hasApiEntitlement: boolean;
  canManageApiKeys: boolean;
  apiKeys: TokenApiKeyItem[];
  outboundWebhooks: TokenOutboundWebhookItem[];
  apiScopes: Array<{ key: string; label: string }>;
  webhookEvents: Array<{ key: string; label: string }>;
  initialRevealedKey?: string;
  lockedApiPlan?: {
    key: string;
    name: string;
    tagline: string;
    includedFeatures: string[];
    monthlyAmountPaise: number;
    quarterlyAmountPaise: number;
    yearlyAmountPaise: number;
    hasCustomPriceOverride: boolean;
    isPending: boolean;
    pendingCycle?: string | null;
  } | null;
  billingSettings: {
    upiQrMode?: "bank_account" | "upi_id";
    upiId: string;
    payeeName: string;
    bankName: string;
    accountNumber: string;
    ifscCode: string;
  };
}

const CHANNEL_KIND_LABELS: Record<ConnectionChannelKind, string> = {
  whatsapp_cloud: "WhatsApp Cloud API",
  instagram_business: "Instagram Business",
  facebook_page: "Facebook Page",
  meta_ads_pixel: "Meta Ads & Pixel",
  google_business: "Google Business Profile",
  google_drive: "Google Drive Backup",
};

function maskMiddle(token: string): string {
  if (token.length <= 12) return "••••••••••••";
  return `${token.slice(0, 8)}••••••••••••••••${token.slice(-4)}`;
}

export function ApiTokensHub({
  workspaceSlug,
  channels,
  canManageConnections,
  tallyToken: initialTallyToken,
  tallyWebhookUrl: initialTallyUrl,
  tallyCleanEndpointUrl,
  tallyLiveStatusLabel = "Awaiting Connection",
  tallyLiveStatusDetail = "Run Live Endpoint Check or load .tdl in Tally Prime",
  tallyLiveStatusTone = "warning",
  tallyEventsCount = 0,
  tallyPingsCount = 0,
  canManageTally,
  metaVerifyToken: initialVerifyToken,
  whatsappWebhookUrl,
  metaWebhookUrl,
  hasApiEntitlement,
  canManageApiKeys,
  apiKeys,
  outboundWebhooks,
  apiScopes,
  webhookEvents,
  initialRevealedKey,
  lockedApiPlan,
  billingSettings,
}: ApiTokensHubProps) {
  const router = useRouter();

  const [tallyToken, setTallyToken] = useState(initialTallyToken);
  const [tallyUrl, setTallyUrl] = useState(initialTallyUrl);
  const [revealTally, setRevealTally] = useState(false);

  const [verifyToken, setVerifyToken] = useState(initialVerifyToken);
  const [revealVerify, setRevealVerify] = useState(false);

  const [revealedRawKey, setRevealedRawKey] = useState<string | undefined>(initialRevealedKey);
  const [rotatingChannelId, setRotatingChannelId] = useState<string | null>(null);
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);

  const [isRotatingTally, startRotateTally] = useTransition();
  const [isTestingTally, startTestTally] = useTransition();
  const [tallyStatusText, setTallyStatusText] = useState(tallyLiveStatusLabel);
  const [tallyStatusSub, setTallyStatusSub] = useState(tallyLiveStatusDetail);
  const [isRotatingVerify, startRotateVerify] = useTransition();
  const [isIssuingKey, startIssueKey] = useTransition();
  const [isAddingWebhook, startAddWebhook] = useTransition();
  const [, startRowAction] = useTransition();

  const activeApiKeysCount = apiKeys.filter((k) => k.status === "active").length;
  const healthyChannelsCount = channels.filter((c) => c.status === "healthy").length;

  function handleRotateTally() {
    startRotateTally(async () => {
      const res = await rotateTallyTokenJsonAction();
      if (res.ok && res.webhookToken && res.webhookUrl) {
        setTallyToken(res.webhookToken);
        setTallyUrl(res.webhookUrl);
        setRevealTally(true);
        sileo.success({
          title: "Tally Webhook Token Rotated",
          description: res.message,
          duration: 5000,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Could Not Rotate Tally Token",
          description: res.message,
          duration: 5000,
        });
      }
    });
  }

  function handleRotateVerify() {
    startRotateVerify(async () => {
      const res = await rotateMetaVerifyTokenJsonAction();
      if (res.ok && res.verifyToken) {
        setVerifyToken(res.verifyToken);
        setRevealVerify(true);
        sileo.success({
          title: "Meta Verify Token Rotated",
          description: res.message,
          duration: 5000,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Could Not Rotate Verify Token",
          description: res.message,
          duration: 5000,
        });
      }
    });
  }

  function handleChannelRotateSubmit(channelId: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    fd.set("connectionId", channelId);
    fd.set("testLiveAfterSave", "1");
    setPendingActionKey(`ch-rotate:${channelId}`);

    startRowAction(async () => {
      const res = await updateConnectionJsonAction(fd);
      setPendingActionKey(null);
      if (res.ok) {
        formEl.reset();
        setRotatingChannelId(null);
        if (res.liveStatus === "needs_reauth") {
          sileo.error({
            title: "Token Saved, Live Check Reported Error",
            description: res.message,
            duration: 6200,
          });
        } else {
          sileo.success({
            title: "Channel Access Token Rotated",
            description: res.message,
            duration: 4800,
          });
        }
        router.refresh();
      } else {
        sileo.error({
          title: "Token Rotation Failed",
          description: res.message,
          duration: 5200,
        });
      }
    });
  }

  function handleChannelVerify(ch: TokenChannelItem) {
    setPendingActionKey(`ch-verify:${ch.id}`);
    startRowAction(async () => {
      const fd = new FormData();
      fd.set("connectionId", ch.id);
      const res = await verifyConnectionLiveJsonAction(fd);
      setPendingActionKey(null);
      if (res.ok) {
        sileo.success({
          title: `${ch.displayName} Verified`,
          description: res.message,
          duration: 4600,
        });
      } else {
        sileo.error({
          title: `${ch.displayName} Needs Re-Auth`,
          description: res.message,
          duration: 6200,
        });
      }
      router.refresh();
    });
  }

  function handleChannelDisconnect(ch: TokenChannelItem) {
    setPendingActionKey(`ch-disc:${ch.id}`);
    startRowAction(async () => {
      const fd = new FormData();
      fd.set("connectionId", ch.id);
      const res = await disconnectConnectionJsonAction(fd);
      setPendingActionKey(null);
      if (res.ok) {
        sileo.success({
          title: "Channel Token Purged",
          description: res.message,
          duration: 4200,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Disconnect Failed",
          description: res.message,
          duration: 5000,
        });
      }
    });
  }

  function handleIssueApiKey(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    startIssueKey(async () => {
      const res = await issueApiKeyJsonAction(fd);
      if (res.ok && res.rawKey) {
        setRevealedRawKey(res.rawKey);
        formEl.reset();
        sileo.success({
          title: "API Key Issued",
          description: res.message,
          duration: 5500,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Could Not Issue API Key",
          description: res.message,
          duration: 5200,
        });
      }
    });
  }

  function handleRotateApiKey(keyId: string) {
    setPendingActionKey(`key-rotate:${keyId}`);
    startRowAction(async () => {
      const fd = new FormData();
      fd.set("keyId", keyId);
      const res = await rotateApiKeyJsonAction(fd);
      setPendingActionKey(null);
      if (res.ok && res.rawKey) {
        setRevealedRawKey(res.rawKey);
        sileo.success({
          title: "API Key Rotated",
          description: res.message,
          duration: 5500,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Rotate Failed",
          description: res.message,
          duration: 5200,
        });
      }
    });
  }

  function handleRevokeApiKey(keyId: string) {
    setPendingActionKey(`key-revoke:${keyId}`);
    startRowAction(async () => {
      const fd = new FormData();
      fd.set("keyId", keyId);
      const res = await revokeApiKeyJsonAction(fd);
      setPendingActionKey(null);
      if (res.ok) {
        sileo.success({
          title: "API Key Revoked",
          description: res.message,
          duration: 4200,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Revoke Failed",
          description: res.message,
          duration: 5000,
        });
      }
    });
  }

  function handleCreateWebhook(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    startAddWebhook(async () => {
      const res = await createOutboundWebhookJsonAction(fd);
      if (res.ok) {
        formEl.reset();
        sileo.success({
          title: "Outbound Webhook Saved",
          description: res.message,
          duration: 4600,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Could Not Save Webhook",
          description: res.message,
          duration: 5200,
        });
      }
    });
  }

  function handleTestWebhook(endpointId: string) {
    setPendingActionKey(`wh-test:${endpointId}`);
    startRowAction(async () => {
      const fd = new FormData();
      fd.set("endpointId", endpointId);
      const res = await testOutboundWebhookJsonAction(fd);
      setPendingActionKey(null);
      if (res.ok) {
        sileo.success({
          title: "Webhook Test Sent",
          description: res.message,
          duration: 4800,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Webhook Test Failed",
          description: res.message,
          duration: 5200,
        });
      }
    });
  }

  function handleDeleteWebhook(endpointId: string) {
    setPendingActionKey(`wh-del:${endpointId}`);
    startRowAction(async () => {
      const fd = new FormData();
      fd.set("endpointId", endpointId);
      const res = await deleteOutboundWebhookJsonAction(fd);
      setPendingActionKey(null);
      if (res.ok) {
        sileo.success({
          title: "Webhook Removed",
          description: res.message,
          duration: 4200,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Remove Failed",
          description: res.message,
          duration: 5000,
        });
      }
    });
  }

  function handleTestTallyEndpoint() {
    startTestTally(async () => {
      const res = await testTallyEndpointHandshakeJsonAction();
      if (res.ok) {
        if (res.statusLabel) setTallyStatusText(res.statusLabel);
        setTallyStatusSub(res.message);
        sileo.success({
          title: `Tally Endpoint Verified (${res.latencyMs ?? 1}ms)`,
          description: res.message,
          duration: 4500,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Tally Endpoint Check Failed",
          description: res.message,
          duration: 5000,
        });
      }
    });
  }

  return (
    <div className="w-full space-y-6">
      {/* Unified Vault Summary Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="External Channel Tokens"
          value={`${healthyChannelsCount}/${channels.length}`}
          sublabel="WhatsApp, Instagram, Facebook & Google"
          accent="emerald"
        />
        <MetricCard
          label="Tally Prime Webhook"
          value={tallyStatusText}
          sublabel={`${tallyEventsCount} voucher(s) • ${tallyPingsCount} check(s)`}
          accent={
            tallyLiveStatusTone === "success"
              ? "emerald"
              : tallyLiveStatusTone === "info"
                ? "sky"
                : tallyLiveStatusTone === "danger"
                  ? "ruby"
                  : "amber"
          }
        />
        <MetricCard
          label="Meta Webhook Verify Token"
          value="Ready"
          sublabel="Verifies WhatsApp, IG & Page callbacks"
          accent="sky"
        />
        <MetricCard
          label="Platform REST API Keys"
          value={hasApiEntitlement ? String(activeApiKeysCount) : "Locked"}
          sublabel={
            hasApiEntitlement
              ? `${outboundWebhooks.length} signed outbound webhook(s)`
              : "Unlock Developer API plan below"
          }
          accent={hasApiEntitlement ? "emerald" : "amber"}
        />
      </div>

      {/* SECTION 1: External Channel Access Tokens */}
      <SectionCard
        title={`1. External Channel Access Tokens (${channels.length})`}
        subtitle="Encrypted OAuth & System User tokens for WhatsApp Cloud API, Instagram Business, Facebook Pages, Meta Ads, and Google"
        action={
          <Link href="/connections" className="rsl-btn-primary py-1.5 text-xs">
            + Connect Channel &amp; Whitelisting Steps
          </Link>
        }
      >
        {channels.length === 0 ? (
          <EmptyWorkspaceState
            title="No external channel tokens stored yet"
            description="Open the Connected Channels & Whitelisting Studio to link WhatsApp Business Cloud API, Instagram Business, Facebook Page, or Google Business Profile."
            actionLabel="Open Channel Whitelisting Studio"
            actionHref="/connections"
          />
        ) : (
          <div className="divide-y divide-zinc-200/80 text-[13px]">
            {channels.map((ch) => {
              const statusTone =
                ch.status === "healthy" ? "emerald" : ch.status === "expiring" ? "amber" : "ruby";
              const statusLabel =
                ch.status === "healthy"
                  ? "Healthy"
                  : ch.status === "expiring"
                    ? "Expiring Soon"
                    : "Needs Re-Auth";
              const isRotating = rotatingChannelId === ch.id;
              const isSavingRotate = pendingActionKey === `ch-rotate:${ch.id}`;
              const isVerifying = pendingActionKey === `ch-verify:${ch.id}`;
              const isDisconnecting = pendingActionKey === `ch-disc:${ch.id}`;

              return (
                <div key={ch.id} className="py-3.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900">{ch.displayName}</span>
                        <span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                          {CHANNEL_KIND_LABELS[ch.channelKind] ?? ch.provider.toUpperCase()}
                        </span>
                        <StatusPill label={statusLabel} tone={statusTone} />
                        {ch.tokenMode === "sandbox" && (
                          <StatusPill label="Sandbox" tone="stone" showDot={false} />
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                        <span>
                          Account ID:{" "}
                          <strong className="font-mono text-slate-800">
                            {ch.externalAccountId}
                          </strong>
                        </span>
                        <span>
                          • Vault Token:{" "}
                          <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-800">
                            {ch.maskedTokenHint}
                          </code>
                        </span>
                        {ch.lastLiveCheckMessage && (
                          <span className="text-zinc-500">• {ch.lastLiveCheckMessage}</span>
                        )}
                      </div>
                    </div>

                    {canManageConnections && (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={Boolean(pendingActionKey)}
                          onClick={() => handleChannelVerify(ch)}
                          className="rsl-btn-secondary inline-flex items-center gap-1.5 py-1.5 text-xs"
                        >
                          {isVerifying && <IosSpinner size="xs" />}
                          <span>{isVerifying ? "Testing..." : "Test Live API"}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setRotatingChannelId(isRotating ? null : ch.id)}
                          className="rsl-btn-secondary py-1.5 text-xs"
                        >
                          {isRotating ? "Cancel" : "Rotate Token"}
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(pendingActionKey)}
                          onClick={() => handleChannelDisconnect(ch)}
                          className="rsl-btn-danger-soft inline-flex items-center gap-1.5 py-1.5 text-xs"
                        >
                          {isDisconnecting && <IosSpinner size="xs" />}
                          <span>Disconnect</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {isRotating && canManageConnections && (
                    <form
                      onSubmit={(e) => handleChannelRotateSubmit(ch.id, e)}
                      className="mt-3 flex flex-wrap items-center gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50/80 p-3"
                    >
                      <input
                        name="accessToken"
                        type="password"
                        required
                        minLength={6}
                        placeholder="Paste new Permanent System User / OAuth token..."
                        className="rsl-input min-w-[240px] flex-1 bg-white font-mono text-xs"
                      />
                      <button
                        type="submit"
                        disabled={isSavingRotate}
                        className="rsl-btn-primary inline-flex items-center gap-1.5 py-2 text-xs"
                      >
                        {isSavingRotate && <IosSpinner size="xs" className="text-white" />}
                        <span>{isSavingRotate ? "Rotating..." : "Save & Test Token"}</span>
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* SECTION 2: Tally Prime Webhook Token & Meta Inbound Verify Token */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <SectionCard
          title="2. Tally Prime Inbound Webhook Token"
          subtitle={tallyStatusSub}
          action={
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={isTestingTally}
                onClick={handleTestTallyEndpoint}
                className="rsl-btn-primary inline-flex items-center gap-1.5 py-1.5 text-xs"
              >
                {isTestingTally && <IosSpinner size="xs" />}
                <span>{isTestingTally ? "Checking..." : "Test Endpoint"}</span>
              </button>
              <a href="/api/export/tally-tdl" className="rsl-btn-secondary py-1.5 text-xs">
                Download .tdl
              </a>
            </div>
          }
        >
          <div className="space-y-3.5 text-[13px]">
            <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/75 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-900">
                  Header Token (X-Tally-Webhook-Token)
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRevealTally((v) => !v)}
                    className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-zinc-100"
                  >
                    {revealTally ? "Hide" : "Reveal"}
                  </button>
                  <CopyTextButton text={tallyToken} label="Copy Token" copiedLabel="Copied" />
                  {canManageTally && (
                    <button
                      type="button"
                      disabled={isRotatingTally}
                      onClick={handleRotateTally}
                      className="rsl-btn-secondary inline-flex items-center gap-1.5 py-1 text-xs"
                    >
                      {isRotatingTally && <IosSpinner size="xs" />}
                      <span>Rotate Token</span>
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-2 break-all rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-xs font-semibold text-slate-900">
                {revealTally ? tallyToken : maskMiddle(tallyToken)}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/75 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-900">
                  Cloud Subdomain Tally Webhook Endpoint
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {tallyCleanEndpointUrl && (
                    <CopyTextButton
                      text={tallyCleanEndpointUrl}
                      label="Copy Clean URL"
                      copiedLabel="Copied"
                    />
                  )}
                  <CopyTextButton text={tallyUrl} label="Copy URL + Token" copiedLabel="Copied URL" />
                </div>
              </div>
              <div className="mt-2 break-all rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-xs font-semibold text-emerald-800">
                POST {revealTally ? tallyUrl : tallyUrl.replace(tallyToken, maskMiddle(tallyToken))}
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="3. Meta & WhatsApp Inbound Webhook Verify Token"
          subtitle="Used when verifying Callback URLs in Meta App Dashboard (WhatsApp, Instagram & Pages)"
        >
          <div className="space-y-3.5 text-[13px]">
            <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/75 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-900">
                  Verify Token (hub.verify_token)
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRevealVerify((v) => !v)}
                    className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-zinc-100"
                  >
                    {revealVerify ? "Hide" : "Reveal"}
                  </button>
                  <CopyTextButton text={verifyToken} label="Copy Verify Token" copiedLabel="Copied" />
                  {canManageConnections && (
                    <button
                      type="button"
                      disabled={isRotatingVerify}
                      onClick={handleRotateVerify}
                      className="rsl-btn-secondary inline-flex items-center gap-1.5 py-1 text-xs"
                    >
                      {isRotatingVerify && <IosSpinner size="xs" />}
                      <span>Rotate Token</span>
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-2 break-all rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-xs font-semibold text-slate-900">
                {revealVerify ? verifyToken : maskMiddle(verifyToken)}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/75 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-800">WhatsApp URL</span>
                  <CopyTextButton text={whatsappWebhookUrl} label="Copy" />
                </div>
                <div className="mt-1 break-all font-mono text-[11px] text-emerald-800">
                  {whatsappWebhookUrl}
                </div>
              </div>
              <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/75 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-800">IG &amp; Page URL</span>
                  <CopyTextButton text={metaWebhookUrl} label="Copy" />
                </div>
                <div className="mt-1 break-all font-mono text-[11px] text-emerald-800">
                  {metaWebhookUrl}
                </div>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* SECTION 3: Platform Developer REST API Keys & Outbound Signed Webhooks */}
      {!hasApiEntitlement ? (
        <SectionCard
          title="4. Platform Developer REST API Keys (rsl_live_...) & Outbound Webhooks"
          subtitle="Issue scoped Bearer API keys for custom ERP, e-commerce, or CRM software and receive signed X-RSL-Signature webhooks"
          action={<StatusPill label="Requires Developer API Plan" tone="amber" />}
        >
          <div className="flex flex-col justify-between gap-4 rounded-xl border border-zinc-200/90 bg-zinc-50/75 p-5 sm:flex-row sm:items-center">
            <div className="max-w-2xl space-y-1.5 text-[13px]">
              <div className="font-bold text-slate-900">
                Unlock Scoped Live &amp; Sandbox REST API Keys + Outbound Signed Webhooks
              </div>
              <p className="text-xs leading-relaxed text-zinc-600">
                Your External Channel tokens, Tally Prime webhook token, and Meta verify token above
                are always accessible. Activate the{" "}
                <strong>{lockedApiPlan?.name ?? "Developer REST API & Webhooks"}</strong> plan to
                mint custom `rsl_live_...` / `rsl_test_...` Bearer keys and push signed events to
                your own server.
              </p>
            </div>
            {lockedApiPlan ? (
              <div className="shrink-0">
                <PlanActivationModal
                  targetType="service"
                  targetKey={lockedApiPlan.key}
                  targetName={lockedApiPlan.name}
                  tagline={lockedApiPlan.tagline}
                  includedItems={lockedApiPlan.includedFeatures}
                  monthlyPaise={lockedApiPlan.monthlyAmountPaise}
                  quarterlyPaise={lockedApiPlan.quarterlyAmountPaise}
                  yearlyPaise={lockedApiPlan.yearlyAmountPaise}
                  hasCustomRate={lockedApiPlan.hasCustomPriceOverride}
                  isUnlocked={false}
                  isPending={lockedApiPlan.isPending}
                  pendingCycle={lockedApiPlan.pendingCycle}
                  workspaceSlug={workspaceSlug}
                  billingSettings={billingSettings}
                  triggerLabel="Unlock Developer API"
                />
              </div>
            ) : (
              <Link href="/billing" className="rsl-btn-primary shrink-0">
                View Plans &amp; Bundles
              </Link>
            )}
          </div>
        </SectionCard>
      ) : (
        <>
          {revealedRawKey && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50/90 p-4 text-[13px] text-amber-950 shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-bold">
                  Copy Your Newly Issued API Key Now (Shown Only Once — Hashed in Vault):
                </div>
                <div className="flex items-center gap-2">
                  <CopyTextButton
                    text={revealedRawKey}
                    label="Copy Full API Key"
                    copiedLabel="Copied API Key"
                  />
                  <button
                    type="button"
                    onClick={() => setRevealedRawKey(undefined)}
                    className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
              <div className="mt-2 select-all break-all rounded-xl border border-amber-200 bg-white px-3.5 py-2.5 font-mono text-sm font-bold text-slate-900">
                {revealedRawKey}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <SectionCard
              title="4. Issue Platform REST API Key"
              subtitle="Mint scoped Live (rsl_live_...) or Sandbox (rsl_test_...) Bearer tokens"
              action={
                <a
                  href="/api/v1/openapi.json"
                  target="_blank"
                  rel="noreferrer"
                  className="rsl-btn-secondary py-1.5 text-xs"
                >
                  OpenAPI Spec ↗
                </a>
              }
            >
              {!canManageApiKeys ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-[13px] text-amber-950">
                  Your current role has view-only access to Developer API keys.
                </div>
              ) : (
                <form onSubmit={handleIssueApiKey} className="space-y-4 text-[13px]">
                  <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                    <div className="min-w-0">
                      <label className="rsl-label">Key Label *</label>
                      <input
                        name="name"
                        required
                        placeholder="ERP / Website Integration"
                        className="rsl-input"
                      />
                    </div>
                    <div className="min-w-0">
                      <label className="rsl-label">Environment</label>
                      <select name="mode" defaultValue="live" className="rsl-input">
                        <option value="live">Live (rsl_live_...)</option>
                        <option value="test">Test (rsl_test_...)</option>
                      </select>
                    </div>
                    <div className="min-w-0">
                      <label className="rsl-label">Rate Limit / Min</label>
                      <input
                        name="rateLimitPerMin"
                        type="number"
                        defaultValue={120}
                        min={10}
                        max={1200}
                        className="rsl-input tabular-nums"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="rsl-label">Allowed Scopes</div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {apiScopes.map((s) => (
                        <label
                          key={s.key}
                          className="flex items-start gap-2.5 rounded-xl border border-zinc-200/85 bg-zinc-50/60 px-3 py-2 transition hover:border-zinc-300"
                        >
                          <input
                            type="checkbox"
                            name="scopes"
                            value={s.key}
                            defaultChecked
                            className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          <span className="min-w-0">
                            <span className="block text-[12.5px] font-medium text-slate-900">
                              {s.label}
                            </span>
                            <span className="font-mono text-[11px] text-zinc-500">{s.key}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isIssuingKey}
                    className="rsl-btn-primary inline-flex items-center gap-2"
                  >
                    {isIssuingKey && <IosSpinner size="xs" className="text-white" />}
                    <span>{isIssuingKey ? "Minting Key..." : "Create API Key"}</span>
                  </button>
                </form>
              )}
            </SectionCard>

            <SectionCard
              title="Live REST API Tester"
              subtitle="Test Tally bill events, WhatsApp template sends, and analytics endpoints right from your browser"
            >
              <ApiSandbox initialKey={revealedRawKey} />
            </SectionCard>
          </div>

          <SectionCard
            title={`Active & Historical REST API Keys (${apiKeys.length})`}
            subtitle="Rotate compromised keys in 1 click or revoke immediately"
            noPadding
          >
            {apiKeys.length === 0 ? (
              <div className="p-6 text-[13px] text-zinc-500">
                No platform REST API keys issued yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="border-b border-zinc-200/80 bg-zinc-50/75 text-[11px] tracking-wider text-zinc-500 uppercase">
                    <tr>
                      <th className="px-5 py-3 font-semibold sm:px-6">Label &amp; Key Prefix</th>
                      <th className="px-4 py-3 font-semibold">Scopes</th>
                      <th className="px-4 py-3 font-semibold">Limit</th>
                      <th className="px-4 py-3 font-semibold">Last Used</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-5 py-3 text-right font-semibold sm:px-6">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {apiKeys.map((k) => {
                      const isRotating = pendingActionKey === `key-rotate:${k.id}`;
                      const isRevoking = pendingActionKey === `key-revoke:${k.id}`;
                      return (
                        <tr key={k.id}>
                          <td className="px-5 py-3.5 sm:px-6">
                            <div className="font-semibold text-slate-900">{k.name}</div>
                            <div className="font-mono text-xs text-zinc-500">{k.maskedKey}</div>
                          </td>
                          <td className="px-4 py-3.5 font-mono text-xs text-zinc-600">
                            {k.scopes.join(", ")}
                          </td>
                          <td className="px-4 py-3.5 text-zinc-700 tabular-nums">
                            {k.rateLimitPerMin}/min
                          </td>
                          <td className="px-4 py-3.5 text-xs text-zinc-600 whitespace-nowrap tabular-nums">
                            {k.lastUsedAt ? (
                              <div>
                                <div>{new Date(k.lastUsedAt).toLocaleString("en-IN")}</div>
                                {k.lastUsedIp && (
                                  <div className="font-mono text-[11px] text-zinc-400">
                                    {k.lastUsedIp}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-zinc-400">Never used</span>
                            )}
                          </td>
                          <td className="px-4 py-3.5">
                            <StatusPill
                              label={k.status}
                              tone={k.status === "active" ? "emerald" : "ruby"}
                            />
                          </td>
                          <td className="px-5 py-3.5 text-right sm:px-6">
                            {k.status === "active" && canManageApiKeys && (
                              <div className="inline-flex flex-wrap items-center justify-end gap-2">
                                <button
                                  type="button"
                                  disabled={Boolean(pendingActionKey)}
                                  onClick={() => handleRotateApiKey(k.id)}
                                  className="rsl-btn-secondary inline-flex items-center gap-1.5 py-1.5 text-xs"
                                >
                                  {isRotating && <IosSpinner size="xs" />}
                                  <span>Rotate Key</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={Boolean(pendingActionKey)}
                                  onClick={() => handleRevokeApiKey(k.id)}
                                  className="rsl-btn-danger-soft inline-flex items-center gap-1.5 py-1.5 text-xs"
                                >
                                  {isRevoking && <IosSpinner size="xs" />}
                                  <span>Revoke</span>
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title={`5. Outbound Signed Webhook Secrets (${outboundWebhooks.length})`}
            subtitle="Push real-time events to your server signed with HMAC-SHA256 (X-RSL-Signature)"
          >
            <div className="space-y-5 text-[13px]">
              {canManageApiKeys && (
                <form onSubmit={handleCreateWebhook} className="space-y-4">
                  <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
                    <div>
                      <label className="rsl-label">Endpoint Label *</label>
                      <input
                        name="name"
                        required
                        placeholder="ERP Accounting Listener"
                        className="rsl-input"
                      />
                    </div>
                    <div>
                      <label className="rsl-label">Destination HTTPS URL *</label>
                      <input
                        name="targetUrl"
                        type="url"
                        required
                        placeholder="https://erp.yourcompany.in/webhooks/rsl"
                        className="rsl-input font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="rsl-label">Events to Deliver</div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {webhookEvents.map((ev) => (
                        <label
                          key={ev.key}
                          className="flex items-start gap-2 rounded-xl border border-zinc-200/85 bg-zinc-50/60 px-3 py-2"
                        >
                          <input
                            type="checkbox"
                            name="events"
                            value={ev.key}
                            defaultChecked
                            className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          <span className="min-w-0">
                            <span className="block text-xs font-medium text-slate-900">
                              {ev.label}
                            </span>
                            <span className="font-mono text-[11px] text-zinc-500">{ev.key}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isAddingWebhook}
                    className="rsl-btn-primary inline-flex items-center gap-2"
                  >
                    {isAddingWebhook && <IosSpinner size="xs" className="text-white" />}
                    <span>{isAddingWebhook ? "Saving..." : "Add Outbound Webhook"}</span>
                  </button>
                </form>
              )}

              {outboundWebhooks.length > 0 && (
                <div className="divide-y divide-zinc-200/80 rounded-xl border border-zinc-200/85 bg-white">
                  {outboundWebhooks.map((wh) => {
                    const isTesting = pendingActionKey === `wh-test:${wh.id}`;
                    const isDeleting = pendingActionKey === `wh-del:${wh.id}`;
                    return (
                      <div
                        key={wh.id}
                        className="flex flex-wrap items-center justify-between gap-4 p-4"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-slate-900">{wh.name}</span>
                            <StatusPill
                              label={wh.lastDeliveryStatus || "Ready"}
                              tone={
                                !wh.lastDeliveryStatus || wh.lastDeliveryStatus.includes("200")
                                  ? "emerald"
                                  : "amber"
                              }
                              showDot={false}
                            />
                          </div>
                          <div className="break-all font-mono text-xs text-zinc-600">
                            {wh.targetUrl}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-zinc-500">
                            <span>
                              Signing Secret:{" "}
                              <code className="break-all rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-slate-800">
                                {wh.signingSecret}
                              </code>
                            </span>
                            <CopyTextButton
                              text={wh.signingSecret}
                              label="Copy Secret"
                              className="rsl-btn-secondary py-1 text-[11px]"
                            />
                            <span>• Events: {wh.events.join(", ")}</span>
                          </div>
                        </div>

                        {canManageApiKeys && (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={Boolean(pendingActionKey)}
                              onClick={() => handleTestWebhook(wh.id)}
                              className="rsl-btn-secondary inline-flex items-center gap-1.5 py-1.5 text-xs"
                            >
                              {isTesting && <IosSpinner size="xs" />}
                              <span>Send Test Event</span>
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(pendingActionKey)}
                              onClick={() => handleDeleteWebhook(wh.id)}
                              className="rsl-btn-danger-soft inline-flex items-center gap-1.5 py-1.5 text-xs"
                            >
                              {isDeleting && <IosSpinner size="xs" />}
                              <span>Remove</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
