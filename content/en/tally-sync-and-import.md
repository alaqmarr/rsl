---
title: Tally Prime All-in-One Suite — Bills, Direct Product Sync, Multi-Company, Client Ledgers & Exact PDFs
summary: Complete keystroke-by-keystroke Tally Prime guide to configure F11 and F12 settings, load your personalized <business>-rsl-sync.tdl v2.9 add-on, sync Products (Stock Items) and Party Ledgers live on Ctrl + A, detect multiple Tally companies via F3, settle Paid-in-Tally invoices automatically, and send untouched Tally-printed PDF invoices on WhatsApp.
section: Daily Operations
audience: customer
service: tally.sync
order: 4
lastReviewed: 2026-11-04
---

## Core Guarantees — Zero Bill Overwrites, Direct Product Sync & Untouched Tally PDFs

RapidShift Labs provides an **All-in-One Tally Prime Suite** spanning **Bills & Receipts** (`/tally`), **Client & Supplier Ledgers** (`/tally/parties`), and **Stock & Godown Inventory** (`/inventory`):

1. **Zero Bill Overwrite Guarantee**: Creating sequential bills in Tally Prime (for example **Bill `#8`** followed immediately by **Bill `#9`**) resolves each voucher's exact `MasterID` and `GUID` independently in `.tdl v2.9`, backed by a server-side Non-Destructive Bill Number Collision Shield so earlier saved bills are never replaced.
2. **Direct Real-Time Product & Ledger Sync**: Saving any **Stock Item** or **Party Ledger** in Tally Prime (`Ctrl + A` in Create/Alter or `Alt + C` inside a voucher) pushes the product or ledger directly to RapidShift Labs in real time, while **`<Your Business> & RSL Sync - Sync All Now`** bulk-imports all existing Godowns, Stock Items, Party Ledgers, and Vouchers per company.
3. **100% Untouched Tally-Printed Invoice PDFs**: RapidShift Labs never redesigns or alters your Tally invoice layout. When local Port `9000` or Windows Connector `v2.6` is active, RapidShift exports Tally Prime's native `Voucher` print output (`%PDF-1.x`) byte-for-byte — preserving your company logo, custom TDL columns, HSN/SAC table, e-Invoice IRN/QR code, and authorised signatory box.

![Tally Prime to Cloud Dashboard and WhatsApp Sync Architecture](/diagrams/tally-sync-architecture.svg)

> [!IMPORTANT] Built-in Data Protection: If Tally Prime is restarting or has no company open (returning 0 bills), the `RSL-SYNC-CIRCUIT-BREAKER` safeguard blocks empty snapshot deletion so your synced bills, stock balances, and pending reminders remain untouched.

---

## Pre-Step 0 — Required `F11` Company Features & `F12` Settings in Tally Prime

Follow these one-time keystrokes inside each Tally Prime company you want to sync so Products, Selling Prices, Bill-Wise Settlements, and Customer Mobile Numbers populate accurately:

### A. Enable `F11` Accounting, Bill-Wise & Inventory Features
1. Open **Tally Prime** on your Windows PC and open your company.
2. Press **F11 (Features)** from any screen in Tally Prime:
   - Under **Accounting**: set **Enable Bill-wise entry** = **Yes**.
   - Under **Inventory**: set **Maintain Inventory** = **Yes** and **Integrate Accounts with Inventory** = **Yes**.
   - Under **Taxation**: set **Enable Goods and Services Tax (GST)** = **Yes** (if GST-registered).
3. Press **Ctrl + A** to save `F11` Company Features.

### B. Enable `F12` Mobile Numbers & Credit Terms on Customer / Supplier Ledgers
1. On **Gateway of Tally**, select **Alter** -> **Ledger** -> choose a customer (`Sundry Debtors`) or supplier (`Sundry Creditors`) ledger.
2. Set **Maintain balances bill-by-bill** = **Yes** and enter **Default credit period** (for example `15 Days`) and **Credit limit** (if applicable).
3. If you do not see a **`Mobile no.`** field on the Ledger screen:
   - Press **F12 (Configure)** while inside the Ledger screen.
   - Set **Provide Contact Details** = **Yes**, then press **Ctrl + A**.
4. Enter the customer's **10-digit Indian mobile number** in **Mobile no.** (for example `9820011223` or `+919820011223`) and press **Ctrl + A** to save. With `.tdl v2.9` loaded, pressing **Ctrl + A** immediately syncs that party ledger to `/tally/parties`.

### C. Enable `F12` Standard Buying & Selling Rates on Stock Items (Products)
1. On **Gateway of Tally**, select **Create** (or **Alter**) -> **Stock Item**.
2. Press **F12 (Configure)** while inside the Stock Item screen:
   - Set **Provide Standard Buying and Selling Rates** = **Yes**.
   - Set **Provide Part Number for Stock Items** = **Yes** (optional SKU code).
   - Set **Set GST Details** / **HSN/SAC Details** = **Yes** (if applicable).
   - Press **Ctrl + A** to save `F12` configuration.
