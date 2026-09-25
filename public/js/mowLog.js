import { listAll, createDoc, updateDocById, deleteDocById } from "./db.js";
import { byId, todayStr, confirmAction } from "./utils.js";
import { getCustomers, populateCustomerSelect } from "./customers.js";
import {
  populateEquipmentSelect,
  populateDeckHeightSelect,
  populateGroundSpeedSelect,
  populateBladeSpeedSelect,
} from "./equipment.js";
import { populateLocationSelect } from "./locations.js";
import { recordAreaIds, renderAreaChecklist, checkedAreaIdsIn, getAreasForLocation, areaAppliesToEventTypes } from "./areas.js";
import { createCutEditor, visitCuts, cutFields } from "./cuts.js";
import { populateYardFeatureSelect } from "./yardFeatures.js";

// Yard work visits: the data cache plus the Edit Visit form. How visits are
// listed and browsed lives on the History page (history.js).
const COLLECTION = "mowVisits";
let cache = [];
let listenersBound = false;
// Cuts 2 and 3 of a double/triple cut (cut 1 is the form's main fields).
let cutEditor = null;

export { PATTERN_LABELS } from "./patterns.js";

export const TIME_OF_DAY_LABELS = {
  morning: "Morning",
  midday: "Midday",
  afternoon: "Afternoon",
  evening: "Evening",
  other: "Other",
};

export const GRASS_CONDITION_LABELS = {
  dry: "Dry",
  wet_dew: "Wet (dew)",
  wet_rain: "Wet (rain)",
  damp: "Damp",
  other: "Other",
};

export async function loadVisits() {
  cache = await listAll(COLLECTION, { orderByField: "date", direction: "desc" });
  return cache;
}

export function getVisits() {
  return cache;
}

// The most recent mowed visit (with a pattern recorded) among the given
// customers. cache is sorted by date only, so createdAt breaks same-day ties
// in favor of whichever was actually logged last.
export function getLastMowedVisit(customerIds) {
  const ids = new Set(customerIds);
  return cache
    .filter((v) => ids.has(v.customerId) && v.mowed && v.pattern)
    .reduce((best, v) => {
      if (!best) return v;
      if (v.date !== best.date) return v.date > best.date ? v : best;
      return (v.createdAt?.toMillis?.() ?? 0) > (best.createdAt?.toMillis?.() ?? 0) ? v : best;
    }, null);
}

function recordsChanged() {
  document.dispatchEvent(new CustomEvent("records:changed"));
}

function refreshLocationOptions() {
  populateLocationSelect(byId("visit-location"), byId("visit-customer").value);
  refreshAreaOptions();
}

// Re-rendering on a location change keeps whichever areas were already
// checked (if they exist at the new location too - otherwise they drop off).
function refreshAreaOptions(checkedIds = checkedAreaIdsIn(byId("visit-area-list"))) {
  renderAreaChecklist(byId("visit-area-list"), byId("visit-location").value, checkedIds);
  refreshFeatureOptions();
  cutEditor?.refresh();
}

// Cut 1 of the mow, from the main pattern, setting and area fields.
function firstCut() {
  return {
    pattern: byId("visit-pattern").value,
    deckHeight: byId("visit-height").value ? Number(byId("visit-height").value) : null,
    groundSpeed: byId("visit-ground-speed").value || null,
    bladeSpeed: byId("visit-blade-speed").value || null,
    areaIds: checkedAreaIdsIn(byId("visit-area-list")),
  };
}

function updateCutLabels() {
  byId("visit-pattern-label").textContent = cutEditor?.count() > 0 ? "Cut 1 Pattern" : "Mow Pattern";
}

function refreshFeatureOptions() {
  populateYardFeatureSelect(byId("visit-feature"), checkedAreaIdsIn(byId("visit-area-list")));
}

// Mow Pattern/Deck Height/Ground Speed/Blade Speed/Grass Condition (and the
// Mower Used filter) only apply when Mowed itself is checked - matches the
// Log Event form's behavior.
function updateMowedFieldsVisibility() {
  const mowed = byId("visit-mowed").checked;
  byId("visit-mowed-fields").classList.toggle("hidden", !mowed);
  populateEquipmentSelect(byId("visit-equipment"), { typeFilter: mowed ? "mower" : null });
}

