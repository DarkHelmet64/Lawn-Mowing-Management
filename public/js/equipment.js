import { listAll, createDoc, updateDocById, deleteDocById } from "./db.js";
import { byId, escapeHtml, confirmAction } from "./utils.js";

const COLLECTION = "equipment";
let cache = [];
let listenersBound = false;

export const EQUIPMENT_TYPE_LABELS = {
  mower: "Mower",
  trimmer: "Trimmer",
  edger: "Edger",
  blower: "Blower",
  sprayer: "Sprayer",
  blades: "Blades",
  battery: "Battery",
  other: "Other",
};

export async function loadEquipment() {
  cache = await listAll(COLLECTION, { orderByField: "name", direction: "asc" });
  return cache;
}

export function getEquipment() {
  return cache;
}

export function getEquipmentById(id) {
  return cache.find((e) => e.id === id) || null;
}

export function getEquipmentName(id) {
  return getEquipmentById(id)?.name || null;
}

// "Toro TimeMaster · 3" · speed 2 · High" - a mower and its settings in one line.
export function mowerSummary({ equipmentId, deckHeight, groundSpeed, bladeSpeed }) {
  const name = getEquipmentName(equipmentId);
  if (!name) return "No mower selected";
  return [name, deckHeight != null && deckHeight !== "" ? `${deckHeight}"` : "", groundSpeed ? `speed ${groundSpeed}` : "", bladeSpeed || ""]
    .filter(Boolean)
    .join(" · ");
}

// Deck heights are numeric, so they're comparable/sortable regardless of
// input order. Ground/blade speed settings are often named ("Slow, Fast")
// rather than numeric, so those keep whatever order they were entered in.
function parseNumberList(raw) {
  const values = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => !Number.isNaN(n));
  return [...new Set(values)].sort((a, b) => a - b);
}

function parseTextList(raw) {
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

// Keeps a mower's "Default X" select in sync with whatever's currently
// typed into its comma-separated settings field, preserving the chosen
// default if it's still one of the values.
function populateDefaultOptionsSelect(selectEl, values, currentValue = null) {
  const current = currentValue != null ? String(currentValue) : selectEl.value;
  selectEl.innerHTML = '<option value="">None</option>';
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = String(v);
    opt.textContent = String(v);
    selectEl.appendChild(opt);
  }
  if (current && [...selectEl.options].some((o) => o.value === current)) {
    selectEl.value = current;
  }
}

export function populateEquipmentSelect(selectEl, { includeNone = true, typeFilter = null } = {}) {
  const current = selectEl.value;
  selectEl.innerHTML = "";
  if (includeNone) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "None / Not specified";
    selectEl.appendChild(opt);
  }
  for (const e of cache.filter((e) => e.active !== false && (!typeFilter || e.type === typeFilter))) {
    const opt = document.createElement("option");
    opt.value = e.id;
    opt.textContent = `${e.name} (${EQUIPMENT_TYPE_LABELS[e.type] || e.type})`;
    selectEl.appendChild(opt);
  }
  if (current) selectEl.value = current;
}

// Shared logic for populating a mower-setting <select> (deck height, ground
// speed, blade speed) from the chosen equipment's configured options for
// `field`. currentValue (if given) is preserved as an option even if it's
// not one of the mower's current settings, so editing an older record
// doesn't silently lose what was actually recorded. `format` renders each
// option's display text (e.g. adding an inch mark for deck height).
function populateMowerSettingSelect(selectEl, equipmentId, field, currentValue, { format = (v) => String(v), noneConfiguredText = "No settings configured" } = {}) {
  const eq = getEquipmentById(equipmentId);
  const isMower = eq?.type === "mower";
  const configured = isMower ? eq[field] || [] : [];
  const options = [...configured];
  if (currentValue != null && currentValue !== "" && !options.includes(currentValue)) {
    options.push(currentValue);
  }

  selectEl.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = !eq ? "Select equipment first" : !isMower ? "Not applicable" : options.length ? "Select" : noneConfiguredText;
  selectEl.appendChild(blank);
  for (const value of options) {
    const opt = document.createElement("option");
    opt.value = String(value);
    opt.textContent = format(value);
    selectEl.appendChild(opt);
  }
  selectEl.value = currentValue != null ? String(currentValue) : "";
  selectEl.disabled = !isMower;
}

