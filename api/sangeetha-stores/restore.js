const { getSupabaseAdminClient } = require("../_lib/supabase");
const { allowMethods, readJsonBody, sendJson } = require("../_lib/http");
const catalogData = require("../../data/sangeetha-store-catalog.json");

const RESTORE_TARGETS = new Map([
  [718, "Sangeetha Gadgets - Tadepalligudem (ZP High School), Tadepalligudem"],
  [782, "Sangeetha Gadgets - Vasco-(Karma Express), Mundvel"],
  [793, "Sangeetha Gadgets - Vijaya Nagar-1 (WIPL-C), Vijayanagar"],
  [795, "Sangeetha Gadgets - Vijayanagar 3, Vijayanagar"],
  [830, "Sangeetha Gadgets - Yeleswaram-2 (WIPL), Yeleswaram"],
  [831, "Sangeetha Gadgets - Yeleswaram, Yeleswaram"],
  [838, "Sangeetha Gadgets - Zaheerabad 2, Zaheerabad"],
  [869, "Store - Kochi (SMPL)"],
]);

function toRow(storeNumber, store) {
  return {
    store_number: storeNumber,
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
    locator_name: store.locator_name,
    locator_address: store.locator_address,
    locator_latitude: store.locator_latitude,
    locator_longitude: store.locator_longitude,
    google_synced_at: null,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    allowMethods(res, ["POST"]);
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const requested = Array.isArray(body.storeNumbers)
      ? body.storeNumbers.map((value) => Number.parseInt(String(value), 10))
      : [...RESTORE_TARGETS.keys()];
    const storeNumbers = [...new Set(requested)].filter((value) => RESTORE_TARGETS.has(value));
    const rows = storeNumbers.map((storeNumber) => {
      const name = RESTORE_TARGETS.get(storeNumber);
      const store = catalogData.stores.find((entry) => entry.name === name);
      if (!store) throw new Error(`Catalog record for store #${storeNumber} was not found.`);
      return toRow(storeNumber, store);
    });

    const supabase = getSupabaseAdminClient();
    const { data: existing, error: existingError } = await supabase
      .from("sangeetha_stores")
      .select("store_number")
      .in("store_number", storeNumbers);
    if (existingError) throw existingError;

    const existingNumbers = new Set((existing || []).map((row) => Number(row.store_number)));
    const missingRows = rows.filter((row) => !existingNumbers.has(row.store_number));
    const { data, error } = missingRows.length
      ? await supabase.from("sangeetha_stores").insert(missingRows).select("id, store_number, name")
      : { data: [], error: null };
    if (error) throw error;

    sendJson(res, 200, {
      restored: data || [],
      alreadyPresent: rows.filter((row) => existingNumbers.has(row.store_number)).map((row) => row.store_number),
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Failed to restore stores" });
  }
};
