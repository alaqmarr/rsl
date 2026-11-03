---
title: Tally Prime Cloud Sync, Party Mobile Setup, Exact PDF Invoices & Rules
summary: Complete minute-by-minute guide to enter mobile numbers in Tally Party Ledgers, enable Port 9000, load .tdl v2.5 without Windows filename mistakes, send 100% untouched Tally-printed PDF invoices on WhatsApp, route multiple companies, and handle edits/deletions.
section: Daily Operations
audience: customer
service: tally.sync
order: 4
lastReviewed: 2026-11-03
---

## Core Guarantee — Your Tally Invoice PDF Is Never Altered

RapidShift Labs **never** redesigns, re-templates, or alters your Tally Prime invoice PDF. When Tally Prime exports a bill via local Port `9000` or the Windows Connector, RapidShift captures Tally Prime's own native `Voucher` print output (`%PDF-1.x`) byte-for-byte — preserving your company logo, custom TDL columns, HSN/SAC table, e-Invoice IRN & QR code, e-Way Bill details, bank details, and authorised signatory box — and delivers that exact PDF on WhatsApp using the `tally_tax_invoice_pdf` (`DOCUMENT` header) template.

![Tally Prime to Cloud Dashboard and WhatsApp Sync Architecture](/diagrams/tally-sync-architecture.svg)

> [!IMPORTANT] Built-in Data Protection: If Tally Prime is restarting or has no company open (returning 0 bills), the `RSL-SYNC-CIRCUIT-BREAKER` safeguard blocks empty snapshot deletion so your cached bills and pending reminders remain untouched.

---

## Pre-Step 0 — Enter Customer Mobile Numbers in Tally Party Ledgers (Do Not Skip)

For Tally Prime to tell WhatsApp *which* phone number should receive a customer's bill, the customer's 10-digit mobile number must be saved inside their **Party Ledger** in Tally Prime:

1. Open **Tally Prime** on your Windows PC and open your accounting company.
2. On **Gateway of Tally**, select **Alter** -> select **Ledger** -> press **Enter** -> choose a customer ledger (under `Sundry Debtors`).
3. **If you do NOT see a `Mobile no.` field on the Ledger screen:**
   - Press **F12 (Configure)** while inside the Ledger Alteration screen.
   - Find **Provide Contact Details** (under *Party Details*) and type **Yes**, then press **Ctrl + A** to save F12 configuration.
4. Back on the Ledger screen, move the cursor down to **Mailing Details / Contact Details -> Mobile no.** (or set **Provide multiple mobile numbers** = **No** and enter the primary number in **Mobile no.**):
   - Type the customer's **10-digit Indian mobile number** (for example `9820011223` or `+919820011223` — RapidShift automatically normalizes `9820011223`, `09820011223`, and `919820011223` to `+919820011223`).
5. Press **Ctrl + A** to save the Party Ledger.
   - *(Tip: If a party's mobile number was missing when a bill synced, you can also add the customer's phone number under **Customer Messages -> Contacts** in RapidShift Labs with the matching company/party name)*

---

## Step 1 — Verify Your Dedicated Tally HTTPS Endpoint

1. Sign in to `https://app.rapidshiftlabs.in` and click **Tally Prime & Bills** (`/tally`) in the left sidebar.
2. Click the **Connect Tally Prime** tab (`/tally?tab=connect`).
3. Confirm your dedicated SSL endpoint URL (`https://<your-slug>.tally.rapidshiftlabs.in/api/webhooks/tally`) shows **SSL Active**.
4. Click **Run Live Endpoint Check**:
   - RapidShift sends a safe `POST /api/webhooks/tally?mode=ping` test pulse (zero fake vouchers are added to your books) and confirms **Endpoint Verified**.

---

## Step 2 — Enable Tally Prime Local XML Server on Port `9000` (For Native Tally PDFs)

1. Open **Tally Prime** on your Windows PC.
2. Press **F1 (Help)** at the top-right bar of Tally Prime.
3. Select **Settings** -> press **Enter**.
4. Select **Connectivity** -> press **Enter**.
5. Select **Client/Server Configuration** -> press **Enter**.
6. Configure the four fields exactly as follows:
   - **TallyPrime acts as**: select **Both**
   - **Enable ODBC**: type **Yes**
   - **Port**: type `9000`
   - Leave SSL / other advanced rows at their default values.
