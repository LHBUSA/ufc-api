#!/usr/bin/env node
/* Cross-platform `node --check` over gateway sources and scripts. */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const files = [
  ...readdirSync(join(ROOT, "gateway", "src")).filter((f) => f.endsWith(".js")).map((f) => join("gateway", "src", f)),
  ...readdirSync(join(ROOT, "scripts")).filter((f) => f.endsWith(".mjs")).map((f) => join("scripts", f)),
  ...readdirSync(join(ROOT, "scripts", "lib")).filter((f) => f.endsWith(".mjs")).map((f) => join("scripts", "lib", f)),
];
let bad = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ["--check", join(ROOT, f)], { stdio: "pipe" }); }
  catch (e) { bad++; console.error(`✖ ${f}\n${e.stderr}`); }
}
console.log(`${files.length - bad}/${files.length} files parse`);
process.exit(bad ? 1 : 0);
