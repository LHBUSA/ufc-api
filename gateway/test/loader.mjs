/* Node module hooks: map `cloudflare:workers` to the local stub. Registered via `node --import ./test/loader.mjs`. */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(new URL("./hooks.mjs", import.meta.url), pathToFileURL("./"));
