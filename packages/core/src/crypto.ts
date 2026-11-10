import crypto from "node:crypto";
import QRCode from "qrcode";
import { getEnv } from "./env";
import { RslError } from "./errors";

const SCRYPT_MAXMEM = 256 * 1024 * 1024;
const MAX_CONCURRENT_SCRYPT = 8;
const MAX_QUEUED_SCRYPT = 64;

let activeScryptCount = 0;
const scryptWaitQueue: Array<() => void> = [];

async function withScryptSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeScryptCount >= MAX_CONCURRENT_SCRYPT) {
    if (scryptWaitQueue.length >= MAX_QUEUED_SCRYPT) {
      throw new RslError(
        "RSL-API-1003",
        "Authentication service is busy processing sign-in requests. Please retry in a few seconds."
      );
    }
    await new Promise<void>((resolve) => {
      scryptWaitQueue.push(resolve);
    });
  }
  activeScryptCount += 1;
  try {
    return await fn();
  } finally {
    activeScryptCount -= 1;
    const next = scryptWaitQueue.shift();
    if (next) next();
  }
}

function derive32ByteKey(secret: string, contextLabel: string, salt = ""): Buffer {
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      salt ? Buffer.from(salt, "utf8") : Buffer.alloc(0),
      Buffer.from(contextLabel, "utf8"),
      32
    )
  );
}

export type HmacKeyPurpose =
  | "public-bill-link:v1"
  | "public-media-link:v1"
  | "flash-toast-hmac:v1"
  | "tally-webhook-hmac:v1"
  | "reset-handoff:v1";

/**
 * Derives a domain-separated 256-bit HMAC key via HKDF-SHA256 so capability links,
 * signed cookies, and webhook signatures never reuse the raw KMS master key directly.
 */
export function derivePurposeKey(purpose: HmacKeyPurpose | string): string {
  const env = getEnv();
  return derive32ByteKey(
    env.KMS_MASTER_KEY,
    `rsl-purpose:${purpose}:v${env.KMS_KEY_VERSION}`,
    "rsl-purpose-kdf-salt-v1"
  ).toString("hex");
}

export function signPurposeHmac(purpose: HmacKeyPurpose | string, payload: string | Buffer): string {
  return signHmac(payload, derivePurposeKey(purpose));
}

export function verifyPurposeHmac(
  purpose: HmacKeyPurpose | string,
  payload: string | Buffer,
  signatureHex: string
): boolean {
  return verifyHmac(payload, signatureHex, derivePurposeKey(purpose));
}

export interface EncryptedEnvelope {
  v: number;
  wrappedKey: string;
  keyIv: string;
  keyTag: string;
  ciphertext: string;
  iv: string;
  tag: string;
}

/**
 * AES-256-GCM envelope encryption:
 * Generates a unique random 256-bit data key per secret, encrypts the payload with it,
 * and wraps the data key with the versioned KMS_MASTER_KEY.
 */
export function encryptEnvelope(plaintext: string): string {
  const env = getEnv();
  const masterKey = derive32ByteKey(env.KMS_MASTER_KEY, `rsl-kms-v${env.KMS_KEY_VERSION}`);

  const dataKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", dataKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const keyIv = crypto.randomBytes(12);
  const keyCipher = crypto.createCipheriv("aes-256-gcm", masterKey, keyIv);
  const wrappedKey = Buffer.concat([keyCipher.update(dataKey), keyCipher.final()]);
  const keyTag = keyCipher.getAuthTag();

  dataKey.fill(0);

  const envelope: EncryptedEnvelope = {
    v: env.KMS_KEY_VERSION,
    wrappedKey: wrappedKey.toString("base64"),
    keyIv: keyIv.toString("base64"),
    keyTag: keyTag.toString("base64"),
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };

  return JSON.stringify(envelope);
}

