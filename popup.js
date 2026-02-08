const disconnectedEl = document.getElementById("drive-disconnected");
const connectedEl = document.getElementById("drive-connected");

async function showDriveStatus() {
  const signedIn = await Auth.isSignedIn();
  if (signedIn) {
    disconnectedEl.style.display = "none";
    connectedEl.style.display = "block";
    const user = await Auth.getUserInfo();
    if (user) {
      document.getElementById("user-avatar").src = user.picture || "";
      document.getElementById("user-name").textContent = user.name || "User";
      document.getElementById("user-email").textContent = user.email || "";
    }
  } else {
    disconnectedEl.style.display = "block";
    connectedEl.style.display = "none";
  }
}

// Open Map — always works
document.getElementById("open-map-btn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_MAP" });
  window.close();
});

// Connect Google Drive
document.getElementById("sign-in-btn").addEventListener("click", async () => {
  try {
    await Auth.signIn();
    await showDriveStatus();
  } catch (err) {
    console.error("Sign in failed:", err);
  }
});

// Disconnect Drive
document.getElementById("sign-out-btn").addEventListener("click", async () => {
  await Auth.signOut();
  await showDriveStatus();
});

// Setup Guide
document.getElementById("setup-link").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_SETUP" });
  window.close();
});

// Init
showDriveStatus();
