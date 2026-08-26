# personal-search

A small personal aggregation tool. Runs on Cloudflare Workers: a scheduled
job periodically pulls structured listings from a handful of public APIs,
normalizes and dedupes them into a database, scores each one against a
local criteria file, and serves a lightweight dashboard to browse, filter,
and triage the results.

## Stack

- Cloudflare Workers + [Hono](https://hono.dev) for the API
- Cloudflare D1 (SQLite) for storage
- Cron Trigger for the periodic sync
- React + Vite for the dashboard, served as static assets from the same Worker
- pnpm workspaces (root + `client`)
- Basic auth in front of every route (this isn't meant to be public)

## Layout

```
worker/src/         API + scheduled sync (Hono)
worker/src/sources/  one module per data source
worker/migrations/   D1 schema
worker/criteria.json Private, gitignored — your actual target criteria.
                      Copy worker/criteria.example.json to start one.
client/              React/Vite dashboard
```

## Setup

1. Install [pnpm](https://pnpm.io/installation) if you don't have it
   (`corepack enable` works too, since `packageManager` is pinned in
   `package.json`). Then install dependencies for both packages at once:
   ```
   pnpm install
   ```
2. Copy `worker/criteria.example.json` to `worker/criteria.json` and fill
   in your own titles/skills/locations. This file is gitignored and never
   committed.
3. Log in and create the D1 database:
   ```
   pnpm exec wrangler login
   pnpm exec wrangler d1 create personal-search-db
   ```
   Paste the returned `database_id` into `wrangler.toml`.
4. Apply the schema:
   ```
   pnpm run db:migrate:remote
   ```
5. Set secrets (only add the ones for sources you want to use — sources
   without a key are simply skipped):
   ```
   pnpm exec wrangler secret put ACCESS_PASSWORD
   pnpm exec wrangler secret put ADZUNA_APP_ID
   pnpm exec wrangler secret put ADZUNA_APP_KEY
   pnpm exec wrangler secret put RAPIDAPI_KEY
   ```
6. Run locally or deploy:
   ```
   pnpm run dev
   pnpm run deploy
   ```

The scheduled sync runs on the cron in `wrangler.toml` (every 4 hours by
default). You can also trigger a sync manually from the dashboard, or by
POSTing to `/api/sync`.
