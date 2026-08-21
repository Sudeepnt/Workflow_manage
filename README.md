# ATIT Operating System MVP

Monochrome internal workflow shell for the ATIT client.

## What is included

- 8-table spine: ventures, people, projects, tasks, documents, assets, events, transactions
- Relationship search across the mock graph
- Founder / Partner / Employee dashboard views
- Project workspace and task workspace
- White / black UI only
- No backend connection yet

## Run locally

Install dependencies and start the local preview server:

```bash
npm install
npm run dev
```

The Sangeetha map is available at `http://localhost:8000/sangeetha-map/`.

## Sangeetha Store Map prototype

Route:

- `/sangeetha-map`

Required environment variables for Vercel:

- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
- `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` (optional, `DEMO_MAP_ID` works for prototype use)
- `GOOGLE_PLACES_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Database setup:

- Run [supabase-sangeetha-stores.sql](./supabase-sangeetha-stores.sql) against the target Supabase project before using the page.

Flow:

- `npm run stores:discover` reads the current official Sangeetha store sitemap and builds a deduplicated Google Place ID seed file.
- The checked-in seed currently contains 777 official store pages and 776 unique Google Place IDs across seven states/territories.
- `POST /api/sangeetha-stores/import` refreshes missing or older-than-30-days stores with Google Places API (New) Place Details in timeout-safe batches and upserts them into `sangeetha_stores`.
- `GET /api/sangeetha-stores` reads cached store rows from Supabase.
- `/sangeetha-map` loads Google Maps in the browser and renders markers from the cached Supabase data only.

The official directory currently includes 766 Sangeetha-branded locations and 10 Wham-branded locations from the same Sangeetha group locator. One pair of official Chitradurga pages shares a Google Place ID, so it becomes one map record.

`GOOGLE_PLACES_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are server-only. Never expose either value to browser code.
