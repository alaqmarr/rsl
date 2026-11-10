"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  lockConfidentialityMaskJsonAction,
  purgeConfidentialDataNowJsonAction,
  requestUnmaskOtpJsonAction,
  saveConfidentialityPolicyJsonAction,
  verifyUnmaskOtpJsonAction,
} from "@/lib/actions";

export interface ConfidentialityPolicyClientProps {
  saveBillsAndDetails: boolean;
  autoDeleteRetentionHours: number | null;
  maskCompanyAndContactDetails: boolean;
  allowApiUnmaskedAccessOnly: boolean;
  requireOtpToUnmask: boolean;
  lastRetentionSweepAt?: number | null;
  lastPurgedVouchersCount?: number;
  lastPurgedPartiesCount?: number;
}

const PRESET_HOURS = [0, 1, 6, 24, 72, 168, 720, 2160];

function Card({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={`rsl-frost-card rounded-2xl ${className}`}>{children}</div>;
}

function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "success" | "warning" | "danger" | "info" | "neutral";
  children: React.ReactNode;
}) {
  const pillClass =
    tone === "success" || tone === "info"
      ? "rsl-pill rsl-pill-forest"
      : tone === "warning" || tone === "danger"
        ? "rsl-pill rsl-pill-sunset"
        : "rsl-pill rsl-pill-cream";
  return <span className={pillClass}>{children}</span>;
}

