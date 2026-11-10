"use strict";

const fs = require("node:fs");
const path = require("node:path");

function findMonorepoRoot(startDir = process.cwd()) {
  let current = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(startDir);
}

/**
 * Deterministic single-source-of-truth .env parser shared across Next.js configs,
 * PM2 ecosystem configuration, and @rsl/core runtime startup.
 * Supports:
 *   - `export KEY=VALUE` and `KEY=VALUE`
 *   - Values containing `=` (base64 secrets, connection URLs)
 *   - Quoted values (`"..."` with escape sequences, `'...'` literal)
 *   - Inline `#` comments on unquoted values when preceded by whitespace
 */
function parseDotEnvText(content) {
  const parsed = {};
  if (!content) return parsed;

  for (const rawLine of String(content).split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const withoutExport = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trimStart()
      : trimmed;
    const eqIdx = withoutExport.indexOf("=");
    if (eqIdx <= 0) continue;

    const key = withoutExport.slice(0, eqIdx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    const rawVal = withoutExport.slice(eqIdx + 1).trim();
    let value = "";

    if (rawVal.startsWith('"')) {
      let i = 1;
      let buf = "";
      while (i < rawVal.length) {
        const ch = rawVal[i];
        if (ch === "\\" && i + 1 < rawVal.length) {
          const next = rawVal[i + 1];
          if (next === "n") buf += "\n";
          else if (next === "r") buf += "\r";
          else if (next === "t") buf += "\t";
          else buf += next;
          i += 2;
          continue;
        }
        if (ch === '"') break;
        buf += ch;
        i += 1;
      }
      value = buf;
    } else if (rawVal.startsWith("'")) {
      const endQuote = rawVal.indexOf("'", 1);
      value = endQuote >= 1 ? rawVal.slice(1, endQuote) : rawVal.slice(1);
    } else {
      const inlineCommentMatch = /\s+#/.exec(rawVal);
      value = (inlineCommentMatch ? rawVal.slice(0, inlineCommentMatch.index) : rawVal).trim();
    }

    parsed[key] = value;
  }

  return parsed;
}

function parseRootDotEnv(envFilePath) {
  const resolved = envFilePath || path.join(findMonorepoRoot(__dirname), ".env");
  if (!fs.existsSync(resolved)) return {};
  return parseDotEnvText(fs.readFileSync(resolved, "utf8"));
}

function loadMonorepoRootEnv(options = {}) {
  const rootDir = options.rootDir || findMonorepoRoot(options.startDir || __dirname);
  const envPath = options.envFilePath || path.join(rootDir, ".env");
  const parsed = parseRootDotEnv(envPath);
  for (const [k, v] of Object.entries(parsed)) {
    if (options.override || process.env[k] === undefined) {
      process.env[k] = v;
    }
  }
  return parsed;
}

module.exports = {
  findMonorepoRoot,
  parseDotEnvText,
  parseRootDotEnv,
  loadMonorepoRootEnv,
};
