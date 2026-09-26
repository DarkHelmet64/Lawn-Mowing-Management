import { getCustomers, getActiveCustomers, getCustomerName } from "./customers.js";
import { getCustomerGroups } from "./customerGroups.js";
import { getVisits, getLastMowedVisit, PATTERN_LABELS } from "./mowLog.js";
import { getLowStockProducts } from "./products.js";
import { refreshWeatherView } from "./weatherView.js";
import { last7DaysRainfall } from "./growthPotential.js";
import { computeMowStatus } from "./mowReadiness.js";
import { getTreatmentStatuses, TREATMENT_STATE_BADGE } from "./lawnTreatments.js";
import { getSettings } from "./settings.js";
import { byId, escapeHtml, formatDateDisplay, todayStr } from "./utils.js";
import { quickLogPlan } from "./quickLog.js";
import { openLogEventFor } from "./eventLog.js";
import { startRun } from "./runSheet.js";
import { patternGlyph, mowerSummary } from "./visitDefaults.js";
import { getEquipmentName } from "./equipment.js";
import { loadLawnWeather } from "./lawnWeather.js";
import { passCount, cutLabel } from "./cuts.js";

let listenersBound = false;
// Ready to Mow rows currently on screen, by key, for the Log mow buttons.
let readyUnitsByKey = new Map();

export function initDashboardView() {
  if (!listenersBound) {
    byId("ready-to-mow-list").addEventListener("click", (e) => {
      const logBtn = e.target.closest("[data-log-mow]");
      if (logBtn) handleLogMow(logBtn);
      const runBtn = e.target.closest("[data-start-run]");
      if (runBtn) startRun(runBtn.dataset.startRun);
    });
    byId("group-pattern-list").addEventListener("click", (e) => {
      const runBtn = e.target.closest("[data-start-run]");
      if (runBtn) startRun(runBtn.dataset.startRun);
    });
    listenersBound = true;
  }
  return refreshDashboard();
}

export async function refreshDashboard() {
  byId("stat-customer-count").textContent = String(getCustomers().length);
  renderLowStock();
  renderGroupMowPatterns();
  renderMultiCutStat();
  byId("ready-to-mow-list").innerHTML = "<li>Loading…</li>";
  byId("coming-up-list").innerHTML = "<li>Loading…</li>";
  refreshWeatherStats().catch((err) => console.error("Failed to refresh weather-dependent dashboard stats", err));
}

// One line per Customer Group: the pattern from the most recent mow of any
// customer in it, since a group is mowed together as one visit. Individual
// customers' patterns live in History's Customer view.
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
      return `
      <li class="group-pattern-row">
        <span><strong>${escapeHtml(g.name)}</strong> ${detail}</span>
        <button type="button" class="ghost-btn small-btn" data-start-run="${escapeHtml(g.id)}">Run sheet</button>
      </li>`;
    })
    .join("");
}

