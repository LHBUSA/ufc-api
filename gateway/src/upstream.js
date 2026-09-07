/* Forward an authorized request to the canonical UFC API and return the body unchanged.
 * The gateway never recomputes UFC intelligence; it adds commercial headers only. */
import { GATEWAY } from "./config.js";
import { GatewayError } from "./envelope.js";

const STRIP = new Set(GATEWAY.upstream_strip_response_headers.map((h) => h.toLowerCase()));

export function upstreamUrl(env, pathname, search) {
  const base = (env.UPSTREAM_BASE_URL || GATEWAY.upstream_base_url).replace(/\/$/, "");
  return base + pathname + (search || "");
}

export async function proxy(request, env, ctx, pathname, search) {
  const url = upstreamUrl(env, pathname, search);
  const headers = new Headers();
  for (const h of GATEWAY.upstream_forward_request_headers) { const v = request.headers.get(h); if (v) headers.set(h, v); }
  headers.set("accept", headers.get("accept") || "application/json");
  headers.set("user-agent", `proptechusa-ufc-gateway/${GATEWAY.gateway_version}`);
  headers.set("x-gateway-request-id", ctx.requestId);
  if (env.UPSTREAM_API_KEY) headers.set("x-api-key", env.UPSTREAM_API_KEY);
  const started = Date.now();
  let res;
  try {
    res = await fetch(url, { method: request.method === "HEAD" ? "HEAD" : "GET", headers, signal: AbortSignal.timeout(GATEWAY.upstream_timeout_ms), cf: { cacheEverything: false } });
  } catch (err) {
    const timeout = err && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new GatewayError(timeout ? 504 : 502, timeout ? "upstream_timeout" : "upstream_unavailable", timeout ? "The canonical UFC API did not respond in time." : "The canonical UFC API is unavailable.", { upstream: new URL(url).host });
  }
  const upstreamLatency = Date.now() - started;
  const out = new Headers();
  for (const [k, v] of res.headers) if (!STRIP.has(k.toLowerCase())) out.set(k, v);
  const cc = res.headers.get("cache-control") || "";
  const maxAge = cc.match(/max-age=(\d+)/);
  /* Never let a shared cache store an authenticated response; keep browser-level freshness from upstream. */
  out.set("Cache-Control", maxAge ? `private, max-age=${maxAge[1]}` : "private, no-store");
  return {
    status: res.status,
    headers: out,
    body: request.method === "HEAD" ? null : res.body,
    api_version: res.headers.get("x-api-version"),
    upstream_request_id: res.headers.get("x-request-id"),
    cache_status: res.headers.get("cf-cache-status") || null,
    upstream_latency_ms: upstreamLatency,
  };
}
