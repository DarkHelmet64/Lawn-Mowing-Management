import { syncWeather, loadCachedWeather } from "./weather.js";
import { getSettings, saveSettings } from "./settings.js";
import { accumulateGDD, weeklyRainfall } from "./gdd.js";
import { renderLineChart, renderBarChart } from "./charts.js";
import { byId, formatDateDisplay } from "./utils.js";

let lastDays = [];

export async function initWeatherView() {
  const settings = await getSettings();
  byId("gdd-base-temp").value = settings.baseTempF;
  byId("gdd-season-start").value = settings.seasonStart;

  byId("save-gdd-settings-btn").addEventListener("click", async () => {
    await saveSettings({
      baseTempF: Number(byId("gdd-base-temp").value),
      seasonStart: byId("gdd-season-start").value,
    });
    byId("gdd-settings-saved").classList.remove("hidden");
    setTimeout(() => byId("gdd-settings-saved").classList.add("hidden"), 1500);
    await refreshWeatherView();
  });

  byId("refresh-weather-btn").addEventListener("click", () => refreshWeatherView());

  await refreshWeatherView();
}

export async function refreshWeatherView() {
  const settings = await getSettings();
  try {
    lastDays = await syncWeather(settings.seasonStart);
  } catch (err) {
    console.error("Weather sync failed, falling back to cached data", err);
    lastDays = await loadCachedWeather(settings.seasonStart);
  }

  const accumulated = accumulateGDD(lastDays, settings.baseTempF, settings.seasonStart);

  renderLineChart(
    byId("weather-chart-gdd"),
    accumulated.map((d) => ({ label: formatDateDisplay(d.date).slice(0, 5), value: d.cumulativeGdd }))
  );

  const weeks = weeklyRainfall(lastDays);
  renderBarChart(
    byId("weather-chart-rain"),
    weeks.slice(-12).map((w) => ({ label: formatDateDisplay(w.weekStart).slice(0, 5), value: w.totalPrecipIn }))
  );

  const recent = accumulated.slice(-30).reverse();
  byId("weather-table-body").innerHTML = recent
    .map(
      (d) => `
      <tr>
        <td>${formatDateDisplay(d.date)}</td>
        <td>${d.tmaxF?.toFixed(0) ?? ""}</td>
        <td>${d.tminF?.toFixed(0) ?? ""}</td>
        <td>${d.gdd.toFixed(1)}</td>
        <td>${d.cumulativeGdd.toFixed(0)}</td>
        <td>${(d.precipIn ?? 0).toFixed(2)}</td>
      </tr>`
    )
    .join("");

  return { days: lastDays, accumulated };
}
