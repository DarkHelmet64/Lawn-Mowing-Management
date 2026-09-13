import { isConfigured } from "./firebase.js";
import { watchAuth, login, logout } from "./auth.js";
import { byId } from "./utils.js";
import { loadCustomers, initCustomersView, refreshCustomersView } from "./customers.js";
import { loadVisits, initMowLogView, refreshMowLogView } from "./mowLog.js";
import { loadSprays, initSprayLogView, refreshSprayLogView } from "./sprayLog.js";
import { loadTasks, initMaintenanceView, refreshMaintenanceView } from "./maintenance.js";
import { loadEquipment, initEquipmentView, refreshEquipmentView } from "./equipment.js";
import { loadLocations, initLocationsView, refreshLocationsView } from "./locations.js";
import { loadAreas, initAreasView, refreshAreasView } from "./areas.js";
import { loadYardFeatures, initYardFeaturesView, refreshYardFeaturesView } from "./yardFeatures.js";
import { loadProducts, initProductsView, refreshProductsView } from "./products.js";
import { loadPurchases, initPurchasesView, refreshPurchasesView } from "./productPurchases.js";
import { initWeatherView, startBackgroundWeatherSync } from "./weatherView.js";
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
  await Promise.all([
    loadCustomers(),
    loadVisits(),
    loadSprays(),
    loadTasks(),
    loadEquipment(),
    loadLocations(),
    loadAreas(),
    loadYardFeatures(),
    loadProducts(),
    loadPurchases(),
  ]);
  initEventLogView();
  document.addEventListener("event:logged", () => refreshDashboard());
  document.addEventListener("weather:synced", () => refreshDashboard());
  initView("dashboard");
  startBackgroundWeatherSync();
}

function initView(view) {
  if (initializedViews.has(view)) {
    if (view === "dashboard") refreshDashboard();
    if (view === "mow-log") refreshMowLogView();
    if (view === "spray-log") refreshSprayLogView();
    if (view === "settings") {
      refreshCustomersView();
      refreshLocationsView();
      refreshAreasView();
      refreshEquipmentView();
      refreshMaintenanceView();
      refreshYardFeaturesView();
      refreshProductsView();
      refreshPurchasesView();
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
      initLocationsView();
      initAreasView();
      initEquipmentView();
      initMaintenanceView();
      initYardFeaturesView();
      initProductsView();
      initPurchasesView();
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
