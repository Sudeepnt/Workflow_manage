const { getOptionalEnv, getRequiredEnv } = require("./_lib/env");
const { allowMethods, sendJson } = require("./_lib/http");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    allowMethods(res, ["GET"]);
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    sendJson(res, 200, {
      googleMapsApiKey: getRequiredEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"),
      googleMapsMapId: getOptionalEnv("NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID", "DEMO_MAP_ID"),
    });
  } catch (error) {
    sendJson(res, 500, {
      error: error.message,
    });
  }
};
