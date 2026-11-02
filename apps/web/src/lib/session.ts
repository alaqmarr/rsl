import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  resolveUserSessionFromToken,
  WEB_SESSION_COOKIE,
  type AuthenticatedSession,
} from "@rsl/auth";

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

export async function setWebSessionCookie(rawToken: string, maxAgeSec = 30 * 24 * 60 * 60) {
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
