import { listAll, createDoc, updateDocById, deleteDocById } from "./db.js";
import { byId, escapeHtml, todayStr, formatDateDisplay } from "./utils.js";

const COLLECTION = "maintenanceTasks";
let cache = [];

const TASK_LABELS = {
  blade_sharpen: "Blade Sharpening",
  blade_replace: "Blade Replacement",
  oil_change: "Oil Change",
  air_filter: "Air Filter",
  spark_plug: "Spark Plug",
  belt_cable: "Belt / Cable",
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

function renderTable() {
  const body = byId("task-table-body");
  body.innerHTML = cache
    .map(
      (t) => `
      <tr>
        <td>${formatDateDisplay(t.date)}</td>
        <td>${escapeHtml(t.equipment || "")}</td>
        <td>${TASK_LABELS[t.taskType] || t.taskType}</td>
        <td>${t.hours ?? ""}</td>
        <td>${escapeHtml(t.notes || "")}</td>
        <td class="row-actions">
          <button class="link-btn" data-edit="${t.id}">Edit</button>
          <button class="link-btn danger" data-delete="${t.id}">Delete</button>
        </td>
      </tr>`
    )
    .join("");

  body.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openForm(cache.find((t) => t.id === btn.dataset.edit)))
  );
  body.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => handleDelete(btn.dataset.delete))
  );
}

function openForm(task = null) {
  byId("task-form-card").classList.remove("hidden");
  byId("task-id").value = task?.id || "";
  byId("task-equipment").value = task?.equipment || "";
  byId("task-type").value = task?.taskType || "blade_sharpen";
  byId("task-date").value = task?.date || todayStr();
  byId("task-hours").value = task?.hours ?? "";
  byId("task-notes").value = task?.notes || "";
}

function closeForm() {
  byId("task-form-card").classList.add("hidden");
  byId("task-form").reset();
}

async function handleDelete(id) {
  if (!confirm("Delete this maintenance record?")) return;
  await deleteDocById(COLLECTION, id);
  await refresh();
}

async function handleSubmit(e) {
  e.preventDefault();
  const id = byId("task-id").value;
  const data = {
    equipment: byId("task-equipment").value.trim(),
    taskType: byId("task-type").value,
    date: byId("task-date").value,
    hours: byId("task-hours").value ? Number(byId("task-hours").value) : null,
    notes: byId("task-notes").value.trim(),
  };
  if (id) await updateDocById(COLLECTION, id, data);
  else await createDoc(COLLECTION, data);
  closeForm();
  await refresh();
}

async function refresh() {
  await loadTasks();
  renderTable();
}

export function initMaintenanceView() {
  byId("add-task-btn").addEventListener("click", () => openForm());
  byId("cancel-task-btn").addEventListener("click", closeForm);
  byId("task-form").addEventListener("submit", handleSubmit);

  refresh();
}
