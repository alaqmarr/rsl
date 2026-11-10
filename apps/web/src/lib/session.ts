import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  resolveUserSessionFromToken,
  WEB_SESSION_COOKIE,
  type AuthenticatedSession,
} from "@rsl/auth";
import { encodeSignedFlashToast, verifySignedFlashToast } from "@rsl/core";

export type WebLocale = "en" | "hi";
export const WEB_LOCALE_COOKIE = "rsl_locale";
export const WEB_FLASH_TOAST_COOKIE = "rsl_toast";

export async function getOptionalWebSession(): Promise<AuthenticatedSession | null> {
  const jar = await cookies();
  const raw = jar.get(WEB_SESSION_COOKIE)?.value;
  return resolveUserSessionFromToken(raw);
}

export async function requireWebSession(): Promise<AuthenticatedSession> {
  const session = await getOptionalWebSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

export async function setWebSessionCookie(rawToken: string, maxAgeSec = 7 * 24 * 60 * 60) {
  const jar = await cookies();
  jar.set(WEB_SESSION_COOKIE, rawToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSec,
  });
}

export async function clearWebSessionCookie() {
  const jar = await cookies();
  jar.delete(WEB_SESSION_COOKIE);
}

export async function setSignedWebFlashToast(
  type: "success" | "error" | "info" | "warning",
  message: string
): Promise<void> {
  const clean = message.trim();
  if (!clean) return;
  const jar = await cookies();
  jar.set(WEB_FLASH_TOAST_COOKIE, encodeSignedFlashToast({ type, message: clean }), {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30,
  });
}

export async function readVerifiedWebFlashToast() {
  const jar = await cookies();
  const raw = jar.get(WEB_FLASH_TOAST_COOKIE)?.value;
  const verified = verifySignedFlashToast(raw);
  if (!verified) return null;
  return { id: verified.id, type: verified.type, message: verified.message };
}

export async function getWebLocale(): Promise<WebLocale> {
  const jar = await cookies();
  return jar.get(WEB_LOCALE_COOKIE)?.value === "hi" ? "hi" : "en";
}
