import { createRequire } from "node:module";
import path from "node:path";
import { ensureServiceCatalogSeeded } from "@rsl/billing";
import { resetEnvCacheForTests } from "@rsl/core";
import {
  closeAllHandlesForShutdown,
  controlDb,
  resetPlatformArchitectureDatabases,
} from "@rsl/tenancy";

const require = createRequire(import.meta.url);
const { loadMonorepoRootEnv } = require("./load-root-env.cjs") as {
  loadMonorepoRootEnv: (options?: { rootDir?: string }) => Record<string, string>;
};

loadMonorepoRootEnv({ rootDir: path.resolve(import.meta.dirname, "..") });

function parseArgs(argv: string[]) {
  const yes = argv.includes("--yes") || argv.includes("-y") || argv.includes("--force");
  const includeStorage = argv.includes("--include-storage");
  const dataDirIdx = argv.indexOf("--data-dir");
  const dataDirOverride =
    dataDirIdx >= 0 && argv[dataDirIdx + 1] ? argv[dataDirIdx + 1] : undefined;
  return { yes, includeStorage, dataDirOverride };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.yes) {
    console.error(
      "[architecture-reset] Refusing to delete databases without --yes confirmation flag."
    );
    console.error("Usage: tsx scripts/architecture-reset.ts --yes [--include-storage]");
    process.exit(1);
  }

  if (args.dataDirOverride) {
    process.env.DATA_DIR = path.resolve(args.dataDirOverride);
    resetEnvCacheForTests();
  }

  const res = resetPlatformArchitectureDatabases({
    confirm: "RESET_ALL_DATABASES",
    includeStorage: args.includeStorage,
  });

  controlDb();
  ensureServiceCatalogSeeded();
  closeAllHandlesForShutdown();

  console.log("[architecture-reset] Database architecture reset complete:");
  console.log(`  Data Directory : ${res.dataDir}`);
  console.log(`  Removed        : ${res.removedDirectories.length} folder(s)`);
  console.log(`  Master Control : ${res.controlDbPath}`);
  console.log(`  Ingress DB     : ${res.ingressDbPath}`);
  console.log(`  Platform Logs  : ${res.platformLogsDbPath}`);
  console.log(`  Tenants Folder : ${res.tenantsDir}`);
}

main();
