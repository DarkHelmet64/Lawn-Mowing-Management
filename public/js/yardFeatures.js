import { listAll, createDoc, updateDocById, deleteDocById } from "./db.js";
import { byId, escapeHtml } from "./utils.js";
import { getCustomers, getCustomerName, populateCustomerSelect } from "./customers.js";

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

// Populates a <select> with the yard features belonging to customerId only.
export function populateYardFeatureSelect(selectEl, customerId, { includeNone = true } = {}) {
  const current = selectEl.value;
  selectEl.innerHTML = "";
  if (includeNone) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "None / Not specific";
    selectEl.appendChild(opt);
  }
  for (const f of cache.filter((f) => f.customerId === customerId)) {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = f.name;
    selectEl.appendChild(opt);
  }
  if (current && [...selectEl.options].some((o) => o.value === current)) {
    selectEl.value = current;
  }
}

function renderTable() {
  const body = byId("feature-table-body");
  body.innerHTML = cache
    .map(
      (f) => `
      <tr>
        <td>${escapeHtml(f.name)}</td>
        <td>${escapeHtml(getCustomerName(f.customerId))}</td>
        <td>${FEATURE_TYPE_LABELS[f.type] || f.type}</td>
        <td>${escapeHtml(f.notes || "")}</td>
        <td class="row-actions">
          <button class="link-btn" data-edit="${f.id}">Edit</button>
          <button class="link-btn danger" data-delete="${f.id}">Delete</button>
        </td>
      </tr>`
    )
    .join("");

  body.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openForm(cache.find((f) => f.id === btn.dataset.edit)))
  );
  body.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => handleDelete(btn.dataset.delete))
  );
}

function openForm(feature = null) {
  byId("feature-form-card").classList.remove("hidden");
  byId("feature-form-title").textContent = feature ? "Edit Yard Feature" : "Add Yard Feature";
  populateCustomerSelect(byId("feature-customer"));
  byId("feature-id").value = feature?.id || "";
  byId("feature-customer").value = feature?.customerId || getCustomers()[0]?.id || "";
  byId("feature-name").value = feature?.name || "";
  byId("feature-type").value = feature?.type || "plant";
  byId("feature-notes").value = feature?.notes || "";
}

function closeForm() {
  byId("feature-form-card").classList.add("hidden");
  byId("feature-form").reset();
}

async function handleDelete(id) {
  if (!confirm("Delete this yard feature?")) return;
  await deleteDocById(COLLECTION, id);
  await refreshYardFeaturesView();
}

async function handleSubmit(e) {
  e.preventDefault();
  const id = byId("feature-id").value;
  const data = {
    customerId: byId("feature-customer").value,
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
      if (!getCustomers().length) {
        alert("Add a customer first.");
        return;
      }
      openForm();
    });
    byId("cancel-feature-btn").addEventListener("click", closeForm);
    byId("feature-form").addEventListener("submit", handleSubmit);
    listenersBound = true;
  }
  return refreshYardFeaturesView();
}
