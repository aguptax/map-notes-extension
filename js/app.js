// Main map application logic — state-based, local-first, optional Drive sync

let map;
let markers = {};
let data = { version: 2, selectedState: null, places: [] };
let selectedStateId = null;
let selectedPlaceId = null;
let saving = false;
let driveConnected = false;

// GeoJSON layers
let indiaGeoJSON = null;
let allStatesLayer = null;
let highlightedStateLayer = null;
let searchMarkersLayer = null;
let searchResults = [];

// Current sidebar level: 'states' | 'places' | 'detail'
let sidebarLevel = "states";

// Measure tool state
let measureMode = false;
let measurePoints = [];
let measurePolyline = null;
let measurePolygon = null;
let measureMarkers = [];
let measureLabels = [];
let measureGuideLine = null;

// --- Local Storage ---
async function loadLocal() {
  const stored = await chrome.storage.local.get("mapnotes_data");
  if (stored.mapnotes_data) {
    return stored.mapnotes_data;
  }
  return { version: 2, selectedState: null, places: [] };
}

async function saveLocal(d) {
  await chrome.storage.local.set({ mapnotes_data: d });
}

// --- Data Migration (v1 → v2) ---
function migrateData(d) {
  if (!d.version || d.version < 2) {
    d.version = 2;
    if (!d.selectedState) d.selectedState = null;

    for (const place of d.places) {
      if (!place.stateId) {
        // Auto-detect state from coordinates using GeoJSON
        if (indiaGeoJSON) {
          place.stateId =
            findStateForPoint(place.lat, place.lng, indiaGeoJSON) || "unknown";
        } else {
          place.stateId = "unknown";
        }
      }
    }
  }
  return d;
}

// --- Init ---
async function init() {
  await initMap();

  // Always load from local storage first
  data = await loadLocal();

  // Check if Drive is connected, try to sync
  driveConnected = await Auth.isSignedIn();
  if (driveConnected) {
    try {
      const driveData = await Drive.loadData();
      if (driveData.places && driveData.places.length > 0) {
        data = driveData;
        await saveLocal(data);
      } else if (data.places.length > 0) {
        await Drive.saveData(data);
      }
      showToast("Synced with Google Drive");
    } catch (err) {
      console.error("Drive sync failed, using local data:", err);
      showToast("Using local data (Drive sync failed)");
    }
  }

  // Migrate data to v2 (adds stateId to places)
  data = migrateData(data);
  await saveLocal(data);

  // Render initial UI
  updateDriveBanner();

  // Restore previously selected state
  if (data.selectedState) {
    selectState(data.selectedState);
  } else {
    renderStateList();
    showToast("Select a state to begin");
  }
}

// --- Map Setup ---
async function initMap() {
  map = L.map("map", {
    center: [22.5, 82.5], // India center
    zoom: 5,
    zoomControl: true,
    attributionControl: false,
  });

  // Tile layers: Roadmap + Satellite
  const roadmap = L.tileLayer(
    "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
    { attribution: "&copy; Google Maps", maxZoom: 20 }
  );
  const satellite = L.tileLayer(
    "https://mt1.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}",
    { attribution: "&copy; Google Maps", maxZoom: 20 }
  );
  roadmap.addTo(map);
  L.control
    .layers({ Roadmap: roadmap, Satellite: satellite }, null, {
      position: "topright",
    })
    .addTo(map);

  // Load India GeoJSON
  try {
    const res = await fetch(chrome.runtime.getURL("data/india-states.geojson"));
    indiaGeoJSON = await res.json();
  } catch (err) {
    console.error("Failed to load India GeoJSON:", err);
    return;
  }

  // All states layer — subtle borders, clickable
  allStatesLayer = L.geoJSON(indiaGeoJSON, {
    style: {
      color: "#1a73e8",
      weight: 1.5,
      fillOpacity: 0.03,
      fillColor: "#1a73e8",
    },
    onEachFeature: (feature, layer) => {
      // Tooltip with state name
      layer.bindTooltip(feature.properties.name, {
        sticky: true,
        className: "state-tooltip",
      });
      layer.on("click", (e) => {
        // If this state is already selected, let the click propagate
        // to the map handler so nearby search / add-place popup works
        if (selectedStateId === feature.properties.stateId) return;
        L.DomEvent.stopPropagation(e);
        selectState(feature.properties.stateId);
      });
    },
  }).addTo(map);

  // Highlighted state layer (initially empty)
  highlightedStateLayer = L.geoJSON(null, {
    style: {
      color: "#1a73e8",
      weight: 2.5,
      fillOpacity: 0.1,
      fillColor: "#1a73e8",
    },
  }).addTo(map);

  // Search result markers (temporary, shown during search)
  searchMarkersLayer = L.layerGroup().addTo(map);

  // Event delegation for all popup buttons — works regardless of when content is set
  document.addEventListener("click", (e) => {
    const nearbyBtn = e.target.closest(".popup-nearby-add-btn");
    if (nearbyBtn) {
      const lat = parseFloat(nearbyBtn.dataset.lat);
      const lng = parseFloat(nearbyBtn.dataset.lng);
      const sid = nearbyBtn.dataset.state;
      const name = nearbyBtn.dataset.name;
      const address = nearbyBtn.dataset.address;
      map.closePopup();
      addNewPlace(lat, lng, sid, name, address);
      return;
    }
    const confirmBtn = e.target.closest(".popup-confirm-place-btn");
    if (confirmBtn) {
      const lat = parseFloat(confirmBtn.dataset.lat);
      const lng = parseFloat(confirmBtn.dataset.lng);
      const sid = confirmBtn.dataset.state;
      map.closePopup();
      addNewPlace(lat, lng, sid);
      return;
    }
    const addBtn = e.target.closest(".popup-add-place-btn");
    if (addBtn) {
      addPlaceFromSearch(parseInt(addBtn.dataset.index));
      return;
    }
  });

  // Load photos when search marker popups open
  map.on("popupopen", (e) => {
    setTimeout(() => {
      const container = e.popup.getElement();
      if (!container) return;
      const addBtn = container.querySelector(".popup-add-place-btn");
      if (!addBtn) return;
      const idx = parseInt(addBtn.dataset.index);
      if (searchResults[idx] && searchResults[idx].photoRef) {
        loadPhotoIntoElement(`popup-photo-${idx}`, searchResults[idx].photoRef, 140, e.popup);
      }
    }, 50);
  });

  // Adjust highlight opacity based on zoom — fade fill as user zooms in
  map.on("zoomend", () => {
    if (!highlightedStateLayer) return;
    const zoom = map.getZoom();
    // zoom 5 = full opacity (0.1), zoom 10+ = no fill, just border
    let fillOpacity = 0;
    let weight = 2.5;
    if (zoom <= 6) {
      fillOpacity = 0.1;
      weight = 2.5;
    } else if (zoom <= 8) {
      fillOpacity = 0.05;
      weight = 2;
    } else if (zoom <= 10) {
      fillOpacity = 0.02;
      weight = 1.5;
    } else {
      fillOpacity = 0;
      weight = 1;
    }
    highlightedStateLayer.setStyle({
      fillOpacity: fillOpacity,
      weight: weight,
    });
  });

  // Show "Search this area" button when user pans/zooms with active search
  map.on("moveend", () => {
    if (lastSearchQuery && sidebarLevel === "places" && searchResults.length > 0) {
      showSearchAreaButton();
    }
  });

  // Measure tool control
  const MeasureControl = L.Control.extend({
    options: { position: "topleft" },
    onAdd: function () {
      const container = L.DomUtil.create("div", "leaflet-bar measure-control");
      const btn = L.DomUtil.create("a", "", container);
      btn.id = "measure-btn";
      btn.href = "#";
      btn.title = "Measure distance & area";
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0z"/><line x1="14.5" y1="12.5" x2="11" y2="16"/><line x1="11.5" y1="9.5" x2="8" y2="13"/><line x1="8.5" y1="6.5" x2="5" y2="10"/></svg>`;
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(btn, "click", (e) => {
        L.DomEvent.preventDefault(e);
        toggleMeasureMode();
      });
      return container;
    },
  });
  new MeasureControl().addTo(map);

  // Measure tool: rubber band guide line
  map.on("mousemove", (e) => {
    if (!measureMode || measurePoints.length === 0) {
      if (measureGuideLine) {
        map.removeLayer(measureGuideLine);
        measureGuideLine = null;
      }
      return;
    }
    const lastPoint = measurePoints[measurePoints.length - 1];
    if (measureGuideLine) map.removeLayer(measureGuideLine);
    measureGuideLine = L.polyline([lastPoint, e.latlng], {
      color: "#1a73e8",
      weight: 2,
      dashArray: "4, 8",
      opacity: 0.5,
    }).addTo(map);

    // Live-update the measure info panel as cursor moves
    updateMeasureInfo(e.latlng);
  });

  // Map click handler
  map.on("click", (e) => {
    // Measure mode intercepts all map clicks
    if (measureMode) {
      addMeasurePoint(e.latlng);
      return;
    }
    if (!selectedStateId) {
      // No state selected — try to find which state was clicked
      const stateId = findStateForPoint(
        e.latlng.lat,
        e.latlng.lng,
        indiaGeoJSON
      );
      if (stateId) {
        selectState(stateId);
      } else {
        showToast("Click on a state to begin");
      }
      return;
    }

    // State is selected — check if click is inside it
    if (isPointInState(e.latlng.lat, e.latlng.lng, selectedStateId, indiaGeoJSON)) {
      const lat = e.latlng.lat;
      const lng = e.latlng.lng;
      const sid = selectedStateId;

      // Show loading popup immediately
      const popup = L.popup({ maxWidth: 320 })
        .setLatLng(e.latlng)
        .setContent(
          `<div style="text-align:center;min-width:140px;font-family:Roboto,sans-serif;">
            <small style="color:#80868b;">Searching nearby places...</small>
          </div>`
        )
        .openOn(map);

      // Nearby search (async)
      handleMapClickNearby(lat, lng, sid, popup);
    } else {
      showToast("Click inside the selected state to add a place");
    }
  });
}

