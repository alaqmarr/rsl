import { notFound, redirect } from "next/navigation";
import { getDocArticleBySlug, loadAllDocArticles, recordDocsFeedback } from "@rsl/docs";
import { FormattedGuideBody } from "@rsl/ui";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";

export const dynamic = "force-dynamic";

export default async function GuideDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ thanks?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const article = getDocArticleBySlug(slug);
  if (!article) {
    notFound();
  }

  const allArticles = loadAllDocArticles();

  async function submitFeedbackAction(formData: FormData) {
    "use server";
    const helpful = String(formData.get("helpful")) === "yes";
    const comment = String(formData.get("comment") ?? "");
    recordDocsFeedback({ slug, helpful, comment });
    redirect(`/guides/${slug}?thanks=1`);
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[260px_1fr] lg:items-start">
      <aside className="space-y-4">
        <div className="rounded-2xl border border-zinc-200/90 bg-white p-4 shadow-2xs">
          <p className="px-2.5 text-[11px] font-bold tracking-wider text-zinc-500 uppercase">
            All Help Guides
          </p>
          <ul className="mt-2.5 space-y-1 text-[13px]">
            {allArticles.map((a) => (
              <li key={a.slug}>
                <ActionLink
                  href={`/guides/${a.slug}`}
                  variant="card"
                  className={`block rounded-xl px-3 py-2 transition ${
                    a.slug === article.slug
                      ? "bg-emerald-50/90 font-semibold text-emerald-800 ring-1 ring-emerald-200/80"
                      : "font-medium text-zinc-600 hover:bg-zinc-50 hover:text-slate-900"
                  }`}
                >
                  {a.title}
                </ActionLink>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <article className="min-w-0 space-y-6">
        <div className="rounded-2xl border border-zinc-200/90 bg-white p-6 shadow-2xs sm:p-8 lg:p-9">
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 tabular-nums">
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200/80">
              {article.section}
            </span>
            <span>{article.readingMinutes} min read</span>
            <span>•</span>
            <span>Updated {article.lastReviewed}</span>
          </div>

          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
            {article.title}
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-zinc-600">{article.summary}</p>

          <div className="mt-6 max-w-4xl border-t border-zinc-200/80 pt-6">
            <FormattedGuideBody markdown={article.bodyMarkdown} linkMode="docs" />
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-2xs sm:p-6">
          {sp.thanks === "1" ? (
            <p className="text-[13px] font-semibold text-emerald-700">
              Thank you — your feedback was saved to help us keep this guide clear and practical.
            </p>
          ) : (
            <form action={submitFeedbackAction} className="space-y-3.5">
              <p className="text-[13px] font-semibold text-slate-900">
                Was this guide easy to follow?
              </p>
              <div className="flex flex-wrap items-center gap-4 text-[13px] text-slate-800">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="helpful"
                    value="yes"
                    defaultChecked
                    className="accent-emerald-600"
                  />
                  <span>Yes, clear and helpful</span>
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="helpful"
                    value="no"
                    className="accent-emerald-600"
                  />
                  <span>Needs clearer steps</span>
                </label>
              </div>
              <div className="flex flex-col gap-2.5 sm:flex-row">
                <input
                  type="text"
                  name="comment"
                  placeholder="Optional note (what were you looking for?)"
                  className="rsl-input"
                />
                <SubmitButton className="rsl-btn-secondary shrink-0" pendingText="Saving...">
                  Send Feedback
                </SubmitButton>
              </div>
            </form>
          )}
        </div>
      </article>
    </div>
  );
}
