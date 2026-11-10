import { notFound, redirect } from "next/navigation";
import { getDocArticleBySlug, loadAllDocArticles, recordDocsFeedback } from "@rsl/docs";
import { FormattedGuideBody } from "@rsl/ui";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";

export const dynamic = "force-dynamic";

const SECTION_ORDER = [
  "Getting Started",
  "Daily Operations",
  "Data & Cloud Storage",
  "Billing & Security",
  "Developers",
] as const;

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
  const groupedSections = SECTION_ORDER.map((section) => ({
    section,
    items: allArticles.filter((a) => a.section === section),
  })).filter((g) => g.items.length > 0);

  async function submitFeedbackAction(formData: FormData) {
    "use server";
    const helpful = String(formData.get("helpful")) === "yes";
    const comment = String(formData.get("comment") ?? "");
    recordDocsFeedback({ slug, helpful, comment });
    redirect(`/guides/${slug}?thanks=1`);
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_220px] lg:items-start">
      {/* Left Categorized Guide Sidebar */}
      <aside className="space-y-4 lg:sticky lg:top-20">
        <div className="rsl-frost-card rsl-sidebar-scroll max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl p-4">
          <div className="space-y-3">
            {groupedSections.map((group) => (
              <div key={group.section} className="rsl-nav-section">
                <div className="rsl-nav-section-btn cursor-default">
                  <span className="truncate">{group.section}</span>
                  <span className="rsl-nav-section-pill">{group.items.length}</span>
                </div>
                <ul className="rsl-nav-group-rail space-y-0.5 text-[13px]">
                  {group.items.map((a) => (
                    <li key={a.slug}>
                      <ActionLink
                        href={`/guides/${a.slug}`}
                        variant="card"
                        className={`rsl-nav-item ${
                          a.slug === article.slug ? "rsl-nav-item-active" : ""
                        }`}
                      >
                        <span className="truncate">{a.title}</span>
                      </ActionLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Main Guide Content */}
      <article className="min-w-0 space-y-6">
        <div className="rounded-2xl border border-zinc-200/90 bg-white p-6 shadow-2xs sm:p-8 lg:p-9">
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 tabular-nums">
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200/80">
              {article.section}
            </span>
            <span>{article.readingMinutes} min read</span>
            <span>•</span>
            <span>Reviewed {article.lastReviewed}</span>
          </div>

          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-[26px]">
            {article.title}
          </h1>
          <p className="mt-2 text-[14.5px] leading-relaxed text-zinc-600">{article.summary}</p>

          {/* Compact mobile On This Page jump list */}
          {article.headings.length > 1 && (
            <details className="mt-5 rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-4 py-2.5 text-xs xl:hidden">
              <summary className="cursor-pointer font-semibold text-slate-800 select-none">
                On this page ({article.headings.length} sections)
              </summary>
              <ul className="mt-2 space-y-1.5 border-t border-zinc-200/70 pt-2">
                {article.headings.map((h) => (
                  <li key={h.id} className={h.level === 3 ? "pl-3" : ""}>
                    <a
                      href={`#${h.id}`}
                      className="text-zinc-600 hover:font-medium hover:text-emerald-700"
                    >
                      {h.text}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="mt-6 w-full border-t border-zinc-200/80 pt-6">
            <FormattedGuideBody markdown={article.bodyMarkdown} linkMode="docs" />
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-2xs sm:p-6">
          {sp.thanks === "1" ? (
            <p className="text-[13px] font-semibold text-emerald-700">
              Thank you - your feedback was saved to help us keep this guide clear and practical.
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
                <label htmlFor="guide-feedback-comment" className="sr-only">
                  Optional feedback note
                </label>
                <input
                  id="guide-feedback-comment"
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

      {/* Sticky Right-Rail Table of Contents ("On This Page") */}
      {article.headings.length > 0 && (
        <aside className="hidden xl:sticky xl:top-20 xl:block">
          <div className="rounded-2xl border border-zinc-200/90 bg-white p-4 shadow-2xs">
            <p className="text-[10.5px] font-bold tracking-wider text-zinc-500 uppercase">
              On This Page
            </p>
            <nav aria-label="On this page" className="mt-2.5">
              <ul className="space-y-1.5 text-xs">
                {article.headings.map((h) => (
                  <li key={h.id} className={h.level === 3 ? "pl-3" : ""}>
                    <a
                      href={`#${h.id}`}
                      className="block leading-snug text-zinc-600 transition hover:font-medium hover:text-emerald-700"
                    >
                      {h.text}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </aside>
      )}
    </div>
  );
}
