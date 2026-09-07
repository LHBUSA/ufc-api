#!/usr/bin/env node
/* Read-only smoke against a deployed gateway (preview or production) and the canonical host.
 *
 *   node scripts/smoke.mjs --host https://<gateway> --dev <developer key> --pro <pro key> --ultra <ultra key> [--fp <first-party key>] [--rapid-secret …]
 *
 * Asserts: canonical host still serves; gateway parity (body identical to canonical for the same path);
 * plan gates (Fight DNA at Pro, Matchup DNA at Ultra); as-of; unknown fighter; unavailable DNA; bad key;
 * wrong plan; rate-limit headers; RapidAPI adapter (when --rapid-secret given); portal + docs + openapi served.
 */
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const HOST = (opt("--host", process.env.UFC_GATEWAY_HOST || "")).replace(/\/$/, "");
const CANON = (opt("--canonical", "https://ufc-api.propbetedge.ai")).replace(/\/$/, "");
const KEYS = { developer: opt("--dev", process.env.UFC_DEV_KEY), pro: opt("--pro", process.env.UFC_PRO_KEY), ultra: opt("--ultra", process.env.UFC_ULTRA_KEY), first_party: opt("--fp", process.env.UFC_FP_KEY) };
const RAPID = opt("--rapid-secret", process.env.RAPIDAPI_PROXY_SECRET);
if (!HOST) { console.error("--host required"); process.exit(2); }
const S = "ec94d296-2db3-4e0d-be6a-46de4f480672", D = "9a3b2a15-27d8-4554-9217-42ef2dd5d25c";
const results = [];
const rec = (name, ok, info = "") => { results.push({ name, ok, info }); console.log(`${ok ? "✔" : "✖"} ${name}${info ? `  ${info}` : ""}`); };
const get = async (base, path, headers = {}) => { const r = await fetch(base + path, { headers: { accept: "application/json", ...headers } }); const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch {} return { status: r.status, headers: r.headers, body, text }; };
const auth = (plan) => (KEYS[plan] ? { authorization: `Bearer ${KEYS[plan]}` } : {});
const stripMeta = (b) => { if (!b || typeof b !== "object") return b; const c = JSON.parse(JSON.stringify(b)); if (c.meta) { delete c.meta.request_id; delete c.meta.generated_at; } return c; };

/* canonical host must keep working */
const ci = await get(CANON, "/v1/ufc");
rec("canonical host GET /v1/ufc", ci.status === 200 && ci.body?.ok === true, `${CANON} ${ci.status} v${ci.headers.get("x-api-version")}`);
const cdna = await get(CANON, `/v1/ufc/fighters/${S}/dna`);
rec("canonical Fight DNA", cdna.status === 200 && cdna.body?.data?.snapshot?.metrics?.sig_landed_per_min?.origin === "pbe_derived");

/* gateway */
const h = await get(HOST, "/health");
rec("gateway /health", h.status === 200 && h.body?.data?.status === "ok", `${h.body?.data?.env} gw ${h.body?.data?.gateway_version} → ${h.body?.data?.upstream}`);
const noKey = await get(HOST, "/v1/ufc/events");
rec("no key → 401 api_key_required", noKey.status === 401 && noKey.body?.error?.code === "api_key_required");
const badKey = await get(HOST, "/v1/ufc/events", { authorization: "Bearer pt_ufc_live_AAAAAAAAAAAA_" + "b".repeat(32) });
rec("bad key → 401 invalid_api_key", badKey.status === 401 && badKey.body?.error?.code === "invalid_api_key");

