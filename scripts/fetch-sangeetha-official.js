#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");

const SITEMAP_URL = "https://stores.sangeethamobiles.com/sitemap.xml";
const USER_AGENT = "Mozilla/5.0 (compatible; ATITStoreMap/1.0)";
const CONCURRENCY = 8;
const OUTPUT_PATH = path.resolve(
  __dirname,
  "../data/sangeetha-store-seeds.json",
);

function decodeHtml(value = "") {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ")
    .trim();
}

async function fetchBuffer(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 750));
      }
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError?.message}`);
}

function extractUrls(xml, suffix = "") {
  return Array.from(xml.matchAll(/<loc>(https:\/\/[^<]+)<\/loc>/g), ([, url]) => (
    decodeHtml(url)
  )).filter((url) => !suffix || url.endsWith(suffix));
}

function findLocalBusiness(html) {
  const blocks = Array.from(
    html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi),
    ([, json]) => json,
  );

  for (const block of blocks) {
    try {
      const values = JSON.parse(block);
      const queue = Array.isArray(values) ? [...values] : [values];
      while (queue.length) {
        const value = queue.shift();
        if (!value || typeof value !== "object") continue;
        if (value["@type"] === "LocalBusiness") return value;
        if (Array.isArray(value["@graph"])) queue.push(...value["@graph"]);
      }
    } catch {
      // Some pages include unrelated malformed JSON-LD blocks.
    }
  }
  return null;
}

function parseStorePage(url, html, sourceSitemap) {
  const business = findLocalBusiness(html);
  const address = Array.isArray(business?.address)
    ? business.address[0]
    : business?.address;
  const title = decodeHtml(html.match(/<title>([^<]+)/i)?.[1] ?? "");
  const position = html.match(/name="geo\.position"\s+content="\s*([^;]+);\s*([^"]+)/i);
  const placeId = (
    html.match(/(?:placeid=|PlaceId[^A-Za-z0-9_-]+)([A-Za-z0-9_-]{20,})/i)?.[1]
    ?? html.match(/(ChIJ[A-Za-z0-9_-]{15,})/)?.[1]
  );
  const mapsUri = decodeHtml(
    html.match(/https:\/\/maps\.google\.com\/maps\?cid=\d+/i)?.[0] ?? "",
  );
  const sourceId = url.match(/-(\d+)\/Home$/)?.[1] ?? "";
  const sitemapPath = new URL(sourceSitemap).pathname.split("/").filter(Boolean);
  const enterpriseIndex = sitemapPath.indexOf("321091");
  const state = sitemapPath[enterpriseIndex + 1]?.replaceAll("_", " ") ?? "";
  const city = sitemapPath[enterpriseIndex + 2]?.replace(/\.xml\.gz$/, "").replaceAll("_", " ") ?? "";
  const latitude = Number(business?.geo?.latitude ?? position?.[1]);
  const longitude = Number(business?.geo?.longitude ?? position?.[2]);
  const addressParts = [
    address?.streetAddress,
    address?.addressLocality,
    address?.addressRegion,
    address?.postalCode,
    address?.addressCountry,
  ].map((part) => decodeHtml(String(part ?? ""))).filter(Boolean);

  if (!sourceId || !placeId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error(`Missing required store data for ${url}`);
  }

  return {
    official_store_id: sourceId,
    google_place_id: placeId,
    name: title.replace(/\s*\|\s*Official store\s*$/i, "").trim(),
    latitude,
    longitude,
    address: addressParts.join(", "),
    google_maps_uri: mapsUri || `https://www.google.com/maps/search/?api=1&query_place_id=${placeId}`,
    official_store_uri: url,
    state,
    city,
  };
}

async function mapConcurrent(values, mapper, concurrency = CONCURRENCY) {
  const results = new Array(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
      if ((index + 1) % 50 === 0) {
        process.stderr.write(`Fetched ${index + 1}/${values.length}\n`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

async function main() {
  const sitemapIndex = (await fetchBuffer(SITEMAP_URL)).toString("utf8");
  const sitemapUrls = extractUrls(sitemapIndex, ".xml.gz");
  const sitemapEntries = await mapConcurrent(sitemapUrls, async (url) => {
    const compressed = await fetchBuffer(url);
    return { url, xml: zlib.gunzipSync(compressed).toString("utf8") };
  });
  const storeSources = new Map();
  sitemapEntries.forEach((entry) => {
    extractUrls(entry.xml, "/Home").forEach((url) => storeSources.set(url, entry.url));
  });
  const storeUrls = Array.from(storeSources.keys()).sort();

  const stores = await mapConcurrent(storeUrls, async (url) => {
    const html = (await fetchBuffer(url)).toString("utf8");
    return parseStorePage(url, html, storeSources.get(url));
  });
  const storesByPlaceId = new Map();
  stores.forEach((store) => {
    const matches = storesByPlaceId.get(store.google_place_id) ?? [];
    matches.push(store);
    storesByPlaceId.set(store.google_place_id, matches);
  });
  const duplicateGooglePlaces = Array.from(storesByPlaceId.entries())
    .filter(([, matches]) => matches.length > 1)
    .map(([googlePlaceId, matches]) => ({ google_place_id: googlePlaceId, stores: matches }));
  const deduped = Array.from(storesByPlaceId.values(), (matches) => matches.at(-1))
    .sort((left, right) => left.name.localeCompare(right.name));
  const output = {
    generated_at: new Date().toISOString(),
    source: SITEMAP_URL,
    sitemap_count: sitemapUrls.length,
    store_page_count: storeUrls.length,
    unique_google_place_count: deduped.length,
    duplicate_google_place_count: duplicateGooglePlaces.length,
    duplicate_google_places: duplicateGooglePlaces,
    stores: deduped,
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: OUTPUT_PATH, ...output, stores: undefined }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
