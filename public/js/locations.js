import { listAll, createDoc, updateDocById, deleteDocById } from "./db.js";
import { byId, escapeHtml } from "./utils.js";
import { getCustomers, getCustomerName, populateCustomerSelect } from "./customers.js";

const COLLECTION = "locations";
let cache = [];
let listenersBound = false;

export async function loadLocations() {
  cache = await listAll(COLLECTION, { orderByField: "label", direction: "asc" });
  return cache;
}

export function getLocations() {
  return cache;
}

export function getLocationsForCustomer(customerId) {
  return cache.filter((l) => l.customerId === customerId);
}

export function getLocationLabel(id) {
  return cache.find((l) => l.id === id)?.label || null;
}

// Populates a <select> with the locations belonging to customerId only.
export function populateLocationSelect(selectEl, customerId, { includeNone = true } = {}) {
  const current = selectEl.value;
  selectEl.innerHTML = "";
  if (includeNone) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Not specified";
    selectEl.appendChild(opt);
  }
  for (const l of getLocationsForCustomer(customerId)) {
    const opt = document.createElement("option");
    opt.value = l.id;
    opt.textContent = l.label;
    selectEl.appendChild(opt);
  }
  if (current && [...selectEl.options].some((o) => o.value === current)) {
    selectEl.value = current;
  }
}

function renderTable() {
  const body = byId("location-table-body");
  body.innerHTML = cache
    .map(
      (l) => `
      <tr>
        <td>${escapeHtml(l.label)}</td>
        <td>${escapeHtml(getCustomerName(l.customerId))}</td>
        <td>${escapeHtml(l.address || "")}</td>
        <td>${escapeHtml(l.notes || "")}</td>
        <td class="row-actions">
          <button class="link-btn" data-edit="${l.id}">Edit</button>
          <button class="link-btn danger" data-delete="${l.id}">Delete</button>
        </td>
      </tr>`
    )
    .join("");

  body.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openForm(cache.find((l) => l.id === btn.dataset.edit)))
  );
  body.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => handleDelete(btn.dataset.delete))
  );
}

function openForm(location = null) {
  byId("location-form-card").classList.remove("hidden");
  byId("location-form-title").textContent = location ? "Edit Location" : "Add Location";
  populateCustomerSelect(byId("location-customer"));
  byId("location-id").value = location?.id || "";
  byId("location-customer").value = location?.customerId || getCustomers()[0]?.id || "";
  byId("location-label").value = location?.label || "";
  byId("location-address").value = location?.address || "";
  byId("location-notes").value = location?.notes || "";
}

function closeForm() {
  byId("location-form-card").classList.add("hidden");
  byId("location-form").reset();
}

async function handleDelete(id) {
  if (!confirm("Delete this location? Areas and yard features under it will be orphaned, not deleted.")) return;
  await deleteDocById(COLLECTION, id);
  await refreshLocationsView();
}

async function handleSubmit(e) {
  e.preventDefault();
  const id = byId("location-id").value;
  const data = {
    customerId: byId("location-customer").value,
    label: byId("location-label").value.trim(),
    address: byId("location-address").value.trim(),
    notes: byId("location-notes").value.trim(),
  };
  if (id) await updateDocById(COLLECTION, id, data);
  else await createDoc(COLLECTION, data);
  closeForm();
  await refreshLocationsView();
}

export async function refreshLocationsView() {
  await loadLocations();
  renderTable();
  document.dispatchEvent(new CustomEvent("locations:changed"));
}

export function initLocationsView() {
  if (!listenersBound) {
    byId("add-location-btn").addEventListener("click", () => {
      if (!getCustomers().length) {
        alert("Add a customer first.");
        return;
      }
      openForm();
    });
    byId("cancel-location-btn").addEventListener("click", closeForm);
    byId("location-form").addEventListener("submit", handleSubmit);
    listenersBound = true;
  }
  return refreshLocationsView();
}
