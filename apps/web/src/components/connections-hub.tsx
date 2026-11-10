"use client";

import React, { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  GuideDrawerButton,
  IosSpinner,
  SectionCard,
  sileo,
  StatusPill,
} from "@rsl/ui";
import type { ConnectionChannelKind, ConnectionMetadata } from "@rsl/connections";
import { CopyTextButton } from "@/components/client-utils";
import { ConnectToGoogleDriveButton, GoogleGLogo } from "@/components/google-drive-connect-button";
import {
  connectChannelJsonAction,
  disconnectConnectionJsonAction,
  refreshMetaChannelAssetsJsonAction,
  rotateMetaVerifyTokenJsonAction,
  selectGoogleAdsCustomerJsonAction,
  selectGoogleBusinessLocationJsonAction,
  selectGoogleSearchConsoleSiteJsonAction,
  selectMetaChannelAssetJsonAction,
  syncGoogleBusinessProfileJsonAction,
  updateConnectionJsonAction,
  verifyConnectionLiveJsonAction,
} from "@/lib/actions";

export interface SerializedConnectionItem {
  id: string;
  provider: string;
  channelKind: ConnectionChannelKind;
  displayName: string;
  externalAccountId: string;
  scopesGranted: string[];
  metadata: ConnectionMetadata;
  maskedTokenHint: string;
  status: string;
  lastHealthCheckAt: number | null;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface GoogleOAuthClientStatus {
  isReady: boolean;
  enableDriveOAuth: boolean;
  enableGbpOAuth: boolean;
  enableGoogleAdsOAuth?: boolean;
  consentAppName: string;
  publishingStatus: "production" | "testing";
  defaultDriveFolderName: string;
}

export interface MetaOAuthClientStatus {
  isReady: boolean;
  enableMetaOAuth: boolean;
  isManagedAdsReady: boolean;
  graphVersion: string;
}

export interface GoogleAdsClientStatus {
  isReady: boolean;
  isManagedAdsReady: boolean;
}

export interface WorkspaceBusinessSummary {
  name: string;
  industry?: string;
  phone?: string;
  website?: string;
  address?: string;
  gstin?: string;
}

export interface TallyDeviceSummary {
  id: string;
  deviceName: string;
  status: string;
  osVersion?: string | null;
  agentVersion?: string | null;
  activeCompanyName?: string | null;
  lastHeartbeatAt?: number | null;
}

export interface ConnectionsHubProps {
  initialKind?: ConnectionChannelKind;
  connections: SerializedConnectionItem[];
  allowManualCredentials?: boolean;
  whatsappWebhookUrl?: string;
  metaWebhookUrl?: string;
  webhookVerifyToken?: string;
  canManage: boolean;
  canAccessTally?: boolean;
  tallyDevices?: TallyDeviceSummary[];
  googleOAuth?: GoogleOAuthClientStatus;
  metaOAuth?: MetaOAuthClientStatus;
  googleAdsStatus?: GoogleAdsClientStatus;
  workspaceBusiness?: WorkspaceBusinessSummary;
}

function FacebookLogo({ className = "h-4 w-4 shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function ConnectWithFacebookButton({
  purpose,
  label,
  configured,
  variant = "primary",
  size = "md",
  returnTo = "/connections",
}: {
  purpose:
    | "meta_all"
    | "whatsapp_cloud"
    | "instagram_business"
    | "facebook_page"
    | "meta_ads_pixel";
  label: string;
  configured: boolean;
  variant?: "primary" | "outline";
  size?: "sm" | "md";
  returnTo?: string;
}) {
  const sizeCls = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2.5 text-[13px]";

  if (!configured) {
    return (
      <span
        role="button"
        aria-disabled="true"
        title="1-click Facebook Sign-In is pending platform setup"
        className={`inline-flex shrink-0 cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-zinc-100/90 font-semibold text-zinc-500 ${sizeCls}`}
      >
        <FacebookLogo className="h-4 w-4 text-emerald-700/60" />
        <span>{label}</span>
        <span className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 ring-1 ring-zinc-200">
          Setup Pending
        </span>
      </span>
    );
  }

  const href = `/api/oauth/meta/start?purpose=${encodeURIComponent(purpose)}&returnTo=${encodeURIComponent(returnTo)}`;

  if (variant === "outline") {
    return (
      <a
        href={href}
        className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white font-semibold text-slate-900 shadow-2xs transition hover:border-emerald-400 hover:bg-emerald-50/40 ${sizeCls}`}
      >
        <FacebookLogo className="h-3.5 w-3.5 text-emerald-800" />
        <span>{label}</span>
      </a>
    );
  }

  return (
    <a
      href={href}
      className={`rsl-btn-primary inline-flex shrink-0 items-center justify-center gap-2.5 font-semibold shadow-xs ${sizeCls}`}
    >
      <FacebookLogo className="h-4 w-4 text-[var(--btn-primary-fg)]" />
      <span>{label}</span>
    </a>
  );
}

interface MetaChannelCardSpec {
  kind: "whatsapp_cloud" | "instagram_business" | "facebook_page" | "meta_ads_pixel";
  title: string;
  tagline: string;
  connectLabel: string;
  proceedHref: string;
  proceedLabel: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}

const META_CHANNELS: MetaChannelCardSpec[] = [
  {
    kind: "whatsapp_cloud",
    title: "WhatsApp Business",
    tagline:
      "Send automated Tally Prime GST invoices, broadcast approved templates, and reply to customers in your shared inbox.",
    connectLabel: "Connect WhatsApp",
    proceedHref: "/whatsapp",
    proceedLabel: "Open WhatsApp & Templates →",
    secondaryHref: "/inbox",
    secondaryLabel: "Customer Inbox",
  },
  {
    kind: "instagram_business",
    title: "Instagram Business",
    tagline:
      "Reply to Instagram Direct Messages and story replies from one unified inbox and publish scheduled posts.",
    connectLabel: "Connect Instagram",
    proceedHref: "/inbox",
    proceedLabel: "Open Customer Inbox →",
    secondaryHref: "/campaigns",
    secondaryLabel: "Social Posts",
  },
  {
    kind: "facebook_page",
    title: "Facebook Page",
    tagline:
      "Receive Facebook Lead Ads & Messenger inquiries automatically and publish updates to your business page.",
    connectLabel: "Connect Facebook Page",
    proceedHref: "/campaigns",
    proceedLabel: "Open Campaigns & Posts →",
    secondaryHref: "/inbox",
    secondaryLabel: "Messenger Inbox",
  },
  {
    kind: "meta_ads_pixel",
    title: "Meta Ads & Conversions Pixel",
    tagline:
      "Launch Facebook & Instagram ad campaigns, track ROAS, and send server-side Conversions API events.",
    connectLabel: "Connect Meta Ads",
    proceedHref: "/campaigns",
    proceedLabel: "Open Ads & Campaigns →",
  },
];

interface GoogleChannelCardSpec {
  kind:
    | "google_business"
    | "google_ads"
    | "google_drive"
    | "google_sheets"
    | "google_search_console";
  title: string;
  tagline: string;
  connectLabel: string;
  proceedHref: string;
  proceedLabel: string;
}

const GOOGLE_CHANNELS: GoogleChannelCardSpec[] = [
  {
    kind: "google_business",
    title: "Google Business Profile",
    tagline:
      "Sync Google Maps & Search star ratings across store locations and publish verified owner replies.",
    connectLabel: "Connect Business Profile",
    proceedHref: "/reviews",
    proceedLabel: "Open Google Reviews →",
  },
  {
    kind: "google_ads",
    title: "Google Ads",
    tagline:
      "Create Search & Performance Max campaigns, monitor ad spend, and track conversions from one console.",
    connectLabel: "Connect Google Ads",
    proceedHref: "/campaigns",
    proceedLabel: "Open Google Ads →",
  },
  {
    kind: "google_drive",
    title: "Google Drive Backups",
    tagline:
      "Store automatic encrypted off-site backups in a dedicated folder inside your own Google Drive.",
    connectLabel: "Connect Google Drive",
    proceedHref: "/backups",
    proceedLabel: "Open Backups & Storage →",
  },
  {
    kind: "google_sheets",
    title: "Google Sheets (CA Live Sync)",
    tagline:
      "Push live Tally Sales, Purchase, Receipt, and Party Aging tabs to a shared Google Sheet for your CA.",
    connectLabel: "Connect Google Sheets",
    proceedHref: "/tally",
    proceedLabel: "Open Tally & CA Sheet →",
  },
  {
    kind: "google_search_console",
    title: "Google Search Console",
    tagline:
      "Track organic Google Search clicks, impressions, average position, and top customer search queries.",
    connectLabel: "Connect Search Console",
    proceedHref: "/campaigns",
    proceedLabel: "View Search Analytics →",
  },
];

function getStatusPillProps(status: string): {
  label: string;
  tone: "emerald" | "amber" | "ruby";
} {
  if (status === "healthy") return { label: "Connected", tone: "emerald" };
  if (status === "expiring") return { label: "Refreshing Soon", tone: "amber" };
  return { label: "Reconnect Needed", tone: "ruby" };
}

export function ConnectionsHub({
  initialKind,
  connections,
  allowManualCredentials = false,
  whatsappWebhookUrl = "",
  metaWebhookUrl = "",
  webhookVerifyToken: initialVerifyToken = "",
  canManage,
  canAccessTally = false,
  tallyDevices = [],
  googleOAuth,
  metaOAuth,
}: ConnectionsHubProps) {
  const router = useRouter();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Support-only manual credential state (active ONLY when allowManualCredentials === true)
  const [manualKind, setManualKind] = useState<ConnectionChannelKind>(
    initialKind || "whatsapp_cloud"
  );
  const [rotatingConnId, setRotatingConnId] = useState<string | null>(null);
  const [verifyToken, setVerifyToken] = useState(initialVerifyToken);

  const byKind = useMemo(() => {
    const map = new Map<ConnectionChannelKind, SerializedConnectionItem>();
    for (const c of connections) {
      if (!map.has(c.channelKind)) {
        map.set(c.channelKind, c);
      }
    }
    return map;
  }, [connections]);

  const metaConfigured = Boolean(metaOAuth?.isReady && metaOAuth?.enableMetaOAuth);
  const googleDriveConfigured = Boolean(googleOAuth?.isReady && googleOAuth?.enableDriveOAuth);
  const googleGbpConfigured = Boolean(googleOAuth?.isReady && googleOAuth?.enableGbpOAuth);
  const googleAdsConfigured = Boolean(googleOAuth?.isReady && googleOAuth?.enableGoogleAdsOAuth);
  const googleAllConfigured =
    googleDriveConfigured || googleGbpConfigured || googleAdsConfigured;

  function isGooglePurposeConfigured(kind: GoogleChannelCardSpec["kind"]): boolean {
    if (kind === "google_business") return googleGbpConfigured;
    if (kind === "google_ads") return googleAdsConfigured;
    return googleDriveConfigured;
  }

  const metaConnectedCount = META_CHANNELS.filter((m) => byKind.has(m.kind)).length;
  const googleConnectedCount = GOOGLE_CHANNELS.filter((g) => byKind.has(g.kind)).length;
  const totalConnectedCount = metaConnectedCount + googleConnectedCount;
  const onlineTallyDevices = tallyDevices.filter((d) => d.status === "online");

  function runAction(
    key: string,
    fn: () => Promise<{ ok: boolean; message: string }>,
    successTitle: string,
    errorTitle: string
  ) {
    setPendingKey(key);
    startTransition(async () => {
      const res = await fn();
      setPendingKey(null);
      if (res.ok) {
        sileo.success({
          title: successTitle,
          description: res.message,
          duration: 4500,
        });
        router.refresh();
      } else {
        sileo.error({
          title: errorTitle,
          description: res.message,
          duration: 5500,
        });
      }
    });
  }

  function handleVerify(conn: SerializedConnectionItem) {
    runAction(
      `verify:${conn.id}`,
      async () => {
        const fd = new FormData();
        fd.set("connectionId", conn.id);
        return verifyConnectionLiveJsonAction(fd);
      },
      `${conn.displayName} Active`,
      `${conn.displayName} Check Failed`
    );
  }

  function handleDisconnect(conn: SerializedConnectionItem) {
    runAction(
      `disc:${conn.id}`,
      async () => {
        const fd = new FormData();
        fd.set("connectionId", conn.id);
        return disconnectConnectionJsonAction(fd);
      },
      "Account Disconnected",
      "Could Not Disconnect"
    );
  }

  function handleSwitchMetaAsset(
    connId: string,
    assetId: string,
    secondaryPixelId?: string
  ) {
    if (!assetId) return;
    runAction(
      `switch-meta:${connId}`,
      async () => {
        const fd = new FormData();
        fd.set("connectionId", connId);
        fd.set("assetId", assetId);
        if (secondaryPixelId !== undefined) {
          fd.set("secondaryPixelId", secondaryPixelId);
        }
        return selectMetaChannelAssetJsonAction(fd);
      },
      "Active Account Updated",
      "Could Not Switch Account"
    );
  }

  function handleRefreshMetaAssets(connId: string) {
    runAction(
      `refresh-meta:${connId}`,
      async () => {
        const fd = new FormData();
        fd.set("connectionId", connId);
        return refreshMetaChannelAssetsJsonAction(fd);
      },
      "Assets Synced",
      "Asset Sync Failed"
    );
  }

  function handleSwitchGbpLocation(connId: string, locationId: string) {
    if (!locationId) return;
    runAction(
      `switch-gbp:${connId}`,
      async () => {
        const fd = new FormData();
        fd.set("connectionId", connId);
        fd.set("locationId", locationId);
        return selectGoogleBusinessLocationJsonAction(fd);
      },
      "Store Location Switched",
      "Could Not Switch Location"
    );
  }

  function handleSyncGbpReviews(connId: string) {
    runAction(
      `sync-gbp:${connId}`,
      async () => {
        const fd = new FormData();
        fd.set("connectionId", connId);
        return syncGoogleBusinessProfileJsonAction(fd);
      },
      "Google Profile Synced",
      "Sync Notice"
    );
  }

  function handleSwitchGoogleAdsCustomer(connId: string, customerId: string) {
    if (!customerId) return;
    runAction(
      `switch-gads:${connId}`,
      async () => {
        const fd = new FormData();
        fd.set("connectionId", connId);
        fd.set("customerId", customerId);
        return selectGoogleAdsCustomerJsonAction(fd);
      },
      "Google Ads Account Switched",
      "Could Not Switch Account"
    );
  }

  function handleSwitchGscSite(connId: string, siteUrl: string) {
    if (!siteUrl) return;
    runAction(
      `switch-gsc:${connId}`,
      async () => {
        const fd = new FormData();
        fd.set("connectionId", connId);
        fd.set("siteUrl", siteUrl);
        return selectGoogleSearchConsoleSiteJsonAction(fd);
      },
      "Website Property Updated",
      "Could Not Switch Property"
    );
  }

  function handleManualConnectSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    runAction(
      "manual-connect",
      async () => {
        const res = await connectChannelJsonAction(fd);
        if (res.ok) formEl.reset();
        return res;
      },
      "Manual Credentials Saved",
      "Could Not Save Credentials"
    );
  }

  function handleManualRotateSubmit(connId: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    fd.set("connectionId", connId);
    runAction(
      `manual-rotate:${connId}`,
      async () => {
        const res = await updateConnectionJsonAction(fd);
        if (res.ok) {
          formEl.reset();
          setRotatingConnId(null);
        }
        return res;
      },
      "Token Updated",
      "Could Not Update Token"
    );
  }

  function handleRotateVerifyToken() {
    setPendingKey("rotate-verify");
    startTransition(async () => {
      const res = await rotateMetaVerifyTokenJsonAction();
      setPendingKey(null);
      if (res.ok && res.verifyToken) {
        setVerifyToken(res.verifyToken);
        sileo.success({
          title: "Verify Token Rotated",
          description: res.message,
          duration: 4500,
        });
      } else {
        sileo.error({
          title: "Could Not Rotate Token",
          description: res.message,
          duration: 5000,
        });
      }
    });
  }

  return (
    <div className="w-full space-y-6">
      {/* Clean Overview Strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex items-center justify-between rounded-2xl border border-zinc-200/90 bg-white px-4 py-3.5 shadow-2xs">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Active Connections
            </div>
            <div className="mt-0.5 text-lg font-bold text-slate-900 tabular-nums">
              {totalConnectedCount} / 9 Connected
            </div>
          </div>
          <StatusPill
            label={totalConnectedCount > 0 ? "1-Click Sync Active" : "Ready to Connect"}
            tone={totalConnectedCount > 0 ? "emerald" : "stone"}
          />
        </div>

        <div className="rsl-frost-card flex items-center justify-between rounded-2xl px-4 py-3.5">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Meta Business Suite
            </div>
            <div className="mt-0.5 text-lg font-bold text-slate-900 tabular-nums">
              {metaConnectedCount} / 4 Channels
            </div>
          </div>
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200">
            <FacebookLogo className="h-4 w-4" />
          </span>
        </div>

        <div className="rsl-frost-card flex items-center justify-between rounded-2xl px-4 py-3.5">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Google Suite
            </div>
            <div className="mt-0.5 text-lg font-bold text-slate-900 tabular-nums">
              {googleConnectedCount} / 5 Channels
            </div>
          </div>
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-zinc-200/80 bg-zinc-50">
            <GoogleGLogo className="h-4 w-4" />
          </span>
        </div>
      </div>

      {/* SECTION 1: META BUSINESS SUITE */}
      <SectionCard
        title="Meta Business Suite"
        subtitle="Sign in with Facebook once to connect WhatsApp Business, Instagram, your Facebook Page, and Meta Ads automatically - no tokens or IDs required."
        action={
          canManage ? (
            <ConnectWithFacebookButton
              purpose="meta_all"
              label={
                metaConnectedCount === META_CHANNELS.length
                  ? "Reconnect All with Facebook"
                  : "Connect All with Facebook"
              }
              configured={metaConfigured}
              size="sm"
            />
          ) : undefined
        }
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {META_CHANNELS.map((spec) => {
            const conn = byKind.get(spec.kind);
            const meta = conn?.metadata;
            const pill = conn ? getStatusPillProps(conn.status) : null;
            const isVerifying = conn && pendingKey === `verify:${conn.id}`;
            const isRefreshing = conn && pendingKey === `refresh-meta:${conn.id}`;
            const isSwitching = conn && pendingKey === `switch-meta:${conn.id}`;
            const isDisconnecting = conn && pendingKey === `disc:${conn.id}`;

            const pages = meta?.availableMetaPages ?? [];
            const igAccounts = meta?.availableInstagramAccounts ?? [];
            const adAccounts = meta?.availableMetaAdAccounts ?? [];
            const wabaPhones = meta?.availableWabaPhones ?? [];
            const activeAdAccObj = adAccounts.find(
              (a) => a.adAccountId === (meta?.adAccountId || conn?.externalAccountId)
            );
            const availablePixels = activeAdAccObj?.availablePixels ?? [];

            return (
              <div
                key={spec.kind}
                className={`flex flex-col justify-between rounded-2xl border p-5 transition ${
                  conn
                    ? "border-emerald-200/80 bg-emerald-50/20"
                    : "border-zinc-200/90 bg-white hover:border-zinc-300"
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200">
                        <FacebookLogo className="h-4 w-4" />
                      </span>
                      <div>
                        <h3 className="text-[14px] font-bold text-slate-900">{spec.title}</h3>
                        <div className="text-[11px] text-zinc-500">
                          {conn ? "1-Click Facebook OAuth" : "Not connected yet"}
                        </div>
                      </div>
                    </div>
                    {pill ? (
                      <StatusPill label={pill.label} tone={pill.tone} />
                    ) : (
                      <StatusPill label="Not Connected" tone="stone" />
                    )}
                  </div>

                  {!conn ? (
                    <p className="text-xs leading-relaxed text-zinc-600">{spec.tagline}</p>
                  ) : (
                    <div className="space-y-2.5 rounded-xl border border-zinc-200/80 bg-white p-3.5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-[11px] font-medium text-zinc-500">
                            Connected Business Asset
                          </div>
                          <div className="mt-0.5 text-[13px] font-bold text-slate-900">
                            {conn.displayName}
                          </div>
                        </div>
                        {meta?.webhookAutoSubscribed && (
                          <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
                            Live Webhooks Active
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-zinc-600">
                        {spec.kind === "whatsapp_cloud" && meta?.displayPhone && (
                          <span>
                            Number:{" "}
                            <strong className="font-semibold text-slate-900">
                              {meta.displayPhone}
                            </strong>
                          </span>
                        )}
                        {spec.kind === "instagram_business" && meta?.pageName && (
                          <span>
                            Linked Page:{" "}
                            <strong className="font-semibold text-slate-900">
                              {meta.pageName}
                            </strong>
                          </span>
                        )}
                        {spec.kind === "facebook_page" && meta?.primaryCategory && (
                          <span>
                            Category:{" "}
                            <strong className="font-semibold text-slate-900">
                              {meta.primaryCategory}
                            </strong>
                          </span>
                        )}
                        {spec.kind === "meta_ads_pixel" && (
                          <>
                            {meta?.currencyCode && (
                              <span>
                                Currency:{" "}
                                <strong className="font-semibold text-slate-900">
                                  {meta.currencyCode}
                                </strong>
                              </span>
                            )}
                            <span>
                              Pixel:{" "}
                              <strong className="font-mono text-slate-900">
                                {meta?.pixelId || "None selected"}
                              </strong>
                            </span>
                          </>
                        )}
                      </div>

                      {/* 1-Click Post-Login Asset Selectors (when 2+ assets discovered) */}
                      {canManage && spec.kind === "whatsapp_cloud" && wabaPhones.length > 1 && (
                        <div className="pt-1">
                          <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                            Switch WhatsApp Business Number ({wabaPhones.length} found)
                          </label>
                          <select
                            disabled={Boolean(isSwitching)}
                            value={meta?.phoneNumberId || conn.externalAccountId}
                            onChange={(e) => handleSwitchMetaAsset(conn.id, e.target.value)}
                            className="rsl-input py-1.5 text-xs"
                          >
                            {wabaPhones.map((ph) => (
                              <option key={ph.phoneNumberId} value={ph.phoneNumberId}>
                                {ph.verifiedName} ({ph.displayPhone})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {canManage && spec.kind === "instagram_business" && igAccounts.length > 1 && (
                        <div className="pt-1">
                          <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                            Switch Instagram Business Account ({igAccounts.length} found)
                          </label>
                          <select
                            disabled={Boolean(isSwitching)}
                            value={meta?.igUserId || conn.externalAccountId}
                            onChange={(e) => handleSwitchMetaAsset(conn.id, e.target.value)}
                            className="rsl-input py-1.5 text-xs"
                          >
                            {igAccounts.map((ig) => (
                              <option key={ig.igUserId} value={ig.igUserId}>
                                {ig.igUsername ? `@${ig.igUsername}` : ig.name || ig.igUserId}
                                {ig.linkedPageName ? ` - ${ig.linkedPageName}` : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {canManage && spec.kind === "facebook_page" && pages.length > 1 && (
                        <div className="pt-1">
                          <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                            Switch Active Facebook Page ({pages.length} found)
                          </label>
                          <select
                            disabled={Boolean(isSwitching)}
                            value={meta?.pageId || conn.externalAccountId}
                            onChange={(e) => handleSwitchMetaAsset(conn.id, e.target.value)}
                            className="rsl-input py-1.5 text-xs"
                          >
                            {pages.map((p) => (
                              <option key={p.pageId} value={p.pageId}>
                                {p.pageName}
                                {p.category ? ` (${p.category})` : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {canManage && spec.kind === "meta_ads_pixel" && adAccounts.length > 1 && (
                        <div className="pt-1">
                          <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                            Switch Active Ad Account ({adAccounts.length} found)
                          </label>
                          <select
                            disabled={Boolean(isSwitching)}
                            value={meta?.adAccountId || conn.externalAccountId}
                            onChange={(e) => handleSwitchMetaAsset(conn.id, e.target.value)}
                            className="rsl-input py-1.5 text-xs"
                          >
                            {adAccounts.map((a) => (
                              <option key={a.adAccountId} value={a.adAccountId}>
                                {a.name} ({a.adAccountId} • {a.currency || "INR"})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {canManage && spec.kind === "meta_ads_pixel" && availablePixels.length > 1 && (
                        <div className="pt-1">
                          <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                            Switch Active Conversions Pixel ({availablePixels.length} found)
                          </label>
                          <select
                            disabled={Boolean(isSwitching)}
                            value={meta?.pixelId || ""}
                            onChange={(e) =>
                              handleSwitchMetaAsset(
                                conn.id,
                                meta?.adAccountId || conn.externalAccountId,
                                e.target.value
                              )
                            }
                            className="rsl-input py-1.5 text-xs"
                          >
                            {availablePixels.map((px) => (
                              <option key={px.pixelId} value={px.pixelId}>
                                {px.name} ({px.pixelId})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {conn.status === "needs_reauth" && meta?.lastLiveCheckMessage && (
                        <div className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-800">
                          {meta.lastLiveCheckMessage}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Card Footer Actions */}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200/60 pt-3.5">
                  {!conn ? (
                    canManage ? (
                      <ConnectWithFacebookButton
                        purpose={spec.kind}
                        label={spec.connectLabel}
                        configured={metaConfigured}
                        size="sm"
                      />
                    ) : (
                      <span className="text-xs text-zinc-500">
                        Ask your Business Owner to connect this channel.
                      </span>
                    )
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={spec.proceedHref}
                          className="rsl-btn-primary py-1.5 text-xs"
                        >
                          {spec.proceedLabel}
                        </Link>
                        {spec.secondaryHref && spec.secondaryLabel && (
                          <Link
                            href={spec.secondaryHref}
                            className="rsl-btn-secondary py-1.5 text-xs"
                          >
                            {spec.secondaryLabel}
                          </Link>
                        )}
                      </div>

                      {canManage && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            disabled={Boolean(pendingKey)}
                            onClick={() => handleRefreshMetaAssets(conn.id)}
                            className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-zinc-50"
                            title="Re-fetch Pages, Ad Accounts, and WhatsApp numbers from Facebook"
                          >
                            {isRefreshing ? "Syncing..." : "Sync Assets"}
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(pendingKey)}
                            onClick={() => handleVerify(conn)}
                            className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-zinc-50"
                          >
                            {isVerifying ? "Checking..." : "Check"}
                          </button>
                          <ConnectWithFacebookButton
                            purpose={spec.kind}
                            label="Reconnect"
                            configured={metaConfigured}
                            variant="outline"
                            size="sm"
                          />
                          <button
                            type="button"
                            disabled={Boolean(pendingKey)}
                            onClick={() => handleDisconnect(conn)}
                            className="rounded-lg border border-rose-200 bg-rose-50/70 px-2.5 py-1 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100"
                          >
                            {isDisconnecting ? "..." : "Disconnect"}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* SECTION 2: GOOGLE BUSINESS & WORKSPACE SUITE */}
      <SectionCard
        title="Google Business & Workspace Suite"
        subtitle="Sign in with your Google account in one click to sync Google Maps reviews, launch Google Ads, automate Drive backups, and share live Tally sheets with your CA."
        action={
          canManage ? (
            <ConnectToGoogleDriveButton
              purpose="google_all"
              returnTo="/connections"
              label={
                googleConnectedCount === GOOGLE_CHANNELS.length
                  ? "Reconnect All with Google"
                  : "Connect All with Google"
              }
              size="sm"
              configured={googleAllConfigured}
            />
          ) : undefined
        }
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {GOOGLE_CHANNELS.map((spec) => {
            const conn = byKind.get(spec.kind);
            const meta = conn?.metadata;
            const pill = conn ? getStatusPillProps(conn.status) : null;
            const isConfigured = isGooglePurposeConfigured(spec.kind);
            const isVerifying = conn && pendingKey === `verify:${conn.id}`;
            const isDisconnecting = conn && pendingKey === `disc:${conn.id}`;
            const isSyncingGbp = conn && pendingKey === `sync-gbp:${conn.id}`;
            const isSwitchingGbp = conn && pendingKey === `switch-gbp:${conn.id}`;
            const isSwitchingGads = conn && pendingKey === `switch-gads:${conn.id}`;
            const isSwitchingGsc = conn && pendingKey === `switch-gsc:${conn.id}`;

            const locations = meta?.availableLocations ?? [];
            const adCustomers = meta?.availableAdCustomers ?? [];
            const gscSites = meta?.availableSearchConsoleSites ?? [];

            return (
              <div
                key={spec.kind}
                className={`flex flex-col justify-between rounded-2xl border p-5 transition ${
                  conn
                    ? "border-emerald-200/80 bg-emerald-50/20"
                    : "border-zinc-200/90 bg-white hover:border-zinc-300"
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200/90 bg-white shadow-2xs">
                        <GoogleGLogo className="h-4 w-4" />
                      </span>
                      <div>
                        <h3 className="text-[14px] font-bold text-slate-900">{spec.title}</h3>
                        <div className="text-[11px] text-zinc-500">
                          {conn
                            ? meta?.driveEmail || "1-Click Google Sign-In"
                            : "Not connected yet"}
                        </div>
                      </div>
                    </div>
                    {pill ? (
                      <StatusPill label={pill.label} tone={pill.tone} />
                    ) : (
                      <StatusPill label="Not Connected" tone="stone" />
                    )}
                  </div>

                  {!conn ? (
                    <p className="text-xs leading-relaxed text-zinc-600">{spec.tagline}</p>
                  ) : (
                    <div className="space-y-2.5 rounded-xl border border-zinc-200/80 bg-white p-3.5 text-xs">
                      <div>
                        <div className="text-[11px] font-medium text-zinc-500">
                          Connected Account
                        </div>
                        <div className="mt-0.5 text-[13px] font-bold text-slate-900 break-words">
                          {spec.kind === "google_business"
                            ? meta?.storeName || conn.displayName
                            : spec.kind === "google_drive"
                              ? `Folder: ${meta?.folderName || "RapidShift Labs Backups"}`
                              : spec.kind === "google_search_console"
                                ? meta?.searchConsoleSiteUrl || conn.displayName
                                : conn.displayName}
                        </div>
                      </div>

                      {spec.kind === "google_business" && (
                        <div className="space-y-1 text-[11.5px] text-zinc-600">
                          {meta?.storeAddress && <div>{meta.storeAddress}</div>}
                          {typeof meta?.totalReviewsCount === "number" && (
                            <div>
                              Rating:{" "}
                              <strong className="text-slate-900">
                                {Number(meta.averageRating || 0).toFixed(1)} ★
                              </strong>{" "}
                              ({meta.totalReviewsCount} review
                              {meta.totalReviewsCount === 1 ? "" : "s"})
                            </div>
                          )}
                          {meta?.gbpDiscoveryStatus &&
                            meta.gbpDiscoveryStatus !== "verified_locations" &&
                            meta.gbpDiscoveryDetail && (
                              <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-2.5 py-1.5 text-[11px] text-amber-900">
                                {meta.gbpDiscoveryDetail}
                              </div>
                            )}
                        </div>
                      )}

                      {spec.kind === "google_ads" && meta?.formattedCustomerId && (
                        <div className="text-[11.5px] text-zinc-600">
                          Customer ID:{" "}
                          <strong className="font-mono text-slate-900">
                            {meta.formattedCustomerId}
                          </strong>
                          {meta.currencyCode ? ` • ${meta.currencyCode}` : ""}
                        </div>
                      )}

                      {spec.kind === "google_drive" && meta?.folderWebViewLink && (
                        <div>
                          <a
                            href={meta.folderWebViewLink}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-emerald-800 hover:underline"
                          >
                            Open Backup Folder in Google Drive ↗
                          </a>
                        </div>
                      )}

                      {spec.kind === "google_sheets" && meta?.caSpreadsheetUrl && (
                        <div>
                          <a
                            href={meta.caSpreadsheetUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-emerald-800 hover:underline"
                          >
                            Open Live CA Google Sheet ↗
                          </a>
                        </div>
                      )}

                      {/* 1-Click Multi-Branch / Multi-Account Selectors */}
                      {canManage && spec.kind === "google_business" && locations.length > 1 && (
                        <div className="pt-1">
                          <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                            Switch Storefront Location ({locations.length} branches)
                          </label>
                          <select
                            disabled={Boolean(isSwitchingGbp)}
                            value={meta?.locationId || ""}
                            onChange={(e) => handleSwitchGbpLocation(conn.id, e.target.value)}
                            className="rsl-input py-1.5 text-xs"
                          >
                            {locations.map((loc) => (
                              <option key={loc.locationId} value={loc.locationId}>
                                {loc.title}
                                {loc.storeAddress ? ` - ${loc.storeAddress}` : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {canManage && spec.kind === "google_ads" && adCustomers.length > 1 && (
                        <div className="pt-1">
                          <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                            Switch Google Ads Account ({adCustomers.length} found)
                          </label>
                          <select
                            disabled={Boolean(isSwitchingGads)}
                            value={meta?.customerId || ""}
                            onChange={(e) =>
                              handleSwitchGoogleAdsCustomer(conn.id, e.target.value)
                            }
                            className="rsl-input py-1.5 text-xs"
                          >
                            {adCustomers.map((c) => (
                              <option key={c.customerId} value={c.customerId}>
                                {c.descriptiveName} ({c.formattedCustomerId})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {canManage && spec.kind === "google_search_console" && gscSites.length > 1 && (
                        <div className="pt-1">
                          <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                            Switch Verified Website ({gscSites.length} found)
                          </label>
                          <select
                            disabled={Boolean(isSwitchingGsc)}
                            value={meta?.searchConsoleSiteUrl || ""}
                            onChange={(e) => handleSwitchGscSite(conn.id, e.target.value)}
                            className="rsl-input py-1.5 text-xs"
                          >
                            {gscSites.map((site) => (
                              <option key={site} value={site}>
                                {site}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Card Footer Actions */}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200/60 pt-3.5">
                  {!conn ? (
                    canManage ? (
                      <ConnectToGoogleDriveButton
                        purpose={spec.kind}
                        returnTo="/connections"
                        label={spec.connectLabel}
                        variant="white"
                        size="sm"
                        configured={isConfigured}
                      />
                    ) : (
                      <span className="text-xs text-zinc-500">
                        Ask your Business Owner to connect this account.
                      </span>
                    )
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link
                          href={spec.proceedHref}
                          className="rsl-btn-primary py-1.5 text-xs"
                        >
                          {spec.proceedLabel}
                        </Link>
                        {canManage && spec.kind === "google_business" && (
                          <button
                            type="button"
                            disabled={Boolean(pendingKey)}
                            onClick={() => handleSyncGbpReviews(conn.id)}
                            className="rsl-btn-secondary py-1.5 text-xs"
                          >
                            {isSyncingGbp ? "Syncing..." : "Sync Profile"}
                          </button>
                        )}
                      </div>

                      {canManage && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            disabled={Boolean(pendingKey)}
                            onClick={() => handleVerify(conn)}
                            className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-zinc-50"
                          >
                            {isVerifying ? "Checking..." : "Check"}
                          </button>
                          <ConnectToGoogleDriveButton
                            purpose={spec.kind}
                            returnTo="/connections"
                            label="Switch"
                            variant="white"
                            size="sm"
                            configured={isConfigured}
                          />
                          <button
                            type="button"
                            disabled={Boolean(pendingKey)}
                            onClick={() => handleDisconnect(conn)}
                            className="rounded-lg border border-rose-200 bg-rose-50/70 px-2.5 py-1 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100"
                          >
                            {isDisconnecting ? "..." : "Disconnect"}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* SECTION 3: TALLY PRIME DESKTOP SYNC */}
      <SectionCard
        title="Tally Prime Desktop Sync"
        subtitle="Connect your office Windows PC running Tally Prime to sync GST bills, receipts, stock items, and party ledgers automatically."
        action={
          <StatusPill
            label={
              onlineTallyDevices.length > 0
                ? `${onlineTallyDevices.length} PC Online`
                : tallyDevices.length > 0
                  ? `${tallyDevices.length} PC Paired`
                  : "Ready to Pair"
            }
            tone={
              onlineTallyDevices.length > 0
                ? "emerald"
                : tallyDevices.length > 0
                  ? "amber"
                  : "stone"
            }
          />
        }
      >
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="space-y-1 text-xs text-zinc-600">
            {tallyDevices.length === 0 ? (
              <p>
                Pair your office PC with a one-click 6-digit pairing code or load the Tally Prime{" "}
                <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[11px]">.tdl</code>{" "}
                add-on from Tally Prime &amp; Bills.
              </p>
            ) : (
              <div className="space-y-1.5">
                {tallyDevices.map((d) => (
                  <div key={d.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold text-slate-900">{d.deviceName}</span>
                    <span className="text-zinc-400">•</span>
                    <span>{d.activeCompanyName || "Awaiting open Tally company"}</span>
                    {d.lastHeartbeatAt && (
                      <>
                        <span className="text-zinc-400">•</span>
                        <span className="text-zinc-500">
                          Synced {new Date(d.lastHeartbeatAt).toLocaleString("en-IN")}
                        </span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          {canAccessTally && (
            <Link href="/tally?tab=connect" className="rsl-btn-secondary shrink-0 text-xs">
              {tallyDevices.length > 0 ? "Manage Tally Sync →" : "Connect Tally Prime →"}
            </Link>
          )}
        </div>
      </SectionCard>

      {/* SECTION 4: STRICTLY BACKEND-ENABLED MANUAL CREDENTIALS OVERRIDE */}
      {allowManualCredentials && canManage && (
        <details className="group rounded-2xl border border-amber-200/90 bg-amber-50/30 p-5 shadow-2xs">
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-slate-900">
                  Manual API Credentials Override
                </span>
                <StatusPill label="Enabled for This Account" tone="amber" />
              </div>
              <p className="text-xs text-zinc-600">
                Custom System User token &amp; webhook configuration enabled for your workspace.
                Click to expand.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <GuideDrawerButton
                drawerId="connections-manual-webhook-guide"
                label="Need help? • Manual Webhook Setup"
                guide={{
                  eyebrow: "Backend-Enabled Manual Override",
                  title: "Linking Custom System User Tokens & Webhooks",
                  summary:
                    "Most workspaces connect in one click via Facebook & Google Sign-In above. Use this section only when Staff has enabled custom System User credentials.",
                  copyValues:
                    whatsappWebhookUrl && metaWebhookUrl
                      ? [
                          { label: "WhatsApp Webhook URL", value: whatsappWebhookUrl },
                          { label: "Meta / Instagram Webhook URL", value: metaWebhookUrl },
                          { label: "Webhook Verify Token", value: verifyToken },
                        ]
                      : undefined,
                  steps: [
                    {
                      title: "Configure Webhook Callback URLs in Meta Developer Console",
                      detail:
                        "Point WhatsApp Business webhooks to the WhatsApp Webhook URL and Page/Instagram webhooks to the Meta Webhook URL using your Verify Token.",
                    },
                    {
                      title: "Paste your permanent System User token & Asset ID",
                      detail:
                        "Select the channel type, enter the 15-digit Phone Number ID / Ad Account ID / Page ID, and paste your System User token.",
                    },
                    {
                      title: "Verify live reachability",
                      detail:
                        "After saving, click 'Check' on the connected channel card to run a live provider health check.",
                    },
                  ],
                }}
              />
              <span className="rounded-lg border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-900">
                Expand Manual Setup
              </span>
            </div>
          </summary>

          <div className="mt-5 space-y-5 border-t border-amber-200/70 pt-5">
            {/* Webhook Endpoints for Custom App Setups */}
            {whatsappWebhookUrl && metaWebhookUrl && (
              <div className="grid grid-cols-1 gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-xs lg:grid-cols-3">
                <div>
                  <div className="flex items-center justify-between gap-2 font-semibold text-slate-800">
                    <span>WhatsApp Webhook URL</span>
                    <CopyTextButton text={whatsappWebhookUrl} label="Copy" />
                  </div>
                  <div className="mt-1 break-all font-mono text-[11px] text-emerald-800">
                    {whatsappWebhookUrl}
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2 font-semibold text-slate-800">
                    <span>Meta / IG Webhook URL</span>
                    <CopyTextButton text={metaWebhookUrl} label="Copy" />
                  </div>
                  <div className="mt-1 break-all font-mono text-[11px] text-emerald-800">
                    {metaWebhookUrl}
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2 font-semibold text-slate-800">
                    <span>Webhook Verify Token</span>
                    <div className="flex items-center gap-1.5">
                      <CopyTextButton text={verifyToken} label="Copy" />
                      <button
                        type="button"
                        disabled={pendingKey === "rotate-verify"}
                        onClick={handleRotateVerifyToken}
                        className="rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-zinc-100"
                      >
                        Rotate
                      </button>
                    </div>
                  </div>
                  <div className="mt-1 break-all font-mono text-[11px] text-slate-800">
                    {verifyToken}
                  </div>
                </div>
              </div>
            )}

            {/* Add / Override Manual Channel Token */}
            <form
              onSubmit={handleManualConnectSubmit}
              className="space-y-3.5 rounded-xl border border-zinc-200 bg-white p-4 text-xs"
            >
              <div className="font-bold text-slate-900">
                Link Channel via Manual Access Token
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block font-semibold text-slate-700">Channel Type</label>
                  <select
                    name="channelKind"
                    value={manualKind}
                    onChange={(e) => setManualKind(e.target.value as ConnectionChannelKind)}
                    className="rsl-input text-xs"
                  >
                    <option value="whatsapp_cloud">WhatsApp Business Cloud API</option>
                    <option value="instagram_business">Instagram Business</option>
                    <option value="facebook_page">Facebook Page</option>
                    <option value="meta_ads_pixel">Meta Ads &amp; Pixel</option>
                    <option value="google_business">Google Business Profile</option>
                    <option value="google_ads">Google Ads</option>
                    <option value="google_drive">Google Drive</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700">
                    Account / Display Name *
                  </label>
                  <input
                    name="displayName"
                    required
                    placeholder="e.g. Main Business WhatsApp"
                    className="rsl-input text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700">
                    Primary Account / Asset ID *
                  </label>
                  <input
                    name="externalAccountId"
                    required
                    placeholder={
                      manualKind === "whatsapp_cloud"
                        ? "Phone Number ID (15 digits)"
                        : manualKind === "meta_ads_pixel"
                          ? "act_1234567890"
                          : "Numeric Page / IG / Customer ID"
                    }
                    className="rsl-input font-mono text-xs"
                  />
                </div>
              </div>

              {manualKind === "whatsapp_cloud" && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block font-semibold text-slate-700">
                      WABA ID (Optional)
                    </label>
                    <input
                      name="wabaId"
                      placeholder="WhatsApp Business Account ID"
                      className="rsl-input font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-slate-700">
                      Display Phone Number (Optional)
                    </label>
                    <input
                      name="displayPhone"
                      placeholder="+91 98765 43210"
                      className="rsl-input text-xs"
                    />
                  </div>
                </div>
              )}

              {manualKind === "meta_ads_pixel" && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block font-semibold text-slate-700">
                      Meta Pixel ID (Optional)
                    </label>
                    <input
                      name="pixelId"
                      placeholder="15-digit Pixel ID"
                      className="rsl-input font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-slate-700">
                      Linked Facebook Page ID (Optional)
                    </label>
                    <input
                      name="pageId"
                      placeholder="Facebook Page ID for ad creatives"
                      className="rsl-input font-mono text-xs"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold text-slate-700">
                    Access Token *
                  </label>
                  <input
                    name="accessToken"
                    type="password"
                    required
                    minLength={8}
                    placeholder="Paste permanent System User or OAuth access token"
                    className="rsl-input font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700">
                    Refresh Token (Optional - Google OAuth)
                  </label>
                  <input
                    name="refreshToken"
                    type="password"
                    placeholder="Optional OAuth refresh token"
                    className="rsl-input font-mono text-xs"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={pendingKey === "manual-connect"}
                  className="rsl-btn-primary inline-flex items-center gap-2 py-2 text-xs"
                >
                  {pendingKey === "manual-connect" && (
                    <IosSpinner size="xs" className="text-white" />
                  )}
                  <span>
                    {pendingKey === "manual-connect"
                      ? "Saving & Verifying..."
                      : "Save Manual Credentials"}
                  </span>
                </button>
              </div>
            </form>

            {/* Rotate Manual Token on Existing Connected Channels */}
            {connections.length > 0 && (
              <div className="space-y-2 rounded-xl border border-zinc-200 bg-white p-4 text-xs">
                <div className="font-bold text-slate-900">
                  Rotate Token on Existing Connection
                </div>
                <div className="divide-y divide-zinc-100">
                  {connections.map((c) => {
                    const isEditing = rotatingConnId === c.id;
                    const isSaving = pendingKey === `manual-rotate:${c.id}`;
                    return (
                      <div key={c.id} className="py-2.5 first:pt-1 last:pb-0">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <span className="font-semibold text-slate-900">{c.displayName}</span>{" "}
                            <span className="font-mono text-[11px] text-zinc-500">
                              ({c.externalAccountId})
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setRotatingConnId(isEditing ? null : c.id)}
                            className="rsl-btn-secondary py-1 text-xs"
                          >
                            {isEditing ? "Cancel" : "Rotate Token"}
                          </button>
                        </div>
                        {isEditing && (
                          <form
                            onSubmit={(e) => handleManualRotateSubmit(c.id, e)}
                            className="mt-2.5 flex flex-wrap items-center gap-2"
                          >
                            <input
                              name="accessToken"
                              type="password"
                              required
                              minLength={6}
                              placeholder="New access token..."
                              className="rsl-input min-w-[220px] flex-1 font-mono text-xs"
                            />
                            <button
                              type="submit"
                              disabled={isSaving}
                              className="rsl-btn-primary inline-flex items-center gap-1.5 py-1.5 text-xs"
                            >
                              {isSaving && <IosSpinner size="xs" className="text-white" />}
                              <span>Save Token</span>
                            </button>
                          </form>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
