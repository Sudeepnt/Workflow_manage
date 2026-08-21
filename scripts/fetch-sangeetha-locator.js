#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const ENDPOINT = "https://www.sangeethamobiles.com/b/api/store-geography";
const OUTPUT_PATH = path.resolve(__dirname, "../data/sangeetha-store-catalog.json");
const GOOGLE_SEEDS = require("../data/sangeetha-store-seeds.json").stores;
const INTERNAL_RECORD_IDS = new Set([755, 1020, 1093, 1094, 1110]);

const STATE_NAMES = new Map([
  ["gujrat", "Gujarat"],
  ["karanataka", "Karnataka"],
  ["karnatak", "Karnataka"],
  ["maharastra", "Maharashtra"],
  ["pudicherry", "Puducherry"],
  ["tamilnadu", "Tamil Nadu"],
  ["tamilnaduâ", "Tamil Nadu"],
  ["uttarpradesh", "Uttar Pradesh"],
]);

const MATCH_STOP_WORDS = new Set([
  "and", "branch", "gadgets", "main", "mobiles", "near", "opp", "opposite",
  "road", "sangeetha", "smpl", "store", "the", "wham", "wipl",
]);

function encodedHeader(multiplier) {
  const base = String(Math.floor(9_990_000_001 * Math.random() + 10_000_000) * multiplier);
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ$!&*()^#@abcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (const digit of base) {
    result += digit;
    for (let index = 0; index < Math.floor(12 * Math.random()); index += 1) {
      result += characters[Math.floor(61 * Math.random())];
    }
  }
  return result;
}

function cleanText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeState(value = "") {
  const cleaned = cleanText(value).replace(/[^a-z ]/gi, "").toLowerCase();
  return STATE_NAMES.get(cleaned) || cleanText(value);
}

