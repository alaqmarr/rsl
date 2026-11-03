"use client";

import React, { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmptyWorkspaceState, IosSpinner, SectionCard, sileo, StatusPill } from "@rsl/ui";
import type { ConnectionChannelKind, ConnectionMetadata } from "@rsl/connections";
import { CopyTextButton } from "@/components/client-utils";
import { ConnectToGoogleDriveButton, GoogleGLogo } from "@/components/google-drive-connect-button";
import {
  connectChannelJsonAction,
  disconnectConnectionJsonAction,
  rotateMetaVerifyTokenJsonAction,
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
  consentAppName: string;
  publishingStatus: "production" | "testing";
  defaultDriveFolderName: string;
}

export interface ConnectionsHubProps {
  initialKind?: ConnectionChannelKind;
  connections: SerializedConnectionItem[];
  whatsappWebhookUrl: string;
  metaWebhookUrl: string;
  webhookVerifyToken: string;
  canManage: boolean;
  googleOAuth?: GoogleOAuthClientStatus;
}

interface WhitelistStep {
  title: string;
  detail: string;
  codeHint?: string;
}

interface ChannelBlueprint {
  kind: ConnectionChannelKind;
  shortLabel: string;
  title: string;
  badgeText: string;
  summary: string;
  webhookMode: "whatsapp" | "meta" | "none";
  webhookFields: string[];
  requiredScopes: string[];
  steps: WhitelistStep[];
}

