#!/usr/bin/env node
/* Issue / manage commercial API keys through the gateway admin API.
 *
 *   ADMIN_TOKEN=… node scripts/issue-key.mjs --host https://ufc.proptechusa.ai issue --customer "Acme" --email dev@acme.test --plan pro --label prod
 *   ADMIN_TOKEN=… node scripts/issue-key.mjs list
 *   ADMIN_TOKEN=… node scripts/issue-key.mjs get <key_id>
 *   ADMIN_TOKEN=… node scripts/issue-key.mjs revoke <key_id>
 *   ADMIN_TOKEN=… node scripts/issue-key.mjs update <key_id> --plan ultra --quota 1000000 --rpm 900
 *
 * The raw key is printed ONCE at issuance. Store it in your secret manager; it cannot be retrieved again.
 */
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const host = (opt("--host", process.env.UFC_GATEWAY_HOST || "https://ufc.proptechusa.ai")).replace(/\/$/, "");
const token = process.env.ADMIN_TOKEN;
if (!token) { console.error("ADMIN_TOKEN env var required"); process.exit(2); }
const cmd = args.find((a) => !a.startsWith("--") && !args[args.indexOf(a) - 1]?.startsWith("--"));
const call = async (path, method = "GET", body) => {
  const r = await fetch(host + path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!j.ok) { console.error(`${r.status} ${j.error?.code}: ${j.error?.message}`, j.error?.detail ? JSON.stringify(j.error.detail) : ""); process.exit(1); }
  return j.data;
};
const id = args[args.indexOf(cmd) + 1];
if (cmd === "issue") {
  const overrides = {};
  if (opt("--quota")) overrides.included_requests = Number(opt("--quota"));
  if (opt("--rpm")) overrides.rate_limit_per_min = Number(opt("--rpm"));
  if (opt("--limit-mode")) overrides.limit_mode = opt("--limit-mode");
  const d = await call("/admin/keys", "POST", { customer_name: opt("--customer"), customer_email: opt("--email"), customer_id: opt("--customer-id"), plan: opt("--plan", "developer"), channel: opt("--channel", "direct"), label: opt("--label"), expires_at: opt("--expires"), overrides: Object.keys(overrides).length ? overrides : undefined, notes: opt("--notes") });
  console.log(`\nAPI KEY (shown once):\n\n  ${d.key}\n\nkey_id=${d.record.id} plan=${d.record.plan} channel=${d.record.channel} customer=${d.customer.id} (${d.customer.name})\n`);
} else if (cmd === "list") {
  const d = await call("/admin/keys" + (opt("--customer-id") ? `?customer_id=${opt("--customer-id")}` : ""));
  for (const k of d) console.log(`${k.id}  ${k.status.padEnd(8)} ${k.plan.padEnd(12)} ${k.channel.padEnd(12)} ${k.customer_name}  ${k.label || ""}  ${k.created_at}`);
  console.log(`${d.length} keys`);
} else if (cmd === "get" && id) {
  console.log(JSON.stringify(await call(`/admin/keys/${id}`), null, 2));
} else if (cmd === "revoke" && id) {
  console.log(JSON.stringify(await call(`/admin/keys/${id}/revoke`, "POST"), null, 2));
} else if (cmd === "update" && id) {
  const body = {};
  if (opt("--plan")) body.plan = opt("--plan");
  if (opt("--status")) body.status = opt("--status");
  if (opt("--label")) body.label = opt("--label");
  if (opt("--expires")) body.expires_at = opt("--expires");
  const overrides = {};
  if (opt("--quota")) overrides.included_requests = Number(opt("--quota"));
  if (opt("--rpm")) overrides.rate_limit_per_min = Number(opt("--rpm"));
  if (opt("--limit-mode")) overrides.limit_mode = opt("--limit-mode");
  if (Object.keys(overrides).length) body.overrides = overrides;
  console.log(JSON.stringify(await call(`/admin/keys/${id}/update`, "POST", body), null, 2));
} else {
  console.error("usage: issue|list|get <id>|revoke <id>|update <id> [--host …] [--customer … --email … --plan … --channel … --label … --quota … --rpm … --limit-mode …]");
  process.exit(2);
}
