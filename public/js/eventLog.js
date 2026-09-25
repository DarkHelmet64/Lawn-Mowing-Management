import { createDoc } from "./db.js";
import { byId, escapeHtml, todayStr, formatDateDisplay, setPanelOpen } from "./utils.js";
import { getCustomers, getCustomerName } from "./customers.js";
import { getCustomerGroups } from "./customerGroups.js";
import {
  populateEquipmentSelect,
  populateDeckHeightSelect,
  populateGroundSpeedSelect,
  populateBladeSpeedSelect,
  getEquipmentById,
} from "./equipment.js";
import { getLocationsForCustomer, populateLocationSelect, getLocationLabel } from "./locations.js";
import { getAreasForLocation, areaAppliesToEventTypes } from "./areas.js";
import { getYardFeatures } from "./yardFeatures.js";
import { loadVisits, PATTERN_LABELS, TIME_OF_DAY_LABELS } from "./mowLog.js";
import { loadSprays, getLastQuantityUsedForProduct } from "./sprayLog.js";
import { EVENT_TYPE_KEYS } from "./eventTypes.js";
import { populateProductSelect, getProductById, adjustProductQuantity } from "./products.js";
import { createCutEditor, cutFields } from "./cuts.js";
import {
  DEFAULT_YARDWORK_AREA_NAMES,
  patternSuggestion,
  suggestedTimeOfDay,
  grassDefault,
  mowerSettings,
  mowerSummary,
} from "./visitDefaults.js";

const CHECK_ICON = `<svg class="chip-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"></path></svg>`;

// Set once a pattern or mower is picked by hand, so changing who's checked
// stops replacing that choice with a fresh suggestion.
let patternTouched = false;
let mowerTouched = false;
// Cuts 2 and 3 of a double/triple cut (cut 1 is the pattern/mower/areas above).
let cutEditor = null;

// Customers are a multi-select - Location/Areas are shared across whichever
// customers are checked (driven by the first one checked), and submitting
// saves a copy of every record for each of them.
function checkedCustomerIds() {
  return Array.from(document.querySelectorAll("#event-customer-list .event-customer-checkbox:checked")).map(
    (cb) => cb.value
  );
}

function firstCheckedCustomerId() {
  return checkedCustomerIds()[0] || null;
}

// Renders fresh every time the form opens. preselectFirst is true for a
// normal open; "Save & log another" passes false so the next entry starts
// with nobody checked, forcing a deliberate pick of who's next.
function renderCustomerList(preselectFirst = true) {
  const customers = getCustomers();
  byId("event-customer-list").innerHTML = customers.length
    ? customers
        .map(
          (c, i) => `
      <label class="chip-toggle">
        <input type="checkbox" class="event-customer-checkbox" value="${escapeHtml(c.id)}" ${preselectFirst && i === 0 ? "checked" : ""} />
        <span>${CHECK_ICON}${escapeHtml(c.name)}</span>
      </label>`
        )
        .join("")
    : `<p class="hint-text">Add a customer first.</p>`;
}

function groupMembers(group) {
  const existing = new Set(getCustomers().map((c) => c.id));
  return (group.customerIds || []).filter((id) => existing.has(id));
}

// A group chip shows as selected while exactly its customers are checked.
function renderGroupChips() {
  const groups = getCustomerGroups();
  const container = byId("event-group-chips");
  container.classList.toggle("hidden", !groups.length);
  const checked = new Set(checkedCustomerIds());
  container.innerHTML = groups
    .map((g) => {
      const members = groupMembers(g);
      const active = members.length > 0 && members.length === checked.size && members.every((id) => checked.has(id));
      return `<button type="button" class="group-chip" data-group-id="${escapeHtml(g.id)}" aria-pressed="${active}">${escapeHtml(g.name)}</button>`;
    })
    .join("");
}

// Picking a group checks exactly that group's customers, replacing whatever
// was checked before - the neighbors-mowed-together shortcut.
function applyGroupSelection(groupId) {
  const group = getCustomerGroups().find((g) => g.id === groupId);
  if (!group) return;
  const members = new Set(groupMembers(group));
  document.querySelectorAll("#event-customer-list .event-customer-checkbox").forEach((cb) => {
    cb.checked = members.has(cb.value);
  });
  onCustomersChanged();
}

function onCustomersChanged() {
  renderGroupChips();
  refreshLocationOptions();
  refreshSuggestions();
  updateSaveLabel();
}

