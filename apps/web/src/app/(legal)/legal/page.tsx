import type { Metadata } from "next";
import { LegalHubView } from "@/components/legal-page-view";
import { getAllLegalDocuments, getLegalEntityContext } from "@/lib/legal-documents";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Legal, Privacy & Compliance Center - RapidShift Labs",
  description:
    "Public Privacy Policy, Terms & Conditions, GST Payment Terms, Refund & Cancellation Policy, Service Delivery, Acceptable Use, Cookie Policy, and Data Deletion disclosures.",
  alternates: { canonical: "/legal" },
};

export default function LegalHubPage() {
  const entity = getLegalEntityContext();
  const allDocs = getAllLegalDocuments(entity);
  return <LegalHubView allDocs={allDocs} entity={entity} />;
}
