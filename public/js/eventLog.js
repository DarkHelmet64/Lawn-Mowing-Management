import { createDoc } from "./db.js";
import { byId, escapeHtml, todayStr } from "./utils.js";
import { getCustomers, populateCustomerSelect } from "./customers.js";
import {
  populateEquipmentSelect,
  populateDeckHeightSelect,
  populateGroundSpeedSelect,
  populateBladeSpeedSelect,
} from "./equipment.js";
import { getLocationsForCustomer, populateLocationSelect } from "./locations.js";
import { getAreasForLocation, areaAppliesToEventTypes } from "./areas.js";
import { getYardFeatures } from "./yardFeatures.js";
import { loadVisits } from "./mowLog.js";
import { loadSprays } from "./sprayLog.js";
import { EVENT_TYPE_LABELS, EVENT_TYPE_KEYS } from "./eventTypes.js";

// Areas with these exact names are the default pick whenever Yard Work is
// the active event type - see applyYardworkDefaults().
const DEFAULT_YARDWORK_AREA_NAMES = new Set(["Front Yard", "Back Yard"]);

function primaryCategory() {
  return byId("event-category").value;
}

function secondaryCategory() {
  return byId("event-category-2").value;
}

function tertiaryCategory() {
  return byId("event-category-3").value;
}

// All three event types can be active at once: the primary dropdown, plus up
// to two "Add Another Event Type" picks.
function activeCategories() {
  return [primaryCategory(), secondaryCategory(), tertiaryCategory()].filter(Boolean);
}

function populateCategoryOptions(selectEl, excludeKeys) {
  const current = selectEl.value;
  selectEl.innerHTML = '<option value="">None</option>';
  for (const key of EVENT_TYPE_KEYS) {
    if (excludeKeys.includes(key)) continue;
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = EVENT_TYPE_LABELS[key];
    selectEl.appendChild(opt);
  }
  if (current && [...selectEl.options].some((o) => o.value === current)) {
    selectEl.value = current;
  }
}

// The second dropdown offers the two types not already chosen as primary.
// The third only makes sense once a second has been picked, and then offers
// whichever single type is left.
function refreshCategoryChoices() {
  populateCategoryOptions(byId("event-category-2"), [primaryCategory()]);
  const third = byId("event-category-3");
  if (secondaryCategory()) {
    third.disabled = false;
    populateCategoryOptions(third, [primaryCategory(), secondaryCategory()]);
  } else {
    third.disabled = true;
    third.innerHTML = '<option value="">None</option>';
  }
}

function applyYardworkDefaults() {
  byId("event-mowed").checked = true;
  byId("event-trimmed").checked = true;
  byId("event-edged").checked = true;
}

const FIELD_GROUP_BY_TYPE = {
  yardwork: "event-yardwork-fields",
  extra_yardwork: "event-extra-yardwork-fields",
  chemical: "event-chemical-fields",
};

// Each event type's own fields travel with wherever that type is currently
// selected - if Extra Yard Work is picked in the "Add Another" slot, its
// fields move to sit right after that slot's dropdown instead of staying in
// a fixed position.
function positionCategoryFields() {
  const anchorForType = {};
  if (primaryCategory()) anchorForType[primaryCategory()] = byId("event-category").closest("label");
  if (secondaryCategory()) anchorForType[secondaryCategory()] = byId("event-category-2").closest("label");
  if (tertiaryCategory()) anchorForType[tertiaryCategory()] = byId("event-category-3").closest("label");

  for (const [type, groupId] of Object.entries(FIELD_GROUP_BY_TYPE)) {
    const anchor = anchorForType[type];
    if (anchor) anchor.after(byId(groupId));
  }
}

function checkedAreaIds() {
  return Array.from(document.querySelectorAll("#event-area-list .event-area-checkbox:checked")).map((cb) => cb.value);
}

function updateFieldVisibility() {
  positionCategoryFields();
  const types = activeCategories();
  byId("event-yardwork-fields").classList.toggle("hidden", !types.includes("yardwork"));
  byId("event-extra-yardwork-fields").classList.toggle("hidden", !types.includes("extra_yardwork"));
  byId("event-chemical-fields").classList.toggle("hidden", !types.includes("chemical"));
  updateMowedFieldsVisibility();
}