// "Maple Ct", "Dave Johnson" or "these customers" - whoever the pattern hint
// is talking about.
function selectionLabel(ids) {
  if (ids.length === 1) return getCustomerName(ids[0]);
  const set = new Set(ids);
  const group = getCustomerGroups().find((g) => {
    const members = groupMembers(g);
    return members.length === set.size && members.every((id) => set.has(id));
  });
  return group ? group.name : "these customers";
}

function activeTypes() {
  return EVENT_TYPE_KEYS.filter((t) => byId(`event-type-${t}`).checked);
}

function applyYardworkDefaults() {
  byId("event-mowed").checked = true;
  byId("event-trimmed").checked = true;
  byId("event-edged").checked = true;
}

function updateFieldVisibility() {
  const types = activeTypes();
  byId("event-yardwork-fields").classList.toggle("hidden", !types.includes("yardwork"));
  byId("event-extra-yardwork-fields").classList.toggle("hidden", !types.includes("extra_yardwork"));
  byId("event-chemical-fields").classList.toggle("hidden", !types.includes("chemical"));
  updateMowedFieldsVisibility();
}

// Pattern, mower and grass only apply when Mowed itself is checked - trimming
// or edging alone doesn't need them (and handleSubmit leaves them off).
function mowedActive() {
  return activeTypes().includes("yardwork") && byId("event-mowed").checked;
}

function updateMowedFieldsVisibility() {
  byId("event-mowed-fields").classList.toggle("hidden", !mowedActive());
}

function radioValue(name) {
  return document.querySelector(`#log-event-form input[name="${name}"]:checked`)?.value || null;
}

function setRadio(name, value) {
  document.querySelectorAll(`#log-event-form input[name="${name}"]`).forEach((r) => {
    r.checked = r.value === value;
  });
}

// Pre-picks the next pattern in the rotation and last visit's mower for
// whoever's checked, unless those were already chosen by hand.
function refreshSuggestions() {
  const ids = checkedCustomerIds();
  const { last, next } = patternSuggestion(ids);
  byId("event-pattern-last").textContent = last
    ? `Last time: ${PATTERN_LABELS[last.pattern] || last.pattern} (${formatDateDisplay(last.date)})`
    : "";
  byId("event-pattern-hint").textContent = next ? `${PATTERN_LABELS[next]} is next in the rotation for ${selectionLabel(ids)}.` : "";
  if (!patternTouched) setRadio("event-pattern", next || last?.pattern || "parallel");
  if (!mowerTouched) applyMowerSettings(mowerSettings(ids));
}

function applyMowerSettings({ equipmentId, deckHeight, groundSpeed, bladeSpeed }) {
  populateEquipmentSelect(byId("event-equipment"), { typeFilter: "mower" });
  byId("event-equipment").value = equipmentId || "";
  const id = byId("event-equipment").value;
  populateDeckHeightSelect(byId("event-height"), id, deckHeight ?? null);
  populateGroundSpeedSelect(byId("event-ground-speed"), id, groundSpeed ?? null);
  populateBladeSpeedSelect(byId("event-blade-speed"), id, bladeSpeed ?? null);
  updateMowerSummary();
  cutEditor?.refresh();
}

// Cut 1 of the mow, from the main pattern, mower-setting and area fields.
function firstCut() {
  return {
    pattern: radioValue("event-pattern"),
    deckHeight: byId("event-height").value ? Number(byId("event-height").value) : null,
    groundSpeed: byId("event-ground-speed").value || null,
    bladeSpeed: byId("event-blade-speed").value || null,
    areaIds: checkedAreaIds("yardwork"),
  };
}

// Once there's a second cut, the main fields read as "cut 1".
function updateCutLabels() {
  const multi = cutEditor?.count() > 0;
  byId("event-pattern-label").textContent = multi ? "Cut 1 pattern" : "Mow pattern";
  byId("event-mower-label").textContent = multi ? "Mower · cut 1 settings" : "Mower";
}

// Picking a different mower by hand starts from that mower's own defaults.
function applyEquipmentDefaults() {
  const equipmentId = byId("event-equipment").value;
  const eq = getEquipmentById(equipmentId);
  populateDeckHeightSelect(byId("event-height"), equipmentId, eq?.defaultDeckHeight ?? null);
  populateGroundSpeedSelect(byId("event-ground-speed"), equipmentId, eq?.defaultGroundSpeed ?? null);
  populateBladeSpeedSelect(byId("event-blade-speed"), equipmentId, eq?.defaultBladeSpeed ?? null);
}

function updateMowerSummary() {
  byId("event-mower-summary").textContent = mowerSummary({
    equipmentId: byId("event-equipment").value,
    deckHeight: byId("event-height").value,
    groundSpeed: byId("event-ground-speed").value,
    bladeSpeed: byId("event-blade-speed").value,
  });
}

