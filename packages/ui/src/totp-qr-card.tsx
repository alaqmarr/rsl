"use client";

import React, { useState } from "react";
import { Check, Copy, ExternalLink, QrCode, ShieldCheck } from "lucide-react";
import { CopyCodeBlock } from "./interactive";

export interface TotpQrCodeCardProps {
  secret: string;
  otpauthUri: string;
  qrCodeDataUri: string;
  accountEmail?: string | null;
  issuer?: string | null;
  compact?: boolean;
}

export function TotpQrCodeCard({
  secret,
  otpauthUri,
  qrCodeDataUri,
  accountEmail,
  issuer = "RapidShift Labs",
  compact = false,
}: TotpQrCodeCardProps) {
  const [copiedUri, setCopiedUri] = useState(false);

  async function handleCopyUri() {
    if (!otpauthUri || typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(otpauthUri);
      setCopiedUri(true);
      window.setTimeout(() => setCopiedUri(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  }

  return (
    <div className="rsl-totp-qr-shell space-y-4">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div className="rsl-totp-qr-frame shrink-0">
          <img
            src={qrCodeDataUri}
            alt={`Scan QR code in your authenticator app for ${accountEmail || issuer}`}
            className="rsl-totp-qr-image"
          />
          <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-slate-900">
            <QrCode className="h-3 w-3 text-emerald-700" />
            <span>Scan with Camera</span>
          </span>
        </div>

        <div className="min-w-0 flex-1 space-y-3 text-xs">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-900">
              <ShieldCheck className="h-3 w-3 text-emerald-700" />
              <span>RFC 6238 TOTP • 6 Digits • 30s Window</span>
            </div>
            <h3 className="mt-2 text-sm font-semibold text-slate-900">
              Scan QR Code in Your Authenticator App
            </h3>
            <p className="mt-1 leading-relaxed text-zinc-600">
              Open <strong>Google Authenticator</strong>, <strong>1Password</strong>,{" "}
              <strong>Microsoft Authenticator</strong>, <strong>Authy</strong>, or{" "}
              <strong>Apple Passwords</strong> and point your camera at the QR code.
            </p>
          </div>

          {(issuer || accountEmail) && (
            <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
              {issuer && (
                <span className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 font-medium text-zinc-700">
                  Issuer: <strong className="text-slate-900">{issuer}</strong>
                </span>
              )}
              {accountEmail && (
                <span className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 font-medium text-zinc-700">
                  Account: <strong className="text-slate-900">{accountEmail}</strong>
                </span>
              )}
            </div>
          )}

          {otpauthUri && (
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <a
                href={otpauthUri}
                className="rsl-btn-secondary inline-flex items-center gap-1.5 py-1.5 text-xs"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Open in Authenticator App</span>
              </a>
              <button
                type="button"
                onClick={handleCopyUri}
                className="rsl-btn-secondary inline-flex items-center gap-1.5 py-1.5 text-xs"
              >
                {copiedUri ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-700" />
                    <span>Copied otpauth:// URI</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy otpauth:// URI</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {!compact && (
        <div className="border-t border-zinc-200/80 pt-3">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-800">
              Can&apos;t scan the QR code? Enter this Base32 Setup Key manually:
            </span>
          </div>
          <CopyCodeBlock code={secret} language="text" />
        </div>
      )}
    </div>
  );
}
