import crypto from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";
import { eq } from "drizzle-orm";
import { getEnv } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import {
  controlDb,
  executeSslCertificateProvisionForHost,
  ingressDb,
  listAllPlatformSslCertificates,
  listDueSslCertificatesForSweep,
  platformLogsDb,
} from "@rsl/tenancy";

function isCloudflareProxyIp(ip: string): boolean {
  return (
    ip.startsWith("104.16.") ||
    ip.startsWith("104.17.") ||
    ip.startsWith("104.18.") ||
    ip.startsWith("104.19.") ||
    ip.startsWith("104.20.") ||
    ip.startsWith("104.21.") ||
    ip.startsWith("104.22.") ||
    ip.startsWith("104.23.") ||
    ip.startsWith("104.24.") ||
    ip.startsWith("104.25.") ||
    ip.startsWith("104.26.") ||
    ip.startsWith("104.27.") ||
    ip.startsWith("172.64.") ||
    ip.startsWith("172.65.") ||
    ip.startsWith("172.66.") ||
    ip.startsWith("172.67.") ||
    ip.startsWith("172.68.") ||
    ip.startsWith("172.69.") ||
    ip.startsWith("172.70.") ||
    ip.startsWith("172.71.") ||
    ip.startsWith("188.114.") ||
    ip.startsWith("162.158.") ||
    ip.startsWith("162.159.")
  );
}

function inspectLocalCertFile(certPath: string): {
  exists: boolean;
  isBootstrap: boolean;
  issuer: string;
  daysLeft: number | null;
} {
  try {
    if (!fs.existsSync(certPath)) {
      return { exists: false, isBootstrap: false, issuer: "missing", daysLeft: null };
    }
    const realTarget = fs.realpathSync(certPath);
    const pem = fs.readFileSync(realTarget, "utf8");
    const x509 = new crypto.X509Certificate(pem);
    const validToMs = Date.parse(x509.validTo);
    const daysLeft = Number.isFinite(validToMs)
      ? Math.floor((validToMs - Date.now()) / (24 * 60 * 60 * 1000))
      : null;
    const isBootstrap =
      realTarget.includes("bootstrap.crt") || x509.issuer === x509.subject;
    return {
      exists: true,
      isBootstrap,
      issuer: isBootstrap ? "Bootstrap Self-Signed" : x509.issuer.replace(/\n/g, ", "),
      daysLeft,
    };
  } catch {
    return { exists: false, isBootstrap: false, issuer: "unreadable", daysLeft: null };
  }
}

async function resolveDnsIps(hostname: string): Promise<string[]> {
  try {
    const resolver = new dns.Resolver();
    resolver.setServers(["1.1.1.1", "8.8.8.8"]);
    return await resolver.resolve4(hostname);
  } catch {
    try {
      return await dns.resolve4(hostname);
    } catch {
      return [];
    }
  }
}

function checkRemoteTlsHandshake(
  hostname: string,
  connectIp?: string
): Promise<{
  ok: boolean;
  issuer?: string;
  daysLeft?: number | null;
  error?: string;
}> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host: connectIp || hostname,
        port: 443,
        servername: hostname,
        rejectUnauthorized: false,
        timeout: 6000,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          const authorized = socket.authorized;
          const validToMs = cert?.valid_to ? Date.parse(cert.valid_to) : NaN;
          const daysLeft = Number.isFinite(validToMs)
            ? Math.floor((validToMs - Date.now()) / (24 * 60 * 60 * 1000))
            : null;
          const issuerOrg = cert?.issuer?.O || cert?.issuer?.CN || "Unknown CA";
          socket.end();
          resolve({
            ok: true,
            issuer: `${issuerOrg}${authorized ? "" : " (untrusted/self-signed)"}`,
            daysLeft,
          });
        } catch (err) {
          socket.destroy();
          resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
    );
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ ok: false, error: "TLS timeout" });
    });
    socket.on("error", (err) => {
      socket.destroy();
      resolve({ ok: false, error: err.message });
    });
  });
}

async function checkPublicHttpsUrl(
  url: string,
  resolvedIp?: string
): Promise<{ status: number | null; error?: string }> {
  if (resolvedIp && url.startsWith("https://")) {
    return new Promise((resolve) => {
      const parsed = new URL(url);
      const req = https.request(
        {
          host: resolvedIp,
          port: 443,
          servername: parsed.hostname,
          path: parsed.pathname + parsed.search,
          method: "GET",
          headers: { Host: parsed.hostname, "User-Agent": "RSL-OpsVerify/1.0" },
          timeout: 8000,
        },
        (res) => {
          res.resume();
          resolve({ status: res.statusCode ?? null });
        }
      );
      req.on("timeout", () => {
        req.destroy();
        resolve({ status: null, error: "HTTPS timeout" });
      });
      req.on("error", (err) => {
        req.destroy();
        resolve({ status: null, error: err.message });
      });
      req.end();
    });
  }

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    return { status: res.status };
  } catch (err) {
    return { status: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function checkRedisPing(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port, timeout: 2500 }, () => {
      sock.write("*1\r\n$4\r\nPING\r\n");
    });
    sock.on("data", (buf) => {
      const ok = buf.toString("utf8").includes("+PONG");
      sock.end();
      resolve(ok);
    });
    sock.on("timeout", () => {
      sock.destroy();
      resolve(false);
    });
    sock.on("error", () => {
      sock.destroy();
      resolve(false);
    });
  });
}