3. On the Stock Item screen, enter **Name**, **Under** (Stock Group), **Units** (UOM such as `PCS`, `NOS`, `BOX`, `KG`), **Alter Standard Rates = Yes** (enter Standard Cost and Standard Selling Price), **GST Rate / HSN**, and **Opening Balance** (quantity and rate).
4. Press **Ctrl + A**. With `.tdl v2.9` loaded, the product appears immediately in **Stock & Godown Inventory** (`/inventory`), even if you created it on the fly by pressing **`Alt + C`** while typing a Sales or Purchase bill.

---

## Step 1 — Verify Your Dedicated Tally HTTPS Endpoint

1. Sign in to `https://app.rapidshiftlabs.in` and click **Tally Prime & Bills** (`/tally`) in the left sidebar.
2. Click the **Connect Tally Prime (.tdl & Setup Guide)** tab (`/tally?tab=connect`).
3. Confirm your dedicated SSL endpoint URL (`https://<your-slug>.tally.rapidshiftlabs.in/api/webhooks/tally`) shows **SSL Active**.
4. Click **Run Live Endpoint Check** to send a safe `mode=ping` handshake without adding fake vouchers to your books.

---

## Step 2 — Enable Tally Prime Local XML Server on Port `9000` (For Native Tally PDFs)

1. In **Tally Prime**, press **F1 (Help)** -> **Settings** -> **Connectivity** -> **Client/Server Configuration**.
2. Configure the fields as follows:
   - **TallyPrime acts as**: **Both**
   - **Enable ODBC**: **Yes**
   - **Port**: `9000`
3. Press **Ctrl + A** to save (accept the restart prompt if Tally Prime asks to restart).
4. Open Chrome or Edge on that same Windows PC and visit `http://127.0.0.1:9000`. Confirm you see `<RESPONSE>TallyPrime Server is Running</RESPONSE>`.

---

## Step 3 — Download & Load Your Personalized `<business>-rsl-sync.tdl` (`v2.9`)

1. In Windows File Explorer, click **View -> Show -> File name extensions** so `.tdl` extensions are visible.
2. In RapidShift Labs (**Tally Prime & Bills -> Connect Tally Prime**), click **Download `<your-business>-rsl-sync.tdl` (`v2.9`)**.
3. Save the file directly to `C:\TallyPrime\<your-business>-rsl-sync.tdl`.
   - **Important**: Always **overwrite/replace** any older `.tdl` file in that folder. Do not allow the browser to save a duplicate named `(1).tdl`, or Tally Prime will keep running the old version in memory.
4. Switch to **Tally Prime** and press **F1 (Help)** -> **TDLs & Add-Ons** -> **F4 (Manage Local TDLs)**:
   - Set **Load selected TDL files on startup** = **Yes**.
   - Specify path: `C:\TallyPrime\<your-business>-rsl-sync.tdl`.
   - Set **Load TDL** = **Yes**, select **End of List** on the next blank line, and press **Ctrl + A**.
5. Confirm the status next to `<your-business>-rsl-sync.tdl` says **`Loaded`**, then press **Esc** back to **Gateway of Tally**. You will see two personalized menu items:
   - **`<Your Business Name> & RSL Sync - Connection Test`**
   - **`<Your Business Name> & RSL Sync - Sync All Now`**

---

## Step 4 — Opening & Syncing Multiple Tally Companies (`F3 -> Select Company`)

Tally Prime exports vouchers and masters from companies that are currently **open in Tally memory**:

1. If you operate **multiple Tally companies** (such as Head Office + Branch, Wholesale + Retail, or separate Financial Year books):
   - Press **F3 (Company)** inside Tally Prime -> choose **Select Company** -> open each additional company so all active companies are loaded in Tally Prime's left-hand **List of Open Companies**.
2. On **Gateway of Tally**, click **`<Your Business Name> & RSL Sync - Connection Test`**:
   - `.tdl v2.9` transmits your complete list of open Tally companies (`openCompanies`) and registers every allowed company in RapidShift Labs immediately — even brand-new companies with 0 bills.
3. Next, click **`<Your Business Name> & RSL Sync - Sync All Now`**:
   - `.tdl v2.9` loops through **every open Tally company** one by one, bulk-syncing each company's **Godowns**, **Stock Items (Products)**, **Sundry Debtor & Creditor Ledgers**, **Sales/Purchase/Receipt/Payment/Credit/Debit Vouchers**, and **Day Book Deletion Reconciliations** with strict per-company scoping.
