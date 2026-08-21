const state = {
  config: null,
  clusterer: null,
  initialViewApplied: false,
  map: null,
  markers: [],
  selectedRegion: "",
  stores: [],
  selectedStoreId: null,
  selectedMarkerId: null,
};

const el = {
  map: document.getElementById("map"),
  refreshButton: document.getElementById("refresh-button"),
  regionFilter: document.getElementById("region-filter"),
  statusCard: document.getElementById("status-card"),
  statusLabel: document.getElementById("status-label"),
  statusDetail: document.getElementById("status-detail"),
  storeSheet: document.getElementById("store-sheet"),
  sheetTitle: document.getElementById("sheet-title"),
  sheetAddress: document.getElementById("sheet-address"),
  sheetLink: document.getElementById("sheet-link"),
};

let mapsLoaderPromise = null;

function setStatus(label, detail = "") {
  el.statusLabel.textContent = label;
  el.statusDetail.textContent = detail;
}

function showStatusCard(visible) {
  el.statusCard.hidden = !visible;
}

function setLoadingState(loading) {
  el.refreshButton.disabled = loading;
  el.regionFilter.disabled = loading;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.error ?? `Request failed with ${response.status}`));
  }
  return payload;
}

async function loadRuntimeConfig() {
  const payload = await fetchJson("/api/runtime-config");
  if (!payload.googleMapsApiKey) {
    throw new Error("Google Maps API key is not configured.");
  }
  state.config = payload;
  return payload;
}

