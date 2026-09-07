/* Entitlement engine: pure functions over config/entitlements.json + config/plans.json.
 * Used by the gateway at request time and by the doc/OpenAPI generators at build time. */
import { ENTITLEMENTS, PLANS } from "./config.js";

const compiled = ENTITLEMENTS.endpoints
  .map((e) => {
    const literal = e.path.split("/").filter((s) => s && !s.startsWith("{")).length;
    const params = [...e.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    const re = new RegExp("^" + e.path.replace(/[.+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "([^/]+)") + "/?$");
    return { ...e, literal, params, re, segments: e.path.split("/").length };
  })
  /* most specific first: more segments, then more literal segments (so /fighters/media beats /fighters/{id}) */
  .sort((a, b) => b.segments - a.segments || b.literal - a.literal);

/** Resolve a request path to an entitlement endpoint (or null when the commercial layer does not expose it). */
export function matchEndpoint(pathname) {
  const path = pathname.replace(/\/+$/, "") || "/";
  for (const e of compiled) {
    const m = path.match(e.re);
    if (m) {
      const params = Object.fromEntries(e.params.map((p, i) => [p, decodeURIComponent(m[i + 1])]));
      return { endpoint: e, params };
    }
  }
  return null;
}

/** Features a plan is entitled to. '*' means everything. */
export function planFeatures(planKey) {
  const plan = PLANS.plans[planKey];
  if (!plan) return new Set();
  return new Set(plan.features);
}

export function planHasFeature(planKey, feature) {
  const f = planFeatures(planKey);
  return f.has("*") || f.has(feature);
}

/** Lowest public plan (in ladder order) that carries a feature; null when only non-public plans do. */
export function minimumPlanFor(feature) {
  for (const key of PLANS.plan_order) if (planHasFeature(key, feature)) return key;
  return null;
}

/** Parameter gates that apply to a matched endpoint given the query string. */
export function paramGatesFor(endpointKey, searchParams) {
  const hits = [];
  for (const g of ENTITLEMENTS.param_gates) {
    if (g.endpoint !== endpointKey) continue;
    const raw = searchParams.get(g.param);
    if (raw === null || raw === "") continue;
    if (g.value === "*") { hits.push(g); continue; }
    const values = raw.split(",").map((s) => s.trim().toLowerCase());
    if (values.includes(String(g.value).toLowerCase())) hits.push(g);
  }
  return hits;
}

/**
 * Full authorization decision for a plan against a path + query.
 * Returns { allowed, endpoint, params, reason, required_feature, required_plan }.
 */
export function authorizeRoute(planKey, pathname, searchParams) {
  const match = matchEndpoint(pathname);
  if (!match) return { allowed: false, reason: "route_not_found", endpoint: null, params: {} };
  const { endpoint, params } = match;
  if (!planHasFeature(planKey, endpoint.feature)) {
    return { allowed: false, reason: "plan_required", endpoint, params, required_feature: endpoint.feature, required_plan: minimumPlanFor(endpoint.feature) };
  }
  for (const gate of paramGatesFor(endpoint.key, searchParams)) {
    if (!planHasFeature(planKey, gate.feature)) {
      return { allowed: false, reason: "plan_required", endpoint, params, required_feature: gate.feature, required_plan: minimumPlanFor(gate.feature), gate };
    }
  }
  return { allowed: true, reason: null, endpoint, params };
}

/** Matrix rows for docs: every endpoint × every plan. */
export function entitlementMatrix() {
  const plans = [...PLANS.plan_order, "first_party"];
  return ENTITLEMENTS.endpoints.map((e) => ({
    key: e.key, method: e.method, path: e.path, feature: e.feature, origin: e.origin, summary: e.summary,
    plans: Object.fromEntries(plans.map((p) => [p, planHasFeature(p, e.feature)])),
    minimum_plan: minimumPlanFor(e.feature),
  }));
}
