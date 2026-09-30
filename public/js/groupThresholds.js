import { byId, escapeHtml, formatDateDisplay } from "./utils.js";
import { getCustomers, getActiveCustomers, getCustomerName, setMowThreshold, sharedMowThreshold } from "./customers.js";
import { getCustomerGroups } from "./customerGroups.js";
import { getSettings } from "./settings.js";
import { getVisits } from "./mowLog.js";
import { loadLawnWeather } from "./lawnWeather.js";
import { suggestThreshold, MIN_GAPS } from "./mowReadiness.js";

// Weather & Growth's "Mow Thresholds by Group": one threshold per customer
// group (neighbors mowed together), plus a row for each active customer
// not in a group. A threshold is still each customer's own - setting a
// group's sets it on everyone in it - so the customer form always shows
// what's used. Each row also suggests a threshold from how that group has
// actually been mowed (see suggestThreshold), for the operator to take or
// leave.

let loadSeasonDays = async () => [];

const formatGp = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function shortDate(dateStr) {
  return formatDateDisplay(dateStr).slice(0, 5);
}

function suggestionHtml(s, current) {
  if (!s.gaps.length && !s.skipped.length) return `<span class="threshold-suggest hint-text">No mows to learn from yet.</span>`;
  const why = `<button type="button" class="link-btn" data-why aria-expanded="false">Why?</button>`;
  if (s.suggestion == null) {
    return `<span class="threshold-suggest hint-text">${s.gaps.length} of ${MIN_GAPS} gaps between mows needed for a suggestion. ${why}</span>`;
  }
  const basis = `from ${s.gaps.length} gaps between mows (${formatGp(Math.round(s.low * 10) / 10)}–${formatGp(Math.round(s.high * 10) / 10)})`;
  if (s.suggestion === current) return `<span class="threshold-suggest hint-text">Matches your mowing · ${basis} ${why}</span>`;
  return `<span class="threshold-suggest">Your mows suggest <strong>${formatGp(s.suggestion)}</strong> · ${basis}
    <button type="button" class="link-btn" data-use-suggestion="${s.suggestion}">Use</button> ${why}</span>`;
}

function whyHtml(s) {
  const rows = [
    ...s.gaps.map((g) => `<li><span>${shortDate(g.from)} → ${shortDate(g.to)}</span><span>${g.days} days</span><span>${formatGp(Math.round(g.growth * 10) / 10)} GP-days</span></li>`),
    ...s.skipped.map((g) => `<li class="hint-text"><span>${shortDate(g.from)} → ${shortDate(g.to)}</span><span>${g.days} days</span><span>Skipped - too long to count</span></li>`),
  ];
  return `<ul class="threshold-why hidden">${rows.join("")}</ul>`;
}

function rowHtml({ name, detail, customerIds }, defaultThreshold, weatherFor, settings) {
  const shared = sharedMowThreshold(customerIds);
  const value = shared ?? "";
  const mixed = shared === undefined;
  const customers = customerIds.map((id) => getCustomers().find((c) => c.id === id)).filter(Boolean);
  const suggestion = suggestThreshold(customers, getVisits(), weatherFor, settings);
  return `
    <div class="threshold-row">
      <div class="threshold-row-main">
        <div class="threshold-row-text">
          <strong>${escapeHtml(name)}</strong>
          <span class="hint-text">${escapeHtml(detail)}${mixed ? " · different thresholds now - enter one to set it for all" : ""}</span>
          ${suggestionHtml(suggestion, mixed ? null : shared ?? defaultThreshold)}
        </div>
        <input type="number" min="0.5" step="0.5" inputmode="decimal" aria-label="Mow threshold for ${escapeHtml(name)} (GP-days)"
          data-threshold-ids="${escapeHtml(customerIds.join(","))}" data-initial="${value}" value="${value}"
          placeholder="${mixed ? "Mixed" : `Default (${defaultThreshold})`}" />
      </div>
      ${whyHtml(suggestion)}
    </div>`;
}

export async function renderGroupThresholds() {
  const settings = await getSettings();
  const weatherFor = await loadLawnWeather(await loadSeasonDays());
  const existing = new Set(getCustomers().map((c) => c.id));
  const groups = getCustomerGroups()
    .map((g) => ({ name: g.name, customerIds: (g.customerIds || []).filter((id) => existing.has(id)) }))
    .filter((g) => g.customerIds.length)
    .map((g) => ({ ...g, detail: g.customerIds.map(getCustomerName).join(", ") }));
  const grouped = new Set(groups.flatMap((g) => g.customerIds));
  const loners = getActiveCustomers()
    .filter((c) => !grouped.has(c.id))
    .map((c) => ({ name: c.name, detail: "Not in a group", customerIds: [c.id] }));
  byId("group-threshold-list").innerHTML =
    [...groups, ...loners].map((row) => rowHtml(row, settings.mowThresholdGPDays, weatherFor, settings)).join("") ||
    `<p class="hint-text">Add customers (and groups) in Settings first.</p>`;
}

// Saves only the rows that were changed. Blank over mixed thresholds reads
// as unchanged, so it leaves each customer's own.
async function saveThresholds() {
  const changed = [...document.querySelectorAll("#group-threshold-list [data-threshold-ids]")]
    .filter((input) => input.value.trim() !== input.dataset.initial)
    .map((input) => ({ ids: input.dataset.thresholdIds.split(","), value: input.value.trim() }));
  const btn = byId("save-thresholds-btn");
  btn.disabled = true;
  try {
    for (const { ids, value } of changed) await setMowThreshold(ids, value);
  } catch (err) {
    console.error("Failed to save mow thresholds", err);
    alert("Couldn't save every threshold - check them and try again.");
  } finally {
    btn.disabled = false;
  }
  if (changed.length) document.dispatchEvent(new CustomEvent("customers:changed"));
  await renderGroupThresholds();
  byId("thresholds-saved").classList.remove("hidden");
  setTimeout(() => byId("thresholds-saved").classList.add("hidden"), 1500);
}

function handleListClick(e) {
  const row = e.target.closest(".threshold-row");
  if (!row) return;
  const use = e.target.closest("[data-use-suggestion]");
  if (use) {
    // Fills the box; Save Thresholds saves it like any other change.
    const input = row.querySelector("[data-threshold-ids]");
    input.value = use.dataset.useSuggestion;
    input.focus();
  }
  const why = e.target.closest("[data-why]");
  if (why) {
    const list = row.querySelector(".threshold-why");
    const open = list.classList.toggle("hidden") === false;
    why.setAttribute("aria-expanded", String(open));
    why.textContent = open ? "Hide" : "Why?";
  }
}

// seasonDays: loads Dayton's season of weather (the Weather page's own).
export function initGroupThresholds(seasonDays) {
  loadSeasonDays = seasonDays;
  byId("save-thresholds-btn").addEventListener("click", saveThresholds);
  byId("group-threshold-list").addEventListener("click", handleListClick);
  document.addEventListener("customers:changed", renderGroupThresholds);
  document.addEventListener("customerGroups:changed", renderGroupThresholds);
  document.addEventListener("records:changed", renderGroupThresholds);
  document.addEventListener("event:logged", renderGroupThresholds);
  renderGroupThresholds();
}
