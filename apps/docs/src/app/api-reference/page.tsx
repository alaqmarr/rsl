import { resolvePublicEndpoints } from "@rsl/core";
import { generateCodeSamples, getApiReferenceEndpoints } from "@rsl/docs";
import { PageHeader, SectionCard, TabbedApiCodeViewer } from "@rsl/ui";
import { ActionLink } from "@/components/ios-feedback";

export const dynamic = "force-dynamic";

export default function ApiReferencePage() {
  const endpointsConfig = resolvePublicEndpoints();
  const baseUrl = endpointsConfig.cloudBaseUrl;
  const openApiHref = `${endpointsConfig.localBaseUrl ?? endpointsConfig.cloudBaseUrl}/api/v1/openapi.json`;
  const endpoints = getApiReferenceEndpoints();

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-zinc-200/90 bg-white p-6 shadow-2xs sm:p-7">
        <PageHeader
          eyebrow="Public REST API v1"
          title="Developer API Reference"
          subtitle={`Base URL: ${baseUrl} • Authenticate with your business API key (Bearer rsl_live_<business>_...) created in API & Tally Webhooks.`}
          actions={
            <a
              href={openApiHref}
              target="_blank"
              rel="noreferrer"
              className="rsl-btn-secondary"
            >
              Download OpenAPI 3.1 JSON
            </a>
          }
        />
      </div>

      <div className="space-y-5">
        {endpoints.map((ep) => {
          const samples = generateCodeSamples(ep, baseUrl);
          return (
            <SectionCard
              key={ep.id}
              title={ep.title}
              subtitle={ep.summary}
              action={
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 tabular-nums">
                  <span className="rounded-md bg-slate-900 px-2 py-0.5 font-mono text-[11px] font-bold text-white">
                    {ep.method}
                  </span>
                  <code className="rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-900">
                    {ep.path}
                  </code>
                  <span>•</span>
                  <span>Scopes: {ep.scopes.join(", ")}</span>
                  <span>•</span>
                  <span>{ep.rateLimitPerMin} req/min</span>
                </div>
              }
            >
              <div id={ep.id} className="space-y-4">
                <TabbedApiCodeViewer
                  curl={samples.curl}
                  javascript={samples.javascript}
                  python={samples.python}
                  responseJson={JSON.stringify(ep.responseExample, null, 2)}
                />

                {ep.errorCodes && ep.errorCodes.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 text-xs text-zinc-500">
                    <span className="font-semibold text-zinc-600">Possible Error Codes:</span>
                    {ep.errorCodes.map((errCode) => (
                      <ActionLink
                        key={errCode}
                        href={`/errors/${errCode}`}
                        className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50"
                      >
                        {errCode}
                      </ActionLink>
                    ))}
                  </div>
                )}
              </div>
            </SectionCard>
          );
        })}
      </div>
    </div>
  );
}
