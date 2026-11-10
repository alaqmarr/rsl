"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { GuideDrawerButton } from "@rsl/ui";
import { resolveWebPageGuide } from "@/lib/page-guides";

export function PageWalkthroughBanner() {
  const pathname = usePathname();
  const guide = resolveWebPageGuide(pathname || "/");
  if (!guide) return null;

  return (
    <GuideDrawerButton
      label="Need help?"
      badgeText={`${guide.steps.length} steps`}
      guide={{
        eyebrow: "Step-by-Step Guide",
        title: guide.title,
        summary: guide.summary,
        estimatedTime: guide.estimatedTime,
        prerequisites: guide.prerequisites,
        steps: guide.steps,
        cautions: guide.commonMistakes,
        cautionsTitle: "Common Mistakes to Avoid",
        fullGuideHref: `/help?slug=${encodeURIComponent(guide.guideSlug)}`,
        fullGuideLabel: "Open Full Guide",
      }}
    />
  );
}
