import { listAll, createDoc, updateDocById, deleteDocById } from "./db.js";
import { byId, escapeHtml, formatDateDisplay } from "./utils.js";
import { getVisits } from "./mowLog.js";
import { refreshWeatherView } from "./weatherView.js";
import { profileFor } from "./growthPotential.js";
import { computeMowStatus } from "./mowReadiness.js";
import { getSettings } from "./settings.js";

const COLLECTION = "customers";
let cache = [];
let mowStatus = new Map();
let mowStatusReady = false;
let listenersBound = false;

export async function loadCustomers() {
  cache = await listAll(COLLECTION, { orderByField: "name", direction: "asc" });
  return cache;
}

export function getCustomers() {
  return cache;
}

export function getCustomerName(id) {
  return cache.find((c) => c.id === id)?.name || "(deleted customer)";
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

function mowStatusCell(customerId) {
  if (!mowStatusReady) {
    return `<td>–</td><td><span class="badge badge-inactive">Loading…</span></td>`;
  }
  const status = mowStatus.get(customerId);
  if (!status || !status.lastMowDate) {
    return `<td>–</td><td><span class="badge badge-inactive">No mow history</span></td>`;
  }
  const lastMowCell = `${formatDateDisplay(status.lastMowDate)} (${status.daysSinceMow}d ago)`;
  const badge = status.ready
    ? `<span class="badge badge-ready">Ready to mow</span>`
    : `<span class="badge badge-waiting">~${status.estimatedDaysUntilReady}d until ready</span>`;
  return `<td>${lastMowCell}</td><td>${badge}</td>`;
}

function renderTable() {
  const body = byId("customer-table-body");
  body.innerHTML = cache
    .map(
      (c) => `
      <tr>
        <td>${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.address || "")}</td>
        <td>${escapeHtml(c.frequency || "")}</td>
        <td><span class="badge ${c.active === false ? "badge-inactive" : "badge-active"}">${c.active === false ? "Inactive" : "Active"}</span></td>
        ${mowStatusCell(c.id)}
        <td class="row-actions">
          <button class="link-btn" data-edit="${c.id}">Edit</button>
          <button class="link-btn danger" data-delete="${c.id}">Delete</button>
        </td>
      </tr>`
    )
    .join("");

  body.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openForm(cache.find((c) => c.id === btn.dataset.edit)))
  );
  body.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => handleDelete(btn.dataset.delete))
  );
}

async function refreshMowStatus() {
  const settings = await getSettings();
  const { days } = await refreshWeatherView();
  mowStatus = computeMowStatus(cache, getVisits(), days, {
    grassProfile: profileFor(settings.grassType),
    mowThresholdGPDays: settings.mowThresholdGPDays,
  });
  mowStatusReady = true;
  renderTable();
}

function openForm(customer = null) {
  byId("customer-form-card").classList.remove("hidden");
  byId("customer-form-title").textContent = customer ? "Edit Customer" : "Add Customer";
  byId("customer-id").value = customer?.id || "";
  byId("customer-name").value = customer?.name || "";
  byId("customer-address").value = customer?.address || "";
  byId("customer-phone").value = customer?.phone || "";
  byId("customer-email").value = customer?.email || "";
  byId("customer-frequency").value = customer?.frequency || "weekly";
  byId("customer-notes").value = customer?.notes || "";
  byId("customer-active").checked = customer?.active !== false;
}

function closeForm() {
  byId("customer-form-card").classList.add("hidden");
  byId("customer-form").reset();
}

async function handleDelete(id) {
  if (!confirm("Delete this customer? This does not delete their visit history.")) return;
  await deleteDocById(COLLECTION, id);
  await refreshCustomersView();
}

async function handleSubmit(e) {
  e.preventDefault();
  const id = byId("customer-id").value;
  const data = {
    name: byId("customer-name").value.trim(),
    address: byId("customer-address").value.trim(),
    phone: byId("customer-phone").value.trim(),
    email: byId("customer-email").value.trim(),
    frequency: byId("customer-frequency").value,
    notes: byId("customer-notes").value.trim(),
    active: byId("customer-active").checked,
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
  refreshMowStatus().catch((err) => console.error("Failed to refresh mow status", err));
}

export function initCustomersView() {
  if (!listenersBound) {
    byId("add-customer-btn").addEventListener("click", () => openForm());
    byId("cancel-customer-btn").addEventListener("click", closeForm);
    byId("customer-form").addEventListener("submit", handleSubmit);
    listenersBound = true;
  }
  return refreshCustomersView();
}
