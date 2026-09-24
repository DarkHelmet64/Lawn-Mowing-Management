import { listAll, createDoc, updateDocById, deleteDocById } from "./db.js";
import { byId, escapeHtml, confirmAction } from "./utils.js";
import { getCustomers, getCustomerName } from "./customers.js";

const COLLECTION = "customerGroups";
let cache = [];
let listenersBound = false;

export async function loadCustomerGroups() {
  cache = await listAll(COLLECTION, { orderByField: "name", direction: "asc" });
  return cache;
}

export function getCustomerGroups() {
  return cache;
}

export function getCustomerGroupById(id) {
  return cache.find((g) => g.id === id) || null;
}

// A customer isn't restricted to one group, so this can return several -
// callers that need to bucket a customer into "the" group (e.g. Recent
// Activity) should show them under every group they're actually in.
export function getGroupsForCustomer(customerId) {
  return cache.filter((g) => g.customerIds?.includes(customerId));
}

export function populateGroupSelect(selectEl) {
  const current = selectEl.value;
  selectEl.innerHTML = '<option value="">Select a group…</option>';
  for (const g of cache) {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.name;
    selectEl.appendChild(opt);
  }
  if (current) selectEl.value = current;
}

function renderTable() {
  const body = byId("group-table-body");
  body.innerHTML =
    cache
      .map(
        (g) => `
      <tr>
        <td>${escapeHtml(g.name)}</td>
        <td>${(g.customerIds || []).map((id) => escapeHtml(getCustomerName(id))).join(", ")}</td>
        <td class="row-actions">
          <button class="link-btn" data-edit="${g.id}">✏️ Edit</button>
        </td>
      </tr>`
      )
      .join("") || `<tr><td colspan="3" class="hint-text">No groups yet.</td></tr>`;

  body.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openForm(cache.find((g) => g.id === btn.dataset.edit)))
  );
}

function renderCustomerCheckboxes(selectedIds) {
  const container = byId("group-customer-list");
  const customers = getCustomers();
  container.innerHTML = customers.length
    ? customers
        .map(
          (c) => `
      <label class="checkbox-label">
        <input type="checkbox" class="group-customer-checkbox" value="${c.id}" ${selectedIds.includes(c.id) ? "checked" : ""} />
        ${escapeHtml(c.name)}
      </label>`
        )
        .join("")
    : `<p class="hint-text">Add a customer first.</p>`;
}

function checkedGroupCustomerIds() {
  return Array.from(document.querySelectorAll("#group-customer-list .group-customer-checkbox:checked")).map((cb) => cb.value);
}

function openForm(group = null) {
  byId("group-form-card").classList.remove("hidden");
  byId("group-form-title").textContent = group ? "Edit Group" : "Add Group";
  byId("group-id").value = group?.id || "";
  byId("group-name").value = group?.name || "";
  renderCustomerCheckboxes(group?.customerIds || []);
  byId("delete-group-btn").classList.toggle("hidden", !group);
}

function closeForm() {
  byId("group-form-card").classList.add("hidden");
  byId("group-form").reset();
}

async function handleDelete() {
  const id = byId("group-id").value;
  if (!id) return;
  if (!(await confirmAction("Delete this group? This does not delete the customers in it."))) return;
  await deleteDocById(COLLECTION, id);
  closeForm();
  await refreshCustomerGroupsView();
}

async function handleSubmit(e) {
  e.preventDefault();
  const id = byId("group-id").value;
  const name = byId("group-name").value.trim();
  const customerIds = checkedGroupCustomerIds();
  if (!customerIds.length) {
    alert("Select at least one customer for this group.");
    return;
  }
  const data = { name, customerIds };
  if (id) await updateDocById(COLLECTION, id, data);
  else await createDoc(COLLECTION, data);
  closeForm();
  await refreshCustomerGroupsView();
}

export async function refreshCustomerGroupsView() {
  await loadCustomerGroups();
  renderTable();
  document.dispatchEvent(new CustomEvent("customerGroups:changed"));
}

export function initCustomerGroupsView() {
  if (!listenersBound) {
    byId("add-group-btn").addEventListener("click", () => {
      if (!getCustomers().length) {
        alert("Add a customer first.");
        return;
      }
      openForm();
    });
    byId("cancel-group-btn").addEventListener("click", closeForm);
    byId("group-form").addEventListener("submit", handleSubmit);
    byId("delete-group-btn").addEventListener("click", handleDelete);
    listenersBound = true;
  }
  return refreshCustomerGroupsView();
}
