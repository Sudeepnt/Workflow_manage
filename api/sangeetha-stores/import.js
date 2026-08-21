const {
  fetchSangeethaStoresByIds,
  getStoreSeedCount,
  getStoreSeedPlaceIds,
} = require("../_lib/google-places");
const { allowMethods, readJsonBody, sendJson } = require("../_lib/http");
const { getSupabaseAdminClient } = require("../_lib/supabase");

const STALE_MS = 30 * 24 * 60 * 60 * 1000;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    allowMethods(res, ["POST"]);
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const body = await readJsonBody(req);

    const supabase = getSupabaseAdminClient();
    const { data: existingRows, error: existingError } = await supabase
      .from("sangeetha_stores")
      .select("google_place_id, google_synced_at");
    if (existingError) throw existingError;

    const syncedByPlaceId = new Map(
      (existingRows ?? []).map((row) => [row.google_place_id, row.google_synced_at]),
    );
    const now = Date.now();
    const stalePlaceIds = getStoreSeedPlaceIds().filter((placeId) => {
      const syncedAt = Date.parse(syncedByPlaceId.get(placeId) ?? "");
      return !Number.isFinite(syncedAt) || (now - syncedAt) > STALE_MS;
    });
    const stores = await fetchSangeethaStoresByIds(stalePlaceIds, body.batchSize);
    const syncedAt = new Date().toISOString();
    const payload = stores.map((store) => ({
      ...store,
      google_synced_at: syncedAt,
    }));

    if (!payload.length) {
      sendJson(res, 200, {
        importedCount: 0,
        upsertedCount: 0,
        syncedAt: null,
        totalCount: getStoreSeedCount(),
        remainingCount: 0,
        complete: true,
      });
      return;
    }

    const { data, error } = await supabase
      .from("sangeetha_stores")
      .upsert(payload, {
        onConflict: "google_place_id",
        ignoreDuplicates: false,
      })
      .select("id, google_place_id");

    if (error) throw error;

    sendJson(res, 200, {
      importedCount: stores.length,
      upsertedCount: Array.isArray(data) ? data.length : stores.length,
      syncedAt,
      totalCount: getStoreSeedCount(),
      remainingCount: Math.max(0, stalePlaceIds.length - stores.length),
      complete: stalePlaceIds.length <= stores.length,
    });
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "Failed to import stores",
    });
  }
};
