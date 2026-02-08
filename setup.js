// Show the extension ID and redirect URI automatically
document.getElementById("ext-id").textContent = chrome.runtime.id;

const redirectUri = chrome.identity.getRedirectURL();
document.getElementById("redirect-uri").textContent = redirectUri;
document.getElementById("redirect-uri-copy").textContent = redirectUri;

// Load saved Client ID if it exists
chrome.storage.local.get("oauth_client_id").then((stored) => {
  if (stored.oauth_client_id) {
    document.getElementById("client-id-input").value = stored.oauth_client_id;
    document.getElementById("save-status").textContent = "Previously saved";
    document.getElementById("save-status").style.display = "inline";
    document.getElementById("save-status").style.color = "#888";
    document.getElementById("client-id-saved-tip").style.display = "flex";
  }
});

// Save Client ID button
document.getElementById("save-client-id").addEventListener("click", () => {
  const clientId = document.getElementById("client-id-input").value.trim();
  if (!clientId) {
    document.getElementById("save-status").textContent = "Please paste a Client ID first";
    document.getElementById("save-status").style.display = "inline";
    document.getElementById("save-status").style.color = "#e94560";
    return;
  }
  if (!clientId.endsWith(".apps.googleusercontent.com")) {
    document.getElementById("save-status").textContent = "Client ID should end with .apps.googleusercontent.com";
    document.getElementById("save-status").style.display = "inline";
    document.getElementById("save-status").style.color = "#e94560";
    return;
  }
  chrome.storage.local.set({ oauth_client_id: clientId }).then(() => {
    document.getElementById("save-status").textContent = "Saved!";
    document.getElementById("save-status").style.display = "inline";
    document.getElementById("save-status").style.color = "#53d769";
    document.getElementById("client-id-saved-tip").style.display = "flex";
    document.getElementById("client-id-input").style.borderColor = "#53d769";
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
    resultEl.innerHTML = `<div style="background:#1a1a2e; border-left:3px solid #e94560; border-radius:4px; padding:10px 14px; font-size:13px; color:#e94560;">
      Save your Client ID in Step 6 first.
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
    resultEl.innerHTML = `<div style="background:#1a1a2e; border:1px solid #53d769; border-radius:8px; padding:16px; display:flex; align-items:center; gap:14px;">
      <img src="${user.picture || ""}" style="width:44px; height:44px; border-radius:50%;" />
      <div>
        <div style="color:#53d769; font-weight:600; font-size:14px; margin-bottom:2px;">Connection successful!</div>
        <div style="color:#ccc; font-size:13px;">Signed in as <strong>${user.name || "User"}</strong> (${user.email || ""})</div>
      </div>
    </div>`;
  } catch (err) {
    resultEl.style.display = "block";
    let hint = "";
    const msg = err.message || "";
    if (msg.includes("invalid_client")) {
      hint = "Check that your Client ID is correct.";
    } else if (msg.includes("redirect_uri_mismatch")) {
      hint = "The Redirect URI in Google Cloud Console doesn't match. Copy it from Step 1 and update it in Step 5.";
    } else if (msg.includes("canceled") || msg.includes("user denied")) {
      hint = "Sign-in was cancelled. Try again.";
    } else if (msg.includes("Client ID not configured")) {
      hint = "Save your Client ID in Step 6 first.";
    } else {
      hint = msg;
    }
    resultEl.innerHTML = `<div style="background:#1a1a2e; border:1px solid #e94560; border-radius:8px; padding:14px;">
      <div style="color:#e94560; font-weight:600; font-size:14px; margin-bottom:6px;">Connection failed</div>
      <div style="color:#ccc; font-size:13px;">${hint}</div>
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
