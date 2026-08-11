// Feature test: renders real fixture data through the actual DOM-rendering
// code in scripts/app.js (the same code index.html loads), using jsdom
// instead of a real browser. Catches rendering bugs that schema-only
// regression tests can't (e.g. wrong element counts, unescaped HTML).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

import { renderNews, buildNav, esc, formatDateLabel } from "../scripts/app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const fixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "history", name), "utf8"));

let dom;

before(() => {
  dom = new JSDOM(html, { url: "http://localhost/" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
});

after(() => {
  delete globalThis.window;
  delete globalThis.document;
});

describe("renderNews against a real historical digest", () => {
  test("renders all 6 category sections and a card per article", () => {
    const data = fixture("2026-08-08.json");
    renderNews(data);
    assert.equal(document.querySelectorAll(".category-section").length, 6);
    assert.equal(document.querySelectorAll(".news-card").length, 30); // 6 categories x 5 articles
  });

  test("shows the digest's display date", () => {
    const data = fixture("2026-08-08.json");
    renderNews(data);
    assert.equal(document.getElementById("last-updated").textContent, `📅 ${data.displayDate}`);
  });

  test("escapes untrusted title text instead of injecting raw HTML", () => {
    const data = fixture("2026-08-08.json");
    data.categories.us.articles[0].title = "<img src=x onerror=alert(1)>";
    renderNews(data);
    assert.equal(document.querySelectorAll("main img[onerror]").length, 0);
    assert.match(document.querySelector("main").innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
  });

  test("shows an empty state when a date has no categories", () => {
    renderNews({ date: "2026-01-01", displayDate: "x", categories: {} });
    assert.match(document.getElementById("main").textContent, /No news data available/);
    assert.equal(document.querySelectorAll(".news-card").length, 0);
  });
});

describe("buildNav", () => {
  test("adds one nav button per present category plus 'All'", () => {
    const data = fixture("2026-08-08.json");
    buildNav(data.categories);
    assert.equal(document.querySelectorAll("#category-nav .cat-btn").length, 7); // All + 6
  });
});

describe("esc", () => {
  test("escapes HTML special characters", () => {
    assert.equal(esc(`<b>"quoted" & tag</b>`), "&lt;b&gt;&quot;quoted&quot; &amp; tag&lt;/b&gt;");
  });

  test("returns an empty string for falsy input", () => {
    assert.equal(esc(undefined), "");
    assert.equal(esc(""), "");
  });
});

describe("formatDateLabel", () => {
  test("prefixes the latest date with 'Today'", () => {
    assert.match(formatDateLabel("2026-08-08", true), /^Today · /);
  });

  test("does not prefix older dates", () => {
    assert.doesNotMatch(formatDateLabel("2026-08-05", false), /Today/);
  });
});
