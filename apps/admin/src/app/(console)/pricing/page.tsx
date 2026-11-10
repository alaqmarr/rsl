import { eq } from "drizzle-orm";
import { Landmark, QrCode, Tag } from "lucide-react";
import {
  canStaffAccessAdminRoute,
  formatStaffRoleLabel,
} from "@rsl/auth";
import {
  buildUpiPaymentPayload,
  computeDefaultCycleAmountsPaise,
  diagnoseUpiPayeeConfig,
  ensureServiceCatalogSeeded,
  formatBankAccountUpiAddress,
  generateUpiQrSvg,
  getPlatformBillingSettings,
  listGlobalBundleCatalog,
  SERVICE_CATALOG,
} from "@rsl/billing";
import { controlSchema } from "@rsl/database";
import { controlDb } from "@rsl/tenancy";
import {
  AccessRestrictedState,
  FlashBanner,
  GuideDrawerButton,
  MetricCard,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@rsl/ui";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import {
  staffSaveBillingSettingsAction,
  staffUpdateGlobalBundleAction,
  staffUpdatePriceAction,
} from "@/lib/actions";
import { requireStaffSession } from "@/lib/session";

export default async function AdminServicePricingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { staff } = await requireStaffSession();
  if (!canStaffAccessAdminRoute(staff.staffRole, "/pricing")) {
    return (
      <AccessRestrictedState
        pageTitle="Plan Prices & Bank Info"
        roleLabel={formatStaffRoleLabel(staff.staffRole)}
        requiredPermissionLabel="Manage global pricing & UPI details"
        description={`Your ${formatStaffRoleLabel(staff.staffRole)} account cannot modify global plan pricing or UPI/Bank receiving details.`}
      />
    );
  }
  ensureServiceCatalogSeeded();
  const sp = await searchParams;

  const billingSettings = getPlatformBillingSettings();
  const upiDiagnostics = diagnoseUpiPayeeConfig(billingSettings);
  const testUpiPayload = buildUpiPaymentPayload({
    routingMode: billingSettings.upiQrMode,
    upiId: billingSettings.upiId,
    accountNumber: billingSettings.accountNumber,
    ifscCode: billingSettings.ifscCode,
    bankName: billingSettings.bankName,
    payeeName: billingSettings.payeeName,
    subtotalPaise: 100, // ₹1.00 test verification QR
    includeGst: false,
    itemLabel: "Banking Name Check",
  });
  const testQrSvg = await generateUpiQrSvg(testUpiPayload.upiUri);
  const globalBundles = listGlobalBundleCatalog();
  const prices = controlDb()
    .select()
    .from(controlSchema.servicePrices)
    .where(eq(controlSchema.servicePrices.active, true))
    .all();
  const priceByKey = new Map(prices.map((p) => [p.serviceKey, p]));
  const svcNameByKey = new Map(SERVICE_CATALOG.map((s) => [s.key, s.name]));

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Catalog, Bundles & UPI Receiving"
        title="Plan & Bundle Catalog Prices (Monthly / Quarterly / Yearly)"
        subtitle="Configure the live UPI QR receiving details and manage global Monthly, Quarterly, and Yearly rates for both Dependency Bundles / Complete Software Package and Individual Plans."
        actions={
          <ActionLink href="/clients" className="adm-btn-secondary">
            Custom Per-Client Rates &amp; Bundles →
          </ActionLink>
        }
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Live UPI QR Target"
          value={
            billingSettings.upiQrMode === "upi_id" && billingSettings.upiId
              ? billingSettings.upiId
              : `A/C ${billingSettings.accountNumber}`
          }
          sublabel={
            billingSettings.upiQrMode === "upi_id" && billingSettings.upiId
              ? `VPA Mode • ${billingSettings.payeeName}`
              : `NPCI Bank-over-UPI (${formatBankAccountUpiAddress(
                  billingSettings.accountNumber,
                  billingSettings.ifscCode
                )})`
          }
          accent="emerald"
          icon={<QrCode className="h-4 w-4" />}
        />
        <MetricCard
          label="Bank Account (UPI / IMPS / NEFT)"
          value={billingSettings.bankName}
          sublabel={`A/C ${billingSettings.accountNumber} • IFSC ${billingSettings.ifscCode}`}
          accent="sky"
          icon={<Landmark className="h-4 w-4" />}
        />
        <MetricCard
          label="Catalog Plans & Bundles"
          value={`${SERVICE_CATALOG.length} Plans • ${globalBundles.length} Bundles`}
          sublabel={`Supplier GSTIN: ${billingSettings.gstin}`}
          icon={<Tag className="h-4 w-4" />}
        />
      </div>

      {/* Live UPI & Bank Receiving Details */}
      <SectionCard
        title="Bank Account & UPI QR Receiving Details"
        subtitle="Enter your registered UPI ID (VPA) so GPay, PhonePe, Paytm & BHIM instantly fetch your verified Banking Name on scan, plus your Bank Account + IFSC for IMPS / NEFT & Bank-over-UPI."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <GuideDrawerButton
              drawerId="admin-upi-banking-name-guide"
              label="Need help? • UPI Banking Name Guide"
              guide={{
                eyebrow: "UPI QR & Banking Name Setup",
                title: "Ensuring GPay, PhonePe & Paytm Fetch Your Verified Banking Name",
                summary:
                  "Follow these steps so every client's UPI scanner immediately displays your registered corporate banking name.",
                steps: [
                  {
                    title: "Use a registered bank or merchant VPA handle",
                    detail:
                      "Enter a real bank/merchant UPI ID (such as @okhdfcbank, @icici, @ybl, or @paytm) and select 'Standard UPI ID / VPA' routing mode.",
                  },
                  {
                    title: "Why @IFSC.ifsc.npci Bank-over-UPI QRs sometimes hide the name",
                    detail:
                      upiDiagnostics.bankingNameWarning ||
                      "Direct Account+IFSC UPI URIs (@IFSC.ifsc.npci) transfer funds over NPCI rails, but several consumer UPI camera scanners only look up verified Banking Names on VPA handles.",
                  },
                  {
                    title: "Scan the Live ₹1.00 Test QR on the right",
                    detail:
                      "After clicking Save UPI & Bank Details, scan the ₹1.00 test QR with GPay or PhonePe to confirm your corporate payee name appears before completing payment.",
                  },
                ],
              }}
            />
            {upiDiagnostics.bankingNameWarning ? (
              <StatusPill label="Action Needed for Banking Name" tone="amber" />
            ) : (
              <StatusPill label="Verified UPI Ready" tone="emerald" />
            )}
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_250px]">
          <form action={staffSaveBillingSettingsAction} className="space-y-4 text-[13px]">
            <input type="hidden" name="returnTo" value="/pricing" />

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="adm-label">Client QR Routing Mode</label>
                <select
                  name="upiQrMode"
                  defaultValue={
                    billingSettings.upiId
                      ? billingSettings.upiQrMode
                      : upiDiagnostics.recommendedMode
                  }
                  className="adm-input"
                >
                  <option value="upi_id">
                    Standard UPI ID / VPA (Recommended - Universal Banking Name)
                  </option>
                  <option value="bank_account">
                    Direct Bank Account + IFSC over UPI (@IFSC.ifsc.npci)
                  </option>
                </select>
              </div>

              <div>
                <label className="adm-label">Registered UPI ID (VPA Handle)</label>
                <input
                  name="upiId"
                  defaultValue={billingSettings.upiId}
                  placeholder="e.g. rapidshift@okhdfcbank or 9820000000@ybl"
                  className="adm-input font-mono"
                />
              </div>

              <div>
                <label className="adm-label">Payee / Beneficiary Name</label>
                <input
                  name="payeeName"
                  required
                  defaultValue={billingSettings.payeeName}
                  placeholder="RapidShift Labs Pvt Ltd"
                  className="adm-input"
                />
              </div>

              <div>
                <label className="adm-label">Bank Name &amp; Branch</label>
                <input
                  name="bankName"
                  required
                  defaultValue={billingSettings.bankName}
                  placeholder="HDFC Bank - Corporate"
                  className="adm-input"
                />
              </div>

              <div>
                <label className="adm-label">Current Account Number</label>
                <input
                  name="accountNumber"
                  required
                  defaultValue={billingSettings.accountNumber}
                  placeholder="502000XXXXXXXX"
                  className="adm-input font-mono"
                />
              </div>

              <div>
                <label className="adm-label">IFSC Code (11 Chars, 5th is 0)</label>
                <input
                  name="ifscCode"
                  required
                  maxLength={11}
                  defaultValue={billingSettings.ifscCode}
                  placeholder="HDFC0000123"
                  className="adm-input font-mono uppercase"
                />
              </div>

              <div>
                <label className="adm-label">Your Supplier GSTIN</label>
                <input
                  name="gstin"
                  required
                  defaultValue={billingSettings.gstin}
                  placeholder="27AABCR0000A1Z5"
                  className="adm-input font-mono uppercase"
                />
              </div>

              <div>
                <label className="adm-label">Billing Support Email</label>
                <input
                  name="billingEmail"
                  type="email"
                  required
                  defaultValue={billingSettings.billingEmail}
                  placeholder="app@rapidshiftlabs.in"
                  className="adm-input"
                />
              </div>

              <div>
                <label className="adm-label">Billing WhatsApp / Phone</label>
                <input
                  name="supportPhone"
                  required
                  defaultValue={billingSettings.supportPhone}
                  placeholder="+91 98200 00000"
                  className="adm-input"
                />
              </div>
            </div>

            <div className="flex flex-col items-stretch justify-between gap-3 border-t border-zinc-200/70 pt-3.5 sm:flex-row sm:items-center">
              <span className="text-xs text-zinc-500">
                {upiDiagnostics.bankingNameWarning
                  ? "Action recommended: add a VPA handle above or open 'Need help?' for banking name details."
                  : "Verified VPA & Bank receiving details active across all client checkout modals."}
              </span>
              <SubmitButton className="adm-btn-primary shrink-0" pendingText="Saving Details...">
                Save UPI &amp; Bank Details
              </SubmitButton>
            </div>
          </form>

          {/* Live Scannable ₹1.00 Test QR Preview */}
          <div className="flex flex-col items-center justify-between rounded-2xl border border-zinc-200/90 bg-zinc-50 p-4 text-center">
            <div className="w-full">
              <div className="text-[11px] font-bold tracking-wider text-zinc-500 uppercase">
                Live ₹1.00 Test Scan
              </div>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                Scan after saving to verify your Banking Name appears in GPay / PhonePe
              </p>
            </div>

            <div
              className="my-2.5 h-[148px] w-[148px] rounded-xl border border-zinc-200 bg-white p-2 shadow-2xs [&>svg]:h-full [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: testQrSvg }}
            />

            <div className="w-full min-w-0 space-y-1 text-[11px]">
              <div className="truncate font-mono font-semibold text-slate-800" title={testUpiPayload.payeeAddress}>
                {testUpiPayload.payeeAddress || "No UPI target"}
              </div>
              <div className="text-zinc-500">
                Mode:{" "}
                <strong className="text-slate-700">
                  {testUpiPayload.routingMode === "upi_id" ? "UPI ID (VPA)" : "Bank + IFSC"}
                </strong>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Global Bundle Catalog */}
      <SectionCard
        title="Global Bundle Packages & Complete All-in-One Software Package (INR ex-GST)"
        subtitle="Default Monthly, Quarterly, and Yearly pricing for dependency bundles and the full 15-tool software package across all clients."
        noPadding
      >
        <div className="hidden border-b border-zinc-200/80 bg-zinc-50/70 px-6 py-3 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase xl:grid xl:grid-cols-[1.8fr_115px_125px_125px_120px] xl:gap-4">
          <div>Bundle Package &amp; Included Tools</div>
          <div>Monthly (₹)</div>
          <div>Quarterly (₹)</div>
          <div>Yearly (₹)</div>
          <div className="text-right">Action</div>
        </div>

        <div className="divide-y divide-zinc-100 bg-white">
          {globalBundles.map((b) => (
            <form
              key={b.key}
              action={staffUpdateGlobalBundleAction}
              className="grid grid-cols-1 items-center gap-3 px-6 py-4 text-[13px] hover:bg-zinc-50/50 sm:grid-cols-3 xl:grid-cols-[1.8fr_115px_125px_125px_120px] xl:gap-4"
            >
              <input type="hidden" name="bundleKey" value={b.key} />
              <input type="hidden" name="returnTo" value="/pricing" />

              <div className="min-w-0 sm:col-span-3 xl:col-span-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-emerald-900 uppercase">
                    {b.badgeLabel}
                  </span>
                  <span className="text-[11px] text-zinc-500 tabular-nums">
                    {b.includedKeys.length} tools
                  </span>
                </div>
                <input
                  name="name"
                  defaultValue={b.name}
                  className="adm-input mt-1.5 py-1 font-semibold text-slate-900"
                />
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {b.includedKeys.map((k) => (
                    <span
                      key={k}
                      className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10.5px] text-zinc-600"
                    >
                      {svcNameByKey.get(k) ?? k}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <label className="adm-label xl:hidden">Monthly (₹)</label>
                <input
                  name="monthlyRupees"
                  type="number"
                  min="1"
                  step="1"
                  defaultValue={Math.round(b.monthlyAmountPaise / 100)}
                  className="adm-input tabular-nums"
                />
              </div>

              <div>
                <label className="adm-label xl:hidden">Quarterly (₹)</label>
                <input
                  name="quarterlyRupees"
                  type="number"
                  min="1"
                  step="1"
                  defaultValue={Math.round(b.quarterlyAmountPaise / 100)}
                  className="adm-input tabular-nums"
                />
              </div>

              <div>
                <label className="adm-label xl:hidden">Yearly (₹)</label>
                <input
                  name="yearlyRupees"
                  type="number"
                  min="1"
                  step="1"
                  defaultValue={Math.round(b.yearlyAmountPaise / 100)}
                  className="adm-input tabular-nums"
                />
              </div>

              <div className="flex justify-end sm:col-span-3 xl:col-span-1">
                <SubmitButton
                  className="adm-btn-secondary w-full xl:w-auto"
                  spinnerSize="xs"
                  pendingText="Saving..."
                >
                  Save Bundle
                </SubmitButton>
              </div>
            </form>
          ))}
        </div>
      </SectionCard>

      {/* Standard Individual Plan Catalog */}
      <SectionCard
        title="Standard Individual Plan Catalog (Monthly / Quarterly / Yearly INR ex-GST)"
        subtitle="Default subscription rates across Monthly, Quarterly, and Yearly cycles plus per-unit metered usage rates."
        noPadding
      >
        <div className="hidden border-b border-zinc-200/80 bg-zinc-50/70 px-6 py-3 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase xl:grid xl:grid-cols-[1.6fr_105px_115px_115px_105px_110px] xl:gap-3">
          <div>Plan Name &amp; Category</div>
          <div>Monthly (₹)</div>
          <div>Quarterly (₹)</div>
          <div>Yearly (₹)</div>
          <div>Per-Unit (₹)</div>
          <div className="text-right">Action</div>
        </div>

        <div className="divide-y divide-zinc-100 bg-white">
          {SERVICE_CATALOG.map((svc) => {
            const pr = priceByKey.get(svc.key);
            const monthlyPaise = pr?.monthlyAmountPaise ?? svc.defaultMonthlyPaise;
            const defaults = computeDefaultCycleAmountsPaise(monthlyPaise);
            const quarterlyPaise = pr?.quarterlyAmountPaise ?? defaults.quarterlyPaise;
            const yearlyPaise = pr?.yearlyAmountPaise ?? defaults.yearlyPaise;

            return (
              <form
                key={svc.key}
                action={staffUpdatePriceAction}
                className="grid grid-cols-1 items-center gap-3 px-6 py-4 text-[13px] hover:bg-zinc-50/50 sm:grid-cols-2 xl:grid-cols-[1.6fr_105px_115px_115px_105px_110px] xl:gap-3"
              >
                <input type="hidden" name="serviceKey" value={svc.key} />
                <input type="hidden" name="returnTo" value="/pricing" />

                <div className="min-w-0 sm:col-span-2 xl:col-span-1">
                  <div className="font-semibold text-slate-900">{svc.name}</div>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {svc.category} • Per {svc.meteredUnit.replace(/_/g, " ")}
                  </p>
                </div>

                <div>
                  <label className="adm-label xl:hidden">Monthly (₹)</label>
                  <input
                    name="monthlyRupees"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={Math.round(monthlyPaise / 100)}
                    className="adm-input tabular-nums"
                    aria-label={`${svc.name} Monthly Rupees`}
                  />
                </div>

                <div>
                  <label className="adm-label xl:hidden">Quarterly (₹)</label>
                  <input
                    name="quarterlyRupees"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={Math.round(quarterlyPaise / 100)}
                    className="adm-input tabular-nums"
                    aria-label={`${svc.name} Quarterly Rupees`}
                  />
                </div>

                <div>
                  <label className="adm-label xl:hidden">Yearly (₹)</label>
                  <input
                    name="yearlyRupees"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={Math.round(yearlyPaise / 100)}
                    className="adm-input tabular-nums"
                    aria-label={`${svc.name} Yearly Rupees`}
                  />
                </div>

                <div>
                  <label className="adm-label xl:hidden">Per-Unit (₹)</label>
                  <input
                    name="unitRupees"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={((pr?.unitAmountPaise ?? svc.defaultUnitPaise) / 100).toFixed(2)}
                    className="adm-input tabular-nums"
                    aria-label={`${svc.name} Unit Rupees`}
                  />
                </div>

                <div className="flex justify-end sm:col-span-2 xl:col-span-1">
                  <SubmitButton
                    className="adm-btn-secondary w-full xl:w-auto"
                    spinnerSize="xs"
                    pendingText="Saving..."
                  >
                    Save Price
                  </SubmitButton>
                </div>
              </form>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
