import { headers } from "next/headers";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  FileText,
  IndianRupee,
  Search,
  Webhook,
} from "lucide-react";
import {
  getWalletAvailableSpendPaise,
  getWalletBalancePaise,
  getWorkspacePlansByKeys,
  hasActiveEntitlement,
  MIN_WALLET_BALANCE_PAISE,
  WALLET_OVERDRAFT_LIMIT_PAISE,
} from "@rsl/billing";
import { formatInr, resolveEndpointsFromHeaders } from "@rsl/core";
import { ensureWorkspaceSslProvisioned } from "@rsl/queue";
import { canRoleAccessWebRoute, canRolePerform, formatRoleLabel } from "@rsl/rbac";
import {
  detectOutdatedTdlVersion,
  getTallyWorkspaceSummary,
  probeLocalTallyPort9000,
} from "@rsl/tally";
import {
  AccessRestrictedState,
  EmptyWorkspaceState,
  MetricCard,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@rsl/ui";
import { ConfirmWhatsAppReminderButton } from "@/components/confirm-whatsapp-reminder";
import { FeaturePlanGate, InlineAddonPlanBanner } from "@/components/feature-plan-gate";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { TallyConnectStudio } from "@/components/tally-connect-studio";
import { TallyLiveSyncBar } from "@/components/tally-live-sync-bar";
import {
  createTallyAutomationAction,
  deleteReminderRuleAction,
  deleteTallyAutomationAction,
  generatePairingCodeAction,
  importTallyFileAction,
  installStarterTemplatesAction,
  recordTallyVoucherAction,
  runDueTallyRemindersAction,
  saveReminderRuleAction,
  sendBillWhatsAppAction,
  toggleTallyAutomationAction,
} from "@/lib/actions";
import { requireWebSession } from "@/lib/session";

export default async function TallySyncPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/tally", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Tally Prime & Bills"
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
        pageTitle="Tally Prime Bills, Webhook & Automatic WhatsApp"
        pageSubtitle="Sync Tally Prime sales bills, receipts, and overdue customer balances automatically — and send your exact Tally-printed PDF invoices on WhatsApp."
        plans={plans}
        returnPath="/tally"
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  const canManageTally = canRolePerform(
    session.roleSlug,
    "tally:sync.manage",
    session.workspace.id
  );
  const canSendTallyWhatsApp = canRolePerform(
    session.roleSlug,
    "tally:invoice.send",
    session.workspace.id
  );

  const requestedTab =
    sp.tab === "connect" || sp.tab === "rules" || sp.tab === "import"
      ? sp.tab
      : sp.pairingCode && canManageTally
        ? "connect"
        : "bills";
  const activeTab = requestedTab === "import" && !canManageTally ? "bills" : requestedTab;

  const hasInvoicingEntitlement = hasActiveEntitlement(session.workspace.id, "tally.invoicing");
  const invoicingPlan = getWorkspacePlansByKeys(session.workspace.id, ["tally.invoicing"])[0];

  const hdrs = await headers();
  const endpoints = resolveEndpointsFromHeaders(hdrs, {
    workspaceSlug: session.workspace.slug,
  });

  const [tally, sslRecords, walletBalancePaise] = await Promise.all([
    Promise.resolve(getTallyWorkspaceSummary(session.workspace.id)),
    ensureWorkspaceSslProvisioned(session.workspace.id, session.workspace.slug),
    Promise.resolve(getWalletBalancePaise(session.workspace.id)),
  ]);

  const outdatedTdl = detectOutdatedTdlVersion(tally.webhookEndpoint.lastUserAgent);
  const localPortProbe = endpoints.isLocalDev ? await probeLocalTallyPort9000(9000) : null;
  const walletAvailableSpendPaise = getWalletAvailableSpendPaise(walletBalancePaise);
  const isWalletOverdraftExhausted = walletBalancePaise <= MIN_WALLET_BALANCE_PAISE;

  const companyNameById = new Map(tally.companies.map((c) => [c.id, c.name]));
  const knownCompanyNames = Array.from(
    new Set(
      [
        ...tally.companies.map((c) => c.name),
        ...(localPortProbe?.openCompanies ?? []),
        ...tally.devices
          .map((d) => d.activeCompanyName)
          .filter((name): name is string => Boolean(name && name.trim())),
        ...(session.workspace.defaultTallyCompany ? [session.workspace.defaultTallyCompany] : []),
      ].filter(Boolean)
    )
  );

  const todayIso = new Date().toISOString().slice(0, 10);
  const approvedTemplates = tally.templates.filter((t) => t.approvalStatus === "APPROVED");
  const hasNativePdfTemplate = approvedTemplates.some((t) => t.name === "tally_tax_invoice_pdf");
  const activeRulesCount = tally.automationRules.filter((r) => r.active).length;
  const overviewTone =
    tally.connectionOverview.overallTone === "success"
      ? "emerald"
      : tally.connectionOverview.overallTone === "info"
        ? "sky"
        : tally.connectionOverview.overallTone === "danger"
          ? "ruby"
          : "amber";

  const billStatusFilter =
    sp.status === "overdue" ||
    sp.status === "unpaid" ||
    sp.status === "paid" ||
    sp.status === "cancelled"
      ? sp.status
      : "all";
  const selectedCompanyId =
    sp.company && tally.companies.some((c) => c.id === sp.company) ? sp.company : "all";
  const billQuery = sp.q?.trim() || "";
  const nowMs = Date.now();

  const overdueCount = tally.vouchers.filter((v) => {
    if (v.paymentStatus === "cancelled") return false;
    const bal = Math.max(0, v.amountPaise - v.paidAmountPaise);
    return bal > 0 && v.dueDate !== null && v.dueDate < nowMs;
  }).length;
  const unpaidCount = tally.vouchers.filter((v) => {
    if (v.paymentStatus === "cancelled") return false;
    return Math.max(0, v.amountPaise - v.paidAmountPaise) > 0;
  }).length;
  const paidCount = tally.vouchers.filter((v) => v.paymentStatus === "paid").length;
  const cancelledCount = tally.vouchers.filter((v) => v.paymentStatus === "cancelled").length;

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

  const currentBillsReturnPath = `/tally?tab=bills${
    billStatusFilter !== "all" ? `&status=${billStatusFilter}` : ""
  }${selectedCompanyId !== "all" ? `&company=${encodeURIComponent(selectedCompanyId)}` : ""}${
    billQuery ? `&q=${encodeURIComponent(billQuery)}` : ""
  }`;

  const topTdlDownloadHref = endpoints.isLocalDev
    ? "/api/export/tally-tdl?target=local"
    : "/api/export/tally-tdl";
  const topConnectorDownloadHref = endpoints.isLocalDev
    ? "/api/export/tally-connector?target=local"
    : "/api/export/tally-connector";

  const navTabs = [
    {
      key: "bills" as const,
      label: `Bills & Receipts (${tally.vouchers.length})`,
    },
    {
      key: "connect" as const,
      label: "Connect Tally Prime (.tdl & Webhook)",
    },
    {
      key: "rules" as const,
      label: `WhatsApp Rules & Reminders (${activeRulesCount})`,
    },
    ...(canManageTally
      ? [
          {
            key: "import" as const,
            label: "Add Bill / Import XML & CSV",
          },
        ]
      : []),
  ];

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Tally Prime & Collections"
        badge={
          <StatusPill
            label={tally.connectionOverview.overallLabel}
            tone={overviewTone}
          />
        }
        title="Tally Prime Bills & Automatic WhatsApp"
        subtitle={`Sync Tally Prime sales bills, receipts, cancellations, and deletions to ${endpoints.primaryDomain} — and send your exact Tally-printed PDF invoice on WhatsApp automatically.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canManageTally && (
              <>
                <a href={topTdlDownloadHref} className="rsl-btn-primary">
                  Download Tally Add-On (.tdl v2.5)
                </a>
                <a href={topConnectorDownloadHref} className="rsl-btn-secondary">
                  Download Windows Connector
                </a>
              </>
            )}
            {tally.vouchers.length > 0 && (
              <details className="relative">
                <summary className="rsl-btn-secondary cursor-pointer list-none select-none">
                  Export Register ▾
                </summary>
                <div className="absolute right-0 z-20 mt-1.5 flex w-52 flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-1.5 text-xs shadow-lg">
                  <a
                    href="/api/pdf/tally-receivables"
                    className="rounded-lg px-3 py-2 font-medium text-slate-800 hover:bg-zinc-50"
                  >
                    Download Receivables PDF
                  </a>
                  <a
                    href="/api/export/tally-xml"
                    className="rounded-lg px-3 py-2 font-medium text-slate-800 hover:bg-zinc-50"
                  >
                    Export Tally Prime XML
                  </a>
                  <a
                    href="/api/export/tally-csv"
                    className="rounded-lg px-3 py-2 font-medium text-slate-800 hover:bg-zinc-50"
                  >
                    Export Bills CSV
                  </a>
                </div>
              </details>
            )}
            {canManageTally && (
              <form action={generatePairingCodeAction}>
                <SubmitButton pendingText="Generating..." className="rsl-btn-secondary">
                  Pair Office PC
                </SubmitButton>
              </form>
            )}
          </div>
        }
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      {walletBalancePaise < 0 && (
        <div
          className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-5 py-3.5 text-xs shadow-2xs ${
            isWalletOverdraftExhausted
              ? "border-rose-200 bg-rose-50/85 text-rose-950"
              : "border-amber-200 bg-amber-50/85 text-amber-950"
          }`}
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle
              className={`mt-0.5 h-4 w-4 shrink-0 ${
                isWalletOverdraftExhausted ? "text-rose-600" : "text-amber-600"
              }`}
            />
            <div>
              <div className="font-bold">
                Prepaid Wallet Balance:{" "}
                <span className="font-mono tabular-nums">
                  {formatInr(walletBalancePaise, { showDecimals: true })}
                </span>{" "}
                ({isWalletOverdraftExhausted ? "Overdraft Limit Reached" : "Negative Overdraft Active"})
              </div>
              <p className="mt-0.5 opacity-90">
                {isWalletOverdraftExhausted
                  ? `Your wallet has reached the ${formatInr(MIN_WALLET_BALANCE_PAISE, { showDecimals: true })} overdraft limit. Tally bills continue syncing live, while outbound WhatsApp sends pause until you top up.`
                  : `WhatsApp invoices and reminders continue sending seamlessly down to ${formatInr(MIN_WALLET_BALANCE_PAISE, { showDecimals: true })} (${formatInr(walletAvailableSpendPaise, { showDecimals: true })} of ${formatInr(WALLET_OVERDRAFT_LIMIT_PAISE)} overdraft credit remaining).`}
              </p>
            </div>
          </div>
          <ActionLink href="/billing?tab=wallet" spinnerSize="xs" className="rsl-btn-secondary text-xs">
            Recharge Wallet
          </ActionLink>
        </div>
      )}

      <TallyLiveSyncBar
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
          value={formatInr(tally.totals.totalBilledPaise)}
          sublabel={`${tally.vouchers.length} synced bills • ${tally.totals.nativePdfCount} exact Tally PDF(s)`}
          icon={<FileSpreadsheet className="h-4 w-4" />}
        />
        <MetricCard
          label="Total Collected"
          value={formatInr(tally.totals.totalCollectedPaise)}
          sublabel="Paid bills & payment receipts"
          accent="emerald"
          icon={<IndianRupee className="h-4 w-4" />}
        />
        <MetricCard
          label="Pending Customer Balance"
          value={formatInr(tally.totals.totalPendingPaise)}
          sublabel="Unpaid & partially paid sales bills"
          accent={tally.totals.totalPendingPaise > 0 ? "amber" : "default"}
          icon={<Clock className="h-4 w-4" />}
        />
        <MetricCard
          label="Live Tally Connection"
          value={tally.webhookLiveStatus.label}
          sublabel={`${tally.webhookEndpoint.eventsReceivedCount} webhook • ${tally.connectionOverview.connectedPcCount}/${tally.devices.length} PC live`}
          accent={
            tally.connectionOverview.overallState === "live_connected"
              ? "emerald"
              : tally.connectionOverview.overallState === "handshake_ready"
                ? "sky"
                : "amber"
          }
          icon={<Webhook className="h-4 w-4" />}
        />
      </div>

      {/* Segmented Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200/90 bg-white p-2 shadow-2xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {navTabs.map((t) => {
            const active = activeTab === t.key;
            return (
              <ActionLink
                key={t.key}
                href={`/tally?tab=${t.key}`}
                spinnerSize="xs"
                className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
                  active
                    ? "bg-slate-900 text-white shadow-xs"
                    : "text-zinc-600 hover:bg-zinc-100/80 hover:text-slate-900"
                }`}
              >
                {t.label}
              </ActionLink>
            );
          })}
        </div>
        {tally.totals.nativePdfCount > 0 && (
          <div className="inline-flex items-center gap-1.5 px-3 text-[11px] font-semibold text-emerald-700">
            <FileText className="h-3.5 w-3.5" />
            <span>
              {tally.totals.nativePdfCount} untouched Tally-printed PDF invoice(s) ready for WhatsApp
            </span>
          </div>
        )}
      </div>

      {/* TAB 1: BILLS & RECEIPTS REGISTER */}
      {activeTab === "bills" && (
        <SectionCard
          title={`Tally Bills & Receipts Register (${filteredVouchers.length})`}
          subtitle="Live create, alter, cancel (Alt+X), and delete (Alt+D) sync — sends your exact Tally-printed PDF format on WhatsApp"
          action={
            <div className="flex flex-wrap items-center gap-2">
              {canManageTally && (
                <ActionLink href="/tally?tab=import" spinnerSize="xs" className="rsl-btn-secondary text-xs">
                  + Add / Import Bills
                </ActionLink>
              )}
              <ActionLink href="/tally?tab=connect" spinnerSize="xs" className="rsl-btn-primary text-xs">
                {canManageTally ? "Connect Tally Prime" : "Connection Guide & Status"}
              </ActionLink>
            </div>
          }
          noPadding
        >
          {tally.vouchers.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 bg-zinc-50/60 px-6 py-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { key: "all", label: `All (${tally.vouchers.length})`, show: true },
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
                    const href = `/tally?tab=bills${pill.key !== "all" ? `&status=${pill.key}` : ""}${
                      selectedCompanyId !== "all"
                        ? `&company=${encodeURIComponent(selectedCompanyId)}`
                        : ""
                    }${billQuery ? `&q=${encodeURIComponent(billQuery)}` : ""}`;
                    return (
                      <ActionLink
                        key={pill.key}
                        href={href}
                        spinnerSize="xs"
                        className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                          active
                            ? "bg-slate-900 text-white shadow-xs"
                            : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 hover:text-slate-900"
                        }`}
                      >
                        {pill.label}
                      </ActionLink>
                    );
                  })}
              </div>

              <form method="get" action="/tally" className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="tab" value="bills" />
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
                  <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                  <input
                    name="q"
                    defaultValue={billQuery}
                    placeholder="Search bill #, customer, or company..."
                    className="rsl-input py-1.5 pl-8 text-xs"
                  />
                </div>
                <SubmitButton spinnerSize="xs" pendingText="Filtering..." className="rsl-btn-secondary py-1.5 text-xs">
                  Filter
                </SubmitButton>
                {(billQuery || billStatusFilter !== "all" || selectedCompanyId !== "all") && (
                  <ActionLink href="/tally?tab=bills" spinnerSize="xs" className="rsl-btn-secondary py-1.5 text-xs">
                    Reset
                  </ActionLink>
                )}
              </form>
            </div>
          )}

          {tally.vouchers.length === 0 ? (
            <div className="p-6">
              <EmptyWorkspaceState
                title="No Tally bills or receipts yet"
                description={
                  localPortProbe?.reachable && canManageTally
                    ? `Tally Prime is open on this PC (Company: ${localPortProbe.activeCompanyName || "Active"} • ${localPortProbe.voucherCount} bill(s)). Click 'Fetch Bills from Tally Now' in the green bar above to pull your saved invoices and native Tally PDFs in 1 click, or load our .tdl v2.5 add-on.`
                    : "Connect Tally Prime via our 1-click .tdl v2.5 add-on, pair the Windows Connector, or upload an XML/CSV export to get started."
                }
                actionLabel={canManageTally ? "Connect Tally Prime" : "View Connection Guide"}
                actionHref="/tally?tab=connect"
                icon={<Webhook className="h-5 w-5" />}
              />
            </div>
          ) : filteredVouchers.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500">
              No Tally bills or receipts match your current filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-200/80 bg-zinc-50/70 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                  <tr>
                    <th className="px-6 py-3">Bill # &amp; Date</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Customer Party</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-right">Balance Due</th>
                    <th className="px-4 py-3">Status &amp; Tally PDF</th>
                    <th className="px-6 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {filteredVouchers.map((v) => {
                    const isCancelled = v.paymentStatus === "cancelled";
                    const balance = isCancelled
                      ? 0
                      : Math.max(0, v.amountPaise - v.paidAmountPaise);
                    const isOverdue = !isCancelled && balance > 0 && v.dueDate !== null && v.dueDate < nowMs;
                    const compName = companyNameById.get(v.companyId) ?? null;
                    return (
                      <tr
                        key={v.id}
                        className={`hover:bg-zinc-50/60 ${isCancelled ? "opacity-65" : ""}`}
                      >
                        <td className="px-6 py-3.5">
                          <div
                            className={`font-mono font-bold ${
                              isCancelled ? "text-zinc-500 line-through" : "text-slate-900"
                            }`}
                          >
                            #{v.voucherNumber}
                          </div>
                          <div className="text-[11px] text-zinc-500">
                            {new Date(v.voucherDate).toLocaleDateString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 font-medium text-zinc-700">{v.voucherType}</td>
                        <td className="px-4 py-3.5">
                          <div className="font-semibold text-slate-900">{v.partyName}</div>
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                            <span>{v.partyPhoneE164 || "No phone added"}</span>
                            {compName && tally.companies.length > 1 && (
                              <span className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
                                <Building2 className="h-2.5 w-2.5" />
                                {compName}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-right tabular-nums text-zinc-700">
                          {formatInr(v.amountPaise)}
                        </td>
                        <td className="px-4 py-3.5 text-right font-bold tabular-nums text-slate-900">
                          {formatInr(balance)}
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
                                className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 transition hover:bg-emerald-100"
                                title="View exact untouched PDF exported from Tally Prime"
                              >
                                <FileText className="h-2.5 w-2.5" />
                                <span>Tally PDF</span>
                              </a>
                            )}
                            {v.whatsappInvoiceSentAt && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
                                <CheckCircle2 className="h-3 w-3" />
                                <span>Sent</span>
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-3.5 text-right whitespace-nowrap">
                          {isCancelled ? (
                            <span className="text-[11px] text-zinc-400">Cancelled in Tally</span>
                          ) : v.voucherType === "Sales" ? (
                            !canSendTallyWhatsApp ? (
                              <span className="text-[11px] text-zinc-400">Read-only</span>
                            ) : !hasInvoicingEntitlement ? (
                              <ActionLink
                                href="/tally?tab=rules"
                                spinnerSize="xs"
                                className="text-[11px] font-semibold text-emerald-700 hover:underline"
                              >
                                Unlock WhatsApp Send →
                              </ActionLink>
                            ) : !v.partyPhoneE164 ? (
                              <span className="text-[11px] text-zinc-400">No party WhatsApp #</span>
                            ) : (
                              <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                <form action={sendBillWhatsAppAction} className="inline-flex">
                                  <input type="hidden" name="voucherId" value={v.id} />
                                  <input type="hidden" name="sendKind" value="invoice" />
                                  <input type="hidden" name="returnPath" value={currentBillsReturnPath} />
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
                                    buttonLabel={`Send Reminder (${v.remindersSentCount})`}
                                    buttonClassName="rsl-btn-primary py-1 px-2.5 text-[11px]"
                                  />
                                )}
                              </div>
                            )
                          ) : (
                            <span className="text-[11px] text-zinc-400">Receipt recorded</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* TAB 2: CONNECT TALLY PRIME (.TDL, SUBDOMAIN ENDPOINTS, LIVE CHECKS & PAIRED PCS) */}
      {activeTab === "connect" && (
        <TallyConnectStudio
          workspaceName={session.workspace.name}
          workspaceSlug={session.workspace.slug}
          canManageTally={canManageTally}
          primaryDomain={endpoints.primaryDomain}
          cloudTallyBaseUrl={endpoints.tallyCloudBaseUrl}
          cloudApiBaseUrl={endpoints.apiCloudBaseUrl}
          cloudAppBaseUrl={endpoints.cloudBaseUrl}
          workspaceSubdomainUrl={endpoints.workspaceSubdomainUrl}
          localBaseUrl={endpoints.localBaseUrl}
          isLocalDev={endpoints.isLocalDev}
          outdatedTdl={outdatedTdl}
          sslCertificates={sslRecords.map((cert) => ({
            zone: cert.zone,
            hostname: cert.hostname,
            wildcardParent: cert.wildcardParent,
            status: cert.status,
            provider: cert.provider,
            coverageMode: cert.coverageMode,
            expiresAt: cert.expiresAt,
          }))}
          companyRouting={tally.companyRouting}
          knownCompanyNames={knownCompanyNames}
          nativePdfCount={tally.totals.nativePdfCount}
          localPortProbe={
            localPortProbe
              ? {
                  reachable: localPortProbe.reachable,
                  port: localPortProbe.port,
                  activeCompanyName: localPortProbe.activeCompanyName,
                  openCompanies: localPortProbe.openCompanies,
                  voucherCount: localPortProbe.voucherCount,
                }
              : null
          }
          initialPairingCode={canManageTally ? sp.pairingCode : undefined}
          webhookEndpoint={{
            webhookToken: canManageTally ? tally.webhookEndpoint.webhookToken : null,
            enabled: tally.webhookEndpoint.enabled,
            eventsReceivedCount: tally.webhookEndpoint.eventsReceivedCount,
            pingsReceivedCount: tally.webhookEndpoint.pingsReceivedCount,
            lastEventAt: tally.webhookEndpoint.lastEventAt,
            lastPingAt: tally.webhookEndpoint.lastPingAt,
            lastSourceIp: tally.webhookEndpoint.lastSourceIp,
            lastUserAgent: tally.webhookEndpoint.lastUserAgent,
            lastErrorAt: tally.webhookEndpoint.lastErrorAt,
            lastErrorMessage: tally.webhookEndpoint.lastErrorMessage,
          }}
          webhookLiveStatus={tally.webhookLiveStatus}
          connectionOverview={{
            overallState: tally.connectionOverview.overallState,
            overallLabel: tally.connectionOverview.overallLabel,
            overallTone: tally.connectionOverview.overallTone,
            workflowSteps: tally.connectionOverview.workflowSteps,
          }}
          devices={tally.devices.map((d) => ({
            id: d.id,
            deviceName: d.deviceName,
            osVersion: d.osVersion,
            agentVersion: d.agentVersion,
            tallyReachable: d.tallyReachable,
            tallyHost: d.tallyHost,
            tallyPort: d.tallyPort,
            activeCompanyName: d.activeCompanyName,
            lastAlterId: d.lastAlterId,
            lastHeartbeatAt: d.lastHeartbeatAt,
            lastSyncAt: d.lastSyncAt,
            lastErrorMessage: d.lastErrorMessage,
            liveStatus: d.liveStatus,
          }))}
          syncRuns={tally.syncRuns.map((r) => ({
            id: r.id,
            source: r.source,
            vouchersUpserted: r.vouchersUpserted,
            durationMs: r.durationMs,
            status: r.status,
            errorMessage: null,
            createdAt: r.createdAt,
          }))}
        />
      )}

      {/* TAB 3: AUTOMATIC WHATSAPP RULES & OVERDUE REMINDERS */}
      {activeTab === "rules" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-emerald-200/90 bg-emerald-50/75 p-4 text-xs text-emerald-950">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-bold">
                  100% Exact Tally-Printed PDF Delivery — Zero Layout Modification
                </div>
                <p className="mt-1 text-emerald-900/90">
                  Whenever Tally Prime exports a Sales Bill PDF (via local Port 9000 or the Windows
                  Connector), RapidShift attaches your{" "}
                  <strong>exact untouched Tally-printed PDF binary</strong> to the WhatsApp message —
                  keeping your company logo, GSTIN, HSN/SAC columns, e-Invoice IRN/QR, bank details,
                  and custom TDL print settings byte-for-byte identical to pressing{" "}
                  <code className="font-mono">Ctrl+P</code> in Tally.
                </p>
              </div>
              {canManageTally && !hasNativePdfTemplate && (
                <form action={installStarterTemplatesAction}>
                  <SubmitButton pendingText="Installing..." className="rsl-btn-primary text-xs">
                    Load PDF Invoice Template (tally_tax_invoice_pdf)
                  </SubmitButton>
                </form>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <SectionCard
              title="Automatic WhatsApp Rules When Bills Are Saved"
              subtitle="Choose which WhatsApp template goes out automatically whenever Tally saves a bill or receipt"
            >
              {!hasInvoicingEntitlement && invoicingPlan ? (
                <InlineAddonPlanBanner plan={invoicingPlan} returnPath="/tally?tab=rules" />
              ) : !canManageTally ? (
                <p className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3.5 text-xs text-zinc-600">
                  Read-only view — Owner, Admin, or Manager permission is required to add or edit
                  Tally-to-WhatsApp automation rules.
                </p>
              ) : approvedTemplates.length === 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-xs text-amber-900">
                  <div className="font-semibold">Step Required: Add Your WhatsApp Templates First</div>
                  <p className="mt-1">
                    Load our ready-made Tally PDF Tax Invoice (<code className="font-mono">tally_tax_invoice_pdf</code>) &amp; Payment Receipt WhatsApp templates in 1 click, or design your own in{" "}
                    <ActionLink href="/whatsapp" className="font-semibold underline">
                      WhatsApp &amp; Templates
                    </ActionLink>
                    .
                  </p>
                  <form action={installStarterTemplatesAction} className="mt-3">
                    <SubmitButton pendingText="Loading Templates..." className="rsl-btn-primary text-xs">
                      + Load Ready-Made Tally WhatsApp Templates
                    </SubmitButton>
                  </form>
                </div>
              ) : (
                <form action={createTallyAutomationAction} className="space-y-3 text-xs">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block font-semibold text-zinc-700">Rule Name</label>
                      <input
                        name="name"
                        required
                        placeholder="e.g. Auto-Send Tally PDF Sales Invoice"
                        className="rsl-input"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-zinc-700">
                        When Tally Generates
                      </label>
                      <select name="triggerEvent" defaultValue="Sales" className="rsl-input">
                        <option value="Sales">Sales Bill / Tax Invoice (Attaches Tally PDF)</option>
                        <option value="Receipt">Payment Receipt</option>
                        <option value="CreditNote">Credit Note</option>
                        <option value="All">Any Bill or Receipt</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.5fr_1fr]">
                    <div>
                      <label className="mb-1 block font-semibold text-zinc-700">
                        Send WhatsApp Template
                      </label>
                      <select
                        name="templateId"
                        required
                        defaultValue={
                          approvedTemplates.find((t) => t.name === "tally_tax_invoice_pdf")?.id ??
                          approvedTemplates[0]?.id
                        }
                        className="rsl-input"
                      >
                        {approvedTemplates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.category}
                            {t.name === "tally_tax_invoice_pdf" ? " • Native Tally PDF Header" : ""})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-zinc-700">
                        Minimum Bill Amount (₹)
                      </label>
                      <input
                        name="minAmountRupees"
                        type="number"
                        min={0}
                        defaultValue={0}
                        className="rsl-input tabular-nums"
                      />
                    </div>
                  </div>

                  <SubmitButton pendingText="Saving Rule..." className="rsl-btn-primary">
                    Enable Automatic WhatsApp Rule
                  </SubmitButton>
                </form>
              )}

              {hasInvoicingEntitlement && tally.automationRules.length > 0 && (
                <div className="mt-5 border-t border-zinc-200/80 pt-4">
                  <div className="mb-2 text-xs font-semibold text-slate-900">
                    Configured Tally-to-WhatsApp Rules ({tally.automationRules.length})
                  </div>
                  <ul className="divide-y divide-zinc-100 text-xs">
                    {tally.automationRules.map((rule) => (
                      <li
                        key={rule.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                      >
                        <div>
                          <div className="font-semibold text-slate-900">{rule.name}</div>
                          <div className="text-[11px] text-zinc-500">
                            On <strong>{rule.triggerEvent}</strong> → Template{" "}
                            <code className="font-mono text-emerald-700">{rule.templateName}</code> • Sent{" "}
                            <strong>{rule.triggeredCount}</strong> time(s) • Attaches native Tally PDF when available
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <StatusPill
                            label={rule.active ? "Active" : "Paused"}
                            tone={rule.active ? "emerald" : "stone"}
                          />
                          {canManageTally && (
                            <>
                              <form action={toggleTallyAutomationAction}>
                                <input type="hidden" name="ruleId" value={rule.id} />
                                <input
                                  type="hidden"
                                  name="active"
                                  value={rule.active ? "false" : "true"}
                                />
                                <SubmitButton
                                  spinnerSize="xs"
                                  className="rsl-btn-secondary py-1 text-[11px]"
                                >
                                  {rule.active ? "Pause" : "Resume"}
                                </SubmitButton>
                              </form>
                              <form action={deleteTallyAutomationAction}>
                                <input type="hidden" name="ruleId" value={rule.id} />
                                <SubmitButton
                                  spinnerSize="xs"
                                  className="rsl-btn-secondary py-1 text-[11px] text-rose-700"
                                >
                                  Remove
                                </SubmitButton>
                              </form>
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Overdue Payment Reminder Schedule"
              subtitle="Sends polite follow-ups only during daytime business hours (9 AM – 8 PM)"
              action={
                hasInvoicingEntitlement && canSendTallyWhatsApp && tally.rules.length > 0 ? (
                  <form action={runDueTallyRemindersAction}>
                    <input type="hidden" name="ignoreQuietHours" value="true" />
                    <SubmitButton
                      spinnerSize="xs"
                      pendingText="Checking Bills..."
                      className="rsl-btn-secondary py-1.5 text-xs"
                    >
                      Run Due Reminders Now
                    </SubmitButton>
                  </form>
                ) : undefined
              }
            >
              {!hasInvoicingEntitlement && invoicingPlan ? (
                <InlineAddonPlanBanner plan={invoicingPlan} returnPath="/tally?tab=rules" />
              ) : (
                <>
                  {canManageTally ? (
                    <form
                      action={saveReminderRuleAction}
                      className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3"
                    >
                      <input
                        name="name"
                        required
                        placeholder="e.g. 7 Days Overdue Follow-Up"
                        className="rsl-input"
                      />
                      <input
                        name="triggerDaysOffset"
                        type="number"
                        defaultValue={7}
                        required
                        title="Negative = days before due date; Positive = days after due date"
                        className="rsl-input tabular-nums"
                      />
                      <SubmitButton pendingText="Saving..." className="rsl-btn-primary">
                        Add Schedule
                      </SubmitButton>
                    </form>
                  ) : (
                    <p className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3.5 text-xs text-zinc-600">
                      Read-only view — Owner, Admin, or Manager permission is required to modify
                      overdue reminder schedules.
                    </p>
                  )}

                  {tally.rules.length > 0 && (
                    <ul className="mt-4 divide-y divide-zinc-100 text-xs">
                      {tally.rules.map((r) => (
                        <li
                          key={r.id}
                          className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                        >
                          <div>
                            <div className="font-semibold text-slate-900">{r.name}</div>
                            <div className="text-[11px] text-zinc-500">
                              {r.triggerDaysOffset >= 0
                                ? `${r.triggerDaysOffset} days after due date`
                                : `${Math.abs(r.triggerDaysOffset)} days before due date`}{" "}
                              • Max {r.maxRemindersPerBill} reminders/bill
                            </div>
                          </div>
                          {canManageTally && (
                            <form action={deleteReminderRuleAction}>
                              <input type="hidden" name="ruleId" value={r.id} />
                              <SubmitButton
                                spinnerSize="xs"
                                pendingText="Removing..."
                                className="rsl-btn-secondary py-1 text-[11px] text-rose-700"
                              >
                                Remove
                              </SubmitButton>
                            </form>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </SectionCard>
          </div>
        </div>
      )}

      {/* TAB 4: IMPORT XML/CSV OR ADD SINGLE BILL */}
      {activeTab === "import" && canManageTally && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SectionCard
            title="Upload Tally Prime XML or CSV File"
            subtitle="Export your Day Book or Sales Register from Tally Prime and upload it here — duplicate bills are merged automatically"
          >
            <form action={importTallyFileAction} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">
                    Tally Company Name
                  </label>
                  <input
                    name="companyName"
                    defaultValue={
                      session.workspace.defaultTallyCompany ||
                      tally.companies[0]?.name ||
                      session.workspace.name
                    }
                    required
                    className="rsl-input"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">File Format</label>
                  <select name="format" defaultValue="tally_xml" className="rsl-input">
                    <option value="tally_xml">Tally Prime XML Export (.xml)</option>
                    <option value="csv">Spreadsheet CSV (.csv)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block font-semibold text-zinc-700">
                  Select File (.xml / .csv)
                </label>
                <input name="uploadFile" type="file" accept=".xml,.csv,.txt" className="rsl-input" />
              </div>

              <div>
                <label className="mb-1 block font-semibold text-zinc-700">
                  Or Paste XML / CSV Rows Directly
                </label>
                <textarea
                  name="rawContent"
                  rows={3}
                  placeholder="Paste exported Tally XML or CSV rows here..."
                  className="rsl-input font-mono text-[11px]"
                />
              </div>

              <SubmitButton pendingText="Importing..." className="rsl-btn-primary">
                Import Bills &amp; Receipts
              </SubmitButton>
            </form>
          </SectionCard>

          <SectionCard
            title="Add a Single Sales Bill or Payment Receipt"
            subtitle="If an automatic WhatsApp rule is active, saving a bill with a customer WhatsApp number also sends the message"
          >
            <form action={recordTallyVoucherAction} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">Bill Type</label>
                  <select name="voucherType" defaultValue="Sales" className="rsl-input">
                    <option value="Sales">Sales Bill</option>
                    <option value="Receipt">Payment Receipt</option>
                    <option value="CreditNote">Credit Note</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">Bill / Receipt #</label>
                  <input
                    name="voucherNumber"
                    required
                    placeholder="GST/26-27/001"
                    className="rsl-input font-mono"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">Company Name</label>
                  <input
                    name="companyName"
                    defaultValue={
                      session.workspace.defaultTallyCompany ||
                      tally.companies[0]?.name ||
                      session.workspace.name
                    }
                    className="rsl-input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">
                    Customer / Party Name
                  </label>
                  <input name="partyName" required className="rsl-input" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">
                    Customer WhatsApp (+91...)
                  </label>
                  <input name="partyPhoneE164" placeholder="+9198200..." className="rsl-input" />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">Total Amount (₹)</label>
                  <input
                    name="amountRupees"
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    className="rsl-input tabular-nums"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">Already Paid (₹)</label>
                  <input
                    name="paidAmountRupees"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue="0"
                    className="rsl-input tabular-nums"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">Bill Date</label>
                  <input
                    name="voucherDateIso"
                    type="date"
                    defaultValue={todayIso}
                    required
                    className="rsl-input"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">Due Date</label>
                  <input name="dueDateIso" type="date" className="rsl-input" />
                </div>
              </div>

              <SubmitButton pendingText="Saving Bill..." className="rsl-btn-primary">
                Save Bill / Receipt
              </SubmitButton>
            </form>
          </SectionCard>
        </div>
      )}
    </div>
  );
}
