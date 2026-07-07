# ajinx-daily-news

A daily news digest — US, Global, India, Stocks, Business, and Tech — served as a static site via GitHub Pages.

## How it stays up to date

A scheduled GitHub Action (`.github/workflows/daily-news.yml`) runs automatically every day at **9:00 AM US Eastern time**:

1. It calls the OpenAI API (`gpt-5.5`, reasoning effort `medium`) with the built-in web search tool to find and summarize the top 5 real news stories in each category.
2. It writes the result to `data/latest.json` and archives it to `data/history/<YYYY-MM-DD>.json`.
3. It updates `data/index.json`, the manifest the page reads to build the history dropdown, keeping only the 5 most recent days (older history files are pruned automatically).
4. It commits and pushes the updated `data/` files straight to `main` — no manual step required.

You can also trigger a refresh manually from the **Actions** tab → "Daily news refresh" → **Run workflow**.

### One-time setup required

The workflow needs an `OPENAI_API_KEY` repository secret so it can call the OpenAI API:

1. Go to the repo on GitHub → **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret**.
3. Name: `OPENAI_API_KEY`. Value: your OpenAI API key.

Without it, the scheduled runs will fail at the "Fetch today's news" step.

## How the page works

`index.html` is a static shell with no embedded news data. On load it:

- Fetches `data/index.json` to find the available dates (most recent first).
- Renders the most recent date by default and shows a **date dropdown** in the header so you can browse up to the last 5 days of news, each stored as its own JSON file under `data/history/`.
- If today's automated refresh hasn't run yet, a banner notes that the shown feed is from a previous day.

## Local development

```bash
npm install
npm run fetch-news:mock   # writes fixture data to data/ without calling the API
npx serve .                # or: python3 -m http.server
```

To run a real fetch locally, set `OPENAI_API_KEY` in your environment and run `npm run fetch-news`.
