# Staff SOP 2 — Client Onboarding, WhatsApp Approvals & Tally Prime Support

> Staff Reference Only — Support & Super Admin Standard Operating Procedure (`admin.rapidshiftlabs.in`).

## 1. Onboarding a New Client Business Directly (`/clients`)

1. Open **Client Directory** (`/clients`) in the Staff Portal left sidebar.
2. Fill in the **Onboard New Client Business** form:
   - **Business Name**: Legal GST trade name (used to generate `<slug>.tally.rapidshiftlabs.in` and `<slug>.api.rapidshiftlabs.in`).
   - **State Code**: Exact 2-digit Indian GST State Code (`27` for Maharashtra = `9% CGST + 9% SGST`; all other states = `18% IGST`).
   - **15-Character GSTIN** *(optional at creation, required for B2B GST input credit)*: Must match the first 2 digits of the State Code.
   - **Owner Full Name**, **Owner Email**, and **Initial Password** (share securely and advise the owner to rotate it immediately in `My Profile -> Change Password`).
3. Click **Create Client Account**:
   - Automatically provisions the client's isolated SQLite tenant database (`tenant_<id>.db` + `tenant_<id>_logs.db`), seeds all 6 system RBAC roles, and registers `<slug>.tally.rapidshiftlabs.in` + `<slug>.api.rapidshiftlabs.in`.
4. Need negotiated enterprise rates or initial trial unlocks? Click **Manage Client →** (`/clients/<id>`) to set **Custom Negotiated Plan Overrides**, grant **Direct Feature Access**, or credit promotional wallet balance with a documented reason.

---

## 2. Reviewing WhatsApp Templates & Tally Sync Health (`/templates`)

1. Open **WhatsApp & Tally** (`/templates`) in the Staff Portal sidebar.
2. **Push Official Starter Templates**: Select any client workspace and push the 4 official Tally Prime starter templates (`tally_tax_invoice_pdf`, `tally_sales_bill_created`, `tally_payment_receipt_thankyou`, `tally_overdue_payment_reminder`) if they haven't loaded them yet.
3. **Approve / Flag Templates**:
   - Verify template placeholders (`{{1}}`, `{{2}}`, `{{3}}`, `{{4}}`) are strictly sequential with **no variable at the very start or very end** of the body text.
   - Confirm transactional Tally bill/receipt templates use **`UTILITY`** and promotional festival/discount templates use **`MARKETING`**.
4. **Inspect Tally Links**: Check each client's synced voucher count, paired Windows Connector devices, and dedicated `.tally.rapidshiftlabs.in` webhook pulse timestamp.

---

## 3. Guided Tally Prime `.tdl v2.5` Troubleshooting Checklist (During a Client Call)

When helping a client's accountant over phone or screen-share (AnyDesk / Zoom / Google Meet), verify these **5 exact items in strict order**:

1. **Party Ledger Mobile Number (`F12` Contact Details)**:
   - In Tally Prime: `Gateway of Tally -> Alter -> Ledger -> select Customer Party Ledger -> press F12 -> set "Provide Contact Details" to Yes -> enter 10-digit Mobile no. -> press Ctrl + A`.
   - *Note*: Without a valid 10-digit mobile number on the Party Ledger, Tally syncs the bill to RapidShift for cashflow analytics, and safely skips WhatsApp dispatch (`Skipped: Missing Mobile`).
2. **Local XML Server Port `9000`**:
   - Press `F1 (Help) -> Settings -> Connectivity -> Client/Server Configuration` -> set `TallyPrime acts as: Both`, `Enable ODBC: Yes`, `Port: 9000` -> `Ctrl + A` -> restart Tally if prompted -> open `http://127.0.0.1:9000` in Chrome on that PC and confirm `<RESPONSE>TallyPrime Server is Running</RESPONSE>`.
3. **Exact `.tdl v2.5` File Path (Zero `(1)` Suffix or `.txt` Extension)**:
   - Open Windows File Explorer -> `View -> Show -> File name extensions` (tick ON).
   - Confirm the file downloaded from `/tally?tab=connect` is saved cleanly at `C:\TallyPrime\rsl-tally-whatsapp.tdl` (never `rsl-tally-whatsapp (1).tdl` or `.tdl.txt`).
4. **Reload TDL in Tally Memory**:
   - Press `F1 (Help) -> TDLs & Add-Ons -> F4 (Manage Local TDLs)` -> `Load selected TDL files on startup: Yes` -> `C:\TallyPrime\rsl-tally-whatsapp.tdl` -> `Load TDL: Yes` -> `Ctrl + A` -> confirm status says **`Loaded`**.
5. **Gateway of Tally Verification & Untouched Native PDF Rule**:
   - On Gateway of Tally right-hand bar, click **`RSL Cloud Connection Test`** (confirm `Connected`), then click **`RSL Sync All Bills Now`**.
   - On `/tally?tab=rules`, confirm their `Sales` rule uses **`tally_tax_invoice_pdf`** so Tally's exact native printed GST PDF invoice (exported locally by Tally before HTTP upload) is sent untouched!

---

## 4. Assisting With Windows Background Connector Agent (`rsl-tally-agent.mjs`)

If the client runs multi-company Tally Prime or wants automatic 5-minute background sweeps + PDF attachment capture:

1. Verify Node.js LTS (`node -v` >= `v20`) is installed on the Tally Windows PC (`https://nodejs.org`).
2. Download `rsl-tally-agent.mjs` from `/tally?tab=connect` into `C:\RSLConnector\rsl-tally-agent.mjs`.
3. Generate a 15-minute `rsl_pair_...` code on `/tally?tab=connect` and run:
   ```powershell
   cd C:\RSLConnector
   node rsl-tally-agent.mjs --pair rsl_pair_XXXX --server https://app.rapidshiftlabs.in --tally http://127.0.0.1:9000
   node rsl-tally-agent.mjs --doctor
   ```
4. Register auto-start in Windows `taskschd.msc` (`At startup`, `Run whether user is logged on or not`, Program `C:\Program Files\nodejs\node.exe`, Arguments `C:\RSLConnector\rsl-tally-agent.mjs`, Start in `C:\RSLConnector`).

---

## 5. Resolving Common Meta WhatsApp & Instagram Support Tickets

| Client Symptom | Exact Root Cause | Minute-by-Minute Fix |
| --- | --- | --- |
| **`OAuthException (#190): Access token has expired`** | Client pasted the 24-hour temporary test token from Meta Developer Quickstart instead of a System User token | Guide client to `business.facebook.com/settings -> Users -> System Users -> Generate New Token -> Never Expire` with `whatsapp_business_management` + `whatsapp_business_messaging`, then update `/connections` |
| **`(#131030) Recipient phone number not in allowed list`** | Client is still using Meta's free Test Phone Number instead of their live registered SIM number | Either add test recipient under Meta App `WhatsApp -> API Setup -> Manage phone number list`, or register their live business number and add a payment card in Meta Billing |
| **Instagram DMs not appearing in `/inbox`** | Mobile app toggle `Allow Access to Messages` is OFF | On the client's phone: `Instagram App -> Settings and privacy -> Messages and story replies -> Message controls -> Connected tools -> Allow access to messages = ON` |
