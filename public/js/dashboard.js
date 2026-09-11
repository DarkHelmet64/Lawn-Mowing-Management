import { getCustomers } from "./customers.js";
import { getVisits } from "./mowLog.js";
import { getTasks } from "./maintenance.js";
import { refreshWeatherView } from "./weatherView.js";
import { weeklyRainfall, last7DaysRainfall } from "./gdd.js";
import { renderLineChart, renderBarChart } from "./charts.js";
import { byId, formatDateDisplay, todayStr } from "./utils.js";

export async function refreshDashboard() {
  const { days, accumulated } = await refreshWeatherView();
  const today = accumulated[accumulated.length - 1];

  byId("stat-daily-gdd").textContent = today ? today.gdd.toFixed(1) : "–";
  byId("stat-cumulative-gdd").textContent = today ? today.cumulativeGdd.toFixed(0) : "–";
  byId("stat-weekly-rain").textContent = `${last7DaysRainfall(days, todayStr()).toFixed(2)}"`;
  byId("stat-customer-count").textContent = String(getCustomers().length);

  renderLineChart(
    byId("chart-gdd"),
    accumulated.map((d) => ({ label: formatDateDisplay(d.date).slice(0, 5), value: d.cumulativeGdd }))
  );

  const weeks = weeklyRainfall(days).slice(-10);
  renderBarChart(
    byId("chart-rain"),
    weeks.map((w) => ({ label: formatDateDisplay(w.weekStart).slice(0, 5), value: w.totalPrecipIn }))
  );

  renderRecentActivity();
}

function renderRecentActivity() {
  const visits = getVisits().slice(0, 5);
  const tasks = getTasks().slice(0, 3);
  const items = [
    ...visits.map((v) => ({ date: v.date, text: "Mow visit logged" })),
    ...tasks.map((t) => ({ date: t.date, text: `Maintenance: ${t.taskType.replace(/_/g, " ")}` })),
  ]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 8);

  byId("recent-activity-list").innerHTML =
    items
      .map((i) => `<li><span class="activity-date">${formatDateDisplay(i.date)}</span>${i.text}</li>`)
      .join("") || "<li>No activity yet.</li>";
}
