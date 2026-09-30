import { createDoc, batchWrite } from "./db.js";
import { byId, escapeHtml, todayStr, formatDateDisplay, confirmAction, setPanelOpen } from "./utils.js";
import { getCustomers, getCustomerName } from "./customers.js";
import { getCustomerGroupById } from "./customerGroups.js";
import {
  populateEquipmentSelect,
  populateDeckHeightSelect,
  populateGroundSpeedSelect,
  populateBladeSpeedSelect,
  getEquipmentById,
} from "./equipment.js";
import { getLocations } from "./locations.js";
import { getAreasForLocation, areaAppliesToEventTypes, getAreaName } from "./areas.js";
import { loadVisits, PATTERN_LABELS, TIME_OF_DAY_LABELS } from "./mowLog.js";
import {
  repeatVisitFor,
  patternSuggestion,
  mowerSettings,
  mowerSummary,
  suggestedTimeOfDay,
  grassDefault,
} from "./visitDefaults.js";
import { undoVisits } from "./quickLog.js";
import { loadSprays, getLastQuantityUsedForProduct, TARGET_LABELS } from "./sprayLog.js";
import { populateProductSelect, getProductById, adjustProductQuantity } from "./products.js";
import { createCutEditor, cutFields, cutLabel, passCount } from "./cuts.js";
import { showToast } from "./toast.js";
import { showHistory } from "./history.js";

// A run sheet for one Customer Group (a street): pattern, mower and grass
// are set once for everyone, then each house is ticked done (or skipped) as
// it's finished, and every done house is saved in one go at the end. "+
// Extra" on a house adds extra yard work and spraying there. Yard work,
// extra work and spraying each have their own areas, as in Log Event, so a
// spray on the front yard isn't recorded as covering the whole lawn.

const YARD_TASK_LABELS = { mowed: "Mowed", trimmed: "Trimmed", edged: "Edged" };
const EXTRA_TASK_LABELS = { pruned: "Pruned", trimmedBushes: "Trimmed Bushes", mulched: "Mulched" };
const CHECK_SVG = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"></path></svg>`;

const state = {
  groupName: "",
  houses: [],
  dirty: false,
};
let listenersBound = false;
// The 2nd and later cuts, shared by every house (see houseCuts).
let cutEditor = null;

// Houses each have their own area records, so run sheet cuts pick areas by
// name ("Front Yard") and each house's matching areas are used when saving.
function areaNameOptions() {
  const names = new Set();
  for (const h of state.houses) {
    for (const a of areasFor(h.locationId, "yard")) names.add(a.name);
  }
  return [...names].sort().map((name) => ({ id: name, name }));
}

// Cut 1's areas only matter once there's a second cut - until then, every
// house's own areas get the one cut.
function cut1AreaNames() {
  if (byId("run-cut1-areas-block").classList.contains("hidden")) return areaNameOptions().map((a) => a.id);
  return [...byId("run-cut1-areas").querySelectorAll("input:checked")].map((cb) => cb.value);
}

function renderCut1Areas(checkedNames) {
  byId("run-cut1-areas").innerHTML = areaNameOptions()
    .map(
      (a) =>
        `<label class="chip-toggle"><input type="checkbox" value="${escapeHtml(a.id)}" ${checkedNames.includes(a.id) ? "checked" : ""} /><span>${escapeHtml(a.name)}</span></label>`
    )
    .join("");
}

function cuts() {
  if (!cutEditor) {
    cutEditor = createCutEditor({
      container: byId("run-extra-cuts"),
      addButton: byId("run-add-cut-btn"),
      namePrefix: "run-cut",
      getAreas: areaNameOptions,
      getFirstCut: () => ({ pattern: radioValue("run-pattern"), ...currentMower(), areaIds: cut1AreaNames() }),
      onChange: () => {
        const multi = cutEditor.count() > 0;
        const block = byId("run-cut1-areas-block");
        if (multi && block.classList.contains("hidden")) renderCut1Areas(areaNameOptions().map((a) => a.id));
        block.classList.toggle("hidden", !multi);
        byId("run-pattern-label").textContent = multi ? "Cut 1 pattern" : "Mow pattern";
        byId("run-mower-label").textContent = multi ? "Cut 1 mower" : "Mower";
      },
    });
  }
  return cutEditor;
}

