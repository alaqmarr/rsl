import Link from "next/link";
import {
  FileSpreadsheet,
  KeyRound,
  LayoutGrid,
  MessageSquare,
  ReceiptText,
  RefreshCw,
  Send,
  ShieldCheck,
  TrendingUp,
  UserMinus,
  Wallet,
  Webhook,
} from "lucide-react";
import {
  FacebookBrandIcon,
  GoogleAdsBrandIcon,
  GoogleBrandIcon,
  GoogleBusinessBrandIcon,
  GoogleSearchConsoleBrandIcon,
  InstagramBrandIcon,
  MetaBrandIcon,
  MessengerBrandIcon,
  WhatsAppBrandIcon,
} from "@/components/service-brand-icons";

export interface SuiteSubnavItem {
  key: string;
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: string | number;
}

function SuiteSubnavBar({
  ariaLabel,
  items,
  activeKey,
}: {
  ariaLabel: string;
  items: SuiteSubnavItem[];
  activeKey: string;
}) {
  return (
    <nav aria-label={ariaLabel} className="rsl-tab-bar w-full overflow-x-auto">
      {items.map((item) => {
        const isActive = item.key === activeKey;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={`rsl-tab-pill shrink-0 ${isActive ? "rsl-tab-pill-active" : ""}`}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.badge !== undefined && (
              <span className="ml-1 rounded-full bg-[var(--surface-inset)] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[var(--ink-secondary)]">
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function WhatsAppSuiteNav({
  active,
  templatesCount,
  broadcastsCount,
  suppressionsCount,
}: {
  active: "templates" | "broadcasts" | "contacts";
  templatesCount?: number;
  broadcastsCount?: number;
  suppressionsCount?: number;
}) {
  const items: SuiteSubnavItem[] = [
    {
      key: "templates",
      label: "Message Templates",
      href: "/whatsapp",
      icon: <WhatsAppBrandIcon className="h-3.5 w-3.5" />,
      badge: templatesCount,
    },
    {
      key: "broadcasts",
      label: "Broadcast Campaigns",
      href: "/whatsapp/broadcasts",
      icon: <Send className="h-3.5 w-3.5" />,
      badge: broadcastsCount,
    },
    {
      key: "contacts",
      label: "Opt-Outs & Contacts",
      href: "/whatsapp/contacts",
      icon: <UserMinus className="h-3.5 w-3.5" />,
      badge: suppressionsCount,
    },
    {
      key: "inbox",
      label: "Team Inbox",
      href: "/inbox?channel=whatsapp",
      icon: <MessageSquare className="h-3.5 w-3.5" />,
    },
    {
      key: "connection",
      label: "Connection",
      href: "/connections/whatsapp",
      icon: <RefreshCw className="h-3.5 w-3.5" />,
    },
  ];
  return <SuiteSubnavBar ariaLabel="WhatsApp workspace navigation" items={items} activeKey={active} />;
}

export function MetaFacebookNav({
  active,
}: {
  active: "ads" | "posts" | "pixel";
}) {
  const items: SuiteSubnavItem[] = [
    {
      key: "ads",
      label: "Facebook Ads",
      href: "/meta/facebook/ads",
      icon: <MetaBrandIcon className="h-3.5 w-3.5" />,
    },
    {
      key: "posts",
      label: "Page Posts & Leads",
      href: "/meta/facebook/posts",
      icon: <FacebookBrandIcon className="h-3.5 w-3.5" />,
    },
    {
      key: "pixel",
      label: "Pixel & CAPI",
      href: "/meta/facebook/pixel",
      icon: <TrendingUp className="h-3.5 w-3.5" />,
    },
    {
      key: "messenger",
      label: "Messenger Inbox",
      href: "/inbox?channel=facebook",
      icon: <MessengerBrandIcon className="h-3.5 w-3.5" />,
    },
    {
      key: "connection",
      label: "Facebook Connection",
      href: "/connections/facebook",
      icon: <RefreshCw className="h-3.5 w-3.5" />,
    },
  ];
  return <SuiteSubnavBar ariaLabel="Meta Facebook navigation" items={items} activeKey={active} />;
}

export function MetaInstagramNav({
  active,
}: {
  active: "posts" | "ads";
}) {
  const items: SuiteSubnavItem[] = [
    {
      key: "posts",
      label: "Posts & Reels",
      href: "/meta/instagram/posts",
      icon: <InstagramBrandIcon className="h-3.5 w-3.5" />,
    },
    {
      key: "ads",
      label: "Instagram Ads",
      href: "/meta/instagram/ads",
      icon: <MetaBrandIcon className="h-3.5 w-3.5" />,
    },
    {
      key: "dms",
      label: "Instagram DMs",
      href: "/inbox?channel=instagram",
      icon: <InstagramBrandIcon className="h-3.5 w-3.5" />,
    },
    {
      key: "connection",
      label: "Instagram Connection",
      href: "/connections/instagram",
      icon: <RefreshCw className="h-3.5 w-3.5" />,
    },
  ];
  return <SuiteSubnavBar ariaLabel="Meta Instagram navigation" items={items} activeKey={active} />;
}

export function GoogleSuiteNav({
  active,
  reviewsCount,
}: {
  active: "ads" | "search" | "reviews" | "reviews-automation";
  reviewsCount?: number;
}) {
  const items: SuiteSubnavItem[] = [
    {
      key: "reviews",
      label: "Google Reviews",
      href: "/reviews",
      icon: <GoogleBusinessBrandIcon className="h-3.5 w-3.5" />,
      badge: reviewsCount,
    },
    {
      key: "reviews-automation",
      label: "Auto-Reply Rules",
      href: "/reviews/automation",
      icon: <GoogleBrandIcon className="h-3.5 w-3.5" />,
    },
    {
      key: "ads",
      label: "Google Ads",
      href: "/google/ads",
      icon: <GoogleAdsBrandIcon className="h-3.5 w-3.5" />,
    },
    {
      key: "search",
      label: "Search Console & SEO",
      href: "/google/search",
      icon: <GoogleSearchConsoleBrandIcon className="h-3.5 w-3.5" />,
    },
    {
      key: "connections",
      label: "Google Connections",
      href: "/connections/google-business",
      icon: <RefreshCw className="h-3.5 w-3.5" />,
    },
  ];
  return <SuiteSubnavBar ariaLabel="Google services navigation" items={items} activeKey={active} />;
}

export function BillingSuiteNav({
  active,
  invoicesCount,
}: {
  active: "plans" | "wallet" | "invoices";
  invoicesCount?: number;
}) {
  const items: SuiteSubnavItem[] = [
    {
      key: "plans",
      label: "Plans & Bundles",
      href: "/billing",
      icon: <LayoutGrid className="h-3.5 w-3.5" />,
    },
    {
      key: "wallet",
      label: "Prepaid Wallet & UPI",
      href: "/billing/wallet",
      icon: <Wallet className="h-3.5 w-3.5" />,
    },
    {
      key: "invoices",
      label: "GST Tax Invoices",
      href: "/billing/invoices",
      icon: <ReceiptText className="h-3.5 w-3.5" />,
      badge: invoicesCount,
    },
  ];
  return <SuiteSubnavBar ariaLabel="Billing navigation" items={items} activeKey={active} />;
}

export function BackupsSuiteNav({
  active,
}: {
  active: "backups" | "exports";
}) {
  const items: SuiteSubnavItem[] = [
    {
      key: "backups",
      label: "Backups & Restore",
      href: "/backups",
      icon: <ShieldCheck className="h-3.5 w-3.5" />,
    },
    {
      key: "exports",
      label: "Exports & Imports",
      href: "/backups/exports",
      icon: <FileSpreadsheet className="h-3.5 w-3.5" />,
    },
  ];
  return <SuiteSubnavBar ariaLabel="Backups and exports navigation" items={items} activeKey={active} />;
}

export function TokensSuiteNav({
  active,
}: {
  active: "webhooks" | "api-keys";
}) {
  const items: SuiteSubnavItem[] = [
    {
      key: "webhooks",
      label: "Webhooks & Subdomains",
      href: "/settings/tokens",
      icon: <Webhook className="h-3.5 w-3.5" />,
    },
    {
      key: "api-keys",
      label: "REST API Keys",
      href: "/settings/api-keys",
      icon: <KeyRound className="h-3.5 w-3.5" />,
    },
  ];
  return <SuiteSubnavBar ariaLabel="Developer tokens navigation" items={items} activeKey={active} />;
}
