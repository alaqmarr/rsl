import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal-page-view";
import { getLegalDocumentBySlug } from "@/lib/legal-documents";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Acceptable Use & WhatsApp Messaging Compliance Policy — RapidShift Labs",
  description:
    "Mandatory WhatsApp opt-in consent rules, automatic STOP suppression, Meta Business Messaging compliance, and anti-spam standards.",
  alternates: { canonical: "/acceptable-use" },
};

export default function AcceptableUsePolicyPage() {
  const { doc, allDocs, entity } = getLegalDocumentBySlug("acceptable-use");
  return <LegalDocumentView doc={doc} allDocs={allDocs} entity={entity} />;
}
