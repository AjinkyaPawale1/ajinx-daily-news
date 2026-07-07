#!/usr/bin/env node
// Generates the day's news JSON via the OpenAI API (GPT-5.5 + web search +
// structured output), then writes/prunes the data/ directory that
// index.html reads from.
//
// Usage:
//   node scripts/fetch-news.mjs            # calls the real OpenAI API
//   node scripts/fetch-news.mjs --mock     # skips the API call, uses fixture data
//                                           # (for local testing / CI dry-runs)
//
// Requires the OPENAI_API_KEY environment variable to be set (picked up
// automatically by the OpenAI SDK) when not running with --mock.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const HISTORY_DIR = path.join(DATA_DIR, "history");
const LATEST_PATH = path.join(DATA_DIR, "latest.json");
const INDEX_PATH = path.join(DATA_DIR, "index.json");

const MODEL = "gpt-5.5";
const REASONING_EFFORT = "medium";
const MAX_HISTORY_ITEMS = 5;

const CAT_ORDER = ["us", "global", "india", "stocks", "business", "tech"];
const CAT_SPEC = {
  us:       { label: "US News",   icon: "🇺🇸", subtitle: "Top 5 domestic stories" },
  global:   { label: "Global",    icon: "🌍", subtitle: "Top 5 trending worldwide" },
  india:    { label: "India News",icon: "🇮🇳", subtitle: "Top 5 from India" },
  stocks:   { label: "US Stocks", icon: "📈", subtitle: "Top 5 market movers" },
  business: { label: "Business",  icon: "💼", subtitle: "Top 5 corporate stories" },
  tech:     { label: "Tech",      icon: "💡", subtitle: "Top 5 in technology" },
};

function nyDateParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const iso = fmt.format(now); // "2026-07-07" (en-CA gives YYYY-MM-DD)
  const displayFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
  return { iso, display: displayFmt.format(now) };
}

function articleSchema() {
  return {
    type: "object",
    properties: {
      emoji: { type: "string", description: "A single emoji representing the story" },
      title: { type: "string" },
      bullets: {
        type: "array",
        items: { type: "string" },
        description: "Exactly 3 short factual bullet points",
      },
      source: { type: "string", description: "Publication name(s), e.g. 'Reuters' or 'AP / CNBC'" },
      url: { type: "string", description: "A working URL to the source article" },
    },
    required: ["emoji", "title", "bullets", "source", "url"],
    additionalProperties: false,
  };
}

function categorySchema() {
  return {
    type: "object",
    properties: {
      label: { type: "string" },
      icon: { type: "string" },
      subtitle: { type: "string" },
      articles: {
        type: "array",
        items: articleSchema(),
        description: "Exactly 5 articles",
      },
    },
    required: ["label", "icon", "subtitle", "articles"],
    additionalProperties: false,
  };
}

function newsSchema() {
  const categories = {};
  for (const key of CAT_ORDER) categories[key] = categorySchema();
  return {
    type: "object",
    properties: {
      date: { type: "string", description: "ISO date YYYY-MM-DD" },
      displayDate: { type: "string", description: "Human readable date, e.g. 'Monday, July 7, 2026'" },
      categories: {
        type: "object",
        properties: categories,
        required: CAT_ORDER,
        additionalProperties: false,
      },
    },
    required: ["date", "displayDate", "categories"],
    additionalProperties: false,
  };
}

function buildPrompt({ iso, display }) {
  const categoryList = CAT_ORDER.map((k) => `- "${k}" (${CAT_SPEC[k].label}): ${CAT_SPEC[k].subtitle}`).join("\n");
  return `Today's date is ${display} (${iso}). Use web search to find real, current news and compile a daily news digest.

For EACH of these 6 categories, find exactly 5 distinct, real news stories from the last 1-2 days (prioritize the most recent and significant):
${categoryList}

For every story provide:
- emoji: one emoji that represents the story
- title: a concise, informative headline (not clickbait)
- bullets: exactly 3 short factual bullet points summarizing the story (no speculation)
- source: the real publication name(s) you found this from
- url: a real, working URL to the source article (never invent or guess a URL)

Only include stories you found via web search with real sources and real URLs. Do not fabricate articles, sources, or URLs. Prefer reputable outlets (Reuters, AP, BBC, NPR, CNBC, Bloomberg, major national papers, etc).

Set "date" to "${iso}" and "displayDate" to "${display}".`;
}

