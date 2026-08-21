#!/usr/bin/env node

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 8000;
const seedData = require("../data/sangeetha-store-seeds.json");
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
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/sangeetha-stores") {
    const stores = seedData.stores.map((store, index) => ({
      id: index + 1,
      google_place_id: store.google_place_id,
      name: store.name,
      latitude: store.latitude,
      longitude: store.longitude,
      address: store.address,
      business_status: null,
      google_maps_uri: store.google_maps_uri,
      google_synced_at: null,
    }));
    sendJson(response, 200, {
      stores,
      meta: {
        count: stores.length,
        staleCount: stores.length,
        staleAfterDays: 30,
        latestSyncAt: null,
      },
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
