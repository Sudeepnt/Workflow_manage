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
- `SUPABASE_PUBLISHABLE_KEY` (optional public read override)
- `SUPABASE_SERVICE_ROLE_KEY`

Database setup:

- Run [supabase-sangeetha-stores.sql](./supabase-sangeetha-stores.sql) against the target Supabase project before using the page.

Flow:

- `npm run stores:discover` reads both official Sangeetha locators and builds a reconciled, deduplicated nationwide catalog.
- The checked-in catalog contains 918 retail locations: 753 matched across the Google-backed directory and ecommerce locator, 142 ecommerce-locator-only records, and 23 Google-directory-only records.
- `POST /api/sangeetha-stores/import` refreshes missing or older-than-30-days stores with Google Places API (New) Place Details in timeout-safe batches and upserts them into `sangeetha_stores`.
- `GET /api/sangeetha-stores` reads cached store rows from Supabase.
- `/sangeetha-map` loads Google Maps in the browser and renders markers from the cached Supabase data only.

The source API returned 930 records. Catalog generation excludes 21 warehouses/dark stores, eight exact duplicates, four internal/test entries, and two invalid coordinates, then unions the remaining records with the 776 unique Google Place IDs exposed by the official store directory.

`GOOGLE_PLACES_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are server-only. Never expose either value to browser code.
