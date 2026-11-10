"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ConfirmSubmitButton,
  IosSpinner,
  PasswordInput,
  SectionCard,
  sileo,
  StatusPill,
} from "@rsl/ui";
import { CopyTextButton } from "@/components/client-utils";
import {
  createNewBusinessJsonAction,
  deleteWorkspaceAccountAction,
  exportWorkspaceDpdpDataJsonAction,
  provisionWorkspaceSslJsonAction,
  saveBusinessSettingsJsonAction,
  switchWorkspaceJsonAction,
} from "@/lib/actions";

export interface BusinessSettingsClientProps {
  workspace: {
    id: string;
    name: string;
    slug: string;
    industry: string | null;
    businessPhone: string | null;
    billingEmail: string | null;
    website: string | null;
    addressLine: string | null;
    city: string | null;
    pincode: string | null;
    defaultTallyCompany: string | null;
    stateCode: string | null;
    gstin: string | null;
    upiVpa?: string | null;
    upiPayeeName?: string | null;
    bankName?: string | null;
    bankBranch?: string | null;
    bankAccountNumber?: string | null;
    bankIfsc?: string | null;
    timezone: string;
    billingStatus: string;
    createdAt: number;
  };
  gstStates: Array<[string, string]>;
  canEditBusiness: boolean;
  isOwner?: boolean;
  canProvisionSsl?: boolean;
  canAccessBilling?: boolean;
  canAccessTokens?: boolean;
  clientSubdomains?: {
    tallyHost: string;
    apiHost: string;
    tallyWebhookUrl: string;
    apiBaseUrl: string;
    certificates: Array<{
      zone: "tally" | "api";
      hostname: string;
      status: string;
      provider: string;
      coverageMode: string;
      expiresAt: number | null;
    }>;
  };
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    roleSlug: string;
    billingStatus: string;
  }>;
}

