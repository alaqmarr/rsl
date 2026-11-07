"use client";

import React, { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "flexible" | "compact";
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
        }
      ) => string;
      remove?: (widgetId: string) => void;
    };
  }
}

export function TurnstileWidget({ siteKey }: { siteKey?: string | null }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [token, setToken] = useState("");
  const cleanKey = (siteKey || "").trim();

  useEffect(() => {
    if (!cleanKey || !containerRef.current) return;

    let widgetId: string | null = null;
    let cancelled = false;

    const mountWidget = () => {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      containerRef.current.innerHTML = "";
      widgetId = window.turnstile.render(containerRef.current, {
        sitekey: cleanKey,
        theme: "light",
        size: "flexible",
        callback: (tok) => setToken(tok),
        "expired-callback": () => setToken(""),
      });
    };

    if (window.turnstile) {
      mountWidget();
    } else {
      const existing = document.querySelector<HTMLScriptElement>(
        'script[data-rsl-turnstile="1"]'
      );
      if (existing) {
        existing.addEventListener("load", mountWidget);
      } else {
        const script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.dataset.rslTurnstile = "1";
        script.addEventListener("load", mountWidget);
        document.head.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile?.remove) {
        try {
          window.turnstile.remove(widgetId);
        } catch {
          // Ignore unmount cleanup errors
        }
      }
    };
  }, [cleanKey]);

  if (!cleanKey) return null;

  return (
    <div className="w-full py-1">
      <div ref={containerRef} className="min-h-[65px] w-full" />
      <input type="hidden" name="cf-turnstile-response" value={token} />
    </div>
  );
}
