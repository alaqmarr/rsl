import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { fetchWithRetry, newEntityId, RslError } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { controlDb, ensurePlatformVapidConfig } from "@rsl/tenancy";

export interface WebPushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export interface BrowserPushSubscriptionInput {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

function toBase64Url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b.toString("base64url");
}

/**
 * Signs a standards-compliant RFC 8292 ES256 VAPID JWT using Node 22 native crypto.
 */
export function buildVapidAuthorizationHeader(params: {
  endpoint: string;
  subject: string;
  publicKey: string;
  privateKeyJwkJson: string;
}): string {
  const parsedUrl = new URL(params.endpoint);
  const audience = `${parsedUrl.protocol}//${parsedUrl.host}`;
  const header = toBase64Url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = toBase64Url(
    JSON.stringify({
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 12 * 3600,
      sub: params.subject,
    })
  );
  const signingInput = `${header}.${payload}`;
  const jwk = JSON.parse(params.privateKeyJwkJson) as crypto.JsonWebKey;
  const privateKeyObj = crypto.createPrivateKey({ key: jwk, format: "jwk" });
  const sig = crypto.sign("sha256", Buffer.from(signingInput, "ascii"), {
    key: privateKeyObj,
    dsaEncoding: "ieee-p1363",
  });
  const jwt = `${signingInput}.${toBase64Url(sig)}`;
  return `vapid t=${jwt}, k=${params.publicKey}`;
}

/**
 * Encrypts a JSON notification payload per RFC 8291 (`aes128gcm`).
 */
export function encryptWebPushPayloadAes128Gcm(params: {
  plaintextUtf8: string;
  subscriberP256dhBase64Url: string;
  subscriberAuthBase64Url: string;
}): Buffer {
  const uaPublic = Buffer.from(params.subscriberP256dhBase64Url, "base64url");
  const authSecret = Buffer.from(params.subscriberAuthBase64Url, "base64url");

  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) {
    throw new RslError("RSL-VAL-1001", "Invalid browser push p256dh public key.");
  }
  if (authSecret.length < 12) {
    throw new RslError("RSL-VAL-1001", "Invalid browser push auth secret.");
  }

  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey(); // 65-byte uncompressed point
  const sharedSecret = ecdh.computeSecret(uaPublic);

  const salt = crypto.randomBytes(16);
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "ascii"),
    uaPublic,
    asPublic,
  ]);
  const ikm = Buffer.from(
    crypto.hkdfSync("sha256", sharedSecret, authSecret, keyInfo, 32)
  );
  const cek = Buffer.from(
    crypto.hkdfSync(
      "sha256",
      ikm,
      salt,
      Buffer.from("Content-Encoding: aes128gcm\0", "ascii"),
      16
    )
  );
  const nonce = Buffer.from(
    crypto.hkdfSync(
      "sha256",
      ikm,
      salt,
      Buffer.from("Content-Encoding: nonce\0", "ascii"),
      12
    )
  );

  const recordPlaintext = Buffer.concat([
    Buffer.from(params.plaintextUtf8, "utf8"),
    Buffer.from([0x02]), // Final record delimiter per RFC 8188
  ]);

  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(recordPlaintext),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  // RFC 8188 header: salt(16) || rs(uint32BE = 4096) || idlen(uint8 = 65) || keyid(65)
  const rsBuf = Buffer.alloc(4);
  rsBuf.writeUInt32BE(4096, 0);
  const idLenBuf = Buffer.from([asPublic.length]);

  return Buffer.concat([salt, rsBuf, idLenBuf, asPublic, ciphertext]);
}

export function getPublicVapidKeyForClient(): string {
  return ensurePlatformVapidConfig().publicKey;
}

export function listUserWebPushSubscriptions(userId: string, workspaceId?: string) {
  const rows = controlDb()
    .select()
    .from(controlSchema.webPushSubscriptions)
    .where(
      workspaceId
        ? and(
            eq(controlSchema.webPushSubscriptions.userId, userId),
            eq(controlSchema.webPushSubscriptions.workspaceId, workspaceId),
            eq(controlSchema.webPushSubscriptions.active, true)
          )
        : and(
            eq(controlSchema.webPushSubscriptions.userId, userId),
            eq(controlSchema.webPushSubscriptions.active, true)
          )
    )
    .all();

  return rows.map((r) => ({
    ...r,
    deviceLabel: r.userAgent ? r.userAgent.slice(0, 56) : "Browser Push Device",
  }));
}

