import dns from "node:dns";
import net from "node:net";
import { getEnv } from "./env";
import { RslError } from "./errors";

export function isPrivateOrReservedIp(
  rawIp: string,
  options?: { allowLoopback?: boolean }
): boolean {
  const ip = rawIp.trim().replace(/^\[|\]$/g, "").split("%")[0]!.toLowerCase();
  const allowLoopback = Boolean(options?.allowLoopback);

  if (ip.startsWith("::ffff:")) {
    const mappedV4 = ip.slice("::ffff:".length);
    if (net.isIPv4(mappedV4)) {
      return isPrivateOrReservedIp(mappedV4, options);
    }
    const hexParts = mappedV4.split(":");
    if (hexParts.length === 2) {
      const hi = parseInt(hexParts[0]!, 16);
      const lo = parseInt(hexParts[1]!, 16);
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        return isPrivateOrReservedIp(v4, options);
      }
    }
  }

  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map((p) => Number(p));
    const [a = 0, b = 0] = parts;
    if (a === 127) return !allowLoopback;
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }

  if (net.isIPv6(ip)) {
    if (ip === "::1" || ip === "0:0:0:0:0:0:0:1") return !allowLoopback;
    if (ip === "::" || ip === "0:0:0:0:0:0:0:0") return true;
    if (ip.startsWith("fc") || ip.startsWith("fd")) return true;
    if (/^fe[89ab]/i.test(ip)) return true;
    if (ip.startsWith("ff")) return true;
    return false;
  }

  return true;
}

export async function assertSafeExternalUrl(
  rawUrl: string,
  options?: { requireDnsResolution?: boolean; label?: string }
): Promise<string> {
  const label = options?.label || "Target URL";
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new RslError("RSL-VAL-1001", `Enter a valid HTTPS ${label}.`);
  }

  const allowLoopback = getEnv().NODE_ENV !== "production";
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isLoopbackHost = host === "localhost" || host === "127.0.0.1" || host === "::1";

  if (
    parsed.protocol !== "https:" &&
    !(allowLoopback && parsed.protocol === "http:" && isLoopbackHost)
  ) {
    throw new RslError(
      "RSL-VAL-1001",
      `${label} must use https:// (http://localhost is permitted only for local non-production testing).`
    );
  }

  if (
    host === "metadata.google.internal" ||
    host === "metadata" ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    throw new RslError(
      "RSL-VAL-1001",
      `${label} cannot target internal or cloud metadata hostnames.`
    );
  }

  if (net.isIP(host) !== 0) {
    if (isPrivateOrReservedIp(host, { allowLoopback })) {
      throw new RslError(
        "RSL-VAL-1001",
        `${label} cannot target private, link-local, or cloud metadata IP addresses.`
      );
    }
    return parsed.toString();
  }

  if (allowLoopback && host === "localhost") {
    return parsed.toString();
  }

  try {
    const resolved = await dns.promises.lookup(host, { all: true, verbatim: true });
    if (resolved.length === 0 && options?.requireDnsResolution) {
      throw new RslError("RSL-VAL-1001", `Hostname '${host}' did not resolve to any IP address.`);
    }
    for (const entry of resolved) {
      if (isPrivateOrReservedIp(entry.address, { allowLoopback })) {
        throw new RslError(
          "RSL-VAL-1001",
          `${label} blocked: '${host}' resolves to a private or reserved IP address.`
        );
      }
    }
  } catch (err) {
    if (err instanceof RslError) throw err;
    if (options?.requireDnsResolution) {
      throw new RslError("RSL-VAL-1001", `Unable to resolve hostname '${host}'.`);
    }
  }

  return parsed.toString();
}
