import { NextRequest, NextResponse } from "next/server";
import { encryptEnvelope } from "@rsl/core";

export const PASSWORD_RESET_HANDOFF_COOKIE = "rsl_pw_reset";

export async function GET(req: NextRequest) {
  const email = (req.nextUrl.searchParams.get("email") || "").trim().toLowerCase();
  const token = (req.nextUrl.searchParams.get("token") || "").trim();

  const targetUrl = new URL("/reset-password", req.url);
  const res = NextResponse.redirect(targetUrl, 303);
  res.headers.set("Cache-Control", "private, no-store, max-age=0");
  res.headers.set("Referrer-Policy", "no-referrer");

  if (email && token) {
    const sealed = encryptEnvelope(
      JSON.stringify({
        email,
        token,
        issuedAt: Date.now(),
      })
    );
    res.cookies.set(PASSWORD_RESET_HANDOFF_COOKIE, sealed, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 30 * 60,
    });
  }

  return res;
}
