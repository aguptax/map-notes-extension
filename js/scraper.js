// State Scanner — grid-based search with AI categorization
// Depends on globals from app.js: map, selectedStateId, indiaGeoJSON, driveConnected,
//   getStateBounds, isPointInState, addNewPlace, escapeHtml, showToast, updateSidebarLevel, Auth

// --- Utility ---

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// --- Usage Tracking ---

// Pricing per call (USD)
const PRICE_PLACES_SEARCH = 0.032;  // $32 per 1,000 Text Search calls
const PRICE_GEMINI_CALL = 0;        // Free tier for flash model

const Usage = {
  data: { placesSearch: 0, geminiCalls: 0, cost: 0 },
  session: { placesSearch: 0, geminiCalls: 0, cost: 0 },

  async load() {
    const stored = await chrome.storage.local.get("scanner_usage");
    if (stored.scanner_usage) {
      this.data = stored.scanner_usage;
    }
    this.session = { placesSearch: 0, geminiCalls: 0, cost: 0 };
    this.render();
  },

  async save() {
    await chrome.storage.local.set({ scanner_usage: this.data });
  },

  trackPlacesSearch() {
    this.data.placesSearch++;
    this.data.cost += PRICE_PLACES_SEARCH;
    this.session.placesSearch++;
    this.session.cost += PRICE_PLACES_SEARCH;
    this.save();
    this.render();
  },

  trackGemini() {
    this.data.geminiCalls++;
    this.session.geminiCalls++;
    this.save();
    this.render();
  },

  async reset() {
    this.data = { placesSearch: 0, geminiCalls: 0, cost: 0 };
    await this.save();
    this.render();
  },

  render() {
    const el = (id) => document.getElementById(id);
    if (!el("usage-places")) return;
    el("usage-places").textContent = this.data.placesSearch.toLocaleString();
    el("usage-gemini").textContent = this.data.geminiCalls.toLocaleString();
    el("usage-cost").textContent = "$" + this.data.cost.toFixed(2);
    el("usage-session-cost").textContent = "$" + this.session.cost.toFixed(2);
  },
};

// --- Grid Generation ---

function generateGrid(stateId, cellSize) {
  const bounds = getStateBounds(stateId);
  if (!bounds) return [];

  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const west = bounds.getWest();
  const east = bounds.getEast();
  const cells = [];

  for (let lat = south; lat < north; lat += cellSize) {
    for (let lng = west; lng < east; lng += cellSize) {
      const cS = lat;
      const cN = Math.min(lat + cellSize, north);
      const cW = lng;
      const cE = Math.min(lng + cellSize, east);

      if (cellOverlapsState(cS, cN, cW, cE, stateId)) {
        cells.push({ south: cS, north: cN, west: cW, east: cE });
      }
    }
  }
  return cells;
}

function cellOverlapsState(south, north, west, east, stateId) {
  const midLat = (south + north) / 2;
  const midLng = (west + east) / 2;
  // 13-point test: center, 4 corners, 4 edge midpoints, 4 quarter-points
  // This catches narrow strips and irregular boundaries that a 5-point test misses
  const pts = [
    [midLat, midLng],                       // center
    [south, west],                           // corners
    [south, east],
    [north, west],
    [north, east],
    [midLat, west],                          // edge midpoints
    [midLat, east],
    [south, midLng],
    [north, midLng],
    [(south + midLat) / 2, (west + midLng) / 2],  // quarter-points
    [(south + midLat) / 2, (midLng + east) / 2],
    [(midLat + north) / 2, (west + midLng) / 2],
    [(midLat + north) / 2, (midLng + east) / 2],
  ];
  return pts.some(([lat, lng]) =>
    isPointInState(lat, lng, stateId, indiaGeoJSON)
  );
}

// --- Scanner Markers ---

let scannerMarkersLayer = null;

function initScannerMarkersLayer() {
  if (!scannerMarkersLayer) {
    scannerMarkersLayer = L.layerGroup().addTo(map);
  }
}

function clearScannerMarkers() {
  if (scannerMarkersLayer) scannerMarkersLayer.clearLayers();
}

const CATEGORY_COLORS = [
  "#a855f7", "#06b6d4", "#f97316", "#10b981",
  "#ef4444", "#3b82f6", "#f59e0b", "#8b5cf6",
];

