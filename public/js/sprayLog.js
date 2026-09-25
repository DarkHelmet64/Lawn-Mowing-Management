import { listAll, createDoc, updateDocById, deleteDocById } from "./db.js";
import { byId, todayStr, confirmAction } from "./utils.js";
import { getCustomers, populateCustomerSelect } from "./customers.js";
import { populateEquipmentSelect } from "./equipment.js";
import { populateLocationSelect } from "./locations.js";
import { recordAreaIds, renderAreaChecklist, checkedAreaIdsIn } from "./areas.js";
import { populateYardFeatureSelect } from "./yardFeatures.js";
import { populateProductSelect } from "./products.js";

// Spray applications: the data cache plus the Edit Spray form. How sprays
// are listed and browsed lives on the History page (history.js).
const COLLECTION = "sprayApplications";
let cache = [];
let listenersBound = false;

export const TARGET_LABELS = {
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

// The most recent quantity used for a given product, regardless of customer -
// lets Log Event suggest last time's dose instead of a blank field. cache is
// sorted by date only, which doesn't disambiguate same-day records, so
// createdAt breaks ties in favor of whichever was actually entered last.
export function getLastQuantityUsedForProduct(productId) {
  const matches = cache.filter((s) => s.productId === productId && s.quantityUsed != null);
  if (!matches.length) return null;
  const latest = matches.reduce((best, s) => {
    if (s.date !== best.date) return s.date > best.date ? s : best;
    const sTime = s.createdAt?.toMillis ? s.createdAt.toMillis() : 0;
    const bestTime = best.createdAt?.toMillis ? best.createdAt.toMillis() : 0;
    return sTime > bestTime ? s : best;
  });
  return latest.quantityUsed;
}

function recordsChanged() {
  document.dispatchEvent(new CustomEvent("records:changed"));
}

function refreshLocationOptions() {
  populateLocationSelect(byId("spray-location"), byId("spray-customer").value);
  refreshAreaOptions();
}

// Re-rendering on a location change keeps whichever areas were already
// checked (if they exist at the new location too - otherwise they drop off).
function refreshAreaOptions(checkedIds = checkedAreaIdsIn(byId("spray-area-list"))) {
  renderAreaChecklist(byId("spray-area-list"), byId("spray-location").value, checkedIds);
  refreshFeatureOptions();
}

function refreshFeatureOptions() {
  populateYardFeatureSelect(byId("spray-feature"), checkedAreaIdsIn(byId("spray-area-list")));
}

export function openSprayForm(spray = null) {
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
  refreshAreaOptions(recordAreaIds(spray));
  if (spray?.featureId) byId("spray-feature").value = spray.featureId;
  byId("spray-form-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeForm() {
  byId("spray-form-card").classList.add("hidden");
  byId("spray-form").reset();
}

export async function deleteSpray(id) {
  if (!(await confirmAction("Delete this spray record?"))) return;
  await deleteDocById(COLLECTION, id);
  await loadSprays();
  recordsChanged();
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
    areaIds: checkedAreaIdsIn(byId("spray-area-list")),
    // Clears the single-area field older records carry, now that areaIds
    // is the source of truth for this record.
    areaId: null,
    featureId: byId("spray-feature").value || null,
    equipmentId: byId("spray-equipment").value || null,
    notes: byId("spray-notes").value.trim(),
  };
  if (id) await updateDocById(COLLECTION, id, data);
  else await createDoc(COLLECTION, data);
  closeForm();
  await loadSprays();
  recordsChanged();
}

export function initSprayForm() {
  if (listenersBound) return;
  byId("cancel-spray-btn").addEventListener("click", closeForm);
  byId("spray-form").addEventListener("submit", handleSubmit);
  byId("spray-customer").addEventListener("change", refreshLocationOptions);
  byId("spray-location").addEventListener("change", () => refreshAreaOptions());
  byId("spray-area-list").addEventListener("change", refreshFeatureOptions);
  listenersBound = true;
}
