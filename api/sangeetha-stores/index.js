const {
  getSupabaseAdminClient,
  getSupabaseReadClient,
} = require("../_lib/supabase");
const { allowMethods, readJsonBody, sendJson } = require("../_lib/http");
const catalogData = require("../../data/sangeetha-store-catalog.json");

const STALE_DAYS = 30;
const STALE_MS = STALE_DAYS * 24 * 60 * 60 * 1000;
const STORE_COLUMNS = [
  "id",
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
  "google_synced_at",
  "created_at",
  "updated_at",
].join(", ");

function getLatestSyncAt(rows) {
  return rows.reduce((latest, row) => {
    const current = Date.parse(row.google_synced_at ?? "");
    if (!Number.isFinite(current)) return latest;
    return !latest || current > latest ? current : latest;
  }, 0);
}

function buildGoogleMapsUri(latitude, longitude) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

function normalizeText(value, fieldName, { required = false } = {}) {
  const text = String(value ?? "").trim();
  if (required && !text) {
    throw new Error(`${fieldName} is required.`);
  }
  return text || null;
}

function normalizeCoordinate(value, fieldName, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${fieldName} is invalid.`);
  }
  return number;
}

function normalizeSqft(value) {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === "") return null;
  const digits = String(value).replace(/[^\d]/g, "");
  if (!digits) {
    throw new Error("Store sqft must be a whole number.");
  }
  const sqft = Number.parseInt(digits, 10);
  if (!Number.isFinite(sqft) || sqft < 0) {
    throw new Error("Store sqft must be a whole number.");
  }
  return sqft;
}

function getCatalogFallbackRows() {
  return catalogData.stores.map((store, index) => ({
    id: index + 1,
    store_number: index + 1,
    google_place_id: store.google_place_id,
    official_store_id: store.official_store_id,
    data_source: "catalog",
    name: store.name,
    latitude: store.latitude,
    longitude: store.longitude,
    address: store.address,
    business_status: null,
    google_maps_uri: store.google_maps_uri,
    store_code: store.store_code,
    phone: store.phone,
    hours: store.hours,
    city: store.city,
    state: store.state,
    verification_status: store.verification_status,
    store_sqft: null,
    google_synced_at: null,
    created_at: null,
    updated_at: null,
  }));
}

function sendStoreList(res, rows, { fallback = false } = {}) {
  const now = Date.now();
  const staleCount = rows.filter((row) => {
    if (!row.google_place_id) return false;
    const syncedAt = Date.parse(row.google_synced_at ?? "");
    return !Number.isFinite(syncedAt) || (now - syncedAt) > STALE_MS;
  }).length;
  const locatorOnlyCount = rows.filter((row) => !row.google_place_id).length;
  const latestSyncAt = getLatestSyncAt(rows);

  sendJson(res, 200, {
    stores: rows,
    meta: {
      count: rows.length,
      staleCount,
      staleAfterDays: STALE_DAYS,
      locatorOnlyCount,
      latestSyncAt: latestSyncAt ? new Date(latestSyncAt).toISOString() : null,
      fallback,
    },
  });
}

async function listStores(res) {
  const supabase = getSupabaseReadClient();
  const { data, error } = await supabase
    .from("sangeetha_stores")
    .select(STORE_COLUMNS)
    .order("store_number", { ascending: true });

  if (error?.code === "PGRST205") {
    sendStoreList(res, getCatalogFallbackRows(), { fallback: true });
    return;
  }
  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  sendStoreList(res, rows);
}

async function createManualStore(req, res) {
  const body = await readJsonBody(req);
  const supabase = getSupabaseAdminClient();
  const restoringCatalogStore = body.dataSource === "catalog";
  const storeNumber = body.storeNumber === undefined || body.storeNumber === null || body.storeNumber === ""
    ? undefined
    : Number.parseInt(String(body.storeNumber), 10);
  const officialStoreId = body.officialStoreId === undefined || body.officialStoreId === null || body.officialStoreId === ""
    ? undefined
    : Number.parseInt(String(body.officialStoreId), 10);
  if (restoringCatalogStore && (!Number.isFinite(storeNumber) || storeNumber <= 0)) {
    throw new Error("Store number is required when restoring a catalog store.");
  }
  if (restoringCatalogStore && (!Number.isFinite(officialStoreId) || officialStoreId <= 0)) {
    throw new Error("Official store id is required when restoring a catalog store.");
  }
  const payload = {
    data_source: restoringCatalogStore ? "catalog" : "manual",
    verification_status: restoringCatalogStore
      ? normalizeText(body.verificationStatus, "Verification status") || "google_verified"
      : "manual",
    name: normalizeText(body.name, "Store name", { required: true }),
    latitude: normalizeCoordinate(body.latitude, "Latitude", -90, 90),
    longitude: normalizeCoordinate(body.longitude, "Longitude", -180, 180),
    address: normalizeText(body.address, "Address"),
    city: normalizeText(body.city, "City"),
    state: normalizeText(body.state, "State"),
    phone: normalizeText(body.phone, "Phone"),
    hours: normalizeText(body.hours, "Hours"),
    store_sqft: normalizeSqft(body.storeSqft),
  };
  if (restoringCatalogStore) {
    payload.store_number = storeNumber;
    payload.official_store_id = officialStoreId;
    payload.google_place_id = normalizeText(body.googlePlaceId, "Google place id");
    payload.store_code = normalizeText(body.storeCode, "Store code");
    payload.business_status = normalizeText(body.businessStatus, "Business status");
    payload.google_maps_uri = normalizeText(body.googleMapsUri, "Google Maps URI")
      || buildGoogleMapsUri(payload.latitude, payload.longitude);
  } else {
    payload.google_maps_uri = buildGoogleMapsUri(payload.latitude, payload.longitude);
  }

  const { data, error } = await supabase
    .from("sangeetha_stores")
    .insert(payload)
    .select(STORE_COLUMNS)
    .single();

  if (error) throw error;

  sendJson(res, 201, {
    store: data,
  });
}

async function updateStore(req, res) {
  const body = await readJsonBody(req);
  const storeId = Number.parseInt(String(body.id ?? ""), 10);
  if (!Number.isFinite(storeId) || storeId <= 0) {
    throw new Error("Store id is required.");
  }

  const updates = {};
  if (body.name !== undefined) updates.name = normalizeText(body.name, "Store name", { required: true });
  if (body.address !== undefined) updates.address = normalizeText(body.address, "Address");
  if (body.city !== undefined) updates.city = normalizeText(body.city, "City");
  if (body.state !== undefined) updates.state = normalizeText(body.state, "State");
  if (body.phone !== undefined) updates.phone = normalizeText(body.phone, "Phone");
  if (body.hours !== undefined) updates.hours = normalizeText(body.hours, "Hours");
  if (body.latitude !== undefined) updates.latitude = normalizeCoordinate(body.latitude, "Latitude", -90, 90);
  if (body.longitude !== undefined) updates.longitude = normalizeCoordinate(body.longitude, "Longitude", -180, 180);
  if (body.googleMapsUri !== undefined) {
    updates.google_maps_uri = normalizeText(body.googleMapsUri, "Google Maps URI");
  } else if (body.latitude !== undefined && body.longitude !== undefined) {
    updates.google_maps_uri = buildGoogleMapsUri(updates.latitude, updates.longitude);
  }
  const normalizedSqft = normalizeSqft(body.storeSqft);
  if (normalizedSqft !== undefined) {
    updates.store_sqft = normalizedSqft;
  }
  if (!Object.keys(updates).length) {
    throw new Error("No updatable fields were provided.");
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("sangeetha_stores")
    .update(updates)
    .eq("id", storeId)
    .select(STORE_COLUMNS)
    .single();

  if (error) throw error;

  sendJson(res, 200, {
    store: data,
  });
}

async function deleteStore(req, res) {
  const body = await readJsonBody(req);
  const storeId = Number.parseInt(String(body.id ?? ""), 10);
  if (!Number.isFinite(storeId) || storeId <= 0) {
    throw new Error("Store id is required.");
  }

  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("sangeetha_stores")
    .delete()
    .eq("id", storeId);

  if (error) throw error;

  sendJson(res, 200, {
    deletedStoreId: storeId,
  });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      await listStores(res);
      return;
    }
    if (req.method === "POST") {
      await createManualStore(req, res);
      return;
    }
    if (req.method === "PATCH") {
      await updateStore(req, res);
      return;
    }
    if (req.method === "DELETE") {
      await deleteStore(req, res);
      return;
    }

    allowMethods(res, ["GET", "POST", "PATCH", "DELETE"]);
    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "Failed to handle stores",
    });
  }
};
