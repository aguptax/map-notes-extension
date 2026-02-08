// Show the extension ID and redirect URI automatically
document.getElementById("ext-id").textContent = chrome.runtime.id;

const redirectUri = chrome.identity.getRedirectURL();
document.getElementById("redirect-uri").textContent = redirectUri;
document.getElementById("redirect-uri-copy").textContent = redirectUri;

// Load saved Client ID if it exists
chrome.storage.local.get("oauth_client_id").then((stored) => {
  if (stored.oauth_client_id) {
    document.getElementById("client-id-input").value = stored.oauth_client_id;
    const status = document.getElementById("save-status");
    status.textContent = "Previously saved";
    status.className = "status-label muted";
    status.style.display = "inline";
    document.getElementById("client-id-saved-tip").style.display = "flex";
  }
});

// Save Client ID button
document.getElementById("save-client-id").addEventListener("click", () => {
  const clientId = document.getElementById("client-id-input").value.trim();
  const status = document.getElementById("save-status");

  if (!clientId) {
    status.textContent = "Please paste a Client ID first";
    status.className = "status-label error";
    status.style.display = "inline";
    return;
  }
  if (!clientId.endsWith(".apps.googleusercontent.com")) {
    status.textContent = "Client ID should end with .apps.googleusercontent.com";
    status.className = "status-label error";
    status.style.display = "inline";
    return;
  }
  chrome.storage.local.set({ oauth_client_id: clientId }).then(() => {
    status.textContent = "Saved!";
    status.className = "status-label success";
    status.style.display = "inline";
    document.getElementById("client-id-saved-tip").style.display = "flex";
    document.getElementById("client-id-input").style.borderColor = "#34a853";
  });
});

// Copy buttons
document.querySelectorAll(".copy-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const targetId = btn.dataset.copy;
    const text = document.getElementById(targetId).textContent;
    navigator.clipboard.writeText(text).then(() => {
      const original = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = original), 1500);
    });
  });
});

// Test Connection button
document.getElementById("test-btn").addEventListener("click", async () => {
  const resultEl = document.getElementById("test-result");
  const spinner = document.getElementById("test-spinner");
  const testBtn = document.getElementById("test-btn");

  // Check if Client ID is saved
  const stored = await chrome.storage.local.get("oauth_client_id");
  if (!stored.oauth_client_id) {
    resultEl.style.display = "block";
    resultEl.innerHTML = `<div class="result-error">
      <div class="title">Client ID missing</div>
      <div class="detail">Save your Client ID in Step 6 first.</div>
    </div>`;
    return;
  }

  // Show loading state
  testBtn.disabled = true;
  testBtn.style.opacity = "0.5";
  spinner.style.display = "inline";
  resultEl.style.display = "none";

  try {
    // Try to sign in via background service worker
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "SIGN_IN" }, (res) => {
        if (res?.error) reject(new Error(res.error));
        else resolve(res);
      });
    });

    if (!response?.token) throw new Error("No token received");

    // Fetch user profile to verify token works
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${response.token}` },
    });
    if (!userRes.ok) throw new Error("Failed to fetch user info");
    const user = await userRes.json();

    // Success
    resultEl.style.display = "block";
    resultEl.innerHTML = `<div class="result-success">
      <img src="${user.picture || ""}" alt="" />
      <div>
        <div class="title">Connection successful!</div>
        <div class="detail">Signed in as <strong>${user.name || "User"}</strong> (${user.email || ""})</div>
      </div>
    </div>`;
  } catch (err) {
    resultEl.style.display = "block";
    let hint = "";
    const msg = err.message || "";
    if (msg.includes("invalid_client")) {
      hint = "Check that your Client ID is correct and the OAuth client type is \"Web application\".";
    } else if (msg.includes("redirect_uri_mismatch")) {
      hint = "The Redirect URI in Google Cloud Console doesn't match. Copy it from Step 1 and update it in Step 5.";
    } else if (msg.includes("canceled") || msg.includes("user denied")) {
      hint = "Sign-in was cancelled. Try again.";
    } else if (msg.includes("Client ID not configured")) {
      hint = "Save your Client ID in Step 6 first.";
    } else {
      hint = msg;
    }
    resultEl.innerHTML = `<div class="result-error">
      <div class="title">Connection failed</div>
      <div class="detail">${hint}</div>
    </div>`;
  } finally {
    testBtn.disabled = false;
    testBtn.style.opacity = "1";
    spinner.style.display = "none";
  }
});

// Close button
document.getElementById("close-btn").addEventListener("click", () => {
  window.close();
});
