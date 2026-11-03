import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal-page-view";
import { getLegalDocumentBySlug } from "@/lib/legal-documents";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Data Processing & Security Addendum (DPA) — RapidShift Labs",
  description:
    "Per-tenant SQLite isolation, AES-256-GCM envelope encryption, SHA-256 hash-chained audit logs, sub-processors, and 72-hour CERT-In/DPDP breach notification commitments.",
  alternates: { canonical: "/dpa" },
};

export default function DpaPage() {
  const { doc, allDocs, entity } = getLegalDocumentBySlug("dpa");
  return <LegalDocumentView doc={doc} allDocs={allDocs} entity={entity} />;
}
