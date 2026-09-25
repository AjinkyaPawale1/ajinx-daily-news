import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CAT_ORDER,
  nyDateParts,
  buildPrompt,
  newsSchema,
  mockNewsData,
  validateNewsData,
  readManifest,
  persistNewsData,
} from "../scripts/fetch-news.mjs";

describe("nyDateParts", () => {
  test("formats a known date as ISO + display strings in ET", () => {
    // 2026-07-07 12:00 UTC is still July 7th in US/Eastern.
    const { iso, display } = nyDateParts(new Date("2026-07-07T12:00:00Z"));
    assert.equal(iso, "2026-07-07");
    assert.equal(display, "Tuesday, July 7, 2026");
  });
});

describe("newsSchema", () => {
  test("requires all 6 categories and forbids extra top-level properties", () => {
    const schema = newsSchema();
    assert.deepEqual(schema.properties.categories.required, CAT_ORDER);
    assert.equal(schema.properties.categories.additionalProperties, false);
    assert.deepEqual(schema.required, ["date", "displayDate", "categories"]);
  });
});

describe("buildPrompt", () => {
  const prompt = buildPrompt({ iso: "2026-07-07", display: "Tuesday, July 7, 2026" });

  test("embeds the target date", () => {
    assert.match(prompt, /2026-07-07/);
    assert.match(prompt, /Tuesday, July 7, 2026/);
  });

  test("lists all 6 categories", () => {
    for (const key of CAT_ORDER) {
      assert.match(prompt, new RegExp(`"${key}"`));
    }
  });

  test("bounds web search usage per category (cost-control regression guard)", () => {
    assert.match(prompt, /at most 1-2 web searches per category/);
  });

  test("still forbids fabricated sources/URLs", () => {
    assert.match(prompt, /Do not fabricate articles, sources, or URLs/);
  });
});

describe("mockNewsData / validateNewsData", () => {
  test("mock data passes validation", () => {
    assert.doesNotThrow(() => validateNewsData(mockNewsData()));
  });

  test("rejects data missing a category", () => {
    const data = mockNewsData();
    delete data.categories.tech;
    assert.throws(() => validateNewsData(data), /missing category: tech/);
  });

  test("rejects an article missing a title", () => {
    const data = mockNewsData();
    delete data.categories.us.articles[0].title;
    assert.throws(() => validateNewsData(data), /us\[0\] missing title/);
  });

  test("rejects an invalid date format", () => {
    const data = mockNewsData();
    data.date = "07/07/2026";
    assert.throws(() => validateNewsData(data), /invalid date/);
  });
});

describe("readManifest", () => {
  test("returns an empty dates list when the file doesn't exist", () => {
    const manifest = readManifest("/nonexistent/index.json");
    assert.deepEqual(manifest, { dates: [] });
  });
});

describe("persistNewsData", () => {
  function withTempDir(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajinx-news-test-"));
    try {
      return fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  test("writes today's history file and updates latest.json + index.json", () => {
    withTempDir((dir) => {
      const historyDir = path.join(dir, "history");
      const latestPath = path.join(dir, "latest.json");
      const indexPath = path.join(dir, "index.json");
      const data = mockNewsData();

      const { historyPath, dates } = persistNewsData(data, { historyDir, latestPath, indexPath });

      assert.equal(historyPath, path.join(historyDir, `${data.date}.json`));
      assert.ok(fs.existsSync(historyPath));
      assert.ok(fs.existsSync(latestPath));
      assert.deepEqual(dates, [data.date]);
      assert.deepEqual(JSON.parse(fs.readFileSync(indexPath, "utf8")), { dates: [data.date] });
    });
  });

  test("prunes history files beyond maxHistoryItems, keeping the newest", () => {
    withTempDir((dir) => {
      const historyDir = path.join(dir, "history");
      const latestPath = path.join(dir, "latest.json");
      const indexPath = path.join(dir, "index.json");
      fs.mkdirSync(historyDir, { recursive: true });

      const oldDates = ["2026-01-01", "2026-01-02", "2026-01-03"];
      fs.writeFileSync(indexPath, JSON.stringify({ dates: oldDates }));
      for (const d of oldDates) {
        fs.writeFileSync(path.join(historyDir, `${d}.json`), "{}");
      }

      const data = mockNewsData();
      data.date = "2026-01-04";
      const { dates } = persistNewsData(data, { historyDir, latestPath, indexPath, maxHistoryItems: 2 });

      assert.deepEqual(dates, ["2026-01-04", "2026-01-03"]);
      const remaining = fs.readdirSync(historyDir).sort();
      assert.deepEqual(remaining, ["2026-01-03.json", "2026-01-04.json"]);
    });
  });
});
