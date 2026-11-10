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
    :root {
      --butter-cream: #F4EAD5;
      --forest-green: #1E3B2F;
      --snow-white: #F6F4EE;
      --midnight-black: #090A10;
    }
    body { font-family: system-ui, -apple-system, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; background: var(--butter-cream); color: var(--midnight-black); }
    .card { background: var(--snow-white); border: 1px solid var(--forest-green); border-radius: 14px; padding: 24px 28px; max-width: 420px; text-align: center; }
    .lead { margin: 0; font-weight: 600; color: var(--forest-green); }
    button { margin-top: 12px; padding: 10px 18px; border-radius: 10px; border: 0; background: var(--forest-green); color: var(--snow-white); font-weight: 600; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <p class="lead">Launching 30-Minute Audited Support View…</p>
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
