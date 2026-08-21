const {
  getSupabaseAdminClient,
  getSupabaseReadClient,
} = require("../_lib/supabase");
const { allowMethods, readJsonBody, sendJson } = require("../_lib/http");

const AREA_COLUMNS = [
  "id",
  "area_number",
  "name",
  "points",
  "centroid_latitude",
  "centroid_longitude",
  "created_at",
  "updated_at",
].join(", ");

function normalizeText(value, fieldName, { required = false } = {}) {
  const text = String(value ?? "").trim();
  if (required && !text) {
    throw new Error(`${fieldName} is required.`);
  }
  return text || null;
}

function normalizePoint(point, index) {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error(`Point ${index + 1} latitude is invalid.`);
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error(`Point ${index + 1} longitude is invalid.`);
  }
  return { lat, lng };
}

function normalizePoints(value) {
  if (!Array.isArray(value)) {
    throw new Error("Area points are required.");
  }
  if (value.length < 3 || value.length > 10) {
    throw new Error("Area must have between 3 and 10 points.");
  }
  return value.map(normalizePoint);
}

function getAreaCentroid(points) {
  const total = points.reduce((sum, point) => ({
    lat: sum.lat + point.lat,
    lng: sum.lng + point.lng,
  }), { lat: 0, lng: 0 });
  return {
    lat: total.lat / points.length,
    lng: total.lng / points.length,
  };
}

async function listAreas(res) {
  const supabase = getSupabaseReadClient();
  const { data, error } = await supabase
    .from("sangeetha_store_areas")
    .select(AREA_COLUMNS)
    .order("area_number", { ascending: true });

  if (error) throw error;

  sendJson(res, 200, {
    areas: Array.isArray(data) ? data : [],
  });
}

async function saveArea(req, res) {
  const body = await readJsonBody(req);
  const points = normalizePoints(body.points);
  const centroid = getAreaCentroid(points);
  const payload = {
    name: normalizeText(body.name, "Area name", { required: true }),
    points,
    centroid_latitude: Number.isFinite(Number(body.centroidLatitude))
      ? Number(body.centroidLatitude)
      : centroid.lat,
    centroid_longitude: Number.isFinite(Number(body.centroidLongitude))
      ? Number(body.centroidLongitude)
      : centroid.lng,
  };

  const supabase = getSupabaseAdminClient();
  const areaId = Number.parseInt(String(body.id ?? ""), 10);
  const query = Number.isFinite(areaId) && areaId > 0
    ? supabase.from("sangeetha_store_areas").update(payload).eq("id", areaId).select(AREA_COLUMNS).single()
    : supabase.from("sangeetha_store_areas").insert(payload).select(AREA_COLUMNS).single();

  const { data, error } = await query;
  if (error) throw error;

  sendJson(res, Number.isFinite(areaId) && areaId > 0 ? 200 : 201, {
    area: data,
  });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      await listAreas(res);
      return;
    }
    if (req.method === "POST" || req.method === "PATCH") {
      await saveArea(req, res);
      return;
    }

    allowMethods(res, ["GET", "POST", "PATCH"]);
    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "Failed to handle store areas",
    });
  }
};
