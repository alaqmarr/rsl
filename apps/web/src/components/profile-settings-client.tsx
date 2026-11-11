"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellRing, Fingerprint, QrCode, ShieldCheck, Trash2 } from "lucide-react";
import {
  CopyCodeBlock,
  GuideDrawerButton,
  IosSpinner,
  SectionCard,
  sileo,
  StatusPill,
  TotpQrCodeCard,
} from "@rsl/ui";
import {
  beginUserTotpEnrollmentJsonAction,
  changePasswordJsonAction,
  confirmUserTotpEnrollmentJsonAction,
  disableUserTotpMfaJsonAction,
  revokeOtherSessionsJsonAction,
  revokeSessionJsonAction,
  saveUserProfileJsonAction,
  sendVerificationEmailJsonAction,
  switchWorkspaceJsonAction,
  verifyEmailCodeJsonAction,
} from "@/lib/actions";

export interface ProfileSessionItem {
  id: string;
  isCurrent: boolean;
  ipAddress: string;
  deviceLabel: string;
  impersonatorStaffId: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface ProfileSettingsClientProps {
  user: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    jobTitle: string | null;
    emailVerified: boolean;
    createdAt: number;
    totpEnabled?: boolean;
    backupCodesRemaining?: number;
  };
  currentRoleLabel: string;
  activeWorkspaceId: string;
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    roleSlug: string;
    billingStatus: string;
  }>;
  sessions: ProfileSessionItem[];
  passkeys?: Array<{
    id: string;
    credentialId: string;
    deviceLabel: string;
    algorithm: number;
    signCount: number;
    lastUsedAt: number | null;
    createdAt: number;
  }>;
  pushSubscriptions?: Array<{
    id: string;
    endpoint: string;
    deviceLabel: string;
    createdAt: number;
    lastDeliveredAt: number | null;
  }>;
}

