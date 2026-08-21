const state = {
  activeStores: [],
  areaClickListener: null,
  areaMode: false,
  areaPath: [],
  areaPolygon: null,
  areaSelectedIds: new Set(),
  cityBoundaryLayer: null,
  cityBoundaryRectangle: null,
  clusterer: null,
  config: null,
  filteredStores: [],
  initialViewApplied: false,
  locationAccuracyCircle: null,
  locationMarker: null,
  map: null,
  markers: [],
  placeAutocomplete: null,
  proximityCircle: null,
  proximityOrigin: null,
  proximityRadiusKm: null,
  proximityStoreIds: new Set(),
  selectedMarkerId: null,
  selectedRegion: "",
  selectedStoreId: null,
  sheetMode: "hidden",
  stores: [],
};

const INDIA_BOUNDS = {
  south: 6.4,
  west: 68,
  north: 37.6,
  east: 97.6,
};

const CLOSED_BUSINESS_STATUSES = new Set([
  "CLOSED_TEMPORARILY",
  "CLOSED_PERMANENTLY",
]);

const el = {
  addStoreButton: document.getElementById("add-store-button"),
  addStoreForm: document.getElementById("add-store-form"),
  addStoreView: document.getElementById("sheet-add-view"),
  areaButton: document.getElementById("area-button"),
  areaClearButton: document.getElementById("area-clear-button"),
  areaFinishButton: document.getElementById("area-finish-button"),
  areaList: document.getElementById("area-list"),
  areaPanel: document.getElementById("area-panel"),
  areaSummary: document.getElementById("area-summary"),
  citySearchHost: document.getElementById("city-search-host"),
  locationButton: document.getElementById("location-button"),
  map: document.getElementById("map"),
  mapHelperCard: document.getElementById("map-helper-card"),
  mapHelperText: document.getElementById("map-helper-text"),
  mapHelperTitle: document.getElementById("map-helper-title"),
  proximityList: document.getElementById("proximity-list"),
  proximityOriginLabel: document.getElementById("proximity-origin-label"),
  proximityPanel: document.getElementById("proximity-panel"),
  proximitySummary: document.getElementById("proximity-summary"),
  radiusOptions: document.getElementById("radius-options"),
  refreshButton: document.getElementById("refresh-button"),
  regionFilter: document.getElementById("region-filter"),
  sheetAddress: document.getElementById("sheet-address"),
  sheetClose: document.getElementById("sheet-close"),
  sheetCoordinates: document.getElementById("sheet-coordinates"),
  sheetFeedback: document.getElementById("sheet-feedback"),
  sheetKicker: document.getElementById("sheet-kicker"),
  sheetLink: document.getElementById("sheet-link"),
  sheetMeta: document.getElementById("sheet-meta"),
  sheetStoreView: document.getElementById("sheet-store-view"),
  sheetTitle: document.getElementById("sheet-title"),
  sqftForm: document.getElementById("sqft-form"),
  sqftInput: document.getElementById("sqft-input"),
  statusCard: document.getElementById("status-card"),
  statusDetail: document.getElementById("status-detail"),
  statusLabel: document.getElementById("status-label"),
  storeSearchInput: document.getElementById("store-search-input"),
  storeSearchResults: document.getElementById("store-search-results"),
  storeSheet: document.getElementById("store-sheet"),
};

let mapsLoaderPromise = null;

function setStatus(label, detail = "") {
  el.statusLabel.textContent = label;
  el.statusDetail.textContent = detail;
}

function setMapHelper(title, text) {
  if (!title || !text) {
    el.mapHelperCard.hidden = true;
    el.mapHelperTitle.textContent = "";
    el.mapHelperText.textContent = "";
    return;
  }
  el.mapHelperCard.hidden = false;
  el.mapHelperTitle.textContent = title;
  el.mapHelperText.textContent = text;
}

function showStatusCard(visible) {
  el.statusCard.hidden = !visible;
}

function setLoadingState(loading) {
  el.refreshButton.disabled = loading;
  el.regionFilter.disabled = loading;
}

