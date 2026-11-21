import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteClient } from "@rsl/database";
import { resetPlatformArchitectureDatabases } from "../src/index";

describe("architecture reset utility", () => {
  const createdTempDirs: string[] = [];

  afterEach(() => {
    for (const dir of createdTempDirs) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    createdTempDirs.length = 0;
  });

  it("deletes old platform and tenant databases and provisions clean migrated databases in target directory", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rsl-arch-reset-"));
    createdTempDirs.push(tmpDir);

    const oldTenantDir = path.join(tmpDir, "tenants", "01JABCDEFGHJKMNPQRSTVWXYZ0");
    const oldPlatformDir = path.join(tmpDir, "platform");
    fs.mkdirSync(oldTenantDir, { recursive: true });
    fs.mkdirSync(oldPlatformDir, { recursive: true });
    fs.writeFileSync(path.join(oldTenantDir, "data.db"), "stale-tenant-bytes");
    fs.writeFileSync(path.join(oldPlatformDir, "control.db"), "stale-control-bytes");
    fs.writeFileSync(path.join(oldPlatformDir, "control.db-wal"), "stale-wal");

    const res = resetPlatformArchitectureDatabases({
      confirm: "RESET_ALL_DATABASES",
      dataDirOverride: tmpDir,
    });

    expect(fs.existsSync(oldTenantDir)).toBe(false);
    expect(fs.existsSync(path.join(oldPlatformDir, "control.db-wal"))).toBe(false);
    expect(fs.existsSync(res.controlDbPath)).toBe(true);
    expect(fs.existsSync(res.ingressDbPath)).toBe(true);
    expect(fs.existsSync(res.platformLogsDbPath)).toBe(true);
    expect(fs.existsSync(res.tenantsDir)).toBe(true);

    // Verify new control.db contains migrated schema tables cleanly
    const raw = createSqliteClient(res.controlDbPath, { readonly: true });
    const tables = raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    raw.close();

    const names = new Set(tables.map((t) => t.name));
    expect(names.has("workspaces")).toBe(true);
    expect(names.has("tenant_registry")).toBe(true);
    expect(names.has("users")).toBe(true);
  });

  it("rejects calls without explicit RESET_ALL_DATABASES confirmation", () => {
    expect(() =>
      resetPlatformArchitectureDatabases({
        confirm: "NOPE" as "RESET_ALL_DATABASES",
        dataDirOverride: os.tmpdir(),
      })
    ).toThrow(/RESET_ALL_DATABASES/);
  });
});