const CHANNEL_BLUEPRINTS: ChannelBlueprint[] = [
  {
    kind: "whatsapp_cloud",
    shortLabel: "WhatsApp Cloud API",
    title: "WhatsApp Business Cloud API",
    badgeText: "Official Meta WABA",
    summary:
      "Connect your official WhatsApp Business Account (WABA) and Phone Number ID for Tally Prime invoice automation, broadcasts, and 2-way shared inbox.",
    webhookMode: "whatsapp",
    webhookFields: ["messages", "message_template_status_update"],
    requiredScopes: [
      "whatsapp_business_messaging",
      "whatsapp_business_management",
      "business_management",
    ],
    steps: [
      {
        title: "1. Whitelist Platform Domain & Privacy URL in Meta App Dashboard",
        detail:
          "Open developers.facebook.com/apps → App Settings → Basic. Add your RSL app domain under App Domains and set a valid HTTPS Privacy Policy URL (mandatory before switching to Live Mode).",
      },
      {
        title: "2. Whitelist Test Recipient Phone Numbers (Development Mode)",
        detail:
          "While your Meta App is in Development Mode, go to WhatsApp → API Setup → 'To' field → Manage phone number list and verify up to 5 recipient numbers via OTP. This prevents Meta Error #131030 ('Recipient phone number not in allowed list').",
      },
      {
        title: "3. Create an Admin System User & Assign Your WABA Asset",
        detail:
          "Open business.facebook.com/settings → Users → System Users. Create an Admin System User, click Assign Assets → WhatsApp Accounts, select your WABA, and turn ON Full Control (Manage WhatsApp Account).",
      },
      {
        title: "4. Generate a Permanent System User Token (Never Temporary 24h Token)",
        detail:
          "Click Generate New Token on the System User, choose your Meta App, set Token Expiration to 'Never', and grant all three required WhatsApp permissions below. Temporary API Setup tokens expire in 24 hours (Error 190).",
        codeHint: "whatsapp_business_messaging, whatsapp_business_management, business_management",
      },
      {
        title: "5. Verify Webhook Callback URL & Subscribe to Events",
        detail:
          "In Meta App Dashboard → WhatsApp → Configuration → Webhook, paste the Callback URL and Verify Token shown on the left, click Verify and save, then click Manage and enable 'messages' and 'message_template_status_update'.",
      },
      {
        title: "6. Attach Payment Method & Switch Meta App to Live Mode",
        detail:
          "In Meta Business Settings → Billing & Payments, attach a valid card to your WABA (prevents Error #131042), complete Business Verification for higher messaging tiers, and flip the top Meta App toggle from Development to Live.",
      },
    ],
  },
  {
    kind: "instagram_business",
    shortLabel: "Instagram Business",
    title: "Instagram Business Account (DMs, Comments & Publishing)",
    badgeText: "Meta Graph IG",
    summary:
      "Link your Instagram Professional (Business/Creator) account to receive Instagram DMs and comments in Shared Inbox and publish scheduled posts.",
    webhookMode: "meta",
    webhookFields: ["messages", "messaging_postbacks", "comments"],
    requiredScopes: [
      "instagram_basic",
      "instagram_manage_messages",
      "instagram_manage_comments",
      "instagram_content_publish",
      "pages_show_list",
      "pages_read_engagement",
      "pages_manage_metadata",
    ],
    steps: [
      {
        title: "1. Switch Instagram to Business/Creator & Link a Facebook Page",
        detail:
          "Instagram Graph API requires a Professional account linked to a Facebook Page inside the same Meta Business Portfolio (Instagram App → Edit Profile → Page, or Facebook Page → Settings → Linked Accounts → Instagram).",
      },
      {
        title: "2. Enable 'Allow Access to Messages' in Instagram Mobile App (Critical)",
        detail:
          "Open the Instagram mobile app on your phone → Settings and activity → Messages and story replies → Message controls → Connected tools → Toggle ON 'Allow access to messages'. Without this switch, Meta silently drops all DM webhooks!",
      },
      {
        title: "3. Whitelist Instagram Tester Accounts (Development Mode)",
        detail:
          "In Meta App Dashboard → App Roles → Roles → Add People → Instagram Testers, invite your @handle. Then log into instagram.com on desktop → Settings → Website Permissions → Apps and Websites → Tester Invites → Accept.",
      },
      {
        title: "4. Assign Both Facebook Page & Instagram Asset to System User",
        detail:
          "In business.facebook.com/settings → System Users → Assign Assets, grant Full Control to BOTH the linked Facebook Page (under Pages) and your Instagram profile (under Instagram Accounts).",
      },
      {
        title: "5. Copy Your 17-Digit Instagram Business User ID (Not @Username)",
        detail:
          "Call GET /v21.0/{page-id}?fields=instagram_business_account or inspect Graph API Explorer to obtain your numeric 17-digit IG Business Account ID (e.g. 17841405822304914) and generate a System User token with the scopes below.",
        codeHint:
          "instagram_basic, instagram_manage_messages, instagram_manage_comments, instagram_content_publish, pages_show_list",
      },
      {
        title: "6. Verify Instagram Webhook & Subscribe Fields",
        detail:
          "In Meta App Dashboard → Webhooks → Select 'Instagram' from the dropdown, paste the Meta Callback URL and Verify Token on the left, and subscribe to 'messages', 'messaging_postbacks', and 'comments'.",
      },
    ],
  },
  {
    kind: "facebook_page",
    shortLabel: "Facebook Page",
    title: "Facebook Page & Messenger",
    badgeText: "Page & Messenger",
    summary:
      "Connect your Facebook Business Page to reply to Messenger chats, moderate post comments, and publish scheduled page updates.",
    webhookMode: "meta",
    webhookFields: ["messages", "messaging_postbacks", "feed"],
    requiredScopes: [
      "pages_show_list",
      "pages_messaging",
      "pages_manage_posts",
      "pages_read_engagement",
      "pages_manage_metadata",
    ],
    steps: [
      {
        title: "1. Confirm Page Ownership in Meta Business Portfolio",
        detail:
          "Verify your Facebook Page is claimed under business.facebook.com/settings/pages. Find your numeric Facebook Page ID under your Page → About → Page Transparency.",
      },
      {
        title: "2. Whitelist System User on the Facebook Page Asset",
        detail:
          "Open Meta Business Settings → System Users → Assign Assets → Pages, select your Facebook Page, and enable Full Control (Manage Page, Content, Messages, Community Activity).",
      },
      {
        title: "3. Generate a Non-Expiring Page Access Token",
        detail:
          "Generate a System User token with the Page scopes below, then call GET /v21.0/me/accounts to retrieve the Page-specific never-expiring access_token for your Page ID.",
        codeHint:
          "pages_show_list, pages_messaging, pages_manage_posts, pages_read_engagement, pages_manage_metadata",
      },
      {
        title: "4. Set App as Primary Receiver in Advanced Messaging",
        detail:
          "On your Facebook Page → Settings → New Pages Experience → Advanced Messaging → Handover Protocol, assign your Meta App as Primary Receiver for Messenger conversations.",
      },
      {
        title: "5. Verify Page Webhook & Subscribe Page App",
        detail:
          "In Meta App Dashboard → Webhooks → Page, verify the Callback URL and Verify Token shown on the left, subscribe to 'messages', 'messaging_postbacks', and 'feed', and subscribe your Page in Messenger → Settings.",
      },
    ],
  },
  {
    kind: "meta_ads_pixel",
    shortLabel: "Meta Ads & Pixel",
    title: "Meta Ad Account & Conversions API Pixel",
    badgeText: "ROAS & CAPI",
    summary:
      "Sync Facebook & Instagram ad spend against Tally revenue and send deduplicated server-side Website Sales Events via Conversions API.",
    webhookMode: "none",
    webhookFields: [],
    requiredScopes: ["ads_read", "ads_management", "business_management"],
    steps: [
      {
        title: "1. Assign Ad Account & Dataset/Pixel to System User",
        detail:
          "In Meta Business Settings → System Users → Assign Assets, grant Manage Campaigns on your Ad Account and Manage Events on your Dataset / Pixel.",
      },
      {
        title: "2. Whitelist Website Domains in Events Manager",
        detail:
          "Open Events Manager → Data Sources → Settings → Traffic Permissions → Create Allow List, and whitelist your primary website domain so third-party domains cannot pollute conversion metrics.",
      },
      {
        title: "3. Generate Marketing + Conversions API Token",
        detail:
          "Generate a permanent System User token with 'ads_read', 'ads_management', and 'business_management' (or click 'Generate access token' inside Events Manager → Settings → Conversions API).",
        codeHint: "ads_read, ads_management, business_management",
      },
      {
        title: "4. Format Ad Account ID with 'act_' Prefix",
        detail:
          "Always include the 'act_' prefix on your Ad Account ID (for example: act_293847561029384) along with your numeric 15-16 digit Pixel / Dataset ID.",
      },
    ],
  },
  {
    kind: "google_business",
    shortLabel: "Google Business",
    title: "Google Business Profile (Store Reviews & Replies)",
    badgeText: "1-Click Google OAuth",
    summary:
      "Sign in directly with Google to pull customer star ratings across store locations and publish verified owner replies to Google Maps & Search.",
    webhookMode: "none",
    webhookFields: [],
    requiredScopes: ["https://www.googleapis.com/auth/business.manage"],
    steps: [
      {
        title: "1. Click 'Connect Google Business Profile' on the Left",
        detail:
          "You do NOT need Google Cloud Console, Service Account JSON files, or manual tokens. Click the Google Sign-In button and select the Google account that owns or manages your verified Google Business Profile listing.",
      },
      {
        title: "2. Approve 'RapidShift Labs' on Google's Consent Screen",
        detail:
          "Review the permission prompt on accounts.google.com and click Continue / Allow. RapidShift Labs receives a secure auto-renewing token encrypted in your workspace vault.",
        codeHint: "https://www.googleapis.com/auth/business.manage",
      },
      {
        title: "3. Automatic Storefront & Location Discovery",
        detail:
          "Immediately after sign-in, RapidShift Labs discovers your verified GBP Account and primary Storefront Location ID automatically so customer reviews sync straight into the Google Reviews tab.",
      },
      {
        title: "4. Multi-Branch Override (Only If You Manage Multiple Locations)",
        detail:
          "If your Google account manages multiple branches and you want to target a specific store, click 'Rotate Token / Edit' on the connected card below to enter a specific locations/... ID.",
      },
    ],
  },
  {
    kind: "google_drive",
    shortLabel: "Google Drive",
    title: "Google Drive Off-Site Backup Vault",
    badgeText: "1-Click Google OAuth",
    summary:
      "Connect your Google Drive in 2 clicks using Google's official Consent Screen — creates a dedicated backup folder automatically and mirrors every encrypted .rslbackup archive.",
    webhookMode: "none",
    webhookFields: [],
    requiredScopes: ["https://www.googleapis.com/auth/drive.file"],
    steps: [
      {
        title: "1. Click 'Connect to Google Drive' (No Service Account JSON Needed!)",
        detail:
          "Never create or upload a Google Service Account JSON file. Simply click 'Connect to Google Drive' on the left and pick the Gmail or Google Workspace account where you want off-site backups stored.",
      },
      {
        title: "2. Privacy-First 'drive.file' Permission Scope",
        detail:
          "Google's Consent Screen only grants RapidShift Labs access to the specific backup folder & files it creates ('drive.file' scope). RapidShift Labs can NEVER view, list, or modify any other personal or company files in your Google Drive.",
        codeHint: "https://www.googleapis.com/auth/drive.file",
      },
      {
        title: "3. Automatic Backup Folder Creation",
        detail:
          "As soon as you click Allow on Google's screen, RapidShift Labs automatically creates a 'RapidShift Labs Backups' folder in your Google Drive — no manual Folder ID copying required.",
      },
      {
        title: "4. Automatic Off-Site Upload on Every Backup",
        detail:
          "Whenever you create an encrypted .rslbackup snapshot in Cloud Storage & Backups, a copy is uploaded automatically to your Google Drive folder with auto-renewing OAuth refresh tokens.",
      },
    ],
  },
];