export function populateDeckHeightSelect(selectEl, equipmentId, currentValue = null) {
  populateMowerSettingSelect(selectEl, equipmentId, "deckHeights", currentValue, {
    format: (h) => `${h}"`,
    noneConfiguredText: "No heights configured",
  });
}

export function populateGroundSpeedSelect(selectEl, equipmentId, currentValue = null) {
  populateMowerSettingSelect(selectEl, equipmentId, "groundSpeeds", currentValue, {
    noneConfiguredText: "No ground speeds configured",
  });
}

export function populateBladeSpeedSelect(selectEl, equipmentId, currentValue = null) {
  populateMowerSettingSelect(selectEl, equipmentId, "bladeSpeeds", currentValue, {
    noneConfiguredText: "No blade speeds configured",
  });
}

function populateTypeFilterOptions() {
  const select = byId("equipment-filter-type");
  const current = select.value;
  select.innerHTML = '<option value="">Select a type…</option>';
  for (const [value, label] of Object.entries(EQUIPMENT_TYPE_LABELS)) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  }
  if (current) select.value = current;
}

function renderTable() {
  const typeFilter = byId("equipment-filter-type").value;
  const body = byId("equipment-table-body");
  if (!typeFilter) {
    body.innerHTML = `<tr><td colspan="3" class="hint-text">Select a type above to see equipment.</td></tr>`;
    return;
  }
  body.innerHTML = cache
    .filter((e) => e.type === typeFilter)
    .map(
      (e) => `
      <tr>
        <td>${escapeHtml(e.name)}</td>
        <td>${EQUIPMENT_TYPE_LABELS[e.type] || e.type}</td>
        <td class="row-actions">
          <button class="link-btn" data-edit="${e.id}">✏️ Edit</button>
        </td>
      </tr>`
    )
    .join("");

  body.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openForm(cache.find((e) => e.id === btn.dataset.edit)))
  );
}

function updateMowerFieldsVisibility() {
  const isMower = byId("equipment-type").value === "mower";
  byId("equipment-mower-fields").classList.toggle("hidden", !isMower);
}

