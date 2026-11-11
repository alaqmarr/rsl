"use client";

import React, { useActionState } from "react";
import {
  CopyCodeBlock,
  GuideDrawerButton,
  IosSpinner,
  PasswordInput,
  TotpQrCodeCard,
} from "@rsl/ui";
import {
  staffBeginTotpEnrollmentAction,
  staffConfirmTotpEnrollmentAction,
  staffVerifyMfaSessionAction,
  staffVerifyStepUpAction,
  type AdminMfaFormState,
} from "@/lib/actions";

const INITIAL_MFA_STATE: AdminMfaFormState = {
  error: null,
  notice: null,
  enrollmentSecret: null,
  enrollmentUri: null,
  enrollmentQrDataUri: null,
  enrollmentAccountEmail: null,
  enrollmentIssuer: null,
  backupCodes: null,
};

export function AdminTotpEnrollmentPanel({
  returnTo,
  alreadyEnrolled,
}: {
  returnTo: string;
  alreadyEnrolled: boolean;
}) {
  const [beginState, beginAction, isBeginning] = useActionState(
    staffBeginTotpEnrollmentAction,
    INITIAL_MFA_STATE
  );
  const [confirmState, confirmAction, isConfirming] = useActionState(
    staffConfirmTotpEnrollmentAction,
    INITIAL_MFA_STATE
  );

  const activeSecret = confirmState.enrollmentSecret ?? beginState.enrollmentSecret;
  const activeUri = confirmState.enrollmentUri ?? beginState.enrollmentUri;
  const activeQrDataUri = confirmState.enrollmentQrDataUri ?? beginState.enrollmentQrDataUri;
  const activeAccountEmail =
    confirmState.enrollmentAccountEmail ?? beginState.enrollmentAccountEmail;
  const activeIssuer = confirmState.enrollmentIssuer ?? beginState.enrollmentIssuer;
  const backupCodes = confirmState.backupCodes;
  const errorMsg = confirmState.error || beginState.error;

  if (backupCodes && backupCodes.length > 0) {
    return (
      <div className="space-y-4">
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-xs font-medium text-emerald-950"
        >
          {confirmState.notice}
        </div>
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="text-xs font-bold text-slate-900">
            One-Time Recovery Codes (Store Offline Now)
          </div>
          <p className="mt-1 text-xs text-zinc-600">
            Each code can be used once if you lose access to your authenticator device.
          </p>
          <div className="mt-3">
            <CopyCodeBlock code={backupCodes.join("\n")} language="text" />
          </div>
        </div>
        <a
          href={returnTo}
          className="adm-btn-primary inline-flex min-h-11 w-full items-center justify-center py-2.5 text-sm"
        >
          Continue to Staff Operations Console →
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {errorMsg ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50/90 px-3.5 py-2.5 text-xs font-medium text-rose-900"
        >
          {errorMsg}
        </div>
      ) : null}

      {!activeSecret ? (
        <form action={beginAction} className="space-y-3">
          <p className="text-xs leading-relaxed text-zinc-600">
            {alreadyEnrolled
              ? "Rotate your authenticator key to pair a new device and issue a fresh set of 8 recovery codes."
              : "Pair Google Authenticator, 1Password, Authy, or Apple Passwords using a standard RFC 6238 TOTP key."}
          </p>
          <button
            type="submit"
            disabled={isBeginning}
            className="adm-btn-primary min-h-11 w-full py-2.5 text-sm"
          >
            {isBeginning ? (
              <span className="inline-flex items-center gap-2">
                <IosSpinner size="xs" />
                <span>Generating Authenticator QR Code...</span>
              </span>
            ) : alreadyEnrolled ? (
              "Rotate Authenticator QR Code & Key"
            ) : (
              "Generate Authenticator QR Code & Setup Key"
            )}
          </button>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-800">
              Scan Authenticator QR Code or Copy Setup Key
            </span>
            <GuideDrawerButton
              drawerId="admin-mfa-totp-guide"
              label="Need help? • Authenticator Setup"
              guide={{
                eyebrow: "Staff Security • RFC 6238 TOTP",
                title: "Pairing Google Authenticator, 1Password, Authy, or Apple Passwords",
                summary:
                  "All Staff Portal sessions and privileged 15-minute step-up actions are protected by two-factor authentication.",
                copyValues: activeUri
                  ? [
                      { label: "Base32 Setup Key", value: activeSecret },
                      { label: "Full otpauth:// URI", value: activeUri },
                    ]
                  : [{ label: "Base32 Setup Key", value: activeSecret }],
                steps: [
                  {
                    title: "Scan the QR Code in your Authenticator app",
                    detail:
                      "Open Google Authenticator, 1Password, Authy, Microsoft Authenticator, or Apple Passwords, tap '+' -> 'Scan a QR code', and point your camera at the QR code.",
                  },
                  {
                    title: "Or enter the Base32 Secret Key manually",
                    detail:
                      "If you are on the same device without a camera, click 'Open in Authenticator App' or copy the Base32 Setup Key (Time-based, 6 digits, 30-second interval).",
                  },
                  {
                    title: "Confirm with a live 6-digit code & save recovery codes",
                    detail:
                      "Enter the 6-digit code currently displayed in your app. Next, copy and store your 8 one-time recovery codes offline.",
                  },
                ],
              }}
            />
          </div>

          {activeQrDataUri && activeUri ? (
            <TotpQrCodeCard
              secret={activeSecret}
              otpauthUri={activeUri}
              qrCodeDataUri={activeQrDataUri}
              accountEmail={activeAccountEmail}
              issuer={activeIssuer || "RapidShift Labs Staff"}
            />
          ) : (
            <CopyCodeBlock code={activeSecret} language="text" />
          )}

          <form action={confirmAction} className="space-y-3 text-xs">
            <div>
              <label
                htmlFor="totp-enroll-confirm-code"
                className="mb-1.5 block font-semibold text-slate-800"
              >
                6-Digit Verification Code
              </label>
              <input
                id="totp-enroll-confirm-code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                minLength={6}
                maxLength={12}
                placeholder="123456"
                className="adm-input min-h-11 font-mono text-sm tracking-widest"
              />
            </div>
            <button
              type="submit"
              disabled={isConfirming}
              className="adm-btn-primary min-h-11 w-full py-2.5 text-sm"
            >
              {isConfirming ? (
                <span className="inline-flex items-center gap-2">
                  <IosSpinner size="xs" />
                  <span>Verifying Code...</span>
                </span>
              ) : (
                "Verify & Enable Staff MFA"
              )}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export function AdminMfaChallengeForm({ returnTo }: { returnTo: string }) {
  const [state, formAction, isPending] = useActionState(
    staffVerifyMfaSessionAction,
    INITIAL_MFA_STATE
  );

  return (
    <form action={formAction} className="space-y-4 text-xs">
      <input type="hidden" name="returnTo" value={returnTo} />
      {state.error ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50/90 px-3.5 py-2.5 text-xs font-medium text-rose-900"
        >
          {state.error}
        </div>
      ) : null}

      <div>
        <label htmlFor="staff-mfa-code" className="mb-1.5 block font-semibold text-slate-800">
          6-Digit Authenticator or Recovery Code
        </label>
        <input
          id="staff-mfa-code"
          name="code"
          type="text"
          autoComplete="one-time-code"
          required
          placeholder="123456 or ABCD-EFGH"
          className="adm-input min-h-11 font-mono text-sm tracking-widest"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="adm-btn-primary min-h-11 w-full py-2.5 text-sm"
      >
        {isPending ? (
          <span className="inline-flex items-center gap-2">
            <IosSpinner size="xs" />
            <span>Verifying MFA...</span>
          </span>
        ) : (
          "Verify & Unlock Console"
        )}
      </button>
    </form>
  );
}

export function AdminStepUpForm({
  returnTo,
  totpEnabled,
}: {
  returnTo: string;
  totpEnabled: boolean;
}) {
  const [state, formAction, isPending] = useActionState(
    staffVerifyStepUpAction,
    INITIAL_MFA_STATE
  );

  return (
    <form action={formAction} className="space-y-4 text-xs">
      <input type="hidden" name="returnTo" value={returnTo} />
      {state.error ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50/90 px-3.5 py-2.5 text-xs font-medium text-rose-900"
        >
          {state.error}
        </div>
      ) : null}

      {totpEnabled ? (
        <div>
          <label htmlFor="staff-stepup-code" className="mb-1.5 block font-semibold text-slate-800">
            6-Digit Authenticator or Recovery Code
          </label>
          <input
            id="staff-stepup-code"
            name="code"
            type="text"
            autoComplete="one-time-code"
            required
            placeholder="123456"
            className="adm-input min-h-11 font-mono text-sm tracking-widest"
          />
        </div>
      ) : (
        <div>
          <label
            htmlFor="staff-stepup-password"
            className="mb-1.5 block font-semibold text-slate-800"
          >
            Confirm Staff Password (or enroll TOTP below)
          </label>
          <PasswordInput
            id="staff-stepup-password"
            name="password"
            required
            autoComplete="current-password"
            placeholder="Enter current staff password"
            className="adm-input min-h-11"
          />
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="adm-btn-primary min-h-11 w-full py-2.5 text-sm"
      >
        {isPending ? (
          <span className="inline-flex items-center gap-2">
            <IosSpinner size="xs" />
            <span>Authorizing Step-Up...</span>
          </span>
        ) : (
          "Confirm Step-Up (Valid 15 Minutes)"
        )}
      </button>
    </form>
  );
}
