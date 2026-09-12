import { listAll, createDoc, updateDocById, deleteDocById } from "./db.js";
import { byId, escapeHtml, todayStr, formatDateDisplay } from "./utils.js";
import { getEquipment, getEquipmentById, getEquipmentName, populateEquipmentSelect, EQUIPMENT_TYPE_LABELS } from "./equipment.js";

const COLLECTION = "maintenanceTasks";
let cache = [];
let listenersBound = false;

const TASK_LABELS = {
  blade_sharpen: "Blade Sharpening",
  blade_replace: "Blade Replacement",
  oil_change: "Oil Change",
  air_filter: "Air Filter",
  spark_plug: "Spark Plug",
  belt_cable: "Belt / Cable",
  tire_check: "Check Tire Tread and Pressure",
  general_service: "General Service",
  other: "Other",
};

export async function loadTasks() {
  cache = await listAll(COLLECTION, { orderByField: "date", direction: "desc" });
  return cache;
}

export function getTasks() {
  return cache;
}

function populateTypeFilterOptions() {
  const select = byId("task-filter-type");
  const current = select.value;
  select.innerHTML = '<option value="">All Types</option>';
  for (const [value, label] of Object.entries(EQUIPMENT_TYPE_LABELS)) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  }
  if (current) select.value = current;
}

function renderTable() {
  const typeFilter = byId("task-filter-type").value;
  const body = byId("task-table-body");
  body.innerHTML = cache
    .filter((t) => !typeFilter || getEquipmentById(t.equipmentId)?.type === typeFilter)
    .map(
      (t) => `
      <tr>
        <td>${formatDateDisplay(t.date)}</td>
        <td>${escapeHtml(getEquipmentName(t.equipmentId) || t.equipment || "")}</td>
        <td>${TASK_LABELS[t.taskType] || t.taskType}</td>
        <td>${t.hours ?? ""}</td>
        <td>${escapeHtml(t.notes || "")}</td>
        <td class="row-actions">
          <button class="link-btn" data-edit="${t.id}">✏️ Edit</button>
        </td>
      </tr>`
    )
    .join("");

  body.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openForm(cache.find((t) => t.id === btn.dataset.edit)))
  );
}

function openForm(task = null) {
  byId("task-form-card").classList.remove("hidden");
  populateEquipmentSelect(byId("task-equipment"), { includeNone: false });
  byId("task-id").value = task?.id || "";
  byId("task-equipment").value = task?.equipmentId || "";
  byId("task-type").value = task?.taskType || "blade_sharpen";
  byId("task-date").value = task?.date || todayStr();
  byId("task-hours").value = task?.hours ?? "";
  byId("task-notes").value = task?.notes || "";
  byId("delete-task-btn").classList.toggle("hidden", !task);
}

function closeForm() {
  byId("task-form-card").classList.add("hidden");
  byId("task-form").reset();
}

async function handleDelete() {
  const id = byId("task-id").value;
  if (!id) return;
  if (!confirm("Delete this maintenance record?")) return;
  await deleteDocById(COLLECTION, id);
  closeForm();
  await refreshMaintenanceView();
}

async function handleSubmit(e) {
  e.preventDefault();
  const id = byId("task-id").value;
  const data = {
    equipmentId: byId("task-equipment").value,
    taskType: byId("task-type").value,
    date: byId("task-date").value,
    hours: byId("task-hours").value ? Number(byId("task-hours").value) : null,
    notes: byId("task-notes").value.trim(),
  };
  if (id) await updateDocById(COLLECTION, id, data);
  else await createDoc(COLLECTION, data);
  closeForm();
  await refreshMaintenanceView();
}

export async function refreshMaintenanceView() {
  await loadTasks();
  populateTypeFilterOptions();
  renderTable();
}

export function initMaintenanceView() {
  if (!listenersBound) {
    byId("add-task-btn").addEventListener("click", () => {
      if (!getEquipment().length) {
        alert("Add equipment first.");
        return;
      }
      openForm();
    });
    byId("cancel-task-btn").addEventListener("click", closeForm);
    byId("task-form").addEventListener("submit", handleSubmit);
    byId("delete-task-btn").addEventListener("click", handleDelete);
    byId("task-filter-type").addEventListener("change", renderTable);
    listenersBound = true;
  }
  return refreshMaintenanceView();
}
