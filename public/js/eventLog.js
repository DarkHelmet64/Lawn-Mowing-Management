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
import { EVENT_TYPE_KEYS } from "./eventTypes.js";

function typeToggleBtn(type) {
  return byId(`event-type-${type}`);
}

function activeEventTypes() {
  return EVENT_TYPE_KEYS.filter((t) => typeToggleBtn(t).classList.contains("active"));
}

function setActiveEventTypes(types) {
  for (const t of EVENT_TYPE_KEYS) {
    typeToggleBtn(t).classList.toggle("active", types.includes(t));
  }
}

function checkedAreaIds() {
  return Array.from(document.querySelectorAll("#event-area-list .event-area-checkbox:checked")).map((cb) => cb.value);
}

function updateFieldVisibility() {
  const types = activeEventTypes();
  byId("event-yardwork-fields").classList.toggle("hidden", !types.includes("yardwork"));
  byId("event-extra-yardwork-fields").classList.toggle("hidden", !types.includes("extra_yardwork"));
  byId("event-chemical-fields").classList.toggle("hidden", !types.includes("chemical"));
}

function refreshLocationOptions() {
  const customerId = byId("event-customer").value;
  populateLocationSelect(byId("event-location"), customerId);
  const locations = getLocationsForCustomer(customerId);
  if (locations.length) byId("event-location").value = locations[0].id;
  refreshAreaOptions();
}

// Areas are scoped to the selected location and to whichever event types
// are currently toggled on - an area only shows up here if it's configured
// (in Settings) to populate under at least one of those event types.
function refreshAreaOptions() {
  const locationId = byId("event-location").value;
  const types = activeEventTypes();
  const previouslyChecked = new Set(checkedAreaIds());
  const areas = getAreasForLocation(locationId).filter((a) => areaAppliesToEventTypes(a, types));
  const container = byId("event-area-list");

  container.innerHTML = areas.length
    ? areas
        .map(
          (a) => `
      <label class="checkbox-label">
        <input type="checkbox" class="event-area-checkbox" value="${a.id}" ${previouslyChecked.has(a.id) ? "checked" : ""} />
        ${escapeHtml(a.name)}
      </label>`
        )
        .join("")
    : `<p class="hint-text">No areas set up for this event type at this location.</p>`;

  container.querySelectorAll(".event-area-checkbox").forEach((cb) => cb.addEventListener("change", refreshFeatureOptions));
  refreshFeatureOptions();
}

// The Plant/Object dropdown covers the union of features across every
// currently-checked area, since Areas is now a multi-select.
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
  populateEquipmentSelect(byId("event-equipment"));
  byId("event-customer").value = getCustomers()[0]?.id || "";
  byId("event-date").value = todayStr();
  setActiveEventTypes(["yardwork"]);
  byId("event-equipment").value = "";
  byId("event-mowed").checked = true;
  byId("event-trimmed").checked = true;
  byId("event-edged").checked = false;
  byId("event-pruned").checked = false;
  byId("event-trimmed-bushes").checked = false;
  byId("event-mulched").checked = false;
  byId("event-pattern").value = "parallel";
  populateDeckHeightSelect(byId("event-height"), "");
  populateGroundSpeedSelect(byId("event-ground-speed"), "");
  populateBladeSpeedSelect(byId("event-blade-speed"), "");
  byId("event-time-of-day").value = "";
  byId("event-grass-condition").value = "";
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
  const notes = byId("event-notes").value.trim();
  const locationId = byId("event-location").value || null;
  const featureId = byId("event-feature").value || null;
  const equipmentId = byId("event-equipment").value || null;
  const types = activeEventTypes();

  if (!types.length) {
    alert("Select at least one event type.");
    return;
  }

  const yardworkOn = types.includes("yardwork");
  const extraOn = types.includes("extra_yardwork");
  const chemicalOn = types.includes("chemical");

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
      timeOfDay: yardworkOn ? byId("event-time-of-day").value || null : null,
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
  for (const t of EVENT_TYPE_KEYS) {
    typeToggleBtn(t).addEventListener("click", () => {
      typeToggleBtn(t).classList.toggle("active");
      updateFieldVisibility();
      refreshAreaOptions();
    });
  }
  byId("event-customer").addEventListener("change", refreshLocationOptions);
  byId("event-location").addEventListener("change", refreshAreaOptions);
  byId("event-equipment").addEventListener("change", () => {
    populateDeckHeightSelect(byId("event-height"), byId("event-equipment").value);
    populateGroundSpeedSelect(byId("event-ground-speed"), byId("event-equipment").value);
    populateBladeSpeedSelect(byId("event-blade-speed"), byId("event-equipment").value);
  });
  byId("log-event-form").addEventListener("submit", handleSubmit);
}