const CHANNEL_LABEL_BY_KIND: Record<ConnectionChannelKind, string> = {
  whatsapp_cloud: "WhatsApp Cloud API",
  instagram_business: "Instagram Business",
  facebook_page: "Facebook Page",
  meta_ads_pixel: "Meta Ads & Pixel",
  google_business: "Google Business Profile",
  google_drive: "Google Drive Backup",
};

export function ConnectionsHub({
  initialKind,
  connections,
  whatsappWebhookUrl,
  metaWebhookUrl,
  webhookVerifyToken: initialVerifyToken,
  canManage,
  googleOAuth,
}: ConnectionsHubProps) {
  const router = useRouter();
  const [selectedKind, setSelectedKind] = useState<ConnectionChannelKind>(
    initialKind ?? "whatsapp_cloud"
  );
  const [verifyToken, setVerifyToken] = useState(initialVerifyToken);
  const [showAccessToken, setShowAccessToken] = useState(false);
  const [accessTokenInput, setAccessTokenInput] = useState("");
  const [testLiveAfterSave, setTestLiveAfterSave] = useState(true);

  const [isConnecting, startConnectTransition] = useTransition();
  const [isRotatingVerify, startRotateVerifyTransition] = useTransition();
  const [pendingCardAction, setPendingCardAction] = useState<string | null>(null);
  const [, startCardTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);

  const activeBlueprint = useMemo(
    () => CHANNEL_BLUEPRINTS.find((b) => b.kind === selectedKind) ?? CHANNEL_BLUEPRINTS[0]!,
    [selectedKind]
  );

  const countByKind = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of connections) {
      map[c.channelKind] = (map[c.channelKind] ?? 0) + 1;
    }
    return map;
  }, [connections]);

  function handleFillSandboxToken() {
    const sample = `rsl_sandbox_${selectedKind}_${Math.random().toString(36).slice(2, 10)}`;
    setAccessTokenInput(sample);
    setShowAccessToken(true);
    sileo.success({
      title: "Filled Sandbox Test Token",
      description:
        "Sandbox tokens let you test full connection & webhook routing locally before pasting a live Meta/Google token.",
      duration: 4200,
    });
  }

  function handleConnectSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    fd.set("channelKind", selectedKind);
    fd.set("testLiveAfterSave", testLiveAfterSave ? "1" : "0");

    startConnectTransition(async () => {
      const res = await connectChannelJsonAction(fd);
      if (res.ok) {
        if (res.liveStatus === "needs_reauth") {
          sileo.error({
            title: "Saved, but Live API Check Reported an Issue",
            description: res.liveMessage || res.message,
            duration: 6500,
          });
        } else {
          sileo.success({
            title: `${activeBlueprint.shortLabel} Connected`,
            description: res.message,
            duration: 5000,
          });
        }
        formEl.reset();
        setAccessTokenInput("");
        router.refresh();
      } else {
        sileo.error({
          title: "Could Not Connect Channel",
          description: res.message,
          duration: 5500,
        });
      }
    });
  }

  function handleRotateVerifyToken() {
    startRotateVerifyTransition(async () => {
      const res = await rotateMetaVerifyTokenJsonAction();
      if (res.ok && res.verifyToken) {
        setVerifyToken(res.verifyToken);
        sileo.success({
          title: "Verify Token Rotated",
          description: res.message,
          duration: 4800,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Could Not Rotate Verify Token",
          description: res.message,
          duration: 4800,
        });
      }
    });
  }

  function handleVerifyLive(conn: SerializedConnectionItem) {
    setPendingCardAction(`verify:${conn.id}`);
    startCardTransition(async () => {
      const fd = new FormData();
      fd.set("connectionId", conn.id);
      const res = await verifyConnectionLiveJsonAction(fd);
      setPendingCardAction(null);
      if (res.ok) {
        sileo.success({
          title: `${conn.displayName} — Healthy`,
          description: res.message,
          duration: 5000,
        });
      } else {
        sileo.error({
          title: `${conn.displayName} — Needs Attention`,
          description: res.message,
          duration: 6500,
        });
      }
      router.refresh();
    });
  }

  function handleDisconnect(conn: SerializedConnectionItem) {
    setPendingCardAction(`disconnect:${conn.id}`);
    startCardTransition(async () => {
      const fd = new FormData();
      fd.set("connectionId", conn.id);
      const res = await disconnectConnectionJsonAction(fd);
      setPendingCardAction(null);
      if (res.ok) {
        sileo.success({
          title: "Channel Disconnected",
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

  function handleInlineUpdate(connId: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("connectionId", connId);
    fd.set("testLiveAfterSave", "1");
    setPendingCardAction(`update:${connId}`);
    startCardTransition(async () => {
      const res = await updateConnectionJsonAction(fd);
      setPendingCardAction(null);
      if (res.ok) {
        setEditingId(null);
        if (res.liveStatus === "needs_reauth") {
          sileo.error({
            title: "Updated, but Live Token Check Failed",
            description: res.message,
            duration: 6200,
          });
        } else {
          sileo.success({
            title: "Channel Credentials Updated",
            description: res.message,
            duration: 4800,
          });
        }
        router.refresh();
      } else {
        sileo.error({
          title: "Update Failed",
          description: res.message,
          duration: 5200,
        });
      }
    });
  }

  const activeCallbackUrl =
    activeBlueprint.webhookMode === "whatsapp" ? whatsappWebhookUrl : metaWebhookUrl;
  const activeDriveConn = connections.find((c) => c.channelKind === "google_drive");

  return (
    <div className="w-full space-y-6">
      {/* Quick-Connect Google Drive Off-Site Backup Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200/90 bg-emerald-50/70 px-4 py-3 text-[13px]">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white shadow-2xs ring-1 ring-emerald-200">
            <GoogleGLogo className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            {activeDriveConn ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-slate-900">
                  Google Drive Backups Connected ({activeDriveConn.metadata.driveEmail || activeDriveConn.displayName})
                </span>
                <span className="rounded-md border border-emerald-200 bg-white px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-900">
                  Folder: {activeDriveConn.metadata.folderName || googleOAuth?.defaultDriveFolderName || "RapidShift Labs Backups"}
                </span>
              </div>
            ) : (
              <div>
                <span className="font-bold text-slate-900">
                  Off-Site Encrypted Backups to Your Google Drive
                </span>{" "}
                <span className="text-xs text-slate-700">
                  — Connect your Google Drive in 1 click (auto-creates your backup folder, zero JSON files needed).
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeDriveConn ? (
            <>
              {activeDriveConn.metadata.folderWebViewLink && (
                <a
                  href={activeDriveConn.metadata.folderWebViewLink}
                  target="_blank"
                  rel="noreferrer"
                  className="rsl-btn-secondary py-1.5 text-xs"
                >
                  Open Drive Folder ↗
                </a>
              )}
              <Link href="/backups" className="rsl-btn-primary py-1.5 text-xs">
                Manage Backups →
              </Link>
            </>
          ) : canManage ? (
            <ConnectToGoogleDriveButton
              returnTo="/connections?tab=google_drive"
              label="Connect to Google Drive"
              size="sm"
            />
          ) : (
            <Link href="/backups" className="rsl-btn-secondary py-1.5 text-xs">
              View Backup Status →
            </Link>
          )}
        </div>
      </div>

      {/* Channel Selector Tabs */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {CHANNEL_BLUEPRINTS.map((bp) => {
          const isSelected = bp.kind === selectedKind;
          const connectedCount = countByKind[bp.kind] ?? 0;

          return (
            <button
              key={bp.kind}
              type="button"
              onClick={() => setSelectedKind(bp.kind)}
              className={`min-w-0 rounded-2xl border p-3.5 text-left transition-all ${
                isSelected
                  ? "border-emerald-500 bg-emerald-50/75 shadow-2xs ring-1 ring-emerald-500/30"
                  : "border-zinc-200/90 bg-white hover:border-zinc-300 hover:bg-zinc-50/50"
              }`}
            >
              <div className="flex items-center justify-between gap-1.5">
                <span
                  className={`truncate text-[10px] font-bold tracking-wider uppercase ${
                    isSelected ? "text-emerald-800" : "text-zinc-400"
                  }`}
                >
                  {bp.badgeText}
                </span>
                {connectedCount > 0 && (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 tabular-nums">
                    {connectedCount} active
                  </span>
                )}
              </div>
              <div className="mt-1 truncate text-[13px] font-bold text-slate-900">
                {bp.shortLabel}
              </div>
            </button>
          );
        })}
      </div>

      {/* Main Two-Column Connection + Whitelisting Studio */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left Column: Tailored Channel Form + Webhook Credentials */}
        <div className="min-w-0 space-y-6 xl:col-span-6">
          <SectionCard title={`Connect ${activeBlueprint.title}`} subtitle={activeBlueprint.summary}>
            {!canManage ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-[13px] text-amber-950">
                Your current team role has view-only access to Connected Channels. Ask a Business
                Owner or Admin to link or rotate external provider tokens.
              </div>
            ) : (
              <div className="space-y-4">
                {selectedKind.startsWith("google") && (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/75 p-4 text-[13px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 text-[11px] font-bold text-emerald-800 ring-1 ring-emerald-200">
                        Recommended • Official Google Consent Screen
                      </span>
                      <span className="text-[11px] font-semibold text-emerald-900">
                        App: {googleOAuth?.consentAppName || "RapidShift Labs"}
                      </span>
                    </div>
                    <h4 className="mt-2.5 text-sm font-bold text-slate-900">
                      {selectedKind === "google_drive"
                        ? "Connect Your Google Drive Automatically in 2 Clicks"
                        : "Connect Google Business Profile with Google Sign-In"}
                    </h4>
                    <p className="mt-1 text-xs leading-relaxed text-slate-700">
                      {selectedKind === "google_drive"
                        ? `No Google Cloud Console, no Service Account JSONs, and no manual Folder IDs needed. Sign in on Google's official screen — RapidShift Labs automatically creates '${googleOAuth?.defaultDriveFolderName || "RapidShift Labs Backups"}' in your Drive using the privacy-safe drive.file scope.`
                        : "Sign in with the Google account that manages your verified Google Business Profile listing. Storefront locations and auto-renewing refresh tokens are configured automatically."}
                    </p>

                    <div className="mt-3.5 flex flex-wrap items-center gap-3">
                      <ConnectToGoogleDriveButton
                        purpose={selectedKind === "google_drive" ? "google_drive" : "google_business"}
                        returnTo={`/connections?tab=${selectedKind}`}
                        label={
                          selectedKind === "google_drive"
                            ? "Connect to Google Drive"
                            : "Connect Google Business Profile"
                        }
                      />
                      <span className="text-[11px] text-emerald-900/80">
                        Auto-renews tokens • Zero JSON files required
                      </span>
                    </div>

                    {((selectedKind === "google_drive" && !googleOAuth?.enableDriveOAuth) ||
                      (selectedKind === "google_business" && !googleOAuth?.enableGbpOAuth)) && (
                      <p className="mt-2.5 text-[11px] font-medium text-amber-900">
                        Note: Platform Google OAuth keys have not been saved yet under Staff Portal → OAuth &amp; API Credentials. Save them once in the Admin Portal so live Google Sign-In activates immediately.
                      </p>
                    )}
                  </div>
                )}

                <details
                  open={!selectedKind.startsWith("google")}
                  className={
                    selectedKind.startsWith("google")
                      ? "group rounded-xl border border-zinc-200/90 bg-zinc-50/50 p-3.5"
                      : ""
                  }
                >
                  {selectedKind.startsWith("google") && (
                    <summary className="cursor-pointer list-none text-xs font-semibold text-slate-700 select-none">
                      <span className="inline-flex items-center gap-1.5">
                        <span>Advanced / Sandbox Testing Only: Paste Manual OAuth Token Override</span>
                        <span className="text-[11px] font-normal text-zinc-500">(Click to expand)</span>
                      </span>
                    </summary>
                  )}

              <form
                key={selectedKind}
                onSubmit={handleConnectSubmit}
                className={`space-y-4 text-[13px] ${selectedKind.startsWith("google") ? "mt-3.5 border-t border-zinc-200/80 pt-3.5" : ""}`}
              >
                {selectedKind === "whatsapp_cloud" && (
                  <>
                    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                      <div className="min-w-0">
                        <label className="rsl-label">Friendly Line Label *</label>
                        <input
                          name="displayName"
                          required
                          placeholder="e.g. Main Tally & Sales WhatsApp"
                          className="rsl-input"
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="rsl-label">Registered WhatsApp Number</label>
                        <input
                          name="displayPhone"
                          placeholder="e.g. +91 98200 11223"
                          className="rsl-input"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                      <div className="min-w-0">
                        <label className="rsl-label">Phone Number ID * (Meta API ID)</label>
                        <input
                          name="phoneNumberId"
                          required
                          placeholder="e.g. 109283746501928"
                          className="rsl-input font-mono"
                        />
                        <p className="mt-1 text-[11px] text-zinc-500">
                          15-digit ID from Meta App → WhatsApp → API Setup (not your +91 mobile).
                        </p>
                      </div>
                      <div className="min-w-0">
                        <label className="rsl-label">WhatsApp Business Account (WABA) ID *</label>
                        <input
                          name="wabaId"
                          required
                          placeholder="e.g. 108293847561029"
                          className="rsl-input font-mono"
                        />
                        <p className="mt-1 text-[11px] text-zinc-500">
                          Used to sync WhatsApp templates &amp; route incoming webhooks.
                        </p>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <label className="rsl-label">Meta App ID (Optional)</label>
                      <input
                        name="metaAppId"
                        placeholder="e.g. 827364519283746"
                        className="rsl-input font-mono"
                      />
                    </div>
                  </>
                )}

                {selectedKind === "instagram_business" && (
                  <>
                    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                      <div className="min-w-0">
                        <label className="rsl-label">Account Label *</label>
                        <input
                          name="displayName"
                          required
                          placeholder="e.g. Official Instagram Business"
                          className="rsl-input"
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="rsl-label">Instagram @Handle *</label>
                        <input
                          name="igHandle"
                          required
                          placeholder="e.g. @rapidshiftlabs"
                          className="rsl-input"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                      <div className="min-w-0">
                        <label className="rsl-label">Instagram Business User ID * (17-digit)</label>
                        <input
                          name="igUserId"
                          required
                          placeholder="e.g. 17841405822304914"
                          className="rsl-input font-mono"
                        />
                        <p className="mt-1 text-[11px] text-zinc-500">
                          Numeric IG Graph ID from `instagram_business_account.id`.
                        </p>
                      </div>
                      <div className="min-w-0">
                        <label className="rsl-label">Linked Facebook Page ID *</label>
                        <input
                          name="linkedPageId"
                          required
                          placeholder="e.g. 104928374619203"
                          className="rsl-input font-mono"
                        />
                        <p className="mt-1 text-[11px] text-zinc-500">
                          Facebook Page connected to this Instagram Business profile.
                        </p>
                      </div>
                    </div>
                  </>
                )}

                {selectedKind === "facebook_page" && (
                  <>
                    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                      <div className="min-w-0">
                        <label className="rsl-label">Connection Label *</label>
                        <input
                          name="displayName"
                          required
                          placeholder="e.g. RSL Facebook Page & Messenger"
                          className="rsl-input"
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="rsl-label">Facebook Page Name</label>
                        <input
                          name="pageName"
                          placeholder="e.g. RSL Marketing India"
                          className="rsl-input"
                        />
                      </div>
                    </div>
                    <div className="min-w-0">
                      <label className="rsl-label">Facebook Page ID * (Numeric)</label>
                      <input
                        name="pageId"
                        required
                        placeholder="e.g. 104928374619203"
                        className="rsl-input font-mono"
                      />
                      <p className="mt-1 text-[11px] text-zinc-500">
                        Found on your Facebook Page → About → Page Transparency.
                      </p>
                    </div>
                  </>
                )}

                {selectedKind === "meta_ads_pixel" && (
                  <>
                    <div className="min-w-0">
                      <label className="rsl-label">Ad Account Label *</label>
                      <input
                        name="displayName"
                        required
                        placeholder="e.g. Growth Meta Ad Account & Website CAPI"
                        className="rsl-input"
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                      <div className="min-w-0">
                        <label className="rsl-label">Meta Ad Account ID * (act_...)</label>
                        <input
                          name="adAccountId"
                          required
                          placeholder="e.g. act_293847561029384"
                          className="rsl-input font-mono"
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="rsl-label">Dataset / Conversions Pixel ID</label>
                        <input
                          name="pixelId"
                          placeholder="e.g. 918273645019283"
                          className="rsl-input font-mono"
                        />
                      </div>
                    </div>
                  </>
                )}

                {selectedKind === "google_business" && (
                  <>
                    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                      <div className="min-w-0">
                        <label className="rsl-label">Storefront Connection Label *</label>
                        <input
                          name="displayName"
                          required
                          placeholder="e.g. Mumbai Head Office Listing"
                          className="rsl-input"
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="rsl-label">Store Display Name</label>
                        <input
                          name="storeName"
                          placeholder="e.g. RSL Marketing — Nariman Point"
                          className="rsl-input"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                      <div className="min-w-0">
                        <label className="rsl-label">GBP Location ID *</label>
                        <input
                          name="locationId"
                          required
                          placeholder="e.g. locations/1492837465019283746"
                          className="rsl-input font-mono"
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="rsl-label">GBP Account ID (Optional)</label>
                        <input
                          name="accountId"
                          placeholder="e.g. accounts/1092837465019"
                          className="rsl-input font-mono"
                        />
                      </div>
                    </div>
                  </>
                )}

                {selectedKind === "google_drive" && (
                  <>
                    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                      <div className="min-w-0">
                        <label className="rsl-label">Backup Vault Label *</label>
                        <input
                          name="displayName"
                          required
                          placeholder="e.g. Company Drive Encrypted Backups"
                          className="rsl-input"
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="rsl-label">Google Account Email</label>
                        <input
                          name="driveEmail"
                          type="email"
                          placeholder="e.g. backups@yourcompany.in"
                          className="rsl-input"
                        />
                      </div>
                    </div>
                    <div className="min-w-0">
                      <label className="rsl-label">Google Drive Folder ID *</label>
                      <input
                        name="folderId"
                        required
                        placeholder="e.g. 1A2b3C4d5E6f7G8h9I0jKlMnOpQr"
                        className="rsl-input font-mono"
                      />
                    </div>
                  </>
                )}

                {/* Access Token + Sandbox Helper */}
                <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/70 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-xs font-semibold text-slate-900">
                      {selectedKind.startsWith("google")
                        ? "Google OAuth 2.0 Access Token *"
                        : "Permanent System User / Page Access Token *"}
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleFillSandboxToken}
                        className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-zinc-100"
                      >
                        Fill Sandbox Token
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowAccessToken((v) => !v)}
                        className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-zinc-100"
                      >
                        {showAccessToken ? "Hide" : "Show"}
                      </button>
                    </div>
                  </div>
                  <input
                    name="accessToken"
                    type={showAccessToken ? "text" : "password"}
                    required
                    value={accessTokenInput}
                    onChange={(e) => setAccessTokenInput(e.target.value)}
                    placeholder={
                      selectedKind.startsWith("google")
                        ? "ya29.a0AfB_byC..."
                        : "EAAGm0PX4ZCpsBA..."
                    }
                    className="rsl-input mt-2 bg-white font-mono text-xs"
                  />

                  {selectedKind.startsWith("google") && (
                    <div className="mt-3">
                      <label className="rsl-label">OAuth Refresh Token (Optional — Auto-Renew)</label>
                      <input
                        name="refreshToken"
                        type="password"
                        placeholder="1//0g..."
                        className="rsl-input bg-white font-mono text-xs"
                      />
                    </div>
                  )}

                  <label className="mt-3 flex items-center gap-2 text-xs text-zinc-600">
                    <input
                      type="checkbox"
                      checked={testLiveAfterSave}
                      onChange={(e) => setTestLiveAfterSave(e.target.checked)}
                      className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>
                      Verify token live against{" "}
                      {selectedKind.startsWith("google")
                        ? "Google OAuth2 API"
                        : "Meta Graph API v21.0"}{" "}
                      immediately after saving
                    </span>
                  </label>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <button
                    type="submit"
                    disabled={isConnecting}
                    className="rsl-btn-primary inline-flex items-center gap-2"
                  >
                    {isConnecting && <IosSpinner size="xs" className="text-white" />}
                    <span>
                      {isConnecting
                        ? "Encrypting & Verifying..."
                        : `Connect ${activeBlueprint.shortLabel}`}
                    </span>
                  </button>
                  <Link
                    href="/settings/tokens"
                    className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 hover:underline"
                  >
                    Manage All API Tokens in One Page →
                  </Link>
                </div>
              </form>
                </details>
              </div>
            )}
          </SectionCard>

          {/* Inbound Webhook Callback URL + Verify Token Card */}
          {activeBlueprint.webhookMode !== "none" && (
            <SectionCard
              title="Inbound Webhook Callback URL & Verify Token"
              subtitle={`Paste these exact values inside Meta App Dashboard → ${
                activeBlueprint.webhookMode === "whatsapp" ? "WhatsApp → Configuration" : "Webhooks"
              }`}
            >
              <div className="space-y-3.5 text-[13px]">
                <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/75 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900">
                      1. HTTPS Callback URL ({activeBlueprint.shortLabel})
                    </span>
                    <CopyTextButton
                      text={activeCallbackUrl}
                      label="Copy Callback URL"
                      copiedLabel="Copied URL"
                    />
                  </div>
                  <div className="mt-1.5 break-all rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-xs font-semibold text-emerald-800">
                    {activeCallbackUrl}
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/75 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900">
                      2. Meta Webhook Verify Token
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <CopyTextButton
                        text={verifyToken}
                        label="Copy Verify Token"
                        copiedLabel="Copied Token"
                      />
                      {canManage && (
                        <button
                          type="button"
                          disabled={isRotatingVerify}
                          onClick={handleRotateVerifyToken}
                          className="rsl-btn-secondary inline-flex items-center gap-1.5 py-1 text-xs"
                        >
                          {isRotatingVerify && <IosSpinner size="xs" />}
                          <span>Rotate Token</span>
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-1.5 break-all rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-xs font-semibold text-slate-900">
                    {verifyToken}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-800">
                    3. Required Webhook Subscription Fields:
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {activeBlueprint.webhookFields.map((field) => (
                      <span
                        key={field}
                        className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-2.5 py-1 font-mono text-[11px] font-semibold text-emerald-900"
                      >
                        {field}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>
          )}
        </div>

        {/* Right Column: Step-by-Step Provider Whitelisting & Go-Live Checklist */}
        <div className="min-w-0 xl:col-span-6">
          <SectionCard
            title={`${activeBlueprint.shortLabel} — Whitelisting & Go-Live Steps`}
            subtitle="Complete every step below so Meta / Google does not block webhook delivery, DM access, or permanent tokens"
          >
            <div className="space-y-3 text-[13px]">
              {/* Copyable Required Scopes Pill Strip */}
              <div className="rounded-xl border border-emerald-200/90 bg-emerald-50/65 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold tracking-wide text-emerald-950 uppercase">
                    Required Token Permission Scopes
                  </span>
                  <CopyTextButton
                    text={activeBlueprint.requiredScopes.join(", ")}
                    label="Copy Scopes"
                    copiedLabel="Copied Scopes"
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {activeBlueprint.requiredScopes.map((sc) => (
                    <span
                      key={sc}
                      className="break-all rounded-md border border-emerald-200 bg-white px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-800"
                    >
                      {sc}
                    </span>
                  ))}
                </div>
              </div>

              {/* Numbered Checklist Cards */}
              <div className="space-y-2.5">
                {activeBlueprint.steps.map((step) => (
                  <div
                    key={step.title}
                    className="rounded-xl border border-zinc-200/90 bg-zinc-50/60 p-3.5"
                  >
                    <div className="font-semibold text-slate-900">{step.title}</div>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-600">{step.detail}</p>
                    {step.codeHint && (
                      <div className="mt-2 break-all rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 font-mono text-[11px] text-slate-800">
                        {step.codeHint}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>
        </div>
      </div>

      {/* Connected Channels Management List */}
      <SectionCard
        title={`Active Connected Channels (${connections.length})`}
        subtitle="Test live Graph/OAuth connectivity, rotate tokens in place without losing webhook routing, or disconnect anytime"
      >
        {connections.length === 0 ? (
          <EmptyWorkspaceState
            title="No external channels connected yet"
            description="Choose WhatsApp Cloud API, Instagram Business, Facebook Page, Meta Ads, or Google Business above, follow the whitelisting steps, and connect your first channel."
          />
        ) : (
          <div className="divide-y divide-zinc-200/80 text-[13px]">
            {connections.map((c) => {
              const statusLabel =
                c.status === "healthy"
                  ? "Healthy"
                  : c.status === "expiring"
                    ? "Expiring Soon"
                    : "Needs Re-Auth";
              const statusTone =
                c.status === "healthy" ? "emerald" : c.status === "expiring" ? "amber" : "ruby";
              const isVerifying = pendingCardAction === `verify:${c.id}`;
              const isDisconnecting = pendingCardAction === `disconnect:${c.id}`;
              const isUpdating = pendingCardAction === `update:${c.id}`;
              const isEditing = editingId === c.id;

              return (
                <div key={c.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-900">{c.displayName}</span>
                        <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                          {CHANNEL_LABEL_BY_KIND[c.channelKind] ?? c.provider.toUpperCase()}
                        </span>
                        <StatusPill label={statusLabel} tone={statusTone} />
                        {c.metadata.tokenMode === "sandbox" && (
                          <StatusPill label="Sandbox Token" tone="stone" showDot={false} />
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600 tabular-nums">
                        <span>
                          Primary ID:{" "}
                          <strong className="font-mono text-slate-800">{c.externalAccountId}</strong>
                        </span>
                        {c.metadata.wabaId && (
                          <span>
                            • WABA: <strong className="font-mono text-slate-800">{c.metadata.wabaId}</strong>
                          </span>
                        )}
                        {c.metadata.phoneNumberId && (
                          <span>
                            • Phone ID:{" "}
                            <strong className="font-mono text-slate-800">
                              {c.metadata.phoneNumberId}
                            </strong>
                          </span>
                        )}
                        {c.metadata.igUserId && (
                          <span>
                            • IG ID:{" "}
                            <strong className="font-mono text-slate-800">{c.metadata.igUserId}</strong>
                          </span>
                        )}
                        {(c.metadata.pageId || c.metadata.linkedPageId) && (
                          <span>
                            • Page ID:{" "}
                            <strong className="font-mono text-slate-800">
                              {c.metadata.pageId || c.metadata.linkedPageId}
                            </strong>
                          </span>
                        )}
                        <span>
                          • Token:{" "}
                          <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-800">
                            {c.maskedTokenHint}
                          </code>
                        </span>
                      </div>

                      <div
                        className={`text-xs ${
                          c.status === "needs_reauth"
                            ? "font-medium text-rose-700"
                            : "text-zinc-500"
                        }`}
                      >
                        {c.metadata.lastLiveCheckMessage
                          ? c.metadata.lastLiveCheckMessage
                          : "Stored encrypted in workspace vault."}{" "}
                        {c.lastHealthCheckAt && (
                          <span className="text-zinc-400">
                            (Checked {new Date(c.lastHealthCheckAt).toLocaleString("en-IN")})
                          </span>
                        )}
                      </div>
                    </div>

                    {canManage && (
                      <div className="flex flex-wrap items-center gap-2">
                        {c.channelKind === "google_drive" && c.metadata.folderWebViewLink && (
                          <a
                            href={c.metadata.folderWebViewLink}
                            target="_blank"
                            rel="noreferrer"
                            className="rsl-btn-secondary py-1.5 text-xs"
                          >
                            Open Drive Folder ↗
                          </a>
                        )}
                        {(c.channelKind === "google_drive" ||
                          c.channelKind === "google_business") && (
                          <ConnectToGoogleDriveButton
                            purpose={c.channelKind}
                            returnTo={`/connections?tab=${c.channelKind}`}
                            label={
                              c.channelKind === "google_drive"
                                ? "Reconnect Google Drive"
                                : "Reconnect Google"
                            }
                            variant="white"
                            size="sm"
                          />
                        )}
                        <button
                          type="button"
                          disabled={Boolean(pendingCardAction)}
                          onClick={() => handleVerifyLive(c)}
                          className="rsl-btn-secondary inline-flex items-center gap-1.5 py-1.5 text-xs"
                        >
                          {isVerifying && <IosSpinner size="xs" />}
                          <span>{isVerifying ? "Testing API..." : "Test Live API"}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(isEditing ? null : c.id)}
                          className="rsl-btn-secondary py-1.5 text-xs"
                        >
                          {isEditing ? "Cancel" : "Rotate Token / Edit"}
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(pendingCardAction)}
                          onClick={() => handleDisconnect(c)}
                          className="rsl-btn-danger-soft inline-flex items-center gap-1.5 py-1.5 text-xs"
                        >
                          {isDisconnecting && <IosSpinner size="xs" />}
                          <span>{isDisconnecting ? "Removing..." : "Disconnect"}</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Inline Token Rotation & ID Update Panel */}
                  {isEditing && canManage && (
                    <form
                      onSubmit={(e) => handleInlineUpdate(c.id, e)}
                      className="mt-3.5 rounded-xl border border-zinc-200 bg-zinc-50/80 p-4"
                    >
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="min-w-0">
                          <label className="rsl-label">Display Label</label>
                          <input
                            name="displayName"
                            defaultValue={c.displayName}
                            className="rsl-input bg-white"
                          />
                        </div>
                        <div className="min-w-0">
                          <label className="rsl-label">Primary External ID</label>
                          <input
                            name="externalAccountId"
                            defaultValue={c.externalAccountId}
                            className="rsl-input bg-white font-mono"
                          />
                        </div>
                        <div className="min-w-0">
                          <label className="rsl-label">
                            New Access Token (Leave blank to keep current)
                          </label>
                          <input
                            name="accessToken"
                            type="password"
                            placeholder="Paste replacement token to rotate..."
                            className="rsl-input bg-white font-mono text-xs"
                          />
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="submit"
                          disabled={isUpdating}
                          className="rsl-btn-primary inline-flex items-center gap-1.5 py-1.5 text-xs"
                        >
                          {isUpdating && <IosSpinner size="xs" className="text-white" />}
                          <span>{isUpdating ? "Saving & Testing..." : "Save & Verify Token"}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rsl-btn-secondary py-1.5 text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