export function decryptEnvelope(serialized: string): string {
  const env = getEnv();
  const envelope = JSON.parse(serialized) as EncryptedEnvelope;
  const masterKey = derive32ByteKey(env.KMS_MASTER_KEY, `rsl-kms-v${envelope.v}`);

  const keyDecipher = crypto.createDecipheriv(
    "aes-256-gcm",
    masterKey,
    Buffer.from(envelope.keyIv, "base64")
  );
  keyDecipher.setAuthTag(Buffer.from(envelope.keyTag, "base64"));
  const dataKey = Buffer.concat([
    keyDecipher.update(Buffer.from(envelope.wrappedKey, "base64")),
    keyDecipher.final(),
  ]);

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    dataKey,
    Buffer.from(envelope.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");

  dataKey.fill(0);
  return decrypted;
}

function resolveDefaultScryptCostN(explicitCostN?: number): number {
  if (explicitCostN && Number.isInteger(explicitCostN) && explicitCostN >= 16384) {
    return explicitCostN;
  }
  return process.env.NODE_ENV === "test" ? 16384 : 131072;
}

function runScryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: crypto.ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * Memory-hard password hashing via Node native scrypt (OWASP interactive N=131072, r=8, p=1, 64-byte key).
 * Prefer `hashPasswordAsync` and `verifyPasswordAsync` in request handlers so hashing runs on libuv worker threads.
 */
export function hashPassword(password: string, opts?: { costN?: number }): string {
  const N = resolveDefaultScryptCostN(opts?.costN);
  const r = 8;
  const p = 1;
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N, r, p, maxmem: SCRYPT_MAXMEM });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function hashPasswordAsync(password: string, opts?: { costN?: number }): Promise<string> {
  const N = resolveDefaultScryptCostN(opts?.costN);
  const r = 8;
  const p = 1;
  const salt = crypto.randomBytes(16);
  const hash = await withScryptSlot(() =>
    runScryptAsync(password, salt, 64, { N, r, p, maxmem: SCRYPT_MAXMEM })
  );
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function parseScryptHash(stored: string): {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  expected: Buffer;
} | null {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  if (N < 1024 || N > 1048576 || r < 1 || r > 32 || p < 1 || p > 16) return null;
  const salt = Buffer.from(parts[4]!, "base64");
  const expected = Buffer.from(parts[5]!, "base64");
  if (salt.length < 8 || expected.length < 32) return null;
  return { N, r, p, salt, expected };
}

export function verifyPassword(password: string, stored: string): boolean {
  const parsed = parseScryptHash(stored);
  if (!parsed) return false;
  const actual = crypto.scryptSync(password, parsed.salt, parsed.expected.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem: SCRYPT_MAXMEM,
  });
  return crypto.timingSafeEqual(actual, parsed.expected);
}

export async function verifyPasswordAsync(password: string, stored: string): Promise<boolean> {
  const parsed = parseScryptHash(stored);
  if (!parsed) return false;
  const actual = await withScryptSlot(() =>
    runScryptAsync(password, parsed.salt, parsed.expected.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: SCRYPT_MAXMEM,
    })
  );
  return crypto.timingSafeEqual(actual, parsed.expected);
}

export function passwordHashNeedsUpgrade(stored: string): boolean {
  if (process.env.NODE_ENV === "test") return false;
  const parsed = parseScryptHash(stored);
  if (!parsed) return true;
  return parsed.N < 131072;
}

export function computeChainHash(prevHash: string, canonicalPayload: string): string {
  return crypto.createHash("sha256").update(`${prevHash}|${canonicalPayload}`).digest("hex");
}

