/* Admin API (Bearer ADMIN_TOKEN): key issuance, listing, revocation, plan changes, usage.
 * This is the only place raw secrets are returned, once, at issuance or rotation. */
import { PLANS, PLAN_KEYS, ENTITLEMENTS } from "./config.js";
import { requireAdmin } from "./auth.js";
import { GatewayError, ok } from "./envelope.js";
import { generateKey, loadCustomer, loadKeyRecord, publicKeyView, randomBase62, saveCustomer, saveKeyRecord } from "./keys.js";
import { usageStub } from "./usage.js";
import { entitlementMatrix } from "./entitlements.js";

async function readJson(request) {
  try { return await request.json(); } catch { throw new GatewayError(400, "invalid_json", "Request body must be JSON."); }
}

function validatePlan(plan) { if (!PLAN_KEYS.includes(plan)) throw new GatewayError(400, "invalid_plan", "Unknown plan.", { allowed: PLAN_KEYS }); }
function validateChannel(channel) { if (!PLANS.channels.includes(channel)) throw new GatewayError(400, "invalid_channel", "Unknown channel.", { allowed: PLANS.channels }); }
function validateOverrides(o) {
  if (o === undefined || o === null) return undefined;
  if (typeof o !== "object") throw new GatewayError(400, "invalid_overrides", "overrides must be an object.");
  const out = {};
  for (const k of ["included_requests", "rate_limit_per_min", "concurrency_limit"]) if (o[k] !== undefined) { if (o[k] !== null && (!Number.isInteger(o[k]) || o[k] < 0)) throw new GatewayError(400, "invalid_overrides", `${k} must be a non-negative integer or null.`); out[k] = o[k]; }
  if (o.limit_mode !== undefined) { if (!["hard", "soft", "none", "custom"].includes(o.limit_mode)) throw new GatewayError(400, "invalid_overrides", "limit_mode must be hard|soft|none|custom."); out.limit_mode = o.limit_mode; }
  return out;
}
function validateExpiry(v) { if (v === undefined || v === null) return null; if (Number.isNaN(Date.parse(v))) throw new GatewayError(400, "invalid_expires_at", "expires_at must be an ISO-8601 timestamp."); return new Date(v).toISOString(); }

export async function issueKey(env, input) {
  const plan = input.plan || "developer"; validatePlan(plan);
  const channel = input.channel || "direct"; validateChannel(channel);
  const overrides = validateOverrides(input.overrides);
  const expires_at = validateExpiry(input.expires_at);
  let customer = input.customer_id ? await loadCustomer(env, input.customer_id) : null;
  if (input.customer_id && !customer) throw new GatewayError(404, "customer_not_found", "Unknown customer_id.");
  if (!customer) {
    if (!input.customer_name) throw new GatewayError(400, "customer_name_required", "customer_name is required when creating a customer.");
    customer = { id: `cus_${randomBase62(14)}`, name: String(input.customer_name).slice(0, 200), email: input.customer_email ? String(input.customer_email).slice(0, 200) : null, keys: [], created_at: new Date().toISOString(), notes: input.notes ? String(input.notes).slice(0, 2000) : null };
  }
  const k = await generateKey();
  const record = {
    id: k.key_id, secret_hash: k.secret_hash, display: k.display, customer_id: customer.id, customer_name: customer.name, customer_email: customer.email,
    plan, channel, status: "active", label: input.label ? String(input.label).slice(0, 120) : null,
    created_at: new Date().toISOString(), expires_at, rotated_from: input.rotated_from || null, rotated_to: null,
    overrides: overrides || {}, notes: input.key_notes ? String(input.key_notes).slice(0, 2000) : null,
  };
  customer.keys = [...new Set([...(customer.keys || []), record.id])];
  await saveKeyRecord(env, record);
  await saveCustomer(env, customer);
  return { key: k.raw, record: publicKeyView(record), customer };
}

export async function adminRouter(request, env, ctx, url) {
  requireAdmin(request, env);
  const path = url.pathname.replace(/\/+$/, "");
  const m = path.match(/^\/admin\/keys\/([A-Za-z0-9]{12})(?:\/(revoke|update|usage|reset-usage))?$/);

  if (path === "/admin/keys" && request.method === "POST") {
    const input = await readJson(request);
    const out = await issueKey(env, input);
    return ok(ctx, { ...out, warning: "Store the key now. The secret is not retrievable again." }, {}, {}, "private");
  }
  if (path === "/admin/keys" && request.method === "GET") {
    const list = await env.API_KEYS.list({ prefix: "key:", limit: 1000 });
    const keys = [];
    for (const item of list.keys) { const r = await env.API_KEYS.get(item.name, { type: "json" }); if (r && (!url.searchParams.get("customer_id") || r.customer_id === url.searchParams.get("customer_id"))) keys.push(publicKeyView(r)); }
    keys.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    return ok(ctx, keys, { count: keys.length, list_complete: list.list_complete }, {}, "private");
  }
  if (m) {
    const record = await loadKeyRecord(env, m[1]);
    if (!record) throw new GatewayError(404, "key_not_found", "Unknown key id.");
    const action = m[2] || null;
    if (!action && request.method === "GET") {
      const usage = await usageStub(env, record.id).summary({ recent: 20 });
      return ok(ctx, { record: publicKeyView(record), usage }, {}, {}, "private");
    }
    if (action === "usage" && request.method === "GET") return ok(ctx, await usageStub(env, record.id).summary({ recent: Number(url.searchParams.get("recent") || 50) }), {}, {}, "private");
    if (action === "reset-usage" && request.method === "POST") { await usageStub(env, record.id).reset(); return ok(ctx, { reset: true }, {}, {}, "private"); }
    if (action === "revoke" && request.method === "POST") { record.status = "revoked"; record.revoked_at = new Date().toISOString(); await saveKeyRecord(env, record); return ok(ctx, publicKeyView(record), {}, {}, "private"); }
    if (action === "update" && request.method === "POST") {
      const input = await readJson(request);
      if (input.plan !== undefined) { validatePlan(input.plan); record.plan = input.plan; }
      if (input.channel !== undefined) { validateChannel(input.channel); record.channel = input.channel; }
      if (input.overrides !== undefined) record.overrides = validateOverrides(input.overrides) || {};
      if (input.expires_at !== undefined) record.expires_at = validateExpiry(input.expires_at);
      if (input.label !== undefined) record.label = input.label ? String(input.label).slice(0, 120) : null;
      if (input.status !== undefined) { if (!["active", "revoked", "suspended"].includes(input.status)) throw new GatewayError(400, "invalid_status", "status must be active|revoked|suspended."); record.status = input.status; }
      record.updated_at = new Date().toISOString();
      await saveKeyRecord(env, record);
      return ok(ctx, publicKeyView(record), {}, {}, "private");
    }
  }
  const u = path.match(/^\/admin\/usage\/(.+)$/);
  if (u && request.method === "GET") return ok(ctx, await usageStub(env, decodeURIComponent(u[1])).summary({ recent: Number(url.searchParams.get("recent") || 50) }), { subject: decodeURIComponent(u[1]) }, {}, "private");
  if (path === "/admin/config" && request.method === "GET") return ok(ctx, { plans: PLANS, entitlements: ENTITLEMENTS, matrix: entitlementMatrix() }, {}, {}, "private");
  throw new GatewayError(404, "route_not_found", "Admin route not found.");
}
