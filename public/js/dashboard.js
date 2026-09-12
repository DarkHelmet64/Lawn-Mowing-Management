import { getCustomers, getCustomerName } from "./customers.js";
import { getVisits } from "./mowLog.js";
import { getSprays } from "./sprayLog.js";
import { getTasks } from "./maintenance.js";
import { refreshWeatherView } from "./weatherView.js";
import { weeklyRainfall, last7DaysRainfall, profileFor } from "./growthPotential.js";
import { computeMowStatus } from "./mowReadiness.js";
import { getSettings } from "./settings.js";
import { renderLineChart, renderBarChart } from "./charts.js";
import { byId, formatDateDisplay, todayStr } from "./utils.js";

export async function refreshDashboard() {
  byId("stat-customer-count").textContent = String(getCustomers().length);
  renderRecentActivity();
  byId("ready-to-mow-list").innerHTML = "<li>Loading…</li>";
  refreshWeatherStats().catch((err) => console.error("Failed to refresh weather-dependent dashboard stats", err));
}

async function refreshWeatherStats() {
  const { days, series } = await refreshWeatherView();
  const settings = await getSettings();
  const today = series[series.length - 1];
  const recent = series.slice(-7);
  const avgRecentGP = recent.length ? recent.reduce((sum, d) => sum + d.gp, 0) / recent.length : 0;

  byId("stat-today-gp").textContent = today ? `${(today.gp * 100).toFixed(0)}%` : "–";
  byId("stat-avg-gp").textContent = recent.length ? `${(avgRecentGP * 100).toFixed(0)}%` : "–";
  byId("stat-weekly-rain").textContent = `${last7DaysRainfall(days, todayStr()).toFixed(2)}"`;

  renderLineChart(
    byId("chart-gp"),
    series.slice(-14).map((d) => ({ label: formatDateDisplay(d.date).slice(0, 5), value: d.gp * 100 }))
  );

  const weeks = weeklyRainfall(days).slice(-10);
  renderBarChart(
    byId("chart-rain"),
    weeks.map((w) => ({ label: formatDateDisplay(w.weekStart).slice(0, 5), value: w.totalPrecipIn }))
  );

  const mowStatus = computeMowStatus(getCustomers(), getVisits(), days, {
    grassProfile: profileFor(settings.grassType),
    mowThresholdGPDays: settings.mowThresholdGPDays,
  });
  renderReadyToMow(mowStatus);
  byId("stat-ready-to-mow").textContent = String(
    [...mowStatus.values()].filter((s) => s.ready).length
  );
}

function renderReadyToMow(mowStatus) {
  const ready = getCustomers()
    .map((c) => ({ customer: c, status: mowStatus.get(c.id) }))
    .filter((r) => r.status?.ready)
    .sort((a, b) => b.status.accumulatedGP - a.status.accumulatedGP);

  byId("ready-to-mow-list").innerHTML =
    ready
      .map(
        (r) => `
      <li>
        <strong>${r.customer.name}</strong>
        <span class="hint-text">last mowed ${formatDateDisplay(r.status.lastMowDate)} · ${r.status.accumulatedGP.toFixed(1)} GP-days accumulated</span>
      </li>`
      )
      .join("") || "<li>No lawns ready to mow yet.</li>";
}

const VISIT_FLAG_LABELS = {
  mowed: "Mowed",
  trimmed: "Trimmed",
  edged: "Edged",
  pruned: "Pruned",
  trimmedBushes: "Trimmed bushes",
  mulched: "Mulched",
};

function describeVisit(v) {
  const done = Object.keys(VISIT_FLAG_LABELS).filter((flag) => v[flag]);
  const summary = done.length ? done.map((flag) => VISIT_FLAG_LABELS[flag]).join(", ") : "Visit";
  return `${summary} for ${getCustomerName(v.customerId)}`;
}

function renderRecentActivity() {
  const visits = getVisits().slice(0, 5);
  const sprays = getSprays().slice(0, 5);
  const tasks = getTasks().slice(0, 3);
  const items = [
    ...visits.map((v) => ({ date: v.date, text: describeVisit(v) })),
    ...sprays.map((s) => ({ date: s.date, text: `Sprayed ${s.product} for ${getCustomerName(s.customerId)}` })),
    ...tasks.map((t) => ({ date: t.date, text: `Maintenance: ${t.taskType.replace(/_/g, " ")}` })),
  ]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 8);

  byId("recent-activity-list").innerHTML =
    items
      .map((i) => `<li><span class="activity-date">${formatDateDisplay(i.date)}</span>${i.text}</li>`)
      .join("") || "<li>No activity yet.</li>";
}
