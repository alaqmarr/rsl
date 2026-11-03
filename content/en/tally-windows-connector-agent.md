---
title: Windows Tally Prime Background Connector (v2.2) & Automatic Startup
summary: Complete minute-by-minute instructions to install Node.js LTS on Windows, enable Tally Port 9000, pair rsl-tally-connector.mjs v2.2, capture untouched Tally PDFs, auto-update .tdl files Over-The-Air, and configure Windows Task Scheduler so it starts automatically on boot.
section: Daily Operations
audience: both
service: tally.sync
order: 5
lastReviewed: 2026-11-03
---

## Why Use the Windows Background Connector (`rsl-tally-connector.mjs v2.2`)?

While the `.tdl v2.5` add-on pushes instant events from inside Tally Prime, running **`rsl-tally-connector.mjs v2.2`** in the background on your Tally Windows PC adds three powerful capabilities:

- **100% Untouched Native Tally PDF Capture**: Exports Tally Prime's exact printed `Voucher` PDF (`%PDF-1.x`) over local `http://127.0.0.1:9000` by `MasterID` and uploads it over encrypted HTTPS to `https://<your-slug>.tally.rapidshiftlabs.in` so customers receive your exact Tally print format on WhatsApp.
- **Full Multi-Company & Day Book Delete Reconciliation**: Polls `$AlterID` every 30 seconds across all open Tally companies and reconciles full voucher snapshots so even bulk `Alt + D` deletions made directly in Day Book sync cleanly.
- **Zero-Touch Over-The-Air (OTA) `.tdl` Auto-Updates**: Checks `/api/webhooks/tally?mode=tdl-manifest` automatically and updates `C:\TallyPrime\rsl-tally-whatsapp.tdl` on disk whenever a new `.tdl` version is released.

---

## Step 1 — Check or Install Node.js LTS (v20 or Newer) on Your Tally PC

1. On your Tally Windows PC, press **Win + R** on your keyboard, type `powershell`, and press **Enter**.
2. Type `node -v` and press **Enter**:
   - **If you see `v20.x.x`, `v22.x.x`, or `v24.x.x`:** Node.js is already installed. Skip straight to **Step 2**.
   - **If you see `'node' is not recognized`:**
     - Open Chrome or Edge and go to `https://nodejs.org`.
     - Click **Download Node.js (LTS)** to download the `.msi` Windows Installer.
     - Double-click the downloaded `.msi` file -> click **Next -> Accept License -> Next -> Next -> Next -> Install** (leave all default PATH checkboxes ticked) -> click **Finish**.
     - **Close** your old PowerShell window, open a **new** PowerShell window (`Win + R -> powershell`), and run `node -v` to confirm `v22.x.x` prints.

---

## Step 2 — Enable Tally Prime Local XML Server on Port `9000`

1. Open **Tally Prime** with your company open.
2. Press **F1 (Help) -> Settings -> Connectivity -> Client/Server Configuration**.
3. Set:
   - **TallyPrime acts as**: `Both`
   - **Enable ODBC**: `Yes`
   - **Port**: `9000`
4. Press **Ctrl + A** (and allow Tally Prime to restart if asked).
5. Open `http://127.0.0.1:9000` in your browser on that PC and confirm you see `<RESPONSE>TallyPrime Server is Running</RESPONSE>`.

---

## Step 3 — Create `C:\RSLConnector` & Download the Connector Script

1. In your PowerShell window, run this command to create a permanent folder that won't be accidentally cleared from `Downloads`:

```powershell
New-Item -ItemType Directory -Force -Path "C:\RSLConnector" | Out-Null
```

2. Open `https://app.rapidshiftlabs.in/tally?tab=connect` (**Tally Prime & Bills -> Connect Tally Prime**).
3. Under **Method B — Windows PC Background Connector (`v2.2`)**, click **Download Connector (`rsl-tally-connector.mjs`)** and save it directly into `C:\RSLConnector\rsl-tally-connector.mjs`.

---

## Step 4 — Generate a 15-Minute Pairing Code & Pair Your Office PC

1. Still inside **Connect Tally Prime**, click **Generate 15-Min PC Pairing Code**.
2. Copy the pairing code displayed on screen (for example `RSL-8F29A1-4C0E77`).
3. Switch to PowerShell on your Tally PC and run:

