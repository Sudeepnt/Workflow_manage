#!/usr/bin/env node

const catalog = require("../data/sangeetha-store-catalog.json").stores;

const group = process.argv[2];
const offset = Number(process.argv[3] || 0);
const limit = Number(process.argv[4] || 100);

if (!new Set(["google", "official"]).has(group)) {
  throw new Error("Usage: generate-sangeetha-upsert-sql.js <google|official> [offset] [limit]");
}

const columns = [
  "google_place_id", "official_store_id", "name", "latitude", "longitude",
  "address", "google_maps_uri", "store_code", "phone", "hours", "city", "state",
  "verification_status", "locator_name", "locator_address", "locator_latitude",
  "locator_longitude",
];

function quote(value) {
  if (value === null || value === undefined || value === "") return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  return `'${String(value).replaceAll("'", "''")}'`;
}

const selected = catalog
  .filter((store) => group === "google" ? store.google_place_id : !store.google_place_id)
  .slice(offset, offset + limit);

if (!selected.length) process.exit(0);

const values = selected.map((store) => (
  `(${columns.map((column) => quote(store[column])).join(", ")})`
));
const conflictColumn = group === "google" ? "google_place_id" : "official_store_id";
const conflictPredicate = group === "official" ? " where official_store_id is not null" : "";
const updates = columns
  .filter((column) => column !== conflictColumn)
  .map((column) => `${column} = excluded.${column}`)
  .join(", ");

process.stdout.write(`
insert into public.sangeetha_stores (${columns.join(", ")})
values
${values.join(",\n")}
on conflict (${conflictColumn})${conflictPredicate} do update set ${updates};
`);
