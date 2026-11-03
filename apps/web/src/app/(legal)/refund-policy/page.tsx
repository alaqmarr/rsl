import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal-page-view";
import { getLegalDocumentBySlug } from "@/lib/legal-documents";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Refund, Cancellation & Credit Note Policy — RapidShift Labs",
  description:
    "7-day free trial policy, 1-click plan cancellation, GST Credit Notes under Section 34 of the CGST Act, and 5–7 business day refund reversal timelines.",
  alternates: { canonical: "/refund-policy" },
};

export default function RefundPolicyPage() {
  const { doc, allDocs, entity } = getLegalDocumentBySlug("refund-policy");
  return <LegalDocumentView doc={doc} allDocs={allDocs} entity={entity} />;
}