async function generateNewsData() {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI();
  const { iso, display } = nyDateParts();

  const response = await client.responses.create({
    model: MODEL,
    reasoning: { effort: REASONING_EFFORT },
    max_output_tokens: 16000,
    tools: [{ type: "web_search" }],
    text: {
      format: {
        type: "json_schema",
        name: "daily_news_digest",
        schema: newsSchema(),
        strict: true,
      },
    },
    input: buildPrompt({ iso, display }),
  });

  if (response.status === "failed") {
    throw new Error(`Request failed: ${JSON.stringify(response.error)}`);
  }
  if (response.status === "incomplete") {
    throw new Error(`Response incomplete: ${JSON.stringify(response.incomplete_details)}. Increase max_output_tokens.`);
  }

  const refusal = (response.output || [])
    .flatMap((item) => item.content || [])
    .find((c) => c.type === "refusal");
  if (refusal) {
    throw new Error(`Model refused the request: ${refusal.refusal}`);
  }

  const text = response.output_text;
  if (!text) {
    throw new Error(`No output text in response. status=${response.status}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`Failed to parse JSON from model output: ${err.message}\n---\n${text.slice(0, 2000)}`);
  }

  return data;
}

function mockNewsData() {
  const { iso, display } = nyDateParts();
  const data = { date: iso, displayDate: display, categories: {} };
  for (const key of CAT_ORDER) {
    data.categories[key] = {
      label: CAT_SPEC[key].label,
      icon: CAT_SPEC[key].icon,
      subtitle: CAT_SPEC[key].subtitle,
      articles: Array.from({ length: 5 }, (_, i) => ({
        emoji: "📰",
        title: `[MOCK] ${CAT_SPEC[key].label} headline ${i + 1} for ${iso}`,
        bullets: [
          "This is placeholder bullet one.",
          "This is placeholder bullet two.",
          "This is placeholder bullet three.",
        ],
        source: "Mock Source",
        url: "https://example.com/mock-article",
      })),
    };
  }
  return data;
}

function validateNewsData(data) {
  const errors = [];
  if (!data || typeof data !== "object") errors.push("data is not an object");
  if (!data.date || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) errors.push(`invalid date: ${data.date}`);
  if (!data.categories || typeof data.categories !== "object") errors.push("missing categories");

  for (const key of CAT_ORDER) {
    const cat = data.categories?.[key];
    if (!cat) {
      errors.push(`missing category: ${key}`);
      continue;
    }
    if (!Array.isArray(cat.articles) || cat.articles.length === 0) {
      errors.push(`category ${key} has no articles`);
      continue;
    }
    cat.articles.forEach((a, i) => {
      if (!a.title) errors.push(`${key}[${i}] missing title`);
      if (!Array.isArray(a.bullets) || a.bullets.length === 0) errors.push(`${key}[${i}] missing bullets`);
      if (!a.source) errors.push(`${key}[${i}] missing source`);
      if (!a.url) errors.push(`${key}[${i}] missing url`);
    });
  }

  if (errors.length > 0) {
    throw new Error(`News data failed validation:\n- ${errors.join("\n- ")}`);
  }
}

function readManifest() {
  if (!fs.existsSync(INDEX_PATH)) return { dates: [] };
  try {
    return JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
  } catch {
    return { dates: [] };
  }
}

function persistNewsData(data) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });

  const json = JSON.stringify(data, null, 2) + "\n";
  const historyPath = path.join(HISTORY_DIR, `${data.date}.json`);
  fs.writeFileSync(historyPath, json);
  fs.writeFileSync(LATEST_PATH, json);

  const manifest = readManifest();
  const dates = Array.from(new Set([data.date, ...(manifest.dates || [])]))
    .sort()
    .reverse()
    .slice(0, MAX_HISTORY_ITEMS);

  fs.writeFileSync(INDEX_PATH, JSON.stringify({ dates }, null, 2) + "\n");

  // Prune history files that fell out of the retention window.
  const keep = new Set(dates);
  for (const file of fs.readdirSync(HISTORY_DIR)) {
    const match = file.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (match && !keep.has(match[1])) {
      fs.unlinkSync(path.join(HISTORY_DIR, file));
      console.log(`Pruned old history file: ${file}`);
    }
  }

  return { historyPath, dates };
}

async function main() {
  const isMock = process.argv.includes("--mock");

  console.log(isMock ? "Running in --mock mode (no API call)." : `Calling OpenAI API (${MODEL}, reasoning effort: ${REASONING_EFFORT}) with web search...`);
  const data = isMock ? mockNewsData() : await generateNewsData();

  validateNewsData(data);

  const { historyPath, dates } = persistNewsData(data);

  console.log(`Wrote ${historyPath}`);
  console.log(`Updated ${LATEST_PATH}`);
  console.log(`Manifest now tracks ${dates.length} date(s): ${dates.join(", ")}`);
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
