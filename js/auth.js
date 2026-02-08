// Google OAuth helper — all auth flows go through the background service worker
// which uses chrome.identity.launchWebAuthFlow (works in Chrome + Edge)

const Auth = {
  // Read Client ID from storage to pass to background worker
  async _getClientId() {
    const stored = await chrome.storage.local.get("oauth_client_id");
    return stored.oauth_client_id || undefined;
  },

  // Get auth token (interactive = show login prompt if needed)
  async getToken(interactive = false) {
    const clientId = await this._getClientId();
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "GET_TOKEN", interactive, clientId },
        (response) => {
          if (response?.error) reject(new Error(response.error));
          else resolve(response?.token || null);
        }
      );
    });
  },

  // Sign in (always shows Google login prompt)
  async signIn() {
    const clientId = await this._getClientId();
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "SIGN_IN", clientId }, (response) => {
        if (response?.error) reject(new Error(response.error));
        else resolve(response?.token);
      });
    });
  },

  // Sign out (revoke token + clear storage)
  async signOut() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "SIGN_OUT" }, resolve);
    });
  },

  // Get user profile info
  async getUserInfo() {
    const token = await this.getToken(false);
    if (!token) return null;
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return res.json();
  },

  // Check if user is signed in
  async isSignedIn() {
    try {
      const token = await this.getToken(false);
      return !!token;
    } catch {
      return false;
    }
  },
};
