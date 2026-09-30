import { byId, escapeHtml } from "./utils.js";
import { getCustomers, getActiveCustomers, getCustomerName, setMowThreshold, sharedMowThreshold } from "./customers.js";
import { getCustomerGroups } from "./customerGroups.js";
import { getSettings } from "./settings.js";

// Weather & Growth's "Mow Thresholds by Group": one threshold per customer
// group (neighbors mowed together), plus a row for each active customer
// not in a group. A threshold is still each customer's own - setting a
// group's sets it on everyone in it - so the customer form always shows
// what's used.

function rowHtml({ name, detail, customerIds }, defaultThreshold) {
  const shared = sharedMowThreshold(customerIds);
  const value = shared ?? "";
  const mixed = shared === undefined;
  return `
    <div class="threshold-row">
      <div class="threshold-row-text">
        <strong>${escapeHtml(name)}</strong>
        <span class="hint-text">${escapeHtml(detail)}${mixed ? " · different thresholds now - enter one to set it for all" : ""}</span>
      </div>
      <input type="number" min="0.5" step="0.5" inputmode="decimal" aria-label="Mow threshold for ${escapeHtml(name)} (GP-days)"
        data-threshold-ids="${escapeHtml(customerIds.join(","))}" data-initial="${value}" value="${value}"
        placeholder="${mixed ? "Mixed" : `Default (${defaultThreshold})`}" />
    </div>`;
}

export async function renderGroupThresholds() {
  const { mowThresholdGPDays } = await getSettings();
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
    [...groups, ...loners].map((row) => rowHtml(row, mowThresholdGPDays)).join("") ||
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

export function initGroupThresholds() {
  byId("save-thresholds-btn").addEventListener("click", saveThresholds);
  document.addEventListener("customers:changed", renderGroupThresholds);
  document.addEventListener("customerGroups:changed", renderGroupThresholds);
  renderGroupThresholds();
}
