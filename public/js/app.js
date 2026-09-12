import { isConfigured } from "./firebase.js";
import { watchAuth, login, logout } from "./auth.js";
import { byId } from "./utils.js";
import { loadCustomers, initCustomersView, refreshCustomersView } from "./customers.js";
import { loadVisits, initMowLogView, refreshMowLogView } from "./mowLog.js";
import { loadSprays, initSprayLogView, refreshSprayLogView } from "./sprayLog.js";
import { loadTasks, initMaintenanceView, refreshMaintenanceView } from "./maintenance.js";
import { loadEquipment, initEquipmentView, refreshEquipmentView } from "./equipment.js";
import { loadYardFeatures, initYardFeaturesView, refreshYardFeaturesView } from "./yardFeatures.js";
import { initWeatherView } from "./weatherView.js";
import { refreshDashboard } from "./dashboard.js";
import { initEventLogView } from "./eventLog.js";

const initializedViews = new Set();

function showSetupBanner() {
  byId("setup-banner").classList.remove("hidden");
  byId("login-view").classList.add("hidden");
  byId("app-view").classList.add("hidden");
}

function showLogin() {
  byId("login-view").classList.remove("hidden");
  byId("app-view").classList.add("hidden");
}

async function showApp() {
  byId("login-view").classList.add("hidden");
  byId("app-view").classList.remove("hidden");
  await Promise.all([loadCustomers(), loadVisits(), loadSprays(), loadTasks(), loadEquipment(), loadYardFeatures()]);
  initEventLogView();
  document.addEventListener("event:logged", () => refreshDashboard());
  initView("dashboard");
}

function initView(view) {
  if (initializedViews.has(view)) {
    if (view === "dashboard") refreshDashboard();
    if (view === "mow-log") refreshMowLogView();
    if (view === "spray-log") refreshSprayLogView();
    if (view === "settings") {
      refreshCustomersView();
      refreshEquipmentView();
      refreshMaintenanceView();
      refreshYardFeaturesView();
    }
    return;
  }
  initializedViews.add(view);
  switch (view) {
    case "dashboard":
      refreshDashboard();
      break;
    case "mow-log":
      initMowLogView();
      break;
    case "spray-log":
      initSprayLogView();
      break;
    case "settings":
      initCustomersView();
      initEquipmentView();
      initMaintenanceView();
      initYardFeaturesView();
      break;
    case "weather":
      initWeatherView();
      break;
  }
}

function switchView(view) {
  document.querySelectorAll(".view").forEach((el) => el.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));
  byId(`view-${view}`).classList.add("active");
  initView(view);
}

function setupNav() {
  document.querySelectorAll(".nav-btn").forEach((btn) => btn.addEventListener("click", () => switchView(btn.dataset.view)));
}

function setupLoginForm() {
  byId("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    byId("login-error").classList.add("hidden");
    try {
      await login(byId("login-email").value, byId("login-password").value);
    } catch (err) {
      console.error("Sign-in failed", err);
      byId("login-error").textContent = "Sign-in failed. Check your email and password.";
      byId("login-error").classList.remove("hidden");
    }
  });
}

function setupLogout() {
  byId("logout-btn").addEventListener("click", () => logout());
}

function main() {
  if (!isConfigured) {
    showSetupBanner();
    return;
  }
  setupNav();
  setupLoginForm();
  setupLogout();
  watchAuth(showApp, showLogin);
}

main();
