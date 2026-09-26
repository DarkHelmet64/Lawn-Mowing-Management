import { listAll, createDoc, updateDocById, deleteDocById } from "./db.js";
import { byId, escapeHtml, formatPhoneNumber, confirmAction } from "./utils.js";
import { wireAddressValidation } from "./addressValidation.js";
import { getSettings } from "./settings.js";
import { lawnWeatherText } from "./lawnWeather.js";

const COLLECTION = "customers";
let cache = [];
let listenersBound = false;

export async function loadCustomers() {
  cache = await listAll(COLLECTION, { orderByField: "name", direction: "asc" });
  return cache;
}

export function getCustomers() {
  return cache;
}

// Customers still being served (not unchecked as Active).
export function getActiveCustomers() {
  return cache.filter((c) => c.active !== false);
}

export function getCustomerName(id) {
  return cache.find((c) => c.id === id)?.name || "(deleted customer)";
}

const CHECK_ICON = `<svg class="chip-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"></path></svg>`;

// One tappable chip per customer - checkboxes for picking several, radios
// for picking one - with a check mark on the chosen ones.
export function customerChipsHtml({ name, type = "checkbox", checkedIds = [], inputClass = "" }) {
  if (!cache.length) return `<p class="hint-text">Add a customer first.</p>`;
  const checked = new Set(checkedIds);
  return cache
    .map(
      (c) =>
        `<label class="chip-toggle"><input type="${type}" name="${name}" class="${inputClass}" value="${escapeHtml(c.id)}" ${checked.has(c.id) ? "checked" : ""} /><span>${CHECK_ICON}${escapeHtml(c.name)}</span></label>`
    )
    .join("");
}

export function populateCustomerSelect(selectEl, { includeAll = false } = {}) {
  const current = selectEl.value;
  selectEl.innerHTML = "";
  if (includeAll) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "All Customers";
    selectEl.appendChild(opt);
  }
  for (const c of cache) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    selectEl.appendChild(opt);
  }
  if (current) selectEl.value = current;
}

function renderTable() {
  const body = byId("customer-table-body");
  body.innerHTML = cache
    .map(
      (c) => `
      <tr>
        <td>${escapeHtml(c.name)}</td>
        <td class="row-actions">
          <button class="link-btn" data-edit="${c.id}">✏️ Edit</button>
        </td>
      </tr>`
    )
    .join("");

  body.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openForm(cache.find((c) => c.id === btn.dataset.edit)))
  );
}

function openForm(customer = null) {
  byId("customer-form-card").classList.remove("hidden");
  byId("customer-form-title").textContent = customer ? "Edit Customer" : "Add Customer";
  byId("customer-id").value = customer?.id || "";
  byId("customer-name").value = customer?.name || "";
  byId("customer-address").value = customer?.address || "";
  byId("customer-address-status").textContent = "";
  byId("customer-contact-name").value = customer?.contactName || "";
  byId("customer-phone").value = customer?.phone || "";
  byId("customer-email").value = customer?.email || "";
  byId("customer-frequency").value = customer?.frequency || "weekly";
  byId("customer-notes").value = customer?.notes || "";
  byId("customer-active").checked = customer?.active !== false;
  byId("customer-grass-type").value = customer?.grassType || "";
  byId("customer-mow-threshold").value = customer?.mowThresholdGPDays ?? "";
  byId("customer-irrigated").checked = !!customer?.irrigated;
  byId("customer-weather-place").textContent = customer ? lawnWeatherText(customer) : "";
  showMowingDefaults();
  byId("delete-customer-btn").classList.toggle("hidden", !customer);
}

// Blank grass type and threshold mean "use the Weather & Growth settings" -
// say what those are.
async function showMowingDefaults() {
  const settings = await getSettings();
  byId("customer-grass-default").textContent = `Default (${settings.grassType === "warm" ? "Warm-season" : "Cool-season"})`;
  byId("customer-mow-threshold").placeholder = `Default (${settings.mowThresholdGPDays})`;
}

function closeForm() {
  byId("customer-form-card").classList.add("hidden");
  byId("customer-form").reset();
  byId("customer-address-status").textContent = "";
}

async function handleDelete() {
  const id = byId("customer-id").value;
  if (!id) return;
  if (!(await confirmAction("Delete this customer? This does not delete their visit history."))) return;
  await deleteDocById(COLLECTION, id);
  closeForm();
  await refreshCustomersView();
}

async function handleSubmit(e) {
  e.preventDefault();
  const id = byId("customer-id").value;
  const data = {
    name: byId("customer-name").value.trim(),
    address: byId("customer-address").value.trim(),
    contactName: byId("customer-contact-name").value.trim(),
    phone: formatPhoneNumber(byId("customer-phone").value.trim()),
    email: byId("customer-email").value.trim(),
    frequency: byId("customer-frequency").value,
    notes: byId("customer-notes").value.trim(),
    active: byId("customer-active").checked,
    grassType: byId("customer-grass-type").value || null,
    mowThresholdGPDays: Number(byId("customer-mow-threshold").value) || null,
    irrigated: byId("customer-irrigated").checked,
  };
  if (id) await updateDocById(COLLECTION, id, data);
  else await createDoc(COLLECTION, data);
  closeForm();
  await refreshCustomersView();
}

export async function refreshCustomersView() {
  await loadCustomers();
  renderTable();
  document.dispatchEvent(new CustomEvent("customers:changed"));
}

export function initCustomersView() {
  if (!listenersBound) {
    byId("add-customer-btn").addEventListener("click", () => openForm());
    byId("cancel-customer-btn").addEventListener("click", closeForm);
    byId("customer-form").addEventListener("submit", handleSubmit);
    byId("delete-customer-btn").addEventListener("click", handleDelete);
    byId("customer-phone").addEventListener("blur", () => {
      byId("customer-phone").value = formatPhoneNumber(byId("customer-phone").value.trim());
    });
    wireAddressValidation({
      inputId: "customer-address",
      buttonId: "customer-address-validate-btn",
      statusId: "customer-address-status",
    });
    listenersBound = true;
  }
  return refreshCustomersView();
}
