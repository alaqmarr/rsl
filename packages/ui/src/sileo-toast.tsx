"use client";

import React, { useEffect, useRef, useState } from "react";
import { sileo, Toaster, type SileoOptions } from "sileo";

export { sileo };

export const RSL_SILEO_TOAST_OPTIONS: Partial<SileoOptions> = {
  fill: "var(--sileo-fill)",
  roundness: 16,
  styles: {
    title: "rsl-sileo-title",
    description: "rsl-sileo-description",
    badge: "rsl-sileo-badge",
    button: "rsl-sileo-button",
  },
};

export interface FlashToastPayload {
  id: string;
  type: "success" | "error" | "info" | "warning";
  message: string;
}

function splitToastMessage(
  raw: string,
  fallbackTitle: string
): { title: string; description?: string } {
  const clean = raw.trim();
  if (!clean) return { title: fallbackTitle };

  const dashIdx = clean.indexOf(" - ");
  if (dashIdx > 3 && dashIdx <= 48) {
    return {
      title: clean.slice(0, dashIdx).trim(),
      description: clean.slice(dashIdx + 3).trim() || undefined,
    };
  }

  const periodIdx = clean.indexOf(". ");
  if (periodIdx > 6 && periodIdx <= 52) {
    return {
      title: clean.slice(0, periodIdx + 1).trim(),
      description: clean.slice(periodIdx + 2).trim() || undefined,
    };
  }

  if (clean.length <= 52) {
    return { title: clean };
  }

  return {
    title: fallbackTitle,
    description: clean,
  };
}

export function triggerSileoToast(
  type: "success" | "error" | "info" | "warning",
  message: string
): void {
  if (!message?.trim()) return;
  if (type === "error") {
    const parts = splitToastMessage(message, "Could not complete action");
    sileo.error({
      ...RSL_SILEO_TOAST_OPTIONS,
      title: parts.title,
      description: parts.description,
      duration: 5500,
    });
    return;
  }
  if (type === "warning") {
    const parts = splitToastMessage(message, "Please check");
    sileo.warning({
      ...RSL_SILEO_TOAST_OPTIONS,
      title: parts.title,
      description: parts.description,
      duration: 5000,
    });
    return;
  }
  if (type === "info") {
    const parts = splitToastMessage(message, "Update");
    sileo.info({
      ...RSL_SILEO_TOAST_OPTIONS,
      title: parts.title,
      description: parts.description,
      duration: 4200,
    });
    return;
  }
  const parts = splitToastMessage(message, "Saved");
  sileo.success({
    ...RSL_SILEO_TOAST_OPTIONS,
    title: parts.title,
    description: parts.description,
    duration: 4200,
  });
}

function readCookieValue(name: string): string | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie;
  if (!raw || !raw.includes(`${name}=`)) return null;
  const parts = raw.split("; ");
  for (const part of parts) {
    if (part.startsWith(`${name}=`)) {
      return part.slice(name.length + 1);
    }
  }
  return null;
}

function clearBrowserCookie(name: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function SileoToastProvider({
  cookieName = "rsl_toast",
  verifiedToast = null,
  verifyEndpoint = "/api/flash-toast",
}: {
  cookieName?: string;
  verifiedToast?: FlashToastPayload | null;
  verifyEndpoint?: string;
}) {
  const seenIdsRef = useRef<Set<string>>(new Set());
  const verifyingCookieRef = useRef<string>("");
  const [toastTheme, setToastTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const syncTheme = () => {
      if (typeof document === "undefined") return;
      const attr = document.documentElement.dataset.theme;
      if (attr === "dark" || attr === "light") {
        setToastTheme(attr);
        return;
      }
      if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
        setToastTheme("dark");
      } else {
        setToastTheme("light");
      }
    };
    syncTheme();
    const onThemeChange = (e: Event) => {
      const next = (e as CustomEvent<"light" | "dark">).detail;
      if (next === "dark" || next === "light") setToastTheme(next);
    };
    window.addEventListener("rsl-theme-change", onThemeChange);
    return () => window.removeEventListener("rsl-theme-change", onThemeChange);
  }, []);

  useEffect(() => {
    if (verifiedToast?.id && !seenIdsRef.current.has(verifiedToast.id)) {
      seenIdsRef.current.add(verifiedToast.id);
      clearBrowserCookie(cookieName);
      triggerSileoToast(verifiedToast.type, verifiedToast.message);
    }
  }, [verifiedToast, cookieName]);

  useEffect(() => {
    const consumePendingToasts = () => {
      const encoded = readCookieValue(cookieName);
      if (encoded) {
        // Unsigned client-crafted cookies are never trusted and are cleared immediately.
        if (!encoded.startsWith("sig1.")) {
          clearBrowserCookie(cookieName);
          return;
        }
        if (verifyingCookieRef.current === encoded) {
          return;
        }
        verifyingCookieRef.current = encoded;
        void fetch(verifyEndpoint, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cookieName }),
        })
          .then(async (res) => {
            clearBrowserCookie(cookieName);
            if (!res.ok) return;
            const data = (await res.json()) as { toast?: FlashToastPayload | null };
            const parsed = data?.toast ?? null;
            if (parsed?.id && !seenIdsRef.current.has(parsed.id)) {
              seenIdsRef.current.add(parsed.id);
              triggerSileoToast(parsed.type, parsed.message);
            }
          })
          .catch(() => {
            clearBrowserCookie(cookieName);
          })
          .finally(() => {
            if (verifyingCookieRef.current === encoded) {
              verifyingCookieRef.current = "";
            }
          });
      }

      // Scrub legacy ?notice= or ?error= query params from the address bar without rendering unverified URL strings
      if (typeof window !== "undefined" && window.location.search) {
        const sp = new URLSearchParams(window.location.search);
        if (sp.has("notice") || sp.has("error")) {
          sp.delete("notice");
          sp.delete("error");
          const qs = sp.toString();
          const cleanUrl = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
          window.history.replaceState(null, "", cleanUrl);
        }
      }
    };

    consumePendingToasts();
    const timer = window.setInterval(consumePendingToasts, 450);
    window.addEventListener("focus", consumePendingToasts);
    window.addEventListener("popstate", consumePendingToasts);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", consumePendingToasts);
      window.removeEventListener("popstate", consumePendingToasts);
    };
  }, [cookieName, verifyEndpoint]);

  return (
    <Toaster
      position="top-right"
      theme={toastTheme}
      options={RSL_SILEO_TOAST_OPTIONS}
      offset={{ top: 16, right: 16 }}
    />
  );
}

/**
 * Legacy `<FlashBanner />` shim - renders nothing and ignores unverified URL query strings
 * because all feedback is delivered via server-signed flash toast cookies (`sig1.<hmac>.<b64>`).
 */
export function FlashBanner(_props: {
  notice?: string;
  error?: string;
}) {
  return null;
}
