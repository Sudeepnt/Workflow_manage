#!/usr/bin/env node

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 8000;
const catalogData = require("../data/sangeetha-store-catalog.json");
let localStores = catalogData.stores.map((store, index) => ({
  id: index + 1,
  store_number: index + 1,
  google_place_id: store.google_place_id,
  official_store_id: store.official_store_id,
  data_source: store.verification_status === "manual" ? "manual" : "catalog",
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
}));
let nextLocalId = localStores.length + 1;
let nextStoreNumber = localStores.length + 1;
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function getLocalMapsKey() {
  if (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) {
    return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  }
  const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  return indexHtml.match(/ATIT_GOOGLE_MAPS_API_KEY\s*=\s*["']([^"']+)/)?.[1] ?? "";
}

function serveFile(requestPath, response) {
  const decodedPath = decodeURIComponent(requestPath);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  let filePath = path.resolve(ROOT, relativePath);

  if (!filePath.startsWith(`${ROOT}${path.sep}`) && filePath !== ROOT) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  response.writeHead(200, {
    "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/api/runtime-config") {
    sendJson(response, 200, {
      googleMapsApiKey: getLocalMapsKey(),
      googleMapsMapId: "DEMO_MAP_ID",
      supabaseUrl: "https://ejuynlfumyvriufxnzam.supabase.co",
      supabasePublishableKey: "sb_publishable_gYutqzoCmYWw8YLQ6bEYLw_K0P_xH0G",
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/sangeetha-stores") {
    sendJson(response, 200, {
      stores: localStores,
      meta: {
        count: localStores.length,
        staleCount: localStores.filter((store) => store.google_place_id).length,
        locatorOnlyCount: localStores.filter((store) => !store.google_place_id).length,
        staleAfterDays: 30,
        latestSyncAt: null,
      },
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/sangeetha-stores") {
    readJsonBody(request).then((body) => {
      const store = {
        id: nextLocalId++,
        store_number: nextStoreNumber++,
        google_place_id: null,
        official_store_id: null,
        data_source: "manual",
        name: String(body.name || "").trim(),
        latitude: Number(body.latitude),
        longitude: Number(body.longitude),
        address: String(body.address || "").trim() || null,
        business_status: null,
        google_maps_uri: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${body.latitude},${body.longitude}`)}`,
        store_code: null,
        phone: null,
        hours: null,
        city: String(body.city || "").trim() || null,
        state: String(body.state || "").trim() || null,
        verification_status: "manual",
        store_sqft: body.storeSqft ? Number(String(body.storeSqft).replace(/[^\d]/g, "")) : null,
        google_synced_at: null,
      };
      localStores = [...localStores, store];
      sendJson(response, 201, { store });
    }).catch((error) => {
      sendJson(response, 500, { error: error.message });
    });
    return;
  }

  if (request.method === "PATCH" && url.pathname === "/api/sangeetha-stores") {
    readJsonBody(request).then((body) => {
      const storeId = Number(body.id);
      const sqft = body.storeSqft === "" || body.storeSqft == null
        ? null
        : Number(String(body.storeSqft).replace(/[^\d]/g, ""));
      const index = localStores.findIndex((store) => store.id === storeId);
      if (index === -1) {
        sendJson(response, 404, { error: "Store not found" });
        return;
      }
      localStores[index] = {
        ...localStores[index],
        store_sqft: Number.isFinite(sqft) ? sqft : null,
      };
      sendJson(response, 200, { store: localStores[index] });
    }).catch((error) => {
      sendJson(response, 500, { error: error.message });
    });
    return;
  }

  if (url.pathname === "/api/sangeetha-stores/import") {
    sendJson(response, 503, {
      error: "Google Places refresh is only available with server credentials.",
    });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }
  serveFile(url.pathname, response);
});

server.listen(PORT, "::", () => {
  process.stdout.write(`Local preview: http://127.0.0.1:${PORT}/sangeetha-map/\n`);
});
