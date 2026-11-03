import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal-page-view";
import { getLegalDocumentBySlug } from "@/lib/legal-documents";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Payment, Wallet & GST Billing Terms — RapidShift Labs",
  description:
    "INR subscription billing cycles, prepaid messaging wallet, -₹200 courtesy overdraft buffer, and statutory 18% GST Tax Invoicing (SAC 998314).",
  alternates: { canonical: "/payment-terms" },
};

export default function PaymentTermsPage() {
  const { doc, allDocs, entity } = getLegalDocumentBySlug("payment-terms");
  return <LegalDocumentView doc={doc} allDocs={allDocs} entity={entity} />;
}
