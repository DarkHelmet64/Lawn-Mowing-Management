import { getCustomers, getCustomerName } from "./customers.js";
import { getCustomerGroups } from "./customerGroups.js";
import { getVisits, getLastMowedVisit, PATTERN_LABELS } from "./mowLog.js";
import { getLowStockProducts } from "./products.js";
import { refreshWeatherView } from "./weatherView.js";
import { last7DaysRainfall, profileFor } from "./growthPotential.js";
import { computeMowStatus } from "./mowReadiness.js";
import { getTreatmentStatuses, TREATMENT_STATE_BADGE } from "./lawnTreatments.js";
import { getSettings } from "./settings.js";
import { byId, escapeHtml, formatDateDisplay, todayStr } from "./utils.js";
import { quickLogPlan, logQuickMow, undoVisits } from "./quickLog.js";
import { startRun } from "./runSheet.js";
import { showHistory } from "./history.js";
import { showToast } from "./toast.js";
import { patternGlyph, mowerSummary } from "./visitDefaults.js";

let listenersBound = false;
// Ready to Mow rows currently on screen, by key, for the Log mow buttons.
let readyUnitsByKey = new Map();

export function initDashboardView() {
  if (!listenersBound) {
    byId("ready-to-mow-list").addEventListener("click", (e) => {
      const logBtn = e.target.closest("[data-quick-log]");
      if (logBtn) handleQuickLog(logBtn);
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
  byId("ready-to-mow-list").innerHTML = "<li>Loading…</li>";
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

const YARD_TASK_LABELS = { mowed: "Mowed", trimmed: "Trimmed", edged: "Edged" };

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// Ready customers, bundled by Customer Group since neighbors get mowed
// together (a customer in several groups goes with the first). Anyone ready
// who isn't in a group gets a row of their own. Most overdue first.
function readyUnits(mowStatus) {
  const readyIds = new Set(getCustomers().filter((c) => mowStatus.get(c.id)?.ready).map((c) => c.id));
  const placed = new Set();
  const units = [];
  for (const g of getCustomerGroups()) {
    const members = (g.customerIds || []).filter((id) => readyIds.has(id) && !placed.has(id));
    if (!members.length) continue;
    members.forEach((id) => placed.add(id));
    units.push({ key: `group:${g.id}`, groupId: g.id, name: g.name, customerIds: members });
  }
  for (const c of getCustomers()) {
    if (readyIds.has(c.id) && !placed.has(c.id)) units.push({ key: `customer:${c.id}`, groupId: null, name: c.name, customerIds: [c.id] });
  }
  return units
    .map((u) => ({ ...u, status: u.customerIds.map((id) => mowStatus.get(id)).sort((a, b) => b.accumulatedGP - a.accumulatedGP)[0] }))
    .sort((a, b) => b.status.accumulatedGP - a.status.accumulatedGP);
}

// Each row says exactly what "Log mow" will save before it's tapped.
function renderReadyToMow(mowStatus) {
  const units = readyUnits(mowStatus);
  readyUnitsByKey = new Map(units.map((u) => [u.key, u]));
  byId("ready-to-mow-list").innerHTML =
    units
      .map((u) => {
        const plan = quickLogPlan(u.customerIds);
        const tasks = Object.keys(YARD_TASK_LABELS)
          .filter((t) => plan.tasks[t])
          .map((t) => YARD_TASK_LABELS[t])
          .join(", ");
        const who = u.groupId ? `${u.customerIds.map((id) => getCustomerName(id)).join(", ")} · ` : "";
        return `
      <li class="ready-row">
        <div class="ready-row-main">
          <div class="ready-row-text">
            <strong>${escapeHtml(u.name)}</strong>
            <span class="hint-text">${escapeHtml(who)}last mowed ${formatDateDisplay(u.status.lastMowDate)} · ${u.status.accumulatedGP.toFixed(1)} GP-days</span>
          </div>
          <div class="ready-row-actions">
            ${u.groupId ? `<button type="button" class="ghost-btn" data-start-run="${escapeHtml(u.groupId)}">Run sheet</button>` : ""}
            <button type="button" class="primary-btn" data-quick-log="${escapeHtml(u.key)}">Log mow</button>
          </div>
        </div>
        <span class="ready-saves">Saves: ${escapeHtml(tasks)} · <span class="pattern-label">${patternGlyph(plan.pattern, 14)}${escapeHtml(PATTERN_LABELS[plan.pattern] || plan.pattern)}</span> · ${escapeHtml(mowerSummary(plan.mower))}</span>
      </li>`;
      })
      .join("") || "<li>No lawns ready to mow yet.</li>";
}

async function handleQuickLog(btn) {
  const unit = readyUnitsByKey.get(btn.dataset.quickLog);
  if (!unit) return;
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    const { ids, plan } = await logQuickMow(unit.customerIds);
    document.dispatchEvent(new CustomEvent("event:logged"));
    showToast({
      message: `Logged ${plural(ids.length, "visit")} for ${unit.name}`,
      detail: `${PATTERN_LABELS[plan.pattern] || plan.pattern} · ${mowerSummary(plan.mower)}`,
      actions: [
        {
          label: "Undo",
          onClick: async () => {
            await undoVisits(ids);
            document.dispatchEvent(new CustomEvent("event:logged"));
            showToast({ message: `Removed ${plural(ids.length, "visit")} for ${unit.name}.` });
          },
        },
        { label: "Edit", onClick: () => showHistory("days") },
      ],
    });
  } catch (err) {
    console.error("Quick log failed", err);
    btn.disabled = false;
    btn.textContent = "Log mow";
    alert("Couldn't log the mow. Check your connection and try again.");
  }
}
