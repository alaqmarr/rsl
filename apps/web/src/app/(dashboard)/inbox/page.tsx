import Link from "next/link";
import { listWorkspaceTeam } from "@rsl/auth";
import {
  getWalletAvailableSpendPaise,
  getWalletBalancePaise,
  getWorkspacePlansByKeys,
  hasActiveEntitlement,
  MIN_WALLET_BALANCE_PAISE,
} from "@rsl/billing";
import { formatInr } from "@rsl/core";
import {
  countConversationsWithContacts,
  getConversationThread,
  listCannedReplies,
  listContacts,
  listConversationsWithContacts,
  listWorkspaceLabels,
  searchInboxFts,
} from "@rsl/inbox";
import { canRoleAccessWebRoute, canRolePerform, formatRoleLabel } from "@rsl/rbac";
import {
  AccessRestrictedState,
  ConfirmSubmitButton,
  EmptyWorkspaceState,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@rsl/ui";
import { InboxReplyComposer, InboxToolsDisclosure } from "@/components/client-utils";
import { FeaturePlanGate } from "@/components/feature-plan-gate";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import {
  addInternalNoteAction,
  assignConversationAction,
  attachConversationLabelAction,
  changeConversationStatusAction,
  createContactAction,
  deleteCannedReplyAction,
  importContactsCsvAction,
  removeConversationLabelAction,
  replyConversationAction,
  saveCannedReplyAction,
  startConversationAction,
} from "@/lib/actions";
import { requireWebSession } from "@/lib/session";

export default async function CustomerInboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/inbox", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Shared Customer Inbox"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="Read customer messages"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  if (!hasActiveEntitlement(session.workspace.id, "inbox")) {
    const plans = getWorkspacePlansByKeys(session.workspace.id, ["inbox"]);
    return (
      <FeaturePlanGate
        pageTitle="Shared Customer Inbox"
        pageSubtitle="Manage WhatsApp, Instagram, Facebook, and Google customer replies in one unified team inbox with 24-hour reply window checks and private staff notes."
        plans={plans}
        returnPath="/inbox"
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  const canReply = canRolePerform(session.roleSlug, "inbox:reply", session.workspace.id);
  const canAssign = canRolePerform(session.roleSlug, "inbox:assign", session.workspace.id);
  const canNote = canRolePerform(session.roleSlug, "inbox:note", session.workspace.id);
  const canExportContacts =
    canRolePerform(session.roleSlug, "backup:manage", session.workspace.id) || canReply;
  const canViewBilling = canRoleAccessWebRoute(
    session.roleSlug,
    "/billing",
    session.workspace.id
  );

  const walletBalancePaise = getWalletBalancePaise(session.workspace.id);
  const walletAvailableSpendPaise = getWalletAvailableSpendPaise(walletBalancePaise);
  const isOverdraftExhausted = walletBalancePaise <= MIN_WALLET_BALANCE_PAISE;

  const statusFilter = sp.status || "all";
  const assignedFilter = sp.assigned === "mine" || sp.assigned === "unassigned" ? sp.assigned : "all";
  const resolvedAssignedUserId =
    assignedFilter === "mine"
      ? session.user.id
      : assignedFilter === "unassigned"
        ? "unassigned"
        : undefined;
  const searchQuery = sp.q?.trim() || "";

  const INBOX_PAGE_SIZE = 50;
  const totalThreadsCount = countConversationsWithContacts(
    session.workspace.id,
    statusFilter,
    resolvedAssignedUserId
  );
  const totalThreadPages = Math.max(1, Math.ceil(totalThreadsCount / INBOX_PAGE_SIZE));
  const rawInboxPage = Math.max(1, Number.parseInt(sp.page || "1", 10) || 1);
  const currentInboxPage = Math.min(rawInboxPage, totalThreadPages);

  const contacts = listContacts(session.workspace.id, { limit: 150, offset: 0 });
  const conversations = listConversationsWithContacts(
    session.workspace.id,
    statusFilter,
    resolvedAssignedUserId,
    { page: currentInboxPage, pageSize: INBOX_PAGE_SIZE }
  );
  const cannedReplies = listCannedReplies(session.workspace.id);
  const workspaceLabels = listWorkspaceLabels(session.workspace.id);
  const team = listWorkspaceTeam(session.workspace.id);
  const memberNameById = new Map(team.members.map((m) => [m.userId, m.name]));
  const ftsHits = searchQuery ? searchInboxFts(session.workspace.id, searchQuery) : [];

  const activeConvId = sp.conv || conversations[0]?.conversation.id || "";
  const activeThread = activeConvId
    ? getConversationThread(session.workspace.id, activeConvId)
    : null;
  const hasMobileThreadOpen = Boolean(sp.conv && activeThread);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Daily Operations"
        title="Customer Messages"
        subtitle="Reply to WhatsApp, Instagram, Facebook, and Google inquiries with automatic 24-hour reply window checks and private team notes."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {contacts.length > 0 && canExportContacts && (
              <a href="/api/export/contacts-csv" className="rsl-btn-secondary">
                Export Contacts CSV ({contacts.length})
              </a>
            )}
            <form method="get" action="/inbox" className="flex items-center gap-2">
              <input
                name="q"
                defaultValue={searchQuery}
                aria-label="Search messages or customers"
                placeholder="Search messages or customers..."
                className="rsl-input w-56 sm:w-64"
              />
              <SubmitButton pendingText="Searching..." className="rsl-btn-secondary">
                Search
              </SubmitButton>
            </form>
          </div>
        }
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      {walletBalancePaise < 0 && (
        <div
          className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-xs ${
            isOverdraftExhausted
              ? "border-rose-200 bg-rose-50/85 text-rose-950"
              : "border-amber-200 bg-amber-50/85 text-amber-950"
          }`}
        >
          <div>
            <span className="font-semibold">
              Prepaid Wallet Balance: {formatInr(walletBalancePaise, { showDecimals: true })}
            </span>{" "}
            -{" "}
            {isOverdraftExhausted
              ? "Maximum -₹200.00 overdraft limit reached. Free 24-hour window replies continue to work; recharge wallet to send metered WhatsApp templates."
              : `${formatInr(walletAvailableSpendPaise, { showDecimals: true })} overdraft credit remaining down to -₹200.00 so customer template replies stay uninterrupted.`}
          </div>
          {canViewBilling && (
            <Link href="/billing?tab=wallet" className="rsl-btn-secondary bg-white py-1 text-xs">
              Recharge Wallet
            </Link>
          )}
        </div>
      )}

      {searchQuery && (
        <SectionCard
          title={`Search Results for "${searchQuery}" (${ftsHits.length})`}
          action={
            <ActionLink
              href="/inbox"
              className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:text-emerald-700"
            >
              Clear Search
            </ActionLink>
          }
        >
          {ftsHits.length === 0 ? (
            <p className="text-[13px] text-zinc-500">No matching message threads found.</p>
          ) : (
            <ul className="space-y-2 text-[13px]">
              {ftsHits.map((hit, idx) => (
                <li key={`${hit.conversationId}-${idx}`}>
                  <ActionLink
                    href={`/inbox?conv=${encodeURIComponent(hit.conversationId)}`}
                    className="inline-flex items-center gap-1 font-semibold text-emerald-600 hover:underline"
                  >
                    Open Conversation
                  </ActionLink>{" "} - <span className="text-zinc-600">{hit.snippet}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      {/* Quick Actions: controlled accessible disclosure drawer */}
      {canReply && (
        <InboxToolsDisclosure
          defaultOpen={contacts.length === 0 || totalThreadsCount === 0}
          summaryLabel={
            contacts.length === 0
              ? "Step 1: Add or Import Customer Contacts to Start Messaging"
              : `+ Add Contact, Start New Thread, or Bulk Import CSV (${contacts.length} contacts saved)`
          }
        >
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <SectionCard
              title="Add Customer Contact"
              subtitle="Save a customer's phone number and WhatsApp permission in your business directory"
            >
              <form action={createContactAction} className="space-y-3.5 text-[13px]">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="inbox-contact-name" className="rsl-label">
                      Customer Name *
                    </label>
                    <input
                      id="inbox-contact-name"
                      name="name"
                      required
                      placeholder="Shree Ganesh Traders"
                      className="rsl-input"
                    />
                  </div>
                  <div>
                    <label htmlFor="inbox-contact-phone" className="rsl-label">
                      WhatsApp Number
                    </label>
                    <input
                      id="inbox-contact-phone"
                      name="phoneE164"
                      placeholder="+919820000000"
                      className="rsl-input font-mono"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="inbox-contact-email" className="rsl-label">
                      Email Address
                    </label>
                    <input
                      id="inbox-contact-email"
                      name="email"
                      type="email"
                      placeholder="accounts@client.in"
                      className="rsl-input"
                    />
                  </div>
                  <div>
                    <label htmlFor="inbox-contact-company" className="rsl-label">
                      Firm / Company
                    </label>
                    <input
                      id="inbox-contact-company"
                      name="companyName"
                      placeholder="Firm name (optional)"
                      className="rsl-input"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <label className="inline-flex items-center gap-2 text-[12.5px] text-zinc-600">
                    <input
                      type="checkbox"
                      name="recordWhatsAppConsent"
                      defaultChecked
                      className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>Customer agreed to receive WhatsApp updates</span>
                  </label>
                  <SubmitButton pendingText="Saving..." className="rsl-btn-primary">
                    Save Contact
                  </SubmitButton>
                </div>
              </form>
            </SectionCard>

            <SectionCard
              title="Start or Record a Message Thread"
              subtitle="Log an incoming customer inquiry or start a new outbound thread"
            >
              {contacts.length === 0 ? (
                <p className="text-[13px] leading-relaxed text-zinc-500">
                  Add your first customer contact on the left (or import a Contacts CSV below) to start
                  a conversation.
                </p>
              ) : (
                <form action={startConversationAction} className="space-y-3.5 text-[13px]">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label htmlFor="inbox-start-contact" className="rsl-label">
                        Customer *
                      </label>
                      <select id="inbox-start-contact" name="contactId" required className="rsl-input">
                        {contacts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} {c.phoneE164 ? `(${c.phoneE164})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="inbox-start-channel" className="rsl-label">
                        Channel
                      </label>
                      <select
                        id="inbox-start-channel"
                        name="channel"
                        defaultValue="whatsapp"
                        className="rsl-input"
                      >
                        <option value="whatsapp">WhatsApp</option>
                        <option value="instagram">Instagram DM</option>
                        <option value="facebook">Facebook Page</option>
                        <option value="google_review">Google Q&amp;A</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="inbox-start-direction" className="rsl-label">
                        Direction
                      </label>
                      <select
                        id="inbox-start-direction"
                        name="direction"
                        defaultValue="inbound"
                        className="rsl-input"
                      >
                        <option value="inbound">Customer Sent Message</option>
                        <option value="outbound">Team Sent Message</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="inbox-start-body" className="rsl-label">
                      Message Text *
                    </label>
                    <div className="flex gap-2.5">
                      <input
                        id="inbox-start-body"
                        name="body"
                        required
                        placeholder="Write message text..."
                        className="rsl-input flex-1"
                      />
                      <SubmitButton pendingText="Saving..." className="rsl-btn-primary shrink-0">
                        Save Thread
                      </SubmitButton>
                    </div>
                  </div>
                </form>
              )}
            </SectionCard>
          </div>

          {/* Bulk CSV Contact Import Bar */}
          <SectionCard
            title={`Bulk CSV Contact Import (${contacts.length} saved)`}
            subtitle="Import a spreadsheet CSV (name,phone,email,company) to add customer numbers and WhatsApp permission in bulk"
          >
            <form
              action={importContactsCsvAction}
              className="flex flex-col gap-3 text-[13px] lg:flex-row lg:items-end"
            >
              <input type="hidden" name="returnPath" value="/inbox" />
              <div className="min-w-[220px] flex-1">
                <label htmlFor="inbox-csv-file" className="rsl-label">
                  Upload Contacts CSV (.csv)
                </label>
                <input
                  id="inbox-csv-file"
                  name="csvFile"
                  type="file"
                  accept=".csv,.txt"
                  className="rsl-input"
                />
              </div>
              <div className="min-w-[240px] flex-1">
                <label htmlFor="inbox-csv-content" className="rsl-label">
                  Or Paste CSV Rows (name,phone,email,company)
                </label>
                <input
                  id="inbox-csv-content"
                  name="csvContent"
                  placeholder="Ravi Traders,+919820011223,ravi@traders.in,Ravi Steel"
                  className="rsl-input font-mono text-xs"
                />
              </div>
              <label className="inline-flex items-center gap-2 pb-2 text-xs text-zinc-600">
                <input
                  type="checkbox"
                  name="recordWhatsAppConsent"
                  defaultChecked
                  className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>Opted-in for WhatsApp</span>
              </label>
              <SubmitButton pendingText="Importing..." className="rsl-btn-secondary shrink-0">
                Import CSV
              </SubmitButton>
            </form>
          </SectionCard>
        </InboxToolsDisclosure>
      )}

      {/* 3-Pane Inbox Workspace (Master-Detail on Mobile, 3-Column on Desktop) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[310px_1fr_290px]">
        <div className={hasMobileThreadOpen ? "hidden lg:block" : "block"}>
        <SectionCard
          title={`Threads (${totalThreadsCount})`}
          action={
            <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 text-[11.5px]">
              {["all", "open", "resolved"].map((st) => (
                <ActionLink
                  key={st}
                  href={`/inbox?status=${st}&assigned=${assignedFilter}`}
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium capitalize transition ${
                    statusFilter === st
                      ? "bg-slate-900 text-white"
                      : "text-zinc-600 hover:bg-zinc-50 hover:text-slate-900"
                  }`}
                >
                  {st}
                </ActionLink>
              ))}
            </div>
          }
          noPadding
        >
          <div className="flex flex-wrap items-center gap-1 border-b border-zinc-100 bg-zinc-50/70 px-4 py-2 text-[11px]">
            {(
              [
                { key: "all", label: "All Staff" },
                { key: "mine", label: "Assigned to Me" },
                { key: "unassigned", label: "Unassigned" },
              ] as const
            ).map((f) => (
              <ActionLink
                key={f.key}
                href={`/inbox?status=${statusFilter}&assigned=${f.key}`}
                spinnerSize="xs"
                className={`rounded-md px-2 py-0.5 font-semibold transition ${
                  assignedFilter === f.key
                    ? "bg-emerald-600 text-white"
                    : "text-zinc-600 hover:bg-white hover:text-slate-900"
                }`}
              >
                {f.label}
              </ActionLink>
            ))}
          </div>
          {conversations.length === 0 ? (
            <div className="p-5 text-[13px] text-zinc-500">No threads in this view yet.</div>
          ) : (
            <ul className="max-h-72 divide-y divide-zinc-100 overflow-y-auto text-[13px] lg:max-h-[34rem]">
              {conversations.map(({ conversation, contact }) => {
                const isSelected = conversation.id === activeConvId;
                const assigneeName = conversation.assignedUserId
                  ? memberNameById.get(conversation.assignedUserId)
                  : undefined;
                return (
                  <li
                    key={conversation.id}
                    className={
                      isSelected ? "bg-emerald-50/65" : "transition hover:bg-zinc-50/80"
                    }
                  >
                    <ActionLink
                      href={`/inbox?status=${statusFilter}&assigned=${assignedFilter}&page=${currentInboxPage}&conv=${encodeURIComponent(conversation.id)}`}
                      variant="card"
                      className="flex items-center justify-between gap-2 px-5 py-3.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-semibold text-slate-900">
                            {contact.name}
                          </span>
                          <StatusPill
                            label={conversation.channel}
                            tone={conversation.channel === "whatsapp" ? "emerald" : "sky"}
                            showDot={false}
                          />
                        </div>
                        <p className="mt-1 truncate text-xs text-zinc-500">
                          {conversation.lastMessagePreview || "Open thread"}
                        </p>
                        {assigneeName && (
                          <div className="mt-1 text-[11px] font-medium text-emerald-700">
                            Assigned: {assigneeName}
                          </div>
                        )}
                      </div>
                    </ActionLink>
                  </li>
                );
              })}
            </ul>
          )}
          {totalThreadPages > 1 && (
            <div className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50/70 px-4 py-2 text-xs text-zinc-600">
              <span className="tabular-nums">
                Page {currentInboxPage} / {totalThreadPages}
              </span>
              <div className="flex items-center gap-1.5">
                {currentInboxPage > 1 && (
                  <ActionLink
                    href={`/inbox?status=${statusFilter}&assigned=${assignedFilter}&page=${currentInboxPage - 1}`}
                    spinnerSize="xs"
                    className="rsl-btn-secondary px-2.5 py-0.5 text-xs"
                  >
                    ← Prev
                  </ActionLink>
                )}
                {currentInboxPage < totalThreadPages && (
                  <ActionLink
                    href={`/inbox?status=${statusFilter}&assigned=${assignedFilter}&page=${currentInboxPage + 1}`}
                    spinnerSize="xs"
                    className="rsl-btn-secondary px-2.5 py-0.5 text-xs"
                  >
                    Next →
                  </ActionLink>
                )}
              </div>
            </div>
          )}
        </SectionCard>
        </div>

        <div className={hasMobileThreadOpen ? "space-y-3" : "hidden lg:block"}>
          {hasMobileThreadOpen && (
            <ActionLink
              href={`/inbox?status=${statusFilter}&assigned=${assignedFilter}`}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-900 shadow-2xs lg:hidden"
            >
              ← All Threads ({conversations.length})
            </ActionLink>
          )}
        <SectionCard
          title={
            activeThread
              ? `${activeThread.contact?.name ?? "Customer"} • ${activeThread.conversation.channel.toUpperCase()}`
              : "Conversation Thread"
          }
          subtitle={
            activeThread
              ? activeThread.whatsappWindowOpen
                ? "24-hour free reply window is OPEN"
                : "24-hour window closed - include an approved template name to message on WhatsApp"
              : undefined
          }
          action={
            activeThread && (canReply || canAssign) ? (
              <form action={changeConversationStatusAction} className="flex items-center gap-2">
                <input type="hidden" name="conversationId" value={activeThread.conversation.id} />
                <select
                  name="status"
                  aria-label="Conversation status"
                  defaultValue={activeThread.conversation.status}
                  className="rsl-input w-auto"
                >
                  <option value="open">Open</option>
                  <option value="pending">Pending</option>
                  <option value="resolved">Resolved</option>
                </select>
                <SubmitButton
                  spinnerSize="xs"
                  pendingText="Saving..."
                  className="rsl-btn-secondary"
                >
                  Update
                </SubmitButton>
              </form>
            ) : activeThread ? (
              <StatusPill label={activeThread.conversation.status} tone="stone" />
            ) : undefined
          }
        >
          {!activeThread ? (
            <EmptyWorkspaceState
              title="Select or create a conversation"
              description="Messages, delivery statuses, and reply speed tracking appear here as soon as a thread is active."
            />
          ) : (
            <div className="space-y-4">
              <div className="max-h-96 space-y-3 overflow-y-auto rounded-xl border border-zinc-200/85 bg-zinc-50/75 p-4">
                {activeThread.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[82%] rounded-xl px-3.5 py-2.5 text-[13px] shadow-2xs ${
                      m.direction === "outbound"
                        ? "rsl-chat-outbound ml-auto"
                        : "rsl-chat-inbound"
                    }`}
                  >
                    <p className="leading-relaxed">{m.body}</p>
                    <div
                      className={`mt-1 text-[11px] ${
                        m.direction === "outbound" ? "rsl-chat-outbound-meta" : "text-zinc-500"
                      }`}
                    >
                      {m.senderType} • {m.deliveryStatus}
                      {m.templateName ? ` • Template: ${m.templateName}` : ""}
                    </div>
                  </div>
                ))}
              </div>

              {canReply ? (
                <InboxReplyComposer
                  conversationId={activeThread.conversation.id}
                  action={replyConversationAction}
                  cannedReplies={cannedReplies}
                />
              ) : (
                <div className="rounded-xl border border-zinc-200/85 bg-zinc-50/75 px-4 py-3 text-xs text-zinc-600">
                  Read-only role - your current role can inspect customer message threads, while Support Executives, Managers, Admins, and Owners can send replies.
                </div>
              )}
            </div>
          )}
        </SectionCard>
        </div>

        <div className={hasMobileThreadOpen ? "block" : "hidden lg:block"}>
        <SectionCard title="Customer, Notes & Quick Replies" subtitle="Visible only to your staff">
          <div className="space-y-4 text-[13px]">
            {!activeThread ? (
              <p className="text-[13px] text-zinc-500">
                Select a thread to view customer details and private team notes.
              </p>
            ) : (
              <>
                <div className="space-y-1 rounded-xl border border-zinc-200/85 bg-zinc-50/75 p-3.5">
                  <div className="font-semibold text-slate-900">{activeThread.contact?.name}</div>
                  <div className="font-mono text-xs text-zinc-600">
                    Phone: {activeThread.contact?.phoneE164 || "-"}
                  </div>
                  <div className="text-xs text-zinc-600">
                    Email: {activeThread.contact?.email || "-"}
                  </div>
                </div>

                {/* Team Member Assignment */}
                {canAssign ? (
                  <form
                    action={assignConversationAction}
                    className="space-y-2 rounded-xl border border-zinc-200/85 bg-white p-3"
                  >
                    <input type="hidden" name="conversationId" value={activeThread.conversation.id} />
                    <label htmlFor="inbox-assigned-user" className="text-xs font-semibold text-slate-900">
                      Assigned Team Member
                    </label>
                    <div className="flex items-center gap-2">
                      <select
                        id="inbox-assigned-user"
                        name="assignedUserId"
                        defaultValue={activeThread.conversation.assignedUserId || ""}
                        className="rsl-input py-1.5 text-xs"
                      >
                        <option value="">Unassigned</option>
                        {team.members.map((m) => (
                          <option key={m.userId} value={m.userId}>
                            {m.name} ({formatRoleLabel(m.roleSlug)})
                          </option>
                        ))}
                      </select>
                      <SubmitButton
                        spinnerSize="xs"
                        pendingText="Saving..."
                        className="rsl-btn-secondary shrink-0 py-1.5 px-2.5 text-xs"
                      >
                        Save
                      </SubmitButton>
                    </div>
                  </form>
                ) : (
                  <div className="flex items-center justify-between rounded-xl border border-zinc-200/85 bg-white p-3 text-xs">
                    <span className="font-semibold text-slate-900">Assigned Team Member</span>
                    <span className="font-medium text-zinc-600">
                      {activeThread.conversation.assignedUserId
                        ? memberNameById.get(activeThread.conversation.assignedUserId) ?? "Assigned"
                        : "Unassigned"}
                    </span>
                  </div>
                )}

                {/* Conversation Labels */}
                <div className="space-y-2 rounded-xl border border-zinc-200/85 bg-white p-3">
                  <div className="text-xs font-semibold text-slate-900">
                    Labels ({activeThread.labels.length})
                  </div>
                  {activeThread.labels.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {activeThread.labels.map((lbl) =>
                        canReply ? (
                          <form key={lbl.id} action={removeConversationLabelAction} className="inline-flex">
                            <input
                              type="hidden"
                              name="conversationId"
                              value={activeThread.conversation.id}
                            />
                            <input type="hidden" name="labelId" value={lbl.id} />
                            <SubmitButton
                              spinnerSize="xs"
                              className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-900 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-800"
                            >
                              <span>{lbl.name}</span>
                              <span aria-hidden="true">×</span>
                            </SubmitButton>
                          </form>
                        ) : (
                          <span
                            key={lbl.id}
                            className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-900"
                          >
                            {lbl.name}
                          </span>
                        )
                      )}
                    </div>
                  )}
                  {canReply && (
                    <form action={attachConversationLabelAction} className="flex items-center gap-1.5">
                      <input
                        type="hidden"
                        name="conversationId"
                        value={activeThread.conversation.id}
                      />
                      <input
                        name="labelName"
                        list="workspace-inbox-labels"
                        required
                        placeholder="Add label (e.g. Payment Due, VIP)"
                        className="rsl-input py-1.5 text-xs"
                      />
                      <datalist id="workspace-inbox-labels">
                        {workspaceLabels.map((wl) => (
                          <option key={wl.id} value={wl.name} />
                        ))}
                      </datalist>
                      <SubmitButton
                        spinnerSize="xs"
                        pendingText="Adding..."
                        className="rsl-btn-secondary shrink-0 py-1.5 px-2.5 text-xs"
                      >
                        Tag
                      </SubmitButton>
                    </form>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-900">
                    Internal Team Notes ({activeThread.notes.length})
                  </div>
                  {activeThread.notes.map((n) => (
                    <div
                      key={n.id}
                      className="rounded-xl border border-amber-200/90 bg-amber-50/75 p-3 text-[13px]"
                    >
                      <p className="text-slate-900">{n.body}</p>
                      <div className="mt-1 text-[11px] font-medium text-amber-800">
                        By {n.authorName}
                      </div>
                    </div>
                  ))}
                </div>

                {canNote && (
                  <form action={addInternalNoteAction} className="space-y-2.5">
                    <input type="hidden" name="conversationId" value={activeThread.conversation.id} />
                    <label htmlFor="inbox-private-note" className="rsl-label">
                      New Private Note
                    </label>
                    <textarea
                      id="inbox-private-note"
                      name="body"
                      rows={2}
                      required
                      placeholder="Add a private team note..."
                      className="rsl-input"
                    />
                    <SubmitButton pendingText="Saving..." className="rsl-btn-secondary w-full">
                      Add Team Note
                    </SubmitButton>
                  </form>
                )}
              </>
            )}

            <div className="space-y-2.5 border-t border-zinc-200/80 pt-4">
              <div className="text-xs font-semibold text-slate-900">
                Saved Quick Replies ({cannedReplies.length})
              </div>
              {cannedReplies.length > 0 && (
                <ul className="space-y-1.5 text-xs">
                  {cannedReplies.map((cr) => (
                    <li
                      key={cr.id}
                      className="flex items-start justify-between gap-2 rounded-lg border border-zinc-200/80 bg-zinc-50/70 p-2.5"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900">
                          <span className="font-mono text-emerald-700">/{cr.shortcut}</span> -{" "}
                          {cr.title}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-[11.5px] text-zinc-600">{cr.body}</p>
                      </div>
                      {canReply && (
                        <form action={deleteCannedReplyAction} className="shrink-0">
                          <input type="hidden" name="replyId" value={cr.id} />
                          <input
                            type="hidden"
                            name="conversationId"
                            value={activeThread?.conversation.id ?? ""}
                          />
                          <ConfirmSubmitButton
                            confirmMessage={`Delete saved quick reply "${cr.title}"?`}
                            className="rsl-btn-danger-soft px-2 py-0.5 text-xs"
                          >
                            Remove
                          </ConfirmSubmitButton>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {canReply && (
                <form action={saveCannedReplyAction} className="space-y-2">
                  <input
                    type="hidden"
                    name="conversationId"
                    value={activeThread?.conversation.id ?? ""}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      name="shortcut"
                      aria-label="Quick reply shortcut"
                      required
                      placeholder="upi-details"
                      className="rsl-input font-mono text-xs"
                    />
                    <input
                      name="title"
                      aria-label="Quick reply title"
                      required
                      placeholder="UPI Details"
                      className="rsl-input text-xs"
                    />
                  </div>
                  <textarea
                    name="body"
                    aria-label="Quick reply body"
                    rows={2}
                    required
                    placeholder="Reusable reply text for your team..."
                    className="rsl-input text-xs"
                  />
                  <SubmitButton
                    spinnerSize="xs"
                    pendingText="Saving..."
                    className="rsl-btn-secondary w-full text-xs"
                  >
                    Save Quick Reply
                  </SubmitButton>
                </form>
              )}
            </div>
          </div>
        </SectionCard>
        </div>
      </div>
    </div>
  );
}
