const state = {
  config: null,
  clusterer: null,
  initialViewApplied: false,
  map: null,
  markers: [],
  cityBoundaryLayer: null,
  cityBoundaryRectangle: null,
  locationAccuracyCircle: null,
  locationMarker: null,
  placeAutocomplete: null,
  selectedRegion: "",
  stores: [],
  selectedStoreId: null,
  selectedMarkerId: null,
};

const INDIA_BOUNDS = {
  south: 6.4,
  west: 68,
  north: 37.6,
  east: 97.6,
};

const el = {
  map: document.getElementById("map"),
  citySearchHost: document.getElementById("city-search-host"),
  locationButton: document.getElementById("location-button"),
  refreshButton: document.getElementById("refresh-button"),
  regionFilter: document.getElementById("region-filter"),
  statusCard: document.getElementById("status-card"),
  statusLabel: document.getElementById("status-label"),
  statusDetail: document.getElementById("status-detail"),
  storeSheet: document.getElementById("store-sheet"),
  sheetClose: document.getElementById("sheet-close"),
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
    center: { lat: 22.6, lng: 78.9 },
    zoom: 4,
    mapId: state.config.googleMapsMapId || "DEMO_MAP_ID",
    fullscreenControl: false,
    mapTypeControl: false,
    streetViewControl: false,
    gestureHandling: "greedy",
    clickableIcons: false,
  });
  return state.map;
}

function clearCityBoundary() {
  if (state.cityBoundaryLayer) {
    state.cityBoundaryLayer.style = null;
    state.cityBoundaryLayer = null;
  }
  if (state.cityBoundaryRectangle) {
    state.cityBoundaryRectangle.setMap(null);
    state.cityBoundaryRectangle = null;
  }
}

function drawCityBoundary(place) {
  clearCityBoundary();
  const map = state.map;

  try {
    const localityLayer = map.getFeatureLayer("LOCALITY");
    if (localityLayer.isAvailable) {
      localityLayer.style = ({ feature }) => {
        if (feature.placeId !== place.id) return null;
        return {
          strokeColor: "#d93025",
          strokeOpacity: 1,
          strokeWeight: 4,
          fillColor: "#d93025",
          fillOpacity: 0.06,
        };
      };
      state.cityBoundaryLayer = localityLayer;
      return;
    }
  } catch (error) {
    console.warn("Google locality boundaries are unavailable for this map ID.", error);
  }

  if (place.viewport) {
    state.cityBoundaryRectangle = new google.maps.Rectangle({
      map,
      bounds: place.viewport,
      strokeColor: "#d93025",
      strokeOpacity: 1,
      strokeWeight: 3,
      fillColor: "#d93025",
      fillOpacity: 0.035,
      clickable: false,
    });
  }
}

async function selectCity(placePrediction) {
  const place = placePrediction.toPlace();
  await place.fetchFields({
    fields: ["id", "displayName", "formattedAddress", "location", "viewport", "types"],
  });

  if (!place.location) throw new Error("Google Maps did not return this city's location.");

  showStoreSheet(null);
  drawCityBoundary(place);
  if (place.viewport) {
    state.map.fitBounds(place.viewport, {
      top: 150,
      right: 36,
      bottom: 48,
      left: 36,
    });
  } else {
    state.map.setCenter(place.location);
    state.map.setZoom(12);
  }
  setStatus("City selected", place.formattedAddress || place.displayName || "Selected city");
}

async function setupCitySearch() {
  const { PlaceAutocompleteElement } = await google.maps.importLibrary("places");
  const autocomplete = new PlaceAutocompleteElement();
  autocomplete.placeholder = "Search a city";
  autocomplete.includedRegionCodes = ["in"];
  autocomplete.includedPrimaryTypes = ["locality"];
  autocomplete.setAttribute("aria-label", "Search for a city in India");
  autocomplete.addEventListener("gmp-select", async ({ placePrediction }) => {
    try {
      await selectCity(placePrediction);
    } catch (error) {
      setStatus("City unavailable", error.message);
      showStatusCard(true);
    }
  });
  el.citySearchHost.replaceChildren(autocomplete);
  state.placeAutocomplete = autocomplete;
}

function showCitySearchFallback() {
  const fallback = document.createElement("input");
  fallback.className = "city-search-fallback";
  fallback.type = "search";
  fallback.placeholder = "City search unavailable";
  fallback.setAttribute("aria-label", "City search unavailable");
  fallback.disabled = true;
  el.citySearchHost.replaceChildren(fallback);
}

function createLocationNode() {
  const node = document.createElement("div");
  node.className = "user-location-marker";
  node.setAttribute("aria-label", "Your current location");
  return node;
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location is not supported by this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 30000,
    });
  });
}

async function showCurrentLocation() {
  el.locationButton.disabled = true;
  el.locationButton.classList.add("is-locating");

  try {
    const map = await ensureMap();
    const position = await getCurrentPosition();
    const location = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    };
    const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");

    clearCityBoundary();
    if (!state.locationMarker) {
      state.locationMarker = new AdvancedMarkerElement({
        map,
        position: location,
        title: "Your current location",
        content: createLocationNode(),
        zIndex: 2_000_000,
      });
    } else {
      state.locationMarker.position = location;
      state.locationMarker.map = map;
    }

    if (state.locationAccuracyCircle) state.locationAccuracyCircle.setMap(null);
    state.locationAccuracyCircle = new google.maps.Circle({
      map,
      center: location,
      radius: Math.max(20, position.coords.accuracy || 0),
      strokeColor: "#1a73e8",
      strokeOpacity: 0.42,
      strokeWeight: 1,
      fillColor: "#1a73e8",
      fillOpacity: 0.12,
      clickable: false,
    });

    map.panTo(location);
    map.setZoom(15);
    showStoreSheet(null);
    setStatus("Current location", "Showing your current position on the map.");
  } catch (error) {
    const locationMessages = {
      1: "Allow location access in your browser to use this button.",
      2: "Your current location is temporarily unavailable.",
      3: "Location took too long. Tap the button to try again.",
    };
    const message = locationMessages[error?.code]
      || error?.message
      || "Your current location could not be found.";
    setStatus("Location unavailable", message);
    showStatusCard(true);
  } finally {
    el.locationButton.disabled = false;
    el.locationButton.classList.remove("is-locating");
  }
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

  if (!state.selectedRegion) {
    google.maps.event.addListenerOnce(map, "idle", () => {
      const zoom = map.getZoom();
      if (Number.isFinite(zoom)) map.setZoom(zoom + 0.25);
    });
    map.fitBounds(INDIA_BOUNDS, {
      top: 82,
      right: 12,
      bottom: 18,
      left: 12,
    });
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
  el.regionFilter.replaceChildren(new Option(`All India (${stores.length})`, ""));
  regions.forEach(([region, count]) => {
    el.regionFilter.add(new Option(`${region} (${count})`, region));
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
  el.locationButton.addEventListener("click", showCurrentLocation);
  el.sheetClose.addEventListener("click", () => showStoreSheet(null));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !el.storeSheet.hidden) showStoreSheet(null);
  });
  el.regionFilter.addEventListener("change", async () => {
    state.selectedRegion = el.regionFilter.value;
    clearCityBoundary();
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
    try {
      await setupCitySearch();
    } catch (error) {
      console.warn("Google city autocomplete is unavailable.", error);
      showCitySearchFallback();
    }
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
