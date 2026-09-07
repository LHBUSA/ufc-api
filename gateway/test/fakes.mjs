/* In-memory fakes for KV, the UsageCounter Durable Object namespace, Analytics Engine and upstream fetch. */
import { decide, monthKey, windowKey } from "../src/policy.js";

export class FakeKV {
  constructor() { this.map = new Map(); }
  async get(key, opts) { const v = this.map.get(key); if (v === undefined) return null; return opts && opts.type === "json" ? JSON.parse(v) : v; }
  async put(key, value) { this.map.set(key, typeof value === "string" ? value : JSON.stringify(value)); }
  async delete(key) { this.map.delete(key); }
  async list({ prefix = "", limit = 1000 } = {}) { const keys = [...this.map.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name })); return { keys, list_complete: true }; }
}

/** Behaves like UsageCounter but in memory, using the same pure policy. */
class FakeCounter {
  constructor() { this.counters = new Map(); this.recent = []; this.last = null; }
  _get(k) { return this.counters.get(k) || 0; }
  _inc(k) { this.counters.set(k, this._get(k) + 1); }
  async hit({ limits, now = Date.now(), enforce_quota = true, enforce_rate = true, scope = "api" }) {
    const wk = scope === "api" ? windowKey(now) : `d:${windowKey(now)}`; const mk = monthKey(now);
    const d = decide({ minute_used: this._get(wk), month_used: scope === "api" ? this._get(mk) : 0 }, limits, now, { enforce_quota: scope === "api" && enforce_quota, enforce_rate });
    if (d.allowed) { this._inc(wk); if (scope === "api") this._inc(mk); } else this._inc(`denied:${mk}:${d.reason}`);
    if (scope === "api") this.last = new Date(now).toISOString();
    return d;
  }
  async record(row) { this.recent.unshift(row); this.recent = this.recent.slice(0, 50); return true; }
  async summary({ now = Date.now(), recent = 20 } = {}) {
    const mk = monthKey(now);
    return { month: mk.slice(2), month_used: this._get(mk), minute_used: this._get(windowKey(now)), minute_reset: 0, month_reset: 0, months: [{ month: mk.slice(2), requests: this._get(mk) }], denied: [...this.counters.entries()].filter(([k]) => k.startsWith(`denied:${mk}:`)).map(([k, n]) => ({ reason: k.split(":")[2], count: n })), last_used_at: this.last, recent: this.recent.slice(0, recent) };
  }
  async reset() { this.counters.clear(); this.recent = []; this.last = null; return true; }
}

export class FakeDONamespace {
  constructor() { this.objects = new Map(); }
  idFromName(name) { return { name }; }
  get(id) { if (!this.objects.has(id.name)) this.objects.set(id.name, new FakeCounter()); return this.objects.get(id.name); }
}

export class FakeAnalytics {
  constructor() { this.points = []; }
  writeDataPoint(p) { this.points.push(p); }
}

/** Upstream fetch fake: serves canned bodies by path (search ignored unless keyed). */
export function fakeUpstream(routes, { apiVersion = "2026-09-06.3" } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push({ url: u.pathname + u.search, init });
    const hit = routes[u.pathname + u.search] || routes[u.pathname];
    if (!hit) return new Response(JSON.stringify({ ok: false, data: null, error: { code: "route_not_found", message: "UFC API route not found." }, meta: { api: "PropSports UFC", version: apiVersion, request_id: "up-404" } }), { status: 404, headers: { "content-type": "application/json; charset=utf-8", "x-api-version": apiVersion, "x-request-id": "up-404", "access-control-allow-origin": "*" } });
    if (hit.throw) throw Object.assign(new Error(hit.throw), { name: hit.throw });
    const body = typeof hit.body === "string" ? hit.body : JSON.stringify(hit.body);
    return new Response(body, { status: hit.status || 200, headers: { "content-type": "application/json; charset=utf-8", "x-api-version": apiVersion, "x-request-id": hit.request_id || "up-1", "cache-control": hit.cache || "public, max-age=60, s-maxage=300, stale-while-revalidate=900", "cf-cache-status": "HIT", "access-control-allow-origin": "*", "set-cookie": "leak=1" } });
  };
  return { fetchImpl, calls };
}

export function makeEnv(overrides = {}) {
  return {
    GATEWAY_ENV: "test", UPSTREAM_BASE_URL: "https://upstream.test", PUBLIC_HOST: "https://gateway.test",
    ADMIN_TOKEN: "admin-secret", RAPIDAPI_PROXY_SECRET: "rapid-secret",
    API_KEYS: new FakeKV(), USAGE_COUNTER: new FakeDONamespace(), USAGE: new FakeAnalytics(),
    ASSETS: { fetch: async () => new Response("<html>portal</html>", { status: 200, headers: { "content-type": "text/html" } }) },
    ...overrides,
  };
}

export const execCtx = { waitUntil(p) { this.promises = this.promises || []; this.promises.push(p); }, passThroughOnException() {} };
