import { defineConfig } from "astro/config";

/* Static developer portal for ufc.proptechusa.ai. Output is served by the gateway Worker as static assets. */
export default defineConfig({
  site: "https://ufc.proptechusa.ai",
  output: "static",
  trailingSlash: "never",
  build: { format: "file", inlineStylesheets: "auto" },
  compressHTML: true,
  devToolbar: { enabled: false },
});
