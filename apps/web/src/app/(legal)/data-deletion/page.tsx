import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal-page-view";
import { getLegalDocumentBySlug } from "@/lib/legal-documents";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "User Data Deletion, Export & Grievance Redressal - RapidShift Labs",
  description:
    "Step-by-step instructions to export portable workspace archives, revoke OAuth tokens, permanently delete tenant data (Meta Data Deletion URL), and contact our DPDP Act Grievance Officer.",
  alternates: { canonical: "/data-deletion" },
};

export default function DataDeletionPolicyPage() {
  const { doc, allDocs, entity } = getLegalDocumentBySlug("data-deletion");
  return <LegalDocumentView doc={doc} allDocs={allDocs} entity={entity} />;
}