function setSheetFeedback(message, isError = false) {
  if (!message) {
    el.sheetFeedback.hidden = true;
    el.sheetFeedback.textContent = "";
    el.sheetFeedback.dataset.tone = "";
    return;
  }
  el.sheetFeedback.hidden = false;
  el.sheetFeedback.textContent = message;
  el.sheetFeedback.dataset.tone = isError ? "error" : "success";
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

    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(state.config.googleMapsApiKey)}&loading=async&callback=${callbackName}&v=weekly&libraries=marker,places,geometry`;
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
    center: { lat: 22.9, lng: 79.1 },
    zoom: 5,
    mapId: state.config.googleMapsMapId || "DEMO_MAP_ID",
    fullscreenControl: false,
    mapTypeControl: false,
    streetViewControl: false,
    gestureHandling: "greedy",
    clickableIcons: false,
  });

  state.map.addListener("click", () => {
    if (!state.areaMode) return;
    showStoreSheet(null);
  });

  return state.map;
}

function getStoreKey(store) {
  return String(store.id ?? store.google_place_id ?? store.official_store_id);
}

function formatStoreNumber(store) {
  const number = Number(store.store_number);
  return Number.isFinite(number) ? String(number) : String(store.id ?? "");
}

function getStoreLocationName(name) {
  return String(name ?? "")
    .replace(/^Sangeetha\s+(?:Mobiles|Gadgets)\s*-\s*/i, "")
    .trim();
}

function formatSqft(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "Not set";
  return `${number.toLocaleString("en-IN")} sqft`;
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

function clearSearchResults() {
  el.storeSearchResults.hidden = true;
  el.storeSearchResults.replaceChildren();
}

function scoreStoreSearch(store, query) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return null;

  const storeNumber = formatStoreNumber(store);
  const name = getStoreLocationName(store.name).toLowerCase();
  const city = String(store.city || "").toLowerCase();
  const stateName = String(store.state || "").toLowerCase();

  if (/^\d+$/.test(normalizedQuery)) {
    if (storeNumber.startsWith(normalizedQuery)) {
      return Number(storeNumber === normalizedQuery ? 0 : 100 + Number(storeNumber));
    }
    return null;
  }

  if (name.startsWith(normalizedQuery)) return 1;
  if (name.includes(normalizedQuery)) return 2;
  if (city.startsWith(normalizedQuery)) return 3;
  if (stateName.startsWith(normalizedQuery)) return 4;
  if (`${storeNumber} ${name}`.includes(normalizedQuery)) return 5;
  return null;
}

function getSearchMatches(query) {
  return state.stores
    .map((store) => ({ store, score: scoreStoreSearch(store, query) }))
    .filter((entry) => entry.score !== null)
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score;
      return Number(left.store.store_number) - Number(right.store.store_number);
    })
    .slice(0, 8)
    .map((entry) => entry.store);
}

async function focusStoreFromSearch(store) {
  clearSearchResults();
  el.storeSearchInput.value = `#${formatStoreNumber(store)} ${getStoreLocationName(store.name)}`;
  state.selectedRegion = "";
  populateRegionFilter(state.stores);
  await applyRegionFilter();

  const coordinates = getStoreCoordinates(store);
  state.map.panTo(coordinates);
  state.map.setZoom(16);
  showStoreSheet(store);
  setStatus("Store selected", `Showing store #${formatStoreNumber(store)}.`);
}

function renderSearchResults(query) {
  const matches = getSearchMatches(query);
  el.storeSearchResults.replaceChildren();

  if (!matches.length) {
    clearSearchResults();
    return;
  }

  matches.forEach((store) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "store-search-option";

    const primary = document.createElement("span");
    primary.className = "store-search-primary";
    primary.textContent = `#${formatStoreNumber(store)} ${getStoreLocationName(store.name)}`;

    const secondary = document.createElement("span");
    secondary.className = "store-search-secondary";
    secondary.textContent = [store.city, store.state].filter(Boolean).join(", ") || "Store";

    option.append(primary, secondary);
    option.addEventListener("click", async () => {
      await focusStoreFromSearch(store);
    });
    el.storeSearchResults.appendChild(option);
  });

  el.storeSearchResults.hidden = false;
}

function setupStoreSearch() {
  el.storeSearchInput.addEventListener("input", () => {
    renderSearchResults(el.storeSearchInput.value);
  });

  el.storeSearchInput.addEventListener("focus", () => {
    renderSearchResults(el.storeSearchInput.value);
  });

  el.storeSearchInput.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    const matches = getSearchMatches(el.storeSearchInput.value);
    if (!matches.length) return;
    event.preventDefault();
    await focusStoreFromSearch(matches[0]);
  });

  document.addEventListener("click", (event) => {
    if (el.citySearchHost.contains(event.target)) return;
    clearSearchResults();
  });
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