4. In RapidShift Labs, use the **Tally Company** switcher bar right at the top of `/tally`, `/tally/parties`, and `/inventory` to view **All Synced Companies** together or isolate any single Tally company's bills, receivables, and stock valuation.
5. **Restricting Which Open Companies Sync**: If an accountant also opens an unrelated personal company on the same PC, go to **Connect Tally Prime -> Multi-Company Tally Routing**, select **Only Selected Companies**, pick the allowed company names, and click **Save Company Routing**.

---

## Step 5 — Set Up Automatic Untouched Tally PDF Invoice & Overdue Reminder Rules

1. Open **WhatsApp & Templates** (`/whatsapp`), click **Load Ready-Made Tally Templates**, and click **Sync Templates with WhatsApp**.
2. Open **Tally Prime & Bills -> WhatsApp Rules & Reminders** (`/tally?tab=rules`):
   - **Instant Sales PDF Rule**: select **Voucher Type = Sales**, **Template = `tally_tax_invoice_pdf`**, keep **Attach Native Tally Prime Printed PDF** enabled, and click **Create Automation Rule**.
   - **Instant Payment Receipt Rule (Optional)**: select **Voucher Type = Receipt** and **Template = `tally_payment_receipt_thankyou`**.
   - **Scheduled Overdue Reminders (Optional)**: configure rules such as `3 days before due date` or `7 days after due date` with `tally_overdue_payment_reminder`.

---

## How Daily Tally Operations Sync Automatically in `v2.9`

- **Creating Sequential Bills (`F8 Sales`, `F9 Purchase`)**: Saving Bill `#8` and then Bill `#9` with `Ctrl + A` syncs both bills independently along with their inventory `lineItems`, deducting Sales quantities and adding Purchase quantities in `/inventory`.
- **Creating or Editing Products (`Stock Item` or `Alt + C`)**: Saving any Stock Item in Tally Prime pushes its latest name, group, UOM, HSN, GST %, standard selling/cost rates, reorder level, and stock balance directly to `/inventory`.
- **Invoices Marked Paid in Tally (`F6 Receipt`, `F5 Payment`, `Alt + F6 Credit Note`, `Alt + F5 Debit Note`)**: Selecting **Agst Ref** against an invoice number (or posting against the same Party Ledger via FIFO) marks that invoice **Paid** or **Partially Paid**, updates the party's T-account running balance in `/tally/parties`, and cancels pending overdue WhatsApp reminders.
- **Altering, Cancelling (`Alt + X`), Optional (`Ctrl + L`), or Deleting (`Alt + D`)**:
  - Editing an existing bill in Tally **Alter** mode updates it in place (including line-item stock recalculation).
  - Marking a voucher **Optional (`Ctrl + L`)** skips/removes it so proforma drafts never trigger WhatsApp messages.
  - Cancelling (`Alt + X`) or deleting (`Alt + D`) reverses stock movements, clears settlements, and cancels unsent WhatsApp jobs.

---

## Troubleshooting Tally Prime Sync

| Symptom / Message | Root Cause | Exact Fix |
| --- | --- | --- |
| Earlier bill was overwritten or Last Client Source shows `TallyPrime-RSL-TDL/2.8` (or older) | Older `.tdl` file is still loaded in Tally RAM | Download `<business>-rsl-sync.tdl` (`v2.9`), overwrite `C:\TallyPrime\<business>-rsl-sync.tdl`, and press `F1 -> TDLs & Add-Ons -> F4 -> Ctrl + A` |
| Products created in Tally did not appear in `/inventory` | `.tdl v2.9` was not loaded yet, or existing products were created before connecting | Load `.tdl v2.9` via `F1 -> TDLs & Add-Ons -> F4 -> Ctrl + A` and click `<Business> & RSL Sync - Sync All Now` once on Gateway of Tally |
| Second Tally company does not appear in the Tally Company bar | Second company is closed in Tally Prime, or filtered out in Routing | Press `F3 -> Select Company` in Tally Prime so both companies are open, confirm **Sync All Open Companies** in `/tally?tab=connect`, and click `Sync All Now` |
| Product Selling Price shows `₹0` before first invoice | Standard Selling Rate not enabled on the Stock Item in Tally | Open Stock Item in Tally -> press `F12` -> set `Provide Standard Buying and Selling Rates = Yes` -> enter Standard Selling Price -> `Ctrl + A` |
| Bill synced, but no WhatsApp message was sent | Party Ledger has blank `Mobile no.`, or WhatsApp template is not `APPROVED` | Open Party Ledger in Tally (`Alter -> Ledger -> F12 Provide Contact Details = Yes`), add 10-digit mobile number, and press `Ctrl + A` |
| WhatsApp arrived as text without Tally's printed PDF | Tally Local Port `9000` is off or Windows Connector is not running | Enable Port `9000` (`F1 -> Settings -> Connectivity -> Client/Server -> Both / 9000`), run Windows Connector `v2.6`, and use template `tally_tax_invoice_pdf` |
