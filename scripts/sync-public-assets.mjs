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

if (fs.existsSync(rootPublic)) {
  const entries = fs.readdirSync(rootPublic);
  for (const target of targets) {
    fs.mkdirSync(target, { recursive: true });
    for (const name of entries) {
      const src = path.join(rootPublic, name);
      if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, path.join(target, name));
      }
    }
  }
  console.log(`[sync-public-assets] Synced ${entries.length} files from public/ -> apps/{web,admin,docs}/public/`);
}
