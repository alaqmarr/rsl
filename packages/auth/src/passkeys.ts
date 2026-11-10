import crypto from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { newId, RslError } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { ensureSystemRolesSeeded } from "@rsl/rbac";
import { ensureServiceCatalogSeeded } from "@rsl/billing";
import { controlDb } from "@rsl/tenancy";

function sha256Hex(raw: string | Buffer): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function sha256Buf(raw: string | Buffer): Buffer {
  return crypto.createHash("sha256").update(raw).digest();
}

export function listUserPasskeys(userId: string) {
  return controlDb()
    .select({
      id: controlSchema.userPasskeys.id,
      credentialId: controlSchema.userPasskeys.credentialId,
      deviceLabel: controlSchema.userPasskeys.deviceLabel,
      algorithm: controlSchema.userPasskeys.algorithm,
      signCount: controlSchema.userPasskeys.signCount,
      lastUsedAt: controlSchema.userPasskeys.lastUsedAt,
      createdAt: controlSchema.userPasskeys.createdAt,
    })
    .from(controlSchema.userPasskeys)
    .where(eq(controlSchema.userPasskeys.userId, userId))
    .all();
}

export function revokeUserPasskey(params: { userId: string; passkeyId: string }): void {
  controlDb()
    .delete(controlSchema.userPasskeys)
    .where(
      and(
        eq(controlSchema.userPasskeys.id, params.passkeyId),
        eq(controlSchema.userPasskeys.userId, params.userId)
      )
    )
    .run();
}

export function beginPasskeyRegistration(params: {
  userId: string;
  userEmail: string;
  userName: string;
  rpId: string;
  rpName?: string;
}) {
  const challenge = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  const identifier = `passkey_reg:${params.userId}`;

  const db = controlDb();
  db.delete(controlSchema.verifications)
    .where(eq(controlSchema.verifications.identifier, identifier))
    .run();

  db.insert(controlSchema.verifications)
    .values({
      id: newId("req", params.userName),
      identifier,
      valueHash: sha256Hex(challenge),
      failedAttempts: 0,
      expiresAt: now + 5 * 60_000,
      createdAt: now,
    })
    .run();

  const existing = listUserPasskeys(params.userId);

  return {
    challenge,
    rp: {
      id: params.rpId,
      name: params.rpName || "RapidShift Labs",
    },
    user: {
      id: Buffer.from(params.userId, "utf8").toString("base64url"),
      name: params.userEmail,
      displayName: params.userName,
    },
    pubKeyCredParams: [
      { type: "public-key" as const, alg: -7 }, // ES256 (P-256)
      { type: "public-key" as const, alg: -257 }, // RS256
    ],
    timeout: 60000,
    attestation: "none" as const,
    excludeCredentials: existing.map((p) => ({
      id: p.credentialId,
      type: "public-key" as const,
    })),
    authenticatorSelection: {
      residentKey: "preferred" as const,
      userVerification: "preferred" as const,
    },
  };
}

