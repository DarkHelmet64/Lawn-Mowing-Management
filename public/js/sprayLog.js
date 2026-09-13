import { listAll, createDoc, updateDocById, deleteDocById } from "./db.js";
import { byId, escapeHtml, todayStr, formatDateDisplay } from "./utils.js";
import { getCustomers, getCustomerName, populateCustomerSelect } from "./customers.js";
import { populateEquipmentSelect, getEquipmentName } from "./equipment.js";
import { getLocationLabel, populateLocationSelect } from "./locations.js";
import { getAreaName, populateAreaSelect } from "./areas.js";
import { populateYardFeatureSelect, getYardFeatureName } from "./yardFeatures.js";
import { populateProductSelect, getProductById, getProductName } from "./products.js";

const COLLECTION = "sprayApplications";
let cache = [];
let listenersBound = false;

const TARGET_LABELS = {
  weeds: "Weeds",
  insects: "Insects",
  fungus: "Fungus / Disease",
  fertilizer: "Fertilizer",
  other: "Other",
};

const TIME_OF_DAY_LABELS = {
  morning: "Morning",
  midday: "Midday",
  afternoon: "Afternoon",
  evening: "Evening",
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
        <td>${TIME_OF_DAY_LABELS[s.timeOfDay] || ""}</td>
        <td>${escapeHtml(getCustomerName(s.customerId))}</td>
        <td>${TARGET_LABELS[s.target] || s.target}</td>
        <td>${escapeHtml(getProductName(s.productId) || s.product || "")}${s.quantityUsed ? ` (${s.quantityUsed} ${escapeHtml(getProductById(s.productId)?.unit || "")})` : ""}</td>
        <td>${escapeHtml(getLocationLabel(s.locationId) || "")}</td>
        <td>${escapeHtml(getAreaName(s.areaId) || "")}</td>
        <td>${escapeHtml(getYardFeatureName(s.featureId) || "")}</td>
        <td>${escapeHtml(getEquipmentName(s.equipmentId) || "")}</td>
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

function refreshLocationOptions() {
  populateLocationSelect(byId("spray-location"), byId("spray-customer").value);
  refreshAreaOptions();
}

function refreshAreaOptions() {
  populateAreaSelect(byId("spray-area"), byId("spray-location").value);
  refreshFeatureOptions();
}

function refreshFeatureOptions() {
  populateYardFeatureSelect(byId("spray-feature"), byId("spray-area").value);
}

function openForm(spray = null) {
  byId("spray-form-card").classList.remove("hidden");
  populateCustomerSelect(byId("spray-customer"));
  populateEquipmentSelect(byId("spray-equipment"));
  populateProductSelect(byId("spray-product"));
  byId("spray-id").value = spray?.id || "";
  byId("spray-customer").value = spray?.customerId || getCustomers()[0]?.id || "";
  byId("spray-date").value = spray?.date || todayStr();
  byId("spray-time-of-day").value = spray?.timeOfDay || "";
  byId("spray-target").value = spray?.target || "weeds";
  byId("spray-product").value = spray?.productId || "";
  byId("spray-quantity").value = spray?.quantityUsed ?? "";
  byId("spray-equipment").value = spray?.equipmentId || "";
  byId("spray-notes").value = spray?.notes || "";

  refreshLocationOptions();
  byId("spray-location").value = spray?.locationId || "";
  refreshAreaOptions();
  byId("spray-area").value = spray?.areaId || "";
  refreshFeatureOptions();
  if (spray?.featureId) byId("spray-feature").value = spray.featureId;
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
    timeOfDay: byId("spray-time-of-day").value || null,
    target: byId("spray-target").value,
    productId: byId("spray-product").value || null,
    quantityUsed: byId("spray-quantity").value ? Number(byId("spray-quantity").value) : null,
    locationId: byId("spray-location").value || null,
    areaId: byId("spray-area").value || null,
    featureId: byId("spray-feature").value || null,
    equipmentId: byId("spray-equipment").value || null,
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
    byId("cancel-spray-btn").addEventListener("click", closeForm);
    byId("spray-form").addEventListener("submit", handleSubmit);
    byId("spray-customer").addEventListener("change", refreshLocationOptions);
    byId("spray-location").addEventListener("change", refreshAreaOptions);
    byId("spray-area").addEventListener("change", refreshFeatureOptions);
    document.addEventListener("customers:changed", renderTable);
    listenersBound = true;
  }
  return refreshSprayLogView();
}
