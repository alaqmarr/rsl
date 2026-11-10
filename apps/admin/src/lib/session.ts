import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_SESSION_COOKIE, resolveStaffSessionFromToken } from "@rsl/auth";
import { encodeSignedFlashToast, getEnv, verifySignedFlashToast } from "@rsl/core";

export const ADMIN_FLASH_TOAST_COOKIE = "rsl_admin_toast";

export async function getIncomingRequestHostname(): Promise<string> {
  const hdrs = await headers();
  const raw = (hdrs.get("x-forwarded-host") || hdrs.get("host") || "")
    .split(",")[0]!
    .trim()
    .toLowerCase();
  return raw.replace(/:\d+$/, "");
}

export async function isSetupSubdomainHost(): Promise<boolean> {
  const host = await getIncomingRequestHostname();
  if (!host) return false;
  const setupSub = (getEnv().SETUP_SUBDOMAIN || "setup").trim().toLowerCase();
  return host === `${setupSub}.localhost` || host.startsWith(`${setupSub}.`);
}

async function resolveSharedCookieDomain(): Promise<string | undefined> {
  if (process.env.NODE_ENV !== "production") return undefined;
  const host = await getIncomingRequestHostname();
  const primary = (getEnv().PRIMARY_DOMAIN || "rapidshiftlabs.in").trim().toLowerCase();
  if (host && primary && (host === primary || host.endsWith(`.${primary}`))) {
    return `.${primary}`;
  }
  return undefined;
}

export async function getOptionalStaffSession() {
  const jar = await cookies();
  const raw = jar.get(ADMIN_SESSION_COOKIE)?.value;
  return resolveStaffSessionFromToken(raw);
}

export async function getPendingMfaStaffSession() {
  const jar = await cookies();
  const raw = jar.get(ADMIN_SESSION_COOKIE)?.value;
  return resolveStaffSessionFromToken(raw, { allowPendingMfa: true });
}

export async function requireStaffSession() {
  if (await isSetupSubdomainHost()) {
    redirect("/setup");
  }
  const jar = await cookies();
  const raw = jar.get(ADMIN_SESSION_COOKIE)?.value;
  const sess = resolveStaffSessionFromToken(raw);
  if (sess) return sess;

  const pendingMfa = resolveStaffSessionFromToken(raw, { allowPendingMfa: true });
  if (pendingMfa) {
    redirect("/mfa");
  }
  redirect("/login");
}

export async function setStaffCookie(rawToken: string) {
  const jar = await cookies();
  // Host-only cookie so `rsl_staff_session` is never sent to customer or wildcard subdomains.
  jar.set(ADMIN_SESSION_COOKIE, rawToken, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
}

export async function setSignedAdminFlashToast(
  type: "success" | "error" | "info" | "warning",
  message: string
): Promise<void> {
  const clean = message.trim();
  if (!clean) return;
  const jar = await cookies();
  jar.set(ADMIN_FLASH_TOAST_COOKIE, encodeSignedFlashToast({ type, message: clean }), {
    httpOnly: false,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30,
  });
}

export async function readVerifiedAdminFlashToast() {
  const jar = await cookies();
  const raw = jar.get(ADMIN_FLASH_TOAST_COOKIE)?.value;
  const verified = verifySignedFlashToast(raw);
  if (!verified) return null;
  return { id: verified.id, type: verified.type, message: verified.message };
}

export async function clearStaffCookie() {
  const jar = await cookies();
  const legacyCookieDomain = await resolveSharedCookieDomain();
  jar.delete(ADMIN_SESSION_COOKIE);
  jar.set(ADMIN_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  if (legacyCookieDomain) {
    jar.set(ADMIN_SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
      domain: legacyCookieDomain,
    });
  }
}
