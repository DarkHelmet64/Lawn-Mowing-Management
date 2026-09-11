import { listAll, createDoc, updateDocById, deleteDocById } from "./db.js";
import { byId, escapeHtml, todayStr, formatDateDisplay } from "./utils.js";
import { getCustomers, getCustomerName, populateCustomerSelect } from "./customers.js";

const COLLECTION = "mowVisits";
let cache = [];

const PATTERN_LABELS = {
  stripes: "Straight Stripes",
  diagonal: "Diagonal Stripes",
  checkerboard: "Checkerboard",
  waves: "Waves",
  circular: "Circular",
  diamond: "Diamond",
  none: "No Pattern",
  other: "Other",
};

export async function loadVisits() {
  cache = await listAll(COLLECTION, { orderByField: "date", direction: "desc" });
  return cache;
}

export function getVisits() {
  return cache;
}

function renderTable() {
  const filter = byId("visit-filter-customer").value;
  const body = byId("visit-table-body");
  const rows = cache.filter((v) => !filter || v.customerId === filter);
  body.innerHTML = rows
    .map(
      (v) => `
      <tr>
        <td>${formatDateDisplay(v.date)}</td>
        <td>${escapeHtml(getCustomerName(v.customerId))}</td>
        <td>${v.mowed ? "✓" : ""}</td>
        <td>${v.trimmed ? "✓" : ""}</td>
        <td>${v.edged ? "✓" : ""}</td>
        <td>${PATTERN_LABELS[v.pattern] || v.pattern || ""}</td>
        <td class="row-actions">
          <button class="link-btn" data-edit="${v.id}">Edit</button>
          <button class="link-btn danger" data-delete="${v.id}">Delete</button>
        </td>
      </tr>`
    )
    .join("");

  body.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openForm(cache.find((v) => v.id === btn.dataset.edit)))
  );
  body.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => handleDelete(btn.dataset.delete))
  );
}

function openForm(visit = null) {
  byId("visit-form-card").classList.remove("hidden");
  populateCustomerSelect(byId("visit-customer"));
  byId("visit-id").value = visit?.id || "";
  byId("visit-customer").value = visit?.customerId || getCustomers()[0]?.id || "";
  byId("visit-date").value = visit?.date || todayStr();
  byId("visit-mowed").checked = visit?.mowed ?? true;
  byId("visit-trimmed").checked = visit?.trimmed ?? true;
  byId("visit-edged").checked = visit?.edged ?? false;
  byId("visit-pattern").value = visit?.pattern || "stripes";
  byId("visit-height").value = visit?.deckHeight ?? "";
  byId("visit-notes").value = visit?.notes || "";
}

function closeForm() {
  byId("visit-form-card").classList.add("hidden");
  byId("visit-form").reset();
}

async function handleDelete(id) {
  if (!confirm("Delete this visit record?")) return;
  await deleteDocById(COLLECTION, id);
  await refresh();
}

async function handleSubmit(e) {
  e.preventDefault();
  const id = byId("visit-id").value;
  const data = {
    customerId: byId("visit-customer").value,
    date: byId("visit-date").value,
    mowed: byId("visit-mowed").checked,
    trimmed: byId("visit-trimmed").checked,
    edged: byId("visit-edged").checked,
    pattern: byId("visit-pattern").value,
    deckHeight: byId("visit-height").value ? Number(byId("visit-height").value) : null,
    notes: byId("visit-notes").value.trim(),
  };
  if (id) await updateDocById(COLLECTION, id, data);
  else await createDoc(COLLECTION, data);
  closeForm();
  await refresh();
}

async function refresh() {
  await loadVisits();
  renderTable();
}

export function initMowLogView() {
  populateCustomerSelect(byId("visit-filter-customer"), { includeAll: true });

  byId("add-visit-btn").addEventListener("click", () => {
    if (!getCustomers().length) {
      alert("Add a customer first.");
      return;
    }
    openForm();
  });
  byId("cancel-visit-btn").addEventListener("click", closeForm);
  byId("visit-form").addEventListener("submit", handleSubmit);
  byId("visit-filter-customer").addEventListener("change", renderTable);
  document.addEventListener("customers:changed", () => {
    populateCustomerSelect(byId("visit-filter-customer"), { includeAll: true });
    renderTable();
  });

  refresh();
}
