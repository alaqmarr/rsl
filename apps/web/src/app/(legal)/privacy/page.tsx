import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal-page-view";
import { getLegalDocumentBySlug } from "@/lib/legal-documents";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy Policy - RapidShift Labs",
  description:
    "How RapidShift Labs protects business data, Tally Prime bills, Google API Limited Use backups, and WhatsApp Cloud API messages under India's DPDP Act 2023.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPolicyPage() {
  const { doc, allDocs, entity } = getLegalDocumentBySlug("privacy");
  return <LegalDocumentView doc={doc} allDocs={allDocs} entity={entity} />;
}