// --- Nearby Search on Map Click ---
async function handleMapClickNearby(lat, lng, stateId, popup) {
  let nearbyResults = [];
  try {
    if (driveConnected) {
      nearbyResults = await searchNearbyGoogle(lat, lng);
    }
    if (nearbyResults.length === 0) {
      const rev = await reverseGeocodeNominatim(lat, lng);
      if (rev) nearbyResults = [rev];
    }
  } catch (err) {
    console.warn("Nearby search failed:", err);
  }

  // Build popup content
  let html = `<div style="min-width:200px;max-width:300px;font-family:Roboto,sans-serif;">`;

  if (nearbyResults.length > 0) {
    // Store results so popup buttons can reference them
    nearbyClickResults = nearbyResults;

    nearbyResults.forEach((r, i) => {
      if (i > 0) html += `<hr style="border:none;border-top:1px solid #dadce0;margin:8px 0;" />`;

      // Photo placeholder
      if (r.photoRef) {
        html += `<div id="click-photo-${i}" style="width:100%;height:120px;background:#f1f3f4;border-radius:6px;margin-bottom:6px;overflow:hidden;display:flex;align-items:center;justify-content:center;">
          <span style="color:#80868b;font-size:11px;">Loading...</span>
        </div>`;
      }

      html += `<strong style="font-size:13px;color:#202124;">${escapeHtml(r.name)}</strong>`;

      if (r.rating) {
        const stars = "\u2605".repeat(Math.round(r.rating)) + "\u2606".repeat(5 - Math.round(r.rating));
        html += `<div style="font-size:11px;color:#fbbc04;">${stars} <span style="color:#5f6368;">${r.rating} (${r.ratingCount || 0})</span></div>`;
      }
      if (r.address) {
        html += `<div style="font-size:11px;color:#5f6368;margin:2px 0;">${escapeHtml(r.address)}</div>`;
      }
      if (r.openNow !== undefined) {
        html += `<div style="font-size:11px;font-weight:500;color:${r.openNow ? "#34a853" : "#ea4335"};">${r.openNow ? "Open" : "Closed"}</div>`;
      }
      if (r.phone) {
        html += `<div style="font-size:11px;"><a href="tel:${escapeHtml(r.phone)}" style="color:#1a73e8;text-decoration:none;">${escapeHtml(r.phone)}</a></div>`;
      }
      if (r.website) {
        const domain = r.website.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
        html += `<div style="font-size:11px;"><a href="${escapeHtml(r.website)}" target="_blank" rel="noopener" style="color:#1a73e8;text-decoration:none;">${escapeHtml(domain)}</a></div>`;
      }
      if (r.hours && r.hours.length > 0) {
        html += `<details style="font-size:10px;color:#5f6368;margin:2px 0;">
          <summary style="cursor:pointer;color:#1a73e8;">Hours</summary>
          <div style="line-height:1.5;">`;
        r.hours.forEach((h) => { html += `${escapeHtml(h)}<br/>`; });
        html += `</div></details>`;
      }

      // Add this place + Maps buttons
      const placeLat = r.lat || lat;
      const placeLng = r.lng || lng;
      const mapsUrl = r.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
      html += `<div style="display:flex;gap:6px;margin-top:6px;">
        <button class="popup-nearby-add-btn" data-nearby-index="${i}" data-lat="${placeLat}" data-lng="${placeLng}" data-state="${stateId}" data-name="${escapeHtml(r.name)}" data-address="${escapeHtml(r.address || "")}"
          style="flex:1;padding:5px 12px;background:#1a73e8;color:white;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:500;">
          + Add "${escapeHtml(r.name)}"
        </button>
        <a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener"
          style="padding:5px 10px;background:#f1f3f4;color:#202124;border:1px solid #dadce0;border-radius:4px;font-size:11px;font-weight:500;text-decoration:none;display:flex;align-items:center;">
          Maps
        </a>
      </div>`;
    });

    html += `<hr style="border:none;border-top:1px solid #dadce0;margin:8px 0;" />`;
  }

  // Always show "Add custom place" option
  html += `<div style="text-align:center;">
    <small style="color:#80868b;">${lat.toFixed(5)}, ${lng.toFixed(5)}</small><br/>
    <button class="popup-confirm-place-btn" data-lat="${lat}" data-lng="${lng}" data-state="${stateId}"
      style="margin-top:6px;padding:6px 14px;background:#f1f3f4;color:#202124;border:1px solid #dadce0;border-radius:4px;cursor:pointer;font-size:12px;">
      + Add Custom Place
    </button>
  </div>`;
  html += `</div>`;

  popup.setContent(html);
  popup.update();

  // Load photos after DOM settles
  setTimeout(() => {
    nearbyResults.forEach((r, i) => {
      loadPhotoIntoElement(`click-photo-${i}`, r.photoRef, 120, popup);
    });
  }, 50);
}

