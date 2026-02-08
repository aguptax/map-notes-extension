# MapNotes - Mark & Annotate Places

A Chrome/Edge extension to mark places on a map of India, add notes and attachments, organized by state. Works offline with optional Google Drive sync.

## Features

- **State-based navigation** - Browse and organize places by Indian states
- **Nearby place search** - Click anywhere on the map to discover nearby places via Google Places API
- **Search places** - Search for locations within a state, with "Search this area" on pan/zoom
- **Notes & attachments** - Add notes and upload files to each saved place
- **Measure tool** - Measure distances and areas directly on the map
- **Google Drive sync** - Optional cloud sync for cross-device access
- **Offline-first** - All data stored locally, works without internet

## Installation

### 1. Download the extension

**Option A: Clone with Git**
```bash
git clone https://github.com/YOUR_USERNAME/map-notes-extension.git
```

**Option B: Download ZIP**
1. Click the green **Code** button on the repository page
2. Select **Download ZIP**
3. Extract the ZIP to a folder on your computer

### 2. Load in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `map-notes-extension` folder you downloaded
5. The MapNotes icon will appear in your toolbar

### 3. Load in Microsoft Edge

1. Open Edge and go to `edge://extensions/`
2. Enable **Developer mode** (toggle in the left sidebar)
3. Click **Load unpacked**
4. Select the `map-notes-extension` folder you downloaded
5. The MapNotes icon will appear in your toolbar

## Setup Google Drive Sync (Optional)

To enable Google Drive sync and Google Places search:

1. Click the MapNotes extension icon in your toolbar
2. Click **Setup** on the offline mode banner
3. Enter your Google OAuth Client ID
4. Click **Test Connectivity** to verify
5. Sign in with your Google account

### Getting a Google OAuth Client ID

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Enable these APIs:
   - Google Drive API
   - Places API (New)
4. Go to **Credentials** > **Create Credentials** > **OAuth 2.0 Client ID**
5. Set application type to **Chrome Extension**
6. Add your extension ID (shown in `chrome://extensions/` or `edge://extensions/`)
7. Copy the Client ID and paste it in the MapNotes setup page

## Usage

1. **Click the extension icon** to open the map
2. **Click a state** on the map to select it
3. **Click inside the state** to search for nearby places or add a custom place
4. **Use the search bar** to find specific locations
5. **Save places** with custom names, colors, notes, and attachments
6. **Use the ruler icon** (top-left) to measure distances and areas

## Tech Stack

- Leaflet.js for map rendering
- Google Maps satellite tiles
- Google Places API (New) for place search
- Nominatim/OpenStreetMap as fallback geocoder
- Chrome Extension Manifest V3
- Local storage + optional Google Drive sync