if (KEYS.developer) {
  const paths = ["/v1/ufc", "/v1/ufc/events?status=upcoming&limit=3", `/v1/ufc/events/${(await get(CANON, "/v1/ufc/events?status=upcoming&limit=1")).body?.data?.[0]?.id}/card`, "/v1/ufc/fighters?q=strickland&limit=2", `/v1/ufc/fighters/${S}`, `/v1/ufc/fighters/${S}/history?limit=3`, "/v1/ufc/results?limit=2", "/v1/ufc/rankings?division=MIDDLEWEIGHT", "/v1/ufc/search?q=volkanovski&limit=2", "/v1/ufc/counts", "/v1/ufc/dna/metrics"];
  for (const p of paths) {
    const [g, c] = await Promise.all([get(HOST, p, auth("developer")), get(CANON, p)]);
    const same = g.status === c.status && JSON.stringify(stripMeta(g.body)) === JSON.stringify(stripMeta(c.body));
    rec(`parity developer ${p.slice(0, 60)}`, same, `${g.status} plan=${g.headers.get("x-plan")} rl=${g.headers.get("x-ratelimit-remaining")}/${g.headers.get("x-ratelimit-limit")} quota=${g.headers.get("x-quota-remaining")}`);
  }
  const st = await get(HOST, `/v1/ufc/fighters/${S}/stats`, auth("developer"));
  rec("developer: /stats → 403 plan_required (pro)", st.status === 403 && st.body?.error?.detail?.required_plan === "pro");
  const dna = await get(HOST, `/v1/ufc/fighters/${S}/dna`, auth("developer"));
  rec("developer: Fight DNA → 403 plan_required (pro)", dna.status === 403 && dna.body?.error?.code === "plan_required" && dna.body?.error?.detail?.required_plan === "pro");
  const m = await get(HOST, `/v1/ufc/matchups/${S}/${D}/dna`, auth("developer"));
  rec("developer: Matchup DNA → 403 (ultra)", m.status === 403 && m.body?.error?.detail?.required_plan === "ultra");
  const w = await get(HOST, "/v1/ufc/wire", auth("developer"));
  rec("developer: wire → 403 (enterprise)", w.status === 403);
  const nf = await get(HOST, "/v1/ufc/nope", auth("developer"));
  rec("unknown route → 404 route_not_found", nf.status === 404 && nf.body?.error?.code === "route_not_found");
  const hdr = await get(HOST, "/v1/ufc/counts", auth("developer"));
  rec("rate-limit + version headers present", ["x-request-id", "x-api-version", "x-gateway-version", "x-plan", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "x-quota-limit", "x-quota-remaining", "x-quota-reset", "x-upstream-request-id"].every((k) => hdr.headers.get(k)), `cache-control=${hdr.headers.get("cache-control")}`);
}
if (KEYS.pro) {
  const [g, c] = await Promise.all([get(HOST, `/v1/ufc/fighters/${S}/dna`, auth("pro")), get(CANON, `/v1/ufc/fighters/${S}/dna`)]);
  rec("pro: Fight DNA parity with canonical", g.status === 200 && JSON.stringify(stripMeta(g.body)) === JSON.stringify(stripMeta(c.body)), `as_of ${g.body?.data?.snapshot?.as_of_date} sig/min ${g.body?.data?.snapshot?.metrics?.sig_landed_per_min?.value}`);
  for (const fam of ["splits?opponent_stance=SOUTHPAW", "round-profile", "finish-profile", "position-profile"]) { const r = await get(HOST, `/v1/ufc/fighters/${S}/${fam}`, auth("pro")); rec(`pro: ${fam.split("?")[0]}`, r.status === 200 && r.body?.ok === true, fam === "position-profile" ? `status=${r.body?.data?.status}` : ""); }
  const asof = await get(HOST, `/v1/ufc/fighters/${S}/dna?as_of=2024-01-01`, auth("pro"));
  rec("pro: DNA as-of before first snapshot → 404 dna_not_available (truthful)", asof.status === 404 && asof.body?.error?.code === "dna_not_available");
  const asof2 = await get(HOST, `/v1/ufc/fighters/${S}/dna?as_of=2026-09-07`, auth("pro"));
  rec("pro: DNA as-of resolves", asof2.status === 200 && asof2.body?.meta?.resolved_as_of, `resolved ${asof2.body?.meta?.resolved_as_of}`);
  const unk = await get(HOST, "/v1/ufc/fighters/00000000-0000-0000-0000-000000000000/dna", auth("pro"));
  rec("pro: unknown fighter → 404 fighter_not_found (passthrough)", unk.status === 404 && unk.body?.error?.code === "fighter_not_found");
  const mq = await get(HOST, "/v1/ufc/dna/query?metric=finish_rate&limit=2", auth("pro"));
  rec("pro: dna/query → 403 (ultra)", mq.status === 403);
  const stats = await get(HOST, `/v1/ufc/events/x/card?include=stats`, auth("pro"));
  rec("pro: include=stats gate passes (upstream decides)", stats.status !== 403);
}
if (KEYS.ultra) {
  const [g, c] = await Promise.all([get(HOST, `/v1/ufc/matchups/${S}/${D}/dna`, auth("ultra")), get(CANON, `/v1/ufc/matchups/${S}/${D}/dna`)]);
  rec("ultra: Matchup DNA parity with canonical", g.status === 200 && JSON.stringify(stripMeta(g.body)) === JSON.stringify(stripMeta(c.body)), `comparisons=${g.body?.data?.comparisons?.length} insights=${g.body?.data?.insights?.length} warnings=${g.body?.data?.warnings?.length}`);
  const asof = await get(HOST, `/v1/ufc/matchups/${S}/${D}/dna?as_of=2025-01-01`, auth("ultra"));
  rec("ultra: Matchup as-of unavailable → 404 dna_not_available", asof.status === 404 && asof.body?.error?.code === "dna_not_available");
  const q = await get(HOST, "/v1/ufc/dna/query?metric=pace_retention_r3_vs_r1&min=0.9&min_confidence=low&limit=3", auth("ultra"));
  rec("ultra: dna/query", q.status === 200 && Array.isArray(q.body?.data));
  const ev = (await get(CANON, "/v1/ufc/events?status=upcoming&limit=1")).body?.data?.[0]?.id;
  const intel = await get(HOST, `/v1/ufc/events/${ev}/intelligence`, auth("ultra"));
  rec("ultra: event intelligence", intel.status === 200 || intel.status === 503, `${intel.status} ${intel.body?.error?.code || ""}`);
}
if (KEYS.first_party) {
  const r = await get(HOST, "/v1/ufc/wire?limit=2", auth("first_party"));
  rec("first-party: wire allowed, unmetered", r.status === 200 && !r.headers.get("x-ratelimit-limit"), `plan=${r.headers.get("x-plan")}`);
}
if (RAPID) {
  const r = await get(HOST, `/v1/ufc/fighters/${S}/dna`, { "x-rapidapi-proxy-secret": RAPID, "x-rapidapi-user": "smoke-user", "x-rapidapi-subscription": "PRO" });
  rec("rapidapi: PRO subscription → Fight DNA 200", r.status === 200 && r.headers.get("x-plan") === "pro");
  const b = await get(HOST, `/v1/ufc/fighters/${S}/dna`, { "x-rapidapi-proxy-secret": RAPID, "x-rapidapi-user": "smoke-user", "x-rapidapi-subscription": "BASIC" });
  rec("rapidapi: BASIC → 403 plan_required", b.status === 403);
  const bad = await get(HOST, "/v1/ufc/events", { "x-rapidapi-proxy-secret": "nope", "x-rapidapi-user": "x", "x-rapidapi-subscription": "PRO" });
  rec("rapidapi: bad proxy secret → 401", bad.status === 401);
}
/* portal */
for (const p of ["/", "/docs", "/pricing", "/learn/fight-dna", "/dashboard", "/openapi.json", "/legal"]) { const r = await fetch(HOST + p); rec(`portal ${p}`, r.status === 200, `${r.status} ${r.headers.get("content-type")}`); }

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log("failed:\n" + failed.map((f) => `  - ${f.name} ${f.info}`).join("\n")); process.exit(1); }