function clearProximitySelection() {
  state.proximityOrigin = null;
  state.proximityRadiusKm = null;
  state.proximityStoreIds = new Set();
  if (state.proximityCircle) {
    state.proximityCircle.setMap(null);
    state.proximityCircle = null;
  }
}

function clearAreaSelection() {
  state.areaPath = [];
  state.areaSelectedIds = new Set();
  if (state.areaPolygon) {
    state.areaPolygon.setMap(null);
    state.areaPolygon = null;
  }
  if (state.areaClickListener) {
    google.maps.event.removeListener(state.areaClickListener);
    state.areaClickListener = null;
  }
  state.areaMode = false;
  el.areaFinishButton.hidden = true;
  el.areaClearButton.hidden = true;
  el.areaButton.classList.remove("is-active");
  setMapHelper("", "");
  updateMarkerStyles();
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
    state.proximityOrigin = {
      type: "location",
      label: "Your current location",
      latitude: location.lat,
      longitude: location.lng,
    };
    setStatus("Current location", "Pick a radius to find stores around you.");
    showSheetMode("location");
    renderProximitySelection();
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
    if (entry.marker) entry.marker.map = null;
  });
  state.markers = [];
}

function createPinNode(store, flags = {}) {
  const pin = document.createElement("button");
  pin.type = "button";
  pin.className = [
    "store-pin",
    flags.selected ? "is-selected" : "",
    flags.nearby ? "is-nearby" : "",
    flags.area ? "is-area-selected" : "",
  ].filter(Boolean).join(" ");
  pin.setAttribute("aria-label", `Store ${formatStoreNumber(store)}`);

  const number = document.createElement("span");
  number.className = "store-pin-number";
  number.textContent = formatStoreNumber(store);
  pin.appendChild(number);
  return pin;
}

function createClusterNode(count) {
  const cluster = document.createElement("div");
  cluster.className = "store-cluster";
  cluster.textContent = String(count);
  cluster.setAttribute("aria-label", `${count} stores`);
  return cluster;
}

function updateMarkerStyles() {
  state.markers.forEach((entry) => {
    const key = getStoreKey(entry.store);
    entry.marker.content = createPinNode(entry.store, {
      selected: key === state.selectedMarkerId,
      nearby: state.proximityStoreIds.has(key),
      area: state.areaSelectedIds.has(key),
    });
  });
}

function getStoreCoordinates(store) {
  return {
    lat: Number(store.latitude),
    lng: Number(store.longitude),
  };
}

function getRadiusOptions() {
  return [...el.radiusOptions.querySelectorAll("[data-radius-km]")];
}

function setActiveRadiusChip() {
  getRadiusOptions().forEach((button) => {
    button.classList.toggle(
      "is-active",
      Number(button.dataset.radiusKm) === state.proximityRadiusKm,
    );
  });
}

function renderStoreList(listEl, stores) {
  listEl.replaceChildren();
  stores.slice(0, 8).forEach((store) => {
    const item = document.createElement("li");
    item.textContent = `#${formatStoreNumber(store)} ${getStoreLocationName(store.name)}`;
    listEl.appendChild(item);
  });
}

function showSheetMode(mode) {
  state.sheetMode = mode || "hidden";
  const hidden = state.sheetMode === "hidden";
  el.storeSheet.hidden = hidden;
  el.sheetStoreView.hidden = state.sheetMode !== "store" && state.sheetMode !== "location";
  el.addStoreView.hidden = state.sheetMode !== "add";
  el.proximityPanel.hidden = state.sheetMode !== "store" && state.sheetMode !== "location";
  el.areaPanel.hidden = !state.areaSelectedIds.size;
  if (hidden) {
    setSheetFeedback("");
  }
}

function renderStoreSheet(store) {
  state.selectedStoreId = getStoreKey(store);
  state.selectedMarkerId = getStoreKey(store);
  state.proximityOrigin = {
    type: "store",
    label: `Store #${formatStoreNumber(store)}`,
    latitude: Number(store.latitude),
    longitude: Number(store.longitude),
  };

  el.sheetKicker.textContent = "Sangeetha Mobiles";
  el.sheetTitle.textContent = getStoreLocationName(store.name) || store.name || "Store";
  el.sheetMeta.textContent = `Store #${formatStoreNumber(store)} • ${store.state || "State unavailable"} • ${formatSqft(store.store_sqft)}`;
  el.sheetAddress.textContent = store.address || "Address unavailable";
  el.sheetCoordinates.textContent = `${Number(store.latitude).toFixed(6)}, ${Number(store.longitude).toFixed(6)}`;
  el.sheetLink.href = store.google_maps_uri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${store.latitude},${store.longitude}`)}`;
  el.sqftInput.value = store.store_sqft ? String(store.store_sqft) : "";
  setSheetFeedback("");
  renderProximitySelection();
  showSheetMode("store");
  updateMarkerStyles();
}