function readRawSetupTokenFromEnvFile(repoRoot: string): string {
  const fromProc = (process.env.SETUP_BOOTSTRAP_TOKEN || "").trim();
  if (fromProc) return fromProc;
  try {
    const envPath = path.join(repoRoot, ".env");
    if (fs.existsSync(envPath)) {
      const m = fs.readFileSync(envPath, "utf8").match(/^SETUP_BOOTSTRAP_TOKEN=(.+)$/m);
      if (m?.[1]) return m[1].trim().replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // ignore
  }
  return "";
}

async function main() {
  const env = getEnv();
  const primaryDomain = (env.PRIMARY_DOMAIN || "rapidshiftlabs.in").trim().toLowerCase();
  const tallyZone = (env.TALLY_WILDCARD_ZONE || "tally").trim().toLowerCase();
  const apiZone = (env.API_WILDCARD_ZONE || "api").trim().toLowerCase();

  console.log("");
  console.log("======================================================================");
  console.log(` RapidShift Labs (${primaryDomain}) — Post-Deploy Verification Suite`);
  console.log("======================================================================");

  // 1. Database Integrity & Super Admin Verification
  const ctrl = controlDb();
  ingressDb();
  platformLogsDb();

  const quickCheck = ctrl.$client.pragma("quick_check", { simple: true });
  const allStaff = ctrl.select().from(controlSchema.platformStaff).all();
  const activeSuperAdmins = allStaff.filter(
    (s) => s.staffRole === "super_admin" && Boolean(s.active)
  );
  const allWorkspaces = ctrl
    .select({
      id: controlSchema.workspaces.id,
      name: controlSchema.workspaces.name,
      slug: controlSchema.workspaces.slug,
    })
    .from(controlSchema.workspaces)
    .all();

  console.log("\n[1/4] SQLite Databases & Super Admin Account Status");
  console.log(`  ✓ Control DB Integrity : ${String(quickCheck)} (${env.DATA_DIR}/platform/control.db)`);
  console.log(`  ✓ Client Workspaces    : ${allWorkspaces.length}`);
  console.log(
    `  ${activeSuperAdmins.length > 0 ? "✓" : "!"} Super Admin Accounts : ${activeSuperAdmins.length} active (${allStaff.length} total staff)`
  );

  if (activeSuperAdmins.length > 0) {
    console.log(
      `    Active Super Admin(s): ${activeSuperAdmins.map((a) => a.email).join(", ")}`
    );
    console.log("    Public /setup initial bootstrap is PERMANENTLY LOCKED.");
  }

  // 2. Local Services & Redis 4579 Health
  console.log("\n[2/4] Internal Services & Isolated Redis (Ports 4500–4579)");
  const redisOk = await checkRedisPing("127.0.0.1", 4579);
  console.log(
    `  ${redisOk ? "✓" : "!"} redis-rsl (127.0.0.1:4579)       -> ${redisOk ? "PONG (HEALTHY)" : "NOT RUNNING (using SQLite fallback)"}`
  );

  const localChecks = [
    { name: "rsl-web (4500)", pm2Name: "rsl-web", url: "http://127.0.0.1:4500/api/health" },
    { name: "rsl-admin (4501)", pm2Name: "rsl-admin", url: "http://127.0.0.1:4501/api/health" },
    { name: "rsl-admin /setup (4501)", pm2Name: "rsl-admin", url: "http://127.0.0.1:4501/setup" },
    { name: "rsl-docs (4502)", pm2Name: "rsl-docs", url: "http://127.0.0.1:4502/api/health" },
    { name: "rsl-worker-realtime (4510)", pm2Name: "rsl-worker-realtime", url: "http://127.0.0.1:4510/health" },
    { name: "rsl-worker-bulk (4511)", pm2Name: "rsl-worker-bulk", url: "http://127.0.0.1:4511/health" },
    { name: "rsl-worker-maintenance (4512)", pm2Name: "rsl-worker-maintenance", url: "http://127.0.0.1:4512/health" },
    { name: "rsl-cleanup (4520)", pm2Name: "rsl-cleanup", url: "http://127.0.0.1:4520/health" },
  ];
  for (const svc of localChecks) {
    let res = await checkPublicHttpsUrl(svc.url);
    if (res.status === null) {
      await new Promise((r) => setTimeout(r, 1500));
      res = await checkPublicHttpsUrl(svc.url);
    }
    const ok = res.status !== null && res.status >= 200 && res.status < 400;
    console.log(
      `  ${ok ? "✓" : "⨯"} ${svc.name.padEnd(30)} -> ${ok ? `HTTP ${res.status} OK` : `UNREACHABLE (${res.error || "down"})`}`
    );
    if (!ok) {
      const errLogPath = path.join(env.LOG_DIR, "pm2", `${svc.pm2Name}.err.log`);
      if (fs.existsSync(errLogPath)) {
        const tail = fs
          .readFileSync(errLogPath, "utf8")
          .split(/\r?\n/)
          .filter((l) => l.trim().length > 0)
          .slice(-10);
        for (const line of tail) {
          console.log(`      [err.log] ${line}`);
        }
      }
    }
  }

  // 3. Core Platform Subdomains — DNS + Origin Cert + Live Public HTTPS
  console.log("\n[3/4] Core Platform Subdomains — DNS, Origin SSL & Public HTTPS");
  const coreSpecs = [
    { sub: env.SETUP_SUBDOMAIN || "setup", path: "/setup" },
    { sub: env.APP_SUBDOMAIN || "app", path: "/api/health" },
    { sub: env.ADMIN_SUBDOMAIN || "admin", path: "/api/health" },
    { sub: env.DOCS_SUBDOMAIN || "docs", path: "/api/health" },
    { sub: tallyZone, path: "/api/webhooks/tally" },
    { sub: apiZone, path: "/api/health" },
  ];

  const warnings: string[] = [];

  for (const spec of coreSpecs) {
    const fqdn = `${spec.sub}.${primaryDomain}`;
    const ips = await resolveDnsIps(fqdn);
    const originCert =
      process.platform === "linux"
        ? inspectLocalCertFile(`/etc/ssl/rsl/${spec.sub}.crt`)
        : { exists: false, isBootstrap: false, issuer: "n/a (non-linux)", daysLeft: null };

    if (ips.length === 0) {
      console.log(`  ⨯ ${fqdn.padEnd(32)} | DNS: NXDOMAIN (Missing A record!)`);
      warnings.push(`Add A record '${spec.sub}' -> your server IP in DNS.`);
      continue;
    }

    const cfProxied = ips.some(isCloudflareProxyIp);
    const dnsMode = cfProxied ? "Cloudflare Proxy" : `Direct (${ips[0]})`;
    const tlsInfo = await checkRemoteTlsHandshake(fqdn, ips[0]);
    const httpsRes = await checkPublicHttpsUrl(`https://${fqdn}${spec.path}`, ips[0]);
    const httpsOk = httpsRes.status !== null && httpsRes.status >= 200 && httpsRes.status < 400;

    const originLabel =
      process.platform !== "linux"
        ? "local-dev"
        : !originCert.exists
          ? "missing"
          : originCert.isBootstrap
            ? "Bootstrap Self-Signed"
            : `Let's Encrypt (${originCert.daysLeft ?? "?"}d left)`;

    const publicSslLabel = tlsInfo.ok
      ? `TLS OK (${tlsInfo.issuer}${tlsInfo.daysLeft !== null && tlsInfo.daysLeft !== undefined ? `, ${tlsInfo.daysLeft}d` : ""})`
      : `TLS FAIL (${tlsInfo.error})`;

    const httpLabel =
      httpsRes.status !== null ? `HTTP ${httpsRes.status}` : `ERR (${httpsRes.error || "failed"})`;

    console.log(
      `  ${httpsOk && tlsInfo.ok ? "✓" : "!"} ${fqdn.padEnd(32)} | DNS: ${dnsMode.padEnd(18)} | Origin: ${originLabel.padEnd(24)} | Edge: ${publicSslLabel} | ${httpLabel}`
    );

    if (httpsRes.status === 526) {
      warnings.push(
        `${fqdn} returned Cloudflare HTTP 526 (Full Strict SSL mode requires origin Let's Encrypt cert — run: sudo /usr/local/bin/rsl-provision-client-ssl --core).`
      );
    }
  }

  // 4. Wildcard Subdomain Zones (*.tally & *.api) + Active Client SSL Records
  console.log(
    `\n[4/4] Client Wildcard Zones (*.${tallyZone}.${primaryDomain} & *.${apiZone}.${primaryDomain})`
  );
  for (const zone of [tallyZone, apiZone]) {
    const probeHost = `sslcheck.${zone}.${primaryDomain}`;
    const ips = await resolveDnsIps(probeHost);
    if (ips.length === 0) {
      console.log(`  ⨯ *.${zone}.${primaryDomain.padEnd(26)} | DNS: NXDOMAIN (Missing '*.${zone}' wildcard A record!)`);
      warnings.push(
        `Add wildcard A record '*.${zone}' -> your server IP (set to DNS only / Grey Cloud in Cloudflare).`
      );
      continue;
    }

    const cfProxied = ips.some(isCloudflareProxyIp);
    const tlsInfo = await checkRemoteTlsHandshake(probeHost, ips[0]);

    if (cfProxied && !tlsInfo.ok) {
      console.log(
        `  ⚠ *.${zone}.${primaryDomain.padEnd(26)} | DNS: Cloudflare Proxied (Orange Cloud) -> TLS HANDSHAKE BLOCKED!`
      );
      warnings.push(
        `Switch '*.${zone}.${primaryDomain}' from 'Proxied' (Orange Cloud) to 'DNS only' (Grey Cloud) in Cloudflare DNS! Free Cloudflare Universal SSL does not cover second-level wildcards (*.${zone}.${primaryDomain}), whereas Grey Cloud lets your server issue free Let's Encrypt certs automatically for every client.`
      );
    } else {
      console.log(
        `  ✓ *.${zone}.${primaryDomain.padEnd(26)} | DNS: ${cfProxied ? "Cloudflare Proxy" : `Direct (${ips[0]})`} | Ready for automatic per-client Let's Encrypt SNI`
      );
    }
  }

  if (process.platform === "linux") {
    const dueSsl = listDueSslCertificatesForSweep(25);
    for (const item of dueSsl) {
      const hostIps = await resolveDnsIps(item.hostname);
      if (hostIps.length === 0) continue;
      if (hostIps.some(isCloudflareProxyIp)) continue;
      try {
        await executeSslCertificateProvisionForHost({
          workspaceId: item.workspaceId,
          hostname: item.hostname,
        });
      } catch {
        // Recorded in ssl_certificates.last_error and displayed below
      }
    }
  }

  const sslRecords = listAllPlatformSslCertificates(100);
  if (sslRecords.length > 0) {
    console.log(`\n  Provisioned Client Subdomain SSL Records (${sslRecords.length}):`);
    for (const rec of sslRecords.slice(0, 20)) {
      const leFile = `/etc/letsencrypt/live/${rec.hostname}/fullchain.pem`;
      const diskCert =
        process.platform === "linux" && fs.existsSync(leFile)
          ? inspectLocalCertFile(leFile)
          : null;
      const certNote = diskCert?.exists
        ? `LE cert (${diskCert.daysLeft ?? "?"}d left)`
        : rec.coverageMode;
      console.log(
        `    ${rec.status === "active" ? "✓" : "!"} ${rec.hostname.padEnd(40)} | status=${rec.status.padEnd(12)} | ${certNote}${rec.lastError ? ` | err=${rec.lastError}` : ""}`
      );
    }
  }

  if (warnings.length > 0) {
    console.log("\n----------------------------------------------------------------------");
    console.log(" DNS / SSL Action Items Detected:");
    for (const w of warnings) {
      console.log(`  • ${w}`);
    }
  }

  // Final Super Admin Action Banner (ALWAYS printed if 0 Super Admins exist!)
  const setupToken = readRawSetupTokenFromEnvFile(env.REPO_ROOT);
  console.log("\n======================================================================");
  if (activeSuperAdmins.length === 0) {
    console.log(" ACTION REQUIRED — NO SUPER ADMIN ACCOUNT CREATED YET!");
    console.log("----------------------------------------------------------------------");
    console.log(" Open either link below to create your primary Super Admin account:");
    console.log(`   1) https://${env.SETUP_SUBDOMAIN || "setup"}.${primaryDomain}/?key=${setupToken}`);
    console.log(`   2) https://${env.ADMIN_SUBDOMAIN || "admin"}.${primaryDomain}/setup?key=${setupToken}`);
    console.log("");
    console.log(` One-Time Setup Key : ${setupToken}`);
  } else {
    console.log(" PLATFORM READY & SUPER ADMIN VERIFIED");
    console.log("----------------------------------------------------------------------");
    console.log(` Staff Console  : https://${env.ADMIN_SUBDOMAIN || "admin"}.${primaryDomain}`);
    console.log(` Setup Hub      : https://${env.SETUP_SUBDOMAIN || "setup"}.${primaryDomain}`);
    console.log(` Customer App   : https://${env.APP_SUBDOMAIN || "app"}.${primaryDomain}`);
    console.log(` Help & Docs    : https://${env.DOCS_SUBDOMAIN || "docs"}.${primaryDomain}`);
  }
  console.log("======================================================================");
}

main().catch((err) => {
  console.error("[ops:verify] Verification script error:", err);
  process.exit(1);
});