// Global for nearby click results (used by event delegation)
let nearbyClickResults = [];

// --- State Selection ---
function onStateClick(stateId) {
  if (selectedStateId === stateId) return;
  selectState(stateId);
}

function selectState(stateId) {
  selectedStateId = stateId;
  data.selectedState = stateId;

  // Highlight the state on map
  highlightedStateLayer.clearLayers();
  const feature = indiaGeoJSON.features.find(
    (f) => f.properties.stateId === stateId
  );
  if (feature) {
    highlightedStateLayer.addData(feature);
    map.fitBounds(highlightedStateLayer.getBounds(), { padding: [20, 20] });
  }

  clearSearchMarkers();

  // Update sidebar
  updateSidebarLevel("places");
  renderPlaceList();
  renderAllMarkers();

  // Save selected state
  saveData();
}

function deselectState() {
  selectedStateId = null;
  selectedPlaceId = null;
  data.selectedState = null;

  // Clear map highlight and markers
  highlightedStateLayer.clearLayers();
  clearAllMarkers();
  clearSearchMarkers();

  // Reset zoom to India
  map.flyTo([22.5, 82.5], 5);

  // Show state list
  updateSidebarLevel("states");
  renderStateList();

  saveData();
}

// --- Sidebar Level Manager ---
function updateSidebarLevel(level) {
  sidebarLevel = level;
  const stateList = document.getElementById("state-list");
  const stateHeader = document.getElementById("state-header");
  const placeList = document.getElementById("place-list");
  const placeDetail = document.getElementById("place-detail");
  const searchInput = document.getElementById("search-input");

  const scannerPanel = document.getElementById("scanner-panel");

  stateList.classList.toggle("hidden", level !== "states");
  stateHeader.classList.toggle("hidden", level === "states");
  placeList.classList.toggle("hidden", level !== "places");
  placeDetail.classList.toggle("hidden", level !== "detail");
  scannerPanel.classList.toggle("hidden", level !== "scanner");

  // Update search placeholder
  if (level === "states") {
    searchInput.placeholder = "Search states...";
  } else if (level === "places") {
    searchInput.placeholder =
      "Search places in " + getStateName(selectedStateId) + "...";
  }

  // Clear search on level change
  searchInput.value = "";

  // Update state header
  if (level !== "states" && selectedStateId) {
    document.getElementById("selected-state-name").textContent =
      getStateName(selectedStateId);
    const count = data.places.filter(
      (p) => p.stateId === selectedStateId
    ).length;
    document.getElementById("state-place-count").textContent =
      count + " place" + (count !== 1 ? "s" : "");
  }
}

// --- Data Operations ---
let pendingSave = false;
async function saveData() {
  if (saving) {
    pendingSave = true;
    return;
  }
  saving = true;
  try {
    await saveLocal(data);
    if (driveConnected) {
      await Drive.saveData(data);
    }
  } catch (err) {
    console.error("Failed to save:", err);
    showToast("Save failed — check connection");
  }
  saving = false;
  if (pendingSave) {
    pendingSave = false;
    saveData();
  }
}

// --- Places ---
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function addNewPlace(lat, lng, stateId, title, address) {
  const place = {
    id: generateId(),
    stateId: stateId,
    title: title || "New Place",
    address: address || "",
    lat,
    lng,
    color: "#ea4335",
    notes: "",
    attachments: [],
    createdAt: new Date().toISOString(),
  };
  data.places.push(place);
  renderPlaceList();
  addMarker(place);
  openPlaceDetail(place.id);
  saveData();
}

function deletePlace(id) {
  const place = data.places.find((p) => p.id === id);
  if (!place) return;

  // Delete attachments from Drive if connected
  if (driveConnected) {
    place.attachments.forEach((att) => {
      if (att.driveId) Drive.deleteAttachment(att.driveId).catch(() => {});
    });
  }

  data.places = data.places.filter((p) => p.id !== id);

  if (markers[id]) {
    map.removeLayer(markers[id]);
    delete markers[id];
  }

  closePlaceDetail();
  renderPlaceList();
  saveData();
  showToast("Place deleted");
}

// --- Markers ---
function createMarkerIcon(color) {
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="
      background: ${color};
      width: 24px; height: 24px;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      border: 2px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    "></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 24],
  });
}

