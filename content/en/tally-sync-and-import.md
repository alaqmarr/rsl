---
title: Tally Prime Cloud Sync, Exact PDF Invoices & WhatsApp Automation
summary: Complete step-by-step setup and troubleshooting guide to connect Tally Prime to RapidShift Labs (rapidshiftlabs.in & *.tally.rapidshiftlabs.in) via .tdl v2.5, send your untouched Tally-printed PDF invoices on WhatsApp, route multiple companies, and sync edits/deletions automatically.
section: Daily Operations
audience: customer
service: tally.sync
order: 2
lastReviewed: 2026-11-02
---

## End-to-End Tally Prime Connection Workflow

Connecting Tally Prime to your RapidShift Labs workspace (`https://<workspace>.tally.rapidshiftlabs.in` on `rapidshiftlabs.in`) follows a verified 4-step workflow inside **Tally Prime & Bills -> Connect Tally Prime**:

1. **Verify Dedicated Client SSL Endpoint & Token**: Each workspace receives its own queued SSL ingress at `https://<workspace>.tally.rapidshiftlabs.in/api/webhooks/tally` and `https://<workspace>.api.rapidshiftlabs.in`. Click **Run Live Endpoint Check** to send a non-destructive `POST /api/webhooks/tally?mode=ping` handshake without adding test bills to your books.
2. **Connect Tally Prime (Method A `.tdl v2.5` or Method B Port `9000` Connector `v2.2`)**: Load the zero-colon `.tdl v2.5` add-on or pair the Windows Connector (`rsl-tally-connector.mjs v2.2`).
3. **Preserve Your Exact Tally-Printed PDF Invoice**: RapidShift **never** changes or redesigns your Tally invoice layout. Whenever Tally Prime exports a bill PDF (via local Port `9000` or the Windows Connector), RapidShift captures Tally Prime's own `Voucher` print output (`%PDF-1.x`) byte-for-byte — preserving your logo, GSTIN, HSN/SAC columns, e-Invoice IRN/QR, bank details, and custom TDL print fields — and attaches that exact PDF to WhatsApp automatically via the `tally_tax_invoice_pdf` (`DOCUMENT` header) template.
4. **Enable Automatic Bill & Overdue Rules**: Configure instant Sales/Receipt WhatsApp rules or scheduled overdue reminders. Outbound messages continue sending smoothly even down to a **-₹200.00** Prepaid Wallet overdraft buffer.

> **Zero Re-Download Architecture:** Because `.tdl v2.5` is a thin event emitter, new WhatsApp templates, multi-company filters, reminder schedules, and server rules take effect on `rapidshiftlabs.in` immediately without touching Tally. And if the `.tdl` file itself ever receives an upgrade, `rsl-tally-connector.mjs` (or the 1-line Windows Scheduled Task in **Connect Tally Prime**) updates `rsl-tally-whatsapp.tdl` Over-The-Air automatically!

## Method A — Tally Prime Cloud Add-On (`.tdl v2.5`)

1. **Download & Overwrite Exact TDL Path**: Open **Tally Prime & Bills -> Connect Tally Prime** and click **Download Pre-Configured .tdl v2.5** to save `rsl-tally-whatsapp.tdl` and overwrite the exact file path configured in Tally Prime (for example `C:\TallyPrime\rsl-tally-whatsapp.tdl`). Do not let Windows rename the file to `rsl-tally-whatsapp (1).tdl`.
2. **Enable Local Port `9000` for Exact Tally PDF Export**: Press **F1 (Help) -> Settings -> Connectivity -> Client/Server Configuration**, set **TallyPrime acts as** = **Both** and **Port** = `9000`, and press **Ctrl + A** so Tally can export its exact native printed PDF whenever a bill is saved.
3. **Load or Reload into Tally Prime Memory**: Press **F1 (Help) -> TDLs & Add-Ons -> F4 (Manage Local TDLs)**, set **Load selected TDL files on startup** = **Yes**, select `rsl-tally-whatsapp.tdl`, and press **Ctrl + A**. Confirm **RSL Cloud Connection Test** and **RSL Sync All Bills Now** appear at the bottom of **Gateway of Tally**.
4. **Verify Connection & Sync Existing Bills**: Click **RSL Cloud Connection Test** on Gateway of Tally to confirm **Connected**, then click **RSL Sync All Bills Now** once to push existing bills and reconcile any deleted Day Book entries.
5. **Automatic Live Create, Alter, Cancel (`Alt + X`) & Delete (`Alt + D`)**:
   - Creating or editing a **Sales (`F8`)**, **Receipt (`F6`)**, **Credit Note (`Alt + F6`)**, or **Purchase (`F9`)** voucher with **Ctrl + A** syncs immediately.
   - Cancelling a bill with **Alt + X** marks it **Cancelled** with ₹0 balance due and cancels unsent reminders.
   - Deleting a bill with **Alt + D** inside the Voucher screen (or reconciling Day Book) removes it from your portal and cancels pending WhatsApp jobs automatically.

## Multi-Company Tally Prime Support

- **All Open Companies vs. Selected Companies**: In **Connect Tally Prime -> Multi-Company Tally Routing**, choose whether this workspace accepts bills from **all open Tally companies** or **only specific company names** (each company's voucher GUIDs are isolated cleanly so Invoice `#1` in Company A never collides with Invoice `#1` in Company B).
- **Multiple RapidShift Workspaces on One Tally PC**: Download the **Multi-Workspace Isolated `.tdl`** (`?isolated=1`) so each workspace uses unique TDL symbol names inside the same Tally Prime window without conflict.

## Troubleshooting Common Tally Desktop Popups

- **`Bad formula! '##RSLPingMsg Then ...'`**: Caused by an older `.tdl` (`v2.3` / `v2.4`) cached in Tally memory where procedural lines contained colons. Overwrite `rsl-tally-whatsapp.tdl` with **`.tdl v2.5`** and press **F1 -> TDLs & Add-Ons -> F4 -> Ctrl + A**.
- **`Could not reach http://localhost:4500/api/webhooks/tally`**: Windows resolved `localhost` to IPv6 `::1` or the local dev server was closed. `.tdl v2.5` automatically uses IPv4 `127.0.0.1:4500` locally and `https://<workspace>.tally.rapidshiftlabs.in` in cloud mode.
