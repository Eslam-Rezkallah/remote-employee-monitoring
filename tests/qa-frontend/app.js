/**
 * tests/qa-frontend/app.js
 *
 * Narrowed scope — chat + calls only. The old jira/clickup/etc. pages
 * are intentionally not referenced here so they don't load.
 */

import {
  getBaseUrl,
  setBaseUrl,
  getUser,
  clearSession,
} from "./api/client.js";
import { disconnectAll } from "./api/socket-client.js";

// Lazy page loaders. Only 5 pages — focused on chat + calls flow.
const pages = {
  auth: () => import("./pages/auth.js"),
  rooms: () => import("./pages/rooms.js"),
  messages: () => import("./pages/messages.js"),
  calls: () => import("./pages/calls.js"),
  socket: () => import("./pages/socket.js"),
};

const baseUrlInput = document.getElementById("baseUrl");
baseUrlInput.value = getBaseUrl();
baseUrlInput.addEventListener("change", (e) => setBaseUrl(e.target.value));

function refreshUserChip() {
  const user = getUser();
  const chip = document.getElementById("userChip");
  const logoutBtn = document.getElementById("logoutBtn");
  if (user) {
    chip.textContent = `${user.username} (${String(user._id).slice(-6)})`;
    logoutBtn.classList.remove("hidden");
  } else {
    chip.textContent = "—";
    logoutBtn.classList.add("hidden");
  }
}
window.addEventListener("storage", refreshUserChip);
refreshUserChip();

document.getElementById("logoutBtn").addEventListener("click", () => {
  disconnectAll();
  clearSession();
  refreshUserChip();
  navigate("auth");
});

async function navigate(pageName) {
  const host = document.getElementById("page");
  host.innerHTML = '<div class="text-slate-400 p-6">Loading…</div>';
  document.querySelectorAll(".nav-btn").forEach((b) => {
    b.classList.toggle("bg-slate-700", b.dataset.page === pageName);
  });
  try {
    const mod = await pages[pageName]();
    host.innerHTML = "";
    await mod.render(host);
    location.hash = pageName;
    refreshUserChip();
  } catch (err) {
    host.innerHTML = `<pre class="bg-rose-100 text-rose-800 p-4 rounded">Failed to load page "${pageName}":\n${err.stack || err.message}</pre>`;
  }
}

document.querySelectorAll(".nav-btn").forEach((b) => {
  b.addEventListener("click", () => navigate(b.dataset.page));
});

const initial = (location.hash.replace("#", "") || "auth").trim();
navigate(pages[initial] ? initial : "auth");
