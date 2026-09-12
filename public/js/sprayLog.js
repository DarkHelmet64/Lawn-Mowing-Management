import { listAll, createDoc, updateDocById, deleteDocById } from "./db.js";
import { byId, escapeHtml, todayStr, formatDateDisplay } from "./utils.js";
import { getCustomers, getCustomerName, populateCustomerSelect } from "./customers.js";

const COLLECTION = "sprayApplications";
let cache = [];
let listenersBound = false;

const LOCATION_LABELS = {
  driveway: "Driveway",
  walkway: "Walkway / Sidewalk",
  flowerbed: "Flowerbed",
  lawn: "Lawn",
  other: "Other",
};

const TARGET_LABELS = {
  weeds: "Weeds",
  insects: "Insects",
  fungus: "Fungus / Disease",
  fertilizer: "Fertilizer",
  other: "Other",
};

export async function loadSprays() {
  cache = await listAll(COLLECTION, { orderByField: "date", direction: "desc" });
  return cache;
}

export function getSprays() {
  return cache;
}

function renderTable() {
  const body = byId("spray-table-body");
  body.innerHTML = cache
    .map(
      (s) => `
      <tr>
        <td>${formatDateDisplay(s.date)}</td>
        <td>${escapeHtml(getCustomerName(s.customerId))}</td>
        <td>${LOCATION_LABELS[s.location] || s.location}</td>
        <td>${TARGET_LABELS[s.target] || s.target}</td>
        <td>${escapeHtml(s.product || "")}</td>
        <td class="row-actions">
          <button class="link-btn" data-edit="${s.id}">Edit</button>
          <button class="link-btn danger" data-delete="${s.id}">Delete</button>
        </td>
      </tr>`
    )
    .join("");

  body.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openForm(cache.find((s) => s.id === btn.dataset.edit)))
  );
  body.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => handleDelete(btn.dataset.delete))
  );
}

function openForm(spray = null) {
  byId("spray-form-card").classList.remove("hidden");
  populateCustomerSelect(byId("spray-customer"));
  byId("spray-id").value = spray?.id || "";
  byId("spray-customer").value = spray?.customerId || getCustomers()[0]?.id || "";
  byId("spray-date").value = spray?.date || todayStr();
  byId("spray-location").value = spray?.location || "driveway";
  byId("spray-target").value = spray?.target || "weeds";
  byId("spray-product").value = spray?.product || "";
  byId("spray-notes").value = spray?.notes || "";
}

function closeForm() {
  byId("spray-form-card").classList.add("hidden");
  byId("spray-form").reset();
}

async function handleDelete(id) {
  if (!confirm("Delete this spray record?")) return;
  await deleteDocById(COLLECTION, id);
  await refreshSprayLogView();
}

async function handleSubmit(e) {
  e.preventDefault();
  const id = byId("spray-id").value;
  const data = {
    customerId: byId("spray-customer").value,
    date: byId("spray-date").value,
    location: byId("spray-location").value,
    target: byId("spray-target").value,
    product: byId("spray-product").value.trim(),
    notes: byId("spray-notes").value.trim(),
  };
  if (id) await updateDocById(COLLECTION, id, data);
  else await createDoc(COLLECTION, data);
  closeForm();
  await refreshSprayLogView();
}

export async function refreshSprayLogView() {
  await loadSprays();
  renderTable();
}

export function initSprayLogView() {
  if (!listenersBound) {
    byId("add-spray-btn").addEventListener("click", () => {
      if (!getCustomers().length) {
        alert("Add a customer first.");
        return;
      }
      openForm();
    });
    byId("cancel-spray-btn").addEventListener("click", closeForm);
    byId("spray-form").addEventListener("submit", handleSubmit);
    document.addEventListener("customers:changed", renderTable);
    listenersBound = true;
  }
  return refreshSprayLogView();
}