function addScannerMarkerLive(place, index) {
  initScannerMarkersLayer();
  const color = "#3b82f6"; // default blue until categorized
  const marker = L.circleMarker([place.lat, place.lng], {
    radius: 7,
    color: color,
    fillColor: color,
    fillOpacity: 0.6,
    weight: 2,
  });
  marker.bindTooltip(place.name, { direction: "top", offset: [0, -8] });
  marker.bindPopup(buildScannerPopupHtml(place, index), { maxWidth: 280 });
  scannerMarkersLayer.addLayer(marker);
}

function renderScannerMarkers(results, categories) {
  clearScannerMarkers();
  initScannerMarkersLayer();

  const placeCategory = {};
  if (categories) {
    categories.forEach((cat, catIdx) => {
      (cat.placeIndices || []).forEach((placeIdx) => {
        placeCategory[placeIdx] = catIdx;
      });
    });
  }

  results.forEach((place, i) => {
    const catIdx = placeCategory[i] !== undefined ? placeCategory[i] : 0;
    const color = CATEGORY_COLORS[catIdx % CATEGORY_COLORS.length];

    const marker = L.circleMarker([place.lat, place.lng], {
      radius: 7,
      color: color,
      fillColor: color,
      fillOpacity: 0.6,
      weight: 2,
    });

    marker.bindTooltip(place.name, { direction: "top", offset: [0, -8] });
    marker.bindPopup(buildScannerPopupHtml(place, i), { maxWidth: 280 });
    scannerMarkersLayer.addLayer(marker);
  });
}

function buildScannerPopupHtml(place, index) {
  let html = `<div style="min-width:180px;max-width:260px;font-family:Roboto,sans-serif;">`;
  html += `<strong style="font-size:13px;color:#202124;">${escapeHtml(place.name)}</strong>`;
  if (place.rating) {
    html += `<div style="font-size:11px;color:#fbbc04;">\u2605 ${place.rating} (${place.ratingCount})</div>`;
  }
  if (place.address) {
    html += `<div style="font-size:11px;color:#5f6368;margin:2px 0;">${escapeHtml(place.address)}</div>`;
  }
  if (place.types.length > 0) {
    html += `<div style="font-size:10px;color:#80868b;margin:2px 0;">${escapeHtml(place.types.slice(0, 3).join(", "))}</div>`;
  }
  html += `<div style="display:flex;gap:6px;margin-top:6px;">`;
  html += `<button class="scanner-add-place-btn" data-scanner-index="${index}"
    style="flex:1;padding:5px 10px;background:#1a73e8;color:white;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:500;">
    + Add Place</button>`;
  if (place.googleMapsUri) {
    html += `<a href="${escapeHtml(place.googleMapsUri)}" target="_blank" rel="noopener"
      style="padding:5px 8px;background:#f1f3f4;color:#202124;border:1px solid #dadce0;border-radius:4px;font-size:11px;text-decoration:none;display:flex;align-items:center;">
      Maps</a>`;
  }
  html += `</div></div>`;
  return html;
}

// --- Progress UI ---

function showScannerProgress(show) {
  document.getElementById("scanner-progress").classList.toggle("hidden", !show);
}

function updateScannerProgress(completed, total, placesFound, errors) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  document.getElementById("scanner-progress-bar").style.width = pct + "%";
  document.getElementById("scanner-progress-text").textContent =
    `${completed} / ${total} cells (${pct}%)`;
  document.getElementById("scanner-progress-stats").textContent =
    `${placesFound} unique places found` +
    (errors > 0 ? ` | ${errors} errors` : "");
}

// --- Scraper Core ---

