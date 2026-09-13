import { listAll, createDoc, deleteDocById } from "./db.js";
import { byId, escapeHtml, todayStr, formatDateDisplay } from "./utils.js";
import { getProducts, getProductById, getProductName, populateProductSelect, adjustProductQuantity, refreshProductsView } from "./products.js";

const COLLECTION = "productPurchases";
let cache = [];
let listenersBound = false;

export async function loadPurchases() {
  cache = await listAll(COLLECTION, { orderByField: "date", direction: "desc" });
  return cache;
}

export function getPurchases() {
  return cache;
}

function uniqueSortedSuppliers() {
  return [...new Set(cache.map((p) => p.supplier).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function populateDatalist(datalistId, values) {
  byId(datalistId).innerHTML = values.map((v) => `<option value="${escapeHtml(v)}"></option>`).join("");
}

function renderTable() {
  const body = byId("purchase-table-body");
  body.innerHTML =
    cache
      .map(
        (p) => `
      <tr>
        <td>${formatDateDisplay(p.date)}</td>
        <td>${escapeHtml(getProductName(p.productId) || "")}</td>
        <td>${p.quantity} ${escapeHtml(getProductById(p.productId)?.unit || "")}</td>
        <td>${p.cost != null ? `$${p.cost.toFixed(2)}` : ""}</td>
        <td>${escapeHtml(p.supplier || "")}</td>
        <td class="row-actions">
          <button class="link-btn danger" data-delete="${p.id}">Delete</button>
        </td>
      </tr>`
      )
      .join("") || `<tr><td colspan="6" class="hint-text">No purchases logged yet.</td></tr>`;

  body.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => handleDelete(btn.dataset.delete))
  );
}

function openForm() {
  byId("purchase-form-card").classList.remove("hidden");
  populateProductSelect(byId("purchase-product"), { includeNone: false });
  populateDatalist("purchase-supplier-options", uniqueSortedSuppliers());
  byId("purchase-date").value = todayStr();
  byId("purchase-quantity").value = "";
  byId("purchase-cost").value = "";
  byId("purchase-supplier").value = "";
  byId("purchase-notes").value = "";
}

function closeForm() {
  byId("purchase-form-card").classList.add("hidden");
  byId("purchase-form").reset();
}

async function handleDelete(id) {
  if (!confirm("Delete this purchase record? This will NOT reverse the quantity it added to on-hand stock.")) return;
  await deleteDocById(COLLECTION, id);
  await refreshPurchasesView();
}

async function handleSubmit(e) {
  e.preventDefault();
  const productId = byId("purchase-product").value;
  const quantity = Number(byId("purchase-quantity").value);
  if (!productId || !quantity || quantity <= 0) {
    alert("Select a product and enter a quantity greater than 0.");
    return;
  }
  const data = {
    productId,
    date: byId("purchase-date").value,
    quantity,
    cost: byId("purchase-cost").value ? Number(byId("purchase-cost").value) : null,
    supplier: byId("purchase-supplier").value.trim(),
    notes: byId("purchase-notes").value.trim(),
  };
  await createDoc(COLLECTION, data);
  await adjustProductQuantity(productId, quantity);
  await refreshProductsView();
  closeForm();
  await refreshPurchasesView();
}

export async function refreshPurchasesView() {
  await loadPurchases();
  renderTable();
}

export function initPurchasesView() {
  if (!listenersBound) {
    byId("add-purchase-btn").addEventListener("click", () => {
      if (!getProducts().length) {
        alert("Add a product first.");
        return;
      }
      openForm();
    });
    byId("cancel-purchase-btn").addEventListener("click", closeForm);
    byId("purchase-form").addEventListener("submit", handleSubmit);
    listenersBound = true;
  }
  return refreshPurchasesView();
}