function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
}) {
  const baseClass =
    variant === "danger"
      ? "rsl-btn-danger-soft"
      : variant === "secondary" || variant === "ghost"
        ? "rsl-btn-secondary"
        : "rsl-btn-primary";
  const sizeClass = size === "sm" ? "py-1.5 text-xs" : "";
  return (
    <button className={`${baseClass} ${sizeClass} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function ConfidentialityOtpBar({
  isMasked,
  unmaskActive,
  unmaskExpiresAt,
  policy,
}: {
  isMasked: boolean;
  unmaskActive: boolean;
  unmaskExpiresAt: number | null;
  policy: ConfidentialityPolicyClientProps;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [otpRequested, setOtpRequested] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [devPreviewOtp, setDevPreviewOtp] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const protectionEnabled =
    policy.maskCompanyAndContactDetails ||
    policy.allowApiUnmaskedAccessOnly ||
    !policy.saveBillsAndDetails ||
    policy.autoDeleteRetentionHours !== null;

  if (!protectionEnabled && !isMasked && !unmaskActive) {
    return null;
  }

  function handleRequestOtp() {
    setFeedback(null);
    startTransition(async () => {
      const res = await requestUnmaskOtpJsonAction();
      setFeedback({ ok: res.ok, text: res.message });
      if (res.ok) {
        setOtpRequested(true);
        setMaskedEmail(res.maskedDestination ?? null);
        if (res.devOtpCode) {
          setDevPreviewOtp(res.devOtpCode);
        }
      }
    });
  }

  function handleVerifyOtp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFeedback(null);
    const fd = new FormData();
    fd.set("otpCode", otpCode);
    startTransition(async () => {
      const res = await verifyUnmaskOtpJsonAction(fd);
      setFeedback({ ok: res.ok, text: res.message });
      if (res.ok) {
        setOtpRequested(false);
        setOtpCode("");
        setDevPreviewOtp(null);
        router.refresh();
      }
    });
  }

  function handleLockNow() {
    setFeedback(null);
    startTransition(async () => {
      const res = await lockConfidentialityMaskJsonAction();
      setFeedback({ ok: res.ok, text: res.message });
      if (res.ok) {
        router.refresh();
      }
    });
  }

  return (
    <Card className="p-4 border border-[var(--border)] bg-[var(--surface-muted)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={isMasked ? "warning" : unmaskActive ? "success" : "info"}>
              {isMasked
                ? "Buyer & Supplier Names Masked"
                : unmaskActive
                  ? "Unlocked via OTP (15m Window)"
                  : !policy.saveBillsAndDetails
                    ? "Zero-Persistence Ephemeral Mode"
                    : "Auto-Delete Retention Active"}
            </Badge>
            {policy.allowApiUnmaskedAccessOnly && (
              <Badge tone="info">API-Only Cleartext Mode</Badge>
            )}
            {policy.autoDeleteRetentionHours !== null && (
              <Badge tone="neutral">
                {policy.autoDeleteRetentionHours === 0
                  ? "Auto-Delete: Immediate after send"
                  : `Auto-Delete: Every ${policy.autoDeleteRetentionHours}h`}
              </Badge>
            )}
          </div>
          <p className="text-xs text-[var(--text-secondary)]">
            {isMasked
              ? "Company names, GSTINs, and phone numbers are masked in the portal to protect your customer and supplier list from unauthorized viewing."
              : unmaskActive && unmaskExpiresAt
                ? `Company and contact details are temporarily visible until ${new Date(unmaskExpiresAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}.`
                : !policy.saveBillsAndDetails
                  ? "Bills and party details are used only in-flight for WhatsApp dispatch and are not retained in storage."
                  : "Confidentiality and automatic data retention rules are active for this workspace."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isMasked && !otpRequested && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={isPending}
              onClick={handleRequestOtp}
            >
              {isPending ? "Sending OTP..." : "Unlock with 6-Digit OTP"}
            </Button>
          )}
          {unmaskActive && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={isPending}
              onClick={handleLockNow}
            >
              {isPending ? "Locking..." : "Lock & Mask Names Now"}
            </Button>
          )}
        </div>
      </div>

      {isMasked && otpRequested && (
        <form
          onSubmit={handleVerifyOtp}
          className="mt-3 pt-3 border-t border-[var(--border)] flex flex-wrap items-center gap-2"
        >
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={otpCode}
            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="Enter 6-digit OTP"
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-mono tracking-widest text-[var(--text-primary)] w-44"
            required
          />
          <Button type="submit" size="sm" disabled={isPending || otpCode.length !== 6}>
            {isPending ? "Verifying..." : "Verify OTP & Reveal (15m)"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={handleRequestOtp}
          >
            Resend OTP
          </Button>
          {maskedEmail && (
            <span className="text-xs text-[var(--text-muted)]">
              Sent to {maskedEmail}
              {devPreviewOtp ? ` (Local test code: ${devPreviewOtp})` : ""}
            </span>
          )}
        </form>
      )}

      {feedback && (
        <div
          className={`mt-2 rounded-lg border px-3 py-2 text-xs font-medium ${
            feedback.ok
              ? "border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-fg)]"
              : "border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]"
          }`}
        >
          {feedback.text}
        </div>
      )}
    </Card>
  );
}

export function ConfidentialityVaultCard({
  initialPolicy,
  isMasked,
  unmaskActive,
  unmaskExpiresAt,
  canManageSettings = true,
}: {
  initialPolicy: ConfidentialityPolicyClientProps;
  isMasked: boolean;
  unmaskActive: boolean;
  unmaskExpiresAt: number | null;
  canManageSettings?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saveBillsAndDetails, setSaveBillsAndDetails] = useState(
    initialPolicy.saveBillsAndDetails
  );
  const isPresetHour =
    initialPolicy.autoDeleteRetentionHours === null ||
    PRESET_HOURS.includes(initialPolicy.autoDeleteRetentionHours);

  const [retentionChoice, setRetentionChoice] = useState<string>(
    initialPolicy.autoDeleteRetentionHours === null
      ? "manual"
      : isPresetHour
        ? String(initialPolicy.autoDeleteRetentionHours)
        : "custom"
  );
  const [customRetentionHours, setCustomRetentionHours] = useState<string>(
    initialPolicy.autoDeleteRetentionHours !== null && !isPresetHour
      ? String(initialPolicy.autoDeleteRetentionHours)
      : "48"
  );
  const [maskCompanyAndContactDetails, setMaskCompanyAndContactDetails] = useState(
    initialPolicy.maskCompanyAndContactDetails
  );
  const [allowApiUnmaskedAccessOnly, setAllowApiUnmaskedAccessOnly] = useState(
    initialPolicy.allowApiUnmaskedAccessOnly
  );
  const [requireOtpToUnmask, setRequireOtpToUnmask] = useState(
    initialPolicy.requireOtpToUnmask
  );
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  function handleSavePolicy(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFeedback(null);
    const fd = new FormData();
    fd.set("saveBillsAndDetails", saveBillsAndDetails ? "true" : "false");
    fd.set("autoDeleteRetentionHours", retentionChoice);
    fd.set("customRetentionHours", customRetentionHours);
    fd.set(
      "maskCompanyAndContactDetails",
      maskCompanyAndContactDetails || allowApiUnmaskedAccessOnly ? "true" : "false"
    );
    fd.set("allowApiUnmaskedAccessOnly", allowApiUnmaskedAccessOnly ? "true" : "false");
    fd.set("requireOtpToUnmask", requireOtpToUnmask ? "true" : "false");

    startTransition(async () => {
      const res = await saveConfidentialityPolicyJsonAction(fd);
      setFeedback({ ok: res.ok, text: res.message });
      if (res.ok) {
        router.refresh();
      }
    });
  }

  function handlePurgeNow() {
    setFeedback(null);
    startTransition(async () => {
      const res = await purgeConfidentialDataNowJsonAction();
      setFeedback({ ok: res.ok, text: res.message });
      if (res.ok) {
        router.refresh();
      }
    });
  }

  return (
    <Card className="p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              Buyer & Supplier Confidentiality, Masking & Data Retention
            </h2>
            <Badge
              tone={
                !saveBillsAndDetails ||
                maskCompanyAndContactDetails ||
                allowApiUnmaskedAccessOnly
                  ? "success"
                  : "info"
              }
            >
              {!saveBillsAndDetails
                ? "Zero-Persistence Mode"
                : allowApiUnmaskedAccessOnly
                  ? "API-Only Cleartext"
                  : maskCompanyAndContactDetails
                    ? "Portal Names Masked"
                    : "Standard Storage"}
            </Badge>
          </div>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Protect confidential buyer, supplier, and contact lists from competitors or shared-screen exposure. Control whether bills are saved, set a custom automatic deletion timer, mask company names in the portal, or restrict cleartext data to API keys and OTP verification.
          </p>
        </div>
      </div>

      <ConfidentialityOtpBar
        isMasked={isMasked}
        unmaskActive={unmaskActive}
        unmaskExpiresAt={unmaskExpiresAt}
        policy={{
          saveBillsAndDetails,
          autoDeleteRetentionHours:
            retentionChoice === "manual"
              ? null
              : retentionChoice === "custom"
                ? Number(customRetentionHours) || 24
                : Number(retentionChoice),
          maskCompanyAndContactDetails,
          allowApiUnmaskedAccessOnly,
          requireOtpToUnmask,
        }}
      />

      <form onSubmit={handleSavePolicy} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 cursor-pointer">
            <input
              type="checkbox"
              checked={saveBillsAndDetails}
              disabled={!canManageSettings || isPending}
              onChange={(e) => setSaveBillsAndDetails(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-[var(--border)]"
            />
            <div className="space-y-1">
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                Save Bills & Party Details in Workspace
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                Uncheck this to run in Zero-Persistence Ephemeral Mode. Outbound WhatsApp invoice alerts still send immediately, and bill/company details are purged right after dispatch so zero customer or supplier records stay stored.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 cursor-pointer">
            <input
              type="checkbox"
              checked={maskCompanyAndContactDetails || allowApiUnmaskedAccessOnly}
              disabled={!canManageSettings || isPending}
              onChange={(e) => setMaskCompanyAndContactDetails(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-[var(--border)]"
            />
            <div className="space-y-1">
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                Mask Buyer, Supplier & Contact Names When Saved
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                Replaces company names (e.g. Sh••• Ga•••• Tr•••••), GSTINs, PANs, phones, and emails across the web portal so no supplier or visitor can see who you supply to or buy from.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 cursor-pointer">
            <input
              type="checkbox"
              checked={allowApiUnmaskedAccessOnly}
              disabled={!canManageSettings || isPending}
              onChange={(e) => {
                setAllowApiUnmaskedAccessOnly(e.target.checked);
                if (e.target.checked) {
                  setMaskCompanyAndContactDetails(true);
                }
              }}
              className="mt-1 h-4 w-4 rounded border-[var(--border)]"
            />
            <div className="space-y-1">
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                Allow Only REST API to Access Unmasked Company Data
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                Keeps the web portal masked at all times while allowing authenticated server-to-server REST API calls (/api/v1/vouchers and /api/v1/contacts with Bearer API keys) to read full cleartext records.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 cursor-pointer">
            <input
              type="checkbox"
              checked={requireOtpToUnmask}
              disabled={!canManageSettings || isPending}
              onChange={(e) => setRequireOtpToUnmask(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-[var(--border)]"
            />
            <div className="space-y-1">
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                Require 6-Digit Email OTP to Reveal Masked Names in Portal
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                Allows the business owner or authorized accountant to temporarily unmask company names and phone numbers for 15 minutes after verifying a 6-digit OTP code.
              </p>
            </div>
          </label>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <label
                htmlFor="auto-delete-retention-select"
                className="block text-sm font-semibold text-[var(--text-primary)]"
              >
                Automatic Data Deletion Timer (Custom Retention Window)
              </label>
              <p className="text-xs text-[var(--text-secondary)]">
                Choose when saved bills, PDFs, party ledgers, and synced contacts are automatically deleted from your workspace database.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-center">
            <select
              id="auto-delete-retention-select"
              value={retentionChoice}
              disabled={!canManageSettings || isPending}
              onChange={(e) => setRetentionChoice(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              <option value="manual">Keep saved data until manual deletion</option>
              <option value="0">Delete immediately after WhatsApp dispatch (0 hours)</option>
              <option value="1">Delete automatically after 1 hour</option>
              <option value="6">Delete automatically after 6 hours</option>
              <option value="24">Delete automatically after 24 hours (1 day)</option>
              <option value="72">Delete automatically after 3 days (72 hours)</option>
              <option value="168">Delete automatically after 7 days (168 hours)</option>
              <option value="720">Delete automatically after 30 days (720 hours)</option>
              <option value="2160">Delete automatically after 90 days (2,160 hours)</option>
              <option value="custom">Custom deletion window (enter hours)</option>
            </select>

            {retentionChoice === "custom" && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={8760}
                  value={customRetentionHours}
                  disabled={!canManageSettings || isPending}
                  onChange={(e) => setCustomRetentionHours(e.target.value)}
                  className="w-36 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  placeholder="Hours (1-8760)"
                />
                <span className="text-xs text-[var(--text-secondary)]">
                  hours ({Math.max(1, Math.round((Number(customRetentionHours) || 24) / 24 * 10) / 10)} days)
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={!canManageSettings || isPending}>
              {isPending ? "Saving Policy..." : "Save Confidentiality & Retention Policy"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={!canManageSettings || isPending}
              onClick={handlePurgeNow}
            >
              Purge Saved Bills & Party Data Now
            </Button>
          </div>
          {initialPolicy.lastRetentionSweepAt ? (
            <span className="text-xs text-[var(--text-muted)]">
              Last retention sweep:{" "}
              {new Date(initialPolicy.lastRetentionSweepAt).toLocaleString("en-IN")} (
              {initialPolicy.lastPurgedVouchersCount ?? 0} bills,{" "}
              {initialPolicy.lastPurgedPartiesCount ?? 0} parties purged)
            </span>
          ) : null}
        </div>
      </form>

      {feedback && (
        <div
          className={`rounded-lg border px-3 py-2 text-xs font-medium ${
            feedback.ok
              ? "border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-fg)]"
              : "border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]"
          }`}
        >
          {feedback.text}
        </div>
      )}
    </Card>
  );
}
