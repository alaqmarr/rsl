"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { IosSpinner } from "@rsl/ui";
import { useWorkspaceAccess } from "@/components/workspace-access-context";

interface SettingsTabItem {
  href: string;
  aliases?: string[];
  label: string;
  description: string;
}

const SETTINGS_TABS: SettingsTabItem[] = [
  {
    href: "/settings/profile",
    label: "My Profile",
    description: "Identity, password & sessions",
  },
  {
    href: "/settings/business",
    label: "Business Settings",
    description: "GSTIN, address, SSL subdomains & Tally company",
  },
  {
    href: "/settings/team",
    label: "Team & Roles",
    description: "Members & invitations",
  },
  {
    href: "/connections",
    label: "Connected Channels",
    description: "WhatsApp, Meta & Google",
  },
  {
    href: "/settings/tokens",
    aliases: ["/developers"],
    label: "All API Tokens",
    description: "Channels, Tally & REST keys",
  },
  {
    href: "/backups",
    label: "Cloud Storage & Backups",
    description: "Google Drive, R2 & .rslbackup",
  },
];

export function SettingsNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { canAccessRoute } = useWorkspaceAccess();
  const [isPending, startTransition] = useTransition();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const visibleTabs = useMemo(
    () => SETTINGS_TABS.filter((tab) => canAccessRoute(tab.href)),
    [canAccessRoute]
  );

  useEffect(() => {
    if (!isPending) {
      setPendingHref(null);
    }
  }, [isPending, pathname]);

  return (
    <div className="w-full rounded-2xl border border-zinc-200/90 bg-white p-1.5 shadow-2xs">
      <nav
        aria-label="Account and workspace settings navigation"
        className="flex flex-wrap items-center gap-1"
      >
        {visibleTabs.map((tab) => {
          const isActive =
            pathname === tab.href ||
            pathname.startsWith(`${tab.href}/`) ||
            Boolean(tab.aliases?.some((a) => pathname === a || pathname.startsWith(`${a}/`)));
          const isLoading = isPending && pendingHref === tab.href;

          return (
            <Link
              key={tab.href}
              href={tab.href}
              title={tab.description}
              onClick={(e) => {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
                  return;
                }
                e.preventDefault();
                if (isActive && pathname === tab.href) return;
                setPendingHref(tab.href);
                startTransition(() => {
                  router.push(tab.href);
                });
              }}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-[13px] transition-all ${
                isActive
                  ? "bg-emerald-50/95 font-semibold text-emerald-900 ring-1 ring-emerald-200/90"
                  : isLoading
                    ? "bg-zinc-100 font-semibold text-slate-900"
                    : "font-medium text-zinc-600 hover:bg-zinc-50 hover:text-slate-900"
              }`}
            >
              <span>{tab.label}</span>
              {isLoading && <IosSpinner size="xs" className="text-emerald-600" />}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