```powershell
cd C:\RSLConnector
node rsl-tally-connector.mjs --pair RSL-8F29A1-4C0E77 --server https://your-workspace.tally.rapidshiftlabs.in --device "Accounts Office PC"
```

   *(Tip: Copy the exact pre-filled `--pair` command directly from the **Connect Tally Prime** screen in your dashboard — it already contains your workspace's exact `.tally.rapidshiftlabs.in` URL and fresh pairing code)*
4. Confirm PowerShell prints **`Paired successfully`** — this saves an encrypted HMAC device credential file locally on your PC so you never need to pair again.

---

## Step 5 — Run the 2-Point `--doctor` Health Check & Start Live Sync

1. Verify both local Tally Port `9000` AND cloud HTTPS reachability before going live:

```powershell
node C:\RSLConnector\rsl-tally-connector.mjs --doctor --server https://your-workspace.tally.rapidshiftlabs.in
```

2. Confirm both checks pass (`Tally Port 9000: REACHABLE` and `RapidShift Cloud: AUTHENTICATED`).
3. Run a foreground test sync (pass `--tdl-path` if you also use `.tdl v2.5` so OTA `.tdl` updates stay enabled):

```powershell
node C:\RSLConnector\rsl-tally-connector.mjs --tdl-path "C:\TallyPrime\rsl-tally-whatsapp.tdl"
```

4. Refresh `https://app.rapidshiftlabs.in/tally?tab=connect` — under **Paired Windows PCs**, `Accounts Office PC` now shows a green **Connected** badge with your active Tally company name and last heartbeat timestamp. Press **Ctrl + C** in PowerShell once verified so you can set up automatic background startup next.

---

## Step 6 — Make the Connector Start Automatically When Windows Turns On (Task Scheduler)

So your accountant never has to keep a black PowerShell window open, register the connector in **Windows Task Scheduler** in 60 seconds:

1. Press **Win + R**, type `taskschd.msc`, and press **Enter** to open **Task Scheduler**.
2. In the right-hand **Actions** pane, click **Create Task..** (choose **Create Task..**, not *Create Basic Task*).
3. **General Tab**:
   - **Name**: `RSL Tally Prime Cloud Connector`
   - Select **Run whether user is logged on or not** (or **Run only when user is logged on** if you do not have the Windows login password handy — with `wscript` / minimized PowerShell).
   - Tick **Run with highest privileges**.
4. **Triggers Tab**:
   - Click **New..** -> set **Begin the task** = **At log on** (or **At startup**) -> click **OK**.
5. **Actions Tab**:
   - Click **New..** -> **Action**: `Start a program`.
   - **Program/script**: `C:\Program Files\nodejs\node.exe` *(confirm exact path by running `(Get-Command node).Source` in PowerShell)*.
   - **Add arguments (optional)**: `C:\RSLConnector\rsl-tally-connector.mjs --tdl-path "C:\TallyPrime\rsl-tally-whatsapp.tdl"`
   - **Start in (optional)**: `C:\RSLConnector`
   - Click **OK**.
6. **Settings Tab**:
   - **Uncheck** *Stop the task if it runs longer than: 3 days* (critical — the connector runs continuously all day).
   - **Check** *If the task fails, restart every: 1 minute* (Attempt to restart up to: `99` times).
   - Click **OK** to save the task.
7. Right-click `RSL Tally Prime Cloud Connector` in the Task Scheduler list and click **Run** to start it immediately in the background.

---

## Revoking a Lost or Replaced Office PC

If you replace an office computer, open **Tally Prime & Bills -> Connect Tally Prime -> Paired Windows PCs** and click **Revoke Device** next to the old PC. Its HMAC credentials are invalidated immediately without affecting any other paired PC or `.tdl` connection.

---

## Troubleshooting Windows UAC, SmartScreen & Connector Startup

| Windows Prompt / Symptom | Why It Happens | Exact Fix |
| --- | --- | --- |
| **Windows protected your PC (SmartScreen)** when running `install-rsl-tally-connector.bat` | Freshly downloaded `.bat` scripts do not carry an EV binary signature | Click **More info** -> verify the file came from `rapidshiftlabs.in` -> click **Run anyway** |
| **User Account Control (UAC) permission prompt** when saving to `C:\Program Files\TallyPrime` | Windows restricts standard user writes inside `Program Files` | Store the connector in `C:\RSLConnector` and `.tdl` in `C:\TallyPrime\rsl-tally-whatsapp.tdl` so standard user accounts need zero Administrator elevation |
| **Pairing code expired (`RSL-TALLY-1001`)** | Pairing codes stay valid for 15 minutes and can only be used once | Generate a fresh 15-minute pairing code on `/tally?tab=connect` and run the 1-click `.bat` installer or `--pair` command again |
| **Tally restarted and showed `RSL-SYNC-CIRCUIT-BREAKER`** | Tally Prime briefly returned 0 vouchers before your company finished loading | No action needed — open your company in Tally Prime and the next 30-second cycle resumes syncing automatically |