export function openVisitForm(visit = null) {
  byId("visit-form-card").classList.remove("hidden");
  populateCustomerSelect(byId("visit-customer"));
  byId("visit-id").value = visit?.id || "";
  byId("visit-customer").value = visit?.customerId || getCustomers()[0]?.id || "";
  byId("visit-date").value = visit?.date || todayStr();
  byId("visit-mowed").checked = visit?.mowed ?? true;
  byId("visit-trimmed").checked = visit?.trimmed ?? true;
  byId("visit-edged").checked = visit?.edged ?? false;
  byId("visit-pruned").checked = visit?.pruned ?? false;
  byId("visit-trimmed-bushes").checked = visit?.trimmedBushes ?? false;
  byId("visit-mulched").checked = visit?.mulched ?? false;
  // A double/triple cut opens with cut 1 in the main fields and the rest
  // listed below them.
  const cuts = visit ? visitCuts(visit) : [];
  const cut1 = cuts[0] || {};
  byId("visit-pattern").value = cut1.pattern || visit?.pattern || "parallel";
  populateDeckHeightSelect(byId("visit-height"), visit?.equipmentId || "", cut1.deckHeight ?? null);
  populateGroundSpeedSelect(byId("visit-ground-speed"), visit?.equipmentId || "", cut1.groundSpeed ?? null);
  populateBladeSpeedSelect(byId("visit-blade-speed"), visit?.equipmentId || "", cut1.bladeSpeed ?? null);
  updateMowedFieldsVisibility();
  byId("visit-equipment").value = visit?.equipmentId || "";
  byId("visit-time-of-day").value = visit?.timeOfDay || "";
  byId("visit-grass-condition").value = visit?.grassCondition || "";
  byId("visit-notes").value = visit?.notes || "";

  cutEditor.clear();
  refreshLocationOptions();
  byId("visit-location").value = visit?.locationId || "";
  refreshAreaOptions(cuts.length > 1 ? cut1.areaIds || [] : recordAreaIds(visit));
  cutEditor.set(cuts.slice(1));
  if (visit?.featureId) byId("visit-feature").value = visit.featureId;
  byId("visit-form-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeForm() {
  byId("visit-form-card").classList.add("hidden");
  byId("visit-form").reset();
}

export async function deleteVisit(id) {
  if (!(await confirmAction("Delete this visit record?"))) return;
  await deleteDocById(COLLECTION, id);
  await loadVisits();
  recordsChanged();
}

async function handleSubmit(e) {
  e.preventDefault();
  const id = byId("visit-id").value;
  const mowed = byId("visit-mowed").checked;
  const cutData = mowed
    ? cutFields([firstCut(), ...cutEditor.get()])
    : { pattern: null, deckHeight: null, groundSpeed: null, bladeSpeed: null, areaIds: checkedAreaIdsIn(byId("visit-area-list")), cuts: null };
  const data = {
    customerId: byId("visit-customer").value,
    date: byId("visit-date").value,
    mowed,
    trimmed: byId("visit-trimmed").checked,
    edged: byId("visit-edged").checked,
    pruned: byId("visit-pruned").checked,
    trimmedBushes: byId("visit-trimmed-bushes").checked,
    mulched: byId("visit-mulched").checked,
    timeOfDay: byId("visit-time-of-day").value || null,
    grassCondition: byId("visit-grass-condition").value || null,
    locationId: byId("visit-location").value || null,
    ...cutData,
    // Clears the single-area field older records carry, now that areaIds
    // is the source of truth for this record.
    areaId: null,
    featureId: byId("visit-feature").value || null,
    equipmentId: byId("visit-equipment").value || null,
    notes: byId("visit-notes").value.trim(),
  };
  if (id) await updateDocById(COLLECTION, id, data);
  else await createDoc(COLLECTION, data);
  closeForm();
  await loadVisits();
  recordsChanged();
}

export function initVisitForm() {
  if (listenersBound) return;
  byId("cancel-visit-btn").addEventListener("click", closeForm);
  byId("visit-form").addEventListener("submit", handleSubmit);
  byId("visit-customer").addEventListener("change", refreshLocationOptions);
  byId("visit-location").addEventListener("change", () => refreshAreaOptions());
  byId("visit-area-list").addEventListener("change", refreshFeatureOptions);
  byId("visit-mowed").addEventListener("change", updateMowedFieldsVisibility);
  byId("visit-equipment").addEventListener("change", () => {
    populateDeckHeightSelect(byId("visit-height"), byId("visit-equipment").value);
    populateGroundSpeedSelect(byId("visit-ground-speed"), byId("visit-equipment").value);
    populateBladeSpeedSelect(byId("visit-blade-speed"), byId("visit-equipment").value);
    cutEditor.refresh();
  });
  cutEditor = createCutEditor({
    container: byId("visit-extra-cuts"),
    addButton: byId("visit-add-cut-btn"),
    namePrefix: "visit-cut",
    getMowerId: () => byId("visit-equipment").value,
    getAreas: () => getAreasForLocation(byId("visit-location").value).filter((a) => areaAppliesToEventTypes(a, ["yardwork"])),
    getFirstCut: firstCut,
    onChange: updateCutLabels,
  });
  listenersBound = true;
}
