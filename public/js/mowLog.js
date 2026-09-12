import { listAll, createDoc, updateDocById, deleteDocById } from "./db.js";
import { byId, escapeHtml, todayStr, formatDateDisplay } from "./utils.js";
import { getCustomers, getCustomerName, populateCustomerSelect } from "./customers.js";
import { populateEquipmentSelect, getEquipmentName, populateDeckHeightSelect } from "./equipment.js";
import { getLocationLabel, populateLocationSelect } from "./locations.js";
import { getAreaName, populateAreaSelect } from "./areas.js";
import { populateYardFeatureSelect, getYardFeatureName } from "./yardFeatures.js";

const COLLECTION = "mowVisits";
let cache = [];
let listenersBound = false;

const PATTERN_LABELS = {
  parallel: "Parallel",
  perpendicular: "Perpendicular",
  diagonal_left: "Diagonal Left",
  diagonal_right: "Diagonal Right",
  other: "Other",
};

export async function loadVisits() {
  cache = await listAll(COLLECTION, { orderByField: "date", direction: "desc" });
  return cache;
}

export function getVisits() {
  return cache;
}

function renderTable() {
  const filter = byId("visit-filter-customer").value;
  const body = byId("visit-table-body");
  const rows = cache.filter((v) => !filter || v.customerId === filter);
  body.innerHTML = rows
    .map(
      (v) => `
      <tr>
        <td>${formatDateDisplay(v.date)}</td>
        <td>${escapeHtml(getCustomerName(v.customerId))}</td>
        <td>${v.mowed ? "✓" : ""}</td>
        <td>${v.trimmed ? "✓" : ""}</td>
        <td>${v.edged ? "✓" : ""}</td>
        <td>${v.pruned ? "✓" : ""}</td>
        <td>${v.trimmedBushes ? "✓" : ""}</td>
        <td>${PATTERN_LABELS[v.pattern] || v.pattern || ""}</td>
        <td>${escapeHtml(getLocationLabel(v.locationId) || "")}</td>
        <td>${escapeHtml(getAreaName(v.areaId) || "")}</td>
        <td>${escapeHtml(getYardFeatureName(v.featureId) || "")}</td>
        <td>${escapeHtml(getEquipmentName(v.equipmentId) || "")}</td>
        <td class="row-actions">
          <button class="link-btn" data-edit="${v.id}">Edit</button>
          <button class="link-btn danger" data-delete="${v.id}">Delete</button>
        </td>
      </tr>`
    )
    .join("");

  body.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openForm(cache.find((v) => v.id === btn.dataset.edit)))
  );
  body.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => handleDelete(btn.dataset.delete))
  );
}

function refreshLocationOptions() {
  populateLocationSelect(byId("visit-location"), byId("visit-customer").value);
  refreshAreaOptions();
}

function refreshAreaOptions() {
  populateAreaSelect(byId("visit-area"), byId("visit-location").value);
  refreshFeatureOptions();
}

function refreshFeatureOptions() {
  populateYardFeatureSelect(byId("visit-feature"), byId("visit-area").value);
}

function openForm(visit = null) {
  byId("visit-form-card").classList.remove("hidden");
  populateCustomerSelect(byId("visit-customer"));
  populateEquipmentSelect(byId("visit-equipment"));
  byId("visit-id").value = visit?.id || "";
  byId("visit-customer").value = visit?.customerId || getCustomers()[0]?.id || "";
  byId("visit-date").value = visit?.date || todayStr();
  byId("visit-mowed").checked = visit?.mowed ?? true;
  byId("visit-trimmed").checked = visit?.trimmed ?? true;
  byId("visit-edged").checked = visit?.edged ?? false;
  byId("visit-pruned").checked = visit?.pruned ?? false;
  byId("visit-trimmed-bushes").checked = visit?.trimmedBushes ?? false;
  byId("visit-pattern").value = visit?.pattern || "parallel";
  populateDeckHeightSelect(byId("visit-height"), visit?.equipmentId || "", visit?.deckHeight ?? null);
  byId("visit-equipment").value = visit?.equipmentId || "";
  byId("visit-notes").value = visit?.notes || "";

  refreshLocationOptions();
  byId("visit-location").value = visit?.locationId || "";
  refreshAreaOptions();
  byId("visit-area").value = visit?.areaId || "";
  refreshFeatureOptions();
  if (visit?.featureId) byId("visit-feature").value = visit.featureId;
}

function closeForm() {
  byId("visit-form-card").classList.add("hidden");
  byId("visit-form").reset();
}

async function handleDelete(id) {
  if (!confirm("Delete this visit record?")) return;
  await deleteDocById(COLLECTION, id);
  await refreshMowLogView();
}

async function handleSubmit(e) {
  e.preventDefault();
  const id = byId("visit-id").value;
  const data = {
    customerId: byId("visit-customer").value,
    date: byId("visit-date").value,
    mowed: byId("visit-mowed").checked,
    trimmed: byId("visit-trimmed").checked,
    edged: byId("visit-edged").checked,
    pruned: byId("visit-pruned").checked,
    trimmedBushes: byId("visit-trimmed-bushes").checked,
    pattern: byId("visit-pattern").value,
    deckHeight: byId("visit-height").value ? Number(byId("visit-height").value) : null,
    locationId: byId("visit-location").value || null,
    areaId: byId("visit-area").value || null,
    featureId: byId("visit-feature").value || null,
    equipmentId: byId("visit-equipment").value || null,
    notes: byId("visit-notes").value.trim(),
  };
  if (id) await updateDocById(COLLECTION, id, data);
  else await createDoc(COLLECTION, data);
  closeForm();
  await refreshMowLogView();
}

export async function refreshMowLogView() {
  await loadVisits();
  populateCustomerSelect(byId("visit-filter-customer"), { includeAll: true });
  renderTable();
}

export function initMowLogView() {
  if (!listenersBound) {
    byId("add-visit-btn").addEventListener("click", () => {
      if (!getCustomers().length) {
        alert("Add a customer first.");
        return;
      }
      openForm();
    });
    byId("cancel-visit-btn").addEventListener("click", closeForm);
    byId("visit-form").addEventListener("submit", handleSubmit);
    byId("visit-filter-customer").addEventListener("change", renderTable);
    byId("visit-customer").addEventListener("change", refreshLocationOptions);
    byId("visit-location").addEventListener("change", refreshAreaOptions);
    byId("visit-area").addEventListener("change", refreshFeatureOptions);
    byId("visit-equipment").addEventListener("change", () => {
      populateDeckHeightSelect(byId("visit-height"), byId("visit-equipment").value);
    });
    document.addEventListener("customers:changed", () => {
      populateCustomerSelect(byId("visit-filter-customer"), { includeAll: true });
      renderTable();
    });
    listenersBound = true;
  }
  return refreshMowLogView();
}
