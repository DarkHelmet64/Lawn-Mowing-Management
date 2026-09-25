import { createDoc } from "./db.js";
import { byId, escapeHtml, todayStr } from "./utils.js";
import { getCustomers } from "./customers.js";
import { getCustomerGroupById, populateGroupSelect } from "./customerGroups.js";
import {
  populateEquipmentSelect,
  populateDeckHeightSelect,
  populateGroundSpeedSelect,
  populateBladeSpeedSelect,
  getEquipmentById,
} from "./equipment.js";
import { getLocationsForCustomer, populateLocationSelect } from "./locations.js";
import { getAreasForLocation, areaAppliesToEventTypes } from "./areas.js";
import { getYardFeatures } from "./yardFeatures.js";
import { loadVisits } from "./mowLog.js";
import { loadSprays, getLastQuantityUsedForProduct } from "./sprayLog.js";
import { EVENT_TYPE_LABELS, EVENT_TYPE_KEYS } from "./eventTypes.js";
import { populateProductSelect, getProductById, adjustProductQuantity } from "./products.js";

// Areas with these exact names are the default pick whenever Yard Work is
// the active event type - see applyYardworkDefaults().
const DEFAULT_YARDWORK_AREA_NAMES = new Set(["Front Yard", "Back Yard"]);

// Customers are a multi-select too - Location/Areas are shared across
// whichever customers are checked (driven by the first one checked), and
// submitting fans out a copy of every record across all of them. This suits
// customers who share one property (e.g. a couple listed as two records)
// more than customers with entirely different addresses.
function checkedCustomerIds() {
  return Array.from(document.querySelectorAll("#event-customer-list .event-customer-checkbox:checked")).map(
    (cb) => cb.value
  );
}

function firstCheckedCustomerId() {
  return checkedCustomerIds()[0] || null;
}

// Renders fresh every time the form opens (customers don't change while it's
// open). preselectFirst defaults to true for a normal fresh open; "Save &
// Log Another" passes false so the next entry starts with nobody checked,
// forcing a deliberate pick of who's next rather than reusing whoever
// happens to be first alphabetically.
function renderCustomerList(preselectFirst = true) {
  const customers = getCustomers();
  const container = byId("event-customer-list");
  container.innerHTML = customers.length
    ? customers
        .map(
          (c, i) => `
      <label class="checkbox-label">
        <input type="checkbox" class="event-customer-checkbox" value="${c.id}" ${preselectFirst && i === 0 ? "checked" : ""} />
        ${escapeHtml(c.name)}
      </label>`
        )
        .join("")
    : `<p class="hint-text">Add a customer first.</p>`;

  container.querySelectorAll(".event-customer-checkbox").forEach((cb) => cb.addEventListener("change", refreshLocationOptions));
}

