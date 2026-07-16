/**
 * fetch() wrapper that logs the request/response (or timeout/error) with
 * timing, and aborts after a bounded timeout instead of hanging forever —
 * added after GET /social-signals/contracts hung indefinitely with no
 * visibility into whether the request ever left the device, reached the
 * server, or just never got a response.
 */
export async function loggedFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = 15_000,
): Promise<Response> {
  const method = init.method ?? 'GET';
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  console.log(`[loggedFetch] → ${method} ${url}`);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    console.log(`[loggedFetch] ← ${method} ${url} status=${res.status} ${Date.now() - start}ms`);
    return res;
  } catch (e) {
    const elapsed = Date.now() - start;
    if (e instanceof Error && e.name === 'AbortError') {
      console.error(`[loggedFetch] ✗ ${method} ${url} TIMED OUT after ${elapsed}ms (limit ${timeoutMs}ms)`);
      throw new Error(`Request timed out after ${(elapsed / 1000).toFixed(1)}s: ${method} ${url}`);
    }
    console.error(`[loggedFetch] ✗ ${method} ${url} failed after ${elapsed}ms:`, e);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