function applyGrassConditionDefault() {
  setRadio("event-grass", grassDefault(byId("event-time-of-day").value));
}

function updateWhenSummary() {
  const date = byId("event-date").value;
  const [y, m, d] = date ? date.split("-").map(Number) : [];
  const weekday = date ? new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short" }) : "";
  const dayText = !date ? "No date" : date === todayStr() ? `Today, ${weekday} ${formatDateDisplay(date).slice(0, 5)}` : `${weekday} ${formatDateDisplay(date)}`;
  const parts = [dayText, TIME_OF_DAY_LABELS[byId("event-time-of-day").value], getLocationLabel(byId("event-location").value)];
  byId("event-when-summary").textContent = parts.filter(Boolean).join(" · ");
}

function updateSaveLabel() {
  const n = checkedCustomerIds().length;
  byId("save-log-btn").textContent = n > 1 ? `Save ${n} visits` : n === 1 ? "Save visit" : "Save";
}

function refreshLocationOptions() {
  const customerId = firstCheckedCustomerId();
  populateLocationSelect(byId("event-location"), customerId);
  const locations = customerId ? getLocationsForCustomer(customerId) : [];
  if (locations.length) byId("event-location").value = locations[0].id;
  refreshAreaOptions();
  updateWhenSummary();
}

// Each event type has its own Areas chips, scoped to the selected location
// and to areas set up (in Settings) to show under that type. Yard Work's
// default to Front Yard/Back Yard; the others keep whatever was checked.
function checkedAreaIds(type) {
  return Array.from(document.querySelectorAll(`#event-area-list-${type} .event-area-checkbox:checked`)).map((cb) => cb.value);
}

function refreshAreaOptionsForType(type) {
  const locationId = byId("event-location").value;
  const previouslyChecked = new Set(checkedAreaIds(type));
  const areas = getAreasForLocation(locationId).filter((a) => areaAppliesToEventTypes(a, [type]));
  const chipClass = type === "extra_yardwork" ? " chip-extra-toggle" : type === "chemical" ? " chip-spray-toggle" : "";
  byId(`event-area-list-${type}`).innerHTML = areas.length
    ? areas
        .map((a) => {
          const checked = type === "yardwork" ? DEFAULT_YARDWORK_AREA_NAMES.has(a.name) : previouslyChecked.has(a.id);
          return `<label class="chip-toggle${chipClass}"><input type="checkbox" class="event-area-checkbox" value="${escapeHtml(a.id)}" ${checked ? "checked" : ""} /><span>${escapeHtml(a.name)}</span></label>`;
        })
        .join("")
    : `<p class="hint-text">No areas set up for this at this location.</p>`;
}

function refreshAreaOptions() {
  for (const type of EVENT_TYPE_KEYS) refreshAreaOptionsForType(type);
  refreshFeatureOptions();
  cutEditor?.refresh();
}

// The Plant/Object dropdown is specific to Extra Yard Work, so it covers the
// features in whichever areas are checked there.
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
  if (current && [...select.options].some((o) => o.value === current)) select.value = current;
}

// Shows how much of the product is on hand, and prefills the quantity from
// the last time this product was used (any customer) - most products get
// reused at about the same dose.
function updateProductHint() {
  const product = getProductById(byId("event-spray-product").value);
  byId("event-spray-quantity-hint").textContent = product ? `${product.quantityOnHand} ${product.unit} on hand` : "";
  const lastQuantity = product ? getLastQuantityUsedForProduct(product.id) : null;
  byId("event-spray-quantity").value = lastQuantity != null ? lastQuantity : "";
}

function showNotes(show) {
  byId("event-notes-field").classList.toggle("hidden", !show);
  byId("event-add-note-btn").classList.toggle("hidden", show);
}

function openForm() {
  byId("log-event-form-card").classList.remove("hidden");
  patternTouched = false;
  mowerTouched = false;
  renderCustomerList();
  renderGroupChips();
  byId("event-date").value = todayStr();
  byId("event-time-of-day").value = suggestedTimeOfDay();
  byId("event-type-yardwork").checked = true;
  byId("event-type-extra_yardwork").checked = false;
  byId("event-type-chemical").checked = false;
  applyYardworkDefaults();
  cutEditor.clear();
  byId("event-pruned").checked = false;
  byId("event-trimmed-bushes").checked = false;
  byId("event-mulched").checked = false;
  setRadio("event-spray-target", "weeds");
  populateProductSelect(byId("event-spray-product"));
  populateEquipmentSelect(byId("event-spray-equipment"));
  byId("event-spray-equipment").value = "";
  updateProductHint();
  byId("event-notes").value = "";
  showNotes(false);
  setPanelOpen("event-when-panel", false);
  setPanelOpen("event-mower-panel", false);
  refreshLocationOptions();
  refreshSuggestions();
  applyGrassConditionDefault();
  updateFieldVisibility();
  updateSaveLabel();
}

