import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal-page-view";
import { getLegalDocumentBySlug } from "@/lib/legal-documents";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Service Delivery & Provisioning Policy — RapidShift Labs",
  description:
    "Cloud SaaS workspace provisioning timelines, instant automated activation, UTR verification SLAs, and non-physical software delivery terms.",
  alternates: { canonical: "/service-delivery" },
};

export default function ServiceDeliveryPolicyPage() {
  const { doc, allDocs, entity } = getLegalDocumentBySlug("service-delivery");
  return <LegalDocumentView doc={doc} allDocs={allDocs} entity={entity} />;
}
