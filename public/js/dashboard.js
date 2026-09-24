import { getCustomers, getCustomerName } from "./customers.js";
import { getCustomerGroups, getGroupsForCustomer } from "./customerGroups.js";
import { getVisits, getLastMowedVisit, PATTERN_LABELS } from "./mowLog.js";
import { getSprays } from "./sprayLog.js";
import { getTasks } from "./maintenance.js";
import { getLowStockProducts, getProductName } from "./products.js";
import { refreshWeatherView } from "./weatherView.js";
import { last7DaysRainfall, profileFor } from "./growthPotential.js";
import { computeMowStatus } from "./mowReadiness.js";
import { getTreatmentStatuses, TREATMENT_STATE_BADGE } from "./lawnTreatments.js";
import { getSettings } from "./settings.js";
import { byId, escapeHtml, formatDateDisplay, todayStr } from "./utils.js";

export function initDashboardView() {
  return refreshDashboard();
}

export async function refreshDashboard() {
  byId("stat-customer-count").textContent = String(getCustomers().length);
  renderRecentActivity();
  renderLowStock();
  renderGroupMowPatterns();
  byId("ready-to-mow-list").innerHTML = "<li>Loading…</li>";
  refreshWeatherStats().catch((err) => console.error("Failed to refresh weather-dependent dashboard stats", err));
}

// One line per Customer Group: the pattern from the most recent mow of any
// customer in it, since a group is mowed together as one visit. Individual
// customers' patterns live on the Yard Work page.
function renderGroupMowPatterns() {
  const groups = getCustomerGroups();
  const list = byId("group-pattern-list");
  if (!groups.length) {
    list.innerHTML = `<li class="hint-text">No customer groups yet - create one in Settings → Customer Groups.</li>`;
    return;
  }
  list.innerHTML = groups
    .map((g) => {
      const visit = getLastMowedVisit(g.customerIds || []);
      const detail = visit
        ? `<span class="group-pattern">${PATTERN_LABELS[visit.pattern] || escapeHtml(visit.pattern)}</span>
           <span class="hint-text">· last mowed ${formatDateDisplay(visit.date)}</span>`
        : `<span class="hint-text">No mow recorded yet.</span>`;
      return `<li><strong>${escapeHtml(g.name)}</strong> ${detail}</li>`;
    })
    .join("");
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
  renderTreatmentStatus(days, settings);
}

function renderTreatmentStatus(days, settings) {
  const statuses = getTreatmentStatuses(days, settings);
  byId("treatment-status-list").innerHTML = statuses
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

const UNGROUPED_LABEL = "Ungrouped";
const RECENT_ITEMS_PER_SOURCE = 15;
const RECENT_ITEMS_PER_GROUP = 5;

// Recent Activity is sectioned by Customer Group (a customer not in any
// group - or a maintenance task, which isn't tied to a customer at all -
// falls into "Ungrouped"). A customer in more than one group shows up
// under each of them, since there's no single "the" group to pick.
function renderRecentActivity() {
  const visits = getVisits().slice(0, RECENT_ITEMS_PER_SOURCE);
  const sprays = getSprays().slice(0, RECENT_ITEMS_PER_SOURCE);
  const tasks = getTasks().slice(0, RECENT_ITEMS_PER_SOURCE);
  const items = [
    ...visits.map((v) => ({ date: v.date, customerId: v.customerId, text: describeVisit(v) })),
    ...sprays.map((s) => ({
      date: s.date,
      customerId: s.customerId,
      text: `Sprayed ${getProductName(s.productId) || s.product || "product"} for ${getCustomerName(s.customerId)}`,
    })),
    ...tasks.map((t) => ({ date: t.date, customerId: null, text: `Maintenance: ${t.taskType.replace(/_/g, " ")}` })),
  ];

  const buckets = new Map();
  function addTo(label, item) {
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label).push(item);
  }
  for (const item of items) {
    const groups = item.customerId ? getGroupsForCustomer(item.customerId) : [];
    if (groups.length) {
      for (const g of groups) addTo(g.name, item);
    } else {
      addTo(UNGROUPED_LABEL, item);
    }
  }
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  // Named groups sort by their own most recent activity; Ungrouped always
  // trails at the end since it's a catch-all rather than a real group.
  const sections = [...buckets.entries()]
    .filter(([label]) => label !== UNGROUPED_LABEL)
    .sort((a, b) => (a[1][0].date < b[1][0].date ? 1 : -1));
  if (buckets.has(UNGROUPED_LABEL)) sections.push([UNGROUPED_LABEL, buckets.get(UNGROUPED_LABEL)]);

  byId("recent-activity-list").innerHTML =
    sections
      .map(
        ([label, groupItems]) => `
      <div class="activity-group">
        <div class="subsection-header"><span>${escapeHtml(label)}</span></div>
        <ul class="activity-list">
          ${groupItems
            .slice(0, RECENT_ITEMS_PER_GROUP)
            .map((i) => `<li><span class="activity-date">${formatDateDisplay(i.date)}</span>${i.text}</li>`)
            .join("")}
        </ul>
      </div>`
      )
      .join("") || `<p class="hint-text">No activity yet.</p>`;
}
