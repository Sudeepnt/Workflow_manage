#!/usr/bin/env node

const { createClient } = require("@supabase/supabase-js");

const SOURCE_API_URL = process.env.SANGEETHA_SOURCE_API_URL
  || "https://atit-workflow.vercel.app/api/sangeetha-stores";
const TARGET_URL = String(process.env.SUPABASE_URL ?? "").trim();
const TARGET_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
const BATCH_SIZE = 100;
const STORE_COLUMNS = [
  "store_number",
  "google_place_id",
  "official_store_id",
  "data_source",
  "name",
  "latitude",
  "longitude",
  "address",
  "business_status",
  "google_maps_uri",
  "store_code",
  "phone",
  "hours",
  "city",
  "state",
  "verification_status",
  "store_sqft",
  "locator_name",
  "locator_address",
  "locator_latitude",
  "locator_longitude",
  "google_synced_at",
  "created_at",
  "updated_at",
];

function requireValue(value, name) {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function getNaturalKey(store) {
  if (store.google_place_id) return `google:${store.google_place_id}`;
  if (store.official_store_id) return `official:${store.official_store_id}`;
  return `manual:${store.name}:${store.latitude}:${store.longitude}`;
}

function toTargetRow(store) {
  return Object.fromEntries(
    STORE_COLUMNS
      .filter((column) => store[column] !== undefined)
      .map((column) => [column, store[column]]),
  );
}

async function fetchSourceStores() {
  const response = await fetch(SOURCE_API_URL);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Source request failed with ${response.status}.`);
  }
  if (!Array.isArray(payload.stores)) {
    throw new Error("Source response did not contain a stores array.");
  }
  return payload.stores;
}

async function insertRows(supabase, rows) {
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const chunk = rows.slice(offset, offset + BATCH_SIZE);
    const { error } = await supabase.from("sangeetha_stores").insert(chunk);
    if (error) throw error;
    inserted += chunk.length;
    console.log(`Inserted ${inserted}/${rows.length}`);
  }
  return inserted;
}

async function updateRows(supabase, rows, existingByKey) {
  let updated = 0;
  for (const row of rows) {
    const existing = existingByKey.get(getNaturalKey(row));
    if (!existing) continue;

    const { error } = await supabase
      .from("sangeetha_stores")
      .update(Object.fromEntries(Object.entries(row).filter(([key]) => key !== "store_number")))
      .eq("id", existing.id);
    if (error) throw error;
    updated += 1;
  }
  return updated;
}

async function main() {
  requireValue(TARGET_URL, "SUPABASE_URL");
  requireValue(TARGET_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY");

  const sourceStores = await fetchSourceStores();
  const rows = sourceStores.map(toTargetRow);
  const supabase = createClient(TARGET_URL, TARGET_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existingRows, error: existingError } = await supabase
    .from("sangeetha_stores")
    .select("id, store_number, google_place_id, official_store_id, name, latitude, longitude");
  if (existingError) throw existingError;

  const existingByKey = new Map((existingRows ?? []).map((row) => [getNaturalKey(row), row]));
  const rowsToInsert = rows.filter((row) => !existingByKey.has(getNaturalKey(row)));

  console.log(`Source rows: ${rows.length}`);
  console.log(`Target rows before migration: ${(existingRows ?? []).length}`);
  const inserted = await insertRows(supabase, rowsToInsert);
  const updated = await updateRows(supabase, rows, existingByKey);

  const { error: sequenceError } = await supabase.rpc("sync_sangeetha_store_number_sequence");
  if (sequenceError) throw sequenceError;

  const { count, error: countError } = await supabase
    .from("sangeetha_stores")
    .select("id", { count: "exact", head: true });
  if (countError) throw countError;

  console.log(`Migration complete: ${inserted} inserted, ${updated} updated, ${count} total.`);
}

main().catch((error) => {
  console.error(`Migration failed: ${error.message}`);
  process.exitCode = 1;
});