function addMarker(place) {
  if (markers[place.id]) map.removeLayer(markers[place.id]);

  const marker = L.marker([place.lat, place.lng], {
    icon: createMarkerIcon(place.color),
    draggable: true,
  });

  marker.bindTooltip(place.title, { direction: "top", offset: [0, -24] });

  marker.on("click", (e) => {
    L.DomEvent.stopPropagation(e);
    openPlaceDetail(place.id);
  });

  marker.on("dragend", (e) => {
    const pos = e.target.getLatLng();
    place.lat = pos.lat;
    place.lng = pos.lng;
    if (selectedPlaceId === place.id) {
      document.getElementById("place-coords").textContent =
        `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
    }
    saveData();
  });

  marker.addTo(map);
  markers[place.id] = marker;
}

function renderAllMarkers() {
  clearAllMarkers();
  if (!selectedStateId) return;

  data.places
    .filter((p) => p.stateId === selectedStateId)
    .forEach((place) => addMarker(place));
}

function clearAllMarkers() {
  Object.values(markers).forEach((m) => map.removeLayer(m));
  markers = {};
}

// --- Search Markers (temporary, shown on map during search) ---
function clearSearchMarkers() {
  if (searchMarkersLayer) searchMarkersLayer.clearLayers();
  searchResults = [];
  hideSearchAreaButton();
}

function showSearchAreaButton() {
  if (searchAreaControl) return;
  const Control = L.Control.extend({
    options: { position: "topright" },
    onAdd: function () {
      const div = L.DomUtil.create("div", "search-area-control");
      div.innerHTML = `<button class="search-area-btn">Search this area</button>`;
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.on(div.querySelector("button"), "click", () => {
        hideSearchAreaButton();
        if (lastSearchQuery && sidebarLevel === "places") {
          searchAreaTriggered = true;
          showToast("Searching this area...");
          renderSearchDropdown(lastSearchQuery);
        }
      });
      return div;
    },
  });
  searchAreaControl = new Control();
  searchAreaControl.addTo(map);
}

function hideSearchAreaButton() {
  if (searchAreaControl) {
    map.removeControl(searchAreaControl);
    searchAreaControl = null;
  }
}

// Fetch a Google Places photo URL (needed because <img src> can't use auth headers)
async function fetchPlacePhoto(photoRef, maxWidth) {
  if (!photoRef) return null;
  try {
    const token = await Auth.getToken(false);
    if (!token) return null;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const url = `https://places.googleapis.com/v1/${photoRef}/media?maxWidthPx=${maxWidth || 400}&skipHttpRedirect=true`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const d = await res.json();
    return d.photoUri || null;
  } catch (err) {
    return null;
  }
}

// Helper: load a photo into a placeholder element, remove placeholder on failure
function loadPhotoIntoElement(elementId, photoRef, height, popup) {
  if (!photoRef) {
    const el = document.getElementById(elementId);
    if (el) el.remove();
    return;
  }
  // Fallback: remove after 10s if still loading
  const fallback = setTimeout(() => {
    const el = document.getElementById(elementId);
    if (el && !el.querySelector("img")) el.remove();
  }, 10000);

  fetchPlacePhoto(photoRef, 400)
    .then((photoUrl) => {
      clearTimeout(fallback);
      const el = document.getElementById(elementId);
      if (!el) return;
      if (photoUrl) {
        const img = document.createElement("img");
        img.src = photoUrl;
        img.style.cssText = `width:100%;height:${height}px;object-fit:cover;border-radius:6px;`;
        img.onerror = () => { el.remove(); if (popup && popup.isOpen()) popup.update(); };
        el.innerHTML = "";
        el.appendChild(img);
      } else {
        el.remove();
      }
      if (popup && popup.isOpen()) popup.update();
    })
    .catch(() => {
      clearTimeout(fallback);
      const el = document.getElementById(elementId);
      if (el) el.remove();
      if (popup && popup.isOpen()) popup.update();
    });
}

function buildPlacePopupHtml(r, index) {
  let html = `<div style="min-width:200px;max-width:280px;font-family:Roboto,sans-serif;">`;

  // Photo placeholder (loaded async)
  if (r.photoRef) {
    html += `<div id="popup-photo-${index}" style="width:100%;height:140px;background:#f1f3f4;border-radius:6px;margin-bottom:8px;overflow:hidden;display:flex;align-items:center;justify-content:center;">
      <span style="color:#80868b;font-size:12px;">Loading photo...</span>
    </div>`;
  }

  html += `<strong style="font-size:14px;color:#202124;">${escapeHtml(r.name)}</strong>`;

  // Rating
  if (r.rating) {
    const stars = "\u2605".repeat(Math.round(r.rating)) + "\u2606".repeat(5 - Math.round(r.rating));
    html += `<div style="margin:4px 0 2px;font-size:12px;color:#fbbc04;">
      ${stars} <span style="color:#5f6368;">${r.rating} (${r.ratingCount})</span>
    </div>`;
  }

  // Address
  if (r.address) {
    html += `<div style="font-size:12px;color:#5f6368;margin:2px 0;">${escapeHtml(r.address)}</div>`;
  }

  // Open/Closed status
  if (r.openNow !== undefined) {
    const statusText = r.openNow ? "Open now" : "Closed";
    const statusColor = r.openNow ? "#34a853" : "#ea4335";
    html += `<div style="font-size:12px;font-weight:500;color:${statusColor};margin:4px 0;">${statusText}</div>`;
  }

  // Phone
  if (r.phone) {
    html += `<div style="font-size:12px;margin:2px 0;">
      <span style="color:#5f6368;">Phone:</span>
      <a href="tel:${escapeHtml(r.phone)}" style="color:#1a73e8;text-decoration:none;">${escapeHtml(r.phone)}</a>
    </div>`;
  }

  // Website
  if (r.website) {
    const domain = r.website.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    html += `<div style="font-size:12px;margin:2px 0;">
      <a href="${escapeHtml(r.website)}" target="_blank" rel="noopener" style="color:#1a73e8;text-decoration:none;">${escapeHtml(domain)}</a>
    </div>`;
  }

  // Opening hours (collapsible)
  if (r.hours && r.hours.length > 0) {
    html += `<details style="font-size:11px;color:#5f6368;margin:4px 0;">
      <summary style="cursor:pointer;color:#1a73e8;">Opening hours</summary>
      <div style="margin-top:4px;line-height:1.6;">`;
    r.hours.forEach((h) => {
      html += `${escapeHtml(h)}<br/>`;
    });
    html += `</div></details>`;
  }

  // Coordinates
  html += `<div style="font-size:11px;color:#80868b;margin:4px 0;">${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}</div>`;

  // Action buttons
  html += `<div style="display:flex;gap:6px;margin-top:8px;">`;
  html += `<button class="popup-add-place-btn" data-index="${index}"
    style="flex:1;padding:6px 12px;background:#1a73e8;color:white;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;">
    + Add Place
  </button>`;
  if (r.googleMapsUri) {
    html += `<a href="${escapeHtml(r.googleMapsUri)}" target="_blank" rel="noopener"
      style="padding:6px 10px;background:#f1f3f4;color:#5f6368;border:none;border-radius:4px;text-decoration:none;font-size:12px;text-align:center;">
      Maps
    </a>`;
  }
  html += `</div>`;

  html += `</div>`;
  return html;
}

function showSearchMarkers(results) {
  clearSearchMarkers();
  searchResults = results;
  results.forEach((r, i) => {
    if (!r.lat || !r.lng) return;
    const marker = L.circleMarker([r.lat, r.lng], {
      radius: 8,
      color: "#1a73e8",
      fillColor: "#1a73e8",
      fillOpacity: 0.7,
      weight: 2,
    });
    marker.bindPopup(buildPlacePopupHtml(r, i), { closeButton: true, maxWidth: 300 });
    marker.bindTooltip(r.name, { direction: "top", offset: [0, -8] });
    searchMarkersLayer.addLayer(marker);
  });
}

function addPlaceFromSearch(index) {
  const r = searchResults[index];
  if (!r) return;
  map.closePopup();
  clearSearchMarkers();
  searchInput.value = "";
  searchResultsEl.classList.add("hidden");
  addNewPlace(r.lat, r.lng, selectedStateId, r.name, r.address);
}

// --- Measure Tool ---
function toggleMeasureMode() {
  measureMode = !measureMode;
  const btn = document.getElementById("measure-btn");
  if (btn) btn.classList.toggle("active", measureMode);

  const mapEl = document.getElementById("map");
  mapEl.classList.toggle("measure-cursor", measureMode);

  if (measureMode) {
    clearMeasurement();
    showToast("Click on the map to start measuring");
  } else {
    // Clean up when exiting measure mode
    if (measureGuideLine) {
      map.removeLayer(measureGuideLine);
      measureGuideLine = null;
    }
    clearMeasurement();
    const info = document.getElementById("measure-info");
    if (info) info.classList.add("hidden");
  }
}

function addMeasurePoint(latlng) {
  // If polygon is already closed, start fresh
  if (measurePolygon) clearMeasurement();

  measurePoints.push(latlng);

  // Add point marker
  const marker = L.circleMarker(latlng, {
    radius: 5,
    color: "#fff",
    fillColor: "#1a73e8",
    fillOpacity: 1,
    weight: 2,
  }).addTo(map);
  measureMarkers.push(marker);

  // Update polyline
  if (measurePolyline) map.removeLayer(measurePolyline);
  if (measurePoints.length >= 2) {
    measurePolyline = L.polyline(measurePoints, {
      color: "#1a73e8",
      weight: 3,
      dashArray: "8, 8",
    }).addTo(map);
  }

  // Add distance label at segment midpoint
  if (measurePoints.length >= 2) {
    const prev = measurePoints[measurePoints.length - 2];
    const curr = measurePoints[measurePoints.length - 1];
    const dist = prev.distanceTo(curr);
    const midLat = (prev.lat + curr.lat) / 2;
    const midLng = (prev.lng + curr.lng) / 2;

    const label = L.marker([midLat, midLng], {
      icon: L.divIcon({
        className: "measure-label",
        html: formatDistance(dist),
        iconSize: null,
      }),
      interactive: false,
    }).addTo(map);
    measureLabels.push(label);
  }

  updateMeasureInfo();
}

function closeMeasurePolygon() {
  if (measurePoints.length < 3) return;

  if (measurePolygon) map.removeLayer(measurePolygon);
  measurePolygon = L.polygon(measurePoints, {
    color: "#1a73e8",
    weight: 2,
    fillColor: "#1a73e8",
    fillOpacity: 0.15,
    dashArray: "8, 8",
  }).addTo(map);

  // Add closing segment distance label
  const first = measurePoints[0];
  const last = measurePoints[measurePoints.length - 1];
  const closeDist = last.distanceTo(first);
  const midLat = (first.lat + last.lat) / 2;
  const midLng = (first.lng + last.lng) / 2;
  const label = L.marker([midLat, midLng], {
    icon: L.divIcon({
      className: "measure-label",
      html: formatDistance(closeDist),
      iconSize: null,
    }),
    interactive: false,
  }).addTo(map);
  measureLabels.push(label);

  updateMeasureInfo();
}

function undoMeasurePoint() {
  if (measurePoints.length === 0) return;

  measurePoints.pop();

  // Remove last marker
  const lastMarker = measureMarkers.pop();
  if (lastMarker) map.removeLayer(lastMarker);

  // Remove last label
  if (measureLabels.length > 0 && measureLabels.length > measurePoints.length - 1) {
    const lastLabel = measureLabels.pop();
    if (lastLabel) map.removeLayer(lastLabel);
  }

  // Remove polygon if exists
  if (measurePolygon) {
    map.removeLayer(measurePolygon);
    measurePolygon = null;
    // Also remove closing segment label
    if (measureLabels.length > measurePoints.length - 1) {
      const closingLabel = measureLabels.pop();
      if (closingLabel) map.removeLayer(closingLabel);
    }
  }

  // Update polyline
  if (measurePolyline) map.removeLayer(measurePolyline);
  measurePolyline = null;
  if (measurePoints.length >= 2) {
    measurePolyline = L.polyline(measurePoints, {
      color: "#1a73e8",
      weight: 3,
      dashArray: "8, 8",
    }).addTo(map);
  }

  updateMeasureInfo();
}

function clearMeasurement() {
  measurePoints = [];
  if (measurePolyline) { map.removeLayer(measurePolyline); measurePolyline = null; }
  if (measurePolygon) { map.removeLayer(measurePolygon); measurePolygon = null; }
  if (measureGuideLine) { map.removeLayer(measureGuideLine); measureGuideLine = null; }
  measureMarkers.forEach((m) => map.removeLayer(m));
  measureMarkers = [];
  measureLabels.forEach((l) => map.removeLayer(l));
  measureLabels = [];
  updateMeasureInfo();
}

function getMeasureTotalDistance() {
  let total = 0;
  for (let i = 1; i < measurePoints.length; i++) {
    total += measurePoints[i - 1].distanceTo(measurePoints[i]);
  }
  return total;
}

function getGeodesicArea(points) {
  if (points.length < 3) return 0;
  // WGS84 semi-major axis (same as Google Maps)
  const R = 6378137;
  const rad = Math.PI / 180;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area +=
      (points[j].lng - points[i].lng) *
      rad *
      (2 + Math.sin(points[i].lat * rad) + Math.sin(points[j].lat * rad));
  }
  return Math.abs((area * R * R) / 2);
}

function formatDistance(meters) {
  if (meters >= 1000) return (meters / 1000).toFixed(2) + " km";
  return Math.round(meters) + " m";
}

function formatArea(sqMeters) {
  const acres = sqMeters / 4046.8564224;
  const sqFt = sqMeters * 10.7639;
  if (sqMeters >= 1000000) {
    return (sqMeters / 1000000).toFixed(2) + " km\u00B2 \u2022 " + acres.toFixed(2) + " acres";
  }
  if (sqMeters >= 10000) {
    return acres.toFixed(2) + " acres \u2022 " + (sqMeters / 10000).toFixed(2) + " ha";
  }
  if (sqFt >= 100) {
    return acres.toFixed(3) + " acres \u2022 " + Math.round(sqFt).toLocaleString() + " sq ft";
  }
  return Math.round(sqMeters) + " m\u00B2 \u2022 " + Math.round(sqFt) + " sq ft";
}

function updateMeasureInfo(cursorLatLng) {
  const info = document.getElementById("measure-info");
  if (!info) return;

  if (measurePoints.length === 0) {
    info.classList.add("hidden");
    return;
  }

  info.classList.remove("hidden");
  const total = getMeasureTotalDistance();

  // Live distance: include segment from last point to cursor
  let liveTotal = total;
  if (cursorLatLng && measurePoints.length >= 1 && !measurePolygon) {
    const lastPt = measurePoints[measurePoints.length - 1];
    liveTotal = total + lastPt.distanceTo(cursorLatLng);
  }

  let html = `<strong>Distance</strong>
    <div class="measure-value">${formatDistance(liveTotal)}</div>`;

  if (measurePolygon && measurePoints.length >= 3) {
    const area = getGeodesicArea(measurePoints);
    const perimeter = total + measurePoints[measurePoints.length - 1].distanceTo(measurePoints[0]);
    html += `<strong>Area</strong>
      <div class="measure-area-value">${formatArea(area)}</div>
      <strong>Perimeter</strong>
      <div class="measure-area-value">${formatDistance(perimeter)}</div>`;
  }

  html += `<div class="measure-actions">`;
  if (measurePoints.length >= 3 && !measurePolygon) {
    html += `<button data-action="close" class="measure-action-btn primary">Close Polygon</button>`;
  }
  html += `<button data-action="undo" class="measure-action-btn">Undo</button>`;
  html += `<button data-action="clear" class="measure-action-btn">Clear</button>`;
  html += `</div>`;

  info.innerHTML = html;
}

// --- Drive Banner ---
function updateDriveBanner() {
  const banner = document.getElementById("drive-banner");
  if (!banner) return;
  banner.style.display = driveConnected ? "none" : "flex";
}

// --- Sidebar: State List (Level 1) ---
function renderStateList(filter = "") {
  const list = document.getElementById("state-list");
  const query = filter.toLowerCase();

  const filtered = INDIA_STATES.filter((s) =>
    s.name.toLowerCase().includes(query)
  );

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <p>No matching states</p>
    </div>`;
    return;
  }

  list.innerHTML = filtered
    .map((s) => {
      const count = data.places.filter((p) => p.stateId === s.id).length;
      return `
    <div class="state-item" data-state-id="${s.id}">
      <div class="state-info">
        <div class="state-name">${escapeHtml(s.name)}</div>
        <div class="state-meta">${count} place${count !== 1 ? "s" : ""}</div>
      </div>
      <span class="state-arrow">&rsaquo;</span>
    </div>`;
    })
    .join("");

  // Click handlers
  list.querySelectorAll(".state-item").forEach((el) => {
    el.addEventListener("click", () => {
      selectState(el.dataset.stateId);
    });
  });
}

// --- Sidebar: Place List (Level 2) ---
function renderPlaceList(filter = "") {
  const list = document.getElementById("place-list");
  const query = filter.toLowerCase();

  const filtered = data.places.filter(
    (p) =>
      p.stateId === selectedStateId &&
      p.title.toLowerCase().includes(query)
  );

  // Update state header place count
  const totalCount = data.places.filter(
    (p) => p.stateId === selectedStateId
  ).length;
  document.getElementById("state-place-count").textContent =
    totalCount + " place" + (totalCount !== 1 ? "s" : "");

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <p>No places yet</p>
      <p class="hint">Click inside the state on the map to add a place</p>
    </div>`;
    return;
  }

  list.innerHTML = filtered
    .map(
      (p) => `
    <div class="place-item" data-id="${p.id}">
      <span class="place-dot" style="background:${p.color}"></span>
      <div class="place-info">
        <div class="place-name">${escapeHtml(p.title)}</div>
        <div class="place-meta">${p.attachments.length} attachment${p.attachments.length !== 1 ? "s" : ""}</div>
      </div>
    </div>
  `
    )
    .join("");

  // Click handlers
  list.querySelectorAll(".place-item").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.id;
      openPlaceDetail(id);
      const place = data.places.find((p) => p.id === id);
      if (place) map.flyTo([place.lat, place.lng], 14);
    });
  });
}

