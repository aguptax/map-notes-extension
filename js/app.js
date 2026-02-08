// Main map application logic

let map;
let markers = {};
let data = { version: 1, places: [] };
let selectedPlaceId = null;
let saving = false;

// --- Init ---
async function init() {
  const signedIn = await Auth.isSignedIn();
  if (!signedIn) {
    showToast("Please sign in from the extension popup first.");
    return;
  }

  initMap();
  await loadFromDrive();
  renderPlaceList();
  renderAllMarkers();
  showToast("Data loaded from Google Drive");
}

// --- Map Setup ---
function initMap() {
  map = L.map("map", {
    center: [20.5937, 78.9629], // India center
    zoom: 5,
    zoomControl: true,
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);

  // Click on map to add a new place
  map.on("click", (e) => {
    addNewPlace(e.latlng.lat, e.latlng.lng);
  });
}

// --- Data operations ---
async function loadFromDrive() {
  try {
    data = await Drive.loadData();
    if (!data.places) data.places = [];
  } catch (err) {
    console.error("Failed to load data:", err);
    data = { version: 1, places: [] };
  }
}

async function saveToDrive() {
  if (saving) return;
  saving = true;
  try {
    await Drive.saveData(data);
  } catch (err) {
    console.error("Failed to save:", err);
    showToast("Save failed — check connection");
  }
  saving = false;
}

// --- Places ---
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function addNewPlace(lat, lng) {
  const place = {
    id: generateId(),
    title: "New Place",
    lat,
    lng,
    color: "#e94560",
    notes: "",
    attachments: [],
    createdAt: new Date().toISOString(),
  };
  data.places.push(place);
  renderPlaceList();
  addMarker(place);
  openPlaceDetail(place.id);
  saveToDrive();
}

function deletePlace(id) {
  const place = data.places.find((p) => p.id === id);
  if (!place) return;

  // Delete attachments from Drive
  place.attachments.forEach((att) => {
    Drive.deleteAttachment(att.driveId).catch(() => {});
  });

  // Remove from data
  data.places = data.places.filter((p) => p.id !== id);

  // Remove marker
  if (markers[id]) {
    map.removeLayer(markers[id]);
    delete markers[id];
  }

  closePlaceDetail();
  renderPlaceList();
  saveToDrive();
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

  marker.on("click", () => openPlaceDetail(place.id));

  marker.on("dragend", (e) => {
    const pos = e.target.getLatLng();
    place.lat = pos.lat;
    place.lng = pos.lng;
    if (selectedPlaceId === place.id) {
      document.getElementById("place-coords").textContent =
        `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
    }
    saveToDrive();
  });

  marker.addTo(map);
  markers[place.id] = marker;
}

function renderAllMarkers() {
  Object.values(markers).forEach((m) => map.removeLayer(m));
  markers = {};
  data.places.forEach((place) => addMarker(place));
}

// --- Sidebar: Place List ---
function renderPlaceList() {
  const list = document.getElementById("place-list");
  const search = document.getElementById("search-input").value.toLowerCase();

  const filtered = data.places.filter((p) =>
    p.title.toLowerCase().includes(search)
  );

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <p>No places yet</p>
      <p class="hint">Click anywhere on the map to add a place</p>
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
      if (place) map.flyTo([place.lat, place.lng], 12);
    });
  });
}

// --- Sidebar: Place Detail ---
function openPlaceDetail(id) {
  const place = data.places.find((p) => p.id === id);
  if (!place) return;
  selectedPlaceId = id;

  document.getElementById("place-list").classList.add("hidden");
  document.getElementById("place-detail").classList.remove("hidden");

  document.getElementById("place-title").value = place.title;
  document.getElementById("place-coords").textContent =
    `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`;
  document.getElementById("place-notes").value = place.notes;

  // Color picker
  document.querySelectorAll(".color-dot").forEach((dot) => {
    dot.classList.toggle("selected", dot.dataset.color === place.color);
  });

  renderAttachments(place);
}

function closePlaceDetail() {
  selectedPlaceId = null;
  document.getElementById("place-detail").classList.add("hidden");
  document.getElementById("place-list").classList.remove("hidden");
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
      if (att.driveId) {
        await Drive.deleteAttachment(att.driveId).catch(() => {});
      }
      place.attachments.splice(idx, 1);
      renderAttachments(place);
      saveToDrive();
      showToast("Attachment deleted");
    });
  });
}

// --- Event Listeners ---

// Search
document.getElementById("search-input").addEventListener("input", () => {
  renderPlaceList();
});

// Back button
document.getElementById("back-btn").addEventListener("click", closePlaceDetail);

// Color picker
document.querySelectorAll(".color-dot").forEach((dot) => {
  dot.addEventListener("click", () => {
    document.querySelectorAll(".color-dot").forEach((d) => d.classList.remove("selected"));
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

  // Update marker
  addMarker(place);
  renderPlaceList();
  saveToDrive();
  showToast("Place saved!");
});

// Delete place
document.getElementById("delete-place-btn").addEventListener("click", () => {
  if (selectedPlaceId && confirm("Delete this place?")) {
    deletePlace(selectedPlaceId);
  }
});

// File upload
document.getElementById("file-input").addEventListener("change", async (e) => {
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
      saveToDrive();
      showToast(`${file.name} uploaded!`);
    } catch (err) {
      console.error("Upload failed:", err);
      showToast(`Failed to upload ${file.name}`);
    }
  }
  e.target.value = "";
});

// --- Helpers ---
function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add("hidden"), 3000);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// --- Start ---
init();
