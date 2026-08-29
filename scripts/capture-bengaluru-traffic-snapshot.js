#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const API_KEY = String(process.env.GOOGLE_ROUTES_API_KEY || "").trim();
const OUTPUT_FILE = path.resolve(__dirname, "../data/bengaluru-traffic-weekly-snapshot.json");

const corridors = [
  { id: "airport-mg-road", name: "Kempegowda Airport → MG Road", origin: [13.1991, 77.7066], destination: [12.9756, 77.6066] },
  { id: "hebbal-silk-board", name: "Hebbal → Silk Board", origin: [13.0358, 77.5970], destination: [12.9177, 77.6229] },
  { id: "whitefield-mg-road", name: "Whitefield → MG Road", origin: [12.9698, 77.7500], destination: [12.9756, 77.6066] },
  { id: "kr-puram-electronic-city", name: "KR Puram → Electronic City", origin: [13.0074, 77.6956], destination: [12.8456, 77.6603] },
  { id: "yeshwantpur-marathahalli", name: "Yeshwanthpur → Marathahalli", origin: [13.0238, 77.5529], destination: [12.9592, 77.6974] },
  { id: "rajajinagar-koramangala", name: "Rajajinagar → Koramangala", origin: [12.9916, 77.5533], destination: [12.9352, 77.6245] },
  { id: "hsr-manyata", name: "HSR Layout → Manyata Tech Park", origin: [12.9116, 77.6389], destination: [13.0475, 77.6200] },
  { id: "jayanagar-whitefield", name: "Jayanagar → Whitefield", origin: [12.9299, 77.5830], destination: [12.9698, 77.7500] },
  { id: "kengeri-indiranagar", name: "Kengeri → Indiranagar", origin: [12.9134, 77.4865], destination: [12.9784, 77.6408] },
  { id: "bannerghatta-mg-road", name: "Bannerghatta Road → MG Road", origin: [12.9066, 77.6010], destination: [12.9756, 77.6066] },
];

function location([latitude, longitude]) {
  return { location: { latLng: { latitude, longitude } } };
}

async function computeCorridor(corridor) {
  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask": "routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.travelAdvisory.speedReadingIntervals",
    },
    body: JSON.stringify({
      origin: location(corridor.origin),
      destination: location(corridor.destination),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      extraComputations: ["TRAFFIC_ON_POLYLINE"],
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.routes?.[0]) {
    throw new Error(`${corridor.name}: ${payload.error?.message || `Routes API returned ${response.status}`}`);
  }

  const route = payload.routes[0];
  return {
    ...corridor,
    duration: route.duration,
    staticDuration: route.staticDuration,
    distanceMeters: route.distanceMeters,
    encodedPolyline: route.polyline?.encodedPolyline || "",
    speedReadingIntervals: route.travelAdvisory?.speedReadingIntervals || [],
  };
}

async function main() {
  if (!API_KEY) {
    throw new Error("Missing GOOGLE_ROUTES_API_KEY. Keep it in the local environment; never commit it.");
  }
  const results = [];
  for (const corridor of corridors) {
    process.stdout.write(`Capturing ${corridor.name}...\n`);
    results.push(await computeCorridor(corridor));
  }
  const snapshot = {
    city: "Bengaluru",
    generatedAt: new Date().toISOString(),
    refreshPolicy: "Manual only. This snapshot does not auto-update.",
    source: "Google Routes API traffic-aware routes",
    corridors: results,
  };
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(snapshot, null, 2)}\n`);
  process.stdout.write(`Saved ${results.length} corridors to ${OUTPUT_FILE}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
