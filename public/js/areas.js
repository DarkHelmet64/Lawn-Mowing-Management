import { listAll, createDoc, updateDocById, deleteDocById } from "./db.js";
import { byId, escapeHtml, confirmAction } from "./utils.js";
import { getCustomers, getCustomerName, populateCustomerSelect } from "./customers.js";
import { getLocations, populateLocationSelect } from "./locations.js";
import { EVENT_TYPE_KEYS } from "./eventTypes.js";

const COLLECTION = "areas";
let cache = [];
let listenersBound = false;
let expandedLocationIds = new Set();

const QUICK_ADD_OPTIONS = [
  { id: "area-quick-front", name: "Front Yard" },
  { id: "area-quick-back", name: "Back Yard" },
  { id: "area-quick-flowerbed", name: "Flower Bed" },
  { id: "area-quick-driveway", name: "Driveway/Sidewalk" },
];

export async function loadAreas() {
  cache = await listAll(COLLECTION, { orderByField: "name", direction: "asc" });
  return cache;
}

export function getAreas() {
  return cache;
}

export function getAreasForLocation(locationId) {
  return cache.filter((a) => a.locationId === locationId);
}

export function getAreaName(id) {
  return cache.find((a) => a.id === id)?.name || null;
}

// Areas created before this field existed have no eventTypes at all, so
// treat that as "applies everywhere" rather than making them vanish from
// every event type's area list.
export function areaAppliesToEventTypes(area, types) {
  return !area.eventTypes || area.eventTypes.some((t) => types.includes(t));
}

// Populates a <select> with the areas belonging to locationId only.
export function populateAreaSelect(selectEl, locationId, { includeNone = true } = {}) {
  const current = selectEl.value;
  selectEl.innerHTML = "";
  if (includeNone) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Not specified";
    selectEl.appendChild(opt);
  }
  for (const a of getAreasForLocation(locationId)) {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = a.name;
    selectEl.appendChild(opt);
  }
  if (current && [...selectEl.options].some((o) => o.value === current)) {
    selectEl.value = current;
  }
}

function sortedLocations() {
  return [...getLocations()].sort((a, b) => {
    const ca = getCustomerName(a.customerId);
    const cb = getCustomerName(b.customerId);
    if (ca !== cb) return ca < cb ? -1 : 1;
    return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
  });
}

function toggleLocation(locationId) {
  if (expandedLocationIds.has(locationId)) expandedLocationIds.delete(locationId);
  else expandedLocationIds.add(locationId);
  renderTree();
}

function renderTree() {
  const container = byId("area-tree");
  const locations = sortedLocations();

  container.innerHTML =
    locations
      .map((loc) => {
        const areasForLoc = getAreasForLocation(loc.id);
        const expanded = expandedLocationIds.has(loc.id);
        const rows = areasForLoc.length
          ? areasForLoc
              .map(
                (a) => `
                <div class="tree-row">
                  <span class="tree-row-name">${escapeHtml(a.name)}</span>
                  <span class="tree-row-notes">${escapeHtml(a.notes || "")}</span>
                  <span class="row-actions">
                    <button class="link-btn" data-edit="${a.id}">✏️ Edit</button>
                  </span>
                </div>`
              )
              .join("")
          : `<p class="hint-text tree-empty">No areas yet.</p>`;
        return `
          <div class="tree-group">
            <button type="button" class="tree-header" data-toggle-location="${loc.id}">
              <span class="tree-toggle-icon">${expanded ? "▾" : "▸"}</span>
              <span class="tree-title">${escapeHtml(loc.label)} <span class="hint-text">(${escapeHtml(getCustomerName(loc.customerId))})</span></span>
              <span class="badge badge-inactive">${areasForLoc.length} area${areasForLoc.length === 1 ? "" : "s"}</span>
            </button>
            <div class="tree-body ${expanded ? "" : "hidden"}">${rows}</div>
          </div>`;
      })
      .join("") || `<p class="hint-text">Add a location first.</p>`;

  container.querySelectorAll("[data-toggle-location]").forEach((btn) =>
    btn.addEventListener("click", () => toggleLocation(btn.dataset.toggleLocation))
  );
  container.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openForm(cache.find((a) => a.id === btn.dataset.edit)))
  );
}

