import { listAll, createDoc, updateDocById, deleteDocById } from "./db.js";
import { byId, escapeHtml } from "./utils.js";

const COLLECTION = "equipment";
let cache = [];
let listenersBound = false;

export const EQUIPMENT_TYPE_LABELS = {
  mower: "Mower",
  trimmer: "Trimmer",
  edger: "Edger",
  blower: "Blower",
  sprayer: "Sprayer",
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

function parseDeckHeights(raw) {
  const values = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => !Number.isNaN(n));
  return [...new Set(values)].sort((a, b) => a - b);
}

export function populateEquipmentSelect(selectEl, { includeNone = true } = {}) {
  const current = selectEl.value;
  selectEl.innerHTML = "";
  if (includeNone) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "None / Not specified";
    selectEl.appendChild(opt);
  }
  for (const e of cache.filter((e) => e.active !== false)) {
    const opt = document.createElement("option");
    opt.value = e.id;
    opt.textContent = `${e.name} (${EQUIPMENT_TYPE_LABELS[e.type] || e.type})`;
    selectEl.appendChild(opt);
  }
  if (current) selectEl.value = current;
}

// Populates a deck-height <select> with the chosen mower's configured
// height settings. currentValue (if given) is preserved as an option even
// if it's not one of the mower's current settings, so editing an older
// visit doesn't silently lose its recorded height.
export function populateDeckHeightSelect(selectEl, equipmentId, currentValue = null) {
  const eq = getEquipmentById(equipmentId);
  const isMower = eq?.type === "mower";
  const heights = new Set(isMower ? eq.deckHeights || [] : []);
  if (currentValue != null) heights.add(currentValue);
  const sorted = [...heights].sort((a, b) => a - b);

  selectEl.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = !eq ? "Select equipment first" : !isMower ? "Not applicable" : sorted.length ? "Select height" : "No heights configured";
  selectEl.appendChild(blank);
  for (const h of sorted) {
    const opt = document.createElement("option");
    opt.value = String(h);
    opt.textContent = `${h}"`;
    selectEl.appendChild(opt);
  }
  selectEl.value = currentValue != null ? String(currentValue) : "";
  selectEl.disabled = !isMower;
}

function renderTable() {
  const body = byId("equipment-table-body");
  body.innerHTML = cache
    .map(
      (e) => `
      <tr>
        <td>${escapeHtml(e.name)}</td>
        <td>${EQUIPMENT_TYPE_LABELS[e.type] || e.type}</td>
        <td>${e.type === "mower" && e.deckHeights?.length ? e.deckHeights.map((h) => `${h}"`).join(", ") : ""}</td>
        <td><span class="badge ${e.active === false ? "badge-inactive" : "badge-active"}">${e.active === false ? "Inactive" : "Active"}</span></td>
        <td class="row-actions">
          <button class="link-btn" data-edit="${e.id}">Edit</button>
          <button class="link-btn danger" data-delete="${e.id}">Delete</button>
        </td>
      </tr>`
    )
    .join("");

  body.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openForm(cache.find((e) => e.id === btn.dataset.edit)))
  );
  body.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => handleDelete(btn.dataset.delete))
  );
}

function updateDeckHeightVisibility() {
  const isMower = byId("equipment-type").value === "mower";
  byId("equipment-deck-height-row").classList.toggle("hidden", !isMower);
}

function openForm(equipment = null) {
  byId("equipment-form-card").classList.remove("hidden");
  byId("equipment-form-title").textContent = equipment ? "Edit Equipment" : "Add Equipment";
  byId("equipment-id").value = equipment?.id || "";
  byId("equipment-name").value = equipment?.name || "";
  byId("equipment-type").value = equipment?.type || "mower";
  byId("equipment-deck-heights").value = equipment?.deckHeights?.join(", ") || "";
  byId("equipment-notes").value = equipment?.notes || "";
  byId("equipment-active").checked = equipment?.active !== false;
  updateDeckHeightVisibility();
}

function closeForm() {
  byId("equipment-form-card").classList.add("hidden");
  byId("equipment-form").reset();
}

async function handleDelete(id) {
  if (!confirm("Delete this equipment record? This does not delete visits or tasks that reference it.")) return;
  await deleteDocById(COLLECTION, id);
  await refreshEquipmentView();
}

async function handleSubmit(e) {
  e.preventDefault();
  const id = byId("equipment-id").value;
  const type = byId("equipment-type").value;
  const data = {
    name: byId("equipment-name").value.trim(),
    type,
    deckHeights: type === "mower" ? parseDeckHeights(byId("equipment-deck-heights").value) : [],
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
  renderTable();
  document.dispatchEvent(new CustomEvent("equipment:changed"));
}

export function initEquipmentView() {
  if (!listenersBound) {
    byId("add-equipment-btn").addEventListener("click", () => openForm());
    byId("cancel-equipment-btn").addEventListener("click", closeForm);
    byId("equipment-form").addEventListener("submit", handleSubmit);
    byId("equipment-type").addEventListener("change", updateDeckHeightVisibility);
    listenersBound = true;
  }
  return refreshEquipmentView();
}
