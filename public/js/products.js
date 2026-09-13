import { listAll, createDoc, updateDocById, deleteDocById } from "./db.js";
import { byId, escapeHtml, confirmAction } from "./utils.js";

const COLLECTION = "products";
let cache = [];
let listenersBound = false;

export const PRODUCT_UNITS = ["oz", "fl oz", "gal", "qt", "lb", "each", "bag", "other"];

export async function loadProducts() {
  cache = await listAll(COLLECTION, { orderByField: "name", direction: "asc" });
  return cache;
}

export function getProducts() {
  return cache;
}

export function getProductById(id) {
  return cache.find((p) => p.id === id) || null;
}

export function getProductName(id) {
  return getProductById(id)?.name || null;
}

export function isLowStock(product) {
  return product.quantityOnHand <= product.reorderThreshold;
}

export function getLowStockProducts() {
  return cache.filter((p) => p.active !== false && isLowStock(p));
}

export function populateProductSelect(selectEl, { includeNone = true } = {}) {
  const current = selectEl.value;
  selectEl.innerHTML = "";
  if (includeNone) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Select a product…";
    selectEl.appendChild(opt);
  }
  for (const p of cache.filter((p) => p.active !== false)) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.quantityOnHand} ${p.unit} on hand)`;
    selectEl.appendChild(opt);
  }
  if (current) selectEl.value = current;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Adjusts a product's on-hand quantity by `delta` (negative to consume,
// positive to restock) and persists it. Clamped at 0 so usage can't drive
// the recorded quantity negative.
export async function adjustProductQuantity(productId, delta) {
  const product = getProductById(productId);
  if (!product) return;
  product.quantityOnHand = Math.max(0, round2(product.quantityOnHand + delta));
  await updateDocById(COLLECTION, productId, { quantityOnHand: product.quantityOnHand });
}

function statusBadge(p) {
  if (p.quantityOnHand <= 0) return `<span class="badge badge-danger">Out of Stock</span>`;
  if (isLowStock(p)) return `<span class="badge badge-waiting">Low Stock</span>`;
  return `<span class="badge badge-active">In Stock</span>`;
}

function renderTable() {
  const body = byId("product-table-body");
  body.innerHTML =
    cache
      .map(
        (p) => `
      <tr>
        <td>${escapeHtml(p.name)}${p.active === false ? ' <span class="badge badge-inactive">Inactive</span>' : ""}</td>
        <td>${escapeHtml(p.unit)}</td>
        <td>${p.quantityOnHand}</td>
        <td>${p.reorderThreshold}</td>
        <td>${statusBadge(p)}</td>
        <td class="row-actions">
          <button class="link-btn" data-edit="${p.id}">✏️ Edit</button>
        </td>
      </tr>`
      )
      .join("") || `<tr><td colspan="6" class="hint-text">No products yet.</td></tr>`;

  body.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openForm(cache.find((p) => p.id === btn.dataset.edit)))
  );
}

function populateUnitOptions(selected) {
  const select = byId("product-unit");
  select.innerHTML = PRODUCT_UNITS.map((u) => `<option value="${u}">${u}</option>`).join("");
  select.value = selected || "oz";
}

function openForm(product = null) {
  byId("product-form-card").classList.remove("hidden");
  byId("product-form-title").textContent = product ? "Edit Product" : "Add Product";
  byId("product-id").value = product?.id || "";
  byId("product-name").value = product?.name || "";
  populateUnitOptions(product?.unit);
  byId("product-quantity").value = product?.quantityOnHand ?? 0;
  byId("product-threshold").value = product?.reorderThreshold ?? 0;
  byId("product-notes").value = product?.notes || "";
  byId("product-active").checked = product?.active !== false;
  byId("delete-product-btn").classList.toggle("hidden", !product);
}

function closeForm() {
  byId("product-form-card").classList.add("hidden");
  byId("product-form").reset();
}

async function handleDelete() {
  const id = byId("product-id").value;
  if (!id) return;
  if (!(await confirmAction("Delete this product? This does not delete past purchase or usage records that reference it."))) return;
  await deleteDocById(COLLECTION, id);
  closeForm();
  await refreshProductsView();
}

async function handleSubmit(e) {
  e.preventDefault();
  const id = byId("product-id").value;
  const data = {
    name: byId("product-name").value.trim(),
    unit: byId("product-unit").value,
    quantityOnHand: Number(byId("product-quantity").value) || 0,
    reorderThreshold: Number(byId("product-threshold").value) || 0,
    notes: byId("product-notes").value.trim(),
    active: byId("product-active").checked,
  };
  if (id) await updateDocById(COLLECTION, id, data);
  else await createDoc(COLLECTION, data);
  closeForm();
  await refreshProductsView();
}

export async function refreshProductsView() {
  await loadProducts();
  renderTable();
  document.dispatchEvent(new CustomEvent("products:changed"));
}

export function initProductsView() {
  if (!listenersBound) {
    byId("add-product-btn").addEventListener("click", () => openForm());
    byId("cancel-product-btn").addEventListener("click", closeForm);
    byId("product-form").addEventListener("submit", handleSubmit);
    byId("delete-product-btn").addEventListener("click", handleDelete);
    listenersBound = true;
  }
  return refreshProductsView();
}
