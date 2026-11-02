# Staff SOP 1 — Verifying UTR Payments, Unlocking Plans, Custom Pricing & GST Invoices

> Staff Reference Only — Finance & Super Admin Standard Operating Procedure (`admin.rapidshiftlabs.in`).

## 1. Verifying a Client's Plan or Bundle Activation Request (`/`)

Clients cannot self-unlock paid plans. Every request lands in **Overview & Requests** (`/`) under **Plan Activation Requests**:

1. **Match the 12-Digit UTR / Bank Reference**:
   - Check the client's submitted **Client Payment Ref** (12-digit UPI UTR or IMPS/NEFT reference) against your corporate bank statement or UPI merchant app.
   - Verify the **Grand Total Received** equals `Quoted Subtotal × 1.18` (inclusive of 18% GST).
2. **Record Payment & Unlock**:
   - Confirm **Billing Cycle** (`Monthly`, `Quarterly`, or `Yearly`).
   - Enter the **Taxable Subtotal Paid (₹)** *(exclude 18% GST here — the system automatically adds 9%+9% CGST/SGST for State `27` or 18% IGST for other states!)*.
   - Select **Payment Method** (`UPI`, `Bank Transfer`, `Razorpay`, `Cash`, `Cheque`) and enter the verified **UTR / Receipt No.**.
   - Keep **Also unlock companion base plans** checked if the plan has prerequisites, then click **Record Payment & Unlock**.
3. **What Happens Automatically**:
   - All included tools unlock immediately on the client's workspace.
   - A sequential Rule 46 GST Tax Invoice (`RSL/26-27/XXXX`) is issued and marked **Paid**.
   - An audit log entry is recorded permanently under your staff ID.
4. **If UTR Is Invalid or Unpaid**: Enter a clear reason (e.g. `UTR not found in bank statement — please double-check 12-digit UPI Ref No.`) and click **Decline**.

---

## 2. Approving Prepaid Wallet Top-Up Requests (`/`)

1. Scroll to **Wallet Top-Up Payments** on **Overview & Requests** (`/`).
2. Cross-check the client's **Method & UTR Number** and **Amount (₹)** against your bank credit alert.
3. Click **Approve & Add Balance** once confirmed in the bank account:
   - If the client was using their **`-₹200.00` overdraft buffer** (e.g. `-₹65.00`), the top-up automatically clears `-₹65.00` first and credits the remaining positive rupees into their append-only passbook!
4. For promotional onboarding credits or manual corrections, use **Quick Wallet Adjustment** (`Add Balance (+₹)` or `Deduct Balance (-₹)`) with a mandatory 5+ character audit reason.

---

## 3. Setting Custom Enterprise Pricing, Bundles & Complimentary Access (`/clients/[id]`)

1. Open **Client Directory** (`/clients`) and click any business name to open `/clients/<workspaceId>`.
2. **Complimentary All-Tools Free Access**:
   - Under **Complimentary All-Tools Free Access**, enter number of days (e.g. `7` or `14` days for a guided pilot) and an audit note, then click **Grant Free Access**. All 15 catalog tools unlock cleanly with a countdown pill and zero fake invoice pollution.
3. **Per-Client Custom Pricing Overrides**:
   - Under **Custom Client Plan Pricing**, pick the service or bundle, enter negotiated **Monthly / Quarterly / Yearly (₹)** rates, and save. That client's **Plans & Wallet** modal and UPI QR code automatically quote their custom price!
4. **Updating Platform-Wide Catalog Prices & Bank / UPI Receiving Details (`/pricing`)**:
   - Open **Plan Prices & Bank Info** (`/pricing`) to edit default catalog prices or update the corporate **Beneficiary Name**, **Bank Name**, **Account Number**, **IFSC**, and **UPI ID** shown on all client payment modals and GST invoices.

---

## 4. Managing GST Tax Invoices & CSV Finance Exports (`/invoices`)

1. Open **GST Invoices & Ledger** (`/invoices`).
2. Filter by status (`Paid`, `Issued`, `Void`) or client name, click **Export CSV Ledger** for monthly CA / GSTR-1 filing, or click any invoice number to open `/invoices/<id>` and click **Print / Save PDF**.
3. Never delete GST sequence numbers — if an unpaid manual invoice was raised in error, use **Mark Void** with a reason so invoice serial continuity stays 100% intact for GST audit compliance.
