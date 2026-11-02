import { notFound } from "next/navigation";
import { getInvoiceDetailById } from "@rsl/billing";
import { canRoleAccessWebRoute, formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, GstTaxInvoiceDocument, PageHeader } from "@rsl/ui";
import { CopyTextButton, PrintInvoiceButton } from "@/components/client-utils";
import { ActionLink } from "@/components/ios-feedback";
import { requireWebSession } from "@/lib/session";

export default async function CustomerInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireWebSession();
  const { id } = await params;

  if (!canRoleAccessWebRoute(session.roleSlug, "/billing", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="GST Tax Invoice"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View plans, wallet & invoices"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  const invoice = getInvoiceDetailById(id, { workspaceId: session.workspace.id });
  if (!invoice) {
    notFound();
  }

  return (
    <div className="w-full space-y-6">
      <div className="no-print">
        <PageHeader
          eyebrow={
            <ActionLink
              href="/billing?tab=invoices"
              spinnerSize="xs"
              className="text-xs font-semibold text-zinc-500 hover:text-slate-900"
            >
              ← Back to GST Tax Invoices
            </ActionLink>
          }
          title={`Tax Invoice ${invoice.invoiceNumber}`}
          subtitle="Official GST Tax Invoice (SAC 998314). Click Print / Save PDF to download an A4 PDF copy for your Chartered Accountant."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <CopyTextButton
                text={invoice.invoiceNumber}
                label="Copy Invoice #"
                className="rsl-btn-secondary"
              />
              <a
                href={`/api/pdf/invoice?id=${invoice.id}`}
                className="rsl-btn-primary"
              >
                Download Official PDF
              </a>
              <PrintInvoiceButton className="rsl-btn-secondary" />
            </div>
          }
        />
      </div>

      <GstTaxInvoiceDocument {...invoice} />
    </div>
  );
}
