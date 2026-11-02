# Client Support, Failed Tasks & Backup Recovery Guide

> Staff Reference Only — Never shown on public customer help pages.

## Checking a Client Account During a Support Call

1. Open **Client Records & Log** (`/inspector`) in the left sidebar.
2. Choose the client business, pick what you want to check (for example, **Account record counts** or **Latest 20 Tally bills**), and enter the support reference number (such as `SUP-204`).
3. Every check is strictly read-only — it cannot change any client records — and is logged automatically in the **Staff Activity Log**.
4. If you need to view the client's screen directly, open **Payments & Clients** (`/`) and start a **30-Minute Support View** with a short reason. A clear notice banner is shown inside the client's account while you are helping them.

## Retrying Failed WhatsApp or Tally Tasks

1. Open **Tasks & Emails** (`/queues`) in the left sidebar.
2. Check the **Failed Tasks** list to see the exact reason a message or sync paused (for example, low wallet balance or an expired WhatsApp token).
3. Once the client recharges their wallet or reconnects their account, click **Retry** next to the task.
4. Built-in duplicate protection ensures retrying a task will **never** charge a client twice or send the same WhatsApp message twice.

## Restoring a Client Backup Safely

When a client or support member restores a `.rslbackup` file:

- The backup file is checked first to make sure it has not been altered or corrupted.
- A 7-day safety copy of the client's current data is saved automatically before the restore runs.
- Wallet balances, paid GST invoices, and customer `STOP` opt-out lists are kept safe and are never overwritten by an older backup.