// --- Sidebar: Place Detail (Level 3) ---
function openPlaceDetail(id) {
  const place = data.places.find((p) => p.id === id);
  if (!place) return;
  selectedPlaceId = id;

  updateSidebarLevel("detail");

  document.getElementById("place-title").value = place.title;
  const addressEl = document.getElementById("place-address");
  if (place.address) {
    addressEl.textContent = place.address;
    addressEl.style.display = "";
  } else {
    addressEl.textContent = "";
    addressEl.style.display = "none";
  }
  document.getElementById("place-coords").textContent =
    `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`;
  document.getElementById("place-gmaps-link").href =
    `https://www.google.com/maps?q=${place.lat},${place.lng}`;
  document.getElementById("place-notes").value = place.notes;

  // Color picker
  document.querySelectorAll(".color-dot").forEach((dot) => {
    dot.classList.toggle("selected", dot.dataset.color === place.color);
  });

  renderAttachments(place);

  // Show/hide upload button based on Drive connection
  const uploadBtn = document.getElementById("upload-btn");
  const attachHint = document.getElementById("attach-hint");
  if (uploadBtn)
    uploadBtn.style.display = driveConnected ? "inline-block" : "none";
  if (attachHint)
    attachHint.style.display = driveConnected ? "none" : "block";
}

