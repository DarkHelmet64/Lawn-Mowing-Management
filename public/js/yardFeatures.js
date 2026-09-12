import { listAll, createDoc, updateDocById, deleteDocById } from "./db.js";
import { byId, escapeHtml } from "./utils.js";
import { getCustomers, getCustomerName, populateCustomerSelect } from "./customers.js";
import { getLocations, getLocationsForCustomer, populateLocationSelect } from "./locations.js";
import { getAreas, getAreaName, populateAreaSelect } from "./areas.js";

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
  const body = byId("feature-table-body");
  body.innerHTML = cache
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
    listenersBound = true;
  }
  return refreshYardFeaturesView();
}
