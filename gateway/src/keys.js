/* API key format, hashing and KV records.
 *
 * Key format:   pt_ufc_live_<key_id:12 base62>_<secret:32 base62>
 *   - key_id identifies the record (KV `key:<key_id>`); it is safe to log and display.
 *   - the secret is never stored; KV holds sha256(full key) and comparison is constant-time.
 * Records:
 *   key:<key_id>        KeyRecord (below)
 *   customer:<cust_id>  { id, name, email, keys:[key_id], created_at, notes }
 */
import { KEY_PREFIX, PLANS } from "./config.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function randomBase62(len) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const KEY_RE = new RegExp("^" + KEY_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([A-Za-z0-9]{12})_([A-Za-z0-9]{32})$");

/** Parse a raw key into { key_id, raw } or null when the format is wrong (no KV lookup for junk). */
export function parseKey(raw) {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(KEY_RE);
  return m ? { key_id: m[1], raw: raw.trim() } : null;
}

export function maskKey(raw) {
  const p = parseKey(raw);
  if (!p) return null;
  return `${KEY_PREFIX}${p.key_id}_${"•".repeat(8)}${p.raw.slice(-4)}`;
}

export async function generateKey() {
  const key_id = randomBase62(12);
  const secret = randomBase62(32);
  const raw = `${KEY_PREFIX}${key_id}_${secret}`;
  return { key_id, raw, secret_hash: await sha256Hex(raw), display: maskKey(raw) };
}

export function extractCredential(request) {
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();
  const xkey = request.headers.get("x-api-key");
  return xkey ? xkey.trim() : "";
}

/** Effective limits: plan defaults overridden per key (config-driven, never scattered). */
export function effectiveLimits(record) {
  const plan = PLANS.plans[record.plan] || null;
  const o = record.overrides || {};
  return {
    plan: record.plan,
    included_requests: o.included_requests !== undefined ? o.included_requests : plan ? plan.included_requests : 0,
    rate_limit_per_min: o.rate_limit_per_min !== undefined ? o.rate_limit_per_min : plan ? plan.rate_limit_per_min : 0,
    limit_mode: o.limit_mode || (plan ? plan.limit_mode : "hard"),
    concurrency_limit: o.concurrency_limit !== undefined ? o.concurrency_limit : plan ? plan.concurrency_limit : null,
  };
}

/** Public projection of a key record (never includes secret_hash). */
export function publicKeyView(record) {
  const { secret_hash, ...rest } = record;
  return rest;
}

export async function loadKeyRecord(env, key_id) {
  if (!env.API_KEYS) return null;
  return env.API_KEYS.get(`key:${key_id}`, { type: "json" });
}

export async function saveKeyRecord(env, record) {
  await env.API_KEYS.put(`key:${record.id}`, JSON.stringify(record));
}

export async function loadCustomer(env, customer_id) {
  return env.API_KEYS.get(`customer:${customer_id}`, { type: "json" });
}

export async function saveCustomer(env, customer) {
  await env.API_KEYS.put(`customer:${customer.id}`, JSON.stringify(customer));
}

export function keyStatus(record, now = Date.now()) {
  if (!record) return "missing";
  if (record.status && record.status !== "active") return record.status;
  if (record.expires_at && Date.parse(record.expires_at) <= now) return "expired";
  return "active";
}