export function completePasskeyRegistration(params: {
  userId: string;
  expectedRpId: string;
  expectedOrigin: string;
  credentialId: string;
  clientDataJSONBase64Url: string;
  authenticatorDataBase64Url: string;
  publicKeySpkiBase64Url: string;
  algorithm?: number;
  transports?: string[];
  deviceLabel?: string;
}) {
  const db = controlDb();
  const now = Date.now();
  const identifier = `passkey_reg:${params.userId}`;

  const challengeRow = db
    .select()
    .from(controlSchema.verifications)
    .where(
      and(
        eq(controlSchema.verifications.identifier, identifier),
        gt(controlSchema.verifications.expiresAt, now)
      )
    )
    .get();

  if (!challengeRow) {
    throw new RslError("RSL-AUTH-1002", "Passkey registration challenge expired. Please try again.");
  }

  // Single-use challenge consumption
  db.delete(controlSchema.verifications)
    .where(eq(controlSchema.verifications.id, challengeRow.id))
    .run();

  const clientDataBuf = Buffer.from(params.clientDataJSONBase64Url, "base64url");
  let clientData: { type?: string; challenge?: string; origin?: string };
  try {
    clientData = JSON.parse(clientDataBuf.toString("utf8"));
  } catch {
    throw new RslError("RSL-VAL-1001", "Malformed WebAuthn clientDataJSON.");
  }

  if (clientData.type !== "webauthn.create") {
    throw new RslError("RSL-VAL-1001", "Unexpected WebAuthn ceremony type.");
  }
  if (!clientData.challenge || sha256Hex(clientData.challenge) !== challengeRow.valueHash) {
    throw new RslError("RSL-AUTH-1002", "Passkey registration challenge mismatch.");
  }
  if (clientData.origin !== params.expectedOrigin) {
    throw new RslError(
      "RSL-AUTH-1002",
      `Passkey origin mismatch (got '${clientData.origin}', expected '${params.expectedOrigin}').`
    );
  }

  const authData = Buffer.from(params.authenticatorDataBase64Url, "base64url");
  if (authData.length < 37) {
    throw new RslError("RSL-VAL-1001", "WebAuthn authenticatorData is truncated.");
  }

  const expectedRpHash = sha256Buf(params.expectedRpId);
  const actualRpHash = authData.subarray(0, 32);
  if (!crypto.timingSafeEqual(expectedRpHash, actualRpHash)) {
    throw new RslError("RSL-AUTH-1002", "Passkey relying-party ID hash mismatch.");
  }

  const flags = authData[32]!;
  if ((flags & 0x01) === 0) {
    throw new RslError("RSL-AUTH-1002", "Passkey User Presence (UP) flag was not asserted.");
  }
  const initialSignCount = authData.readUInt32BE(33);

  // Verify publicKeySpkiBase64Url imports cleanly into Node crypto
  const spkiDer = Buffer.from(params.publicKeySpkiBase64Url, "base64url");
  try {
    crypto.createPublicKey({ key: spkiDer, format: "der", type: "spki" });
  } catch {
    throw new RslError("RSL-VAL-1001", "Unsupported or invalid Passkey SPKI public key.");
  }

  const cleanCredId = params.credentialId.trim();
  const id = newId("pk", params.userId);
  const label = (params.deviceLabel || "Device Passkey").trim().slice(0, 60);

  db.insert(controlSchema.userPasskeys)
    .values({
      id,
      userId: params.userId,
      credentialId: cleanCredId,
      publicKeySpki: spkiDer.toString("base64url"),
      algorithm: params.algorithm === -257 ? -257 : -7,
      signCount: initialSignCount,
      transportsJson: JSON.stringify(params.transports ?? []),
      deviceLabel: label,
      lastUsedAt: now,
      createdAt: now,
    })
    .run();

  return { id, credentialId: cleanCredId, deviceLabel: label };
}

export function beginPasskeyAuthentication(params: {
  email?: string;
  rpId: string;
}) {
  const challengeId = newId("req", "passkey");
  const challenge = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  const db = controlDb();

  db.insert(controlSchema.verifications)
    .values({
      id: challengeId,
      identifier: `passkey_auth:${challengeId}`,
      valueHash: sha256Hex(challenge),
      failedAttempts: 0,
      expiresAt: now + 5 * 60_000,
      createdAt: now,
    })
    .run();

  let allowCredentials: Array<{ id: string; type: "public-key"; transports?: string[] }> = [];
  if (params.email && params.email.trim()) {
    const user = db
      .select({ id: controlSchema.users.id })
      .from(controlSchema.users)
      .where(eq(controlSchema.users.email, params.email.trim().toLowerCase()))
      .get();
    if (user) {
      const pks = db
        .select()
        .from(controlSchema.userPasskeys)
        .where(eq(controlSchema.userPasskeys.userId, user.id))
        .all();
      allowCredentials = pks.map((p) => {
        let transports: string[] | undefined;
        try {
          const parsed = JSON.parse(p.transportsJson);
          if (Array.isArray(parsed) && parsed.length > 0) transports = parsed;
        } catch {
          // ignore
        }
        return {
          id: p.credentialId,
          type: "public-key" as const,
          ...(transports ? { transports } : {}),
        };
      });
    }
  }

  return {
    challengeId,
    challenge,
    rpId: params.rpId,
    timeout: 60000,
    userVerification: "preferred" as const,
    allowCredentials,
  };
}