export function signHmac(payload: string | Buffer, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export const hmacSha256 = signHmac;

export function verifyHmac(payload: string | Buffer, signatureHex: string, secret: string): boolean {
  const cleanHex = String(signatureHex || "").trim().toLowerCase();
  if (!cleanHex || cleanHex.length !== 64 || !/^[0-9a-f]+$/.test(cleanHex)) {
    return false;
  }
  const expected = Buffer.from(signHmac(payload, secret), "hex");
  const actual = Buffer.from(cleanHex, "hex");
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

export function hashApiKey(rawKey: string): string {
  const env = getEnv();
  return crypto.createHmac("sha256", env.API_KEY_PEPPER).update(rawKey).digest("hex");
}

export function hashPiiIdentifier(value: string): string {
  const env = getEnv();
  return crypto
    .createHmac("sha256", env.API_KEY_PEPPER)
    .update(value.trim().toLowerCase())
    .digest("hex")
    .slice(0, 24);
}

/* ============================================================================
 * RFC 6238 TOTP Multi-Factor Authentication & Backup Codes
 * ============================================================================ */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function encodeBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

export function decodeBase32(input: string): Buffer {
  const cleaned = String(input || "")
    .toUpperCase()
    .replace(/=+$/g, "")
    .replace(/[\s-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) {
      throw new RslError("RSL-VAL-1001", "Invalid Base32 TOTP secret character.");
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return encodeBase32(crypto.randomBytes(20));
}

export function buildTotpOtpAuthUri(params: {
  secretBase32: string;
  accountEmail: string;
  issuer?: string;
}): string {
  const issuer = (params.issuer || "RapidShift Labs").trim();
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(params.accountEmail.trim())}`;
  const qs = new URLSearchParams({
    secret: params.secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${qs.toString()}`;
}

export function buildTotpQrCodeSvgMarkup(
  otpauthUri: string,
  options?: {
    margin?: number;
    darkColor?: string;
    lightColor?: string;
    sizePx?: number;
  }
): string {
  const cleanUri = String(otpauthUri || "").trim();
  if (!cleanUri) {
    throw new RslError("RSL-VAL-1001", "Cannot generate QR code for an empty otpauth URI.");
  }
  const qr = QRCode.create(cleanUri, { errorCorrectionLevel: "M" });
  const moduleCount = qr.modules.size;
  const margin = Math.max(1, options?.margin ?? 2);
  const totalSize = moduleCount + margin * 2;
  const darkColor = options?.darkColor || "#090A10";
  const lightColor = options?.lightColor || "#F6F4EE";
  const sizePx = Math.max(120, options?.sizePx ?? 220);

  let pathData = "";
  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (qr.modules.get(row, col)) {
        pathData += `M${col + margin},${row + margin}h1v1h-1z`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" width="${sizePx}" height="${sizePx}" shape-rendering="crispEdges" role="img" aria-label="Authenticator QR Code"><rect width="${totalSize}" height="${totalSize}" fill="${lightColor}" rx="1.5"/><path d="${pathData}" fill="${darkColor}"/></svg>`;
}

export function buildTotpQrCodeDataUri(
  otpauthUri: string,
  options?: {
    margin?: number;
    darkColor?: string;
    lightColor?: string;
    sizePx?: number;
  }
): string {
  const svg = buildTotpQrCodeSvgMarkup(otpauthUri, options);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function computeTotpCode(secretBase32: string, timestampMs = Date.now(), stepSec = 30): string {
  const key = decodeBase32(secretBase32);
  const counter = Math.floor(timestampMs / 1000 / stepSec);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function verifyTotpCode(
  secretBase32: string,
  rawCode: string,
  windowSteps = 1,
  nowMs = Date.now()
): boolean {
  const normalized = String(rawCode || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  const candidateBuf = Buffer.from(normalized, "utf8");
  for (let delta = -windowSteps; delta <= windowSteps; delta += 1) {
    const expected = computeTotpCode(secretBase32, nowMs + delta * 30_000, 30);
    const expectedBuf = Buffer.from(expected, "utf8");
    if (
      expectedBuf.length === candidateBuf.length &&
      crypto.timingSafeEqual(expectedBuf, candidateBuf)
    ) {
      return true;
    }
  }
  return false;
}

export function generateMfaBackupCodes(count = 8): {
  plainCodes: string[];
  hashedCodes: string[];
} {
  const plainCodes: string[] = [];
  const hashedCodes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const raw = crypto.randomBytes(5).toString("hex").toUpperCase();
    const formatted = `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
    plainCodes.push(formatted);
    hashedCodes.push(hashApiKey(`mfa-backup:${formatted}`));
  }
  return { plainCodes, hashedCodes };
}

export function consumeMfaBackupCode(
  inputCode: string,
  storedHashes: string[]
): { matched: boolean; remainingHashes: string[] } {
  const normalized = String(inputCode || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-F0-9]/g, "");
  if (normalized.length !== 10) {
    return { matched: false, remainingHashes: storedHashes };
  }
  const formatted = `${normalized.slice(0, 5)}-${normalized.slice(5, 10)}`;
  const candidateHash = Buffer.from(hashApiKey(`mfa-backup:${formatted}`), "hex");
  let matchedIndex = -1;
  for (let i = 0; i < storedHashes.length; i += 1) {
    const existing = Buffer.from(String(storedHashes[i] || ""), "hex");
    if (existing.length === candidateHash.length && crypto.timingSafeEqual(existing, candidateHash)) {
      matchedIndex = i;
    }
  }
  if (matchedIndex < 0) {
    return { matched: false, remainingHashes: storedHashes };
  }
  return {
    matched: true,
    remainingHashes: storedHashes.filter((_, idx) => idx !== matchedIndex),
  };
}

/* ============================================================================
 * Resilient Outbound Fetch with Exponential Backoff & Retry-After Support
 * ============================================================================ */

export interface FetchRetryOptions {
  maxAttempts?: number;
  retries?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  retryOnStatuses?: number[];
}

export type FetchWithRetryInit = RequestInit & FetchRetryOptions;

export async function fetchWithRetry(
  input: string | URL,
  init: FetchWithRetryInit = {},
  opts: FetchRetryOptions = {}
): Promise<Response> {
  const {
    maxAttempts: initMaxAttempts,
    retries: initRetries,
    maxRetries: initMaxRetries,
    baseDelayMs: initBaseDelayMs,
    timeoutMs: initTimeoutMs,
    retryOnStatuses: initRetryOnStatuses,
    ...requestInit
  } = init;
  const resolvedMaxAttempts = opts.maxAttempts ?? initMaxAttempts;
  const resolvedRetries = opts.retries ?? opts.maxRetries ?? initRetries ?? initMaxRetries;
  const maxAttempts = Math.max(
    1,
    resolvedMaxAttempts ?? (resolvedRetries !== undefined ? resolvedRetries + 1 : 3)
  );
  const baseDelayMs = Math.max(50, opts.baseDelayMs ?? initBaseDelayMs ?? 300);
  const timeoutMs = opts.timeoutMs ?? initTimeoutMs ?? 10_000;
  const retryableStatuses = new Set(
    opts.retryOnStatuses ?? initRetryOnStatuses ?? [408, 425, 429, 500, 502, 503, 504]
  );

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const signal = requestInit.signal ?? AbortSignal.timeout(timeoutMs);
      const response = await fetch(input, { ...requestInit, signal });
      if (!retryableStatuses.has(response.status) || attempt === maxAttempts) {
        return response;
      }
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
      const delayMs =
        Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? Math.min(retryAfterSec * 1000, 5_000)
          : baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100);
      await new Promise((r) => setTimeout(r, delayMs));
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) {
        throw err;
      }
      const delayMs = baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Outbound HTTP request failed after retries.");
}

/* ============================================================================
 * HMAC-Signed Flash Toast Cookie Helpers (Prevents Client-Side Toast Forgery)
 * ============================================================================ */

export interface SignedFlashToastData {
  id: string;
  type: "success" | "error" | "info" | "warning";
  message: string;
  ts?: number;
}

export function encodeSignedFlashToast(payload: {
  id?: string;
  type: "success" | "error" | "info" | "warning";
  message: string;
}): string {
  const normalized: SignedFlashToastData = {
    id: payload.id || crypto.randomBytes(6).toString("hex"),
    type: payload.type,
    message: String(payload.message || "").slice(0, 600),
    ts: Date.now(),
  };
  const b64 = Buffer.from(JSON.stringify(normalized), "utf8").toString("base64url");
  const sig = signPurposeHmac("flash-toast:v1", b64);
  return `sig1.${sig}.${b64}`;
}

export function verifySignedFlashToast(
  rawCookie: string | undefined | null,
  maxAgeMs = 120_000
): SignedFlashToastData | null {
  if (!rawCookie || typeof rawCookie !== "string") return null;
  if (!rawCookie.startsWith("sig1.")) return null;
  const parts = rawCookie.split(".");
  if (parts.length !== 3) return null;
  const [, sigHex, b64] = parts;
  if (!sigHex || !b64) return null;
  if (!verifyPurposeHmac("flash-toast:v1", b64, sigHex)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(b64, "base64url").toString("utf8")
    ) as SignedFlashToastData;
    if (
      !parsed ||
      typeof parsed.id !== "string" ||
      typeof parsed.message !== "string" ||
      !["success", "error", "info", "warning"].includes(parsed.type)
    ) {
      return null;
    }
    if (parsed.ts && Math.abs(Date.now() - parsed.ts) > maxAgeMs) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
