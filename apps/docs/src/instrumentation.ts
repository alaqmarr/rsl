export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNodeGracefulShutdown } = await import("./instrumentation.node");
    registerNodeGracefulShutdown();
  }

  if (process.env.NODE_ENV !== "production" && process.env.SENTRY_ENABLE_DEV !== "true") {
    return;
  }

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export async function onRequestError(...args: unknown[]) {
  if (process.env.NODE_ENV !== "production" && process.env.SENTRY_ENABLE_DEV !== "true") {
    return;
  }
  const Sentry = await import("@sentry/nextjs");
  return (Sentry.captureRequestError as (...a: unknown[]) => unknown)(...args);
}