function closePlaceDetail() {
  selectedPlaceId = null;
  updateSidebarLevel("places");
  renderPlaceList();
}

function renderAttachments(place) {
  const list = document.getElementById("attachments-list");
  if (place.attachments.length === 0) {
    list.innerHTML = '<p class="no-attachments">No attachments yet</p>';
    return;
  }
  list.innerHTML = place.attachments
    .map(
      (att, i) => `
    <div class="attachment-item">
      <span class="att-name">${escapeHtml(att.name)}</span>
      <div class="att-actions">
        <a class="att-link" href="${att.webViewLink || "#"}" target="_blank" title="Open in Drive">Open</a>
        <button class="att-delete" data-index="${i}" title="Delete">&times;</button>
      </div>
    </div>
  `
    )
    .join("");

  // Delete attachment handlers
  list.querySelectorAll(".att-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.dataset.index);
      const att = place.attachments[idx];
      if (att.driveId && driveConnected) {
        await Drive.deleteAttachment(att.driveId).catch(() => {});
      }
      place.attachments.splice(idx, 1);
      renderAttachments(place);
      saveData();
      showToast("Attachment deleted");
    });
  });
}

// --- Geocoding Search (within selected state) ---
let searchTimer = null;
let lastSearchQuery = "";
let searchAreaControl = null;
let searchAreaTriggered = false;
const searchInput = document.getElementById("search-input");
const searchResultsEl = document.getElementById("search-results");