function normalizeName(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/\((?:smpl|wipl)(?:-c)?\)/g, " ")
    .replace(/\b(?:smpl|wipl)-c\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function nameTokens(value) {
  return new Set(
    normalizeName(value)
      .split(/\s+/)
      .filter((token) => token.length > 1 && !MATCH_STOP_WORDS.has(token)),
  );
}

function nameSimilarity(left, right) {
  const leftTokens = nameTokens(left);
  const rightTokens = nameTokens(right);
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return leftTokens.size + rightTokens.size
    ? (2 * intersection) / (leftTokens.size + rightTokens.size)
    : 0;
}

function distanceMeters(left, right) {
  const earthRadius = 6_371_000;
  const toRadians = (value) => value * Math.PI / 180;
  const latitudeDelta = toRadians(right.latitude - left.latitude);
  const longitudeDelta = toRadians(right.longitude - left.longitude);
  const leftLatitude = toRadians(left.latitude);
  const rightLatitude = toRadians(right.latitude);
  const a = (
    Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude)
    * Math.sin(longitudeDelta / 2) ** 2
  );
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isValidIndiaCoordinate(store) {
  return (
    Number.isFinite(store.latitude)
    && Number.isFinite(store.longitude)
    && store.latitude >= 6
    && store.latitude <= 38
    && store.longitude >= 68
    && store.longitude <= 98
  );
}

function normalizeRecord(state, record) {
  return {
    official_store_id: Number(record.id),
    name: cleanText(record.store_name),
    store_code: cleanText(record.store_code) || null,
    address: cleanText(record.address),
    phone: cleanText(record.mobile) || null,
    latitude: Number(record.lattitude),
    longitude: Number(record.longitude),
    hours: cleanText(record.timing) || null,
    city: cleanText(record.geography) || null,
    state: normalizeState(state),
  };
}

function classifyRecords(records) {
  const duplicateIds = new Set();
  const coordinateGroups = new Map();

  for (const record of records) {
    const coordinate = `${record.latitude.toFixed(7)},${record.longitude.toFixed(7)}`;
    const group = coordinateGroups.get(coordinate) || [];
    group.push(record);
    coordinateGroups.set(coordinate, group);
  }

  for (const group of coordinateGroups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((left, right) => left.official_store_id - right.official_store_id);
    for (let index = 1; index < sorted.length; index += 1) {
      const record = sorted[index];
      const earlierMatch = sorted.slice(0, index).some((candidate) => (
        normalizeName(candidate.name) === normalizeName(record.name)
        || (candidate.phone && candidate.phone === record.phone)
        || (
          nameSimilarity(candidate.name, record.name) >= 0.8
          && candidate.address === record.address
        )
      ));
      if (earlierMatch) duplicateIds.add(record.official_store_id);
    }
  }

  return records.map((record) => {
    let classification = "retail";
    if (!isValidIndiaCoordinate(record)) classification = "invalid_coordinate";
    else if (/dark store/i.test(record.name)) classification = "dark_store";
    else if (INTERNAL_RECORD_IDS.has(record.official_store_id)) classification = "internal";
    else if (duplicateIds.has(record.official_store_id)) classification = "duplicate";
    return { ...record, classification };
  });
}

function matchGoogleSeeds(retailRecords) {
  const candidates = [];

  retailRecords.forEach((record, recordIndex) => {
    GOOGLE_SEEDS.forEach((seed, seedIndex) => {
      const distance = distanceMeters(record, seed);
      if (distance > 5_000) return;
      const similarity = Math.max(
        nameSimilarity(record.name, seed.name),
        nameSimilarity(`${record.name} ${record.city || ""}`, seed.name),
      );
      const accepted = (
        distance <= 100
        || (distance <= 500 && similarity >= 0.2)
        || (distance <= 2_000 && similarity >= 0.4)
        || (distance <= 5_000 && similarity >= 0.65)
      );
      if (!accepted) return;
      const distanceScore = distance <= 25 ? 3 : distance <= 100 ? 2.5 : distance <= 500 ? 2 : distance <= 2_000 ? 1 : 0;
      candidates.push({
        recordIndex,
        seedIndex,
        distance,
        similarity,
        score: distanceScore + similarity * 3 - Math.log10(Math.max(1, distance)) / 20,
      });
    });
  });

  candidates.sort((left, right) => right.score - left.score || left.distance - right.distance);
  const usedRecords = new Set();
  const usedSeeds = new Set();
  const matches = [];
  for (const candidate of candidates) {
    if (usedRecords.has(candidate.recordIndex) || usedSeeds.has(candidate.seedIndex)) continue;
    usedRecords.add(candidate.recordIndex);
    usedSeeds.add(candidate.seedIndex);
    matches.push(candidate);
  }

  return { matches, usedRecords, usedSeeds };
}

async function fetchLocatorRecords() {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://www.sangeethamobiles.com",
      Referer: "https://www.sangeethamobiles.com/store-locate",
      number1: encodedHeader(216_091),
      number2: encodedHeader(1_257_787),
    },
    body: JSON.stringify({
      latitude: "12.9107931",
      longitude: "77.5963159",
      type_latlng: "manual",
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.http_code !== 200 || !payload.data) {
    throw new Error(payload.message || `Locator request failed with ${response.status}`);
  }
  return Object.entries(payload.data).flatMap(([state, stores]) => (
    stores.map((store) => normalizeRecord(state, store))
  ));
}

async function main() {
  const rawRecords = classifyRecords(await fetchLocatorRecords());
  const retailRecords = rawRecords.filter((record) => record.classification === "retail");
  const { matches, usedRecords, usedSeeds } = matchGoogleSeeds(retailRecords);
  const matchByRecord = new Map(matches.map((match) => [match.recordIndex, match]));
  const catalog = [];

  retailRecords.forEach((record, recordIndex) => {
    const match = matchByRecord.get(recordIndex);
    if (match) {
      const seed = GOOGLE_SEEDS[match.seedIndex];
      catalog.push({
        ...record,
        name: seed.name,
        address: seed.address,
        latitude: seed.latitude,
        longitude: seed.longitude,
        google_place_id: seed.google_place_id,
        google_maps_uri: seed.google_maps_uri,
        locator_name: record.name,
        locator_address: record.address,
        locator_latitude: record.latitude,
        locator_longitude: record.longitude,
        verification_status: "google_and_official_locator",
        match_distance_meters: Math.round(match.distance),
      });
      return;
    }
    catalog.push({
      ...record,
      google_place_id: null,
      google_maps_uri: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${record.latitude},${record.longitude}`)}`,
      verification_status: "official_locator_only",
      match_distance_meters: null,
    });
  });

  GOOGLE_SEEDS.forEach((seed, seedIndex) => {
    if (usedSeeds.has(seedIndex)) return;
    catalog.push({
      official_store_id: null,
      name: seed.name,
      store_code: null,
      address: seed.address,
      phone: null,
      latitude: seed.latitude,
      longitude: seed.longitude,
      hours: null,
      city: seed.city,
      state: seed.state.replace(/\b\w/g, (letter) => letter.toUpperCase()),
      classification: "retail",
      google_place_id: seed.google_place_id,
      google_maps_uri: seed.google_maps_uri,
      verification_status: "google_directory_only",
      match_distance_meters: null,
    });
  });

  catalog.sort((left, right) => left.name.localeCompare(right.name));
  const classificationCounts = rawRecords.reduce((counts, record) => {
    counts[record.classification] = (counts[record.classification] || 0) + 1;
    return counts;
  }, {});
  const verificationCounts = catalog.reduce((counts, record) => {
    counts[record.verification_status] = (counts[record.verification_status] || 0) + 1;
    return counts;
  }, {});
  const output = {
    generated_at: new Date().toISOString(),
    source: ENDPOINT,
    raw_record_count: rawRecords.length,
    classification_counts: classificationCounts,
    catalog_record_count: catalog.length,
    verification_counts: verificationCounts,
    excluded_records: rawRecords.filter((record) => record.classification !== "retail"),
    stores: catalog,
  };

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ...output, stores: undefined, excluded_records: undefined }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