function refreshLocationOptions() {
  populateLocationSelect(byId("area-location"), byId("area-customer").value, { includeNone: false });
}

function openForm(area = null) {
  byId("area-form-card").classList.remove("hidden");
  byId("area-form-title").textContent = area ? "Edit Area" : "Add Area";
  const loc = area ? getLocations().find((l) => l.id === area.locationId) : null;
  populateCustomerSelect(byId("area-customer"));
  byId("area-id").value = area?.id || "";
  byId("area-customer").value = loc?.customerId || getCustomers()[0]?.id || "";
  refreshLocationOptions();
  byId("area-location").value = area?.locationId || "";
  byId("area-name").value = area?.name || "";
  byId("area-notes").value = area?.notes || "";
  for (const t of EVENT_TYPE_KEYS) {
    byId(`area-event-type-${t}`).checked = !area?.eventTypes || area.eventTypes.includes(t);
  }
  byId("delete-area-btn").classList.toggle("hidden", !area);
  byId("area-quick-add").classList.toggle("hidden", !!area);
}

function closeForm() {
  byId("area-form-card").classList.add("hidden");
  byId("area-form").reset();
}

async function handleDelete() {
  const id = byId("area-id").value;
  if (!id) return;
  if (!(await confirmAction("Delete this area? Yard features under it will be orphaned, not deleted."))) return;
  await deleteDocById(COLLECTION, id);
  closeForm();
  await refreshAreasView();
}

async function handleSubmit(e) {
  e.preventDefault();
  const id = byId("area-id").value;
  const locationId = byId("area-location").value;
  if (!locationId) {
    alert("Select a location for this area.");
    return;
  }
  const notes = byId("area-notes").value.trim();
  const customName = byId("area-name").value.trim();
  const eventTypes = EVENT_TYPE_KEYS.filter((t) => byId(`area-event-type-${t}`).checked);

  if (id) {
    if (!customName) {
      alert("Enter a name for this area.");
      return;
    }
    await updateDocById(COLLECTION, id, { locationId, name: customName, notes, eventTypes });
    expandedLocationIds.add(locationId);
    closeForm();
    await refreshAreasView();
    return;
  }

  const names = QUICK_ADD_OPTIONS.filter((opt) => byId(opt.id).checked).map((opt) => opt.name);
  if (customName) names.push(customName);
  if (!names.length) {
    alert("Enter a name or check at least one common area.");
    return;
  }
  const existingNames = new Set(getAreasForLocation(locationId).map((a) => a.name.toLowerCase()));
  const newNames = [...new Set(names)].filter((n) => !existingNames.has(n.toLowerCase()));
  if (!newNames.length) {
    alert("Those areas already exist for this location.");
    return;
  }
  for (const name of newNames) {
    await createDoc(COLLECTION, { locationId, name, notes, eventTypes });
  }
  expandedLocationIds.add(locationId);
  closeForm();
  await refreshAreasView();
}

export async function refreshAreasView() {
  await loadAreas();
  renderTree();
  document.dispatchEvent(new CustomEvent("areas:changed"));
}

export function initAreasView() {
  if (!listenersBound) {
    byId("add-area-btn").addEventListener("click", () => {
      if (!getLocations().length) {
        alert("Add a location first.");
        return;
      }
      openForm();
    });
    byId("cancel-area-btn").addEventListener("click", closeForm);
    byId("area-form").addEventListener("submit", handleSubmit);
    byId("delete-area-btn").addEventListener("click", handleDelete);
    byId("area-customer").addEventListener("change", refreshLocationOptions);
    document.addEventListener("locations:changed", () => renderTree());
    listenersBound = true;
  }
  return refreshAreasView();
}