// Picking a group checks exactly that group's customers (replacing whatever
// was checked before) - a shortcut for the neighbors-mowed-together case
// this is built for, not an additive "also check these" merge.
function applyGroupSelection() {
  const group = getCustomerGroupById(byId("event-group").value);
  if (!group) return;
  document.querySelectorAll("#event-customer-list .event-customer-checkbox").forEach((cb) => {
    cb.checked = group.customerIds.includes(cb.value);
  });
  refreshLocationOptions();
}

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
  const thirdVisible = Boolean(secondaryCategory());
  byId("event-category-3-field").classList.toggle("hidden", !thirdVisible);
  if (thirdVisible) {
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

// Each event type has its own Areas checklist, nested inside that type's
// field group - so it travels with the group and only ever affects that
// one type's records, never the others.
function checkedAreaIds(type) {
  return Array.from(document.querySelectorAll(`#event-area-list-${type} .event-area-checkbox:checked`)).map(
    (cb) => cb.value
  );
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
// or edging alone doesn't need a mow pattern or deck height. handleSubmit
// reads Mower Used regardless of visibility, so whenever this group hides,
// the selection is cleared here too - otherwise a mower picked earlier
// would silently stay attached (and get saved) to a record it no longer
// applies to, with no visible field left to un-pick it from.
function updateMowedFieldsVisibility() {
  const mowed = activeCategories().includes("yardwork") && byId("event-mowed").checked;
  byId("event-mowed-fields").classList.toggle("hidden", !mowed);
  if (!mowed) byId("event-equipment").value = "";
  populateEquipmentSelect(byId("event-equipment"), { typeFilter: mowed ? "mower" : null });
  if (!mowed) applyEquipmentDefaults();
  if (mowed) applyGrassConditionDefault();
}

// Fills Deck Height/Ground Speed/Blade Speed from the selected mower's own
// configured defaults (set on the equipment record itself), while still
// leaving them editable for a one-off change on this visit.
function applyEquipmentDefaults() {
  const equipmentId = byId("event-equipment").value;
  const eq = getEquipmentById(equipmentId);
  populateDeckHeightSelect(byId("event-height"), equipmentId, eq?.defaultDeckHeight ?? null);
  populateGroundSpeedSelect(byId("event-ground-speed"), equipmentId, eq?.defaultGroundSpeed ?? null);
  populateBladeSpeedSelect(byId("event-blade-speed"), equipmentId, eq?.defaultBladeSpeed ?? null);
}

// Grass Condition defaults to Damp when Time of Day is Morning, or Dry
// otherwise - but only while Grass Condition is actually visible.
function applyGrassConditionDefault() {
  const visible = activeCategories().includes("yardwork") && byId("event-mowed").checked;
  if (!visible) return;
  byId("event-grass-condition").value = byId("event-time-of-day").value === "morning" ? "damp" : "dry";
}

function refreshLocationOptions() {
  const customerId = firstCheckedCustomerId();
  populateLocationSelect(byId("event-location"), customerId);
  const locations = customerId ? getLocationsForCustomer(customerId) : [];
  if (locations.length) byId("event-location").value = locations[0].id;
  refreshAreaOptions();
}

// Each event type's Areas checklist is scoped to the selected location and
// to that one type only - an area only shows up under, say, Chemical
// Application if it's configured (in Settings) to populate under Chemical
// Application, regardless of whether it's also checked under Yard Work.
// Yard Work's own list defaults to Front Yard/Back Yard (if present); the
// other types keep whatever was already checked in their own list.
function refreshAreaOptionsForType(type) {
  const locationId = byId("event-location").value;
  const previouslyChecked = new Set(checkedAreaIds(type));
  const areas = getAreasForLocation(locationId).filter((a) => areaAppliesToEventTypes(a, [type]));
  const container = byId(`event-area-list-${type}`);

  container.innerHTML = areas.length
    ? areas
        .map((a) => {
          const checked = type === "yardwork" ? DEFAULT_YARDWORK_AREA_NAMES.has(a.name) : previouslyChecked.has(a.id);
          return `
      <label class="checkbox-label">
        <input type="checkbox" class="event-area-checkbox" value="${a.id}" ${checked ? "checked" : ""} />
        ${escapeHtml(a.name)}
      </label>`;
        })
        .join("")
    : `<p class="hint-text">No areas set up for this event type at this location.</p>`;

  if (type === "extra_yardwork") {
    container.querySelectorAll(".event-area-checkbox").forEach((cb) => cb.addEventListener("change", refreshFeatureOptions));
  }
}

function refreshAreaOptions() {
  for (const type of EVENT_TYPE_KEYS) refreshAreaOptionsForType(type);
  refreshFeatureOptions();
}

// The Plant/Object dropdown is specific to Extra Yard Work, so it covers the
// union of features across whichever areas are checked in that type's own
// Areas list.
// Surfaces how much of the selected product is on hand right where the
// quantity gets entered, so a low/empty product is obvious before you
// submit, and prefills the quantity from whatever was used last time this
// same product was applied (any customer) - most products get reused at
// roughly the same dose, so this is usually right and always editable.
function updateProductHint() {
  const product = getProductById(byId("event-spray-product").value);
  byId("event-spray-quantity-hint").textContent = product ? `${product.quantityOnHand} ${product.unit} on hand` : "";
  const lastQuantity = product ? getLastQuantityUsedForProduct(product.id) : null;
  byId("event-spray-quantity").value = lastQuantity != null ? lastQuantity : "";
}

// Guesses Time of Day from the current clock so it's rarely left blank -
// still fully editable, and this only runs on a fresh open (see openForm),
// never overwriting what "Save & Log Another" is carrying forward.
function suggestedTimeOfDay() {
  const hour = new Date().getHours();
  if (hour < 11) return "morning";
  if (hour < 14) return "midday";
  if (hour < 18) return "afternoon";
  return "evening";
}

function refreshFeatureOptions() {
  const areaIds = new Set(checkedAreaIds("extra_yardwork"));
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
  renderCustomerList();
  populateGroupSelect(byId("event-group"));
  byId("event-group").value = "";
  byId("event-date").value = todayStr();
  byId("event-time-of-day").value = suggestedTimeOfDay();
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
  byId("event-spray-target").value = "weeds";
  populateProductSelect(byId("event-spray-product"));
  updateProductHint();
  byId("event-notes").value = "";
  refreshLocationOptions();
  updateFieldVisibility();
  applyEquipmentDefaults();
}

// Opens Log Event already pointed at specific customers and a date - used by
// History's "Log visit" shortcut for a group neighbor who was skipped.
export function openLogEventFor({ customerIds = [], date = null } = {}) {
  openForm();
  if (date) byId("event-date").value = date;
  if (customerIds.length) {
    document.querySelectorAll("#event-customer-list .event-customer-checkbox").forEach((cb) => {
      cb.checked = customerIds.includes(cb.value);
    });
    refreshLocationOptions();
  }
  byId("log-event-form-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeForm() {
  byId("log-event-form-card").classList.add("hidden");
  byId("log-event-form").reset();
}

// "Save & Log Another" keeps the form open for a quick repeat: date, time,
// event type, and its checkboxes/settings all carry over untouched (most
// consecutive visits share these), but Customers/Group reset to force a
// deliberate pick of who's next, and Notes clear since they're specific to
// the visit just saved.
function resetForNextEntry() {
  renderCustomerList(false);
  populateGroupSelect(byId("event-group"));
  byId("event-group").value = "";
  byId("event-notes").value = "";
  refreshLocationOptions();
}

// Each active event type is entirely independent: its own Areas checklist
// and its own fields, saved as one record per checked customer carrying all
// of that type's checked areas in areaIds. (Records used to be split one per
// area, which showed up as identical-looking duplicate rows.) Two types
// sharing the mowVisits collection (Yard Work, Extra Yard Work) still save
// separate records, since each has its own tasks and its own areas.
async function handleSubmit(e) {
  e.preventDefault();
  const logAnother = e.submitter?.id === "save-log-another-btn";
  const customerIds = checkedCustomerIds();
  if (!customerIds.length) {
    alert("Select at least one customer.");
    return;
  }
  const date = byId("event-date").value;
  const timeOfDay = byId("event-time-of-day").value || null;
  const notes = byId("event-notes").value.trim();
  const locationId = byId("event-location").value || null;
  const equipmentId = byId("event-equipment").value || null;
  const types = activeCategories();

  const yardworkOn = types.includes("yardwork");
  const extraOn = types.includes("extra_yardwork");
  const chemicalOn = types.includes("chemical");

  let yardworkFields = null;
  if (yardworkOn) {
    yardworkFields = {
      mowed: byId("event-mowed").checked,
      trimmed: byId("event-trimmed").checked,
      edged: byId("event-edged").checked,
      pattern: byId("event-pattern").value,
      deckHeight: byId("event-height").value ? Number(byId("event-height").value) : null,
      groundSpeed: byId("event-ground-speed").value || null,
      bladeSpeed: byId("event-blade-speed").value || null,
      grassCondition: byId("event-grass-condition").value || null,
    };
    if (!yardworkFields.mowed && !yardworkFields.trimmed && !yardworkFields.edged) {
      alert("Select at least one yard work task.");
      return;
    }
  }

  let extraFields = null;
  let featureId = null;
  if (extraOn) {
    extraFields = {
      pruned: byId("event-pruned").checked,
      trimmedBushes: byId("event-trimmed-bushes").checked,
      mulched: byId("event-mulched").checked,
    };
    if (!extraFields.pruned && !extraFields.trimmedBushes && !extraFields.mulched) {
      alert("Select at least one yard work task.");
      return;
    }
    featureId = byId("event-feature").value || null;
  }

  let productId = null;
  let quantityUsed = 0;
  if (chemicalOn) {
    productId = byId("event-spray-product").value || null;
    quantityUsed = Number(byId("event-spray-quantity").value) || 0;
    if (!productId) {
      alert("Select the product used.");
      return;
    }
    if (quantityUsed <= 0) {
      alert("Enter the quantity used.");
      return;
    }
  }

  const eventBase = { date, timeOfDay, locationId, equipmentId, notes };

  if (yardworkFields) {
    const areaIds = checkedAreaIds("yardwork");
    for (const customerId of customerIds) {
      await createDoc("mowVisits", {
        customerId,
        ...eventBase,
        ...yardworkFields,
        pruned: false,
        trimmedBushes: false,
        mulched: false,
        areaIds,
        featureId: null,
      });
    }
  }

  if (extraFields) {
    const areaIds = checkedAreaIds("extra_yardwork");
    for (const customerId of customerIds) {
      await createDoc("mowVisits", {
        customerId,
        ...eventBase,
        mowed: false,
        trimmed: false,
        edged: false,
        pattern: null,
        deckHeight: null,
        groundSpeed: null,
        bladeSpeed: null,
        grassCondition: null,
        ...extraFields,
        areaIds,
        featureId,
      });
    }
  }

  if (chemicalOn) {
    const areaIds = checkedAreaIds("chemical");
    for (const customerId of customerIds) {
      await createDoc("sprayApplications", {
        customerId,
        date,
        timeOfDay,
        target: byId("event-spray-target").value,
        productId,
        quantityUsed,
        locationId,
        areaIds,
        featureId: null,
        equipmentId,
        notes,
      });
    }
    // Each checked customer is its own real application, and quantityUsed
    // is that customer's whole job across all its areas.
    await adjustProductQuantity(productId, -(quantityUsed * customerIds.length));
  }

  if (yardworkFields || extraFields) await loadVisits();
  if (chemicalOn) await loadSprays();

  if (logAnother) resetForNextEntry();
  else closeForm();
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
  byId("event-location").addEventListener("change", refreshAreaOptions);
  byId("event-spray-product").addEventListener("change", updateProductHint);
  byId("event-equipment").addEventListener("change", applyEquipmentDefaults);
  byId("event-group").addEventListener("change", applyGroupSelection);
  byId("log-event-form").addEventListener("submit", handleSubmit);
}
