import { flushApiKeyUsageStats } from "@rsl/api-keys";
import { closeAllHandlesForShutdown } from "@rsl/tenancy";

const SHUTDOWN_HOOK_KEY = Symbol.for("rsl.web.sqliteShutdownHookRegistered");

export function registerNodeGracefulShutdown(): void {
  const g = globalThis as Record<symbol, boolean | undefined>;
  if (g[SHUTDOWN_HOOK_KEY]) {
    return;
  }
  g[SHUTDOWN_HOOK_KEY] = true;

  let closed = false;
  const flushAndCloseSync = () => {
    if (closed) return;
    closed = true;
    try {
      flushApiKeyUsageStats();
    } catch {
      // Best-effort buffered metric flush
    }
    try {
      closeAllHandlesForShutdown();
    } catch {
      // Best-effort SQLite WAL checkpoint & close
    }
  };

  process.once("exit", flushAndCloseSync);

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      if (process.listenerCount(signal) === 0) {
        flushAndCloseSync();
        process.exit(0);
      }
    });
  }
}
