#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const OUTPUT_PATH = path.resolve(__dirname, "../data/central-bengaluru-commercial-density.json");
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const BOUNDS = {
  south: 12.958,
  west: 77.59,
  north: 12.985,
  east: 77.627,
};

const query = `[out:json][timeout:60];
(
  way["building"~"^(commercial|retail|office)$"](${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east});
  way["office"](${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east});
  node["office"](${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east});
  way["shop"](${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east});
  node["shop"](${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east});
);
out center tags;`;

function getPoint(element) {
  const lat = Number(element.lat ?? element.center?.lat);
  const lng = Number(element.lon ?? element.center?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const tags = element.tags || {};
  const kind = tags.office ? "office" : tags.shop ? "retail" : tags.building || "commercial";
  const weight = kind === "office" ? 1 : kind === "retail" ? 0.72 : 0.86;
  return { lat, lng, weight, kind };
}

async function main() {
  const response = await fetch(`${OVERPASS_URL}?data=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": "ATIT-Central-Bengaluru-Commercial-Density/1.0" },
  });
  if (!response.ok) throw new Error(`Overpass request failed with ${response.status}.`);
  const payload = await response.json();
  const points = (payload.elements || []).map(getPoint).filter(Boolean);
  if (!points.length) throw new Error("No commercial locations were returned for the selected area.");

  const snapshot = {
    area: {
      name: "Central Bengaluru commercial core",
      description: "MG Road, Brigade Road, Residency Road and UB City surroundings",
      bounds: BOUNDS,
    },
    generatedAt: new Date().toISOString(),
    refreshPolicy: "Manual only. This density snapshot does not auto-update.",
    source: "OpenStreetMap commercial, office, retail and shop tags captured through Overpass API",
    points,
  };
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
  process.stdout.write(`Saved ${points.length} commercial density points to ${OUTPUT_PATH}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