const Scraper = {
  abortController: null,
  isRunning: false,
  results: [],
  seenPlaceIds: new Set(),
  categories: null,
  currentStateId: null,

  async scan(stateId, query, cellSize, concurrency) {
    this.abortController = new AbortController();
    this.isRunning = true;
    this.results = [];
    this.seenPlaceIds = new Set();
    this.categories = null;
    this.currentStateId = stateId;

    const cells = generateGrid(stateId, cellSize);
    if (cells.length === 0) {
      showToast("No grid cells generated for this state");
      this.isRunning = false;
      return;
    }

    showToast(`Scanning ${cells.length} cells...`);
    updateScannerProgress(0, cells.length, 0, 0);
    showScannerProgress(true);

    let completedCells = 0;
    let errorCount = 0;

    for (let i = 0; i < cells.length; i += concurrency) {
      if (this.abortController.signal.aborted) break;

      const batch = cells.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map((cell) =>
          this.searchCell(query, cell, stateId).catch((err) => {
            if (err.name !== "AbortError") {
              console.warn("Cell search failed:", err);
              errorCount++;
            }
            return [];
          })
        )
      );

      for (const cellResults of batchResults) {
        for (const place of cellResults) {
          this.addIfNew(place);
        }
      }

      completedCells += batch.length;
      updateScannerProgress(
        completedCells,
        cells.length,
        this.results.length,
        errorCount
      );

      if (i + concurrency < cells.length && !this.abortController.signal.aborted) {
        await sleep(200);
      }
    }

    this.isRunning = false;
    onScanComplete();
  },

  async searchCell(query, cell, stateId) {
    const token = await Auth.getToken(false);
    if (!token) throw new Error("Not signed in");

    const res = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.rating,places.userRatingCount,places.googleMapsUri,places.photos",
        },
        body: JSON.stringify({
          textQuery: query,
          languageCode: "en",
          maxResultCount: 20,
          locationBias: {
            rectangle: {
              low: { latitude: cell.south, longitude: cell.west },
              high: { latitude: cell.north, longitude: cell.east },
            },
          },
        }),
        signal: this.abortController.signal,
      }
    );

    Usage.trackPlacesSearch();

    if (!res.ok) {
      if (res.status === 429) {
        await sleep(2000);
        return this.searchCell(query, cell, stateId);
      }
      throw new Error(`Places API: ${res.status}`);
    }

    const result = await res.json();
    return (result.places || [])
      .map((p) => ({
        placeId: p.id || "",
        name: p.displayName?.text || "Unknown",
        address: p.formattedAddress || "",
        lat: p.location?.latitude,
        lng: p.location?.longitude,
        types: p.types || [],
        rating: p.rating || null,
        ratingCount: p.userRatingCount || 0,
        googleMapsUri: p.googleMapsUri || "",
        photoRef:
          p.photos && p.photos.length > 0 ? p.photos[0].name : "",
      }))
      .filter(
        (p) => p.lat && p.lng && isPointInState(p.lat, p.lng, stateId, indiaGeoJSON)
      );
  },

  addIfNew(place) {
    if (place.placeId && this.seenPlaceIds.has(place.placeId)) return false;

    const DEDUP_DISTANCE_M = 50;
    for (const existing of this.results) {
      if (haversineDistance(place.lat, place.lng, existing.lat, existing.lng) < DEDUP_DISTANCE_M) {
        return false;
      }
    }

    if (place.placeId) this.seenPlaceIds.add(place.placeId);
    this.results.push(place);
    addScannerMarkerLive(place, this.results.length - 1);
    return true;
  },

  abort() {
    if (this.abortController) this.abortController.abort();
    this.isRunning = false;
  },
};

// --- Gemini API Key Management ---

const GeminiKey = {
  key: "",
  async load() {
    const stored = await chrome.storage.local.get("gemini_api_key");
    this.key = stored.gemini_api_key || "";
    const input = document.getElementById("gemini-api-key");
    if (input && this.key) input.value = this.key;
  },
  async save(key) {
    this.key = key.trim();
    await chrome.storage.local.set({ gemini_api_key: this.key });
  },
  get() {
    return this.key;
  },
};

// --- Gemini AI Categorization ---

