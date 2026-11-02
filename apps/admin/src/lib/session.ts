import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_SESSION_COOKIE, resolveStaffSessionFromToken } from "@rsl/auth";
import { getEnv } from "@rsl/core";

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

export async function requireStaffSession() {
  if (await isSetupSubdomainHost()) {
    redirect("/setup");
  }
  const sess = await getOptionalStaffSession();
  if (!sess) redirect("/login");
  return sess;
}

export async function setStaffCookie(rawToken: string) {
  const jar = await cookies();
  const cookieDomain = await resolveSharedCookieDomain();
  jar.set(ADMIN_SESSION_COOKIE, rawToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 12 * 60 * 60,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });
}

export async function clearStaffCookie() {
  const jar = await cookies();
  const cookieDomain = await resolveSharedCookieDomain();
  jar.delete(ADMIN_SESSION_COOKIE);
  if (cookieDomain) {
    jar.set(ADMIN_SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
      domain: cookieDomain,
    });
  }
}
