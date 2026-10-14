/**
 * Runs once when the server process starts (Next's instrumentation hook).
 *
 * Tunes the database connection and starts the background scheduler
 * (`server/jobs.ts`). Node runtime only - the edge runtime has neither a
 * filesystem nor long-lived timers - and written as a positive check on
 * `NEXT_RUNTIME` so the bundler drops the Node-only import from the edge build.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startNodeServer } = await import("./instrumentation-node");
    await startNodeServer();
  }
}

/**
 * Every error a request throws that the route wrapper did not catch - page
 * renders, server components, unexpected crashes - logged in the same
 * structured shape as everything else, so it is searchable and alertable.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
): Promise<void> {
  const { log } = await import("./lib/log");
  const requestId = request.headers["x-request-id"];
  log.error("request failed", {
    path: request.path,
    method: request.method,
    requestId: Array.isArray(requestId) ? requestId[0] : requestId,
    error,
  });
}
