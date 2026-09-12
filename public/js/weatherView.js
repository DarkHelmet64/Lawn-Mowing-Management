import { syncWeather, loadCachedWeather } from "./weather.js";
import { getSettings, saveSettings } from "./settings.js";
import { growthPotentialSeries, weeklyRainfall, profileFor } from "./growthPotential.js";
import { renderLineChart, renderBarChart } from "./charts.js";
import { byId, formatDateDisplay } from "./utils.js";

// Weather is always fetched from the start of the calendar year, so there's
// enough history to compute "days since last mow" even early in the season.
const FETCH_SINCE = `${new Date().getFullYear()}-01-01`;

let lastDays = [];

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
    await refreshWeatherView();
  });

  byId("refresh-weather-btn").addEventListener("click", () => refreshWeatherView());

  await refreshWeatherView();
}

export async function refreshWeatherView() {
  const settings = await getSettings();
  try {
    lastDays = await syncWeather(FETCH_SINCE);
  } catch (err) {
    console.error("Weather sync failed, falling back to cached data", err);
    lastDays = await loadCachedWeather(FETCH_SINCE);
  }

  const profile = profileFor(settings.grassType);
  const series = growthPotentialSeries(lastDays, profile);

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

  return { days: lastDays, series };
}
