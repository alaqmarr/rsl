import { notFound } from "next/navigation";
import {
  canStaffAccessAdminRoute,
  canStaffPerform,
  formatStaffRoleLabel,
} from "@rsl/auth";
import { getInvoiceDetailById } from "@rsl/billing";
import {
  AccessRestrictedState,
  FlashBanner,
  GstTaxInvoiceDocument,
  PageHeader,
} from "@rsl/ui";
import { CopyTextButton, PrintInvoiceButton } from "@/components/client-utils";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { staffUpdateInvoiceStatusAction } from "@/lib/actions";
import { requireStaffSession } from "@/lib/session";

export default async function AdminInvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { staff } = await requireStaffSession();
  if (!canStaffAccessAdminRoute(staff.staffRole, "/invoices")) {
    return (
      <AccessRestrictedState
        pageTitle="GST Tax Invoice"
        roleLabel={formatStaffRoleLabel(staff.staffRole)}
        requiredPermissionLabel="View GST invoices & revenue"
        description={`Your ${formatStaffRoleLabel(staff.staffRole)} account does not include access to GST Tax Invoices.`}
      />
    );
  }
  const canManageBilling = canStaffPerform(staff.staffRole, "staff:billing.manage");
  const { id } = await params;
  const sp = await searchParams;

  const invoice = getInvoiceDetailById(id);
  if (!invoice) {
    notFound();
  }

  const returnHere = `/invoices/${invoice.id}`;

  return (
    <div className="w-full space-y-6">
      <div className="no-print space-y-4">
        <PageHeader
          eyebrow={
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <ActionLink
                href="/invoices"
                spinnerSize="xs"
                className="font-semibold text-zinc-500 hover:text-slate-900"
              >
                ← GST Invoices
              </ActionLink>
              <span className="text-zinc-300">/</span>
              <ActionLink
                href={`/clients/${invoice.workspaceId}?tab=finance`}
                spinnerSize="xs"
                className="font-semibold text-emerald-700 hover:underline"
              >
                {invoice.buyerName}
              </ActionLink>
            </div>
          }
          title={`GST Tax Invoice ${invoice.invoiceNumber}`}
          subtitle="Printable A4 GST Tax Invoice (SAC 998314) with automatic CGST/SGST vs. IGST breakdown."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {canManageBilling && invoice.status === "issued" && (
                <form
                  action={staffUpdateInvoiceStatusAction}
                  className="inline-flex items-center gap-1.5"
                >
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <input type="hidden" name="status" value="paid" />
                  <input type="hidden" name="returnTo" value={returnHere} />
                  <input
                    name="paymentReference"
                    required
                    placeholder="UTR / Ref #"
                    className="adm-input w-32 py-1.5 font-mono text-xs"
                  />
                  <SubmitButton
                    className="adm-btn-secondary py-1.5 text-xs"
                    spinnerSize="xs"
                    pendingText="Saving..."
                  >
                    Mark Paid
                  </SubmitButton>
                </form>
              )}
              <CopyTextButton
                text={invoice.invoiceNumber}
                label="Copy Invoice #"
                className="adm-btn-secondary"
              />
              <a
                href={`/api/pdf/invoice?id=${invoice.id}`}
                className="adm-btn-primary"
              >
                Download Official PDF
              </a>
              <PrintInvoiceButton className="adm-btn-secondary" />
            </div>
          }
        />

        <FlashBanner notice={sp.notice} error={sp.error} />
      </div>

      <GstTaxInvoiceDocument {...invoice} />
    </div>
  );
}