function renderLocationSheet() {
  state.selectedStoreId = null;
  state.selectedMarkerId = null;
  el.sheetKicker.textContent = "My Location";
  el.sheetTitle.textContent = "Your Current Position";
  el.sheetMeta.textContent = "Use a radius to see nearby Sangeetha stores.";
  el.sheetAddress.textContent = "";
  el.sheetCoordinates.textContent = state.proximityOrigin
    ? `${state.proximityOrigin.latitude.toFixed(6)}, ${state.proximityOrigin.longitude.toFixed(6)}`
    : "";
  el.sheetLink.href = state.proximityOrigin
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${state.proximityOrigin.latitude},${state.proximityOrigin.longitude}`)}`
    : "#";
  el.sqftInput.value = "";
  renderProximitySelection();
  showSheetMode("location");
  updateMarkerStyles();
}

function showStoreSheet(store) {
  if (!store) {
    state.selectedStoreId = null;
    state.selectedMarkerId = null;
    showSheetMode(null);
    updateMarkerStyles();
    return;
  }
  renderStoreSheet(store);
}

function showAddStoreSheet() {
  state.selectedStoreId = null;
  state.selectedMarkerId = null;
  setSheetFeedback("");
  el.addStoreForm.reset();
  showSheetMode("add");
  updateMarkerStyles();
}

function applyAreaSelection() {
  if (!state.areaPolygon) return;
  const polygon = state.areaPolygon;
  const selectedStores = state.filteredStores.filter((store) => {
    const latLng = new google.maps.LatLng(Number(store.latitude), Number(store.longitude));
    return google.maps.geometry.poly.containsLocation(latLng, polygon);
  });

  state.areaSelectedIds = new Set(selectedStores.map((store) => getStoreKey(store)));
  el.areaSummary.textContent = `${selectedStores.length} ${selectedStores.length === 1 ? "store" : "stores"} selected`;
  renderStoreList(el.areaList, selectedStores);
  showSheetMode(state.sheetMode === "add" ? "add" : (state.selectedStoreId ? "store" : "location"));
  el.areaPanel.hidden = !selectedStores.length;
  setMapHelper(
    "Area Selected",
    `${selectedStores.length} ${selectedStores.length === 1 ? "store is" : "stores are"} inside this boundary.`,
  );
  updateMarkerStyles();
}

function startAreaSelection() {
  clearCityBoundary();
  clearProximitySelection();
  clearAreaSelection();
  setStatus("Select area", "Tap around the map to draw a polygon, then finish the area.");
  setMapHelper(
    "Select Area",
    "Tap the map to drop boundary points. When the shape is ready, tap Finish Area.",
  );
  el.areaButton.classList.add("is-active");
  el.areaFinishButton.hidden = false;
  el.areaClearButton.hidden = false;
  state.areaMode = true;

  state.areaClickListener = state.map.addListener("click", (event) => {
    if (!event.latLng) return;
    state.areaPath.push({
      lat: event.latLng.lat(),
      lng: event.latLng.lng(),
    });

    if (!state.areaPolygon) {
      state.areaPolygon = new google.maps.Polygon({
        map: state.map,
        paths: state.areaPath,
        strokeColor: "#d93025",
        strokeOpacity: 0.95,
        strokeWeight: 3,
        fillColor: "#d93025",
        fillOpacity: 0.12,
      });
    } else {
      state.areaPolygon.setPaths(state.areaPath);
    }

    setMapHelper(
      "Select Area",
      `${state.areaPath.length} point${state.areaPath.length === 1 ? "" : "s"} added. Tap more points or tap Finish Area.`,
    );
  });
}

function finishAreaSelection() {
  if (state.areaPath.length < 3 || !state.areaPolygon) {
    setStatus("Area incomplete", "Add at least three points to finish the selection.");
    showStatusCard(true);
    setMapHelper("Area Incomplete", "Add at least 3 boundary points, then tap Finish Area.");
    return;
  }
  if (state.areaClickListener) {
    google.maps.event.removeListener(state.areaClickListener);
    state.areaClickListener = null;
  }
  state.areaMode = false;
  el.areaButton.classList.remove("is-active");
  applyAreaSelection();
}

