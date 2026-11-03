import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootPublic = path.join(rootDir, "public");
const targets = [
  path.join(rootDir, "apps", "web", "public"),
  path.join(rootDir, "apps", "admin", "public"),
  path.join(rootDir, "apps", "docs", "public"),
];

function countFilesRecursive(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFilesRecursive(full);
    } else if (entry.isFile()) {
      count += 1;
    }
  }
  return count;
}

if (fs.existsSync(rootPublic)) {
  const totalFiles = countFilesRecursive(rootPublic);
  for (const target of targets) {
    // Mirror cleanly so deleted/stale files never linger in app public folders
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(rootPublic, target, { recursive: true, force: true });
  }
  console.log(
    `[sync-public-assets] Mirrored ${totalFiles} files (including subdirectories) from public/ -> apps/{web,admin,docs}/public/`
  );
}