// --- Nearby Search (on map click) ---
async function searchNearbyGoogle(lat, lng) {
  const token = await Auth.getToken(false);
  if (!token) return [];
  const res = await fetch(
    "https://places.googleapis.com/v1/places:searchNearby",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Goog-FieldMask":
          "places.displayName,places.formattedAddress,places.location,places.types,places.rating,places.userRatingCount,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.currentOpeningHours,places.businessStatus,places.googleMapsUri,places.photos",
      },
      body: JSON.stringify({
        locationRestriction: {
          circle: { center: { latitude: lat, longitude: lng }, radiusMeters: 200 },
        },
        maxResultCount: 10,
        rankPreference: "DISTANCE",
        languageCode: "en",
      }),
    }
  );
  if (!res.ok) return [];
  const result = await res.json();
  return (result.places || []).map((p) => ({
    name: p.displayName?.text || "Unknown",
    address: p.formattedAddress || "",
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    source: "google",
    rating: p.rating || null,
    ratingCount: p.userRatingCount || 0,
    phone: p.nationalPhoneNumber || p.internationalPhoneNumber || "",
    website: p.websiteUri || "",
    openNow: p.currentOpeningHours?.openNow,
    hours: (p.currentOpeningHours?.weekdayDescriptions || []),
    businessStatus: p.businessStatus || "",
    googleMapsUri: p.googleMapsUri || "",
    photoRef: p.photos && p.photos.length > 0 ? p.photos[0].name : "",
  }));
}

