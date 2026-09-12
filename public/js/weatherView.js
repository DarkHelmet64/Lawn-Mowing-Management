import { syncWeather, loadCachedWeather } from "./weather.js";
import { getSettings, saveSettings } from "./settings.js";
import { growthPotentialSeries, weeklyRainfall, profileFor } from "./growthPotential.js";
import { renderLineChart, renderBarChart } from "./charts.js";
import { byId, formatDateDisplay } from "./utils.js";

// Weather is always fetched from the start of the calendar year, so there's
// enough history to compute "days since last mow" even early in the season.
const FETCH_SINCE = `${new Date().getFullYear()}-01-01`;

let lastDays = [];
let backgroundSyncStarted = false;

function buildSeries(settings) {
  return growthPotentialSeries(lastDays, profileFor(settings.grassType));
}

function renderCharts(series) {
  renderLineChart(
    byId("weather-chart-gp"),
    series.map((d) => ({ label: formatDateDisplay(d.date).slice(0, 5), value: d.gp * 100 }))
  );

  const weeks = weeklyRainfall(lastDays);
  renderBarChart(
    byId("weather-chart-rain"),
    weeks.slice(-12).map((w) => ({ label: formatDateDisplay(w.weekStart).slice(0, 5), value: w.totalPrecipIn }))
  );

  const recent = series.slice(-30).reverse();
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

  byId("save-gp-settings-btn").addEventListener("click", async () => {
    await saveSettings({
      grassType: byId("grass-type").value,
      mowThresholdGPDays: Number(byId("mow-threshold").value),
    });
    byId("gp-settings-saved").classList.remove("hidden");
    setTimeout(() => byId("gp-settings-saved").classList.add("hidden"), 1500);
    await liveSyncAndRender();
  });

  byId("refresh-weather-btn").addEventListener("click", () => liveSyncAndRender());

  await refreshWeatherView();
}
