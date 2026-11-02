"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IosSpinner, SectionCard, sileo, StatusPill } from "@rsl/ui";
import {
  changePasswordJsonAction,
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
}

export function ProfileSettingsClient({
  user,
  currentRoleLabel,
  activeWorkspaceId,
  workspaces,
  sessions,
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
                {isSavingProfile && <IosSpinner size="xs" className="text-white" />}
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
                    {isVerifyingCode && <IosSpinner size="xs" className="text-white" />}
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
                {isChangingPwd && <IosSpinner size="xs" className="text-white" />}
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