// Mow Pattern/Deck Height/Ground Speed/Blade Speed/Grass Condition (and the
// Equipment Used filter) only apply when Mowed itself is checked - trimming
// or edging alone doesn't need a mow pattern or deck height.
function updateMowedFieldsVisibility() {
  const mowed = activeCategories().includes("yardwork") && byId("event-mowed").checked;
  byId("event-mowed-fields").classList.toggle("hidden", !mowed);
  populateEquipmentSelect(byId("event-equipment"), { typeFilter: mowed ? "mower" : null });
  if (mowed) applyGrassConditionDefault();
}

// Grass Condition defaults to Damp when Time of Day is Morning, or Dry
// otherwise - but only while Grass Condition is actually visible.
function applyGrassConditionDefault() {
  const visible = activeCategories().includes("yardwork") && byId("event-mowed").checked;
  if (!visible) return;
  byId("event-grass-condition").value = byId("event-time-of-day").value === "morning" ? "damp" : "dry";
}

function refreshLocationOptions() {
  const customerId = byId("event-customer").value;
  populateLocationSelect(byId("event-location"), customerId);
  const locations = getLocationsForCustomer(customerId);
  if (locations.length) byId("event-location").value = locations[0].id;
  refreshAreaOptions();
}

// Areas are scoped to the selected location and to whichever event types
// are currently active - an area only shows up here if it's configured (in
// Settings) to populate under at least one of those event types. Whenever
// Yard Work is active, Front Yard/Back Yard (if present) are the default
// picks; other event types keep whatever was already checked.
function refreshAreaOptions() {
  const locationId = byId("event-location").value;
  const types = activeCategories();
  const yardworkActive = types.includes("yardwork");
  const previouslyChecked = new Set(checkedAreaIds());
  const areas = getAreasForLocation(locationId).filter((a) => areaAppliesToEventTypes(a, types));
  const container = byId("event-area-list");

  container.innerHTML = areas.length
    ? areas
        .map((a) => {
          const checked = yardworkActive ? DEFAULT_YARDWORK_AREA_NAMES.has(a.name) : previouslyChecked.has(a.id);
          return `
      <label class="checkbox-label">
        <input type="checkbox" class="event-area-checkbox" value="${a.id}" ${checked ? "checked" : ""} />
        ${escapeHtml(a.name)}
      </label>`;
        })
        .join("")
    : `<p class="hint-text">No areas set up for this event type at this location.</p>`;

  container.querySelectorAll(".event-area-checkbox").forEach((cb) => cb.addEventListener("change", refreshFeatureOptions));
  refreshFeatureOptions();
}

// The Plant/Object dropdown covers the union of features across every
// currently-checked area, since Areas is a multi-select.
function refreshFeatureOptions() {
  const areaIds = new Set(checkedAreaIds());
  const select = byId("event-feature");
  const current = select.value;
  select.innerHTML = '<option value="">None / Not specific</option>';
  for (const f of getYardFeatures().filter((f) => areaIds.has(f.areaId))) {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = f.name;
    select.appendChild(opt);
  }
  if (current && [...select.options].some((o) => o.value === current)) {
    select.value = current;
  }
}

function openForm() {
  byId("log-event-form-card").classList.remove("hidden");
  populateCustomerSelect(byId("event-customer"));
  byId("event-customer").value = getCustomers()[0]?.id || "";
  byId("event-date").value = todayStr();
  byId("event-category").value = "yardwork";
  byId("event-category-2").value = "";
  byId("event-category-3").value = "";
  refreshCategoryChoices();
  byId("event-equipment").innerHTML = "";
  applyYardworkDefaults();
  byId("event-pruned").checked = false;
  byId("event-trimmed-bushes").checked = false;
  byId("event-mulched").checked = false;
  byId("event-pattern").value = "parallel";
  populateDeckHeightSelect(byId("event-height"), "");
  populateGroundSpeedSelect(byId("event-ground-speed"), "");
  populateBladeSpeedSelect(byId("event-blade-speed"), "");
  byId("event-time-of-day").value = "";
  byId("event-spray-target").value = "weeds";
  byId("event-spray-product").value = "";
  byId("event-notes").value = "";
  refreshLocationOptions();
  updateFieldVisibility();
}

function closeForm() {
  byId("log-event-form-card").classList.add("hidden");
  byId("log-event-form").reset();
}

