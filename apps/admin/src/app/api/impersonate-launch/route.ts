import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@rsl/core";

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function GET(req: NextRequest) {
  const jar = await cookies();
  const code = jar.get("rsl_imp_handoff")?.value?.trim() || "";
  if (code) {
    jar.set("rsl_imp_handoff", "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/impersonate-launch",
      maxAge: 0,
    });
  }

  if (!code) {
    return NextResponse.redirect(new URL("/clients", req.url));
  }

  const actionUrl = `${getEnv().APP_URL.replace(/\/+$/, "")}/api/auth/impersonate`;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="referrer" content="no-referrer" />
  <title>Opening Audited Support Session…</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; background: #fafafa; color: #18181b; }
    .card { background: #fff; border: 1px solid #e4e4e7; border-radius: 12px; padding: 24px 28px; max-width: 420px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
    button { margin-top: 12px; padding: 10px 18px; border-radius: 8px; border: 0; background: #0e8a56; color: #fff; font-weight: 600; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <p style="margin:0;font-weight:600;">Launching 30-Minute Audited Support View…</p>
    <form id="imp-form" method="POST" action="${escapeHtmlAttr(actionUrl)}">
      <input type="hidden" name="code" value="${escapeHtmlAttr(code)}" />
      <noscript><button type="submit">Continue to Client Workspace</button></noscript>
    </form>
  </div>
  <script>document.getElementById("imp-form").submit();</script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
