/* Stable commercial envelope, error contract and response headers.
 * The envelope shape is identical to the canonical API: { ok, data, meta } / { ok:false, data:null, error, meta }. */
import { GATEWAY } from "./config.js";

export class GatewayError extends Error {
  constructor(status, code, message, detail = undefined, extraHeaders = undefined) {
    super(message);
    this.status = status; this.code = code; this.detail = detail; this.extraHeaders = extraHeaders;
  }
}

export function meta(ctx, extra = {}) {
  return { api: GATEWAY.product_name, version: ctx.apiVersion || null, gateway_version: GATEWAY.gateway_version, request_id: ctx.requestId, ...extra };
}

export function corsHeaders(kind = "public") {
  if (kind !== "public") return {};
  const c = GATEWAY.cors_public_api;
  return {
    "Access-Control-Allow-Origin": c.origin,
    "Access-Control-Allow-Methods": c.methods,
    "Access-Control-Allow-Headers": c.headers,
    "Access-Control-Expose-Headers": c.expose,
    "Access-Control-Max-Age": "600",
  };
}

export function baseHeaders(ctx, kind = "public") {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "X-Request-Id": ctx.requestId,
    "X-Gateway-Version": GATEWAY.gateway_version,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    ...(ctx.apiVersion ? { "X-API-Version": ctx.apiVersion } : {}),
    ...corsHeaders(kind),
  };
}

export function json(ctx, status, body, headers = {}, kind = "public") {
  return new Response(JSON.stringify(body), { status, headers: { ...baseHeaders(ctx, kind), ...headers } });
}

export function ok(ctx, data, extraMeta = {}, headers = {}, kind = "public") {
  return json(ctx, 200, { ok: true, data, meta: meta(ctx, extraMeta) }, headers, kind);
}

export function fail(ctx, status, code, message, detail = undefined, headers = {}, kind = "public") {
  const error = { code, message };
  if (detail !== undefined) error.detail = detail;
  return json(ctx, status, { ok: false, data: null, error, meta: meta(ctx) }, headers, kind);
}

export function fromError(ctx, err, kind = "public") {
  if (err instanceof GatewayError) return fail(ctx, err.status, err.code, err.message, err.detail, err.extraHeaders || {}, kind);
  console.error("[gateway] unhandled", err && err.stack ? err.stack : err);
  return fail(ctx, 500, "internal_error", "Unexpected gateway error.", undefined, {}, kind);
}

/** Rate-limit / quota headers from a usage decision. */
export function usageHeaders(usage, planKey) {
  const h = {};
  if (planKey) h["X-Plan"] = planKey;
  if (!usage) return h;
  if (usage.minute) {
    h["X-RateLimit-Limit"] = usage.minute.limit === null ? "unlimited" : String(usage.minute.limit);
    h["X-RateLimit-Remaining"] = usage.minute.limit === null ? "unlimited" : String(Math.max(0, usage.minute.remaining));
    h["X-RateLimit-Reset"] = String(usage.minute.reset);
  }
  if (usage.month) {
    h["X-Quota-Limit"] = usage.month.quota === null ? "unlimited" : String(usage.month.quota);
    h["X-Quota-Remaining"] = usage.month.quota === null ? "unlimited" : String(Math.max(0, usage.month.remaining));
    h["X-Quota-Reset"] = String(usage.month.reset);
  }
  return h;
}
