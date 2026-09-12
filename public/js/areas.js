import { listAll, createDoc, updateDocById, deleteDocById } from "./db.js";
import { byId, escapeHtml } from "./utils.js";
import { getCustomers, getCustomerName, populateCustomerSelect } from "./customers.js";
import { getLocations, getLocationsForCustomer, getLocationLabel, populateLocationSelect } from "./locations.js";

const COLLECTION = "areas";
let cache = [];
let listenersBound = false;

export async function loadAreas() {
  cache = await listAll(COLLECTION, { orderByField: "name", direction: "asc" });
  return cache;
}

export function getAreas() {
  return cache;
}

export function getAreasForLocation(locationId) {
  return cache.filter((a) => a.locationId === locationId);
}

export function getAreaName(id) {
  return cache.find((a) => a.id === id)?.name || null;
}

// Populates a <select> with the areas belonging to locationId only.
export function populateAreaSelect(selectEl, locationId, { includeNone = true } = {}) {
  const current = selectEl.value;
  selectEl.innerHTML = "";
  if (includeNone) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Not specified";
    selectEl.appendChild(opt);
  }
  for (const a of getAreasForLocation(locationId)) {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = a.name;
    selectEl.appendChild(opt);
  }
  if (current && [...selectEl.options].some((o) => o.value === current)) {
    selectEl.value = current;
  }
}

function locationContext(locationId) {
  const loc = getLocations().find((l) => l.id === locationId);
  if (!loc) return "";
  return `${loc.label} (${getCustomerName(loc.customerId)})`;
}

function renderTable() {
  const body = byId("area-table-body");
  body.innerHTML = cache
    .map(
      (a) => `
      <tr>
        <td>${escapeHtml(a.name)}</td>
        <td>${escapeHtml(locationContext(a.locationId))}</td>
        <td>${escapeHtml(a.notes || "")}</td>
        <td class="row-actions">
          <button class="link-btn" data-edit="${a.id}">Edit</button>
          <button class="link-btn danger" data-delete="${a.id}">Delete</button>
        </td>
      </tr>`
    )
    .join("");

  body.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openForm(cache.find((a) => a.id === btn.dataset.edit)))
  );
  body.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => handleDelete(btn.dataset.delete))
  );
}

function refreshLocationOptions() {
  populateLocationSelect(byId("area-location"), byId("area-customer").value, { includeNone: false });
}

function openForm(area = null) {
  byId("area-form-card").classList.remove("hidden");
  byId("area-form-title").textContent = area ? "Edit Area" : "Add Area";
  const loc = area ? getLocations().find((l) => l.id === area.locationId) : null;
  populateCustomerSelect(byId("area-customer"));
  byId("area-id").value = area?.id || "";
  byId("area-customer").value = loc?.customerId || getCustomers()[0]?.id || "";
  refreshLocationOptions();
  byId("area-location").value = area?.locationId || "";
  byId("area-name").value = area?.name || "";
  byId("area-notes").value = area?.notes || "";
}

function closeForm() {
  byId("area-form-card").classList.add("hidden");
  byId("area-form").reset();
}

async function handleDelete(id) {
  if (!confirm("Delete this area? Yard features under it will be orphaned, not deleted.")) return;
  await deleteDocById(COLLECTION, id);
  await refreshAreasView();
}

async function handleSubmit(e) {
  e.preventDefault();
  const id = byId("area-id").value;
  const locationId = byId("area-location").value;
  if (!locationId) {
    alert("Select a location for this area.");
    return;
  }
  const data = {
    locationId,
    name: byId("area-name").value.trim(),
    notes: byId("area-notes").value.trim(),
  };
  if (id) await updateDocById(COLLECTION, id, data);
  else await createDoc(COLLECTION, data);
  closeForm();
  await refreshAreasView();
}

export async function refreshAreasView() {
  await loadAreas();
  renderTable();
  document.dispatchEvent(new CustomEvent("areas:changed"));
}

export function initAreasView() {
  if (!listenersBound) {
    byId("add-area-btn").addEventListener("click", () => {
      if (!getLocations().length) {
        alert("Add a location first.");
        return;
      }
      openForm();
    });
    byId("cancel-area-btn").addEventListener("click", closeForm);
    byId("area-form").addEventListener("submit", handleSubmit);
    byId("area-customer").addEventListener("change", refreshLocationOptions);
    listenersBound = true;
  }
  return refreshAreasView();
}