// Feeds the Brand/Purchased From datalists from whatever values have
// already been used across other equipment records, so those fields work
// as a "pick from what I've used before, or type something new" combo.
function uniqueSortedValues(field) {
  return [...new Set(cache.map((e) => e[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function populateDatalist(datalistId, values) {
  byId(datalistId).innerHTML = values.map((v) => `<option value="${escapeHtml(v)}"></option>`).join("");
}

function openForm(equipment = null) {
  byId("equipment-form-card").classList.remove("hidden");
  byId("equipment-filter-row").classList.add("hidden");
  byId("equipment-form-title").textContent = equipment ? "Edit Equipment" : "Add Equipment";
  byId("equipment-id").value = equipment?.id || "";
  byId("equipment-name").value = equipment?.name || "";
  byId("equipment-type").value = equipment?.type || "mower";
  byId("equipment-deck-heights").value = equipment?.deckHeights?.join(", ") || "";
  byId("equipment-ground-speeds").value = equipment?.groundSpeeds?.join(", ") || "";
  byId("equipment-blade-speeds").value = equipment?.bladeSpeeds?.join(", ") || "";
  populateDefaultOptionsSelect(byId("equipment-default-deck-height"), equipment?.deckHeights || [], equipment?.defaultDeckHeight ?? null);
  populateDefaultOptionsSelect(byId("equipment-default-ground-speed"), equipment?.groundSpeeds || [], equipment?.defaultGroundSpeed ?? null);
  populateDefaultOptionsSelect(byId("equipment-default-blade-speed"), equipment?.bladeSpeeds || [], equipment?.defaultBladeSpeed ?? null);
  populateDatalist("equipment-brand-options", uniqueSortedValues("brand"));
  populateDatalist("equipment-purchased-from-options", uniqueSortedValues("purchasedFrom"));
  byId("equipment-brand").value = equipment?.brand || "";
  byId("equipment-model-number").value = equipment?.modelNumber || "";
  byId("equipment-serial-number").value = equipment?.serialNumber || "";
  byId("equipment-purchase-date").value = equipment?.purchaseDate || "";
  byId("equipment-purchased-from").value = equipment?.purchasedFrom || "";
  byId("equipment-notes").value = equipment?.notes || "";
  byId("equipment-active").checked = equipment?.active !== false;
  updateMowerFieldsVisibility();
  byId("delete-equipment-btn").classList.toggle("hidden", !equipment);
}

function closeForm() {
  byId("equipment-form-card").classList.add("hidden");
  byId("equipment-filter-row").classList.remove("hidden");
  byId("equipment-form").reset();
}

async function handleDelete() {
  const id = byId("equipment-id").value;
  if (!id) return;
  if (!(await confirmAction("Delete this equipment record? This does not delete visits or tasks that reference it."))) return;
  await deleteDocById(COLLECTION, id);
  closeForm();
  await refreshEquipmentView();
}

async function handleSubmit(e) {
  e.preventDefault();
  const id = byId("equipment-id").value;
  const type = byId("equipment-type").value;
  const isMower = type === "mower";
  const data = {
    name: byId("equipment-name").value.trim(),
    type,
    deckHeights: isMower ? parseNumberList(byId("equipment-deck-heights").value) : [],
    groundSpeeds: isMower ? parseTextList(byId("equipment-ground-speeds").value) : [],
    bladeSpeeds: isMower ? parseTextList(byId("equipment-blade-speeds").value) : [],
    defaultDeckHeight: isMower && byId("equipment-default-deck-height").value ? Number(byId("equipment-default-deck-height").value) : null,
    defaultGroundSpeed: isMower ? byId("equipment-default-ground-speed").value || null : null,
    defaultBladeSpeed: isMower ? byId("equipment-default-blade-speed").value || null : null,
    brand: byId("equipment-brand").value.trim(),
    modelNumber: byId("equipment-model-number").value.trim(),
    serialNumber: byId("equipment-serial-number").value.trim(),
    purchaseDate: byId("equipment-purchase-date").value || null,
    purchasedFrom: byId("equipment-purchased-from").value.trim(),
    notes: byId("equipment-notes").value.trim(),
    active: byId("equipment-active").checked,
  };
  if (id) await updateDocById(COLLECTION, id, data);
  else await createDoc(COLLECTION, data);
  closeForm();
  await refreshEquipmentView();
}

export async function refreshEquipmentView() {
  await loadEquipment();
  populateTypeFilterOptions();
  renderTable();
  document.dispatchEvent(new CustomEvent("equipment:changed"));
}

export function initEquipmentView() {
  if (!listenersBound) {
    byId("add-equipment-btn").addEventListener("click", () => openForm());
    byId("cancel-equipment-btn").addEventListener("click", closeForm);
    byId("equipment-form").addEventListener("submit", handleSubmit);
    byId("delete-equipment-btn").addEventListener("click", handleDelete);
    byId("equipment-type").addEventListener("change", updateMowerFieldsVisibility);
    byId("equipment-filter-type").addEventListener("change", renderTable);
    byId("equipment-deck-heights").addEventListener("input", () =>
      populateDefaultOptionsSelect(byId("equipment-default-deck-height"), parseNumberList(byId("equipment-deck-heights").value))
    );
    byId("equipment-ground-speeds").addEventListener("input", () =>
      populateDefaultOptionsSelect(byId("equipment-default-ground-speed"), parseTextList(byId("equipment-ground-speeds").value))
    );
    byId("equipment-blade-speeds").addEventListener("input", () =>
      populateDefaultOptionsSelect(byId("equipment-default-blade-speed"), parseTextList(byId("equipment-blade-speeds").value))
    );
    listenersBound = true;
  }
  return refreshEquipmentView();
}
