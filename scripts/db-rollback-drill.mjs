#!/usr/bin/env node
/**
 * Automated SQLite WAL hot-backup, corruption-check & point-in-time rollback drill.
 * Creates an isolated temporary database directory, seeds a hash-chained ledger + contacts table,
 * takes a live WAL-mode online backup via `better-sqlite3`, simulates accidental destructive writes,
 * restores the snapshot, and verifies `PRAGMA integrity_check`, row counts, and SHA-256 hash chain.
 *
 * Usage:
 *   node scripts/db-rollback-drill.mjs
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const requireFromWeb = createRequire(path.join(rootDir, "apps", "web", "package.json"));
const Database = requireFromWeb("better-sqlite3");

function computeChainHash(prevHash, payload) {
  return crypto.createHash("sha256").update(`${prevHash}|${payload}`).digest("hex");
}

async function runRollbackDrill() {
  const drillDir = fs.mkdtempSync(path.join(os.tmpdir(), "rsl-rollback-drill-"));
  const liveDbPath = path.join(drillDir, "tenant-data.db");
  const snapshotPath = path.join(drillDir, "snapshot-before-mutation.db");
  const preRestoreSafetyPath = path.join(drillDir, "pre-restore-safety.db");

  console.log(`[rollback-drill] Starting isolated SQLite WAL rollback drill in ${drillDir}`);

  try {
    // 1. Initialize live WAL database & seed deterministic records + hash chain
    const liveDb = new Database(liveDbPath);
    liveDb.pragma("journal_mode = WAL");
    liveDb.pragma("synchronous = NORMAL");
    liveDb.pragma("foreign_keys = ON");

    liveDb.exec(`
      CREATE TABLE contacts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone_e164 TEXT NOT NULL UNIQUE,
        unsubscribed INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE audit_chain (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        entry_hash TEXT NOT NULL
      );
    `);

    const insertContact = liveDb.prepare(
      "INSERT INTO contacts (id, name, phone_e164, unsubscribed) VALUES (?, ?, ?, ?)"
    );
    const insertChain = liveDb.prepare(
      "INSERT INTO audit_chain (event, prev_hash, entry_hash) VALUES (?, ?, ?)"
    );

    let prevHash = "GENESIS";
    const seedTx = liveDb.transaction(() => {
      for (let i = 1; i <= 25; i++) {
        const phone = `+9198000000${String(i).padStart(2, "0")}`;
        insertContact.run(`cnt_${i}`, `Customer ${i}`, phone, i === 5 ? 1 : 0);
        const event = `contact.created:cnt_${i}:${phone}`;
        const entryHash = computeChainHash(prevHash, event);
        insertChain.run(event, prevHash, entryHash);
        prevHash = entryHash;
      }
    });
    seedTx();
    const expectedTailHash = prevHash;

    // 2. Take online WAL-safe snapshot while liveDb is still open
    await liveDb.backup(snapshotPath);

    // 3. Simulate post-snapshot mutation + STOP opt-out that must survive union-merge
    insertContact.run("cnt_optout_after", "Late Opt-Out Contact", "+919899999999", 1);
    liveDb.prepare("DELETE FROM contacts WHERE unsubscribed = 0").run();

    const remainingAfterAccident = liveDb.prepare("SELECT COUNT(*) AS c FROM contacts").get().c;
    if (remainingAfterAccident !== 2) {
      throw new Error(`Expected 2 contacts after simulated delete, found ${remainingAfterAccident}`);
    }

    // Preserve post-snapshot STOP opt-outs before swapping DB file (matches @rsl/backup guarantee)
    const preservedOptOuts = liveDb
      .prepare("SELECT id, name, phone_e164 FROM contacts WHERE unsubscribed = 1")
      .all();

    liveDb.pragma("wal_checkpoint(TRUNCATE)");
    liveDb.close();

    // 4. Save pre-restore safety copy and restore snapshot atomically
    fs.copyFileSync(liveDbPath, preRestoreSafetyPath);
    for (const suffix of ["-wal", "-shm"]) {
      if (fs.existsSync(`${liveDbPath}${suffix}`)) {
        fs.rmSync(`${liveDbPath}${suffix}`, { force: true });
      }
    }
    fs.copyFileSync(snapshotPath, liveDbPath);

    // 5. Reopen restored DB, union-merge STOP opt-outs, and verify integrity + hash chain
    const restoredDb = new Database(liveDbPath);
    restoredDb.pragma("journal_mode = WAL");

    const mergeOptOut = restoredDb.prepare(`
      INSERT INTO contacts (id, name, phone_e164, unsubscribed)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(phone_e164) DO UPDATE SET unsubscribed = 1
    `);
    const mergeTx = restoredDb.transaction(() => {
      for (const row of preservedOptOuts) {
        mergeOptOut.run(row.id, row.name, row.phone_e164);
      }
    });
    mergeTx();

    const integrity = restoredDb.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") {
      throw new Error(`PRAGMA integrity_check failed after restore: ${integrity}`);
    }

    const restoredCount = restoredDb.prepare("SELECT COUNT(*) AS c FROM contacts").get().c;
    if (restoredCount !== 26) {
      throw new Error(`Expected 26 contacts (25 restored + 1 preserved STOP opt-out), got ${restoredCount}`);
    }

    const chainRows = restoredDb.prepare("SELECT seq, event, prev_hash, entry_hash FROM audit_chain ORDER BY seq ASC").all();
    let verifyPrev = "GENESIS";
    for (const row of chainRows) {
      const expected = computeChainHash(verifyPrev, row.event);
      if (row.prev_hash !== verifyPrev || row.entry_hash !== expected) {
        throw new Error(`Audit hash chain mismatch at seq=${row.seq}`);
      }
      verifyPrev = row.entry_hash;
    }
    if (verifyPrev !== expectedTailHash) {
      throw new Error("Restored audit tail hash did not match pre-snapshot anchor.");
    }

    restoredDb.close();
    console.log(
      `[rollback-drill] PASS — integrity_check=ok | contacts=${restoredCount} (STOP opt-outs preserved) | hash_chain=${chainRows.length} verified`
    );
  } finally {
    fs.rmSync(drillDir, { recursive: true, force: true });
  }
}

runRollbackDrill().catch((err) => {
  console.error("[rollback-drill] FAIL:", err);
  process.exit(1);
});
