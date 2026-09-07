/* PropTechUSA UFC Intelligence API — commercial gateway.
 *
 *   /v1/ufc/*            authenticate → entitle → meter → forward to the canonical UFC API → add commercial headers
 *   /health              liveness (no auth)
 *   /dashboard/api/*     key-scoped dashboard API (same origin)
 *   /admin/*             key issuance (ADMIN_TOKEN)
 *   everything else      static portal assets (apps/web/dist)
 *
 * The gateway never computes UFC intelligence. Bodies pass through unchanged.
 */
import { GATEWAY } from "./config.js";
import { authenticate } from "./auth.js";
import { authorizeRoute } from "./entitlements.js";
import { GatewayError, baseHeaders, corsHeaders, fail, fromError, ok, usageHeaders } from "./envelope.js";
import { proxy } from "./upstream.js";
import { usageStub } from "./usage.js";
import { writeUsage } from "./telemetry.js";
import { adminRouter } from "./admin.js";
import { dashboardRouter } from "./dashboard.js";
import upstreamContract from "../../upstream/ufc-contract.json" with { type: "json" };

export { UsageCounter } from "./usage.js";

function newCtx(request) {
  return { requestId: crypto.randomUUID(), apiVersion: upstreamContract.api_version || null, started: Date.now(), colo: request.cf?.colo || null };
}

async function gateway(request, env, ctx, execCtx, url) {
  const started = Date.now();
  const path = url.pathname.replace(/\/+$/, "") || "/";
  let identity = null, decision = null, usage = null, denied = null, upstream = null, status = 0;
  try {
    identity = await authenticate(request, env);
    decision = authorizeRoute(identity.plan, path, url.searchParams);
    if (!decision.allowed) {
      if (decision.reason === "route_not_found") throw new GatewayError(404, "route_not_found", "UFC API route not found.", { docs: GATEWAY.docs_url });
      const detail = { required_feature: decision.required_feature, required_plan: decision.required_plan, current_plan: identity.plan, upgrade_url: GATEWAY.pricing_url };
      if (decision.gate) detail.parameter = { name: decision.gate.param, value: decision.gate.value === "*" ? url.searchParams.get(decision.gate.param) : decision.gate.value };
      throw new GatewayError(403, "plan_required", decision.gate ? `Parameter ${decision.gate.param}=${detail.parameter.value} requires the ${decision.required_plan} plan or higher.` : `This endpoint requires the ${decision.required_plan} plan or higher.`, detail);
    }
    if (identity.enforce_quota || identity.enforce_rate) {
      usage = await usageStub(env, identity.subject).hit({ limits: identity.limits, enforce_quota: identity.enforce_quota, enforce_rate: identity.enforce_rate });
      if (!usage.allowed) {
        const retry = usage.reason === "rate_limited" ? Math.max(1, usage.minute.reset - Math.floor(Date.now() / 1000)) : Math.max(1, usage.month.reset - Math.floor(Date.now() / 1000));
        const msg = usage.reason === "rate_limited" ? `Rate limit of ${usage.minute.limit} requests per minute exceeded.` : `Monthly quota of ${usage.month.quota} requests exceeded.`;
        throw new GatewayError(429, usage.reason, msg, { retry_after_seconds: retry, plan: identity.plan, upgrade_url: GATEWAY.pricing_url }, { "Retry-After": String(retry), ...usageHeaders(usage, identity.plan) });
      }
    }
    upstream = await proxy(request, env, ctx, path, url.search);
    if (upstream.api_version) ctx.apiVersion = upstream.api_version;
    status = upstream.status;
    const headers = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(baseHeaders(ctx, "public"))) if (k !== "Cache-Control" && k !== "Content-Type") headers.set(k, v);
    for (const [k, v] of Object.entries(usageHeaders(usage, identity.plan))) headers.set(k, v);
    if (upstream.upstream_request_id) headers.set("X-Upstream-Request-Id", upstream.upstream_request_id);
    if (usage && usage.soft_over_quota) headers.set("X-Quota-Status", "over-quota-soft");
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json; charset=utf-8");
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    const res = fromError(ctx, err, "public");
    status = res.status;
    denied = err instanceof GatewayError ? err.code : "internal_error";
    return res;
  } finally {
    const latency = Date.now() - started;
    const point = {
      subject: identity ? identity.subject : "anonymous", request_id: ctx.requestId, channel: identity ? identity.channel : "", plan: identity ? identity.plan : "",
      key_id: identity ? identity.key_id || "" : "", route_key: decision && decision.endpoint ? decision.endpoint.key : "", path_template: decision && decision.endpoint ? decision.endpoint.path : "",
      method: request.method, status, cache_status: upstream ? upstream.cache_status : null, colo: ctx.colo,
      rapidapi_user: identity ? identity.attribution.rapidapi_user : "", rapidapi_subscription: identity ? identity.attribution.rapidapi_subscription : "",
      denied_reason: denied || "", latency_ms: latency, upstream_latency_ms: upstream ? upstream.upstream_latency_ms : 0, allowed: !denied,
    };
    writeUsage(env, point);
    if (identity && identity.kind === "direct") {
      execCtx.waitUntil(usageStub(env, identity.subject).record({ ts: new Date().toISOString(), method: request.method, path: url.pathname + url.search, route_key: point.route_key, status, latency_ms: latency, request_id: ctx.requestId, channel: identity.channel }).catch(() => {}));
    }
  }
}

export default {
  async fetch(request, env, execCtx) {
    const url = new URL(request.url);
    const ctx = newCtx(request);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const isApi = path === "/v1" || path.startsWith("/v1/");
    const isDashboardApi = path.startsWith("/dashboard/api");
    const isAdmin = path === "/admin" || path.startsWith("/admin/");

    if (request.method === "OPTIONS" && isApi) return new Response(null, { status: 204, headers: { ...corsHeaders("public"), "X-Request-Id": ctx.requestId } });

    try {
      if (path === "/health") {
        return ok(ctx, { status: "ok", service: GATEWAY.product_name, gateway_version: GATEWAY.gateway_version, env: env.GATEWAY_ENV || "unknown", upstream: env.UPSTREAM_BASE_URL || GATEWAY.upstream_base_url, api_version_target: upstreamContract.api_version, fight_dna_definition_version: upstreamContract.fight_dna_definition_version }, {}, {}, "private");
      }
      if (isAdmin) return await adminRouter(request, env, ctx, url);
      if (isDashboardApi) {
        if (!["GET", "POST"].includes(request.method)) return fail(ctx, 405, "method_not_allowed", "Only GET and POST are supported.", undefined, {}, "private");
        return await dashboardRouter(request, env, ctx, url);
      }
      if (isApi) {
        if (request.method !== "GET" && request.method !== "HEAD") return fail(ctx, 405, "method_not_allowed", "Only GET, HEAD and OPTIONS are supported.");
        return await gateway(request, env, ctx, execCtx, url);
      }
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return fail(ctx, 404, "route_not_found", "Not found.", undefined, {}, "private");
    } catch (err) {
      return fromError(ctx, err, isApi ? "public" : "private");
    }
  },
};
