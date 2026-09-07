/* Pure metering policy (no Workers runtime imports) so it is unit-testable in plain Node. */
import { GATEWAY } from "./config.js";

const WINDOW_MS = (GATEWAY.rate_limit_window_seconds || 60) * 1000;

export function windowKey(now) { return `w:${Math.floor(now / WINDOW_MS)}`; }
export function monthKey(now) { const d = new Date(now); return `m:${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; }
export function windowReset(now) { return Math.floor(((Math.floor(now / WINDOW_MS) + 1) * WINDOW_MS) / 1000); }
export function monthReset(now) { const d = new Date(now); return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000); }

/**
 * Decide whether one request is allowed and what the counters look like after it.
 * @param {{minute_used:number, month_used:number}} state   counts BEFORE this request
 * @param {{rate_limit_per_min:number|null, included_requests:number|null, limit_mode:'hard'|'soft'|'none'|'custom'}} limits
 * @param {number} now epoch ms
 * @param {{enforce_quota?:boolean, enforce_rate?:boolean}} opts
 */
export function decide(state, limits, now, opts = {}) {
  const enforceQuota = opts.enforce_quota !== false && limits.limit_mode !== "none";
  const enforceRate = opts.enforce_rate !== false;
  const quota = limits.included_requests === undefined ? null : limits.included_requests;
  const rate = limits.rate_limit_per_min === undefined ? null : limits.rate_limit_per_min;
  const month = { quota, used: state.month_used, remaining: quota === null ? null : Math.max(0, quota - state.month_used), reset: monthReset(now), over: quota !== null && state.month_used >= quota };
  const minute = { limit: rate, used: state.minute_used, remaining: rate === null ? null : Math.max(0, rate - state.minute_used), reset: windowReset(now) };
  let allowed = true, reason = null;
  if (enforceQuota && quota !== null && state.month_used >= quota && (limits.limit_mode === "hard" || limits.limit_mode === "custom")) { allowed = false; reason = "quota_exceeded"; }
  else if (enforceRate && rate !== null && state.minute_used >= rate) { allowed = false; reason = "rate_limited"; }
  if (allowed) {
    month.used += 1; if (quota !== null) month.remaining = Math.max(0, quota - month.used);
    minute.used += 1; if (rate !== null) minute.remaining = Math.max(0, rate - minute.used);
  }
  return { allowed, reason, minute, month, soft_over_quota: allowed && enforceQuota && limits.limit_mode === "soft" && month.over };
}