7. Press **Ctrl + A** to save. If Tally Prime asks **Restart TallyPrime to apply changes?**, click **Yes** (or press **Y**).
8. **Minute Verification Check on Your PC**: Open Chrome or Edge on that same Windows PC and visit `http://127.0.0.1:9000`. You should see `<RESPONSE>TallyPrime Server is Running</RESPONSE>` (or a blank XML page with no "This site can't be reached" error).

---

## Step 3 — Find Your Exact Tally Prime Folder & Download `.tdl v2.5` Safely

1. **Find your exact Tally folder on Windows**:
   - Minimize Tally Prime to your Windows Desktop.
   - **Right-click** the **TallyPrime** shortcut icon on your Desktop -> click **Open file location** (it usually opens `C:\Program Files\TallyPrime` or `C:\TallyPrime`).
   - Click inside the top folder address bar in Windows File Explorer and press **Ctrl + C** to copy that folder path (or create a dedicated simple folder `C:\TallyPrime` so there are no Windows Administrator permission prompts).
2. **Prevent Windows from Hiding `.txt` or Renaming `(1)`**:
   - In Windows File Explorer, click **View -> Show -> File name extensions** (make sure there is a checkmark next to **File name extensions**).
   - Back in RapidShift Labs (**Tally Prime & Bills -> Connect Tally Prime**), click **Download Pre-Configured `.tdl v2.5`**.
   - Save the file directly into `C:\TallyPrime\rsl-tally-whatsapp.tdl`.
   - **Critical Check:** If an older `rsl-tally-whatsapp.tdl` already exists in that folder, **overwrite/replace** it — never let Chrome/Edge save it as `rsl-tally-whatsapp (1).tdl`, because Tally Prime will keep loading the old file.

---

## Step 4 — Load `.tdl v2.5` into Tally Prime Memory (Exact Keystrokes)

1. Switch to **Tally Prime** and press **F1 (Help)** at the top right.
2. Arrow down to **TDLs & Add-Ons** and press **Enter**.
3. Look at the right-hand vertical button bar and press **F4 (Manage Local TDLs)**.
4. Set **Load selected TDL files on startup** = **Yes** and press **Enter**.
5. On the first empty row under **List of TDL Files to preload on startup**:
   - Choose **Specify Path** (or paste the path directly).
   - Type or paste (`Ctrl + V`): `C:\TallyPrime\rsl-tally-whatsapp.tdl` and press **Enter**.
   - Set **Load TDL** = **Yes** and press **Enter**.
   - On the next blank line, select **End of List**.
6. Press **Ctrl + A** to accept and compile the TDL.
7. Look at the **TDLs & Add-Ons** list before pressing Escape: next to `rsl-tally-whatsapp.tdl`, confirm the status says **`Loaded`** (not `Error` or `Not Loaded`).
8. Press **Esc** once to return to **Gateway of Tally**. Look at the bottom of the **Gateway of Tally** menu — you will now see two new items:
   - **RSL Cloud Connection Test**
   - **RSL Sync All Bills Now**

---

## Step 5 — Test Connection & Sync Existing Tally Bills

1. On **Gateway of Tally**, arrow down to **RSL Cloud Connection Test** and press **Enter**:
   - Tally Prime sends a live handshake to `https://<your-slug>.tally.rapidshiftlabs.in` and pops up a confirmation box showing **Connected**.
2. Next, arrow down to **RSL Sync All Bills Now** and press **Enter**:
   - Tally Prime pushes your open company's bills and receipts to RapidShift Labs and reconciles any previously deleted Day Book vouchers.
3. Switch to your browser at `https://app.rapidshiftlabs.in/tally`:
   - Confirm the status banner turns green (**Live Connected**) and your synced bills appear in the **Synced Tally Bills & Receipts** table.

---

## Step 6 — Set Up Automatic Untouched Tally PDF Invoice & Reminder Rules

1. First, make sure your WhatsApp templates are loaded and `APPROVED`:
   - Open **WhatsApp & Templates** (`/whatsapp`), click **Load Ready-Made Tally Templates**, and click **Sync Templates with WhatsApp**.
2. Return to **Tally Prime & Bills** (`/tally`) and scroll to **Instant Voucher Event WhatsApp Rules**:
   - **Voucher Type Trigger**: select **Sales (`Sales` — Send Bill / Native Tally PDF)**.
   - **Approved WhatsApp Template**: select **`tally_tax_invoice_pdf`** (this template includes a `DOCUMENT` header slot so RapidShift attaches your exact untouched Tally-printed PDF invoice automatically).
   - Keep **Attach Native Tally Prime Printed PDF** enabled and click **Create Automation Rule**.
