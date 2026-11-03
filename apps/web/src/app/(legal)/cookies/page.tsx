import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal-page-view";
import { getLegalDocumentBySlug } from "@/lib/legal-documents";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cookie & Session Security Policy — RapidShift Labs",
  description:
    "Complete inventory of strictly necessary HttpOnly session cookies used by RapidShift Labs, with zero third-party ad trackers.",
  alternates: { canonical: "/cookies" },
};

export default function CookiePolicyPage() {
  const { doc, allDocs, entity } = getLegalDocumentBySlug("cookies");
  return <LegalDocumentView doc={doc} allDocs={allDocs} entity={entity} />;
}
