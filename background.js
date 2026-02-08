// Open setup guide on first install
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") });
  }
});

// Read OAuth config from manifest.json
const manifest = chrome.runtime.getManifest();
const CLIENT_ID = manifest.oauth2?.client_id || "";
const SCOPES = (manifest.oauth2?.scopes || []).join(" ");

// Build Google OAuth URL for implicit grant flow
function buildAuthUrl() {
  const redirectUrl = chrome.identity.getRedirectURL();
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUrl,
    response_type: "token",
    scope: SCOPES,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

// Parse token from OAuth redirect URL hash fragment
function parseToken(responseUrl) {
  const hash = responseUrl.split("#")[1];
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const token = params.get("access_token");
  const expiresIn = parseInt(params.get("expires_in") || "3600");
  if (!token) return null;
  return { token, expiresIn };
}

// Launch OAuth flow via launchWebAuthFlow (works in Chrome + Edge)
function launchAuth(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: buildAuthUrl(), interactive },
      (responseUrl) => {
        if (chrome.runtime.lastError || !responseUrl) {
          reject(new Error(chrome.runtime.lastError?.message || "Auth failed"));
          return;
        }
        const result = parseToken(responseUrl);
        if (result) {
          chrome.storage.local.set({
            access_token: result.token,
            token_expiry: Date.now() + result.expiresIn * 1000,
          });
          resolve(result.token);
        } else {
          reject(new Error("No access token in response"));
        }
      }
    );
  });
}

// Listen for messages from popup/map page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "OPEN_MAP") {
    chrome.tabs.create({ url: chrome.runtime.getURL("map.html") });
  }
  if (message.type === "OPEN_SETUP") {
    chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") });
  }

  // Get token: check storage first, then try silent re-auth
  if (message.type === "GET_TOKEN") {
    chrome.storage.local.get(["access_token", "token_expiry"]).then(async (stored) => {
      // Return cached token if still valid
      if (stored.access_token && stored.token_expiry > Date.now()) {
        sendResponse({ token: stored.access_token });
        return;
      }
      // Try silent (non-interactive) re-auth
      try {
        const token = await launchAuth(false);
        sendResponse({ token });
        return;
      } catch {
        // Silent auth failed
      }
      // If caller wants interactive, launch full auth
      if (message.interactive) {
        try {
          const token = await launchAuth(true);
          sendResponse({ token });
        } catch (err) {
          sendResponse({ error: err.message });
        }
      } else {
        sendResponse({ token: null });
      }
    });
    return true; // keep channel open for async response
  }

  // Sign in: always interactive
  if (message.type === "SIGN_IN") {
    launchAuth(true)
      .then((token) => sendResponse({ token }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  // Sign out: revoke token + clear storage
  if (message.type === "SIGN_OUT") {
    chrome.storage.local.get("access_token").then(async (stored) => {
      if (stored.access_token) {
        await fetch(
          `https://accounts.google.com/o/oauth2/revoke?token=${stored.access_token}`
        ).catch(() => {});
      }
      await chrome.storage.local.remove(["access_token", "token_expiry"]);
      sendResponse({ success: true });
    });
    return true;
  }
});
