---
title: Setting Up the Windows Tally Prime Live Connector & Auto-Updater
summary: Step-by-step instructions to enable Tally Prime Port 9000, export untouched native Tally PDFs, auto-update .tdl files Over-The-Air, and pair your Windows PC with RapidShift Labs Cloud (rapidshiftlabs.in).
section: Daily Operations
audience: both
service: tally.sync
order: 3
lastReviewed: 2026-11-02
---

## How Tally Prime Port `9000` & Connector `v2.2` Work

Your Tally Prime data stays safely on your office Windows PC. Tally Prime's built-in XML Server listens locally on `http://127.0.0.1:9000` and `rsl-tally-connector.mjs v2.2` syncs outbound over HTTPS to your dedicated SSL endpoint `https://<workspace>.tally.rapidshiftlabs.in`:

- **Multi-Company Sync & Full Delete Reconciliation**: Automatically detects all open companies in Tally Prime, syncs incremental `$AlterID` changes every 30 seconds, and performs periodic full-company snapshot checks so Day Book `Alt + D` deletions reflect cleanly.
- **100% Untouched Native Tally PDF Capture**: Exports Tally Prime's own `Voucher` print report (`<SVEXPORTFORMAT>$$SysName:PDF</SVEXPORTFORMAT>`) by `MasterID` so customers receive the exact PDF invoice layout configured in your Tally Prime — never altered or reformatted.
- **Zero-Touch OTA `.tdl` Self-Updater**: Checks `/api/webhooks/tally?mode=tdl-manifest` in the background and atomically updates your local `rsl-tally-whatsapp.tdl` file whenever a newer TDL release is published.

### Step 1 — Enable Tally Prime Local XML Server (Port 9000)

1. Open **Tally Prime** on your Windows PC with your accounting company(ies) open.
2. Press **F1 (Help) -> Settings -> Connectivity -> Client/Server Configuration**.
3. Set **TallyPrime acts as** = **Both**, **Enable ODBC** = **Yes**, and **Port** = `9000`, then press **Ctrl + A**.
4. Open `http://127.0.0.1:9000` in Chrome or Edge on that PC to verify `<RESPONSE>TallyPrime Server is Running</RESPONSE>`.

### Step 2 — Pair, Verify (`--doctor`), and Start Continuous Sync

1. Open **Tally Prime & Bills -> Connect Tally Prime** (`https://app.rapidshiftlabs.in/tally?tab=connect`).
2. Click **Download Connector (`rsl-tally-connector.mjs`)** and **Generate 15-Min PC Pairing Code**.
3. Run the one-time pairing command in PowerShell or Command Prompt on your Tally PC:

```bash
node rsl-tally-connector.mjs --pair RSL-8F29A1-4C0E77 --server https://your-workspace.tally.rapidshiftlabs.in --device "Accounts Office PC"
```

Run the 2-point connectivity check anytime:

```bash
node rsl-tally-connector.mjs --doctor --server https://your-workspace.tally.rapidshiftlabs.in
```

Start continuous background syncing (with optional `--tdl-path` for automatic OTA `.tdl` updates):

```bash
node rsl-tally-connector.mjs --tdl-path "C:\TallyPrime\rsl-tally-whatsapp.tdl"
```

> **Monorepo CLI Alternative:** `pnpm --filter @rsl/tally-agent start -- --pair RSL-8F29A1-4C0E77 --server https://app.rapidshiftlabs.in --device "Accounts Office PC"` supports the exact same multi-company and native Tally PDF sync flags.
