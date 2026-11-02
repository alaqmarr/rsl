import { getInvitationPreviewByToken } from "@rsl/auth";
import { SYSTEM_ROLES } from "@rsl/rbac";
import { BrandLogo, StatusPill } from "@rsl/ui";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { acceptInvitationAction } from "@/lib/actions";

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const rawToken = sp.token?.trim() || "";
  const preview = rawToken ? getInvitationPreviewByToken(rawToken) : null;
  const roleLabel = preview
    ? SYSTEM_ROLES.find((r) => r.slug === preview.roleSlug)?.name ?? preview.roleSlug
    : "";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F8F9FB] p-6">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200/90 bg-white p-7 shadow-[0_1px_3px_rgba(15,23,42,0.05)] sm:p-8">
        <div className="mb-5">
          <BrandLogo variant="long" size="sm" subtitle="RSL Marketing & Tally Suite" />
        </div>

        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          Accept Team Invitation
        </h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-zinc-600">
          {preview
            ? `Join ${preview.workspaceName} on RSL Marketing.`
            : "Verify your team invitation link below to join your business workspace."}
        </p>

        <div className="mt-4">
          <FlashBanner notice={sp.notice} error={sp.error} />
        </div>

        {!preview ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-[13px] text-amber-950">
              <div className="font-semibold">Invitation link missing or expired</div>
              <p className="mt-1 leading-relaxed text-amber-900">
                Ask your business owner to resend a fresh invitation from{" "}
                <strong>Team &amp; Business Settings</strong>, or paste your invitation code below.
              </p>
            </div>

            <form method="get" action="/accept-invite" className="space-y-3">
              <div>
                <label htmlFor="inv-token" className="rsl-label">
                  Invitation Code
                </label>
                <input
                  id="inv-token"
                  name="token"
                  defaultValue={rawToken}
                  required
                  placeholder="Paste invitation token..."
                  className="rsl-input font-mono"
                />
              </div>
              <SubmitButton className="rsl-btn-primary w-full" pendingText="Checking Link...">
                Verify Invitation
              </SubmitButton>
            </form>
          </div>
        ) : (
          <form action={acceptInvitationAction} className="mt-4 space-y-4">
            <input type="hidden" name="token" value={rawToken} />

            <div className="space-y-2 rounded-xl border border-zinc-200/85 bg-zinc-50/75 p-4 text-[13px]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-500">Business</span>
                <span className="font-semibold text-slate-900">{preview.workspaceName}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-500">Invited Email</span>
                <span className="font-mono text-xs text-slate-800">{preview.email}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-500">Access Role</span>
                <StatusPill label={roleLabel} tone="emerald" />
              </div>
            </div>

            {!preview.existingUser && (
              <div>
                <label htmlFor="accept-name" className="rsl-label">
                  Your Full Name *
                </label>
                <input
                  id="accept-name"
                  name="name"
                  type="text"
                  required
                  minLength={2}
                  placeholder="Enter your full name"
                  className="rsl-input"
                />
              </div>
            )}

            <div>
              <label htmlFor="accept-password" className="rsl-label">
                {preview.existingUser
                  ? `Confirm Password for ${preview.email} *`
                  : "Create Account Password (8+ characters) *"}
              </label>
              <input
                id="accept-password"
                name="password"
                type="password"
                required
                minLength={preview.existingUser ? 6 : 8}
                placeholder={
                  preview.existingUser ? "Enter your existing password" : "Choose a strong password"
                }
                className="rsl-input"
              />
            </div>

            <SubmitButton className="rsl-btn-primary w-full" pendingText="Joining Workspace...">
              Accept Invitation &amp; Open Workspace
            </SubmitButton>
          </form>
        )}

        <div className="mt-5 border-t border-zinc-100 pt-4 text-center">
          <ActionLink
            href="/login"
            className="text-[13px] font-semibold text-emerald-600 hover:text-emerald-700"
          >
            ← Back to Sign In
          </ActionLink>
        </div>
      </div>
    </div>
  );
}