// How many mows this year were double or triple cuts.
function renderMultiCutStat() {
  const yearStart = `${todayStr().slice(0, 4)}-01-01`;
  const counts = getVisits()
    .filter((v) => v.mowed && v.date >= yearStart)
    .map((v) => passCount(v))
    .filter((n) => n >= 2);
  const doubles = counts.filter((n) => n === 2).length;
  const triples = counts.filter((n) => n >= 3).length;
  byId("stat-multi-cuts").textContent = String(counts.length);
  byId("stat-multi-cuts-detail").textContent = counts.length ? `${doubles} double · ${triples} triple` : "None yet";
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

  // Each lawn's own weather, grass type and threshold (see mowReadiness.js).
  const weatherFor = await loadLawnWeather(days);
  const mowStatus = computeMowStatus(getActiveCustomers(), getVisits(), weatherFor, settings);
  renderReadyToMow(mowStatus);
  renderComingUp(mowStatus);
  byId("stat-ready-to-mow").textContent = String([...mowStatus.values()].filter((s) => s.ready).length);
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

const YARD_TASK_LABELS = { mowed: "Mowed", trimmed: "Trimmed", edged: "Edged" };

// Customers bundled by Customer Group, since neighbors get mowed together
// (a customer in several groups goes with the first); anyone not in a group
// gets a row of their own. A unit's status is its lead member's: the first
// after sorting the members' statuses with leadFirst. Units come out in
// the same order.
function unitsFor(ids, mowStatus, keyPrefix, leadFirst = () => 0) {
  const wanted = new Set(ids);
  const placed = new Set();
  const units = [];
  for (const g of getCustomerGroups()) {
    const members = (g.customerIds || []).filter((id) => wanted.has(id) && !placed.has(id));
    if (!members.length) continue;
    members.forEach((id) => placed.add(id));
    units.push({ key: `${keyPrefix}:group:${g.id}`, groupId: g.id, name: g.name, customerIds: members });
  }
  for (const c of getCustomers()) {
    if (wanted.has(c.id) && !placed.has(c.id)) units.push({ key: `${keyPrefix}:customer:${c.id}`, groupId: null, name: c.name, customerIds: [c.id] });
  }
  return units
    .map((u) => ({ ...u, status: u.customerIds.map((id) => mowStatus.get(id)).sort(leadFirst)[0] }))
    .sort((a, b) => leadFirst(a.status, b.status));
}

function idsWhere(mowStatus, test) {
  return [...mowStatus].filter(([, s]) => test(s)).map(([id]) => id);
}

// Most overdue first - how far past its own threshold, since lawns can have
// different ones.
const mostOverdue = (a, b) => b.accumulatedGP / b.threshold - a.accumulatedGP / a.threshold;
// Soonest ready first; lawns not growing enough to say go last.
const soonest = (a, b) => (a.estimatedDaysUntilReady ?? Infinity) - (b.estimatedDaysUntilReady ?? Infinity) || mostOverdue(a, b);

const formatGp = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function lastMowedText(status) {
  const n = status.daysSinceMow;
  const ago = n === 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`;
  return `last mowed ${formatDateDisplay(status.lastMowDate)} (${ago})`;
}

function gpProgressText(status) {
  return `${status.accumulatedGP.toFixed(1)} of ${formatGp(status.threshold)} GP-days`;
}

function whoText(unit) {
  return unit.groupId ? `${unit.customerIds.map((id) => getCustomerName(id)).join(", ")} · ` : "";
}

// A Ready to Mow row: what "Log mow" fills the Log Event form in with.
function readyRowHtml(u, detail) {
  const plan = quickLogPlan(u.customerIds);
  const tasks = Object.keys(YARD_TASK_LABELS)
    .filter((t) => plan.tasks[t])
    .map((t) => YARD_TASK_LABELS[t])
    .join(", ");
  return `
      <li class="ready-row">
        <div class="ready-row-main">
          <div class="ready-row-text">
            <strong>${escapeHtml(u.name)}</strong>
            <span class="hint-text">${escapeHtml(whoText(u) + detail)}</span>
          </div>
          <div class="ready-row-actions">
            ${u.groupId ? `<button type="button" class="ghost-btn" data-start-run="${escapeHtml(u.groupId)}">Run sheet</button>` : ""}
            <button type="button" class="primary-btn" data-log-mow="${escapeHtml(u.key)}">Log mow</button>
          </div>
        </div>
        <span class="ready-saves">Suggested: ${escapeHtml(tasks)}${plan.cuts ? ` · ${passCount(plan.cuts, "areaNames") > 1 ? cutLabel(passCount(plan.cuts, "areaNames")) : "Areas mowed separately"}` : ""} · ${(plan.cuts || [plan])
          .map((c) => `<span class="pattern-label">${patternGlyph(c.pattern, 14)}${escapeHtml(PATTERN_LABELS[c.pattern] || c.pattern)}</span>`)
          .join('<span aria-hidden="true">→</span>')} · ${escapeHtml(planMowerText(plan))}</span>
      </li>`;
}

// Lawns past their threshold, most overdue first, then any active customer
// with no mow logged yet (so their first one gets recorded).
function renderReadyToMow(mowStatus) {
  const ready = unitsFor(idsWhere(mowStatus, (s) => s.ready), mowStatus, "ready", mostOverdue);
  const unmowed = unitsFor(idsWhere(mowStatus, (s) => s.neverMowed), mowStatus, "new");
  readyUnitsByKey = new Map([...ready, ...unmowed].map((u) => [u.key, u]));
  const readyRows = ready.map((u) => readyRowHtml(u, `${lastMowedText(u.status)} · ${gpProgressText(u.status)}`)).join("");
  const unmowedRows = unmowed.length
    ? `<li class="ready-subhead">No mow logged yet</li>${unmowed.map((u) => readyRowHtml(u, "Log a mow to start tracking this lawn")).join("")}`
    : "";
  byId("ready-to-mow-list").innerHTML = readyRows || unmowedRows ? readyRows + unmowedRows : "<li>No lawns ready to mow yet.</li>";
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// "Ready Tuesday" within the forecast; further out it's a rougher guess.
function readyWhenText(status) {
  const n = status.estimatedDaysUntilReady;
  if (n == null) return "Not growing much right now";
  if (!status.estimateFromForecast) return n > 21 ? "Ready in 3+ weeks" : `Ready in about ${n} days`;
  if (n === 1) return "Ready tomorrow";
  if (n < 7) return `Ready ${WEEKDAYS[new Date(`${status.estimatedDate}T00:00:00`).getDay()]}`;
  return `Ready in ${n} days`;
}

// Mowed lawns not ready yet, soonest first, with when each should be.
function renderComingUp(mowStatus) {
  const units = unitsFor(idsWhere(mowStatus, (s) => !s.ready && !s.neverMowed), mowStatus, "soon", soonest);
  byId("coming-up-list").innerHTML =
    units
      .map((u) => {
        const pct = Math.min(100, Math.round((u.status.accumulatedGP / u.status.threshold) * 100));
        return `
      <li class="coming-row">
        <div class="coming-row-main">
          <div class="ready-row-text">
            <strong>${escapeHtml(u.name)}</strong>
            <span class="hint-text">${escapeHtml(whoText(u) + lastMowedText(u.status))}</span>
          </div>
          <div class="coming-when">
            <strong>${escapeHtml(readyWhenText(u.status))}</strong>
            <span class="hint-text">${escapeHtml(gpProgressText(u.status))}</span>
          </div>
        </div>
        <div class="gp-progress" role="progressbar" aria-label="${escapeHtml(u.name)} growth since last mow" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width: ${pct}%"></span></div>
      </li>`;
      })
      .join("") ||
    `<li class="hint-text">${[...mowStatus.values()].some((s) => s.ready) ? "Nothing else coming up - every mowed lawn is ready." : "Lawns show up here once they've been mowed."}</li>`;
}

// The mower line for a suggested mow. Cuts on different mowers (the front
// on one, the back on another) list each mower rather than one's settings.
function planMowerText(plan) {
  if (!plan.cuts) return mowerSummary(plan.mower);
  const mowers = [...new Set(plan.cuts.map((c) => c.equipmentId).filter(Boolean))];
  return mowers.length > 1 ? mowers.map((id) => getEquipmentName(id) || "Unknown mower").join(" + ") : mowerSummary(plan.cuts[0]);
}

// Opens Log Event filled in for this row's customers, to check and save.
function handleLogMow(btn) {
  const unit = readyUnitsByKey.get(btn.dataset.logMow);
  if (unit) openLogEventFor({ customerIds: unit.customerIds, plan: quickLogPlan(unit.customerIds) });
}
