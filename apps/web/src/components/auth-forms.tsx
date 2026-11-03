"use client";

import React, { useActionState, useEffect, useState } from "react";
import { IosSpinner, PasswordInput, sileo } from "@rsl/ui";
import { ActionLink } from "@/components/ios-feedback";
import {
  loginFormStateAction,
  registerFormStateAction,
  type WebAuthFormState,
} from "@/lib/actions";

const INITIAL_AUTH_STATE: WebAuthFormState = {
  error: null,
  fields: {},
};

export function WebLoginForm() {
  const [state, formAction, isPending] = useActionState(loginFormStateAction, INITIAL_AUTH_STATE);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (state.error) {
      sileo.error({
        title: "Sign in failed",
        description: state.error,
        duration: 4800,
      });
    }
  }, [state]);

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-2xl border border-zinc-200/90 bg-white p-7 shadow-[0_8px_30px_rgba(15,23,42,0.05)]"
    >
      {state.error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50/90 px-3.5 py-2.5 text-xs font-medium text-rose-900"
        >
          {state.error}
        </div>
      )}

      <div>
        <label htmlFor="login-email" className="mb-1.5 block text-xs font-semibold text-zinc-700">
          Work Email
        </label>
        <input
          id="login-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.in"
          className="rsl-input min-h-10"
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label htmlFor="login-password" className="text-xs font-semibold text-zinc-700">
            Password
          </label>
          <ActionLink
            href="/forgot-password"
            spinnerSize="xs"
            className="text-xs font-semibold text-emerald-700 hover:underline"
          >
            Forgot password?
          </ActionLink>
        </div>
        <PasswordInput
          id="login-password"
          name="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your password"
          className="rsl-input min-h-10"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="rsl-btn-primary min-h-11 w-full py-2.5 text-sm"
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

export function WebRegisterForm({
  indianStates,
}: {
  indianStates: Array<{ code: string; label: string }>;
}) {
  const [state, formAction, isPending] = useActionState(
    registerFormStateAction,
    INITIAL_AUTH_STATE
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState("");
  const [stateCode, setStateCode] = useState("27");
  const [gstin, setGstin] = useState("");

  useEffect(() => {
    if (state.error) {
      sileo.error({
        title: "Check your details",
        description: state.error,
        duration: 5200,
      });
    }
  }, [state]);

  return (
    <form action={formAction} className="mt-4 space-y-4">
      {state.error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50/90 px-3.5 py-2.5 text-xs font-medium text-rose-900"
        >
          {state.error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="reg-name" className="mb-1 block text-xs font-semibold text-zinc-700">
            Your Full Name
          </label>
          <input
            id="reg-name"
            name="name"
            type="text"
            required
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Aarav Sharma"
            className="rsl-input min-h-10"
          />
        </div>
        <div>
          <label htmlFor="reg-email" className="mb-1 block text-xs font-semibold text-zinc-700">
            Work Email
          </label>
          <input
            id="reg-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="owner@company.in"
            className="rsl-input min-h-10"
          />
        </div>
      </div>

      <div>
        <label htmlFor="reg-password" className="mb-1 block text-xs font-semibold text-zinc-700">
          Password (minimum 8 characters)
        </label>
        <PasswordInput
          id="reg-password"
          name="password"
          minLength={8}
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          className="rsl-input min-h-10"
        />
      </div>

      <div className="border-t border-zinc-200/80 pt-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="reg-business-name"
              className="mb-1 block text-xs font-semibold text-zinc-700"
            >
              Business / Firm Name
            </label>
            <input
              id="reg-business-name"
              name="businessName"
              type="text"
              required
              autoComplete="organization"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Shree Traders Pvt Ltd"
              className="rsl-input min-h-10"
            />
          </div>
          <div>
            <label
              htmlFor="reg-industry"
              className="mb-1 block text-xs font-semibold text-zinc-700"
            >
              Industry (Optional)
            </label>
            <input
              id="reg-industry"
              name="industry"
              type="text"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="Wholesale, Retail, Manufacturing..."
              className="rsl-input min-h-10"
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="reg-state-code"
              className="mb-1 block text-xs font-semibold text-zinc-700"
            >
              Billing State (for GST)
            </label>
            <select
              id="reg-state-code"
              name="stateCode"
              value={stateCode}
              onChange={(e) => setStateCode(e.target.value)}
              className="rsl-input min-h-10"
            >
              {indianStates.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="reg-gstin" className="mb-1 block text-xs font-semibold text-zinc-700">
              GSTIN (Optional)
            </label>
            <input
              id="reg-gstin"
              name="gstin"
              type="text"
              maxLength={15}
              value={gstin}
              onChange={(e) => {
                const upper = e.target.value.toUpperCase();
                setGstin(upper);
                if (/^[0-9]{2}/.test(upper)) {
                  const prefix = upper.slice(0, 2);
                  if (indianStates.some((s) => s.code === prefix)) {
                    setStateCode(prefix);
                  }
                }
              }}
              placeholder="27AABCU9603R1ZM"
              className="rsl-input min-h-10 font-mono uppercase"
            />
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="rsl-btn-primary min-h-11 w-full py-2.5 text-sm"
      >
        {isPending ? (
          <span className="inline-flex items-center justify-center gap-2">
            <IosSpinner size="xs" className="text-white" />
            <span>Creating Account &amp; Starting 7-Day Trial...</span>
          </span>
        ) : (
          "Start 7-Day Free Trial — No Card Needed"
        )}
      </button>
    </form>
  );
}