3. Optional — Add a **Payment Receipt Rule**:
   - Create a second rule with **Voucher Type**: `Receipt` and **Template**: `tally_payment_receipt_thankyou` so customers receive an instant WhatsApp receipt acknowledgment the second you press **Ctrl + A** on an `F6 Receipt` voucher in Tally.
4. Optional — Add **Scheduled Overdue Payment Reminders**:
   - Scroll to **Scheduled Overdue Payment Reminder Rules**.
   - Choose when to remind unpaid `Sales` bills (for example `3 days before due date`, `On due date`, or `7 days after due date`), pick `tally_overdue_payment_reminder`, and click **Save Reminder Rule**.

---

## How Live Edits, Cancellations (`Alt + X`) & Deletions (`Alt + D`) Work Automatically

- **New or Altered Bill (`F8 Sales`, `F6 Receipt`, `Alt + F6 Credit Note` -> `Ctrl + A`)**: Syncs to RapidShift within seconds; updates amount/due date without creating duplicate vouchers.
- **Optional Vouchers (`Ctrl + L` Optional)**: Automatically skipped so proforma/draft memos never trigger customer WhatsApp messages until converted to a Regular voucher.
- **Cancelled Voucher (`Alt + X` in Day Book or Voucher)**: Immediately marks the voucher **Cancelled** in RapidShift with `₹0` balance due and cancels any queued payment reminders.
- **Deleted Voucher (`Alt + D` inside Voucher Alteration)**: Sends a real-time delete event to RapidShift Labs, removing the voucher and cancelling unsent reminders. *(If someone deletes a bill from Day Book list view without opening it, clicking **RSL Sync All Bills Now** or running the Windows Connector reconciles and removes it automatically.)*

---

## Multi-Company Tally Prime Routing & Manual XML/CSV Import

- **Filtering Specific Tally Companies**: If you open 3 companies inside Tally Prime on the same PC (e.g., `Shree Traders FY 26-27`, `Shree Exports`, and a personal ledger company) and only want `Shree Traders FY 26-27` in this workspace, open **Tally Prime & Bills -> Connect Tally Prime -> Multi-Company Tally Routing**, switch from **Accept All Open Companies** to **Only Selected Company Names**, type `Shree Traders FY 26-27`, and click **Save Routing**.
- **Two RapidShift Workspaces on One Tally PC**: Append `?isolated=1` (click **Download Isolated Multi-Workspace `.tdl`** in **Connect Tally Prime**) so each `.tdl` file uses workspace-prefixed TDL symbol names and both load cleanly side-by-side in `F4 Manage Local TDLs`.
- **Manual Offline Upload Fallback (XML or CSV)**: If your Tally PC has no internet temporarily, export Day Book in Tally Prime (**Alt + E -> Export -> Day Book -> Format: XML (Data Interchange)**), then upload that `.xml` or `.csv` file in the **Manual XML / CSV Import** card on `/tally`.

---

## Troubleshooting Tally Desktop Errors

| Message / Symptom | Exact Root Cause | Minute-by-Minute Fix |
| --- | --- | --- |
| `Bad formula! '##RSLPingMsg Then ...'` | An older `.tdl` (`v2.3`/`v2.4`) is still loaded in Tally memory | Download `.tdl v2.5`, overwrite `C:\TallyPrime\rsl-tally-whatsapp.tdl`, press `F1 -> TDLs & Add-Ons -> F4 -> Ctrl + A` |
| Bill synced, but **No WhatsApp Sent** | Party Ledger in Tally has blank `Mobile no.`, or template not `APPROVED` | Open Party Ledger in Tally (`Alter -> Ledger -> F12 Provide Contact Details: Yes`), add 10-digit mobile, re-save voucher (`Ctrl + A`) |
| WhatsApp text arrived without PDF | Tally Local Port `9000` is off or rule used a text-only template | Enable Port `9000` (`F1 -> Settings -> Connectivity -> Client/Server -> Both / 9000`), pair Windows Connector (`v2.2`), and select `tally_tax_invoice_pdf` |
| `Tally File Not Found` in `F4` | Windows saved file as `rsl-tally-whatsapp.tdl.txt` | Enable `View -> Show -> File name extensions` in File Explorer and rename to exact `.tdl` |
