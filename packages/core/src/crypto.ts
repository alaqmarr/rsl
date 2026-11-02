import crypto from "node:crypto";
import { getEnv } from "./env";

function derive32ByteKey(secret: string, contextLabel: string): Buffer {
  return Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), Buffer.from(contextLabel, "utf8"), 32)
  );
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
 * AES-256-GCM envelope encryption (Section 13):
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

/**
 * Memory-hard password hashing via Node native scrypt (N=16384, r=8, p=1, 64-byte key).
 * Portable across Windows x64 and Oracle Cloud Ubuntu ARM64/x64 without native C++ build friction.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4]!, "base64");
  const expected = Buffer.from(parts[5]!, "base64");
  const actual = crypto.scryptSync(password, salt, expected.length, { N, r, p });
  return crypto.timingSafeEqual(actual, expected);
}

export function computeChainHash(prevHash: string, canonicalPayload: string): string {
  return crypto.createHash("sha256").update(`${prevHash}|${canonicalPayload}`).digest("hex");
}

export function signHmac(payload: string | Buffer, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export const hmacSha256 = signHmac;

export function verifyHmac(payload: string | Buffer, signatureHex: string, secret: string): boolean {
  const expected = Buffer.from(signHmac(payload, secret), "hex");
  const actual = Buffer.from(signatureHex, "hex");
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
