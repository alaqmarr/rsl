import { MessageSquare } from "lucide-react";
import { SectionCard } from "@rsl/ui";
import { SubmitButton } from "@/components/ios-feedback";
import {
  staffSeedStarterTemplatesAction,
  staffSendClientEmailAction,
} from "@/lib/actions";

export function ClientSupportTemplatesTab({
  workspaceId,
  workspaceName,
  ownerEmail,
  canManageTemplates,
  canSendEmail,
}: {
  workspaceId: string;
  workspaceName: string;
  ownerEmail: string;
  canManageTemplates: boolean;
  canSendEmail: boolean;
}) {
  const returnToSupport = `/clients/${workspaceId}?tab=support`;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <SectionCard
        title="Push Approved Tally WhatsApp Starter Templates"
        subtitle="Adds ready-to-use Sales Invoice, Payment Receipt, and Overdue Reminder templates directly into this client's account"
      >
        <div className="space-y-4 text-xs">
          <ul className="space-y-2 rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-4 text-zinc-700">
            <li className="flex items-center gap-2">
              <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
              <span>
                <code className="font-mono font-semibold">tally_sales_bill_created</code> - Automatic Sales Bill notification
              </span>
            </li>
            <li className="flex items-center gap-2">
              <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
              <span>
                <code className="font-mono font-semibold">tally_payment_receipt_thankyou</code> - Payment Receipt confirmation
              </span>
            </li>
            <li className="flex items-center gap-2">
              <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
              <span>
                <code className="font-mono font-semibold">tally_overdue_payment_reminder</code> - Polite Overdue Bill reminder
              </span>
            </li>
          </ul>

          {canManageTemplates ? (
            <form action={staffSeedStarterTemplatesAction}>
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <input type="hidden" name="returnTo" value={returnToSupport} />
              <SubmitButton className="adm-btn-primary" pendingText="Adding Templates...">
                Add Starter Templates to Client Account
              </SubmitButton>
            </form>
          ) : (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-zinc-600">
              Template seeding requires Support or Super Admin permissions.
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Send Account or Billing Email to Client"
        subtitle="Sends a formatted email notification to the client and records it in Sent Emails"
      >
        {canSendEmail ? (
          <form action={staffSendClientEmailAction} className="space-y-3 text-xs">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="returnTo" value={returnToSupport} />
            <div>
              <label htmlFor="sup-email-to" className="mb-1 block font-semibold text-slate-800">
                Recipient Email *
              </label>
              <input
                id="sup-email-to"
                name="recipientEmail"
                type="email"
                required
                defaultValue={ownerEmail}
                className="adm-input"
              />
            </div>
            <div>
              <label htmlFor="sup-email-subj" className="mb-1 block font-semibold text-slate-800">
                Subject Headline *
              </label>
              <input
                id="sup-email-subj"
                name="headline"
                required
                defaultValue="Your RSL Marketing plan update"
                className="adm-input"
              />
            </div>
            <div>
              <label htmlFor="sup-email-body" className="mb-1 block font-semibold text-slate-800">
                Message *
              </label>
              <textarea
                id="sup-email-body"
                name="bodyText"
                rows={3}
                required
                defaultValue={`Hello ${workspaceName}, your requested feature plan and GST tax invoice are ready in your dashboard.`}
                className="adm-input"
              />
            </div>
            <div className="flex justify-end">
              <SubmitButton className="adm-btn-dark" pendingText="Sending...">
                Send Email Notification
              </SubmitButton>
            </div>
          </form>
        ) : (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
            Sending client notifications requires Finance, Support, or Super Admin permissions.
          </div>
        )}
      </SectionCard>
    </div>
  );
}
