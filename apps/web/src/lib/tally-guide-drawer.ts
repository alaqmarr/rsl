import type { GuideDrawerContent } from "@rsl/ui";

export function buildTallySuiteGuideContent(params?: {
  tdlFilename?: string;
  installerFilename?: string;
  brandTitle?: string;
  otaTaskCommand?: string;
}): GuideDrawerContent {
  const tdlFile = params?.tdlFilename || "business-rsl-sync.tdl";
  const installerFile = params?.installerFilename || "rsl-tally-setup.bat";
  const brand = params?.brandTitle || "RapidShift Sync";

  return {
    eyebrow: "Tally Prime Operations & Sync Guide",
    title: "Connect Tally Prime & Configure Live Sync",
    summary:
      "Connect Tally Prime in minutes with zero layout changes to your printed GST invoices, automatic Paid-in-Tally receipt reconciliation, and multi-company ledger isolation.",
    estimatedTime: "~4 min setup",
    fullGuideHref: "/help?slug=tally-sync-and-import",
    fullGuideLabel: "Open Full Tally Guide",
    tabs: [
      {
        id: "tdl",
        label: "Method A • .TDL Add-On",
        badge: "v2.9",
        summary:
          "Load your personalized .tdl v2.9 add-on into Tally Prime for instant Ctrl + A push on Sales, Receipts, Payments, Products, and Party Ledgers.",
        prerequisites: [
          "Tally Prime installed on your Windows PC with your company open.",
          `Downloaded ${tdlFile} saved to C:\\TallyPrime\\${tdlFile} (avoid duplicate (1).tdl copies).`,
        ],
        steps: [
          {
            title: "Enable Tally Prime Port 9000",
            detail:
              "In Tally Prime, press F1 (Help) → Settings → Connectivity → Client/Server Configuration. Set 'TallyPrime acts as = Both' and 'Port = 9000' so native Tally PDFs, ledgers, and stock items export cleanly.",
          },
          {
            title: "Save Your Personalized .TDL File",
            detail: `Move ${tdlFile} into C:\\TallyPrime\\${tdlFile}, overwriting any older version so Tally loads the latest v2.9 sync engine.`,
          },
          {
            title: "Load Add-On into Tally Memory",
            detail:
              "Press F1 (Help) → TDLs & Add-Ons → F4 (Manage Local TDLs). Set 'Load selected TDL files on startup = Yes', enter the full file path, and press Ctrl + A to reload memory.",
          },
          {
            title: "Verify Endpoint Handshake",
            detail: `On Gateway of Tally, click '${brand} - Test Connection'. Tally verifies your workspace token and registers every open Tally company.`,
          },
          {
            title: "Push Existing Products, Ledgers & Bills",
            detail: `Click '${brand} - Sync All Now' on Gateway of Tally (or press Alt + R inside Day Book) to upload existing Godowns, Stock Items, Party Ledgers, and Vouchers.`,
          },
          {
            title: "Save Vouchers Normally with Ctrl + A",
            detail:
              "Every Sales (F8), Receipt (F6), Payment (F5), Purchase (F9), Credit Note, Debit Note, or Alt + C master creation syncs live without overwriting earlier bills.",
            tip: "Exact Tally-printed PDF layout (logo, GSTIN, e-Invoice QR, bank details) is preserved byte-for-byte via Tally's native Voucher print engine.",
          },
        ],
      },
      {
        id: "connector",
        label: "Method B • Windows Connector",
        badge: "Recommended",
        summary:
          "Pair the lightweight Windows Connector for continuous 30-second multi-company sync, exact native Tally PDF capture, deleted-bill reconciliation, and automatic OTA .tdl updates.",
        steps: [
          {
            title: "Confirm Port 9000 XML Server is Active",
            detail:
              "Open Tally Prime and verify F1 → Settings → Connectivity → Client/Server = Both on 127.0.0.1:9000.",
          },
          {
            title: "Run the 1-Click Windows Setup Launcher",
            detail: `Download ${installerFile} (or rsl-tally-connector.mjs on Node.js 20+) onto your Tally PC and double-click to pair with your 15-minute pairing code.`,
          },
          {
            title: "Automatic Background Sync & OTA Updates",
            detail:
              "Leave the connector minimized. Every 30 seconds it syncs all open Tally companies, uploads untouched Tally-printed PDFs, and updates your local .tdl file over-the-air whenever new platform features ship.",
            code: params?.otaTaskCommand,
            codeLanguage: "powershell",
            tip: "CA firms managing separate workspaces on one PC can select 'Only Selected Companies' and download a workspace-namespaced .tdl file.",
          },
        ],
      },
      {
        id: "settings",
        label: "F11 / F12 Tally Settings",
        summary:
          "Set these Tally Prime flags once so Stock Items, Standard Selling Prices, Multi-Company books, and Bill-by-Bill settlements flow automatically.",
        steps: [
          {
            title: "F11 Inventory & GST Features",
            detail:
              "Press F11 (Features) in Tally Prime and set both 'Maintain Inventory = Yes' and 'Enable Goods and Services Tax (GST) = Yes'.",
          },
          {
            title: "F12 Standard Buying & Selling Rates",
            detail:
              "While creating or editing a Stock Item (Create → Stock Item or Alt + C), press F12 (Configure) and set 'Provide Standard Buying and Selling Rates = Yes' so UOM, HSN, GST %, and prices sync to Inventory.",
          },
          {
            title: "F3 Multi-Company Selection",
            detail:
              "Tally exports companies currently open in memory. Press F3 (Company) → Select Company to open all active companies or financial years, then run Sync All Now once.",
          },
          {
            title: "F11 Bill-Wise Entry & Party Mobile Numbers",
            detail:
              "Enable 'Bill-wise entry = Yes' in F11. Inside each Customer Ledger (Alter → Ledger), set 'Maintain balances bill-by-bill = Yes', press F12 → 'Provide Contact Details = Yes', and enter their 10-digit Mobile number.",
            tip: "When recording an F6 Receipt or F5 Payment, select 'Agst Ref' and pick the invoice number to mark it Paid automatically.",
          },
        ],
      },
      {
        id: "troubleshooting",
        label: "Troubleshooting",
        summary:
          "Quick checks if 'Run Live Endpoint Check' succeeds but a newly saved Tally invoice does not appear in your register.",
        steps: [
          {
            title: "Reload .TDL v2.9 into Tally Memory",
            detail: `Confirm 'Last Client Source' shows TallyPrime-RSL-TDL/2.9. Overwrite ${tdlFile} and press F1 → TDLs & Add-Ons → F4 → Ctrl + A.`,
          },
          {
            title: "Sync Previously Saved Bills",
            detail: `Endpoint Check only tests connectivity. Click '${brand} - Sync All Now' on Gateway of Tally (or 'Fetch Bills from Tally Now') to pull earlier vouchers.`,
          },
          {
            title: "Verify Local vs. Cloud Target Match",
            detail:
              "Use the 127.0.0.1:4500 .tdl only when running the platform locally on the same PC; use your cloud *.tally subdomain .tdl in production.",
          },
          {
            title: "Check Company Filter & Optional Status",
            detail:
              "Ensure Company Routing is set to 'Sync All Open Companies' (or matches the exact Tally company name). Optional quotes (Ctrl + L), zero-value drafts, and Journal/Contra entries are intentionally skipped.",
          },
        ],
        cautions: [
          "For automatic WhatsApp PDF delivery, ensure the Party Ledger has a valid 10-digit mobile number, WhatsApp Cloud API is connected, and an active rule is enabled under WhatsApp Rules.",
        ],
      },
    ],
  };
}
