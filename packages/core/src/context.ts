import { AsyncLocalStorage } from "node:async_hooks";
import { newEntityId, registerContextClientTagResolver, sanitizeClientTag } from "./ids";

export type ActorType = "user" | "api_key" | "system" | "agent" | "staff" | "webhook";
export type RequestSource = "web" | "admin" | "api" | "worker" | "agent" | "webhook";

export interface RequestContext {
  tenantId?: string;
  clientTag?: string;
  actorType: ActorType;
  actorId: string;
  impersonatorId?: string | null;
  requestId: string;
  correlationId: string;
  source: RequestSource;
  ip?: string | null;
  userAgent?: string | null;
  roleSlug?: string;
  assetScope?: string[] | null;
  apiKeyScopes?: string[] | null;
  systemCapability?: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

// Wire automatic client-tag inheritance for all IDs created inside a request!
registerContextClientTagResolver(() => {
  const ctx = storage.getStore();
  return ctx?.clientTag ?? ctx?.tenantId;
});

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  const enriched: RequestContext = {
    ...ctx,
    clientTag: ctx.clientTag ?? (ctx.tenantId ? sanitizeClientTag(ctx.tenantId) : undefined),
  };
  return storage.run(enriched, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function createRootContext(
  partial: Partial<RequestContext> & { actorType: ActorType; actorId: string; source: RequestSource }
): RequestContext {
  const clientHint = partial.clientTag ?? partial.tenantId ?? "rsl";
  const reqId = partial.requestId ?? newEntityId("req", clientHint);
  return {
    requestId: reqId,
    correlationId: partial.correlationId ?? reqId,
    clientTag: sanitizeClientTag(clientHint),
    ...partial,
  };
}
