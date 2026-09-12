import { listAll, createDoc, updateDocById, deleteDocById } from "./db.js";
import { byId, escapeHtml, formatPhoneNumber } from "./utils.js";

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
  byId("customer-phone").value = customer?.phone || "";
  byId("customer-email").value = customer?.email || "";
  byId("customer-frequency").value = customer?.frequency || "weekly";
  byId("customer-notes").value = customer?.notes || "";
  byId("customer-active").checked = customer?.active !== false;
  byId("delete-customer-btn").classList.toggle("hidden", !customer);
}

function closeForm() {
  byId("customer-form-card").classList.add("hidden");
  byId("customer-form").reset();
}

async function handleDelete() {
  const id = byId("customer-id").value;
  if (!id) return;
  if (!confirm("Delete this customer? This does not delete their visit history.")) return;
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
    phone: formatPhoneNumber(byId("customer-phone").value.trim()),
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
    listenersBound = true;
  }
  return refreshCustomersView();
}