async function categorizeWithGemini(results, query) {
  const apiKey = GeminiKey.get();
  if (!apiKey) throw new Error("Enter a Gemini API key first (get one free from aistudio.google.com/apikey)");

  const placeSummaries = results.map((p, i) => ({
    i,
    name: p.name,
    address: p.address,
    types: p.types.slice(0, 3).join(", "),
    rating: p.rating,
  }));

  const prompt = `You are analyzing a list of ${results.length} places found by searching for "${query}" in a state of India.

Categorize these places into logical groups (3-8 categories). For each category, provide:
1. A short category name
2. A one-sentence description
3. The indices (i) of places belonging to it

Also provide a brief overall summary (2-3 sentences) of what was found.

Respond ONLY with valid JSON in this exact format:
{
  "summary": "Overall summary here...",
  "categories": [
    {
      "name": "Category Name",
      "description": "One sentence description",
      "placeIndices": [0, 1, 5, 12]
    }
  ]
}

Here are the places:
${JSON.stringify(placeSummaries)}`;

  const model = document.getElementById("gemini-model").value || "gemini-2.0-flash-lite";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  Usage.trackGemini();

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errBody}`);
  }

  const geminiResult = await res.json();
  const textContent =
    geminiResult.candidates?.[0]?.content?.parts?.[0]?.text || "";

  try {
    return JSON.parse(textContent);
  } catch (e) {
    const jsonMatch = textContent.match(/```json?\s*([\s\S]*?)```/);
    if (jsonMatch) return JSON.parse(jsonMatch[1].trim());
    throw new Error("Failed to parse Gemini response");
  }
}

// --- Results UI Rendering ---

function onScanComplete() {
  const count = Scraper.results.length;
  showToast(`Scan complete: ${count} place${count !== 1 ? "s" : ""} found`);

  if (count === 0) {
    document.getElementById("scanner-results").classList.add("hidden");
    document.getElementById("scanner-ai-section").classList.add("hidden");
    return;
  }

  document.getElementById("scanner-results").classList.remove("hidden");
  document.getElementById("scanner-results-count").textContent =
    `${count} places found`;

  document.getElementById("scanner-ai-section").classList.remove("hidden");
  document.getElementById("categorize-btn").classList.remove("hidden");

  renderUncategorizedResults(Scraper.results);
  renderScannerMarkers(Scraper.results, null);
}

function renderUncategorizedResults(results) {
  const container = document.getElementById("scanner-categories");
  container.innerHTML = results
    .map(
      (p, i) => `
    <div class="scanner-place-item" data-scanner-index="${i}">
      <span class="scanner-place-name">${escapeHtml(p.name)}</span>
      ${p.rating ? `<span class="scanner-place-rating">\u2605 ${p.rating}</span>` : ""}
    </div>`
    )
    .join("");

  bindScannerPlaceClicks(container);
}

function renderCategorizedResults(results, aiResult) {
  // Show summary
  const summaryEl = document.getElementById("scanner-ai-summary");
  summaryEl.classList.remove("hidden");
  summaryEl.textContent = aiResult.summary || "";

  // Render categories
  const container = document.getElementById("scanner-categories");
  container.innerHTML = (aiResult.categories || [])
    .map((cat, catIdx) => {
      const places = (cat.placeIndices || [])
        .map((idx) => ({ ...results[idx], _origIdx: idx }))
        .filter((p) => p.name);
      return `
      <div class="scanner-category">
        <div class="scanner-category-header" data-cat-idx="${catIdx}">
          <span class="scanner-category-name">${escapeHtml(cat.name)}</span>
          <span class="scanner-category-count">${places.length}</span>
        </div>
        <div class="scanner-category-body" id="scanner-cat-body-${catIdx}">
          <div class="scanner-category-desc">${escapeHtml(cat.description || "")}</div>
          ${places
            .map(
              (p) => `
          <div class="scanner-place-item" data-scanner-index="${p._origIdx}">
            <span class="scanner-place-name">${escapeHtml(p.name)}</span>
            ${p.rating ? `<span class="scanner-place-rating">\u2605 ${p.rating}</span>` : ""}
          </div>`
            )
            .join("")}
        </div>
      </div>`;
    })
    .join("");

  // Category toggle
  container.querySelectorAll(".scanner-category-header").forEach((header) => {
    header.addEventListener("click", () => {
      const body = document.getElementById(
        `scanner-cat-body-${header.dataset.catIdx}`
      );
      body.classList.toggle("open");
    });
  });

  bindScannerPlaceClicks(container);
  renderScannerMarkers(results, aiResult.categories);
}

function bindScannerPlaceClicks(container) {
  container.querySelectorAll(".scanner-place-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(el.dataset.scannerIndex);
      const place = Scraper.results[idx];
      if (!place) return;
      map.flyTo([place.lat, place.lng], 14);
      scannerMarkersLayer.eachLayer((layer) => {
        if (!layer.getLatLng) return;
        const pos = layer.getLatLng();
        if (
          Math.abs(pos.lat - place.lat) < 0.0001 &&
          Math.abs(pos.lng - place.lng) < 0.0001
        ) {
          layer.openPopup();
        }
      });
    });
  });
}

// --- Event Handlers (self-initializing) ---

(function initScanner() {
  // Load usage stats and Gemini API key
  Usage.load();
  GeminiKey.load();

  // Gemini API key input — save on change
  const geminiKeyInput = document.getElementById("gemini-api-key");
  geminiKeyInput.addEventListener("change", () => {
    GeminiKey.save(geminiKeyInput.value);
    showToast("Gemini API key saved");
  });

  // Toggle key visibility
  document
    .getElementById("gemini-key-toggle")
    .addEventListener("click", () => {
      const isPassword = geminiKeyInput.type === "password";
      geminiKeyInput.type = isPassword ? "text" : "password";
    });

  // Open scanner panel
  document
    .getElementById("open-scanner-btn")
    .addEventListener("click", () => {
      updateSidebarLevel("scanner");
    });

  // Back to places
  document
    .getElementById("scanner-back-btn")
    .addEventListener("click", () => {
      updateSidebarLevel("places");
    });

  // Start scan
  document
    .getElementById("start-scan-btn")
    .addEventListener("click", async () => {
      const query = document.getElementById("scanner-query").value.trim();
      if (!query) {
        showToast("Enter a search query");
        return;
      }
      if (!selectedStateId) {
        showToast("Select a state first");
        return;
      }
      if (!driveConnected) {
        showToast("Sign in to Google to use the scanner");
        return;
      }

      const cellSize = parseFloat(
        document.getElementById("scanner-grid-size").value
      );
      const concurrency = parseInt(
        document.getElementById("scanner-concurrency").value
      );

      document.getElementById("start-scan-btn").disabled = true;
      document.getElementById("stop-scan-btn").classList.remove("hidden");

      // Reset previous results UI
      document.getElementById("scanner-results").classList.add("hidden");
      document.getElementById("scanner-ai-section").classList.add("hidden");
      document.getElementById("scanner-ai-summary").classList.add("hidden");
      clearScannerMarkers();

      try {
        await Scraper.scan(selectedStateId, query, cellSize, concurrency);
      } catch (err) {
        if (err.name !== "AbortError") {
          console.error("Scan failed:", err);
          showToast("Scan failed: " + err.message);
        }
      }

      document.getElementById("start-scan-btn").disabled = false;
      document.getElementById("stop-scan-btn").classList.add("hidden");
    });

  // Stop scan
  document
    .getElementById("stop-scan-btn")
    .addEventListener("click", () => {
      Scraper.abort();
      showToast("Scan stopped");
      document.getElementById("start-scan-btn").disabled = false;
      document.getElementById("stop-scan-btn").classList.add("hidden");
      // Show partial results if any
      if (Scraper.results.length > 0) onScanComplete();
    });

  // Categorize with AI
  document
    .getElementById("categorize-btn")
    .addEventListener("click", async () => {
      if (Scraper.results.length === 0) return;

      const btn = document.getElementById("categorize-btn");
      const loading = document.getElementById("scanner-ai-loading");
      btn.classList.add("hidden");
      loading.classList.remove("hidden");

      try {
        const query = document.getElementById("scanner-query").value.trim();
        const aiResult = await categorizeWithGemini(Scraper.results, query);
        Scraper.categories = aiResult;
        renderCategorizedResults(Scraper.results, aiResult);
        showToast("AI categorization complete");
      } catch (err) {
        console.error("Gemini categorization failed:", err);
        showToast("AI categorization failed: " + err.message);
        btn.classList.remove("hidden");
      }

      loading.classList.add("hidden");
    });

  // Clear results
  document
    .getElementById("clear-scan-btn")
    .addEventListener("click", () => {
      Scraper.results = [];
      Scraper.seenPlaceIds.clear();
      Scraper.categories = null;
      clearScannerMarkers();
      document.getElementById("scanner-results").classList.add("hidden");
      document.getElementById("scanner-ai-section").classList.add("hidden");
      document.getElementById("scanner-ai-summary").classList.add("hidden");
      showScannerProgress(false);
      showToast("Scanner results cleared");
    });

  // Reset usage stats
  document
    .getElementById("usage-reset-btn")
    .addEventListener("click", () => {
      Usage.reset();
      showToast("Usage stats reset");
    });

  // Add place from scanner popup (event delegation)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".scanner-add-place-btn");
    if (!btn) return;
    const index = parseInt(btn.dataset.scannerIndex);
    const place = Scraper.results[index];
    if (place) {
      map.closePopup();
      addNewPlace(
        place.lat,
        place.lng,
        Scraper.currentStateId,
        place.name,
        place.address
      );
    }
  });
})();