async function handleSubmit(e) {
  e.preventDefault();
  const customerId = byId("event-customer").value;
  const date = byId("event-date").value;
  const timeOfDay = byId("event-time-of-day").value || null;
  const notes = byId("event-notes").value.trim();
  const locationId = byId("event-location").value || null;
  const equipmentId = byId("event-equipment").value || null;
  const types = activeCategories();

  const yardworkOn = types.includes("yardwork");
  const extraOn = types.includes("extra_yardwork");
  const chemicalOn = types.includes("chemical");
  const featureId = extraOn ? byId("event-feature").value || null : null;

  let mowFields = null;
  if (yardworkOn || extraOn) {
    mowFields = {
      mowed: yardworkOn && byId("event-mowed").checked,
      trimmed: yardworkOn && byId("event-trimmed").checked,
      edged: yardworkOn && byId("event-edged").checked,
      pruned: extraOn && byId("event-pruned").checked,
      trimmedBushes: extraOn && byId("event-trimmed-bushes").checked,
      mulched: extraOn && byId("event-mulched").checked,
      pattern: yardworkOn ? byId("event-pattern").value : null,
      deckHeight: yardworkOn && byId("event-height").value ? Number(byId("event-height").value) : null,
      groundSpeed: yardworkOn ? byId("event-ground-speed").value || null : null,
      bladeSpeed: yardworkOn ? byId("event-blade-speed").value || null : null,
      timeOfDay,
      grassCondition: yardworkOn ? byId("event-grass-condition").value || null : null,
    };
    if (
      !mowFields.mowed &&
      !mowFields.trimmed &&
      !mowFields.edged &&
      !mowFields.pruned &&
      !mowFields.trimmedBushes &&
      !mowFields.mulched
    ) {
      alert("Select at least one yard work task.");
      return;
    }
  }

  let sprayProduct = null;
  if (chemicalOn) {
    sprayProduct = byId("event-spray-product").value.trim();
    if (!sprayProduct) {
      alert("Enter the product used.");
      return;
    }
  }

  // Areas are multi-select, so one form submission fans out into one record
  // per selected area (or a single unspecified-area record if none picked).
  const areaIds = checkedAreaIds();
  const areaTargets = areaIds.length ? areaIds : [null];

  for (const areaId of areaTargets) {
    if (mowFields) {
      await createDoc("mowVisits", { customerId, date, ...mowFields, locationId, areaId, featureId, equipmentId, notes });
    }
    if (chemicalOn) {
      await createDoc("sprayApplications", {
        customerId,
        date,
        timeOfDay,
        target: byId("event-spray-target").value,
        product: sprayProduct,
        locationId,
        areaId,
        featureId,
        equipmentId,
        notes,
      });
    }
  }

  if (mowFields) await loadVisits();
  if (chemicalOn) await loadSprays();

  closeForm();
  document.dispatchEvent(new CustomEvent("event:logged"));
}

export function initEventLogView() {
  byId("log-event-btn").addEventListener("click", () => {
    if (!getCustomers().length) {
      alert("Add a customer first.");
      return;
    }
    openForm();
  });
  byId("cancel-event-btn").addEventListener("click", closeForm);
  byId("event-category").addEventListener("change", () => {
    refreshCategoryChoices();
    if (primaryCategory() === "yardwork") applyYardworkDefaults();
    updateFieldVisibility();
    refreshAreaOptions();
  });
  byId("event-category-2").addEventListener("change", () => {
    refreshCategoryChoices();
    if (secondaryCategory() === "yardwork") applyYardworkDefaults();
    updateFieldVisibility();
    refreshAreaOptions();
  });
  byId("event-category-3").addEventListener("change", () => {
    if (tertiaryCategory() === "yardwork") applyYardworkDefaults();
    updateFieldVisibility();
    refreshAreaOptions();
  });
  byId("event-mowed").addEventListener("change", updateMowedFieldsVisibility);
  byId("event-time-of-day").addEventListener("change", applyGrassConditionDefault);
  byId("event-customer").addEventListener("change", refreshLocationOptions);
  byId("event-location").addEventListener("change", refreshAreaOptions);
  byId("event-equipment").addEventListener("change", () => {
    populateDeckHeightSelect(byId("event-height"), byId("event-equipment").value);
    populateGroundSpeedSelect(byId("event-ground-speed"), byId("event-equipment").value);
    populateBladeSpeedSelect(byId("event-blade-speed"), byId("event-equipment").value);
  });
  byId("log-event-form").addEventListener("submit", handleSubmit);
}