function loadMapsScript() {
  if (globalThis.google?.maps?.importLibrary) return Promise.resolve();
  if (mapsLoaderPromise) return mapsLoaderPromise;

  mapsLoaderPromise = new Promise((resolve, reject) => {
    const callbackName = `initSangeethaMap${Date.now()}`;
    const script = document.createElement("script");

    globalThis[callbackName] = () => {
      delete globalThis[callbackName];
      resolve();
    };

    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(state.config.googleMapsApiKey)}&loading=async&callback=${callbackName}&v=weekly&libraries=marker`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      delete globalThis[callbackName];
      mapsLoaderPromise = null;
      reject(new Error("Google Maps JavaScript API failed to load."));
    };

    document.head.appendChild(script);
  });

  return mapsLoaderPromise;
}

async function ensureMap() {
  if (state.map) return state.map;
  await loadMapsScript();
  const { Map } = await google.maps.importLibrary("maps");

  state.map = new Map(el.map, {
    center: { lat: 12.9716, lng: 77.5946 },
    zoom: 11,
    mapId: state.config.googleMapsMapId || "DEMO_MAP_ID",
    fullscreenControl: false,
    mapTypeControl: false,
    streetViewControl: false,
    gestureHandling: "greedy",
    clickableIcons: false,
  });
  return state.map;
}

function clearMarkers() {
  if (state.clusterer) {
    state.clusterer.clearMarkers();
    state.clusterer = null;
  }
  state.markers.forEach((entry) => {
    if (entry.marker) {
      entry.marker.map = null;
    }
  });
  state.markers = [];
}

function createPinNode(selected) {
  const pin = document.createElement("div");
  pin.className = `store-pin${selected ? " is-selected" : ""}`;
  return pin;
}

function createClusterNode(count) {
  const cluster = document.createElement("div");
  cluster.className = "store-cluster";
  cluster.textContent = String(count);
  cluster.setAttribute("aria-label", `${count} stores`);
  return cluster;
}

function getStoreKey(store) {
  return String(store.id ?? store.google_place_id ?? store.official_store_id);
}

function updateSelectedMarker() {
  state.markers.forEach((entry) => {
    const selected = getStoreKey(entry.store) === state.selectedMarkerId;
    entry.marker.content = createPinNode(selected);
  });
}

function getStoreLocationName(name) {
  return String(name ?? "")
    .replace(/^Sangeetha\s+(?:Mobiles|Gadgets)\s*-\s*/i, "")
    .trim();
}

function showStoreSheet(store) {
  if (!store) {
    el.storeSheet.hidden = true;
    state.selectedStoreId = null;
    state.selectedMarkerId = null;
    updateSelectedMarker();
    return;
  }

  state.selectedStoreId = getStoreKey(store);
  state.selectedMarkerId = getStoreKey(store);
  el.sheetTitle.textContent = `Sangeetha Mobiles - ${getStoreLocationName(store.name)}`;
  el.sheetAddress.textContent = store.address || "Address unavailable";
  el.sheetLink.href = store.google_maps_uri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${store.latitude},${store.longitude}`)}`;
  el.storeSheet.hidden = false;
  updateSelectedMarker();
}

async function renderMarkers(stores) {
  const map = await ensureMap();
  const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
  const bounds = new google.maps.LatLngBounds();

  clearMarkers();

  stores.forEach((store) => {
    if (!Number.isFinite(Number(store.latitude)) || !Number.isFinite(Number(store.longitude))) return;

    const marker = new AdvancedMarkerElement({
      position: {
        lat: Number(store.latitude),
        lng: Number(store.longitude),
      },
      title: store.name,
      gmpClickable: true,
      content: createPinNode(false),
    });

    marker.addEventListener("gmp-click", () => {
      showStoreSheet(store);
      map.panTo({
        lat: Number(store.latitude),
        lng: Number(store.longitude),
      });
    });

    state.markers.push({ marker, store });
    bounds.extend({
      lat: Number(store.latitude),
      lng: Number(store.longitude),
    });
  });

  if (state.markers.length > 50) {
    if (!globalThis.markerClusterer?.MarkerClusterer) {
      throw new Error("Google Maps marker clustering failed to load.");
    }
    state.clusterer = new markerClusterer.MarkerClusterer({
      map,
      markers: state.markers.map((entry) => entry.marker),
      renderer: {
        render: ({ count, position }) => new google.maps.marker.AdvancedMarkerElement({
          position,
          content: createClusterNode(count),
          title: `Cluster of ${count} stores`,
          zIndex: 1_000_000 + count,
        }),
      },
    });
  } else {
    state.markers.forEach((entry) => {
      entry.marker.map = map;
    });
  }

  if (!state.markers.length) {
    showStoreSheet(null);
    setStatus("No stores found", "Run an import to populate the map.");
    showStatusCard(true);
    return;
  }

  if (state.markers.length === 1) {
    map.setCenter(bounds.getCenter());
    map.setZoom(15);
  } else if (state.markers.length <= 50) {
    const span = bounds.toSpan();
    const largestSpan = Math.max(span.lat(), span.lng());
    const zoom = largestSpan <= 0.2
      ? 11
      : largestSpan <= 0.5
        ? 10
        : largestSpan <= 1.5
          ? 9
          : largestSpan <= 3
            ? 8
            : largestSpan <= 6
              ? 7
              : 6;
    map.setCenter(bounds.getCenter());
    map.setZoom(zoom);
  } else {
    map.fitBounds(bounds, 72);
  }
}

function getRegionCounts(stores) {
  return stores.reduce((counts, store) => {
    const region = String(store.state || "Unknown").trim();
    counts.set(region, (counts.get(region) || 0) + 1);
    return counts;
  }, new Map());
}

function populateRegionFilter(stores) {
  const counts = getRegionCounts(stores);
  const regions = [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0]));
  el.regionFilter.replaceChildren(new Option("All India", ""));
  regions.forEach(([region]) => {
    el.regionFilter.add(new Option(region, region));
  });
  el.regionFilter.value = state.selectedRegion;
}

async function applyRegionFilter() {
  const region = state.selectedRegion;
  const stores = region
    ? state.stores.filter((store) => store.state === region)
    : state.stores;
  showStoreSheet(null);
  setStatus(
    region ? `${region} coverage` : "Verified retail coverage",
    region
      ? `${stores.length} verified retail ${stores.length === 1 ? "location" : "locations"}. Warehouses are excluded.`
      : `${getRegionCounts(state.stores).size} states or territories have verified stores. Warehouses are excluded.`,
  );
  await renderMarkers(stores);
}

async function loadStores() {
  setStatus("Loading stores", "Reading cached store coordinates from Supabase.");
  showStatusCard(true);

  const payload = await fetchJson("/api/sangeetha-stores");
  state.stores = Array.isArray(payload.stores) ? payload.stores : [];
  if (!state.initialViewApplied) {
    state.selectedRegion = "";
    state.initialViewApplied = true;
  }
  populateRegionFilter(state.stores);
  await applyRegionFilter();
  if (state.stores.length) {
    showStatusCard(true);
  }
}

async function refreshStores() {
  setLoadingState(true);
  setStatus("Refreshing stores", "Preparing the nationwide Google Places import.");
  showStatusCard(true);

  try {
    let importedCount = 0;
    let payload;

    do {
      payload = await fetchJson("/api/sangeetha-stores/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ batchSize: 20 }),
      });
      importedCount += Number(payload.importedCount) || 0;
      const checked = Math.max(0, payload.totalCount - payload.remainingCount);
      const percent = payload.totalCount
        ? Math.min(100, Math.round((checked / payload.totalCount) * 100))
        : 0;
      setStatus(
        "Refreshing stores",
        `${checked} of ${payload.totalCount} current in Google Places (${percent}%).`,
      );
    } while (!payload.complete);

    setStatus(
      "Refresh complete",
      importedCount
        ? `${importedCount} stores refreshed from Google Places.`
        : "All store data is already current.",
    );
    await loadStores();
  } catch (error) {
    setStatus("Refresh failed", error.message);
    showStatusCard(true);
  } finally {
    setLoadingState(false);
  }
}

function bindEvents() {
  el.refreshButton.addEventListener("click", refreshStores);
  el.regionFilter.addEventListener("change", async () => {
    state.selectedRegion = el.regionFilter.value;
    try {
      await applyRegionFilter();
    } catch (error) {
      setStatus("Region unavailable", error.message);
    }
  });
}

async function init() {
  bindEvents();
  setLoadingState(true);

  try {
    await loadRuntimeConfig();
    await ensureMap();
    await loadStores();
  } catch (error) {
    setStatus("Map unavailable", error.message);
    showStatusCard(true);
  } finally {
    setLoadingState(false);
  }
}

init().catch((error) => {
  setStatus("Map unavailable", error.message || "Unexpected error");
  showStatusCard(true);
});