// Opens Log Event already pointed at specific customers and a date - used by
// History's "Log visit" shortcut for a group neighbor who was skipped.
// plan (from Ready to Mow's "Log mow") also fills in what last time looked
// like - see quickLogPlan.
export function openLogEventFor({ customerIds = [], date = null, plan = null } = {}) {
  openForm();
  if (date) {
    byId("event-date").value = date;
    updateWhenSummary();
  }
  if (customerIds.length) {
    document.querySelectorAll("#event-customer-list .event-customer-checkbox").forEach((cb) => {
      cb.checked = customerIds.includes(cb.value);
    });
    onCustomersChanged();
  }
  if (plan) applyPlan(plan);
  byId("log-event-form-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

// On top of the usual pattern and mower suggestions: last time's trim/edge
// choices, location and areas, and its double/triple cut if there was one.
function applyPlan({ tasks, cuts, locationId, areaIds }) {
  if (tasks) {
    byId("event-mowed").checked = tasks.mowed;
    byId("event-trimmed").checked = tasks.trimmed;
    byId("event-edged").checked = tasks.edged;
  }
  if (locationId && [...byId("event-location").options].some((o) => o.value === locationId)) {
    byId("event-location").value = locationId;
    refreshAreaOptions();
    updateWhenSummary();
  }
  if (areaIds?.length) {
    document.querySelectorAll("#event-area-list-yardwork .event-area-checkbox").forEach((cb) => {
      cb.checked = areaIds.includes(cb.value);
    });
  }
  if (cuts?.length > 1) {
    const mowerId = byId("event-equipment").value;
    setRadio("event-pattern", cuts[0].pattern);
    populateDeckHeightSelect(byId("event-height"), mowerId, cuts[0].deckHeight ?? null);
    populateGroundSpeedSelect(byId("event-ground-speed"), mowerId, cuts[0].groundSpeed ?? null);
    populateBladeSpeedSelect(byId("event-blade-speed"), mowerId, cuts[0].bladeSpeed ?? null);
    updateMowerSummary();
    const cutAreas = checkedAreaIds("yardwork");
    cutEditor.set(cuts.slice(1).map((c) => ({ ...c, areaIds: cutAreas })));
  }
  updateMowedFieldsVisibility();
}

function closeForm() {
  byId("log-event-form-card").classList.add("hidden");
  byId("log-event-form").reset();
}

// "Save & log another" keeps the form open for a quick repeat: date, time,
// event types, tasks and settings carry over, but customers reset to force a
// deliberate pick of who's next, notes clear, and the pattern goes back to
// following the next customers' own rotation.
function resetForNextEntry() {
  patternTouched = false;
  renderCustomerList(false);
  renderGroupChips();
  byId("event-notes").value = "";
  showNotes(false);
  refreshLocationOptions();
  refreshSuggestions();
  updateSaveLabel();
}

// Each active event type is independent: its own areas and fields, saved as
// one record per checked customer carrying all of that type's checked
// areas. Yard Work and Extra Yard Work save separate records.
async function handleSubmit(e) {
  e.preventDefault();
  const logAnother = e.submitter?.id === "save-log-another-btn";
  const customerIds = checkedCustomerIds();
  if (!customerIds.length) {
    alert("Select at least one customer.");
    return;
  }
  const types = activeTypes();
  if (!types.length) {
    alert("Pick what you did: Yard Work, Extra or Spray.");
    return;
  }
  const date = byId("event-date").value;
  const timeOfDay = byId("event-time-of-day").value || null;
  const notes = byId("event-notes").value.trim();
  const locationId = byId("event-location").value || null;

  let yardworkFields = null;
  if (types.includes("yardwork")) {
    const mowed = byId("event-mowed").checked;
    // A mow saves its cuts (see cuts.js); trim/edge alone has none of that.
    const cutData = mowed
      ? cutFields([firstCut(), ...cutEditor.get()])
      : { pattern: null, deckHeight: null, groundSpeed: null, bladeSpeed: null, areaIds: checkedAreaIds("yardwork"), cuts: null };
    yardworkFields = {
      mowed,
      trimmed: byId("event-trimmed").checked,
      edged: byId("event-edged").checked,
      ...cutData,
      grassCondition: mowed ? radioValue("event-grass") : null,
      equipmentId: (mowed && byId("event-equipment").value) || null,
    };
    if (!yardworkFields.mowed && !yardworkFields.trimmed && !yardworkFields.edged) {
      alert("Select at least one yard work task.");
      return;
    }
  }

  let extraFields = null;
  if (types.includes("extra_yardwork")) {
    extraFields = {
      pruned: byId("event-pruned").checked,
      trimmedBushes: byId("event-trimmed-bushes").checked,
      mulched: byId("event-mulched").checked,
    };
    if (!extraFields.pruned && !extraFields.trimmedBushes && !extraFields.mulched) {
      alert("Select at least one extra yard work task.");
      return;
    }
  }

  let productId = null;
  let quantityUsed = 0;
  if (types.includes("chemical")) {
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

  const eventBase = { date, timeOfDay, locationId, notes };

  if (yardworkFields) {
    for (const customerId of customerIds) {
      await createDoc("mowVisits", {
        customerId,
        ...eventBase,
        ...yardworkFields,
        pruned: false,
        trimmedBushes: false,
        mulched: false,
        featureId: null,
      });
    }
  }

  if (extraFields) {
    const areaIds = checkedAreaIds("extra_yardwork");
    const featureId = byId("event-feature").value || null;
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
        equipmentId: null,
        ...extraFields,
        areaIds,
        featureId,
      });
    }
  }

  if (productId) {
    const areaIds = checkedAreaIds("chemical");
    for (const customerId of customerIds) {
      await createDoc("sprayApplications", {
        customerId,
        date,
        timeOfDay,
        target: radioValue("event-spray-target") || "weeds",
        productId,
        quantityUsed,
        locationId,
        areaIds,
        featureId: null,
        equipmentId: byId("event-spray-equipment").value || null,
        notes,
      });
    }
    // Each checked customer is its own real application, and quantityUsed
    // is that customer's whole job across all its areas.
    await adjustProductQuantity(productId, -(quantityUsed * customerIds.length));
  }

  if (yardworkFields || extraFields) await loadVisits();
  if (productId) await loadSprays();

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
  byId("event-group-chips").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-group-id]");
    if (btn) applyGroupSelection(btn.dataset.groupId);
  });
  byId("event-customer-list").addEventListener("change", onCustomersChanged);
  byId("log-event-form").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-toggle-panel]");
    if (btn) setPanelOpen(btn.dataset.togglePanel, byId(btn.dataset.togglePanel).classList.contains("hidden"));
  });
  for (const type of EVENT_TYPE_KEYS) {
    byId(`event-type-${type}`).addEventListener("change", (e) => {
      if (type === "yardwork" && e.target.checked) applyYardworkDefaults();
      updateFieldVisibility();
    });
  }
  byId("event-mowed").addEventListener("change", updateMowedFieldsVisibility);
  cutEditor = createCutEditor({
    container: byId("event-extra-cuts"),
    addButton: byId("event-add-cut-btn"),
    namePrefix: "event-cut",
    getMowerId: () => byId("event-equipment").value,
    getAreas: () => getAreasForLocation(byId("event-location").value).filter((a) => areaAppliesToEventTypes(a, ["yardwork"])),
    getFirstCut: firstCut,
    onChange: updateCutLabels,
  });
  document.querySelectorAll('#log-event-form input[name="event-pattern"]').forEach((r) =>
    r.addEventListener("change", () => {
      patternTouched = true;
    })
  );
  byId("event-equipment").addEventListener("change", () => {
    mowerTouched = true;
    applyEquipmentDefaults();
    updateMowerSummary();
    cutEditor.refresh();
  });
  for (const id of ["event-height", "event-ground-speed", "event-blade-speed"]) {
    byId(id).addEventListener("change", () => {
      mowerTouched = true;
      updateMowerSummary();
    });
  }
  byId("event-date").addEventListener("change", updateWhenSummary);
  byId("event-time-of-day").addEventListener("change", () => {
    applyGrassConditionDefault();
    updateWhenSummary();
  });
  byId("event-location").addEventListener("change", () => {
    refreshAreaOptions();
    updateWhenSummary();
  });
  byId("event-area-list-extra_yardwork").addEventListener("change", refreshFeatureOptions);
  byId("event-spray-product").addEventListener("change", updateProductHint);
  byId("event-add-note-btn").addEventListener("click", () => {
    showNotes(true);
    byId("event-notes").focus();
  });
  byId("log-event-form").addEventListener("submit", handleSubmit);
}