export function saveUserWebPushSubscription(params: {
  userId: string;
  workspaceId: string;
  subscription: BrowserPushSubscriptionInput;
  userAgent?: string | null;
}) {
  const endpoint = (params.subscription.endpoint || "").trim();
  const p256dhKey = (params.subscription.keys?.p256dh || "").trim();
  const authKey = (params.subscription.keys?.auth || "").trim();

  if (!endpoint.startsWith("https://") || !p256dhKey || !authKey) {
    throw new RslError(
      "RSL-VAL-1001",
      "Valid HTTPS Web Push endpoint, p256dh, and auth keys are required."
    );
  }

  const now = Date.now();
  const id = newEntityId("psh", params.workspaceId);

  controlDb()
    .insert(controlSchema.webPushSubscriptions)
    .values({
      id,
      userId: params.userId,
      workspaceId: params.workspaceId,
      endpoint,
      p256dhKey,
      authKey,
      userAgent: params.userAgent ?? null,
      active: true,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: controlSchema.webPushSubscriptions.endpoint,
      set: {
        userId: params.userId,
        workspaceId: params.workspaceId,
        p256dhKey,
        authKey,
        userAgent: params.userAgent ?? null,
        active: true,
      },
    })
    .run();

  return { ok: true, id, endpoint };
}

export const saveWebPushSubscription = saveUserWebPushSubscription;

export function removeUserWebPushSubscription(params: {
  userId: string;
  subscriptionId?: string;
  endpoint?: string;
}) {
  if (params.subscriptionId) {
    controlDb()
      .update(controlSchema.webPushSubscriptions)
      .set({ active: false })
      .where(
        and(
          eq(controlSchema.webPushSubscriptions.userId, params.userId),
          eq(controlSchema.webPushSubscriptions.id, params.subscriptionId)
        )
      )
      .run();
  } else if (params.endpoint) {
    controlDb()
      .update(controlSchema.webPushSubscriptions)
      .set({ active: false })
      .where(
        and(
          eq(controlSchema.webPushSubscriptions.userId, params.userId),
          eq(controlSchema.webPushSubscriptions.endpoint, params.endpoint)
        )
      )
      .run();
  } else {
    controlDb()
      .update(controlSchema.webPushSubscriptions)
      .set({ active: false })
      .where(eq(controlSchema.webPushSubscriptions.userId, params.userId))
      .run();
  }
  return { ok: true };
}

export const revokeWebPushSubscription = removeUserWebPushSubscription;

/**
 * Dispatches encrypted W3C Web Push notifications to all active browser/mobile
 * subscriptions registered in a workspace (non-throwing background-safe helper).
 */
export async function sendWorkspaceWebPushNotification(
  workspaceIdOrParams: string | { workspaceId: string; payload: WebPushPayload },
  maybePayload?: WebPushPayload
): Promise<{ attempted: number; delivered: number }> {
  const workspaceId =
    typeof workspaceIdOrParams === "string"
      ? workspaceIdOrParams
      : workspaceIdOrParams.workspaceId;
  const payload =
    typeof workspaceIdOrParams === "string"
      ? maybePayload!
      : workspaceIdOrParams.payload;
  if (!workspaceId || !payload) {
    return { attempted: 0, delivered: 0 };
  }
  try {
    const subs = controlDb()
      .select()
      .from(controlSchema.webPushSubscriptions)
      .where(
        and(
          eq(controlSchema.webPushSubscriptions.workspaceId, workspaceId),
          eq(controlSchema.webPushSubscriptions.active, true)
        )
      )
      .all();

    if (subs.length === 0) {
      return { attempted: 0, delivered: 0 };
    }

    const vapid = ensurePlatformVapidConfig();
    if (!vapid.isReady || !vapid.privateKeyJwkJson) {
      return { attempted: subs.length, delivered: 0 };
    }

    const jsonStr = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url || "/",
      tag: payload.tag || "rsl-alert",
      ts: Date.now(),
    });

    let delivered = 0;
    for (const sub of subs) {
      try {
        const bodyBuf = encryptWebPushPayloadAes128Gcm({
          plaintextUtf8: jsonStr,
          subscriberP256dhBase64Url: sub.p256dhKey,
          subscriberAuthBase64Url: sub.authKey,
        });
        const authHeader = buildVapidAuthorizationHeader({
          endpoint: sub.endpoint,
          subject: vapid.subject,
          publicKey: vapid.publicKey,
          privateKeyJwkJson: vapid.privateKeyJwkJson,
        });

        const resp = await fetchWithRetry(
          sub.endpoint,
          {
            method: "POST",
            headers: {
              Authorization: authHeader,
              "Content-Type": "application/octet-stream",
              "Content-Encoding": "aes128gcm",
              TTL: "86400",
              Urgency: "high",
            },
            body: new Uint8Array(bodyBuf),
          },
          { retries: 1, timeoutMs: 6000 }
        );

        if (resp.status >= 200 && resp.status < 300) {
          delivered++;
          controlDb()
            .update(controlSchema.webPushSubscriptions)
            .set({ lastDeliveredAt: Date.now() })
            .where(eq(controlSchema.webPushSubscriptions.id, sub.id))
            .run();
        } else if (resp.status === 404 || resp.status === 410) {
          controlDb()
            .delete(controlSchema.webPushSubscriptions)
            .where(eq(controlSchema.webPushSubscriptions.id, sub.id))
            .run();
        }
      } catch {
        // Isolate individual endpoint failures
      }
    }

    return { attempted: subs.length, delivered };
  } catch {
    return { attempted: 0, delivered: 0 };
  }
}
