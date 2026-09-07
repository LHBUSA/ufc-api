/* Document routes must render, not download, and must actually exist.
 *
 * Two failures motivated this file.
 *
 * The reported one was that clicking the brand logo downloaded the page
 * instead of navigating. A browser downloads a document when the response
 * says Content-Disposition: attachment, or when the Content-Type is a binary
 * type such as application/octet-stream. Both are asserted against here.
 * Note that Vercel sends "Content-Disposition: inline" on static files; that
 * is the opposite of a download and is explicitly allowed. Only "attachment"
 * is a defect, so the assertion targets that word rather than the header's
 * presence, which would fail on a correct response.
 *
 * The real one was that six of seven document routes returned 404. The Astro
 * build emits page.html rather than page/index.html, and Vercel served the
 * output directory literally until cleanUrls was set. A header-only test
 * would have passed throughout, because a 404 page is still well-formed HTML,
 * so status is asserted too.
 *
 *   BASE_URL=https://ufc.proptechusa.ai node --test tests/routing.test.mjs
 *
 * Skips itself when no BASE_URL is configured so unit runs stay offline.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

const BASE = (process.env.BASE_URL || "").replace(/\/$/, "");

const DOCUMENT_ROUTES = ["/", "/docs", "/workspace", "/pricing", "/dashboard", "/learn/fight-dna", "/legal"];

/* Only genuinely binary payloads may look like files. Everything a browser is
 * meant to render inline is listed with the type it must be served as. */
const ASSETS = [
  ["/openapi.json", "application/json"],
  ["/favicon.ico", /image\/(vnd\.microsoft\.icon|x-icon)/],
  ["/favicon.svg", "image/svg+xml"],
  ["/brand/ufc-api-mark.svg", "image/svg+xml"],
  ["/og.png", "image/png"],
];

const get = (path) =>
  fetch(BASE + path, {
    redirect: "follow",
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": "ufc-api-routing-test" },
  });

describe("document routes", { skip: BASE ? false : "set BASE_URL to run" }, () => {
  for (const route of DOCUMENT_ROUTES) {
    test(`${route} renders as HTML`, async () => {
      const res = await get(route);
      assert.equal(res.status, 200, `${route} returned ${res.status}; an extensionless route 404s when cleanUrls is off`);

      const type = res.headers.get("content-type") || "";
      assert.match(type, /text\/html/, `${route} content-type was ${type || "(none)"}`);
      assert.doesNotMatch(type, /application\/octet-stream/, `${route} served as a binary download`);

      const disposition = res.headers.get("content-disposition") || "";
      assert.doesNotMatch(
        disposition,
        /attachment/i,
        `${route} sent Content-Disposition: ${disposition}, which makes the browser download the page`,
      );
    });
  }
});

describe("static assets", { skip: BASE ? false : "set BASE_URL to run" }, () => {
  for (const [path, expected] of ASSETS) {
    test(`${path} has the right MIME type`, async () => {
      const res = await fetch(BASE + path, { headers: { "user-agent": "ufc-api-routing-test" } });
      assert.equal(res.status, 200, `${path} returned ${res.status}`);
      const type = res.headers.get("content-type") || "";
      if (expected instanceof RegExp) assert.match(type, expected, `${path} content-type was ${type}`);
      else assert.ok(type.startsWith(expected), `${path} content-type was ${type}, expected ${expected}`);
    });
  }
});

describe("brand home link", { skip: BASE ? false : "set BASE_URL to run" }, () => {
  test("the logo points at / and / is a rendered document", async () => {
    const res = await get("/docs");
    const html = await res.text();
    /* The anchor itself is correct and must stay a plain anchor: no click
     * interception, no scripted navigation. Assert the markup so a future
     * "fix" in the UI layer is caught here instead of in production. */
    assert.match(html, /<a[^>]*class="[^"]*\bbrand\b[^"]*"[^>]*href="\/"/, "brand link is not a plain anchor to /");

    const home = await get("/");
    assert.equal(home.status, 200);
    assert.match(home.headers.get("content-type") || "", /text\/html/);
    assert.doesNotMatch(home.headers.get("content-disposition") || "", /attachment/i);
  });
});
