/* Usage metering: per-minute rate limit + monthly quota + recent-request log.
 *
 * One Durable Object per subject (direct key id, or `rapidapi:<user>`). SQLite-backed, so counts are exact and
 * survive isolate restarts. The policy itself is the pure `decide()` in policy.js. */
import { DurableObject } from "cloudflare:workers";
import { GATEWAY } from "./config.js";
import { decide, monthKey, monthReset, windowKey, windowReset } from "./policy.js";

export { decide, monthKey, monthReset, windowKey, windowReset };

export class UsageCounter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS counters (period TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS recent (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, method TEXT, path TEXT, route_key TEXT, status INTEGER, latency_ms REAL, request_id TEXT, channel TEXT);
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);`);
  }

  _get(period) {
    const row = this.sql.exec("SELECT n FROM counters WHERE period = ?", period).toArray()[0];
    return row ? Number(row.n) : 0;
  }
  _inc(period) { this.sql.exec("INSERT INTO counters(period, n) VALUES (?, 1) ON CONFLICT(period) DO UPDATE SET n = n + 1", period); }

  /** Decide + count one request. scope 'api' (default) or 'dashboard' (separate window, no quota). */
  async hit({ limits, now = Date.now(), enforce_quota = true, enforce_rate = true, scope = "api" } = {}) {
    const wk = scope === "api" ? windowKey(now) : `d:${windowKey(now)}`;
    const mk = monthKey(now);
    const state = { minute_used: this._get(wk), month_used: scope === "api" ? this._get(mk) : 0 };
    const d = decide(state, limits, now, { enforce_quota: scope === "api" && enforce_quota, enforce_rate });
    if (d.allowed) { this._inc(wk); if (scope === "api") this._inc(mk); }
    else this._inc(`denied:${mk}:${d.reason}`);
    if (scope === "api") this.sql.exec("INSERT INTO kv(k, v) VALUES ('last_used_at', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", new Date(now).toISOString());
    if (Math.random() < 0.02) this.sql.exec("DELETE FROM counters WHERE (period LIKE 'w:%' OR period LIKE 'd:w:%') AND period NOT IN (?, ?)", windowKey(now), `d:${windowKey(now)}`);
    return d;
  }

  /** Post-response log line for the dashboard's "recent requests". */
  async record({ ts, method, path, route_key, status, latency_ms, request_id, channel }) {
    this.sql.exec("INSERT INTO recent(ts, method, path, route_key, status, latency_ms, request_id, channel) VALUES (?,?,?,?,?,?,?,?)", ts, method, path, route_key, status, latency_ms, request_id, channel);
    const keep = GATEWAY.recent_requests_kept || 50;
    this.sql.exec("DELETE FROM recent WHERE id NOT IN (SELECT id FROM recent ORDER BY id DESC LIMIT ?)", keep);
    return true;
  }

  async summary({ now = Date.now(), recent = 20 } = {}) {
    const mk = monthKey(now);
    const months = this.sql.exec("SELECT period, n FROM counters WHERE period LIKE 'm:%' ORDER BY period DESC LIMIT 6").toArray().map((r) => ({ month: r.period.slice(2), requests: Number(r.n) }));
    const denied = this.sql.exec("SELECT period, n FROM counters WHERE period LIKE ?", `denied:${mk}:%`).toArray().map((r) => ({ reason: r.period.split(":")[2], count: Number(r.n) }));
    const last = this.sql.exec("SELECT v FROM kv WHERE k = 'last_used_at'").toArray()[0];
    const rows = this.sql.exec("SELECT ts, method, path, route_key, status, latency_ms, request_id, channel FROM recent ORDER BY id DESC LIMIT ?", recent).toArray();
    return {
      month: mk.slice(2), month_used: this._get(mk), minute_used: this._get(windowKey(now)), minute_reset: windowReset(now), month_reset: monthReset(now),
      months, denied, last_used_at: last ? last.v : null,
      recent: rows.map((r) => ({ ...r, status: Number(r.status), latency_ms: r.latency_ms === null ? null : Number(r.latency_ms) })),
    };
  }

  async reset() { this.sql.exec("DELETE FROM counters; DELETE FROM recent; DELETE FROM kv;"); return true; }
}

export function usageStub(env, subject) {
  const id = env.USAGE_COUNTER.idFromName(subject);
  return env.USAGE_COUNTER.get(id);
}
