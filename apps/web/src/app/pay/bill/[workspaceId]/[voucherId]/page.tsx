import { formatInr } from "@rsl/core";
import { getPublicTallyBillPaymentView } from "@rsl/tally";

export const dynamic = "force-dynamic";

function formatShortDate(epochMs: number | null): string {
  if (!epochMs) return "—";
  return new Date(epochMs + 5.5 * 3600_000).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default async function PublicTallyBillPaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; voucherId: string }>;
  searchParams: Promise<{ exp?: string; sig?: string }>;
}) {
  const { workspaceId, voucherId } = await params;
  const sp = await searchParams;

  const view = await getPublicTallyBillPaymentView({
    workspaceId,
    voucherId,
    expiresAt: Number(sp.exp || 0),
    sig: sp.sig || "",
  });

  if (!view) {
    return (
      <main className="min-h-screen w-full bg-gray-50 px-4 py-12 sm:px-8">
        <div className="w-full rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="inline-flex items-center rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
            Link Expired or Invalid
          </div>
          <h1 className="mt-3 text-xl font-bold text-gray-900">
            This Tally Bill Payment Link Is No Longer Valid
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            For your security, signed bill payment links expire automatically. Please request a fresh
            bill or payment link on WhatsApp from the merchant.
          </p>
        </div>
      </main>
    );
  }

  const { workspace, voucher, upiUri, upiQrDataUrl, signedPdfUrl, nativePdfFilename } = view;
  const isSettled = voucher.balancePaise <= 0 || voucher.paymentStatus === "paid";

  return (
    <main className="min-h-screen w-full bg-gray-50 px-4 py-8 sm:px-8 lg:px-12">
      <div className="w-full space-y-6">
        {/* Top Merchant & Invoice Banner */}
        <header className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                Verified GST Bill • 0% Gateway Fee Direct UPI
              </span>
              {workspace.gstin && (
                <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs font-medium text-gray-700">
                  GSTIN: {workspace.gstin}
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              {workspace.legalName}
            </h1>
            {(workspace.addressLine || workspace.cityStatePin) && (
              <p className="text-xs text-gray-500">
                {[workspace.addressLine, workspace.cityStatePin].filter(Boolean).join(" • ")}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {signedPdfUrl && (
              <a
                href={signedPdfUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-xs font-semibold text-gray-800 shadow-xs hover:bg-gray-50"
              >
                Download Official Tally PDF{nativePdfFilename ? ` (${nativePdfFilename})` : ""}
              </a>
            )}
            <span
              className={`inline-flex items-center rounded-xl px-3.5 py-2 text-xs font-bold uppercase tracking-wide ${
                isSettled
                  ? "bg-emerald-100 text-emerald-800"
                  : voucher.paymentStatus === "partial"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-red-50 text-red-700 border border-red-200"
              }`}
            >
              {isSettled ? "Paid in Full" : `Balance Due: ${formatInr(voucher.balancePaise, { showDecimals: true })}`}
            </span>
          </div>
        </header>

        {/* Main 2-Column Fluid Grid */}
        <div className="grid w-full grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left 7 Cols: Invoice Summary & Line Items */}
          <section className="space-y-6 lg:col-span-7">
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 pb-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                    {voucher.voucherType} Voucher
                  </p>
                  <h2 className="text-xl font-bold text-gray-900">Bill #{voucher.voucherNumber}</h2>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500">Billed To</p>
                  <p className="text-sm font-bold text-gray-900">{voucher.partyName}</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="rounded-xl bg-gray-50 p-3">
                  <p className="text-[11px] font-medium text-gray-500">Bill Date</p>
                  <p className="mt-0.5 text-sm font-semibold text-gray-900">
                    {formatShortDate(voucher.voucherDate)}
                  </p>
                </div>
                <div className="rounded-xl bg-gray-50 p-3">
                  <p className="text-[11px] font-medium text-gray-500">Due Date</p>
                  <p className="mt-0.5 text-sm font-semibold text-gray-900">
                    {formatShortDate(voucher.dueDate)}
                  </p>
                </div>
                <div className="rounded-xl bg-gray-50 p-3">
                  <p className="text-[11px] font-medium text-gray-500">Total Bill Amount</p>
                  <p className="mt-0.5 text-sm font-bold text-gray-900">
                    {formatInr(voucher.amountPaise, { showDecimals: true })}
                  </p>
                </div>
                <div className="rounded-xl bg-emerald-50/70 p-3">
                  <p className="text-[11px] font-medium text-emerald-700">Paid So Far</p>
                  <p className="mt-0.5 text-sm font-bold text-emerald-800">
                    {formatInr(voucher.paidAmountPaise, { showDecimals: true })}
                  </p>
                </div>
              </div>

              {voucher.lineItems.length > 0 && (
                <div className="mt-6 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-gray-200 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                        <th className="py-2.5 pr-3">Item / Particular</th>
                        <th className="px-3 py-2.5">HSN/SAC</th>
                        <th className="px-3 py-2.5 text-right">Qty</th>
                        <th className="px-3 py-2.5 text-right">Rate</th>
                        <th className="pl-3 py-2.5 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {voucher.lineItems.map((li) => (
                        <tr key={li.id}>
                          <td className="py-3 pr-3 font-medium text-gray-900">{li.itemName}</td>
                          <td className="px-3 py-3 font-mono text-gray-600">{li.hsnCode || "—"}</td>
                          <td className="px-3 py-3 text-right text-gray-700">
                            {li.billedQty} {li.uom}
                          </td>
                          <td className="px-3 py-3 text-right text-gray-700">
                            {formatInr(li.ratePaise, { showDecimals: true })}
                          </td>
                          <td className="pl-3 py-3 text-right font-semibold text-gray-900">
                            {formatInr(li.amountPaise, { showDecimals: true })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {voucher.narration && (
                <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50/80 px-4 py-3 text-xs text-gray-600">
                  <span className="font-semibold text-gray-800">Remarks: </span>
                  {voucher.narration}
                </div>
              )}
            </div>
          </section>

          {/* Right 5 Cols: Instant UPI QR + NEFT/RTGS Details */}
          <aside className="space-y-6 lg:col-span-5">
            <div className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-gray-900">Instant UPI Payment</h3>
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                  GPay • PhonePe • Paytm • BHIM
                </span>
              </div>

              {isSettled ? (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
                  <p className="text-sm font-bold text-emerald-900">
                    Thank you! Bill #{voucher.voucherNumber} is marked Paid.
                  </p>
                  <p className="mt-1 text-xs text-emerald-700">
                    No remaining balance is pending on this Tally invoice.
                  </p>
                </div>
              ) : upiQrDataUrl && upiUri ? (
                <div className="mt-4 flex flex-col items-center text-center">
                  <div className="rounded-2xl border-2 border-gray-900/10 bg-white p-3 shadow-xs">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={upiQrDataUrl}
                      alt={`Scan to pay ${formatInr(voucher.balancePaise)} via UPI`}
                      className="h-56 w-56 object-contain"
                    />
                  </div>
                  <p className="mt-3 text-xs text-gray-500">
                    Paying <span className="font-bold text-gray-900">{workspace.upiPayeeName}</span>{" "}
                    (<span className="font-mono text-gray-800">{workspace.upiVpa}</span>)
                  </p>
                  <p className="mt-1 text-2xl font-extrabold text-emerald-700">
                    {formatInr(voucher.balancePaise, { showDecimals: true })}
                  </p>

                  <a
                    href={upiUri}
                    className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-700"
                  >
                    Pay {formatInr(voucher.balancePaise, { showDecimals: true })} in UPI App
                  </a>
                  <p className="mt-2 text-[11px] text-gray-500">
                    Direct NPCI bank-to-bank settlement • ₹0 convenience fee • Reference: Bill #
                    {voucher.voucherNumber}
                  </p>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                  Merchant UPI ID has not been added yet. Please use the NEFT/RTGS bank transfer
                  details below or contact {workspace.legalName}
                  {workspace.phone ? ` (${workspace.phone})` : ""}.
                </div>
              )}
            </div>

            {(workspace.bankAccountNumber || workspace.bankIfsc || workspace.bankName) && (
              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                <h3 className="text-sm font-bold text-gray-900">NEFT / RTGS / IMPS Bank Details</h3>
                <dl className="mt-3 space-y-2 text-xs">
                  <div className="flex justify-between gap-2 border-b border-gray-100 pb-2">
                    <dt className="text-gray-500">Beneficiary Name</dt>
                    <dd className="font-semibold text-gray-900">{workspace.legalName}</dd>
                  </div>
                  {workspace.bankName && (
                    <div className="flex justify-between gap-2 border-b border-gray-100 pb-2">
                      <dt className="text-gray-500">Bank & Branch</dt>
                      <dd className="font-semibold text-gray-900">
                        {[workspace.bankName, workspace.bankBranch].filter(Boolean).join(" — ")}
                      </dd>
                    </div>
                  )}
                  {workspace.bankAccountNumber && (
                    <div className="flex justify-between gap-2 border-b border-gray-100 pb-2">
                      <dt className="text-gray-500">Account Number</dt>
                      <dd className="font-mono font-bold text-gray-900">
                        {workspace.bankAccountNumber}
                      </dd>
                    </div>
                  )}
                  {workspace.bankIfsc && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-gray-500">IFSC Code</dt>
                      <dd className="font-mono font-bold text-gray-900">{workspace.bankIfsc}</dd>
                    </div>
                  )}
                </dl>
              </div>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