export function BusinessSettingsClient({
  workspace,
  gstStates,
  canEditBusiness,
  isOwner = false,
  canProvisionSsl = false,
  canAccessBilling = true,
  canAccessTokens = true,
  clientSubdomains,
  workspaces,
}: BusinessSettingsClientProps) {
  const router = useRouter();
  const [isExportingDpdp, startExportDpdp] = useTransition();
  const [selectedState, setSelectedState] = useState(workspace.stateCode || "27");
  const [gstinInput, setGstinInput] = useState(workspace.gstin || "");
  const [cityInput, setCityInput] = useState(workspace.city || "");
  const [pincodeInput, setPincodeInput] = useState(workspace.pincode || "");
  const [upiVpaInput, setUpiVpaInput] = useState(workspace.upiVpa || "");
  const [upiPayeeInput, setUpiPayeeInput] = useState(workspace.upiPayeeName || workspace.name || "");
  const [bankIfscInput, setBankIfscInput] = useState(workspace.bankIfsc || "");
  const [bankNameInput, setBankNameInput] = useState(workspace.bankName || "");
  const [bankBranchInput, setBankBranchInput] = useState(workspace.bankBranch || "");
  const [bankAccInput, setBankAccInput] = useState(workspace.bankAccountNumber || "");
  const [gstinMeta, setGstinMeta] = useState<{
    formatValid: boolean;
    checksumValid: boolean;
    pan: string | null;
    suggestedGstin: string | null;
    error: string | null;
  } | null>(null);
  const [lookupBusy, setLookupBusy] = useState<"pin" | "ifsc" | null>(null);
  const [isSaving, startSaveTransition] = useTransition();
  const [isCreatingBiz, startCreateBizTransition] = useTransition();
  const [isProvisioningSsl, startProvisionSslTransition] = useTransition();
  const [switchingWsId, setSwitchingWsId] = useState<string | null>(null);
  const [, startSwitchTransition] = useTransition();

  function handleProvisionSsl() {
    startProvisionSslTransition(async () => {
      const res = await provisionWorkspaceSslJsonAction();
      if (res.ok) {
        sileo.success({
          title: "SSL Certificates Verified",
          description: res.message,
          duration: 4600,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "SSL Provisioning Error",
          description: res.message,
          duration: 5000,
        });
      }
    });
  }

  const isIntraStateMaharashtra = selectedState === "27";

  async function handleGstinLiveCheck(nextVal: string) {
    const upper = nextVal.toUpperCase().replace(/\s+/g, "");
    setGstinInput(upper);
    if (/^\d{2}/.test(upper)) {
      const st = upper.slice(0, 2);
      if (gstStates.some(([c]) => c === st)) setSelectedState(st);
    }
    if (upper.length === 15) {
      try {
        const res = await fetch(`/api/tools/lookup?kind=gstin&q=${encodeURIComponent(upper)}`);
        const json = (await res.json()) as {
          ok: boolean;
          result?: {
            formatValid: boolean;
            checksumValid: boolean;
            pan: string | null;
            suggestedGstin: string | null;
            error: string | null;
          };
        };
        if (json.result) setGstinMeta(json.result);
      } catch {
        // Non-blocking
      }
    } else {
      setGstinMeta(null);
    }
  }

  async function handlePincodeLookup(nextPin: string) {
    const digits = nextPin.replace(/\D/g, "").slice(0, 6);
    setPincodeInput(digits);
    if (digits.length === 6) {
      setLookupBusy("pin");
      try {
        const res = await fetch(`/api/tools/lookup?kind=pincode&q=${encodeURIComponent(digits)}`);
        const json = (await res.json()) as {
          ok: boolean;
          result?: { district: string | null; gstStateCode: string | null };
        };
        if (json.ok && json.result) {
          if (json.result.district && !cityInput.trim()) {
            setCityInput(json.result.district);
          }
          if (json.result.gstStateCode && gstStates.some(([c]) => c === json.result!.gstStateCode)) {
            setSelectedState(json.result.gstStateCode);
          }
        }
      } catch {
        // Non-blocking
      } finally {
        setLookupBusy(null);
      }
    }
  }

  async function handleIfscLookup(nextIfsc: string) {
    const upper = nextIfsc.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11);
    setBankIfscInput(upper);
    if (upper.length === 11) {
      setLookupBusy("ifsc");
      try {
        const res = await fetch(`/api/tools/lookup?kind=ifsc&q=${encodeURIComponent(upper)}`);
        const json = (await res.json()) as {
          ok: boolean;
          result?: { bank: string | null; branch: string | null; city: string | null };
        };
        if (json.ok && json.result) {
          if (json.result.bank) setBankNameInput(json.result.bank);
          if (json.result.branch) {
            setBankBranchInput(
              json.result.city ? `${json.result.branch}, ${json.result.city}` : json.result.branch
            );
          }
          sileo.success({
            title: "IFSC Verified",
            description: `${json.result.bank || "Bank"} - ${json.result.branch || upper}`,
            duration: 3200,
          });
        }
      } catch {
        // Non-blocking
      } finally {
        setLookupBusy(null);
      }
    }
  }

  function handleSaveBusiness(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSaveTransition(async () => {
      const res = await saveBusinessSettingsJsonAction(fd);
      if (res.ok) {
        sileo.success({
          title: "Business Settings Saved",
          description: res.message,
          duration: 4600,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Could Not Save Business Settings",
          description: res.message,
          duration: 5400,
        });
      }
    });
  }

  function handleCreateNewBusiness(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    startCreateBizTransition(async () => {
      const res = await createNewBusinessJsonAction(fd);
      if (res.ok) {
        formEl.reset();
        sileo.success({
          title: "New Business Created",
          description: res.message,
          duration: 4800,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Could Not Create Business",
          description: res.message,
          duration: 5200,
        });
      }
    });
  }

  function handleSwitchWorkspace(workspaceId: string) {
    setSwitchingWsId(workspaceId);
    startSwitchTransition(async () => {
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

  return (
    <div className="w-full space-y-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left: Complete Business Profile, Registered Address & GSTIN */}
        <div className="min-w-0 xl:col-span-8">
          <SectionCard
            title="Business Identity, Registered Address & GST Tax Details"
            subtitle="Used on official 18% GST tax invoices, Tally Prime voucher imports, and customer notifications"
          >
            {!canEditBusiness && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-[13px] text-amber-950">
                Your current role has read-only access to Business Settings. Ask the Business Owner
                or an Admin to update legal or GST details.
              </div>
            )}

            <form onSubmit={handleSaveBusiness} className="space-y-5 text-[13px]">
              {/* Identity & Contact */}
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div className="min-w-0">
                  <label className="rsl-label">Registered / Legal Business Name *</label>
                  <input
                    name="name"
                    defaultValue={workspace.name}
                    required
                    disabled={!canEditBusiness}
                    placeholder="e.g. Shree Laxmi Distributors Pvt Ltd"
                    className="rsl-input"
                  />
                </div>
                <div className="min-w-0">
                  <label className="rsl-label">Industry / Business Category</label>
                  <input
                    name="industry"
                    defaultValue={workspace.industry || ""}
                    disabled={!canEditBusiness}
                    placeholder="e.g. Wholesale / FMCG / Manufacturing"
                    className="rsl-input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                <div className="min-w-0">
                  <label className="rsl-label">Official Business Phone</label>
                  <input
                    name="businessPhone"
                    defaultValue={workspace.businessPhone || ""}
                    disabled={!canEditBusiness}
                    placeholder="+91 22 4000 1122"
                    className="rsl-input"
                  />
                </div>
                <div className="min-w-0">
                  <label className="rsl-label">Accounts / Billing Email</label>
                  <input
                    name="billingEmail"
                    type="email"
                    defaultValue={workspace.billingEmail || ""}
                    disabled={!canEditBusiness}
                    placeholder="accounts@yourcompany.in"
                    className="rsl-input"
                  />
                </div>
                <div className="min-w-0">
                  <label className="rsl-label">Website URL</label>
                  <input
                    name="website"
                    defaultValue={workspace.website || ""}
                    disabled={!canEditBusiness}
                    placeholder="https://yourcompany.in"
                    className="rsl-input"
                  />
                </div>
              </div>

              {/* Tally Default Company */}
              <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/70 p-3.5">
                <label className="rsl-label">Default Tally Prime Company Name</label>
                <input
                  name="defaultTallyCompany"
                  defaultValue={workspace.defaultTallyCompany || workspace.name}
                  disabled={!canEditBusiness}
                  placeholder="Exact company name inside Tally Prime (e.g. FY 2026-27)"
                  className="rsl-input bg-white"
                />
                <p className="mt-1 text-[11px] text-zinc-500">
                  Automatically pre-fills Tally Prime XML/CSV imports and associates incoming TDL
                  webhook bills when no company tag is specified.
                </p>
              </div>

              {/* Registered Office Address */}
              <div className="border-t border-zinc-200/80 pt-4">
                <div className="mb-3 text-xs font-bold tracking-wider text-zinc-500 uppercase">
                  Registered Billing Address &amp; GST Tax Configuration
                </div>

                <div className="space-y-3.5">
                  <div className="min-w-0">
                    <label className="rsl-label">Registered Street / Building Address</label>
                    <input
                      name="addressLine"
                      defaultValue={workspace.addressLine || ""}
                      disabled={!canEditBusiness}
                      placeholder="Plot / Gala No., Industrial Estate, Area"
                      className="rsl-input"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                    <div className="min-w-0">
                      <label className="rsl-label">City / District</label>
                      <input
                        name="city"
                        value={cityInput}
                        onChange={(e) => setCityInput(e.target.value)}
                        disabled={!canEditBusiness}
                        placeholder="e.g. Mumbai"
                        className="rsl-input"
                      />
                    </div>
                    <div className="min-w-0">
                      <label className="rsl-label">
                        6-Digit Indian PIN Code{" "}
                        {lookupBusy === "pin" && (
                          <span className="text-[11px] font-normal text-emerald-700">
                            (Auto-filling...)
                          </span>
                        )}
                      </label>
                      <input
                        name="pincode"
                        value={pincodeInput}
                        onChange={(e) => handlePincodeLookup(e.target.value)}
                        maxLength={6}
                        disabled={!canEditBusiness}
                        placeholder="e.g. 400021 (auto-fills City & State)"
                        className="rsl-input font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                    <div className="min-w-0">
                      <label className="rsl-label">Place of Supply - State / UT *</label>
                      <select
                        name="stateCode"
                        value={selectedState}
                        disabled={!canEditBusiness}
                        onChange={(e) => setSelectedState(e.target.value)}
                        className="rsl-input"
                      >
                        {gstStates.map(([code, stateName]) => (
                          <option key={code} value={code}>
                            {code} - {stateName}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="min-w-0">
                      <label className="rsl-label">15-Character GSTIN (Modulo-36 Verified)</label>
                      <input
                        name="gstin"
                        value={gstinInput}
                        disabled={!canEditBusiness}
                        onChange={(e) => handleGstinLiveCheck(e.target.value)}
                        maxLength={15}
                        placeholder={`${selectedState}AABCU9603R1ZM`}
                        className="rsl-input font-mono uppercase"
                      />
                      {gstinMeta && (
                        <div className="mt-1.5 text-[11px]">
                          {gstinMeta.checksumValid ? (
                            <span className="font-semibold text-emerald-700">
                              ✓ Valid GSTN Checksum • PAN: {gstinMeta.pan}
                            </span>
                          ) : gstinMeta.suggestedGstin ? (
                            <div className="flex flex-wrap items-center gap-2 text-amber-800">
                              <span>
                                Check-digit typo detected (expected{" "}
                                <code className="font-mono font-bold">
                                  {gstinMeta.suggestedGstin}
                                </code>
                                )
                              </span>
                              <button
                                type="button"
                                onClick={() => handleGstinLiveCheck(gstinMeta.suggestedGstin!)}
                                className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900 hover:bg-amber-200"
                              >
                                Apply Fix
                              </button>
                            </div>
                          ) : (
                            <span className="text-rose-700">{gstinMeta.error}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Direct 0%-Fee NPCI UPI QR & NEFT Bank Account for Tally Bills */}
                  <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/70 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold text-slate-900">
                          Zero-Fee Direct UPI QR &amp; NEFT Bank Details (Shown on Tally Bill Payment Links)
                        </div>
                        <p className="text-[11px] text-zinc-500">
                          Every Tally WhatsApp reminder includes a signed{" "}
                          <code className="font-mono">/pay/bill/...</code> portal with a dynamic NPCI{" "}
                          <code className="font-mono">upi://pay</code> QR for the exact pending balance (0% gateway fee).
                        </p>
                      </div>
                      <StatusPill
                        label={upiVpaInput.trim() ? "Direct UPI QR Ready" : "Add Merchant UPI ID"}
                        tone={upiVpaInput.trim() ? "emerald" : "amber"}
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="rsl-label">Merchant UPI ID / VPA (0% Fee)</label>
                        <input
                          name="upiVpa"
                          value={upiVpaInput}
                          onChange={(e) => setUpiVpaInput(e.target.value)}
                          disabled={!canEditBusiness}
                          placeholder="yourbusiness@hdfcbank or 9876543210@okicici"
                          className="rsl-input font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label className="rsl-label">UPI Payee Display Name</label>
                        <input
                          name="upiPayeeName"
                          value={upiPayeeInput}
                          onChange={(e) => setUpiPayeeInput(e.target.value)}
                          disabled={!canEditBusiness}
                          placeholder={workspace.name}
                          className="rsl-input text-xs"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                      <div>
                        <label className="rsl-label">
                          IFSC Code{" "}
                          {lookupBusy === "ifsc" && (
                            <span className="text-[10px] text-emerald-700">(Looking up...)</span>
                          )}
                        </label>
                        <input
                          name="bankIfsc"
                          value={bankIfscInput}
                          onChange={(e) => handleIfscLookup(e.target.value)}
                          maxLength={11}
                          disabled={!canEditBusiness}
                          placeholder="HDFC0000001"
                          className="rsl-input font-mono uppercase text-xs"
                        />
                      </div>
                      <div>
                        <label className="rsl-label">Bank Name</label>
                        <input
                          name="bankName"
                          value={bankNameInput}
                          onChange={(e) => setBankNameInput(e.target.value)}
                          disabled={!canEditBusiness}
                          placeholder="Auto-filled from IFSC"
                          className="rsl-input text-xs"
                        />
                      </div>
                      <div>
                        <label className="rsl-label">Branch</label>
                        <input
                          name="bankBranch"
                          value={bankBranchInput}
                          onChange={(e) => setBankBranchInput(e.target.value)}
                          disabled={!canEditBusiness}
                          placeholder="Auto-filled from IFSC"
                          className="rsl-input text-xs"
                        />
                      </div>
                      <div>
                        <label className="rsl-label">Bank Account Number</label>
                        <input
                          name="bankAccountNumber"
                          value={bankAccInput}
                          onChange={(e) => setBankAccInput(e.target.value)}
                          disabled={!canEditBusiness}
                          placeholder="For NEFT / RTGS"
                          className="rsl-input font-mono text-xs"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Live GST Calculation Mode Preview */}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200/90 bg-emerald-50/70 px-3.5 py-2.5 text-xs text-emerald-950">
                    <div>
                      <span className="font-semibold">GST Invoice Tax Split: </span>
                      {isIntraStateMaharashtra
                        ? "Intra-State Supply (Maharashtra 27) → 9% CGST + 9% SGST • SAC 998314"
                        : `Inter-State Supply (State Code ${selectedState}) → 18% IGST • SAC 998314`}
                    </div>
                    <StatusPill
                      label={gstinInput.trim().length === 15 ? "B2B GSTIN Ready" : "B2C / Unregistered"}
                      tone={gstinInput.trim().length === 15 ? "emerald" : "stone"}
                    />
                  </div>
                </div>
              </div>

              {canEditBusiness && (
                <div className="pt-1">
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="rsl-btn-primary inline-flex items-center gap-2"
                  >
                    {isSaving && <IosSpinner size="xs" className="text-white" />}
                    <span>{isSaving ? "Saving Business Settings..." : "Save Business Settings"}</span>
                  </button>
                </div>
              )}
            </form>
          </SectionCard>
        </div>

        {/* Right: Workspace Identifiers & Multi-Business Switcher */}
        <div className="min-w-0 space-y-6 xl:col-span-4">
          <SectionCard
            title="Workspace Identifiers"
            subtitle="Reference IDs for API calls, support tickets & webhooks"
          >
            <div className="space-y-3 text-[13px]">
              <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-zinc-600">Workspace ID</span>
                  <CopyTextButton text={workspace.id} label="Copy ID" copiedLabel="Copied" />
                </div>
                <div className="mt-1 break-all font-mono text-xs font-semibold text-slate-900">
                  {workspace.id}
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-zinc-600">Workspace Slug</span>
                  <CopyTextButton text={workspace.slug} label="Copy Slug" copiedLabel="Copied" />
                </div>
                <div className="mt-1 break-all font-mono text-xs font-semibold text-slate-900">
                  {workspace.slug}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 text-xs">
                <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3">
                  <div className="text-zinc-500">Timezone</div>
                  <div className="mt-0.5 font-semibold text-slate-900">{workspace.timezone}</div>
                </div>
                <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3">
                  <div className="text-zinc-500">Account Status</div>
                  <div className="mt-1">
                    <StatusPill
                      label={workspace.billingStatus === "suspended" ? "Paused" : "Active"}
                      tone={workspace.billingStatus === "suspended" ? "amber" : "emerald"}
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                {canAccessBilling && (
                  <Link href="/billing" className="rsl-btn-secondary py-1.5 text-xs">
                    Plans &amp; GST Invoices
                  </Link>
                )}
                {canAccessTokens && (
                  <Link href="/settings/tokens" className="rsl-btn-secondary py-1.5 text-xs">
                    All API Tokens
                  </Link>
                )}
              </div>
            </div>
          </SectionCard>

          {clientSubdomains && (
            <SectionCard
              title="Dedicated Client SSL Subdomains"
              subtitle="Whitelisted HTTPS ingress endpoints under *.tally.rapidshiftlabs.in & *.api.rapidshiftlabs.in"
            >
              <div className="space-y-3 text-xs">
                {[
                  {
                    zone: "tally" as const,
                    label: "Tally Prime Cloud Ingress",
                    host: clientSubdomains.tallyHost,
                    url: clientSubdomains.tallyWebhookUrl,
                  },
                  {
                    zone: "api" as const,
                    label: "Client REST API & Webhooks",
                    host: clientSubdomains.apiHost,
                    url: clientSubdomains.apiBaseUrl,
                  },
                ].map((entry) => {
                  const cert = clientSubdomains.certificates.find((c) => c.zone === entry.zone);
                  const isActive = cert?.status === "active";
                  return (
                    <div
                      key={entry.zone}
                      className="rounded-xl border border-zinc-200/90 bg-zinc-50/75 p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900">{entry.label}</span>
                        <div className="flex items-center gap-1.5">
                          <StatusPill
                            label={
                              isActive
                                ? "SSL Active"
                                : cert?.status === "queued" || cert?.status === "provisioning"
                                  ? "SSL Queued"
                                  : "Ready to Provision"
                            }
                            tone={isActive ? "emerald" : "amber"}
                          />
                          <CopyTextButton text={`https://${entry.host}`} label="Copy" copiedLabel="Copied" />
                        </div>
                      </div>
                      <div className="mt-1 break-all font-mono text-[11.5px] font-semibold text-emerald-800">
                        https://{entry.host}
                      </div>
                      {cert?.expiresAt && (
                        <div className="mt-1 text-[11px] text-zinc-500 tabular-nums">
                          Coverage: {cert.coverageMode === "wildcard_san" ? "Wildcard SAN" : "Dedicated ACME"} • Renews before{" "}
                          {new Date(cert.expiresAt).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}

                {canProvisionSsl && (
                  <button
                    type="button"
                    disabled={isProvisioningSsl}
                    onClick={handleProvisionSsl}
                    className="rsl-btn-secondary inline-flex w-full items-center justify-center gap-2 py-1.5 text-xs"
                  >
                    {isProvisioningSsl && <IosSpinner size="xs" />}
                    <span>
                      {isProvisioningSsl
                        ? "Verifying & Provisioning SSL..."
                        : "Verify & Renew Client SSL Certificates"}
                    </span>
                  </button>
                )}
              </div>
            </SectionCard>
          )}

          <div id="add-business">
            <SectionCard
              title={`Switch or Add Business (${workspaces.length})`}
              subtitle="Manage multiple firms or GSTINs under a single login"
            >
              <div className="space-y-4 text-[13px]">
                <div className="divide-y divide-zinc-200/80">
                  {workspaces.map((w) => {
                    const isCurrent = w.id === workspace.id;
                    const isSwitching = switchingWsId === w.id;
                    return (
                      <div
                        key={w.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-slate-900">{w.name}</div>
                          <div className="font-mono text-[11px] text-zinc-500">
                            {w.slug} • {w.roleSlug.toUpperCase()}
                          </div>
                        </div>
                        {isCurrent ? (
                          <StatusPill label="Current" tone="emerald" />
                        ) : (
                          <button
                            type="button"
                            disabled={Boolean(switchingWsId)}
                            onClick={() => handleSwitchWorkspace(w.id)}
                            className="rsl-btn-secondary inline-flex items-center gap-1.5 py-1 text-xs"
                          >
                            {isSwitching && <IosSpinner size="xs" />}
                            <span>Switch</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {canEditBusiness && (
                <form
                  onSubmit={handleCreateNewBusiness}
                  className="space-y-3 border-t border-zinc-200/80 pt-3.5"
                >
                  <div className="text-xs font-bold tracking-wide text-slate-900 uppercase">
                    + Add Another Business Workspace
                  </div>
                  <div>
                    <label className="rsl-label">New Business Name *</label>
                    <input
                      name="businessName"
                      required
                      minLength={2}
                      placeholder="e.g. Branch / Sister Company Pvt Ltd"
                      className="rsl-input"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <div>
                      <label className="rsl-label">GST State</label>
                      <select name="stateCode" defaultValue="27" className="rsl-input">
                        {gstStates.map(([code, stateName]) => (
                          <option key={code} value={code}>
                            {code} - {stateName}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="rsl-label">GSTIN (Optional)</label>
                      <input
                        name="gstin"
                        maxLength={15}
                        placeholder="27AAAAA0000A1Z5"
                        className="rsl-input font-mono uppercase"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={isCreatingBiz}
                    className="rsl-btn-secondary inline-flex w-full items-center justify-center gap-2"
                  >
                    {isCreatingBiz && <IosSpinner size="xs" />}
                    <span>{isCreatingBiz ? "Creating Workspace..." : "Create & Switch Business"}</span>
                  </button>
                </form>
                )}
              </div>
            </SectionCard>
          </div>
        </div>
      </div>

      {/* DPDP Act 2023 Data Portability & Right to Erasure (Crypto-Shredding) */}
      <SectionCard
        title="DPDP Act 2023 - Data Portability & Right to Erasure"
        subtitle="Download a complete machine-readable JSON export of your workspace data anytime, or permanently delete and crypto-shred your workspace."
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 text-xs">
          <div className="space-y-3 rounded-xl border border-zinc-200/90 bg-zinc-50/75 p-4">
            <div className="font-bold text-slate-900">
              1-Click Portable Workspace Data Export (JSON)
            </div>
            <p className="leading-relaxed text-zinc-600">
              Exports your business profile, customer contacts, consent records, message threads,
              Tally Prime ledgers, vouchers, and templates in structured JSON format under India&apos;s
              Digital Personal Data Protection (DPDP) Act 2023.
            </p>
            {canEditBusiness ? (
              <button
                type="button"
                disabled={isExportingDpdp}
                onClick={() => {
                  startExportDpdp(async () => {
                    const res = await exportWorkspaceDpdpDataJsonAction();
                    if (res.ok && res.jsonText && res.fileName) {
                      const blob = new Blob([res.jsonText], { type: "application/json" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = res.fileName;
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      URL.revokeObjectURL(url);
                      sileo.success({
                        title: "DPDP Data Export Downloaded",
                        description: res.message,
                      });
                    } else {
                      sileo.error({
                        title: "Export Failed",
                        description: res.message,
                      });
                    }
                  });
                }}
                className="rsl-btn-secondary inline-flex items-center gap-2 text-xs"
              >
                {isExportingDpdp && <IosSpinner size="xs" />}
                <span>
                  {isExportingDpdp ? "Preparing JSON Archive..." : "Download Portable JSON Export"}
                </span>
              </button>
            ) : (
              <p className="text-zinc-500">
                Owner or Admin permission is required to export full workspace data.
              </p>
            )}
          </div>

          <div className="space-y-3 rounded-xl border border-rose-200/90 bg-rose-50/50 p-4">
            <div className="font-bold text-rose-950">
              Permanent Workspace Erasure &amp; Crypto-Shredding (Owner Only)
            </div>
            <p className="leading-relaxed text-rose-900/90">
              Permanently erases your isolated tenant database, revokes all connected channel OAuth
              tokens &amp; API keys, invalidates all public Tally bill links, and writes a compliance
              tombstone. Statutory B2B GST tax invoices remain retained per Indian tax law.
            </p>
            {isOwner ? (
              <form action={deleteWorkspaceAccountAction} className="space-y-3">
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="dpdp-confirm-phrase" className="rsl-label text-rose-950">
                      Type DELETE MY WORKSPACE *
                    </label>
                    <input
                      id="dpdp-confirm-phrase"
                      name="confirmPhrase"
                      required
                      placeholder="DELETE MY WORKSPACE"
                      className="rsl-input font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="dpdp-owner-password" className="rsl-label text-rose-950">
                      Current Owner Password *
                    </label>
                    <PasswordInput
                      id="dpdp-owner-password"
                      name="password"
                      required
                      autoComplete="current-password"
                      placeholder="Confirm password"
                      className="rsl-input text-xs"
                    />
                  </div>
                </div>
                <input
                  type="hidden"
                  name="reason"
                  value="Owner initiated DPDP Act 2023 right-to-erasure from Business Settings"
                />
                <ConfirmSubmitButton
                  confirmMessage="PERMANENT ACTION: Crypto-shred all workspace secrets, delete your tenant database, and close this business workspace? This cannot be undone."
                  className="rsl-btn-danger text-xs"
                >
                  Permanently Delete &amp; Crypto-Shred Workspace
                </ConfirmSubmitButton>
              </form>
            ) : (
              <p className="text-rose-900/80">
                Restricted strictly to the direct Business Owner account (disabled for delegated
                roles and support sessions).
              </p>
            )}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
