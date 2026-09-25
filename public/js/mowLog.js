import { listAll, createDoc, updateDocById, deleteDocById } from "./db.js";
import { byId, todayStr, confirmAction, setPanelOpen, whenSummaryText } from "./utils.js";
import { getCustomers, customerChipsHtml } from "./customers.js";
import {
  populateEquipmentSelect,
  populateDeckHeightSelect,
  populateGroundSpeedSelect,
  populateBladeSpeedSelect,
  getEquipmentById,
  mowerSummary,
} from "./equipment.js";
import { populateLocationSelect, getLocationLabel } from "./locations.js";
import { recordAreaIds, renderAreaChecklist, checkedAreaIdsIn, getAreasForLocation, areaAppliesToEventTypes } from "./areas.js";
import { createCutEditor, visitCuts, cutFields } from "./cuts.js";
import { populateYardFeatureSelect } from "./yardFeatures.js";

// Yard work visits: the data cache plus the Edit Visit form (laid out like
// Log Event). How visits are listed and browsed lives in history.js.
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

function radioValue(name) {
  return document.querySelector(`#visit-form input[name="${name}"]:checked`)?.value || null;
}

function setRadio(name, value) {
  document.querySelectorAll(`#visit-form input[name="${name}"]`).forEach((r) => {
    r.checked = r.value === value;
  });
}

function selectedCustomerId() {
  return radioValue("visit-customer");
}

function updateWhenSummary() {
  byId("visit-when-summary").textContent = whenSummaryText(
    byId("visit-date").value,
    TIME_OF_DAY_LABELS[byId("visit-time-of-day").value],
    getLocationLabel(byId("visit-location").value)
  );
}

function updateMowerSummary() {
  byId("visit-mower-summary").textContent = mowerSummary({
    equipmentId: byId("visit-equipment").value,
    deckHeight: byId("visit-height").value,
    groundSpeed: byId("visit-ground-speed").value,
    bladeSpeed: byId("visit-blade-speed").value,
  });
}

function refreshLocationOptions() {
  populateLocationSelect(byId("visit-location"), selectedCustomerId());
  refreshAreaOptions();
  updateWhenSummary();
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
    pattern: radioValue("visit-pattern"),
    deckHeight: byId("visit-height").value ? Number(byId("visit-height").value) : null,
    groundSpeed: byId("visit-ground-speed").value || null,
    bladeSpeed: byId("visit-blade-speed").value || null,
    areaIds: checkedAreaIdsIn(byId("visit-area-list")),
  };
}

// Once there's a second cut, the main fields read as "cut 1".
function updateCutLabels() {
  const multi = cutEditor?.count() > 0;
  byId("visit-pattern-label").textContent = multi ? "Cut 1 pattern" : "Mow pattern";
  byId("visit-mower-label").textContent = multi ? "Mower · cut 1 settings" : "Mower";
}

function refreshFeatureOptions() {
  populateYardFeatureSelect(byId("visit-feature"), checkedAreaIdsIn(byId("visit-area-list")));
}

// The Mowing section (pattern, mower, cuts, grass) only applies when Mowed
// itself is checked - matches the Log Event form.
function updateMowedFieldsVisibility() {
  const mowed = byId("visit-mowed").checked;
  byId("visit-mowed-fields").classList.toggle("hidden", !mowed);
}

function populateMowerFields(equipmentId, { deckHeight = null, groundSpeed = null, bladeSpeed = null } = {}) {
  populateEquipmentSelect(byId("visit-equipment"), { typeFilter: "mower" });
  byId("visit-equipment").value = equipmentId || "";
  const id = byId("visit-equipment").value;
  populateDeckHeightSelect(byId("visit-height"), id, deckHeight);
  populateGroundSpeedSelect(byId("visit-ground-speed"), id, groundSpeed);
  populateBladeSpeedSelect(byId("visit-blade-speed"), id, bladeSpeed);
  updateMowerSummary();
}

function showNotes(show) {
  byId("visit-notes-field").classList.toggle("hidden", !show);
  byId("visit-add-note-btn").classList.toggle("hidden", show);
}

