import { defineConfig } from "astro/config";

/* Static developer portal for ufc.proptechusa.ai.
 *
 * The gateway Worker can serve this output from its asset binding, and does so
 * on workers.dev, but the custom domain resolves to Vercel. Both have to agree
 * about URL shape.
 *
 * format:"file" emits docs.html rather than docs/index.html. The Worker's asset
 * binding resolves /docs to it; Vercel does not, unless vercel.json sets
 * cleanUrls, which it now does. Without that, every extensionless route except
 * / returned 404 in production. If this ever moves to format:"directory",
 * cleanUrls becomes unnecessary rather than wrong, but the two settings should
 * be changed together.
 */
export default defineConfig({
  site: "https://ufc.proptechusa.ai",
  output: "static",
  trailingSlash: "never",
  build: { format: "file", inlineStylesheets: "auto" },
  compressHTML: true,
  devToolbar: { enabled: false },
});