function base64UrlToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function ProfileSettingsClient({
  user,
  currentRoleLabel,
  activeWorkspaceId,
  workspaces,
  sessions,
  passkeys = [],
  pushSubscriptions = [],
}: ProfileSettingsClientProps) {
  const router = useRouter();
  const [isSavingProfile, startProfileTransition] = useTransition();
  const [isChangingPwd, startPwdTransition] = useTransition();
  const [isSendingCode, startSendCodeTransition] = useTransition();
  const [isVerifyingCode, startVerifyCodeTransition] = useTransition();
  const [isRevokingAll, startRevokeAllTransition] = useTransition();
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [, startSessionTransition] = useTransition();
  const [switchingWsId, setSwitchingWsId] = useState<string | null>(null);
  const [, startSwitchWsTransition] = useTransition();
  const [passkeyLabel, setPasskeyLabel] = useState("");
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  const [totpEnrollment, setTotpEnrollment] = useState<{
    secret: string;
    otpauthUri: string;
    qrCodeDataUri: string;
    accountEmail: string;
    issuer: string;
  } | null>(null);
  const [totpConfirmCode, setTotpConfirmCode] = useState("");
  const [totpDisablePassword, setTotpDisablePassword] = useState("");
  const [totpBackupCodes, setTotpBackupCodes] = useState<string[] | null>(null);
  const [isBeginningTotp, startBeginTotpTransition] = useTransition();
  const [isConfirmingTotp, startConfirmTotpTransition] = useTransition();
  const [isDisablingTotp, startDisableTotpTransition] = useTransition();

  function handleBeginTotpEnrollment() {
    startBeginTotpTransition(async () => {
      const res = await beginUserTotpEnrollmentJsonAction();
      if (res.ok && res.enrollment) {
        setTotpBackupCodes(null);
        setTotpConfirmCode("");
        setTotpEnrollment({
          secret: res.enrollment.secret,
          otpauthUri: res.enrollment.otpauthUri,
          qrCodeDataUri: res.enrollment.qrCodeDataUri,
          accountEmail: res.enrollment.accountEmail || user.email,
          issuer: res.enrollment.issuer || "RapidShift Labs",
        });
        sileo.info({
          title: "Authenticator QR Code Ready",
          description: res.message,
          duration: 4600,
        });
      } else {
        sileo.error({
          title: "Could Not Start 2FA Setup",
          description: res.message,
          duration: 5000,
        });
      }
    });
  }

  function handleConfirmTotpEnrollment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("code", totpConfirmCode);
    startConfirmTotpTransition(async () => {
      const res = await confirmUserTotpEnrollmentJsonAction(fd);
      if (res.ok) {
        setTotpEnrollment(null);
        setTotpConfirmCode("");
        setTotpBackupCodes(res.backupCodes || null);
        sileo.success({
          title: "Authenticator 2FA Enabled",
          description: res.message,
          duration: 5200,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Verification Code Rejected",
          description: res.message,
          duration: 5000,
        });
      }
    });
  }

  function handleDisableTotpMfa(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("codeOrPassword", totpDisablePassword);
    startDisableTotpTransition(async () => {
      const res = await disableUserTotpMfaJsonAction(fd);
      if (res.ok) {
        setTotpDisablePassword("");
        setTotpEnrollment(null);
        setTotpBackupCodes(null);
        sileo.success({
          title: "Authenticator 2FA Disabled",
          description: res.message,
          duration: 4600,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Could Not Disable 2FA",
          description: res.message,
          duration: 5000,
        });
      }
    });
  }

  async function handleEnrollPasskey() {
    if (typeof window === "undefined" || !window.PublicKeyCredential) {
      sileo.error({
        title: "Passkeys Unavailable",
        description: "This browser does not support W3C WebAuthn Passkeys.",
      });
      return;
    }
    setPasskeyBusy(true);
    try {
      const optRes = await fetch("/api/auth/passkey/register/options", { method: "POST" });
      const optJson = (await optRes.json()) as {
        ok: boolean;
        error?: string;
        options?: {
          challenge: string;
          rp: { id: string; name: string };
          user: { id: string; name: string; displayName: string };
          pubKeyCredParams: Array<{ type: "public-key"; alg: number }>;
          timeout: number;
          attestation: AttestationConveyancePreference;
          excludeCredentials: Array<{ id: string; type: "public-key" }>;
          authenticatorSelection: AuthenticatorSelectionCriteria;
        };
      };
      if (!optJson.ok || !optJson.options) {
        throw new Error(optJson.error || "Could not start Passkey enrollment.");
      }
      const o = optJson.options;
      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge: base64UrlToUint8Array(o.challenge),
          rp: o.rp,
          user: {
            id: base64UrlToUint8Array(o.user.id),
            name: o.user.name,
            displayName: o.user.displayName,
          },
          pubKeyCredParams: o.pubKeyCredParams,
          timeout: o.timeout,
          attestation: o.attestation,
          excludeCredentials: o.excludeCredentials.map((c) => ({
            id: base64UrlToUint8Array(c.id),
            type: "public-key" as const,
          })),
          authenticatorSelection: o.authenticatorSelection,
        },
      })) as PublicKeyCredential | null;

      if (!cred) throw new Error("Passkey enrollment was cancelled.");
      const att = cred.response as AuthenticatorAttestationResponse & {
        getPublicKey?: () => ArrayBuffer | null;
        getPublicKeyAlgorithm?: () => number;
        getTransports?: () => string[];
      };
      const spkiBuf = att.getPublicKey ? att.getPublicKey() : null;
      if (!spkiBuf) {
        throw new Error(
          "Your browser did not return a WebAuthn SPKI public key. Please use Chrome, Edge, or Safari."
        );
      }

      const authDataBuf = att.getAuthenticatorData
        ? att.getAuthenticatorData()
        : (att as unknown as { authenticatorData?: ArrayBuffer }).authenticatorData;
      if (!authDataBuf) {
        throw new Error("Your browser did not return WebAuthn authenticatorData.");
      }

      const verifyRes = await fetch("/api/auth/passkey/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credentialId: arrayBufferToBase64Url(cred.rawId),
          clientDataJSONBase64Url: arrayBufferToBase64Url(att.clientDataJSON),
          authenticatorDataBase64Url: arrayBufferToBase64Url(authDataBuf),
          publicKeySpkiBase64Url: arrayBufferToBase64Url(spkiBuf),
          algorithm: att.getPublicKeyAlgorithm ? att.getPublicKeyAlgorithm() : -7,
          transports: att.getTransports ? att.getTransports() : [],
          deviceLabel: passkeyLabel.trim() || navigator.platform || "Device Passkey",
        }),
      });
      const verifyJson = (await verifyRes.json()) as { ok: boolean; error?: string };
      if (!verifyJson.ok) {
        throw new Error(verifyJson.error || "Passkey verification failed.");
      }

      setPasskeyLabel("");
      sileo.success({
        title: "Passkey Registered!",
        description: "You can now sign in with 1-tap Fingerprint / Face ID / Windows Hello.",
      });
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not register Passkey.";
      if (!/abort|notallowed/i.test(msg)) {
        sileo.error({ title: "Passkey Setup Failed", description: msg, duration: 5000 });
      }
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function handleRemovePasskey(passkeyId: string) {
    setPasskeyBusy(true);
    try {
      const res = await fetch("/api/auth/passkey/register/verify", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passkeyId }),
      });
      if (res.ok) {
        sileo.success({ title: "Passkey Removed" });
        router.refresh();
      }
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function handleEnableWebPush() {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      sileo.error({
        title: "Push Not Supported",
        description: "Your current browser does not support W3C Web Push notifications.",
      });
      return;
    }
    setPushBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        throw new Error("Please allow browser notifications when prompted.");
      }
      const keyRes = await fetch("/api/push/vapid-public-key");
      const keyJson = (await keyRes.json()) as { ok: boolean; publicKey?: string; error?: string };
      if (!keyJson.ok || !keyJson.publicKey) {
        throw new Error(keyJson.error || "Could not load VAPID public key.");
      }

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(keyJson.publicKey),
      });
      const subJson = sub.toJSON();
      const saveRes = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: subJson.keys,
          deviceLabel: navigator.platform || "This Browser",
        }),
      });
      const saveOut = (await saveRes.json()) as { ok: boolean; error?: string };
      if (!saveOut.ok) throw new Error(saveOut.error || "Could not save push subscription.");

      sileo.success({
        title: "Instant Push Alerts Enabled!",
        description: "You will receive live desktop/mobile alerts for WhatsApp chats, Tally payments & Google reviews.",
      });
      router.refresh();
    } catch (err) {
      sileo.error({
        title: "Could Not Enable Push",
        description: err instanceof Error ? err.message : "Push registration failed.",
        duration: 5000,
      });
    } finally {
      setPushBusy(false);
    }
  }

  async function handleTestWebPush() {
    setPushBusy(true);
    try {
      const res = await fetch("/api/push/subscribe", { method: "PATCH" });
      const out = (await res.json()) as { ok: boolean; delivered?: number };
      if (out.ok) {
        sileo.success({
          title: "Test Push Dispatched",
          description: `Sent encrypted push notification to ${out.delivered ?? 1} subscribed browser(s).`,
        });
      }
    } finally {
      setPushBusy(false);
    }
  }

  async function handleRemovePushSub(subscriptionId: string) {
    setPushBusy(true);
    try {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId }),
      });
      sileo.success({ title: "Push Device Unsubscribed" });
      router.refresh();
    } finally {
      setPushBusy(false);
    }
  }

  function handleProfileSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startProfileTransition(async () => {
      const res = await saveUserProfileJsonAction(fd);
      if (res.ok) {
        sileo.success({
          title: "Profile Saved",
          description: res.message,
          duration: 4600,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Could Not Save Profile",
          description: res.message,
          duration: 5200,
        });
      }
    });
  }

  function handlePasswordSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    startPwdTransition(async () => {
      const res = await changePasswordJsonAction(fd);
      if (res.ok) {
        formEl.reset();
        sileo.success({
          title: "Password Updated",
          description: res.message,
          duration: 4600,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Password Change Failed",
          description: res.message,
          duration: 5200,
        });
      }
    });
  }

  function handleSendVerificationCode() {
    startSendCodeTransition(async () => {
      const res = await sendVerificationEmailJsonAction();
      if (res.ok) {
        sileo.success({
          title: "Verification Code Sent",
          description: res.message,
          duration: 5000,
        });
      } else {
        sileo.error({
          title: "Could Not Send Code",
          description: res.message,
          duration: 5000,
        });
      }
    });
  }

  function handleVerifyCodeSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    startVerifyCodeTransition(async () => {
      const res = await verifyEmailCodeJsonAction(fd);
      if (res.ok) {
        formEl.reset();
        sileo.success({
          title: "Email Verified",
          description: res.message,
          duration: 4600,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Verification Failed",
          description: res.message,
          duration: 5200,
        });
      }
    });
  }

  function handleRevokeSession(sessionId: string) {
    setPendingSessionId(sessionId);
    startSessionTransition(async () => {
      const fd = new FormData();
      fd.set("targetSessionId", sessionId);
      const res = await revokeSessionJsonAction(fd);
      setPendingSessionId(null);
      if (res.ok) {
        sileo.success({
          title: "Session Signed Out",
          description: res.message,
          duration: 4200,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Action Failed",
          description: res.message,
          duration: 4800,
        });
      }
    });
  }

  function handleRevokeOtherSessions() {
    startRevokeAllTransition(async () => {
      const res = await revokeOtherSessionsJsonAction();
      if (res.ok) {
        sileo.success({
          title: "Other Devices Signed Out",
          description: res.message,
          duration: 4600,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Could Not Sign Out Sessions",
          description: res.message,
          duration: 5000,
        });
      }
    });
  }

  function handleSwitchWorkspace(workspaceId: string) {
    setSwitchingWsId(workspaceId);
    startSwitchWsTransition(async () => {
      const fd = new FormData();
      fd.set("workspaceId", workspaceId);
      const res = await switchWorkspaceJsonAction(fd);
      setSwitchingWsId(null);
      if (res.ok) {
        sileo.success({
          title: "Switched Active Business",
          description: res.message,
          duration: 4000,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Could Not Switch Business",
          description: res.message,
          duration: 4800,
        });
      }
    });
  }

  const otherSessionsCount = sessions.filter((s) => !s.isCurrent).length;

  return (
    <div className="w-full space-y-6">
      {/* Identity Overview Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-2xs">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-lg font-bold text-white">
            {user.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-bold tracking-tight text-slate-900">
                {user.name}
              </h2>
              <StatusPill label={currentRoleLabel} tone="emerald" />
              <StatusPill
                label={user.emailVerified ? "Email Verified" : "Email Unverified"}
                tone={user.emailVerified ? "emerald" : "amber"}
              />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
              <span>{user.email}</span>
              {user.jobTitle && <span>• {user.jobTitle}</span>}
              {user.phone && <span>• {user.phone}</span>}
              <span>
                • Account created{" "}
                {new Date(user.createdAt).toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </div>
          </div>
        </div>
        <Link href="/settings/business" className="rsl-btn-secondary text-xs">
          Edit Business &amp; GST Settings
        </Link>
      </div>

      {/* Main Two-Column Grid */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left: Personal Profile + Email Verification */}
        <div className="min-w-0 space-y-6 xl:col-span-7">
          <SectionCard
            title="Personal Identity & Contact Details"
            subtitle="Your name and designation appear in team inbox replies, internal notes, and activity logs"
          >
            <form onSubmit={handleProfileSubmit} className="space-y-4 text-[13px]">
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div className="min-w-0">
                  <label className="rsl-label">Full Name *</label>
                  <input
                    name="name"
                    defaultValue={user.name}
                    required
                    minLength={2}
                    placeholder="Your full name"
                    className="rsl-input"
                  />
                </div>
                <div className="min-w-0">
                  <label className="rsl-label">Job Title / Designation</label>
                  <input
                    name="jobTitle"
                    defaultValue={user.jobTitle || ""}
                    placeholder="e.g. Managing Director / Finance Head"
                    className="rsl-input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div className="min-w-0">
                  <label className="rsl-label">Work Login Email *</label>
                  <input
                    name="email"
                    type="email"
                    defaultValue={user.email}
                    required
                    className="rsl-input"
                  />
                </div>
                <div className="min-w-0">
                  <label className="rsl-label">Direct Mobile / WhatsApp Number</label>
                  <input
                    name="phone"
                    defaultValue={user.phone || ""}
                    placeholder="e.g. +91 98200 11223"
                    className="rsl-input"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSavingProfile}
                className="rsl-btn-primary inline-flex items-center gap-2"
              >
                {isSavingProfile && <IosSpinner size="xs" />}
                <span>{isSavingProfile ? "Saving Profile..." : "Save Personal Profile"}</span>
              </button>
            </form>
          </SectionCard>

          <SectionCard
            title="Work Email Verification"
            subtitle="Verified email ensures uninterrupted delivery of GST tax invoices, backup alerts, and security notices"
          >
            {user.emailVerified ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-[13px] text-emerald-950">
                <div>
                  <span className="font-semibold">{user.email}</span> is verified and active for
                  billing &amp; security notifications.
                </div>
                <StatusPill label="Verified" tone="emerald" />
              </div>
            ) : (
              <div className="space-y-3.5 text-[13px]">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/75 px-4 py-3 text-amber-950">
                  <div>
                    <div className="font-semibold">Verify {user.email}</div>
                    <div className="mt-0.5 text-xs text-amber-900/80">
                      Request a 6-digit code and enter it below to confirm ownership of your email.
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isSendingCode}
                    onClick={handleSendVerificationCode}
                    className="rsl-btn-secondary inline-flex items-center gap-1.5 text-xs"
                  >
                    {isSendingCode && <IosSpinner size="xs" />}
                    <span>{isSendingCode ? "Sending..." : "Send 6-Digit Code"}</span>
                  </button>
                </div>

                <form
                  onSubmit={handleVerifyCodeSubmit}
                  className="flex flex-wrap items-center gap-2.5"
                >
                  <input
                    name="code"
                    required
                    maxLength={6}
                    placeholder="Enter 6-digit code"
                    className="rsl-input max-w-[220px] font-mono tracking-widest"
                  />
                  <button
                    type="submit"
                    disabled={isVerifyingCode}
                    className="rsl-btn-primary inline-flex items-center gap-2"
                  >
                    {isVerifyingCode && <IosSpinner size="xs" />}
                    <span>{isVerifyingCode ? "Verifying..." : "Confirm Code"}</span>
                  </button>
                </form>
              </div>
            )}
          </SectionCard>
        </div>

        {/* Right: Password & Linked Businesses */}
        <div className="min-w-0 space-y-6 xl:col-span-5">
          <SectionCard
            title="Change Account Password"
            subtitle="Use a strong password of at least 8 characters"
          >
            <form onSubmit={handlePasswordSubmit} className="space-y-3.5 text-[13px]">
              <div>
                <label className="rsl-label">Current Password *</label>
                <input
                  name="currentPassword"
                  type="password"
                  required
                  autoComplete="current-password"
                  className="rsl-input"
                />
              </div>
              <div>
                <label className="rsl-label">New Password * (8+ characters)</label>
                <input
                  name="newPassword"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="rsl-input"
                />
              </div>
              <div>
                <label className="rsl-label">Confirm New Password *</label>
                <input
                  name="confirmPassword"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="rsl-input"
                />
              </div>
              <button
                type="submit"
                disabled={isChangingPwd}
                className="rsl-btn-primary inline-flex items-center gap-2"
              >
                {isChangingPwd && <IosSpinner size="xs" />}
                <span>{isChangingPwd ? "Updating Password..." : "Update Password"}</span>
              </button>
            </form>
          </SectionCard>

          <SectionCard
            title={`Businesses Linked to Your Login (${workspaces.length})`}
            subtitle="Switch active business workspace in 1 click"
          >
            <div className="divide-y divide-zinc-200/80 text-[13px]">
              {workspaces.map((ws) => {
                const isActive = ws.id === activeWorkspaceId;
                const isSwitching = switchingWsId === ws.id;
                return (
                  <div
                    key={ws.id}
                    className="flex flex-wrap items-center justify-between gap-2.5 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-semibold text-slate-900">{ws.name}</span>
                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold text-zinc-600 uppercase">
                          {ws.roleSlug}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
                        {ws.slug} • {ws.billingStatus === "suspended" ? "Paused" : "Active"}
                      </div>
                    </div>
                    {isActive ? (
                      <StatusPill label="Active Workspace" tone="emerald" />
                    ) : (
                      <button
                        type="button"
                        disabled={Boolean(switchingWsId)}
                        onClick={() => handleSwitchWorkspace(ws.id)}
                        className="rsl-btn-secondary inline-flex items-center gap-1.5 py-1.5 text-xs"
                      >
                        {isSwitching && <IosSpinner size="xs" />}
                        <span>Switch</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-3.5 border-t border-zinc-200/80 pt-3">
              <Link
                href="/settings/business#add-business"
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 hover:underline"
              >
                + Add Another Business Under This Login →
              </Link>
            </div>
          </SectionCard>
        </div>
      </div>

      {/* Authenticator App (RFC 6238 TOTP QR Code & Recovery Codes) */}
      <SectionCard
        title="Authenticator App (2FA QR Code & Recovery Codes)"
        subtitle="Protect your login and confidential Tally & GST actions with Google Authenticator, 1Password, Microsoft Authenticator, or Authy"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <GuideDrawerButton
              label="2FA Setup Guide"
              guide={{
                title: "How to Set Up Your Authenticator App (2FA QR Code)",
                summary: "RFC 6238 TOTP 6-digit rotating codes + 8 one-time recovery codes",
                steps: [
                  {
                    title: "Generate Your Unique Authenticator QR Code",
                    detail:
                      "Click Generate 2FA QR Code below. A cryptographic Base32 secret and scannable QR code will appear right inside this card.",
                  },
                  {
                    title: "Scan in Google Authenticator, 1Password, or Authy",
                    detail:
                      "Open your preferred authenticator app on your phone and scan the QR code, or tap Open in Authenticator App if you are on the same device.",
                  },
                  {
                    title: "Enter the 6-Digit Code & Save Recovery Codes",
                    detail:
                      "Type the current 6-digit code shown in your app and click Confirm & Activate 2FA. Save the 8 one-time recovery codes in a safe place in case you change phones.",
                  },
                ],
              }}
            />
            <StatusPill
              label={user.totpEnabled ? "2FA Active" : "Not Enrolled"}
              tone={user.totpEnabled ? "emerald" : "amber"}
            />
          </div>
        }
      >
        <div className="space-y-4 text-xs">
          {totpBackupCodes && totpBackupCodes.length > 0 && (
            <div className="space-y-2.5 rounded-xl border border-emerald-200 bg-emerald-50/75 p-4 text-emerald-950">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold">
                  Save Your 8 One-Time Recovery Backup Codes Now
                </div>
                <StatusPill label="Shown Only Once" tone="emerald" />
              </div>
              <p className="text-[11.5px] leading-relaxed text-emerald-900/90">
                Each recovery code can be used once to sign in if you lose your phone or authenticator app. Store them in your password vault.
              </p>
              <CopyCodeBlock
                code={totpBackupCodes.join("\n")}
              />
            </div>
          )}

          {totpEnrollment ? (
            <div className="space-y-4">
              <TotpQrCodeCard
                qrCodeDataUri={totpEnrollment.qrCodeDataUri}
                otpauthUri={totpEnrollment.otpauthUri}
                secret={totpEnrollment.secret}
                accountEmail={totpEnrollment.accountEmail}
                issuer={totpEnrollment.issuer}
              />

              <form
                onSubmit={handleConfirmTotpEnrollment}
                className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-3.5"
              >
                <div className="min-w-[220px] flex-1">
                  <label htmlFor="user-totp-confirm-code" className="rsl-label">
                    Enter 6-Digit Code From App to Activate *
                  </label>
                  <input
                    id="user-totp-confirm-code"
                    name="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={8}
                    required
                    value={totpConfirmCode}
                    onChange={(e) => setTotpConfirmCode(e.target.value)}
                    placeholder="123456"
                    className="rsl-input font-mono text-sm tracking-widest"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    disabled={isConfirmingTotp}
                    className="rsl-btn-primary inline-flex items-center gap-2 py-2.5 text-xs"
                  >
                    {isConfirmingTotp ? (
                      <IosSpinner size="xs" />
                    ) : (
                      <ShieldCheck className="h-4 w-4" />
                    )}
                    <span>
                      {isConfirmingTotp ? "Verifying Code..." : "Confirm & Activate 2FA"}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={isConfirmingTotp}
                    onClick={() => {
                      setTotpEnrollment(null);
                      setTotpConfirmCode("");
                    }}
                    className="rsl-btn-secondary py-2.5 text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          ) : user.totpEnabled ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-emerald-950">
                <div>
                  <div className="font-semibold">
                    Authenticator App 2FA is active on {user.email}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-emerald-900/80">
                    Remaining one-time recovery codes:{" "}
                    <span className="font-mono font-bold">
                      {user.backupCodesRemaining ?? 0}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isBeginningTotp}
                  onClick={handleBeginTotpEnrollment}
                  className="rsl-btn-secondary inline-flex items-center gap-1.5 py-2 text-xs"
                >
                  {isBeginningTotp ? (
                    <IosSpinner size="xs" />
                  ) : (
                    <QrCode className="h-3.5 w-3.5" />
                  )}
                  <span>Rotate 2FA QR Code &amp; Recovery Codes</span>
                </button>
              </div>

              <form
                onSubmit={handleDisableTotpMfa}
                className="flex flex-wrap items-end gap-2.5 rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3.5"
              >
                <div className="min-w-[220px] flex-1">
                  <label htmlFor="disable-totp-password" className="rsl-label">
                    Confirm Current Password to Disable 2FA
                  </label>
                  <input
                    id="disable-totp-password"
                    name="currentPassword"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={totpDisablePassword}
                    onChange={(e) => setTotpDisablePassword(e.target.value)}
                    placeholder="Enter your account password"
                    className="rsl-input text-xs"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isDisablingTotp}
                  className="rsl-btn-danger-soft inline-flex items-center gap-1.5 py-2 text-xs"
                >
                  {isDisablingTotp && <IosSpinner size="xs" />}
                  <span>{isDisablingTotp ? "Disabling..." : "Disable Authenticator 2FA"}</span>
                </button>
              </form>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50/60 px-4 py-3.5">
              <div className="max-w-xl space-y-1">
                <div className="font-semibold text-slate-900">
                  Add a Mobile Authenticator App (QR Code)
                </div>
                <p className="text-[11.5px] leading-relaxed text-zinc-600">
                  Generate an RFC 6238 QR code to pair Google Authenticator, 1Password, Microsoft Authenticator, or Authy. You can also use 6-digit authenticator codes for instant step-up verification when unmasking confidential party records.
                </p>
              </div>
              <button
                type="button"
                disabled={isBeginningTotp}
                onClick={handleBeginTotpEnrollment}
                className="rsl-btn-primary inline-flex items-center gap-2 py-2.5 text-xs"
              >
                {isBeginningTotp ? (
                  <IosSpinner size="xs" />
                ) : (
                  <QrCode className="h-4 w-4" />
                )}
                <span>
                  {isBeginningTotp ? "Generating QR Code..." : "Generate 2FA QR Code"}
                </span>
              </button>
            </div>
          )}
        </div>
      </SectionCard>

      {/* Biometric Passkeys & Instant Browser/Mobile Web Push */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard
          title={`Biometric Passkeys (${passkeys.length})`}
          subtitle="Sign in with 1-tap Fingerprint, Face ID, or Windows Hello - phishing-resistant W3C WebAuthn"
          action={
            <StatusPill
              label={passkeys.length > 0 ? `${passkeys.length} Enrolled` : "Recommended"}
              tone={passkeys.length > 0 ? "emerald" : "sky"}
            />
          }
        >
          <div className="space-y-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={passkeyLabel}
                onChange={(e) => setPasskeyLabel(e.target.value)}
                placeholder="Device name (e.g. Office Laptop / iPhone)"
                className="rsl-input flex-1 text-xs"
              />
              <button
                type="button"
                disabled={passkeyBusy}
                onClick={handleEnrollPasskey}
                className="rsl-btn-primary inline-flex items-center gap-1.5 py-2 text-xs"
              >
                {passkeyBusy ? (
                  <IosSpinner size="xs" />
                ) : (
                  <Fingerprint className="h-3.5 w-3.5" />
                )}
                <span>Register Passkey</span>
              </button>
            </div>

            {passkeys.length > 0 ? (
              <div className="divide-y divide-zinc-200/80 rounded-xl border border-zinc-200/80 bg-zinc-50/50 px-3">
                {passkeys.map((pk) => (
                  <div key={pk.id} className="flex items-center justify-between gap-2 py-2.5">
                    <div>
                      <div className="font-semibold text-slate-900">{pk.deviceLabel}</div>
                      <div className="text-[11px] text-zinc-500">
                        Added {new Date(pk.createdAt).toLocaleDateString("en-IN")}
                        {pk.lastUsedAt
                          ? ` • Last used ${new Date(pk.lastUsedAt).toLocaleDateString("en-IN")}`
                          : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={passkeyBusy}
                      onClick={() => handleRemovePasskey(pk.id)}
                      className="rsl-btn-danger-soft inline-flex items-center gap-1 py-1 text-[11px]"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>Remove</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11.5px] text-zinc-500">
                No passkeys registered yet. Click <strong>Register Passkey</strong> above to unlock
                instant passwordless sign-in on this device.
              </p>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title={`Instant Browser & Mobile Push Alerts (${pushSubscriptions.length})`}
          subtitle="Real-time alerts when customers reply on WhatsApp, Tally receipts arrive, or 1-2 star Google reviews post"
          action={
            <StatusPill
              label={pushSubscriptions.length > 0 ? "Push Active" : "Off on This Device"}
              tone={pushSubscriptions.length > 0 ? "emerald" : "stone"}
            />
          }
        >
          <div className="space-y-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={pushBusy}
                onClick={handleEnableWebPush}
                className="rsl-btn-primary inline-flex items-center gap-1.5 py-2 text-xs"
              >
                {pushBusy ? (
                  <IosSpinner size="xs" />
                ) : (
                  <BellRing className="h-3.5 w-3.5" />
                )}
                <span>Enable Push on This Browser</span>
              </button>
              {pushSubscriptions.length > 0 && (
                <button
                  type="button"
                  disabled={pushBusy}
                  onClick={handleTestWebPush}
                  className="rsl-btn-secondary py-2 text-xs"
                >
                  Send Test Push Alert
                </button>
              )}
            </div>

            {pushSubscriptions.length > 0 ? (
              <div className="divide-y divide-zinc-200/80 rounded-xl border border-zinc-200/80 bg-zinc-50/50 px-3">
                {pushSubscriptions.map((sub) => (
                  <div key={sub.id} className="flex items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900">{sub.deviceLabel}</div>
                      <div className="truncate font-mono text-[11px] text-zinc-500">
                        Subscribed {new Date(sub.createdAt).toLocaleDateString("en-IN")}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={pushBusy}
                      onClick={() => handleRemovePushSub(sub.id)}
                      className="rsl-btn-danger-soft inline-flex items-center gap-1 py-1 text-[11px]"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>Mute</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11.5px] text-zinc-500">
                Works free on Chrome, Edge, Firefox &amp; Android home-screen PWAs - even when the
                RSL tab is minimized.
              </p>
            )}
          </div>
        </SectionCard>
      </div>

      {/* Active Browser & Device Sessions */}
      <SectionCard
        title={`Active Browser & Device Sessions (${sessions.length})`}
        subtitle="Review every signed-in browser or device and revoke access immediately if you do not recognize a session"
        action={
          otherSessionsCount > 0 ? (
            <button
              type="button"
              disabled={isRevokingAll}
              onClick={handleRevokeOtherSessions}
              className="rsl-btn-danger-soft inline-flex items-center gap-1.5 py-1.5 text-xs"
            >
              {isRevokingAll && <IosSpinner size="xs" />}
              <span>Sign Out All Other Devices ({otherSessionsCount})</span>
            </button>
          ) : undefined
        }
      >
        <div className="divide-y divide-zinc-200/80 text-[13px]">
          {sessions.map((s) => {
            const isRevoking = pendingSessionId === s.id;
            return (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">{s.deviceLabel}</span>
                    {s.isCurrent && <StatusPill label="Current Browser" tone="emerald" />}
                    {s.impersonatorStaffId && (
                      <StatusPill label="Assisted Support Session" tone="amber" />
                    )}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500 tabular-nums">
                    IP: <span className="font-mono text-slate-700">{s.ipAddress}</span> • Signed in{" "}
                    {new Date(s.createdAt).toLocaleString("en-IN")} • Expires{" "}
                    {new Date(s.expiresAt).toLocaleDateString("en-IN")}
                  </div>
                </div>

                {s.isCurrent ? (
                  <span className="text-xs font-medium text-zinc-400">Active right now</span>
                ) : (
                  <button
                    type="button"
                    disabled={Boolean(pendingSessionId)}
                    onClick={() => handleRevokeSession(s.id)}
                    className="rsl-btn-danger-soft inline-flex items-center gap-1.5 py-1.5 text-xs"
                  >
                    {isRevoking && <IosSpinner size="xs" />}
                    <span>{isRevoking ? "Signing out..." : "Sign Out Device"}</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
