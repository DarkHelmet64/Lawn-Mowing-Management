import { getCustomers, getCustomerName, populateCustomerSelect } from "./customers.js";
import { getVisits, PATTERN_LABELS } from "./mowLog.js";
import { getSprays } from "./sprayLog.js";
import { getTasks } from "./maintenance.js";
import { getLowStockProducts, getProductName } from "./products.js";
import { refreshWeatherView } from "./weatherView.js";
import { last7DaysRainfall, profileFor } from "./growthPotential.js";
import { computeMowStatus } from "./mowReadiness.js";
import { getSettings } from "./settings.js";
import { byId, escapeHtml, formatDateDisplay, todayStr } from "./utils.js";

let listenersBound = false;

export function initDashboardView() {
  if (!listenersBound) {
    byId("pattern-lookup-customer").addEventListener("change", renderPatternLookup);
    listenersBound = true;
  }
  return refreshDashboard();
}

export async function refreshDashboard() {
  byId("stat-customer-count").textContent = String(getCustomers().length);
  renderRecentActivity();
  renderLowStock();
  populateCustomerSelect(byId("pattern-lookup-customer"));
  renderPatternLookup();
  byId("ready-to-mow-list").innerHTML = "<li>Loading…</li>";
  refreshWeatherStats().catch((err) => console.error("Failed to refresh weather-dependent dashboard stats", err));
}

// The most recent mowed visit (with a pattern recorded) for whichever
// customer is picked in the Last Mow Pattern card - visits are already
// loaded sorted newest-first, so the first match is the latest one.
function renderPatternLookup() {
  const customerId = byId("pattern-lookup-customer").value;
  const container = byId("pattern-lookup-result");
  if (!customerId) {
    container.innerHTML = `<p class="hint-text">Add a customer to see their last mow pattern.</p>`;
    return;
  }
  const visit = getVisits().find((v) => v.customerId === customerId && v.mowed && v.pattern);
  if (!visit) {
    container.innerHTML = `<p class="hint-text">No mow recorded yet for ${escapeHtml(getCustomerName(customerId))}.</p>`;
    return;
  }
  container.innerHTML = `
    <span class="stat-value">${PATTERN_LABELS[visit.pattern] || visit.pattern}</span>
    <p class="hint-text">Last mowed ${formatDateDisplay(visit.date)} for ${escapeHtml(getCustomerName(customerId))}</p>
  `;
}

function renderLowStock() {
  const low = getLowStockProducts().sort((a, b) => a.quantityOnHand - b.quantityOnHand);
  byId("stat-low-stock").textContent = String(low.length);
  byId("low-stock-list").innerHTML =
    low
      .map(
        (p) => `
      <li>
        <strong>${escapeHtml(p.name)}</strong>
        <span class="hint-text">${p.quantityOnHand} ${escapeHtml(p.unit)} on hand · reorder at ${p.reorderThreshold} ${escapeHtml(p.unit)}</span>
      </li>`
      )
      .join("") || "<li>All products sufficiently stocked.</li>";
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
    ...sprays.map((s) => ({ date: s.date, text: `Sprayed ${getProductName(s.productId) || s.product || "product"} for ${getCustomerName(s.customerId)}` })),
    ...tasks.map((t) => ({ date: t.date, text: `Maintenance: ${t.taskType.replace(/_/g, " ")}` })),
  ]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 8);

  byId("recent-activity-list").innerHTML =
    items
      .map((i) => `<li><span class="activity-date">${formatDateDisplay(i.date)}</span>${i.text}</li>`)
      .join("") || "<li>No activity yet.</li>";
}