// One house's cuts: each run cut applied to the house's areas with that
// cut's names (a cut with no areas picked covers all of them). Cuts that
// match none of the house's areas are left out; if none match at all, the
// house gets cut 1 over all of its areas.
function houseCuts(h, runCuts) {
  const matched = runCuts
    .map((c) => ({ ...c, areaIds: c.areaIds.length ? h.areaIds.filter((id) => c.areaIds.includes(getAreaName(id))) : h.areaIds }))
    .filter((c) => c.areaIds.length);
  return matched.length ? matched : [{ ...runCuts[0], areaIds: h.areaIds }];
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function radioValue(name) {
  return document.querySelector(`#view-run input[name="${name}"]:checked`)?.value || null;
}

function setRadio(name, value) {
  document.querySelectorAll(`#view-run input[name="${name}"]`).forEach((r) => {
    r.checked = r.value === value;
  });
}

// The street address's first line if the location has one, else its label.
function placeText(locationId) {
  const loc = getLocations().find((l) => l.id === locationId);
  if (!loc) return "";
  return loc.address ? loc.address.split(",")[0].trim() : loc.label || "";
}

function applyMower({ equipmentId, deckHeight, groundSpeed, bladeSpeed }) {
  populateEquipmentSelect(byId("run-equipment"), { typeFilter: "mower" });
  byId("run-equipment").value = equipmentId || "";
  const id = byId("run-equipment").value;
  populateDeckHeightSelect(byId("run-height"), id, deckHeight ?? null);
  populateGroundSpeedSelect(byId("run-ground-speed"), id, groundSpeed ?? null);
  populateBladeSpeedSelect(byId("run-blade-speed"), id, bladeSpeed ?? null);
  updateMowerSummary();
  cutEditor?.refresh();
}

function currentMower() {
  return {
    equipmentId: byId("run-equipment").value || null,
    deckHeight: byId("run-height").value ? Number(byId("run-height").value) : null,
    groundSpeed: byId("run-ground-speed").value || null,
    bladeSpeed: byId("run-blade-speed").value || null,
  };
}

function updateMowerSummary() {
  byId("run-mower-summary").textContent = mowerSummary(currentMower());
}

function updateWhenSummary() {
  const date = byId("run-date").value;
  const dayText = !date ? "No date" : date === todayStr() ? "Today" : formatDateDisplay(date);
  byId("run-when-summary").textContent = [dayText, TIME_OF_DAY_LABELS[byId("run-time-of-day").value]].filter(Boolean).join(" · ");
}

export function startRun(groupId) {
  const group = getCustomerGroupById(groupId);
  if (!group) return;
  const existing = new Set(getCustomers().map((c) => c.id));
  const members = (group.customerIds || []).filter((id) => existing.has(id));
  if (!members.length) {
    alert("This group has no customers yet.");
    return;
  }
  state.groupName = group.name;
  state.dirty = false;
  state.houses = members.map((customerId) => {
    const repeat = repeatVisitFor(customerId);
    return {
      customerId,
      status: "pending",
      tasks: { ...repeat.tasks },
      extra: { pruned: false, trimmedBushes: false, mulched: false },
      showExtra: false,
      sprayed: false,
      spray: { ...NO_SPRAY },
      locationId: repeat.locationId,
      // Yard work areas; extra work and spraying start with none picked.
      areaIds: areaIdsFor(repeat.locationId, "yard").filter((a) => repeat.areaIds.includes(a)),
      extraAreaIds: [],
      sprayAreaIds: [],
    };
  });

  byId("run-date").value = todayStr();
  byId("run-time-of-day").value = suggestedTimeOfDay();
  const { last, next } = patternSuggestion(members);
  setRadio("run-pattern", next || last?.pattern || "parallel");
  byId("run-pattern-last").textContent = last
    ? `Last time: ${PATTERN_LABELS[last.pattern] || last.pattern} (${formatDateDisplay(last.date)})`
    : "";
  byId("run-pattern-hint").textContent = next ? `${PATTERN_LABELS[next]} is next in the rotation for ${group.name}.` : "";
  applyMower(mowerSettings(members));
  cuts().clear();
  setRadio("run-grass", grassDefault(byId("run-time-of-day").value));
  setPanelOpen("run-when-panel", false);
  setPanelOpen("run-mower-panel", false);
  document.dispatchEvent(new CustomEvent("app:navigate", { detail: { view: "run" } }));
}

const NO_SPRAY = { target: "weeds", productId: "", quantity: "", equipmentId: "" };

// Each kind of work picks from the areas set up (in Settings) for it.
const AREA_KINDS = {
  yard: { eventType: "yardwork", label: "Yard work areas", chipClass: "chip-toggle", key: "areaIds" },
  extra: { eventType: "extra_yardwork", label: "Extra work areas", chipClass: "chip-toggle chip-extra-toggle", key: "extraAreaIds" },
  spray: { eventType: "chemical", label: "Areas sprayed", chipClass: "chip-toggle chip-spray-toggle", key: "sprayAreaIds" },
};

function areasFor(locationId, kind) {
  return getAreasForLocation(locationId).filter((a) => areaAppliesToEventTypes(a, [AREA_KINDS[kind].eventType]));
}

function areaIdsFor(locationId, kind) {
  return areasFor(locationId, kind).map((a) => a.id);
}

function areaChipsHtml(h, kind) {
  const { label, chipClass, key } = AREA_KINDS[kind];
  const id = escapeHtml(h.customerId);
  const chips = areasFor(h.locationId, kind)
    .map(
      (a) =>
        `<label class="${chipClass}"><input type="checkbox" data-run-area="${id}" data-kind="${kind}" value="${escapeHtml(a.id)}" ${h[key].includes(a.id) ? "checked" : ""} /><span>${escapeHtml(a.name)}</span></label>`
    )
    .join("");
  return `
      <div class="run-areas" role="group" aria-label="${escapeHtml(label)}">
        <span class="field-label">${escapeHtml(label)}</span>
        <div class="chip-group">${chips || `<p class="hint-text">No areas set up for this at this location.</p>`}</div>
      </div>`;
}

// A house's spray starts as a copy of one already set up on this run -
// neighbors usually get the same product, on the same parts of the lawn
// (matched by name) - so often only the amount differs.
function sprayDefaults(h) {
  const other = state.houses.find((x) => x !== h && x.sprayed && x.spray.productId);
  if (!other) return { spray: { ...NO_SPRAY }, areaIds: [] };
  const names = new Set(other.sprayAreaIds.map(getAreaName));
  return { spray: { ...other.spray }, areaIds: areasFor(h.locationId, "spray").filter((a) => names.has(a.name)).map((a) => a.id) };
}

function sprayPanelHtml(h) {
  const id = escapeHtml(h.customerId);
  const product = getProductById(h.spray.productId);
  const targets = Object.entries(TARGET_LABELS)
    .map(
      ([value, label]) =>
        `<label class="chip-toggle chip-spray-toggle"><input type="radio" name="run-spray-target-${id}" data-run-spray="${id}" data-field="target" value="${value}" ${h.spray.target === value ? "checked" : ""} /><span>${label}</span></label>`
    )
    .join("");
  return `
      <div class="run-spray">
        ${areaChipsHtml(h, "spray")}
        <div class="chip-group" role="radiogroup" aria-label="Sprayed for">${targets}</div>
        <div class="run-spray-fields">
          <label class="run-spray-product">Product <select data-run-spray="${id}" data-field="productId"></select></label>
          <label>Quantity${product ? ` (${escapeHtml(product.unit)})` : ""} <input type="number" step="any" min="0" inputmode="decimal" placeholder="e.g. 16" data-run-spray="${id}" data-field="quantity" value="${escapeHtml(String(h.spray.quantity))}" /></label>
          <label>Sprayer <select data-run-spray="${id}" data-field="equipmentId"></select></label>
        </div>
      </div>`;
}

// The spray panels' selects, filled after each render.
function fillSprayFields() {
  for (const h of state.houses.filter((x) => x.sprayed)) {
    const field = (f) => document.querySelector(`#run-houses [data-run-spray="${CSS.escape(h.customerId)}"][data-field="${f}"]`);
    if (!field("productId")) continue;
    populateProductSelect(field("productId"));
    field("productId").value = h.spray.productId;
    populateEquipmentSelect(field("equipmentId"));
    field("equipmentId").value = h.spray.equipmentId;
  }
}

function taskChip(customerId, field, label, checked, kind) {
  const cls = kind === "extra" ? "chip-toggle chip-extra-toggle" : "chip-toggle";
  return `<label class="${cls}"><input type="checkbox" data-run-${kind}="${escapeHtml(customerId)}" data-field="${field}" ${checked ? "checked" : ""} /><span>${label}</span></label>`;
}

function renderHouse(h) {
  const id = escapeHtml(h.customerId);
  const name = escapeHtml(getCustomerName(h.customerId) || "Unknown customer");
  const place = escapeHtml(placeText(h.locationId));
  if (h.status === "skipped") {
    return `
      <article class="run-house skipped">
        <div class="run-house-head">
          <div class="run-house-text"><h3>${name}</h3><span class="hint-text">${place ? `${place} · ` : ""}Skipped today</span></div>
          <button type="button" class="ghost-btn" data-run-action="unskip" data-customer="${id}">Undo skip</button>
        </div>
      </article>`;
  }
  const done = h.status === "done";
  const anyExtra = Object.values(h.extra).some(Boolean);
  const showExtra = h.showExtra || anyExtra || h.sprayed;
  const yardChips = Object.entries(YARD_TASK_LABELS)
    .map(([f, l]) => taskChip(h.customerId, f, l, h.tasks[f], "task"))
    .join("");
  const extraChips = Object.entries(EXTRA_TASK_LABELS)
    .map(([f, l]) => taskChip(h.customerId, f, l, h.extra[f], "extra"))
    .join("");
  const sprayChip = `<label class="chip-toggle chip-spray-toggle"><input type="checkbox" data-run-sprayed="${id}" ${h.sprayed ? "checked" : ""} /><span>Sprayed</span></label>`;
  return `
    <article class="run-house${done ? " done" : ""}">
      <div class="run-house-head">
        <div class="run-house-text"><h3>${name}</h3>${place ? `<span class="hint-text">${place}</span>` : ""}</div>
        <button type="button" class="run-done-btn" data-run-action="done" data-customer="${id}" aria-pressed="${done}" aria-label="${done ? "Done" : "Mark done"}: ${name}">${CHECK_SVG}</button>
      </div>
      <div class="chip-group">
        ${yardChips}
        ${showExtra ? "" : `<button type="button" class="add-chip-btn" data-run-action="extra" data-customer="${id}">+ Extra</button>`}
      </div>
      ${areaChipsHtml(h, "yard")}
      ${
        showExtra
          ? `<div class="run-extra">
        <div class="chip-group">${extraChips}${sprayChip}</div>
        ${anyExtra ? areaChipsHtml(h, "extra") : ""}
        ${h.sprayed ? sprayPanelHtml(h) : ""}
      </div>`
          : ""
      }
      <div class="run-house-actions">
        <button type="button" class="link-btn" data-run-action="skip" data-customer="${id}">Skip today</button>
      </div>
    </article>`;
}

function updateFooter() {
  const done = state.houses.filter((h) => h.status === "done").length;
  const skipped = state.houses.filter((h) => h.status === "skipped").length;
  const left = state.houses.length - done - skipped;
  byId("run-counts").innerHTML = `<strong>${done} done</strong> · ${skipped} skipped · ${left} left`;
  const btn = byId("run-save-btn");
  btn.disabled = done === 0;
  btn.textContent = done ? `Save ${plural(done, "visit")}` : "Save";
}

function render() {
  byId("run-title").textContent = `${state.groupName} run`;
  updateWhenSummary();
  byId("run-houses").innerHTML = state.houses.map(renderHouse).join("");
  fillSprayFields();
  updateFooter();
}

function house(customerId) {
  return state.houses.find((h) => h.customerId === customerId);
}

function handleHouseClick(e) {
  const btn = e.target.closest("[data-run-action]");
  if (!btn) return;
  const h = house(btn.dataset.customer);
  if (!h) return;
  const action = btn.dataset.runAction;
  if (action === "done") h.status = h.status === "done" ? "pending" : "done";
  else if (action === "skip") h.status = "skipped";
  else if (action === "unskip") h.status = "pending";
  else if (action === "extra") h.showExtra = true;
  state.dirty = true;
  render();
  // Re-rendering replaced the button; keep focus where it was (a skipped
  // house's only button is Undo skip, and an unskipped one's is its check).
  const focusAction = action === "skip" ? "unskip" : action === "unskip" ? "done" : action;
  document.querySelector(`#run-houses [data-run-action="${focusAction}"][data-customer="${CSS.escape(h.customerId)}"]`)?.focus();
}

function handleHouseChange(e) {
  const input = e.target;
  const d = input.dataset;
  const h = house(d.runTask || d.runExtra || d.runArea || d.runSprayed || d.runSpray);
  if (!h) return;
  state.dirty = true;
  if (d.runTask) h.tasks[d.field] = input.checked;
  else if (d.runExtra) {
    // The extra work areas show once there's extra work to place.
    h.extra[d.field] = input.checked;
    render();
    document.querySelector(`#run-houses [data-run-extra="${CSS.escape(h.customerId)}"][data-field="${d.field}"]`)?.focus();
  } else if (d.runSprayed) {
    h.sprayed = input.checked;
    if (h.sprayed && !h.spray.productId) {
      const defaults = sprayDefaults(h);
      h.spray = defaults.spray;
      h.sprayAreaIds = defaults.areaIds;
    }
    render();
    document.querySelector(`#run-houses [data-run-sprayed="${CSS.escape(h.customerId)}"]`)?.focus();
  } else if (d.runSpray) {
    h.spray[d.field] = input.value;
    // A different product starts from the amount last used of it.
    if (d.field === "productId") {
      h.spray.quantity = getLastQuantityUsedForProduct(input.value) ?? "";
      render();
      document.querySelector(`#run-houses [data-run-spray="${CSS.escape(h.customerId)}"][data-field="productId"]`)?.focus();
    }
  } else if (d.runArea) {
    const key = AREA_KINDS[d.kind].key;
    h[key] = input.checked ? [...h[key], input.value] : h[key].filter((a) => a !== input.value);
  }
}

async function saveRun() {
  const done = state.houses.filter((h) => h.status === "done");
  if (!done.length) return;
  const empty = done.find((h) => !Object.values(h.tasks).some(Boolean) && !Object.values(h.extra).some(Boolean) && !h.sprayed);
  if (empty) {
    alert(`Pick at least one task for ${getCustomerName(empty.customerId)}.`);
    return;
  }
  for (const h of done.filter((x) => x.sprayed)) {
    if (!h.spray.productId) {
      alert(`Pick the product sprayed at ${getCustomerName(h.customerId)}.`);
      return;
    }
    if (!(Number(h.spray.quantity) > 0)) {
      alert(`Enter how much was sprayed at ${getCustomerName(h.customerId)}.`);
      return;
    }
  }
  const date = byId("run-date").value || todayStr();
  const timeOfDay = byId("run-time-of-day").value || null;
  const pattern = radioValue("run-pattern");
  const grass = radioValue("run-grass");
  const mower = currentMower();
  const extraCuts = cuts().get();
  const runCuts = [{ pattern, ...mower, areaIds: cut1AreaNames() }, ...extraCuts];
  const btn = byId("run-save-btn");
  btn.disabled = true;
  btn.textContent = "Saving…";

  const ids = [];
  const sprayIds = [];
  // Product taken out of inventory, by product, for Undo to put back.
  const used = new Map();
  try {
    for (const h of done) {
      const base = { customerId: h.customerId, date, timeOfDay, locationId: h.locationId, notes: "", featureId: null };
      const { mowed, trimmed, edged } = h.tasks;
      if (mowed || trimmed || edged) {
        const cutData = mowed
          ? cutFields(extraCuts.length ? houseCuts(h, runCuts) : [{ pattern, ...mower, areaIds: h.areaIds }])
          : { pattern: null, equipmentId: null, deckHeight: null, groundSpeed: null, bladeSpeed: null, areaIds: h.areaIds, cuts: null };
        ids.push(
          await createDoc("mowVisits", {
            ...base,
            mowed,
            trimmed,
            edged,
            ...cutData,
            grassCondition: mowed ? grass : null,
            pruned: false,
            trimmedBushes: false,
            mulched: false,
          })
        );
      }
      if (Object.values(h.extra).some(Boolean)) {
        ids.push(
          await createDoc("mowVisits", {
            ...base,
            mowed: false,
            trimmed: false,
            edged: false,
            pattern: null,
            deckHeight: null,
            groundSpeed: null,
            bladeSpeed: null,
            grassCondition: null,
            equipmentId: null,
            ...h.extra,
            areaIds: h.extraAreaIds,
          })
        );
      }
      if (h.sprayed) {
        const quantityUsed = Number(h.spray.quantity);
        sprayIds.push(
          await createDoc("sprayApplications", {
            customerId: h.customerId,
            date,
            timeOfDay,
            target: h.spray.target || "weeds",
            productId: h.spray.productId,
            quantityUsed,
            locationId: h.locationId,
            areaIds: h.sprayAreaIds,
            featureId: null,
            equipmentId: h.spray.equipmentId || null,
            notes: "",
          })
        );
        const before = getProductById(h.spray.productId)?.quantityOnHand ?? 0;
        await adjustProductQuantity(h.spray.productId, -quantityUsed);
        const taken = before - (getProductById(h.spray.productId)?.quantityOnHand ?? 0);
        used.set(h.spray.productId, (used.get(h.spray.productId) || 0) + taken);
      }
    }
  } catch (err) {
    console.error("Failed to save run sheet", err);
    await Promise.all([loadVisits(), loadSprays()]);
    updateFooter();
    alert(`Saving stopped partway: ${plural(ids.length + sprayIds.length, "record")} saved. Check History, then try again for the rest.`);
    return;
  }

  await loadVisits();
  if (sprayIds.length) await loadSprays();
  state.dirty = false;
  const anyMowed = done.some((h) => h.tasks.mowed);
  const mowDetail = !anyMowed
    ? ""
    : extraCuts.length
    ? `${passCount(runCuts) > 1 ? cutLabel(passCount(runCuts)) : "Areas mowed separately"} · ${runCuts.map((c) => PATTERN_LABELS[c.pattern] || c.pattern).join(" then ")}`
    : `${PATTERN_LABELS[pattern] || pattern} · ${mowerSummary(mower)}`;
  document.dispatchEvent(new CustomEvent("event:logged"));
  document.dispatchEvent(new CustomEvent("app:navigate", { detail: { view: "dashboard" } }));
  showToast({
    message: `Saved ${plural(done.length, "visit")} for ${state.groupName}`,
    detail: [mowDetail, sprayIds.length ? `Sprayed at ${plural(sprayIds.length, "house")}` : ""].filter(Boolean).join(" · "),
    actions: [
      {
        label: "Undo",
        onClick: async () => {
          await undoRun(ids, sprayIds, used);
          document.dispatchEvent(new CustomEvent("event:logged"));
          showToast({ message: `Removed the ${plural(done.length, "visit")} from this run.` });
        },
      },
      { label: "View", onClick: () => showHistory("days") },
    ],
  });
}

// The save toast's Undo: removes what the run saved and puts the product it
// used back on the shelf.
async function undoRun(visitIds, sprayIds, used) {
  if (visitIds.length) await undoVisits(visitIds);
  if (!sprayIds.length) return;
  await batchWrite([sprayIds.map((id) => ({ type: "delete", collection: "sprayApplications", id }))]);
  for (const [productId, quantity] of used) await adjustProductQuantity(productId, quantity);
  await loadSprays();
}

async function exitRun() {
  if (state.dirty && !(await confirmAction("Leave this run without saving? Houses marked done won't be saved.", { confirmLabel: "Leave" }))) {
    return;
  }
  document.dispatchEvent(new CustomEvent("app:navigate", { detail: { view: "dashboard" } }));
}

export function refreshRunSheetView() {
  if (!state.houses.length) {
    document.dispatchEvent(new CustomEvent("app:navigate", { detail: { view: "dashboard" } }));
    return;
  }
  render();
}

export function initRunSheetView() {
  if (!listenersBound) {
    byId("run-exit-btn").addEventListener("click", exitRun);
    byId("run-save-btn").addEventListener("click", saveRun);
    byId("run-houses").addEventListener("click", handleHouseClick);
    byId("run-houses").addEventListener("change", handleHouseChange);
    byId("view-run").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-toggle-panel]");
      if (btn) setPanelOpen(btn.dataset.togglePanel, byId(btn.dataset.togglePanel).classList.contains("hidden"));
    });
    byId("run-equipment").addEventListener("change", () => {
      const eq = getEquipmentById(byId("run-equipment").value);
      applyMower({
        equipmentId: byId("run-equipment").value,
        deckHeight: eq?.defaultDeckHeight ?? null,
        groundSpeed: eq?.defaultGroundSpeed ?? null,
        bladeSpeed: eq?.defaultBladeSpeed ?? null,
      });
    });
    for (const id of ["run-height", "run-ground-speed", "run-blade-speed"]) byId(id).addEventListener("change", updateMowerSummary);
    byId("run-cut1-areas").addEventListener("change", () => cuts().relabel());
    byId("run-date").addEventListener("change", updateWhenSummary);
    byId("run-time-of-day").addEventListener("change", () => {
      setRadio("run-grass", grassDefault(byId("run-time-of-day").value));
      updateWhenSummary();
    });
    listenersBound = true;
  }
  refreshRunSheetView();
}