function clearInteractiveSelections() {
  clearCityBoundary();
  clearProximitySelection();
  clearAreaSelection();
  el.areaPanel.hidden = true;
  el.proximityPanel.hidden = state.sheetMode === "hidden";
  updateMarkerStyles();
}

function renderProximitySelection() {
  if (!state.proximityOrigin) {
    el.proximitySummary.textContent = "Pick 1 km, 3 km, 5 km, or 10 km.";
    el.proximityOriginLabel.textContent = "";
    el.proximityList.replaceChildren();
    setActiveRadiusChip();
    return;
  }

  el.proximityOriginLabel.textContent = state.proximityOrigin.label;
  if (!state.proximityRadiusKm) {
    el.proximitySummary.textContent = "Pick 1 km, 3 km, 5 km, or 10 km.";
    el.proximityList.replaceChildren();
    setActiveRadiusChip();
    return;
  }

  const nearbyStores = state.filteredStores.filter((store) => state.proximityStoreIds.has(getStoreKey(store)));
  el.proximitySummary.textContent = `${nearbyStores.length} ${nearbyStores.length === 1 ? "store" : "stores"} within ${state.proximityRadiusKm} km`;
  renderStoreList(el.proximityList, nearbyStores);
  setActiveRadiusChip();
}

function applyProximityRadius(radiusKm) {
  if (!state.proximityOrigin) return;
  state.proximityRadiusKm = radiusKm;

  const origin = new google.maps.LatLng(
    state.proximityOrigin.latitude,
    state.proximityOrigin.longitude,
  );
  const nearbyIds = state.filteredStores
    .filter((store) => {
      const latLng = new google.maps.LatLng(Number(store.latitude), Number(store.longitude));
      const distanceMeters = google.maps.geometry.spherical.computeDistanceBetween(origin, latLng);
      return distanceMeters <= (radiusKm * 1000);
    })
    .map((store) => getStoreKey(store));

  state.proximityStoreIds = new Set(nearbyIds);

  if (state.proximityCircle) state.proximityCircle.setMap(null);
  state.proximityCircle = new google.maps.Circle({
    map: state.map,
    center: {
      lat: state.proximityOrigin.latitude,
      lng: state.proximityOrigin.longitude,
    },
    radius: radiusKm * 1000,
    strokeColor: "#1f5eff",
    strokeOpacity: 0.8,
    strokeWeight: 2,
    fillColor: "#1f5eff",
    fillOpacity: 0.09,
    clickable: false,
  });

  renderProximitySelection();
  updateMarkerStyles();
}

