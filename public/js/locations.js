import { listAll, createDoc, updateDocById, deleteDocById } from "./db.js";
import { byId, escapeHtml, formatPhoneNumber, confirmAction } from "./utils.js";
import { getCustomers, getCustomerName, populateCustomerSelect } from "./customers.js";
import { wireAddressValidation } from "./addressValidation.js";

const COLLECTION = "locations";
let cache = [];
let listenersBound = false;

export async function loadLocations() {
  cache = await listAll(COLLECTION, { orderByField: "label", direction: "asc" });
  return cache;
}

export function getLocations() {
  return cache;
}

export function getLocationsForCustomer(customerId) {
  return cache.filter((l) => l.customerId === customerId);
}

export function getLocationLabel(id) {
  return cache.find((l) => l.id === id)?.label || null;
}

// Populates a <select> with the locations belonging to customerId only.
export function populateLocationSelect(selectEl, customerId, { includeNone = true } = {}) {
  const current = selectEl.value;
  selectEl.innerHTML = "";
  if (includeNone) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Not specified";
    selectEl.appendChild(opt);
  }
  for (const l of getLocationsForCustomer(customerId)) {
    const opt = document.createElement("option");
    opt.value = l.id;
    opt.textContent = l.label;
    selectEl.appendChild(opt);
  }
  if (current && [...selectEl.options].some((o) => o.value === current)) {
    selectEl.value = current;
  }
}

function renderTable() {
  const body = byId("location-table-body");
  body.innerHTML = cache
    .map(
      (l) => `
      <tr>
        <td>${escapeHtml(l.label)}</td>
        <td>${escapeHtml(getCustomerName(l.customerId))}</td>
        <td>${escapeHtml(l.address || "")}</td>
        <td class="row-actions">
          <button class="link-btn" data-edit="${l.id}">✏️ Edit</button>
        </td>
      </tr>`
    )
    .join("");

  body.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openForm(cache.find((l) => l.id === btn.dataset.edit)))
  );
}

function customerAddress(customerId) {
  return getCustomers().find((c) => c.id === customerId)?.address || "";
}

function collectContactsFromDOM() {
  return [...byId("location-contacts-list").querySelectorAll("[data-contact-row]")].map((row) => ({
    name: row.querySelector(".contact-name").value,
    phone: row.querySelector(".contact-phone").value,
    email: row.querySelector(".contact-email").value,
    notes: row.querySelector(".contact-notes").value,
  }));
}

function renderContactRows(contacts) {
  const list = byId("location-contacts-list");
  list.innerHTML = contacts
    .map(
      (c) => `
      <div class="contact-row" data-contact-row>
        <input type="text" class="contact-name" placeholder="Name" value="${escapeHtml(c.name || "")}" />
        <input type="tel" class="contact-phone" placeholder="Phone" value="${escapeHtml(c.phone || "")}" />
        <input type="email" class="contact-email" placeholder="Email" value="${escapeHtml(c.email || "")}" />
        <input type="text" class="contact-notes" placeholder="e.g. Tenant" value="${escapeHtml(c.notes || "")}" />
        <button type="button" class="link-btn danger" data-remove-contact>✕</button>
      </div>`
    )
    .join("");

  list.querySelectorAll(".contact-phone").forEach((input) =>
    input.addEventListener("blur", () => {
      input.value = formatPhoneNumber(input.value.trim());
    })
  );
  list.querySelectorAll("[data-remove-contact]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const contacts = collectContactsFromDOM();
      const row = btn.closest("[data-contact-row]");
      contacts.splice([...list.children].indexOf(row), 1);
      renderContactRows(contacts);
    })
  );
}

function openForm(location = null) {
  byId("location-form-card").classList.remove("hidden");
  byId("location-form-title").textContent = location ? "Edit Location" : "Add Location";
  populateCustomerSelect(byId("location-customer"));
  byId("location-id").value = location?.id || "";
  const customerId = location?.customerId || getCustomers()[0]?.id || "";
  byId("location-customer").value = customerId;
  byId("location-label").value = location?.label || "";
  byId("location-notes").value = location?.notes || "";
  const sameAsCustomer = location?.sameAsCustomerAddress || false;
  byId("location-same-as-customer").checked = sameAsCustomer;
  byId("location-address").value = sameAsCustomer ? customerAddress(customerId) : location?.address || "";
  byId("location-address").disabled = sameAsCustomer;
  byId("location-address-status").textContent = "";
  renderContactRows(location?.contacts || []);
  byId("delete-location-btn").classList.toggle("hidden", !location);
}

function closeForm() {
  byId("location-form-card").classList.add("hidden");
  byId("location-form").reset();
  byId("location-address").disabled = false;
  byId("location-address-status").textContent = "";
}

async function handleDelete() {
  const id = byId("location-id").value;
  if (!id) return;
  if (!(await confirmAction("Delete this location? Areas and yard features under it will be orphaned, not deleted."))) return;
  await deleteDocById(COLLECTION, id);
  closeForm();
  await refreshLocationsView();
}

async function handleSubmit(e) {
  e.preventDefault();
  const id = byId("location-id").value;
  const contacts = collectContactsFromDOM()
    .map((c) => ({
      name: c.name.trim(),
      phone: formatPhoneNumber(c.phone.trim()),
      email: c.email.trim(),
      notes: c.notes.trim(),
    }))
    .filter((c) => c.name || c.phone || c.email || c.notes);
  const data = {
    customerId: byId("location-customer").value,
    label: byId("location-label").value.trim(),
    address: byId("location-address").value.trim(),
    sameAsCustomerAddress: byId("location-same-as-customer").checked,
    contacts,
    notes: byId("location-notes").value.trim(),
  };
  if (id) await updateDocById(COLLECTION, id, data);
  else await createDoc(COLLECTION, data);
  closeForm();
  await refreshLocationsView();
}

export async function refreshLocationsView() {
  await loadLocations();
  renderTable();
  document.dispatchEvent(new CustomEvent("locations:changed"));
}

export function initLocationsView() {
  if (!listenersBound) {
    byId("add-location-btn").addEventListener("click", () => {
      if (!getCustomers().length) {
        alert("Add a customer first.");
        return;
      }
      openForm();
    });
    byId("cancel-location-btn").addEventListener("click", closeForm);
    byId("location-form").addEventListener("submit", handleSubmit);
    byId("delete-location-btn").addEventListener("click", handleDelete);
    byId("location-same-as-customer").addEventListener("change", () => {
      const checked = byId("location-same-as-customer").checked;
      byId("location-address").disabled = checked;
      if (checked) {
        byId("location-address").value = customerAddress(byId("location-customer").value);
      }
    });
    byId("location-customer").addEventListener("change", () => {
      if (byId("location-same-as-customer").checked) {
        byId("location-address").value = customerAddress(byId("location-customer").value);
      }
    });
    byId("add-location-contact-btn").addEventListener("click", () => {
      const contacts = collectContactsFromDOM();
      contacts.push({});
      renderContactRows(contacts);
    });
    wireAddressValidation({
      inputId: "location-address",
      buttonId: "location-address-validate-btn",
      statusId: "location-address-status",
    });
    listenersBound = true;
  }
  return refreshLocationsView();
}
