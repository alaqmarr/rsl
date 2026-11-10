"use client";

import React, { useActionState, useEffect, useState } from "react";
import { IosSpinner, PasswordInput, sileo, TurnstileWidget } from "@rsl/ui";
import {
  completeSetupFormStateAction,
  staffLoginFormStateAction,
  type AdminAuthFormState,
} from "@/lib/actions";

const INITIAL_ADMIN_AUTH_STATE: AdminAuthFormState = {
  error: null,
  fields: {},
};

export function AdminLoginForm({ turnstileSiteKey }: { turnstileSiteKey?: string | null }) {
  const [state, formAction, isPending] = useActionState(
    staffLoginFormStateAction,
    INITIAL_ADMIN_AUTH_STATE
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (state.error) {
      sileo.error({
        title: "Staff sign-in failed",
        description: state.error,
        duration: 4800,
      });
    }
  }, [state]);

  return (
    <form action={formAction} className="mt-5 space-y-4 text-xs">
      {state.error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50/90 px-3.5 py-2.5 text-xs font-medium text-rose-900"
        >
          {state.error}
        </div>
      )}

      <div>
        <label htmlFor="staff-login-email" className="mb-1.5 block font-semibold text-zinc-700">
          Work Email
        </label>
        <input
          id="staff-login-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="app@rapidshiftlabs.in"
          className="adm-input min-h-10"
        />
      </div>
      <div>
        <label htmlFor="staff-login-password" className="mb-1.5 block font-semibold text-zinc-700">
          Password
        </label>
        <PasswordInput
          id="staff-login-password"
          name="password"
          required
          minLength={8}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter staff password"
          className="adm-input min-h-10"
        />
      </div>
      <TurnstileWidget siteKey={turnstileSiteKey} />
      <button
        type="submit"
        disabled={isPending}
        className="adm-btn-primary min-h-11 w-full py-2.5 text-sm"
      >
        {isPending ? (
          <span className="inline-flex items-center justify-center gap-2">
            <IosSpinner size="xs" className="text-white" />
            <span>Signing in...</span>
          </span>
        ) : (
          "Sign In"
        )}
      </button>
    </form>
  );
}

export function AdminSetupForm({
  requiresSetupKey,
  prefilledKey,
}: {
  requiresSetupKey: boolean;
  prefilledKey: string;
}) {
  const [state, formAction, isPending] = useActionState(
    completeSetupFormStateAction,
    INITIAL_ADMIN_AUTH_STATE
  );
  const [setupKey, setSetupKey] = useState(prefilledKey);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword;

  useEffect(() => {
    // Scrub ?key= from browser address bar & history immediately after reading into state
    if (typeof window !== "undefined" && window.location.search.includes("key=")) {
      const sp = new URLSearchParams(window.location.search);
      if (sp.has("key")) {
        sp.delete("key");
        const qs = sp.toString();
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`
        );
      }
    }
  }, []);

  useEffect(() => {
    if (state.error) {
      sileo.error({
        title: "Setup verification failed",
        description: state.error,
        duration: 5400,
      });
    }
  }, [state]);

  return (
    <form action={formAction} className="mt-6 space-y-4 text-xs">
      {state.error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50/90 px-3.5 py-2.5 text-xs font-medium text-rose-900"
        >
          {state.error}
        </div>
      )}

      {requiresSetupKey ? (
        <div>
          <label htmlFor="setup-bootstrap-key" className="mb-1.5 block font-semibold text-zinc-700">
            One-Time Server Setup Key
          </label>
          <PasswordInput
            id="setup-bootstrap-key"
            name="setupKey"
            required
            value={setupKey}
            onChange={(e) => setSetupKey(e.target.value)}
            placeholder="Paste SETUP_BOOTSTRAP_TOKEN from server terminal / .env"
            className="adm-input min-h-10 font-mono text-xs"
          />
          {prefilledKey && (
            <p className="mt-1 text-xs font-medium text-emerald-700">
              Setup key pre-filled and scrubbed from your browser address bar.
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-xs text-zinc-600">
          Local development mode detected (<code className="font-mono">SETUP_BOOTSTRAP_TOKEN</code>{" "}
          not set). In production, <code className="font-mono">setup.sh</code> enforces a
          cryptographic one-time setup key automatically.
        </div>
      )}

      <div>
        <label htmlFor="setup-admin-name" className="mb-1.5 block font-semibold text-zinc-700">
          Full Name
        </label>
        <input
          id="setup-admin-name"
          name="name"
          required
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Platform Owner"
          className="adm-input min-h-10"
        />
      </div>

      <div>
        <label htmlFor="setup-admin-email" className="mb-1.5 block font-semibold text-zinc-700">
          Super Admin Email
        </label>
        <input
          id="setup-admin-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="founder@rapidshiftlabs.in"
          className="adm-input min-h-10"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label
            htmlFor="setup-admin-password"
            className="mb-1.5 block font-semibold text-zinc-700"
          >
            Password
          </label>
          <PasswordInput
            id="setup-admin-password"
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
            showStrengthMeter
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min 8 characters"
            className="adm-input min-h-10"
          />
        </div>
        <div>
          <label
            htmlFor="setup-admin-confirm-password"
            className="mb-1.5 block font-semibold text-zinc-700"
          >
            Confirm Password
          </label>
          <PasswordInput
            id="setup-admin-confirm-password"
            name="confirmPassword"
            required
            minLength={8}
            autoComplete="new-password"
            aria-invalid={passwordsMismatch}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter password"
            className="adm-input min-h-10"
          />
          {passwordsMismatch ? (
            <p role="alert" className="mt-1 text-xs font-medium text-rose-700">
              Passwords do not match yet.
            </p>
          ) : null}
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending || passwordsMismatch}
        className="adm-btn-primary min-h-11 w-full py-2.5 text-sm"
      >
        {isPending ? (
          <span className="inline-flex items-center justify-center gap-2">
            <IosSpinner size="xs" className="text-white" />
            <span>Initializing Platform &amp; Locking Setup...</span>
          </span>
        ) : (
          "Initialize Super Admin & Lock Bootstrap"
        )}
      </button>
    </form>
  );
}
