const { getRequiredEnv } = require("./env");
const seedData = require("../../data/sangeetha-store-seeds.json");

const GOOGLE_PLACES_URL = "https://places.googleapis.com/v1/places";
const GOOGLE_FIELD_MASK = [
  "id",
  "displayName",
  "location",
  "formattedAddress",
  "businessStatus",
  "googleMapsUri",
].join(",");
const MAX_BATCH_SIZE = 25;
const REQUEST_CONCURRENCY = 8;

function normalizePlace(place = {}) {
  return {
    google_place_id: String(place.id ?? "").trim(),
    name: String(place.displayName?.text ?? "").trim(),
    latitude: Number(place.location?.latitude),
    longitude: Number(place.location?.longitude),
    address: String(place.formattedAddress ?? "").trim(),
    business_status: String(place.businessStatus ?? "").trim() || null,
    google_maps_uri: String(place.googleMapsUri ?? "").trim() || null,
  };
}

function isValidStore(store) {
  return Boolean(
    store.google_place_id
      && store.name
      && Number.isFinite(store.latitude)
      && Number.isFinite(store.longitude),
  );
}

async function fetchPlaceDetails(placeId) {
  const url = new URL(`${GOOGLE_PLACES_URL}/${encodeURIComponent(placeId)}`);
  url.searchParams.set("languageCode", "en");
  url.searchParams.set("regionCode", "IN");

  const response = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": getRequiredEnv("GOOGLE_PLACES_API_KEY"),
      "X-Goog-FieldMask": GOOGLE_FIELD_MASK,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(
      payload?.error?.message
      ?? payload?.message
      ?? `Google Places request failed with ${response.status}`,
    );
    const error = new Error(`${placeId}: ${message}`);
    error.status = response.status;
    throw error;
  }

  const store = normalizePlace(payload);
  if (!isValidStore(store)) {
    throw new Error(`${placeId}: Google Places returned incomplete store data`);
  }
  return store;
}

async function mapConcurrent(values, mapper, concurrency = REQUEST_CONCURRENCY) {
  const results = new Array(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

function getStoreSeedPlaceIds() {
  return seedData.stores.map((store) => store.google_place_id);
}

function getStoreSeedCount() {
  return seedData.stores.length;
}

async function fetchSangeethaStoresByIds(placeIds, batchSize = 20) {
  const safeBatchSize = Math.max(
    1,
    Math.min(MAX_BATCH_SIZE, Math.floor(Number(batchSize) || 20)),
  );
  return mapConcurrent(
    placeIds.slice(0, safeBatchSize),
    (placeId) => fetchPlaceDetails(placeId),
  );
}

module.exports = {
  fetchSangeethaStoresByIds,
  getStoreSeedCount,
  getStoreSeedPlaceIds,
};
