const { getOptionalEnv } = require("./_lib/env");
const { allowMethods, sendJson } = require("./_lib/http");
const {
  PUBLIC_GOOGLE_MAPS_API_KEY,
  PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  PUBLIC_SUPABASE_URL,
} = require("./_lib/public-config");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    allowMethods(res, ["GET"]);
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    sendJson(res, 200, {
      googleMapsApiKey: getOptionalEnv(
        "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY",
        PUBLIC_GOOGLE_MAPS_API_KEY,
      ),
      googleMapsMapId: getOptionalEnv("NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID", "DEMO_MAP_ID"),
      supabaseUrl: getOptionalEnv("SUPABASE_URL", PUBLIC_SUPABASE_URL),
      supabasePublishableKey: getOptionalEnv(
        "SUPABASE_PUBLISHABLE_KEY",
        PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      ),
    });
  } catch (error) {
    sendJson(res, 500, {
      error: error.message,
    });
  }
};