export function completePasskeyAuthentication(params: {
  challengeId: string;
  expectedRpId: string;
  expectedOrigin: string;
  credentialId: string;
  clientDataJSONBase64Url: string;
  authenticatorDataBase64Url: string;
  signatureBase64Url: string;
  ipAddress?: string;
  userAgent?: string;
}): { rawSessionToken: string; userId: string; workspaceId: string } {
  ensureSystemRolesSeeded();
  ensureServiceCatalogSeeded();

  const db = controlDb();
  const now = Date.now();
  const identifier = `passkey_auth:${params.challengeId.trim()}`;

  const challengeRow = db
    .select()
    .from(controlSchema.verifications)
    .where(
      and(
        eq(controlSchema.verifications.identifier, identifier),
        gt(controlSchema.verifications.expiresAt, now)
      )
    )
    .get();

  if (!challengeRow) {
    throw new RslError("RSL-AUTH-1002", "Passkey sign-in challenge expired. Please try again.");
  }

  db.delete(controlSchema.verifications)
    .where(eq(controlSchema.verifications.id, challengeRow.id))
    .run();

  const pkRow = db
    .select()
    .from(controlSchema.userPasskeys)
    .where(eq(controlSchema.userPasskeys.credentialId, params.credentialId.trim()))
    .get();

  if (!pkRow) {
    throw new RslError("RSL-AUTH-1002", "This Passkey is not registered on any RapidShift Labs account.");
  }

  const clientDataBuf = Buffer.from(params.clientDataJSONBase64Url, "base64url");
  let clientData: { type?: string; challenge?: string; origin?: string };
  try {
    clientData = JSON.parse(clientDataBuf.toString("utf8"));
  } catch {
    throw new RslError("RSL-VAL-1001", "Malformed WebAuthn clientDataJSON.");
  }

  if (clientData.type !== "webauthn.get") {
    throw new RslError("RSL-VAL-1001", "Unexpected WebAuthn assertion type.");
  }
  if (!clientData.challenge || sha256Hex(clientData.challenge) !== challengeRow.valueHash) {
    throw new RslError("RSL-AUTH-1002", "Passkey sign-in challenge mismatch.");
  }
  if (clientData.origin !== params.expectedOrigin) {
    throw new RslError("RSL-AUTH-1002", "Passkey sign-in origin mismatch.");
  }

  const authData = Buffer.from(params.authenticatorDataBase64Url, "base64url");
  if (authData.length < 37) {
    throw new RslError("RSL-VAL-1001", "WebAuthn authenticatorData truncated.");
  }

  const expectedRpHash = sha256Buf(params.expectedRpId);
  if (!crypto.timingSafeEqual(expectedRpHash, authData.subarray(0, 32))) {
    throw new RslError("RSL-AUTH-1002", "Passkey RP ID mismatch.");
  }

  const flags = authData[32]!;
  if ((flags & 0x01) === 0) {
    throw new RslError("RSL-AUTH-1002", "Passkey User Presence check failed.");
  }

  const newSignCount = authData.readUInt32BE(33);
  if (pkRow.signCount > 0 && newSignCount > 0 && newSignCount <= pkRow.signCount) {
    throw new RslError("RSL-AUTH-1002", "Passkey replay signature counter anomaly rejected.");
  }

  // Cryptographic verification over authenticatorData || SHA256(clientDataJSON)
  const clientDataHash = sha256Buf(clientDataBuf);
  const signedPayload = Buffer.concat([authData, clientDataHash]);
  const pubKeyObj = crypto.createPublicKey({
    key: Buffer.from(pkRow.publicKeySpki, "base64url"),
    format: "der",
    type: "spki",
  });
  const sigBuf = Buffer.from(params.signatureBase64Url, "base64url");

  const sigValid = crypto.verify("sha256", signedPayload, pubKeyObj, sigBuf);
  if (!sigValid) {
    throw new RslError("RSL-AUTH-1002", "Passkey cryptographic signature verification failed.");
  }

  db.update(controlSchema.userPasskeys)
    .set({
      signCount: Math.max(pkRow.signCount, newSignCount),
      lastUsedAt: now,
    })
    .where(eq(controlSchema.userPasskeys.id, pkRow.id))
    .run();

  const user = db
    .select()
    .from(controlSchema.users)
    .where(eq(controlSchema.users.id, pkRow.userId))
    .get();
  if (!user) {
    throw new RslError("RSL-AUTH-1002", "Account not found.");
  }

  const memberships = db
    .select()
    .from(controlSchema.memberships)
    .where(eq(controlSchema.memberships.userId, user.id))
    .all();
  const activeWorkspaceId =
    memberships.find((m) => m.workspaceId === user.activeWorkspaceId)?.workspaceId ??
    memberships[0]?.workspaceId;
  if (!activeWorkspaceId) {
    throw new RslError("RSL-AUTH-1001", "No business workspace is linked to this account.");
  }

  const rawSessionToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = sha256Hex(rawSessionToken);
  db.insert(controlSchema.sessions)
    .values({
      id: newId("ses", activeWorkspaceId),
      userId: user.id,
      tokenHash,
      activeWorkspaceId,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
      lastActiveAt: now,
      stepUpAt: now,
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
      createdAt: now,
    })
    .run();

  return {
    rawSessionToken,
    userId: user.id,
    workspaceId: activeWorkspaceId,
  };
}
