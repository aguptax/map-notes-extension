const loginView = document.getElementById("login-view");
const mainView = document.getElementById("main-view");

async function showView() {
  const signedIn = await Auth.isSignedIn();
  if (signedIn) {
    loginView.classList.remove("active");
    mainView.classList.add("active");
    const user = await Auth.getUserInfo();
    if (user) {
      document.getElementById("user-avatar").src = user.picture || "";
      document.getElementById("user-name").textContent = user.name || "User";
      document.getElementById("user-email").textContent = user.email || "";
    }
  } else {
    loginView.classList.add("active");
    mainView.classList.remove("active");
  }
}

document.getElementById("sign-in-btn").addEventListener("click", async () => {
  try {
    await Auth.signIn();
    await showView();
  } catch (err) {
    console.error("Sign in failed:", err);
  }
});

document.getElementById("open-map-btn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_MAP" });
  window.close();
});

document.getElementById("sign-out-btn").addEventListener("click", async () => {
  await Auth.signOut();
  await showView();
});

// Setup guide links
document.getElementById("setup-link-login").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_SETUP" });
  window.close();
});
document.getElementById("setup-link-main").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_SETUP" });
  window.close();
});

// Init
showView();
