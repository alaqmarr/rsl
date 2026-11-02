import { ERROR_CATALOG } from "@rsl/core";
import { PageHeader, SectionCard } from "@rsl/ui";

export default function ErrorsPage() {
  const errors = Object.values(ERROR_CATALOG);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-zinc-200/90 bg-white p-6 shadow-2xs sm:p-7">
        <PageHeader
          eyebrow="Plain-English Troubleshooting"
          title="Common Errors & Fixes"
          subtitle="Every message across your business dashboard, Tally Prime connector, backup tool, and REST API explains what happened in plain language and the exact step to resolve it."
        />
      </div>

      <SectionCard
        title={`Error Reference (${errors.length})`}
        subtitle="Lookup any error code to see what caused it and how to fix it immediately"
        noPadding
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-zinc-200/80 bg-zinc-50/70 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
              <tr>
                <th className="px-5 py-3 sm:px-6">Code</th>
                <th className="px-4 py-3">HTTP</th>
                <th className="px-4 py-3">What Happened</th>
                <th className="px-5 py-3 sm:px-6">How to Resolve</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {errors.map((err) => (
                <tr key={err.code} id={err.code} className="align-top hover:bg-zinc-50/60">
                  <td className="px-5 py-3.5 font-mono text-xs font-bold whitespace-nowrap text-slate-900 sm:px-6">
                    {err.code}
                  </td>
                  <td className="px-4 py-3.5 font-mono text-xs text-zinc-500 tabular-nums">
                    {err.httpStatus}
                  </td>
                  <td className="px-4 py-3.5 font-medium text-slate-900">{err.userMessage}</td>
                  <td className="px-5 py-3.5 text-zinc-600 sm:px-6">{err.remediation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
