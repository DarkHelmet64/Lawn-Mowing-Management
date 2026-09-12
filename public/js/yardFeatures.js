import { listAll, createDoc, updateDocById, deleteDocById } from "./db.js";
import { byId, escapeHtml } from "./utils.js";
import { getCustomers, getCustomerName, populateCustomerSelect } from "./customers.js";
import { getLocations, getLocationsForCustomer, populateLocationSelect } from "./locations.js";
import { getAreas, getAreaName, populateAreaSelect } from "./areas.js";

function populateFilterCustomerOptions() {
  const select = byId("feature-filter-customer");
  const current = select.value;
  populateCustomerSelect(select, { includeAll: true });
  select.options[0].textContent = "Select a customer…";
  if (current) select.value = current;
}

function refreshFilterAreaOptions() {
  const customerId = byId("feature-filter-customer").value;
  const areaSelect = byId("feature-filter-area");
  const current = areaSelect.value;
  if (!customerId) {
    areaSelect.innerHTML = '<option value="">Select a customer first</option>';
    areaSelect.disabled = true;
    return;
  }
  areaSelect.disabled = false;
  const locationIds = new Set(getLocationsForCustomer(customerId).map((l) => l.id));
  areaSelect.innerHTML = '<option value="">Select an area…</option>';
  for (const a of getAreas().filter((a) => locationIds.has(a.locationId))) {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = a.name;
    areaSelect.appendChild(opt);
  }
  if (current && [...areaSelect.options].some((o) => o.value === current)) {
    areaSelect.value = current;
  }
}

const COLLECTION = "yardFeatures";
let cache = [];
let listenersBound = false;

export const FEATURE_TYPE_LABELS = {
  plant: "Plant",
  tree: "Tree",
  shrub: "Shrub",
  hardscape: "Hardscape",
  other: "Other",
};

export async function loadYardFeatures() {
  cache = await listAll(COLLECTION, { orderByField: "name", direction: "asc" });
  return cache;
}

export function getYardFeatures() {
  return cache;
}

export function getYardFeatureName(id) {
  return cache.find((f) => f.id === id)?.name || null;
}

// Populates a <select> with the yard features belonging to areaId only.
export function populateYardFeatureSelect(selectEl, areaId, { includeNone = true } = {}) {
  const current = selectEl.value;
  selectEl.innerHTML = "";
  if (includeNone) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "None / Not specific";
    selectEl.appendChild(opt);
  }
  for (const f of cache.filter((f) => f.areaId === areaId)) {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = f.name;
    selectEl.appendChild(opt);
  }
  if (current && [...selectEl.options].some((o) => o.value === current)) {
    selectEl.value = current;
  }
}

function areaContext(areaId) {
  const area = getAreas().find((a) => a.id === areaId);
  if (!area) return "";
  const loc = getLocations().find((l) => l.id === area.locationId);
  if (!loc) return area.name;
  return `${area.name} · ${loc.label} (${getCustomerName(loc.customerId)})`;
}

function renderTable() {
  const areaFilter = byId("feature-filter-area").value;
  const body = byId("feature-table-body");
  if (!areaFilter) {
    body.innerHTML = `<tr><td colspan="5" class="hint-text">Select a customer and area above to see yard features.</td></tr>`;
    return;
  }
  body.innerHTML = cache
    .filter((f) => f.areaId === areaFilter)
    .map(
      (f) => `
      <tr>
        <td>${escapeHtml(f.name)}</td>
        <td>${escapeHtml(areaContext(f.areaId))}</td>
        <td>${FEATURE_TYPE_LABELS[f.type] || f.type}</td>
        <td>${escapeHtml(f.notes || "")}</td>
        <td class="row-actions">
          <button class="link-btn" data-edit="${f.id}">✏️ Edit</button>
        </td>
      </tr>`
    )
    .join("");

  body.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openForm(cache.find((f) => f.id === btn.dataset.edit)))
  );
}

function refreshLocationOptions() {
  populateLocationSelect(byId("feature-location"), byId("feature-customer").value, { includeNone: false });
  refreshAreaOptions();
}

function refreshAreaOptions() {
  populateAreaSelect(byId("feature-area"), byId("feature-location").value, { includeNone: false });
}

function openForm(feature = null) {
  byId("feature-form-card").classList.remove("hidden");
  byId("feature-filter-row").classList.add("hidden");
  byId("feature-form-title").textContent = feature ? "Edit Yard Feature" : "Add Yard Feature";

  const area = feature ? getAreas().find((a) => a.id === feature.areaId) : null;
  const loc = area ? getLocations().find((l) => l.id === area.locationId) : null;

  populateCustomerSelect(byId("feature-customer"));
  byId("feature-id").value = feature?.id || "";
  byId("feature-customer").value = loc?.customerId || getCustomers()[0]?.id || "";
  refreshLocationOptions();
  byId("feature-location").value = loc?.id || "";
  refreshAreaOptions();
  byId("feature-area").value = feature?.areaId || "";
  byId("feature-name").value = feature?.name || "";
  byId("feature-type").value = feature?.type || "plant";
  byId("feature-notes").value = feature?.notes || "";
  byId("delete-feature-btn").classList.toggle("hidden", !feature);
}

function closeForm() {
  byId("feature-form-card").classList.add("hidden");
  byId("feature-filter-row").classList.remove("hidden");
  byId("feature-form").reset();
}

async function handleDelete() {
  const id = byId("feature-id").value;
  if (!id) return;
  if (!confirm("Delete this yard feature?")) return;
  await deleteDocById(COLLECTION, id);
  closeForm();
  await refreshYardFeaturesView();
}

async function handleSubmit(e) {
  e.preventDefault();
  const id = byId("feature-id").value;
  const areaId = byId("feature-area").value;
  if (!areaId) {
    alert("Select an area for this feature.");
    return;
  }
  const data = {
    areaId,
    name: byId("feature-name").value.trim(),
    type: byId("feature-type").value,
    notes: byId("feature-notes").value.trim(),
  };
  if (id) await updateDocById(COLLECTION, id, data);
  else await createDoc(COLLECTION, data);
  closeForm();
  await refreshYardFeaturesView();
}

export async function refreshYardFeaturesView() {
  await loadYardFeatures();
  populateFilterCustomerOptions();
  refreshFilterAreaOptions();
  renderTable();
  document.dispatchEvent(new CustomEvent("features:changed"));
}

export function initYardFeaturesView() {
  if (!listenersBound) {
    byId("add-feature-btn").addEventListener("click", () => {
      if (!getAreas().length) {
        alert("Add an area first.");
        return;
      }
      openForm();
    });
    byId("cancel-feature-btn").addEventListener("click", closeForm);
    byId("feature-form").addEventListener("submit", handleSubmit);
    byId("delete-feature-btn").addEventListener("click", handleDelete);
    byId("feature-customer").addEventListener("change", refreshLocationOptions);
    byId("feature-location").addEventListener("change", refreshAreaOptions);
    byId("feature-filter-customer").addEventListener("change", () => {
      refreshFilterAreaOptions();
      renderTable();
    });
    byId("feature-filter-area").addEventListener("change", renderTable);
    listenersBound = true;
  }
  return refreshYardFeaturesView();
}
