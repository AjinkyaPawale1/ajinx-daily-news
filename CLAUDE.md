# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A daily news digest — US, Global, India, Stocks, Business, Tech — served as a static site via GitHub Pages. There is no backend and no build step: `index.html` is a static shell that fetches JSON files from `data/` at runtime. All content is generated once a day by a scheduled GitHub Action that calls the OpenAI API and commits the result straight to `main`.

## Commands

```bash
npm install
npm run fetch-news:mock   # writes fixture data to data/ without calling the API (safe for local dev/CI dry-runs)
npm run fetch-news        # calls the real OpenAI API — requires OPENAI_API_KEY in the environment
npm test                  # runs the node:test suite (unit + regression + feature) — no API key needed
npx serve .                # serve the static site locally (or: python3 -m http.server)
```

There is no lint or build step — the whole app is `index.html` + `scripts/app.js` + `scripts/fetch-news.mjs`. Tests use Node's built-in `node:test` runner (no test framework dependency); `jsdom` is a devDependency used only by the feature test.

## Architecture

**Two independent halves that only communicate through `data/*.json`:**

1. `scripts/fetch-news.mjs` — a Node script (run only by CI or manually) that calls the OpenAI Responses API (`gpt-5.5`, reasoning effort `low`, `web_search` tool, strict `json_schema` structured output) to generate the day's digest, validates it, and writes it to disk. The prompt bounds the model to ~1-2 searches per category (cost control) and logs token usage (`response.usage`) after every real call.
2. `index.html` + `scripts/app.js` — a static, dependency-free page (vanilla JS, no framework, no bundler). `index.html` is markup/CSS plus a two-line module bootstrap (`import { init } from './scripts/app.js'; init();`); all rendering logic lives in `scripts/app.js`, which is loaded via `<script type="module">` and also imported directly by tests.

**Tests (`test/`):**
- `fetch-news.unit.test.mjs` — pure-function tests for `scripts/fetch-news.mjs` (date formatting, schema shape, prompt content, validation, manifest pruning). `persistNewsData`/`readManifest` accept optional path overrides specifically so tests can point at a temp dir instead of the real `data/`.
- `fetch-news.regression.test.mjs` — validates the frozen fixtures in `test/fixtures/history/` (real historical digests, snapshotted so they survive `data/history/`'s automatic pruning) against `validateNewsData()`. Fixtures are a *shape* contract, not expected output — the real API always generates for "today," so historical days can't be regenerated for a byte-diff.
- `app.feature.test.mjs` — loads `index.html` into `jsdom` and calls `scripts/app.js`'s exported `renderNews()`/`buildNav()` against fixture data to check actual DOM output (card counts, escaping, empty state).
- There's intentionally no automated test that calls the real OpenAI API — it's non-deterministic, costs money, and reasoning-effort/prompt changes should be validated by running `npm run fetch-news` manually and checking the logged token usage plus eyeballing output quality.

**Data flow / on-disk contract:**
- `data/latest.json` — always the most recent day's digest (same shape as a history file).
- `data/history/<YYYY-MM-DD>.json` — one immutable snapshot per day, matching the schema built by `newsSchema()` in `fetch-news.mjs` (`date`, `displayDate`, `categories.{us,global,india,stocks,business,tech}`, each with `label`/`icon`/`subtitle`/`articles[5]`, each article having `emoji`/`title`/`bullets[3]`/`source`/`url`).
- `data/index.json` — manifest of `{ dates: [...] }`, newest first, capped at `MAX_HISTORY_ITEMS` (5). This is what `index.html` reads first to populate the date dropdown; older history files that fall outside this window are pruned automatically by `persistNewsData()` in `fetch-news.mjs`.
- Category keys/order are defined in **two places that must stay in sync**: `CAT_ORDER`/`CAT_SPEC` in `scripts/fetch-news.mjs` and `CAT_ORDER`/`CAT_META`/`CAT_LABELS` in `scripts/app.js`.

**Automation** (`.github/workflows/daily-news.yml`):
- Triggered on two cron schedules (13:00 and 14:00 UTC) to approximate 9:00 AM US/Eastern across DST changes; a "Check it's 9am ET" gate step compares the actual ET hour and skips the run if it doesn't land on 09. `workflow_dispatch` bypasses this gate for manual runs.
- Runs `npm run fetch-news`, then commits/pushes any changes under `data/` directly to `main` as `github-actions[bot]` with message `Daily news refresh — <YYYY-MM-DD>`.
- Requires the `OPENAI_API_KEY` repo secret; without it the "Fetch today's news" step fails.

**Frontend behavior notes (`scripts/app.js`):**
- `init()` fetches `data/index.json`, populates the history `<select>`, then loads the newest date via `data/history/<date>.json`.
- If the newest available date isn't today (ET), a stale-data banner is shown — the automated refresh just hasn't run yet.
- Category filtering ("All" vs a single category) is done client-side by toggling `.visible` on pre-rendered `<section>` elements — no re-fetching.
- Card thumbnails are inline data-URI SVGs generated per category theme color (`cardSvg()`), not external images.
- All user-facing/model-provided text is escaped via `esc()` before being inserted into the DOM.
