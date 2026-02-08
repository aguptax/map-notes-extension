// --- Wizard Navigation ---
const TOTAL_STEPS = 7; // steps 0-6 are numbered, step 7 is the "done" screen
let currentStep = 0;

const steps = document.querySelectorAll(".step");
const dots = document.querySelectorAll(".stepper-dot");
const lines = document.querySelectorAll(".stepper-line");
const progressFill = document.getElementById("progress-fill");
const stepCount = document.getElementById("step-count");
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");
const footerEl = document.querySelector(".footer");
const stepperEl = document.getElementById("stepper");

function goToStep(n) {
  currentStep = n;

  // Show/hide steps
  steps.forEach((s) => {
    s.classList.toggle("active", parseInt(s.dataset.step) === n);
  });

  // Update stepper dots & lines
  dots.forEach((dot) => {
    const idx = parseInt(dot.dataset.step);
    dot.classList.remove("active", "done");
    if (idx === n) dot.classList.add("active");
    else if (idx < n) dot.classList.add("done");
  });
  lines.forEach((line, i) => {
    line.classList.toggle("done", i < n);
  });

  // Progress bar
  const pct = Math.min(((n + 1) / TOTAL_STEPS) * 100, 100);
  progressFill.style.width = pct + "%";

  // Step counter
  if (n <= 6) {
    stepCount.textContent = `Step ${n + 1} of ${TOTAL_STEPS}`;
  }

  // Back button visibility
  prevBtn.style.display = n > 0 && n <= 6 ? "inline-flex" : "none";

  // Next button text & visibility
  if (n >= 6) {
    // On step 7 (test) — hide next, on done screen — hide footer
    nextBtn.style.display = "none";
  } else {
    nextBtn.style.display = "inline-flex";
    nextBtn.textContent = "Next";
  }

  // Show saved Client ID on test step
  if (n === 6) {
    showTestClientId();
  }

  // Hide footer and stepper on done screen
  if (n === 7) {
    footerEl.style.display = "none";
    stepperEl.style.display = "none";
  } else {
    footerEl.style.display = "flex";
    stepperEl.style.display = "flex";
  }
}

nextBtn.addEventListener("click", () => {
  if (currentStep < 6) goToStep(currentStep + 1);
});

prevBtn.addEventListener("click", () => {
  if (currentStep > 0) goToStep(currentStep - 1);
});

// --- Extension Info (Step 1) ---
document.getElementById("ext-id").textContent = chrome.runtime.id;

const redirectUri = chrome.identity.getRedirectURL();
document.getElementById("redirect-uri").textContent = redirectUri;
document.getElementById("redirect-uri-copy").textContent = redirectUri;

// --- Load saved Client ID ---
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

// --- Save Client ID (Step 6) ---
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
  if (clientId.includes("YOUR_CLIENT_ID") || clientId.length < 30) {
    status.textContent = "That's the placeholder — paste your real Client ID from Google Cloud Console";
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

// --- Copy buttons ---
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

// --- Show saved Client ID on Test step ---
function showTestClientId() {
  chrome.storage.local.get("oauth_client_id").then((stored) => {
    const box = document.getElementById("test-client-id-box");
    const idEl = document.getElementById("test-client-id");
    if (stored.oauth_client_id) {
      idEl.textContent = stored.oauth_client_id;
      box.style.display = "flex";
    } else {
      idEl.textContent = "Not saved yet!";
      box.style.display = "flex";
      box.style.borderColor = "#ea4335";
    }
  });
}

// --- Test Connection (Step 7) ---
document.getElementById("test-btn").addEventListener("click", async () => {
  const resultEl = document.getElementById("test-result");
  const spinner = document.getElementById("test-spinner");
  const testBtn = document.getElementById("test-btn");

  // Refresh the displayed Client ID
  showTestClientId();

  // Check if Client ID is saved
  const stored = await chrome.storage.local.get("oauth_client_id");
  if (!stored.oauth_client_id) {
    resultEl.style.display = "block";
    resultEl.innerHTML = `<div class="result-error">
      <div class="title">Client ID missing</div>
      <div class="detail">Go back to Step 6 and save your Client ID first.</div>
    </div>`;
    return;
  }

  // Validate it's not the placeholder
  if (stored.oauth_client_id.includes("YOUR_CLIENT_ID") || stored.oauth_client_id.length < 30) {
    resultEl.style.display = "block";
    resultEl.innerHTML = `<div class="result-error">
      <div class="title">Invalid Client ID</div>
      <div class="detail">The saved Client ID is the placeholder, not a real one. Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank">Google Cloud Console</a>, create an OAuth Client ID, and paste it in Step 6.</div>
    </div>`;
    return;
  }

  // Show loading state
  testBtn.disabled = true;
  testBtn.style.opacity = "0.5";
  spinner.style.display = "inline";
  resultEl.style.display = "none";

  try {
    // Try to sign in via background service worker — pass clientId directly
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "SIGN_IN", clientId: stored.oauth_client_id }, (res) => {
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

    // Success — show result then move to done screen
    resultEl.style.display = "block";
    resultEl.innerHTML = `<div class="result-success">
      <img src="${user.picture || ""}" alt="" />
      <div>
        <div class="title">Connection successful!</div>
        <div class="detail">Signed in as <strong>${user.name || "User"}</strong> (${user.email || ""})</div>
      </div>
    </div>`;

    // Auto-advance to done screen after a short delay
    setTimeout(() => goToStep(7), 1500);
  } catch (err) {
    resultEl.style.display = "block";
    let hint = "";
    const msg = err.message || "";
    if (msg.includes("invalid_client")) {
      hint = `Your Client ID was not recognized by Google. Common fixes:<br>
        1. Make sure you created an <strong>OAuth Client ID</strong> (not an API key) in <a href="https://console.cloud.google.com/apis/credentials" target="_blank">Credentials</a><br>
        2. Application type must be <strong>Web application</strong><br>
        3. The Redirect URI must be: <code>${chrome.identity.getRedirectURL()}</code>`;
    } else if (msg.includes("redirect_uri_mismatch")) {
      hint = `The Redirect URI doesn't match. In <a href="https://console.cloud.google.com/apis/credentials" target="_blank">Google Cloud Console</a>, edit your OAuth Client ID and set the Authorized redirect URI to:<br><code>${chrome.identity.getRedirectURL()}</code>`;
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

// --- Close button (Done screen) ---
document.getElementById("close-btn").addEventListener("click", () => {
  window.close();
});

// --- Init: start at step 0 ---
goToStep(0);
