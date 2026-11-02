"use client";

import React, { useEffect, useRef } from "react";
import { sileo, Toaster } from "sileo";

export { sileo };

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

  const dashIdx = clean.indexOf(" — ");
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
      title: parts.title,
      description: parts.description,
      duration: 5500,
    });
    return;
  }
  if (type === "warning") {
    const parts = splitToastMessage(message, "Please check");
    sileo.warning({
      title: parts.title,
      description: parts.description,
      duration: 5000,
    });
    return;
  }
  if (type === "info") {
    const parts = splitToastMessage(message, "Update");
    sileo.info({
      title: parts.title,
      description: parts.description,
      duration: 4200,
    });
    return;
  }
  const parts = splitToastMessage(message, "Saved");
  sileo.success({
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

function decodeFlashPayload(raw: string): FlashToastPayload | null {
  try {
    if (raw.startsWith("b64_")) {
      const b64 = raw.slice(4).replace(/-/g, "+").replace(/_/g, "/");
      const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const text = new TextDecoder().decode(bytes);
      return JSON.parse(text) as FlashToastPayload;
    }
    try {
      return JSON.parse(decodeURIComponent(raw)) as FlashToastPayload;
    } catch {
      return JSON.parse(raw) as FlashToastPayload;
    }
  } catch {
    return null;
  }
}

export function SileoToastProvider({
  cookieName = "rsl_toast",
}: {
  cookieName?: string;
}) {
  const seenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const consumePendingToasts = () => {
      // 1. Consume Server Action flash cookie (zero URL params)
      const encoded = readCookieValue(cookieName);
      if (encoded) {
        clearBrowserCookie(cookieName);
        const parsed = decodeFlashPayload(encoded);
        if (parsed?.id && !seenIdsRef.current.has(parsed.id)) {
          seenIdsRef.current.add(parsed.id);
          triggerSileoToast(parsed.type, parsed.message);
        }
      }

      // 2. Also intercept & strip any legacy ?notice= or ?error= query params so URLs stay clean
      if (typeof window !== "undefined" && window.location.search) {
        const sp = new URLSearchParams(window.location.search);
        const notice = sp.get("notice");
        const error = sp.get("error");
        if (notice || error) {
          const urlKey = `url:${window.location.pathname}:${notice ?? ""}:${error ?? ""}`;
          sp.delete("notice");
          sp.delete("error");
          const qs = sp.toString();
          const cleanUrl = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
          window.history.replaceState(null, "", cleanUrl);

          if (!seenIdsRef.current.has(urlKey)) {
            seenIdsRef.current.add(urlKey);
            if (notice) triggerSileoToast("success", notice);
            if (error) triggerSileoToast("error", error);
          }
        }
      }
    };

    consumePendingToasts();
    const timer = window.setInterval(consumePendingToasts, 220);
    window.addEventListener("focus", consumePendingToasts);
    window.addEventListener("popstate", consumePendingToasts);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", consumePendingToasts);
      window.removeEventListener("popstate", consumePendingToasts);
    };
  }, [cookieName]);

  return (
    <Toaster
      position="top-right"
      theme="light"
      offset={{ top: 16, right: 16 }}
    />
  );
}

/**
 * Legacy `<FlashBanner />` shim — renders nothing inline in the page flow
 * because all feedback is now delivered via Sileo physics toasts.
 * If props are passed directly without cookie/URL, fires Sileo once on mount.
 */
export function FlashBanner({
  notice,
  error,
}: {
  notice?: string;
  error?: string;
}) {
  const firedRef = useRef<string>("");

  useEffect(() => {
    if (!notice && !error) return;
    // If URL still had ?notice / ?error, SileoToastProvider handles & strips it
    if (typeof window !== "undefined" && window.location.search) {
      const sp = new URLSearchParams(window.location.search);
      if (sp.has("notice") || sp.has("error")) return;
    }
    const key = `${notice ?? ""}|${error ?? ""}`;
    if (firedRef.current === key) return;
    firedRef.current = key;
    if (notice) triggerSileoToast("success", notice);
    if (error) triggerSileoToast("error", error);
  }, [notice, error]);

  return null;
}
