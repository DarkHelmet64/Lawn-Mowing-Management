import { byId, escapeHtml } from "./utils.js";

// A short confirmation along the bottom of the screen, with optional action
// buttons (e.g. Undo). Only one shows at a time; a new one replaces it.
let timer = null;

export function hideToast() {
  clearTimeout(timer);
  byId("toast").classList.add("hidden");
}

export function showToast({ message, detail = "", actions = [], duration = 8000 }) {
  const el = byId("toast");
  el.innerHTML = `
    <div class="toast-text">
      <strong>${escapeHtml(message)}</strong>
      ${detail ? `<span>${escapeHtml(detail)}</span>` : ""}
    </div>
    ${actions.map((a, i) => `<button type="button" class="toast-btn" data-toast-action="${i}">${escapeHtml(a.label)}</button>`).join("")}`;
  el.querySelectorAll("[data-toast-action]").forEach((btn) =>
    btn.addEventListener("click", () => {
      hideToast();
      actions[Number(btn.dataset.toastAction)].onClick();
    })
  );
  el.classList.remove("hidden");
  clearTimeout(timer);
  timer = setTimeout(hideToast, duration);
}