export function openVisitForm(visit = null) {
  byId("visit-form-card").classList.remove("hidden");
  byId("visit-id").value = visit?.id || "";
  byId("visit-customer-list").innerHTML = customerChipsHtml({
    name: "visit-customer",
    type: "radio",
    checkedIds: [visit?.customerId || getCustomers()[0]?.id].filter(Boolean),
  });
  byId("visit-date").value = visit?.date || todayStr();
  byId("visit-time-of-day").value = visit?.timeOfDay || "";
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
  setRadio("visit-pattern", cut1.pattern || visit?.pattern || "parallel");
  // Equipment on a record that isn't a mower (e.g. a trimmer on an extra
  // yard work visit) still shows, so it isn't lost on save.
  const eq = getEquipmentById(visit?.equipmentId);
  populateMowerFields(visit?.equipmentId, cut1);
  if (eq && eq.type !== "mower") {
    populateEquipmentSelect(byId("visit-equipment"));
    byId("visit-equipment").value = eq.id;
    updateMowerSummary();
  }
  setRadio("visit-grass", visit?.grassCondition || "");
  byId("visit-notes").value = visit?.notes || "";
  showNotes(Boolean(visit?.notes));
  updateMowedFieldsVisibility();
  setPanelOpen("visit-when-panel", false);
  setPanelOpen("visit-mower-panel", false);

  cutEditor.clear();
  refreshLocationOptions();
  byId("visit-location").value = visit?.locationId || "";
  refreshAreaOptions(cuts.length > 1 ? cut1.areaIds || [] : recordAreaIds(visit));
  cutEditor.set(cuts.slice(1));
  if (visit?.featureId) byId("visit-feature").value = visit.featureId;
  updateWhenSummary();
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
  const customerId = selectedCustomerId();
  if (!customerId) {
    alert("Pick the customer this visit was for.");
    return;
  }
  const id = byId("visit-id").value;
  const mowed = byId("visit-mowed").checked;
  const cutData = mowed
    ? cutFields([firstCut(), ...cutEditor.get()])
    : { pattern: null, deckHeight: null, groundSpeed: null, bladeSpeed: null, areaIds: checkedAreaIdsIn(byId("visit-area-list")), cuts: null };
  const data = {
    customerId,
    date: byId("visit-date").value,
    mowed,
    trimmed: byId("visit-trimmed").checked,
    edged: byId("visit-edged").checked,
    pruned: byId("visit-pruned").checked,
    trimmedBushes: byId("visit-trimmed-bushes").checked,
    mulched: byId("visit-mulched").checked,
    timeOfDay: byId("visit-time-of-day").value || null,
    grassCondition: mowed ? radioValue("visit-grass") : null,
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
  byId("visit-form").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-toggle-panel]");
    if (btn) setPanelOpen(btn.dataset.togglePanel, byId(btn.dataset.togglePanel).classList.contains("hidden"));
  });
  // Switching the record to another customer starts at their first location.
  byId("visit-customer-list").addEventListener("change", () => {
    refreshLocationOptions();
    const first = byId("visit-location").options[1];
    if (first) {
      byId("visit-location").value = first.value;
      refreshAreaOptions();
      updateWhenSummary();
    }
  });
  byId("visit-date").addEventListener("change", updateWhenSummary);
  byId("visit-time-of-day").addEventListener("change", updateWhenSummary);
  byId("visit-location").addEventListener("change", () => {
    refreshAreaOptions();
    updateWhenSummary();
  });
  byId("visit-area-list").addEventListener("change", refreshFeatureOptions);
  byId("visit-mowed").addEventListener("change", updateMowedFieldsVisibility);
  byId("visit-equipment").addEventListener("change", () => {
    // A different mower starts from its own configured defaults.
    const eq = getEquipmentById(byId("visit-equipment").value);
    populateDeckHeightSelect(byId("visit-height"), byId("visit-equipment").value, eq?.defaultDeckHeight ?? null);
    populateGroundSpeedSelect(byId("visit-ground-speed"), byId("visit-equipment").value, eq?.defaultGroundSpeed ?? null);
    populateBladeSpeedSelect(byId("visit-blade-speed"), byId("visit-equipment").value, eq?.defaultBladeSpeed ?? null);
    updateMowerSummary();
    cutEditor.refresh();
  });
  for (const id of ["visit-height", "visit-ground-speed", "visit-blade-speed"]) byId(id).addEventListener("change", updateMowerSummary);
  byId("visit-add-note-btn").addEventListener("click", () => {
    showNotes(true);
    byId("visit-notes").focus();
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
