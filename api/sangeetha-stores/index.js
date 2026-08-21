const {
  getSupabaseAdminClient,
  getSupabaseReadClient,
} = require("../_lib/supabase");
const { allowMethods, readJsonBody, sendJson } = require("../_lib/http");

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

async function listStores(res) {
  const supabase = getSupabaseReadClient();
  const { data, error } = await supabase
    .from("sangeetha_stores")
    .select(STORE_COLUMNS)
    .order("store_number", { ascending: true });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
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
    },
  });
}

async function createManualStore(req, res) {
  const body = await readJsonBody(req);
  const supabase = getSupabaseAdminClient();
  const payload = {
    data_source: "manual",
    verification_status: "manual",
    name: normalizeText(body.name, "Store name", { required: true }),
    latitude: normalizeCoordinate(body.latitude, "Latitude", -90, 90),
    longitude: normalizeCoordinate(body.longitude, "Longitude", -180, 180),
    address: normalizeText(body.address, "Address"),
    city: normalizeText(body.city, "City"),
    state: normalizeText(body.state, "State"),
    store_sqft: normalizeSqft(body.storeSqft),
  };
  payload.google_maps_uri = buildGoogleMapsUri(payload.latitude, payload.longitude);

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

async function deleteManualStore(req, res) {
  const body = await readJsonBody(req);
  const storeId = Number.parseInt(String(body.id ?? ""), 10);
  if (!Number.isFinite(storeId) || storeId <= 0) {
    throw new Error("Store id is required.");
  }

  const supabase = getSupabaseAdminClient();
  const { data: store, error: readError } = await supabase
    .from("sangeetha_stores")
    .select("id, store_number, data_source")
    .eq("id", storeId)
    .single();

  if (readError) throw readError;
  if (store?.data_source !== "manual") {
    sendJson(res, 403, {
      error: "Only manually added stores can be deleted.",
    });
    return;
  }

  const { error } = await supabase
    .from("sangeetha_stores")
    .delete()
    .eq("id", storeId)
    .eq("data_source", "manual");

  if (error) throw error;

  sendJson(res, 200, {
    deletedStoreId: storeId,
    deletedStoreNumber: store.store_number,
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
      await deleteManualStore(req, res);
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
