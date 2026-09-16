import { syncWeather, loadCachedWeather } from "./weather.js";
import { getSettings, saveSettings } from "./settings.js";
import {
  growthPotentialSeries,
  weeklyRainfall,
  weeklyGrowthPotential,
  monthlyGrowthPotential,
  profileFor,
} from "./growthPotential.js";
import { getTreatmentStatuses, cumulativeGDD, TREATMENT_STATE_BADGE } from "./lawnTreatments.js";
import { renderLineChart, renderBarChart } from "./charts.js";
import { byId, escapeHtml, formatDateDisplay, formatMonthDisplay } from "./utils.js";

// Weather is always fetched from the start of the calendar year, so there's
// enough history to compute "days since last mow" even early in the season.
const FETCH_SINCE = `${new Date().getFullYear()}-01-01`;

let lastDays = [];
let lastSeries = [];
let backgroundSyncStarted = false;

// Growth Potential chart view - kept as in-page UI state rather than a
// saved setting, since it's just how you're currently looking at the data.
let gpViewMode = "weekly";
let gpViewCount = 8;

function buildSeries(settings) {
  return growthPotentialSeries(lastDays, profileFor(settings.grassType));
}

function gpChartPoints(series) {
  if (gpViewMode === "monthly") {
    const months = monthlyGrowthPotential(series);
    return months.slice(-gpViewCount).map((m) => ({ label: formatMonthDisplay(m.month), value: m.gp * 100 }));
  }
  if (gpViewMode === "annual") {
    const months = monthlyGrowthPotential(series);
    return months.map((m) => ({ label: formatMonthDisplay(m.month), value: m.gp * 100 }));
  }
  const weeks = weeklyGrowthPotential(series);
  return weeks.slice(-gpViewCount).map((w) => ({ label: formatDateDisplay(w.weekStart).slice(0, 5), value: w.gp * 100 }));
}

function renderGpChart() {
  renderLineChart(byId("weather-chart-gp"), gpChartPoints(lastSeries));
}

function renderTreatmentWindows(settings) {
  byId("stat-gdd").textContent = cumulativeGDD(lastDays).toFixed(0);
  const statuses = getTreatmentStatuses(lastDays, settings);
  byId("treatment-window-list").innerHTML = statuses
    .map((t) => {
      const badge = TREATMENT_STATE_BADGE[t.state];
      return `
      <li>
        <strong>${escapeHtml(t.label)}</strong> <span class="badge ${badge.cls}">${badge.label}</span>
        <span class="hint-text">${escapeHtml(t.detail)}</span>
      </li>`;
    })
    .join("");
}

function renderCharts(series) {
  lastSeries = series;
  renderGpChart();

  const weeks = weeklyRainfall(lastDays);
  renderBarChart(
    byId("weather-chart-rain"),
    weeks.slice(-12).map((w) => ({ label: formatDateDisplay(w.weekStart).slice(0, 5), value: w.totalPrecipIn }))
  );

  const recent = series.slice(-14).reverse();
  byId("weather-table-body").innerHTML = recent
    .map(
      (d) => `
      <tr>
        <td>${formatDateDisplay(d.date)}</td>
        <td>${d.tmaxF?.toFixed(0) ?? ""}</td>
        <td>${d.tminF?.toFixed(0) ?? ""}</td>
        <td>${(d.gp * 100).toFixed(0)}%</td>
        <td>${(d.precipIn ?? 0).toFixed(2)}</td>
      </tr>`
    )
    .join("");
}

// Fast path: renders from whatever is already cached in Firestore, with no
// live call out to Open-Meteo. This is what the Dashboard and Settings
// (mow-readiness) rely on, so their initial render never blocks on a
// third-party API.
export async function refreshWeatherView() {
  const settings = await getSettings();
  lastDays = await loadCachedWeather(FETCH_SINCE);
  const series = buildSeries(settings);
  renderCharts(series);
  renderTreatmentWindows(settings);
  return { days: lastDays, series };
}

// Live path: actually calls Open-Meteo and re-caches the result. Used for
// the explicit "Refresh Weather Data" button/settings save, and for the one
// background sync kicked off after login.
async function liveSyncAndRender() {
  const settings = await getSettings();
  try {
    lastDays = await syncWeather(FETCH_SINCE);
  } catch (err) {
    console.error("Weather sync failed, keeping cached data", err);
  }
  const series = buildSeries(settings);
  renderCharts(series);
  renderTreatmentWindows(settings);
  return { days: lastDays, series };
}

// Kicks off at most one live sync per page session, in the background, and
// fires a "weather:synced" event once fresh data lands so other views
// (Dashboard, Settings) can pick it up - without making anyone's initial
// render wait on a third-party API first.
export function startBackgroundWeatherSync() {
  if (backgroundSyncStarted) return;
  backgroundSyncStarted = true;
  liveSyncAndRender()
    .then((result) => document.dispatchEvent(new CustomEvent("weather:synced", { detail: result })))
    .catch((err) => console.error("Background weather sync failed", err));
}

export async function initWeatherView() {
  const settings = await getSettings();
  byId("grass-type").value = settings.grassType;
  byId("mow-threshold").value = settings.mowThresholdGPDays;
  byId("crabgrass-gdd-start").value = settings.crabgrassGddStart;
  byId("crabgrass-gdd-end").value = settings.crabgrassGddEnd;
  byId("weedfeed-gdd-start").value = settings.weedFeedGddStart;
  byId("weedfeed-gdd-end").value = settings.weedFeedGddEnd;

  byId("save-gp-settings-btn").addEventListener("click", async () => {
    await saveSettings({
      grassType: byId("grass-type").value,
      mowThresholdGPDays: Number(byId("mow-threshold").value),
      crabgrassGddStart: Number(byId("crabgrass-gdd-start").value),
      crabgrassGddEnd: Number(byId("crabgrass-gdd-end").value),
      weedFeedGddStart: Number(byId("weedfeed-gdd-start").value),
      weedFeedGddEnd: Number(byId("weedfeed-gdd-end").value),
    });
    byId("gp-settings-saved").classList.remove("hidden");
    setTimeout(() => byId("gp-settings-saved").classList.add("hidden"), 1500);
    await liveSyncAndRender();
  });

  byId("refresh-weather-btn").addEventListener("click", () => liveSyncAndRender());

  const gpViewModeSelect = byId("gp-view-mode");
  const gpViewCountInput = byId("gp-view-count");
  const gpViewCountWrap = byId("gp-view-count-wrap");

  function updateGpViewControls() {
    gpViewCountWrap.classList.toggle("hidden", gpViewMode === "annual");
    gpViewCountWrap.firstChild.textContent = gpViewMode === "monthly" ? "Number of Months" : "Number of Weeks";
    gpViewCountInput.max = gpViewMode === "monthly" ? 24 : 52;
  }

  gpViewModeSelect.value = gpViewMode;
  gpViewCountInput.value = gpViewCount;
  updateGpViewControls();

  gpViewModeSelect.addEventListener("change", () => {
    gpViewMode = gpViewModeSelect.value;
    updateGpViewControls();
    renderGpChart();
  });

  gpViewCountInput.addEventListener("change", () => {
    gpViewCount = Math.max(1, Number(gpViewCountInput.value) || 1);
    gpViewCountInput.value = gpViewCount;
    renderGpChart();
  });

  await refreshWeatherView();
}