async function reverseGeocodeNominatim(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=18`,
      { headers: { "Accept-Language": "en" } }
    );
    if (!res.ok) return null;
    const result = await res.json();
    if (!result || result.error) return null;
    return {
      name: result.name || result.display_name.split(",")[0],
      address: result.display_name.split(",").slice(1, 3).join(",").trim(),
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      source: "nominatim",
    };
  } catch (err) {
    return null;
  }
}

function getStateBounds(stateId) {
  if (!indiaGeoJSON) return null;
  const feature = indiaGeoJSON.features.find(
    (f) => f.properties.stateId === stateId
  );
  if (!feature) return null;
  const layer = L.geoJSON(feature);
  return layer.getBounds();
}

// Get the current search bounds — use visible map viewport, clamped to state
function getSearchBounds(stateId) {
  const viewBounds = map.getBounds();
  const stateBounds = getStateBounds(stateId);
  if (!stateBounds) return viewBounds;

  // Use the intersection of viewport and state bounds for tighter results
  const south = Math.max(viewBounds.getSouth(), stateBounds.getSouth());
  const north = Math.min(viewBounds.getNorth(), stateBounds.getNorth());
  const west = Math.max(viewBounds.getWest(), stateBounds.getWest());
  const east = Math.min(viewBounds.getEast(), stateBounds.getEast());

  // If the intersection is valid, use it; otherwise fall back to state bounds
  if (south < north && west < east) {
    return L.latLngBounds([south, west], [north, east]);
  }
  return stateBounds;
}

// Google Places Text Search (New API) — uses OAuth token from signed-in account
// strictBounds = true uses locationRestriction (only results in area), false uses locationBias (prefer area)
async function searchPlacesGoogle(query, stateId, strictBounds = false) {
  const token = await Auth.getToken(false);
  if (!token) throw new Error("Not signed in");

  const bounds = getSearchBounds(stateId);
  const body = {
    textQuery: query,
    languageCode: "en",
    maxResultCount: 20,
  };
  if (bounds) {
    const rect = {
      rectangle: {
        low: {
          latitude: bounds.getSouth(),
          longitude: bounds.getWest(),
        },
        high: {
          latitude: bounds.getNorth(),
          longitude: bounds.getEast(),
        },
      },
    };
    if (strictBounds) {
      body.locationRestriction = rect;
    } else {
      body.locationBias = rect;
    }
  }
  const res = await fetch(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Goog-FieldMask":
          "places.displayName,places.formattedAddress,places.location,places.types,places.rating,places.userRatingCount,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.currentOpeningHours,places.businessStatus,places.googleMapsUri,places.photos",
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error("Places API error: " + res.status);
  const result = await res.json();
  return (result.places || []).map((p) => ({
    name: p.displayName?.text || "Unknown",
    address: p.formattedAddress || "",
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    source: "google",
    rating: p.rating || null,
    ratingCount: p.userRatingCount || 0,
    phone: p.nationalPhoneNumber || p.internationalPhoneNumber || "",
    website: p.websiteUri || "",
    openNow: p.currentOpeningHours?.openNow,
    hours: (p.currentOpeningHours?.weekdayDescriptions || []),
    businessStatus: p.businessStatus || "",
    googleMapsUri: p.googleMapsUri || "",
    photoRef: p.photos && p.photos.length > 0 ? p.photos[0].name : "",
  }));
}

// Nominatim fallback search
async function searchPlacesNominatim(query, stateId) {
  // Use viewport-state intersection so results match the visible map area
  const bounds = getSearchBounds(stateId);
  const params = new URLSearchParams({
    format: "json",
    q: query,
    limit: "20",
    addressdetails: "1",
    countrycodes: "in",
  });
  if (bounds) {
    params.set(
      "viewbox",
      `${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()},${bounds.getSouth()}`
    );
    params.set("bounded", "1");
  }
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
    { headers: { "Accept-Language": "en" } }
  );
  if (!res.ok) return [];
  const results = await res.json();
  return results.map((r) => ({
    name: r.display_name.split(",")[0],
    address: r.display_name.split(",").slice(1, 3).join(",").trim(),
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    source: "nominatim",
  }));
}

// Unified search — uses Google Places when signed in, falls back to Nominatim
async function geocodeInState(query, stateId, strictBounds = false) {
  let results;
  if (driveConnected) {
    try {
      results = await searchPlacesGoogle(query, stateId, strictBounds);
    } catch (err) {
      console.warn("Google Places search failed, falling back to Nominatim:", err);
    }
  }
  if (!results || results.length === 0) {
    results = await searchPlacesNominatim(query, stateId);
  }
  // Filter to only include results within the selected state polygon
  if (stateId && indiaGeoJSON) {
    results = results.filter((r) =>
      r.lat && r.lng && isPointInState(r.lat, r.lng, stateId, indiaGeoJSON)
    );
  }
  return results;
}

function renderSearchDropdown(query) {
  if (!query.trim()) {
    searchResultsEl.classList.add("hidden");
    clearSearchMarkers();
    lastSearchQuery = "";
    return;
  }

  lastSearchQuery = query;
  hideSearchAreaButton();

  const isAreaSearch = searchAreaTriggered;
  let html = "";

  // Show saved place matches only for normal searches (not "Search this area")
  if (!isAreaSearch) {
    const savedMatches = data.places.filter(
      (p) =>
        p.stateId === selectedStateId &&
        p.title.toLowerCase().includes(query.toLowerCase())
    );
    if (savedMatches.length > 0) {
      html += `<div class="search-section-label">Your Places</div>`;
      html += savedMatches
        .map(
          (p) => `
        <div class="search-result-item saved" data-type="saved" data-id="${p.id}">
          <div class="result-icon" style="background:${p.color};">📍</div>
          <div class="result-info">
            <div class="result-name">${escapeHtml(p.title)}</div>
            <div class="result-detail">${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}</div>
          </div>
        </div>`
        )
        .join("");
    }
  }

  const searchSource = driveConnected ? "Google" : "Nominatim";
  const areaLabel = isAreaSearch ? "visible area" : escapeHtml(getStateName(selectedStateId));
  html += `<div class="search-section-label">Locations in ${areaLabel}</div>`;
  html += `<div class="search-loading" id="geo-loading">Searching ${searchSource}...</div>`;
  searchResultsEl.innerHTML = html;
  searchResultsEl.classList.remove("hidden");
  bindSearchClicks();

  // Debounced geocode
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    try {
      const results = await geocodeInState(query, selectedStateId, isAreaSearch);
      const loadingEl = document.getElementById("geo-loading");
      if (!loadingEl) return;

      if (results.length === 0) {
        loadingEl.outerHTML = `<div class="search-loading">No locations found</div>`;
        if (searchAreaTriggered) {
          searchAreaTriggered = false;
          showToast("No places found in this area");
        }
        return;
      }

      if (searchAreaTriggered) {
        searchAreaTriggered = false;
        showToast(`Found ${results.length} place${results.length !== 1 ? "s" : ""} in this area`);
      }

      loadingEl.outerHTML = results
        .map(
          (r) => `
        <div class="search-result-item geo" data-type="geo" data-lat="${r.lat}" data-lng="${r.lng}" data-name="${escapeHtml(r.name)}">
          <div class="result-icon">${r.source === "google" ? "🔍" : "📌"}</div>
          <div class="result-info">
            <div class="result-name">${escapeHtml(r.name)}</div>
            <div class="result-detail">${escapeHtml(r.address)}</div>
          </div>
        </div>`
        )
        .join("");
      bindSearchClicks();
      showSearchMarkers(results);
      // Ensure dropdown stays visible (especially for "Search this area")
      searchResultsEl.classList.remove("hidden");
    } catch (err) {
      const loadingEl = document.getElementById("geo-loading");
      if (loadingEl) {
        loadingEl.outerHTML = `<div class="search-loading">Search failed</div>`;
      }
      if (searchAreaTriggered) {
        searchAreaTriggered = false;
        showToast("Search failed — try again");
      }
    }
  }, 400);
}

function bindSearchClicks() {
  searchResultsEl.querySelectorAll(".search-result-item").forEach((el) => {
    el.addEventListener("click", () => {
      const type = el.dataset.type;
      if (type === "saved") {
        const id = el.dataset.id;
        const place = data.places.find((p) => p.id === id);
        if (place) {
          map.flyTo([place.lat, place.lng], 14);
          openPlaceDetail(place.id);
        }
      } else if (type === "geo") {
        const lat = parseFloat(el.dataset.lat);
        const lng = parseFloat(el.dataset.lng);
        map.flyTo([lat, lng], 15);
        // Open popup on the matching search marker after fly animation
        map.once("moveend", () => {
          searchMarkersLayer.eachLayer((layer) => {
            const pos = layer.getLatLng();
            if (
              Math.abs(pos.lat - lat) < 0.0001 &&
              Math.abs(pos.lng - lng) < 0.0001
            ) {
              layer.openPopup();
            }
          });
        });
        // Highlight the selected result but keep the list open
        searchResultsEl
          .querySelectorAll(".search-result-item.geo")
          .forEach((item) => item.classList.remove("active"));
        el.classList.add("active");
        return; // don't clear search — keep dropdown open
      }
      searchInput.value = "";
      searchResultsEl.classList.add("hidden");
    });
  });
}

// --- Event Listeners ---

// Escape key exits measure mode
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && measureMode) {
    toggleMeasureMode();
  }
});

// Measure info panel — event delegation for action buttons
document.getElementById("measure-info").addEventListener("click", (e) => {
  const btn = e.target.closest(".measure-action-btn");
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === "close") closeMeasurePolygon();
  else if (action === "undo") undoMeasurePoint();
  else if (action === "clear") clearMeasurement();
});

// Search input — behavior depends on sidebar level
searchInput.addEventListener("input", (e) => {
  const query = e.target.value;
  if (sidebarLevel === "states") {
    renderStateList(query);
    searchResultsEl.classList.add("hidden");
  } else if (sidebarLevel === "places") {
    renderSearchDropdown(query);
  }
});

// Close dropdown on outside click (but not from "Search this area" button)
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-box") && !e.target.closest(".search-area-control")) {
    searchResultsEl.classList.add("hidden");
  }
});

// Re-open dropdown on focus if there's text and we're in places level
searchInput.addEventListener("focus", () => {
  if (sidebarLevel === "places" && searchInput.value.trim()) {
    renderSearchDropdown(searchInput.value);
  }
});

// State back button (Level 2 → Level 1)
document
  .getElementById("state-back-btn")
  .addEventListener("click", deselectState);

// Place back button (Level 3 → Level 2)
document
  .getElementById("back-btn")
  .addEventListener("click", closePlaceDetail);

// Color picker
document.querySelectorAll(".color-dot").forEach((dot) => {
  dot.addEventListener("click", () => {
    document
      .querySelectorAll(".color-dot")
      .forEach((d) => d.classList.remove("selected"));
    dot.classList.add("selected");
  });
});

// Save place
document.getElementById("save-place-btn").addEventListener("click", () => {
  const place = data.places.find((p) => p.id === selectedPlaceId);
  if (!place) return;

  place.title = document.getElementById("place-title").value || "Untitled";
  place.notes = document.getElementById("place-notes").value;
  const selectedColor = document.querySelector(".color-dot.selected");
  if (selectedColor) place.color = selectedColor.dataset.color;

  addMarker(place);
  renderPlaceList();
  saveData();
  showToast("Place saved!");
});

// Delete place
document.getElementById("delete-place-btn").addEventListener("click", () => {
  if (selectedPlaceId && confirm("Delete this place?")) {
    deletePlace(selectedPlaceId);
  }
});

// File upload
document
  .getElementById("file-input")
  .addEventListener("change", async (e) => {
    if (!driveConnected) {
      showToast("Connect Google Drive to upload attachments");
      return;
    }
    const place = data.places.find((p) => p.id === selectedPlaceId);
    if (!place) return;

    const files = Array.from(e.target.files);
    for (const file of files) {
      showToast(`Uploading ${file.name}...`);
      try {
        const result = await Drive.uploadAttachment(file);
        place.attachments.push({
          name: file.name,
          driveId: result.id,
          mimeType: result.mimeType,
          webViewLink: result.webViewLink || "",
        });
        renderAttachments(place);
        saveData();
        showToast(`${file.name} uploaded!`);
      } catch (err) {
        console.error("Upload failed:", err);
        showToast(`Failed to upload ${file.name}`);
      }
    }
    e.target.value = "";
  });

// Drive banner — setup button
const driveBannerBtn = document.getElementById("drive-banner-btn");
if (driveBannerBtn) {
  driveBannerBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_SETUP" });
  });
}

// --- Helpers ---
function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add("hidden"), 3000);
}

function escapeHtml(str) {
  if (str == null) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// --- Start ---
init();
