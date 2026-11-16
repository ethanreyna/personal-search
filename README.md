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
   committed. The Worker reads it at runtime from the `CRITERIA_JSON`
   secret (upload it with `pnpm run criteria:upload`, and re-run that
   whenever you edit the file). For local dev, add it to `.dev.vars` as a
   single line: `CRITERIA_JSON='{"titles":[...],...}'`. Without it, the
   example criteria are used.
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
   pnpm exec wrangler secret put APIFY_TOKEN        # on-demand keyword search
   pnpm exec wrangler secret put HUNTER_API_KEY     # contact lookup
   pnpm exec wrangler secret put ANTHROPIC_API_KEY  # message drafts
   pnpm exec wrangler secret put ADZUNA_APP_ID
   pnpm exec wrangler secret put ADZUNA_APP_KEY
   pnpm exec wrangler secret put RAPIDAPI_KEY
   ```
   For local dev, put the same keys in `.dev.vars` (gitignored).
6. Run locally or deploy:
   ```
   pnpm run dev
   pnpm run deploy
   ```
   `deploy` builds the dashboard, applies any pending D1 migrations, then
   deploys the Worker.

## Automatic deploys

The Worker is connected to this repo with Cloudflare Workers Builds, so
every push to `main` deploys (Worker → Settings → Build):

- Build command: *(empty)*
- Deploy command: `pnpm run deploy`
- The build's API token needs **D1: Edit** in addition to the defaults,
  since the deploy applies migrations.

Runtime secrets (`CRITERIA_JSON`, API keys) live on the Worker and are not
part of the build.

## On-demand search and outreach

The dashboard's search panel runs one keyword search across every
configured source in parallel: a hosted Apify actor (set `APIFY_ACTOR` to
override the default), Adzuna and JSearch when their keys are set, and the
free feeds. Keywords, location, "posted within" and "remote only" go to each
source; sources without a search API are matched on keywords locally. The
applicant cap, experience cap and title/description word lists filter what's
shown, so they can be changed without re-fetching. Results can be sorted by
match, date, applicants, experience asked, salary or company.

Each listing gets a match % against the criteria file: title fit (30),
skill coverage of the technologies the listing names (40), experience asked
versus `targetYearsExperience` (20) and location (10). The card lists which
named skills are covered and which are missing. Scores are recomputed
automatically after the criteria change.

Listings that include the poster's profile get a "Find email" button
(Hunter email-finder; a credit is only spent when an address is found,
and the confidence score is shown next to it). "Draft email" writes a
short message from the `outreach` section of `worker/criteria.json`; the
draft is editable and saved per listing. Nothing is ever sent
automatically.

"Tailored PDF" rewrites the profile document in `worker/document.json`
(private, gitignored; copy `worker/document.example.json` to start) to
emphasize what a listing asks for, using only facts already in the file.
Names, contact details, titles and dates are copied as-is. The PDF is laid out
in the browser and downloaded with the `fileName` from that file. Upload it
with `pnpm run document:upload` (secrets are capped at about 5 kB, so keep
it concise); `criteria:upload` works the same way for the criteria file.

Schema changes live in `worker/migrations/` and are applied with
`pnpm run db:migrate:local` / `pnpm run db:migrate:remote`.

The scheduled sync runs on the cron in `wrangler.toml` (every 4 hours by
default). You can also trigger a sync manually from the dashboard, or by
POSTing to `/api/sync`.
