import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal-page-view";
import { getLegalDocumentBySlug } from "@/lib/legal-documents";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Terms & Conditions - RapidShift Labs",
  description:
    "Master SaaS Terms & Conditions governing the RapidShift Labs Marketing, Shared Inbox, Cloud Backup, and Tally Prime Automation Suite.",
  alternates: { canonical: "/terms" },
};

export default function TermsAndConditionsPage() {
  const { doc, allDocs, entity } = getLegalDocumentBySlug("terms");
  return <LegalDocumentView doc={doc} allDocs={allDocs} entity={entity} />;
}
