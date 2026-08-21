const { getSupabaseAdminClient } = require("../_lib/supabase");
const { allowMethods, sendJson } = require("../_lib/http");

const STALE_DAYS = 30;
const STALE_MS = STALE_DAYS * 24 * 60 * 60 * 1000;

function getLatestSyncAt(rows) {
  return rows.reduce((latest, row) => {
    const current = Date.parse(row.google_synced_at ?? "");
    if (!Number.isFinite(current)) return latest;
    return !latest || current > latest ? current : latest;
  }, 0);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    allowMethods(res, ["GET"]);
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from("sangeetha_stores")
      .select("id, google_place_id, name, latitude, longitude, address, business_status, google_maps_uri, google_synced_at, created_at, updated_at")
      .order("name", { ascending: true });

    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const now = Date.now();
    const staleCount = rows.filter((row) => {
      const syncedAt = Date.parse(row.google_synced_at ?? "");
      return !Number.isFinite(syncedAt) || (now - syncedAt) > STALE_MS;
    }).length;
    const latestSyncAt = getLatestSyncAt(rows);

    sendJson(res, 200, {
      stores: rows,
      meta: {
        count: rows.length,
        staleCount,
        staleAfterDays: STALE_DAYS,
        latestSyncAt: latestSyncAt ? new Date(latestSyncAt).toISOString() : null,
      },
    });
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "Failed to load stores",
    });
  }
};