async function renderMarkers(stores) {
  const map = await ensureMap();
  const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
  const bounds = new google.maps.LatLngBounds();

  clearMarkers();

  stores.forEach((store) => {
    const latitude = Number(store.latitude);
    const longitude = Number(store.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

    const marker = new AdvancedMarkerElement({
      position: { lat: latitude, lng: longitude },
      title: `${store.name} (#${formatStoreNumber(store)})`,
      gmpClickable: true,
      content: createPinNode(store),
    });

    marker.addEventListener("gmp-click", () => {
      if (state.areaMode) return;
      showStoreSheet(store);
      map.panTo({ lat: latitude, lng: longitude });
    });

    state.markers.push({ marker, store });
    bounds.extend({ lat: latitude, lng: longitude });
  });

  if (state.markers.length > 30) {
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
    setStatus("No stores found", "Run an import to populate the map.");
    showStatusCard(true);
    return;
  }

  if (!state.selectedRegion) {
    map.fitBounds(INDIA_BOUNDS, {
      top: 120,
      right: 16,
      bottom: 22,
      left: 16,
    });
    return;
  }

  if (state.markers.length === 1) {
    map.setCenter(bounds.getCenter());
    map.setZoom(15);
    return;
  }
  map.fitBounds(bounds, 72);
}

function getRegionCounts(stores) {
  return stores.reduce((counts, store) => {
    const region = String(store.state || "Unknown").trim();
    counts.set(region, (counts.get(region) || 0) + 1);
    return counts;
  }, new Map());
}

function isCurrentLocatorStore(store) {
  if (store.data_source === "manual") return true;
  return (
    store.verification_status !== "google_directory_only"
    && !CLOSED_BUSINESS_STATUSES.has(store.business_status)
  );
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
  state.filteredStores = state.selectedRegion
    ? state.stores.filter((store) => store.state === state.selectedRegion)
    : state.stores.slice();

  clearInteractiveSelections();
  if (state.sheetMode !== "add") showStoreSheet(null);

  setStatus(
    state.selectedRegion ? `${state.selectedRegion} stores` : "Official locator coverage",
    state.selectedRegion
      ? `${state.filteredStores.length} stores currently visible in ${state.selectedRegion}.`
      : `${state.stores.length} stores across ${getRegionCounts(state.stores).size} states or territories.`,
  );

  await renderMarkers(state.filteredStores);
}

async function loadStores() {
  setStatus("Loading stores", "Reading cached store coordinates from Supabase.");
  showStatusCard(true);

  const payload = await fetchJson("/api/sangeetha-stores");
  const stores = Array.isArray(payload.stores) ? payload.stores : [];
  state.stores = stores.filter(isCurrentLocatorStore);
  state.activeStores = state.stores.slice();
  if (!state.initialViewApplied) {
    state.selectedRegion = "";
    state.initialViewApplied = true;
  }
  populateRegionFilter(state.stores);
  await applyRegionFilter();
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

async function saveStoreSqft(event) {
  event.preventDefault();
  if (!state.selectedStoreId) return;

  const store = state.stores.find((entry) => getStoreKey(entry) === state.selectedStoreId);
  if (!store) return;

  try {
    const payload = await fetchJson("/api/sangeetha-stores", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: store.id,
        storeSqft: el.sqftInput.value,
      }),
    });
    const nextStore = payload.store;
    state.stores = state.stores.map((entry) => (entry.id === nextStore.id ? nextStore : entry));
    setSheetFeedback(`Store #${formatStoreNumber(nextStore)} sqft saved.`);
    renderStoreSheet(nextStore);
  } catch (error) {
    setSheetFeedback(error.message, true);
  }
}

async function createManualStore(event) {
  event.preventDefault();

  try {
    const payload = await fetchJson("/api/sangeetha-stores", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: document.getElementById("add-store-name").value,
        latitude: document.getElementById("add-store-latitude").value,
        longitude: document.getElementById("add-store-longitude").value,
        address: document.getElementById("add-store-address").value,
        city: document.getElementById("add-store-city").value,
        state: document.getElementById("add-store-state").value,
        storeSqft: document.getElementById("add-store-sqft").value,
      }),
    });
    const nextStore = payload.store;
    setSheetFeedback(`Store #${formatStoreNumber(nextStore)} created.`);
    await loadStores();
    state.selectedRegion = state.selectedRegion && nextStore.state === state.selectedRegion
      ? state.selectedRegion
      : "";
    populateRegionFilter(state.stores);
    await applyRegionFilter();
    showStoreSheet(nextStore);
  } catch (error) {
    setSheetFeedback(error.message, true);
  }
}

function bindEvents() {
  el.refreshButton.addEventListener("click", refreshStores);
  el.locationButton.addEventListener("click", showCurrentLocation);
  el.sheetClose.addEventListener("click", () => showStoreSheet(null));
  el.regionFilter.addEventListener("change", async () => {
    state.selectedRegion = el.regionFilter.value;
    try {
      await applyRegionFilter();
    } catch (error) {
      setStatus("Region unavailable", error.message);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (state.areaMode) {
        clearAreaSelection();
      }
      if (!el.storeSheet.hidden) {
        showStoreSheet(null);
      }
    }
  });
  el.addStoreButton.addEventListener("click", showAddStoreSheet);
  el.areaButton.addEventListener("click", () => {
    if (state.areaMode) {
      clearAreaSelection();
      return;
    }
    startAreaSelection();
  });
  el.areaFinishButton.addEventListener("click", finishAreaSelection);
  el.areaClearButton.addEventListener("click", () => {
    clearAreaSelection();
    el.areaPanel.hidden = true;
  });
  el.sqftForm.addEventListener("submit", saveStoreSqft);
  el.addStoreForm.addEventListener("submit", createManualStore);
  getRadiusOptions().forEach((button) => {
    button.addEventListener("click", () => {
      if (!state.proximityOrigin) return;
      applyProximityRadius(Number(button.dataset.radiusKm));
    });
  });
}

async function init() {
  bindEvents();
  setLoadingState(true);

  try {
    await loadRuntimeConfig();
    await ensureMap();
    setupStoreSearch();
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
