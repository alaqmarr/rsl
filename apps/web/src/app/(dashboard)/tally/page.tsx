import { redirect } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  FileText,
  IndianRupee,
  Package,
  Search,
  Webhook,
} from "lucide-react";
import {
  getWorkspacePlansByKeys,
  hasActiveEntitlement,
  MIN_WALLET_BALANCE_PAISE,
  WALLET_OVERDRAFT_LIMIT_PAISE,
} from "@rsl/billing";
import { formatInr } from "@rsl/core";
import { canRoleAccessWebRoute, formatRoleLabel } from "@rsl/rbac";
import { LATEST_TALLY_TDL_VERSION } from "@rsl/tally";
import {
  AccessRestrictedState,
  ConfirmSubmitButton,
  EmptyWorkspaceState,
  MetricCard,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@rsl/ui";
import { ConfirmWhatsAppReminderButton } from "@/components/confirm-whatsapp-reminder";
import { ConfidentialityOtpBar } from "@/components/confidentiality-vault-card";
import { FeaturePlanGate } from "@/components/feature-plan-gate";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { TallyLiveSyncBar } from "@/components/tally-live-sync-bar";
import { TallySuiteNav } from "@/components/tally-suite-nav";
import {
  markTallyBillPaidAction,
  rotatePublicBillLinksAction,
  sendBillWhatsAppAction,
} from "@/lib/actions";
import { requireWebSession } from "@/lib/session";
import { loadTallyPageContext } from "@/lib/tally-data";

export default async function TallyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;

  if (sp.tab === "connect" || sp.pairingCode) {
    redirect(
      `/connections/tally${sp.pairingCode ? `?pairingCode=${encodeURIComponent(sp.pairingCode)}` : ""}`
    );
  }
  if (sp.tab === "rules") {
    redirect(`/tally/automation${sp.company ? `?company=${encodeURIComponent(sp.company)}` : ""}`);
  }
  if (sp.tab === "import") {
    redirect(`/tally/import${sp.company ? `?company=${encodeURIComponent(sp.company)}` : ""}`);
  }

  const session = await requireWebSession();

  if (!canRoleAccessWebRoute(session.roleSlug, "/tally", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Tally Prime Bills & Receipts"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View Tally bills & aging"
        homeHref="/inbox"
        homeLabel="Go to Customer Messages"
      />
    );
  }

  if (!hasActiveEntitlement(session.workspace.id, "tally.sync")) {
    const plans = getWorkspacePlansByKeys(session.workspace.id, ["tally.sync", "tally.invoicing"]);
    return (
      <FeaturePlanGate
        pageTitle="Tally Prime Real-Time Sync & Automated WhatsApp Invoicing"
        pageSubtitle="Connect Tally Prime to auto-sync sales bills, payment receipts, credit notes, and native Tally-printed PDFs on every voucher save."
        plans={plans}
        returnPath="/tally"
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  const ctx = await loadTallyPageContext({
    workspaceId: session.workspace.id,
    workspaceName: session.workspace.name,
    workspaceSlug: session.workspace.slug,
    userId: session.user.id,
    roleSlug: session.roleSlug,
    defaultTallyCompany: session.workspace.defaultTallyCompany,
    companyParam: sp.company,
  });

  const {
    tally,
    endpoints,
    localPortProbe,
    outdatedTdl,
    walletBalancePaise,
    walletAvailableSpendPaise,
    isWalletOverdraftExhausted,
    selectedCompanyId,
    companyScopedVouchers,
    activeRulesCount,
    overviewTone,
    canManageTally,
    canSendTallyWhatsApp,
    hasInvoicingEntitlement,
    tdlFilename,
    tallyBrandTitle,
    topTdlDownloadHref,
    topConnectorDownloadHref,
  } = ctx;

  const companyNameById = new Map(tally.companies.map((c) => [c.id, c.name]));

  const scopedTotalBilledPaise = companyScopedVouchers
    .filter((v) => v.voucherType === "Sales" && v.paymentStatus !== "cancelled")
    .reduce((sum, v) => sum + v.amountPaise, 0);
  const scopedTotalCollectedPaise = companyScopedVouchers
    .filter((v) => v.paymentStatus !== "cancelled")
    .reduce(
      (sum, v) =>
        sum +
        (v.voucherType === "Receipt"
          ? v.amountPaise
          : v.voucherType === "Sales"
            ? v.directPaidPaise
            : 0),
      0
    );
  const scopedTotalPendingPaise = companyScopedVouchers
    .filter((v) => v.voucherType === "Sales" && v.paymentStatus !== "cancelled")
    .reduce((sum, v) => sum + Math.max(0, v.amountPaise - v.paidAmountPaise), 0);

  const nowMs = Date.now();
  const billStatusFilter =
    sp.status === "overdue" ||
    sp.status === "unpaid" ||
    sp.status === "paid" ||
    sp.status === "cancelled"
      ? sp.status
      : "all";
  const billQuery = sp.q?.trim() || "";

  const overdueCount = companyScopedVouchers.filter((v) => {
    if (v.paymentStatus === "cancelled") return false;
    const bal = Math.max(0, v.amountPaise - v.paidAmountPaise);
    return bal > 0 && v.dueDate !== null && v.dueDate < nowMs;
  }).length;
  const unpaidCount = companyScopedVouchers.filter((v) => {
    if (v.paymentStatus === "cancelled") return false;
    return Math.max(0, v.amountPaise - v.paidAmountPaise) > 0;
  }).length;
  const paidCount = companyScopedVouchers.filter((v) => v.paymentStatus === "paid").length;
  const cancelledCount = companyScopedVouchers.filter((v) => v.paymentStatus === "cancelled").length;

  const filteredVouchers = tally.vouchers.filter((v) => {
    const isCancelled = v.paymentStatus === "cancelled";
    const bal = isCancelled ? 0 : Math.max(0, v.amountPaise - v.paidAmountPaise);
    const isOverdue = !isCancelled && bal > 0 && v.dueDate !== null && v.dueDate < nowMs;
    if (selectedCompanyId !== "all" && v.companyId !== selectedCompanyId) return false;
    if (billStatusFilter === "overdue" && !isOverdue) return false;
    if (billStatusFilter === "unpaid" && (isCancelled || bal <= 0)) return false;
    if (billStatusFilter === "paid" && v.paymentStatus !== "paid") return false;
    if (billStatusFilter === "cancelled" && !isCancelled) return false;
    if (billQuery) {
      const qLower = billQuery.toLowerCase();
      const compName = companyNameById.get(v.companyId) ?? "";
      const hay =
        `${v.voucherNumber} ${v.partyName} ${v.partyPhoneE164 ?? ""} ${v.voucherType} ${compName}`.toLowerCase();
      if (!hay.includes(qLower)) return false;
    }
    return true;
  });

  const currentBillsBaseReturnPath = `/tally?${
    billStatusFilter !== "all" ? `status=${billStatusFilter}&` : ""
  }${selectedCompanyId !== "all" ? `company=${encodeURIComponent(selectedCompanyId)}&` : ""}${
    billQuery ? `q=${encodeURIComponent(billQuery)}&` : ""
  }`.replace(/[?&]$/, "");

  const BILLS_PAGE_SIZE = 50;
  const totalBillPages = Math.max(1, Math.ceil(filteredVouchers.length / BILLS_PAGE_SIZE));
  const rawBillsPage = Math.max(1, Number.parseInt(sp.page || "1", 10) || 1);
  const currentBillsPage = Math.min(rawBillsPage, totalBillPages);
  const pagedVouchers = filteredVouchers.slice(
    (currentBillsPage - 1) * BILLS_PAGE_SIZE,
    currentBillsPage * BILLS_PAGE_SIZE
  );
  const currentBillsReturnPath =
    currentBillsPage > 1
      ? `${currentBillsBaseReturnPath}${currentBillsBaseReturnPath.includes("?") ? "&" : "?"}page=${currentBillsPage}`
      : currentBillsBaseReturnPath;

  return (
    <div className="w-full space-y-6">
      <TallySuiteNav
        activeSection="vouchers"
        vouchersCount={companyScopedVouchers.length}
        rulesCount={activeRulesCount}
        partiesCount={tally.totals.partiesCount}
        stockItemsCount={tally.totals.stockItemsCount}
        companies={tally.companies}
        selectedCompanyId={selectedCompanyId}
      />

      <PageHeader
        eyebrow="Meta -> WhatsApp -> Tally Integration"
        badge={
          <StatusPill
            label={tally.connectionOverview.overallLabel}
            tone={overviewTone}
          />
        }
        title="Tally Prime Bills & Receipts"
        subtitle={`Real-time voucher sync on ${endpoints.primaryDomain} with "${tallyBrandTitle}" inside Tally Prime`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canManageTally && (
              <a href={topTdlDownloadHref} className="rsl-btn-primary">
                Download {tdlFilename} (v{LATEST_TALLY_TDL_VERSION})
              </a>
            )}
            {tally.vouchers.length > 0 && (
              <details className="relative">
                <summary className="rsl-btn-secondary cursor-pointer list-none select-none">
                  Export Register ▾
                </summary>
                <div className="rsl-drawer-frost absolute right-0 z-20 mt-1.5 flex w-56 flex-col gap-1 rounded-xl border p-1.5 text-xs">
                  <a
                    href="/api/pdf/tally-receivables"
                    className="rounded-lg px-3 py-2 font-medium text-[var(--ink)] hover:bg-[var(--surface-inset)]"
                  >
                    Download Receivables PDF
                  </a>
                  <a
                    href="/api/export/party-ledgers-csv"
                    className="rounded-lg px-3 py-2 font-medium text-[var(--ink)] hover:bg-[var(--surface-inset)]"
                  >
                    Export Client Ledgers CSV
                  </a>
                  <a
                    href="/api/export/tally-xml"
                    className="rounded-lg px-3 py-2 font-medium text-[var(--ink)] hover:bg-[var(--surface-inset)]"
                  >
                    Export Tally Prime XML
                  </a>
                  <a
                    href="/api/export/tally-csv"
                    className="rounded-lg px-3 py-2 font-medium text-[var(--ink)] hover:bg-[var(--surface-inset)]"
                  >
                    Export Bills CSV
                  </a>
                </div>
              </details>
            )}
            {canManageTally && (
              <ActionLink href={topConnectorDownloadHref} className="rsl-btn-secondary">
                Windows Connector
              </ActionLink>
            )}
          </div>
        }
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <ConfidentialityOtpBar
        isMasked={tally.confidentiality.isMasked}
        unmaskActive={tally.confidentiality.unmaskActive}
        unmaskExpiresAt={tally.confidentiality.unmaskExpiresAt}
        policy={tally.confidentiality.policy}
      />

      {walletBalancePaise < 0 && (
        <div
          className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-5 py-3.5 text-xs shadow-2xs ${
            isWalletOverdraftExhausted
              ? "border-[var(--danger)]/30 bg-[var(--danger-surface)] text-[var(--danger)]"
              : "border-[var(--warning)]/30 bg-[var(--warning-surface)] text-[var(--warning)]"
          }`}
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-bold">
                Prepaid Wallet:{" "}
                <span className="font-mono tabular-nums">
                  {formatInr(walletBalancePaise, { showDecimals: true })}
                </span>{" "}
                ({isWalletOverdraftExhausted ? "Overdraft Limit Reached" : "Overdraft Active"})
              </div>
              <p className="mt-0.5 opacity-90">
                {isWalletOverdraftExhausted
                  ? `Reached ${formatInr(MIN_WALLET_BALANCE_PAISE, { showDecimals: true })} overdraft cap. Tally bills still sync, while WhatsApp dispatches wait for recharge.`
                  : `${formatInr(walletAvailableSpendPaise, { showDecimals: true })} of ${formatInr(WALLET_OVERDRAFT_LIMIT_PAISE)} overdraft credit remaining.`}
              </p>
            </div>
          </div>
          <ActionLink href="/billing/wallet" spinnerSize="xs" className="rsl-btn-secondary text-xs">
            Recharge Wallet
          </ActionLink>
        </div>
      )}

      <TallyLiveSyncBar
        workspaceName={session.workspace.name}
        vouchersCount={tally.vouchers.length}
        eventsReceivedCount={tally.webhookEndpoint.eventsReceivedCount}
        lastEventAt={tally.webhookEndpoint.lastEventAt}
        lastErrorAt={tally.webhookEndpoint.lastErrorAt}
        lastErrorMessage={tally.webhookEndpoint.lastErrorMessage}
        lastUserAgent={tally.webhookEndpoint.lastUserAgent}
        latestVoucherUpdatedAt={tally.latestVoucherUpdatedAt}
        nativePdfCount={tally.totals.nativePdfCount}
        outdatedTdl={outdatedTdl}
        isLocalDev={endpoints.isLocalDev}
        canManageTally={canManageTally}
        localPortProbe={
          localPortProbe
            ? {
                reachable: localPortProbe.reachable,
                port: localPortProbe.port,
                activeCompanyName: localPortProbe.activeCompanyName,
                voucherCount: localPortProbe.voucherCount,
              }
            : null
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total Sales Billed"
          value={formatInr(scopedTotalBilledPaise)}
          sublabel={`${companyScopedVouchers.length} vouchers • ${tally.totals.nativePdfCount} native PDF(s)`}
          icon={<FileSpreadsheet className="h-4 w-4" />}
        />
        <MetricCard
          label="Total Collected"
          value={formatInr(scopedTotalCollectedPaise)}
          sublabel="Paid bills & receipts"
          accent="emerald"
          icon={<IndianRupee className="h-4 w-4" />}
        />
        <MetricCard
          label="Pending Balance"
          value={formatInr(scopedTotalPendingPaise)}
          sublabel={`${overdueCount} overdue sales bills`}
          accent={scopedTotalPendingPaise > 0 ? "amber" : "default"}
          icon={<Clock className="h-4 w-4" />}
        />
        <MetricCard
          label="Live Tally Sync"
          value={tally.webhookLiveStatus.label}
          sublabel={`${tally.connectionOverview.connectedPcCount}/${tally.devices.length} PC live`}
          accent={tally.connectionOverview.overallState === "live_connected" ? "emerald" : "sky"}
        />
      </div>

      <SectionCard
        title={`Bills & Receipts Register (${filteredVouchers.length})`}
        subtitle="Send untouched Tally-printed PDFs on WhatsApp, track Paid settlements, and open bill details"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {canManageTally && (
              <ActionLink href="/tally/import" spinnerSize="xs" className="rsl-btn-secondary text-xs">
                + Add / Import Bills
              </ActionLink>
            )}
            <ActionLink href="/tally/automation" spinnerSize="xs" className="rsl-btn-secondary text-xs">
              Auto-Send Rules ({activeRulesCount})
            </ActionLink>
          </div>
        }
        noPadding
      >
        {tally.vouchers.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-inset)] px-6 py-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { key: "all", label: `All (${companyScopedVouchers.length})`, show: true },
                  { key: "overdue", label: `Overdue (${overdueCount})`, show: true },
                  { key: "unpaid", label: `Pending (${unpaidCount})`, show: true },
                  { key: "paid", label: `Paid (${paidCount})`, show: true },
                  {
                    key: "cancelled",
                    label: `Cancelled (${cancelledCount})`,
                    show: cancelledCount > 0 || billStatusFilter === "cancelled",
                  },
                ] as const
              )
                .filter((p) => p.show)
                .map((pill) => {
                  const active = billStatusFilter === pill.key;
                  const params = new URLSearchParams();
                  if (pill.key !== "all") params.set("status", pill.key);
                  if (selectedCompanyId !== "all") params.set("company", selectedCompanyId);
                  if (billQuery) params.set("q", billQuery);
                  const qs = params.toString();
                  const href = qs ? `/tally?${qs}` : "/tally";
                  return (
                    <ActionLink
                      key={pill.key}
                      href={href}
                      spinnerSize="xs"
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                        active
                          ? "bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] shadow-xs"
                          : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink-secondary)] hover:text-[var(--ink)]"
                      }`}
                    >
                      {pill.label}
                    </ActionLink>
                  );
                })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <form method="get" action="/tally" className="flex flex-wrap items-center gap-2">
                {billStatusFilter !== "all" && (
                  <input type="hidden" name="status" value={billStatusFilter} />
                )}
                {tally.companies.length > 1 && (
                  <select
                    name="company"
                    defaultValue={selectedCompanyId}
                    className="rsl-input w-auto py-1.5 text-xs"
                  >
                    <option value="all">All Companies ({tally.companies.length})</option>
                    {tally.companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
                <div className="relative min-w-[220px]">
                  <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-muted)]" />
                  <input
                    name="q"
                    defaultValue={billQuery}
                    placeholder="Search bill #, party, or company..."
                    className="rsl-input py-1.5 pl-8 text-xs"
                  />
                </div>
                <SubmitButton
                  spinnerSize="xs"
                  pendingText="Filtering..."
                  className="rsl-btn-secondary py-1.5 text-xs"
                >
                  Filter
                </SubmitButton>
                {(billQuery || billStatusFilter !== "all" || selectedCompanyId !== "all") && (
                  <ActionLink href="/tally" spinnerSize="xs" className="rsl-btn-secondary py-1.5 text-xs">
                    Reset
                  </ActionLink>
                )}
              </form>

              {canManageTally && (
                <form action={rotatePublicBillLinksAction} className="inline-flex">
                  <input type="hidden" name="returnPath" value={currentBillsReturnPath} />
                  <ConfirmSubmitButton
                    confirmMessage="Rotate and revoke all previously shared public Tally bill links?"
                    className="rsl-btn-danger-soft py-1.5 text-xs"
                  >
                    Rotate Public Links
                  </ConfirmSubmitButton>
                </form>
              )}
            </div>
          </div>
        )}

        {tally.vouchers.length === 0 ? (
          <div className="p-6">
            <EmptyWorkspaceState
              title="No Tally bills or receipts yet"
              description={`Connect Tally Prime via ${tdlFilename} (v${LATEST_TALLY_TDL_VERSION}), pair the Windows Connector, or upload an XML/CSV export to begin.`}
              actionLabel={canManageTally ? "Connect Tally Prime" : "View Connection Guide"}
              actionHref="/connections/tally"
              icon={<Webhook className="h-5 w-5" />}
            />
          </div>
        ) : filteredVouchers.length === 0 ? (
          <div className="p-8 text-center text-xs text-[var(--ink-muted)]">
            No Tally bills or receipts match your current filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--border)] bg-[var(--surface-inset)] text-xs font-semibold tracking-wide text-[var(--ink-muted)] uppercase">
                <tr>
                  <th className="px-6 py-3">Bill # &amp; Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Client / Supplier Ledger</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Balance Due</th>
                  <th className="px-4 py-3">Status &amp; PDF</th>
                  <th className="px-6 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--surface)]">
                {pagedVouchers.map((v) => {
                  const isCancelled = v.paymentStatus === "cancelled";
                  const isBillType = v.voucherType === "Sales" || v.voucherType === "Purchase";
                  const balance =
                    isCancelled || !isBillType
                      ? 0
                      : Math.max(0, v.amountPaise - v.paidAmountPaise);
                  const isOverdue =
                    !isCancelled && isBillType && balance > 0 && v.dueDate !== null && v.dueDate < nowMs;
                  const compName = companyNameById.get(v.companyId) ?? null;
                  return (
                    <tr
                      key={v.id}
                      className={`hover:bg-[var(--surface-inset)]/60 ${isCancelled ? "opacity-65" : ""}`}
                    >
                      <td className="px-6 py-3.5">
                        <ActionLink
                          href={`/tally/vouchers/${encodeURIComponent(v.id)}`}
                          spinnerSize="xs"
                          className={`font-mono font-bold hover:text-[var(--brand)] hover:underline ${
                            isCancelled ? "text-[var(--ink-muted)] line-through" : "text-[var(--ink)]"
                          }`}
                        >
                          #{v.voucherNumber}
                        </ActionLink>
                        <div className="text-xs text-[var(--ink-muted)]">
                          {new Date(v.voucherDate).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                            timeZone: "Asia/Kolkata",
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 font-medium text-[var(--ink-secondary)]">
                        {v.voucherType}
                      </td>
                      <td className="px-4 py-3.5">
                        {v.partyId ? (
                          <ActionLink
                            href={`/tally/parties/${encodeURIComponent(v.partyId)}`}
                            spinnerSize="xs"
                            className="font-semibold text-[var(--ink)] hover:text-[var(--brand)] hover:underline"
                          >
                            {v.partyName}
                          </ActionLink>
                        ) : (
                          <div className="font-semibold text-[var(--ink)]">{v.partyName}</div>
                        )}
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--ink-muted)]">
                          <span>{v.partyPhoneE164 || "No phone"}</span>
                          {compName && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-inset)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--ink-secondary)]">
                              <Building2 className="h-2.5 w-2.5" />
                              {compName}
                            </span>
                          )}
                        </div>
                        {v.lineItems && v.lineItems.length > 0 && (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {v.lineItems.slice(0, 2).map((li, idx) => (
                              <span
                                key={`${v.id}-li-${idx}`}
                                className="inline-flex items-center gap-1 rounded-md border border-[var(--brand)]/20 bg-[var(--brand-surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--brand)]"
                              >
                                <Package className="h-2.5 w-2.5" />
                                {li.itemName} ({li.billedQty} {li.uom})
                              </span>
                            ))}
                            {v.lineItems.length > 2 && (
                              <span className="text-[10px] text-[var(--ink-muted)]">
                                +{v.lineItems.length - 2} more
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right tabular-nums text-[var(--ink-secondary)]">
                        {formatInr(v.amountPaise)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-bold tabular-nums text-[var(--ink)]">
                        {isBillType ? formatInr(balance) : "-"}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusPill
                            label={
                              isCancelled
                                ? "Cancelled"
                                : isOverdue
                                  ? "Overdue"
                                  : v.paymentStatus
                            }
                            tone={
                              isCancelled
                                ? "stone"
                                : v.paymentStatus === "paid"
                                  ? "emerald"
                                  : isOverdue
                                    ? "ruby"
                                    : "amber"
                            }
                          />
                          {v.hasNativePdf && !isCancelled && (
                            <a
                              href={`/api/pdf/tally-voucher-native?voucherId=${encodeURIComponent(v.id)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border border-[var(--brand)]/25 bg-[var(--brand-surface)] px-2 py-0.5 text-[10px] font-semibold text-[var(--brand)]"
                            >
                              <FileText className="h-2.5 w-2.5" />
                              <span>Tally PDF</span>
                            </a>
                          )}
                          {v.whatsappInvoiceSentAt && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--brand)]">
                              <CheckCircle2 className="h-3 w-3" />
                              <span>Sent</span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                          <ActionLink
                            href={`/tally/vouchers/${encodeURIComponent(v.id)}`}
                            spinnerSize="xs"
                            className="rsl-btn-secondary py-1 px-2.5 text-[11px]"
                          >
                            Details
                          </ActionLink>
                          {!isCancelled && canManageTally && isBillType && balance > 0 && (
                            <form action={markTallyBillPaidAction} className="inline-flex">
                              <input type="hidden" name="voucherId" value={v.id} />
                              <input type="hidden" name="returnPath" value={currentBillsReturnPath} />
                              <SubmitButton
                                spinnerSize="xs"
                                pendingText="Marking..."
                                className="rsl-btn-secondary py-1 px-2.5 text-[11px]"
                              >
                                Mark Paid
                              </SubmitButton>
                            </form>
                          )}
                          {!isCancelled &&
                            v.voucherType === "Sales" &&
                            canSendTallyWhatsApp &&
                            hasInvoicingEntitlement &&
                            v.partyPhoneE164 && (
                              <>
                                <form action={sendBillWhatsAppAction} className="inline-flex">
                                  <input type="hidden" name="voucherId" value={v.id} />
                                  <input type="hidden" name="sendKind" value="invoice" />
                                  <input
                                    type="hidden"
                                    name="returnPath"
                                    value={currentBillsReturnPath}
                                  />
                                  <SubmitButton
                                    spinnerSize="xs"
                                    pendingText="Sending..."
                                    className="rsl-btn-secondary py-1 px-2.5 text-[11px]"
                                  >
                                    {v.hasNativePdf ? "Send Tally PDF" : "Send Bill"}
                                  </SubmitButton>
                                </form>
                                {balance > 0 && (
                                  <ConfirmWhatsAppReminderButton
                                    voucherId={v.id}
                                    voucherNumber={v.voucherNumber}
                                    partyName={v.partyName}
                                    partyPhoneE164={v.partyPhoneE164}
                                    balanceFormatted={formatInr(balance)}
                                    action={sendBillWhatsAppAction}
                                    returnPath={currentBillsReturnPath}
                                    buttonLabel={`Remind (${v.remindersSentCount})`}
                                    buttonClassName="rsl-btn-primary py-1 px-2.5 text-[11px]"
                                  />
                                )}
                              </>
                            )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {totalBillPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] bg-[var(--surface-inset)] px-6 py-3 text-xs text-[var(--ink-secondary)]">
                <span className="tabular-nums">
                  Showing {(currentBillsPage - 1) * BILLS_PAGE_SIZE + 1}–
                  {Math.min(currentBillsPage * BILLS_PAGE_SIZE, filteredVouchers.length)} of{" "}
                  {filteredVouchers.length.toLocaleString("en-IN")} vouchers (Page {currentBillsPage}{" "}
                  of {totalBillPages})
                </span>
                <div className="flex items-center gap-2">
                  {currentBillsPage > 1 ? (
                    <ActionLink
                      href={`${currentBillsBaseReturnPath}${currentBillsBaseReturnPath.includes("?") ? "&" : "?"}page=${currentBillsPage - 1}`}
                      spinnerSize="xs"
                      className="rsl-btn-secondary py-1 text-xs"
                    >
                      ← Previous
                    </ActionLink>
                  ) : (
                    <span className="rounded-lg border border-[var(--border)] px-3 py-1 text-[var(--ink-muted)]">
                      ← Previous
                    </span>
                  )}
                  {currentBillsPage < totalBillPages ? (
                    <ActionLink
                      href={`${currentBillsBaseReturnPath}${currentBillsBaseReturnPath.includes("?") ? "&" : "?"}page=${currentBillsPage + 1}`}
                      spinnerSize="xs"
                      className="rsl-btn-secondary py-1 text-xs"
                    >
                      Next →
                    </ActionLink>
                  ) : (
                    <span className="rounded-lg border border-[var(--border)] px-3 py-1 text-[var(--ink-muted)]">
                      Next →
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
