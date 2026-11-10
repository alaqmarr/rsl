"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { GuideDrawerButton } from "@rsl/ui";
import { resolveAdminPageGuide } from "@/lib/nav-routes";

export function AdminPageWalkthroughBanner() {
  const pathname = usePathname();
  const guide = resolveAdminPageGuide(pathname || "/");
  if (!guide) return null;

  return (
    <div className="no-print mb-4 flex items-center justify-end">
      <GuideDrawerButton
        drawerId={`admin-sop-${guide.routePrefix.replace(/\//g, "-")}`}
        label="Need help? • Staff SOP"
        badgeText={`${guide.steps.length} steps`}
        guide={{
          eyebrow: "Staff Screen SOP Guide",
          title: guide.title,
          summary: guide.summary,
          roleNote: guide.roleNote,
          steps: guide.steps,
          cautions: guide.cautions,
          fullGuideHref: "/runbooks",
          fullGuideLabel: "All Staff SOP Runbooks →",
        }}
      />
    </div>
  );
}
