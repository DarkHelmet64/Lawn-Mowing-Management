export function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function escapeHtml(str = "") {
  return String(str).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

export function formatDateDisplay(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${m}/${d}/${y}`;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatMonthDisplay(monthStr) {
  if (!monthStr) return "";
  const [y, m] = monthStr.split("-");
  return `${MONTH_ABBR[Number(m) - 1]} '${y.slice(2)}`;
}

export function byId(id) {
  return document.getElementById(id);
}

// Shows or hides a collapsible panel and updates the "Change"/"Done" button
// that controls it (the button carries data-toggle-panel="<panel id>").
export function setPanelOpen(panelId, open) {
  byId(panelId).classList.toggle("hidden", !open);
  const btn = document.querySelector(`[data-toggle-panel="${panelId}"]`);
  if (btn) {
    btn.setAttribute("aria-expanded", String(open));
    btn.textContent = open ? "Done" : "Change";
  }
}

// A custom in-page confirmation dialog, used instead of window.confirm() for
// delete actions - native confirm()/alert() dialogs are unreliable in some
// mobile contexts (e.g. an installed home-screen PWA on iOS can silently
// suppress them, making a guarded action look like it does nothing at all).
export function confirmAction(message, { confirmLabel = "Delete", danger = true } = {}) {
  const overlay = byId("confirm-dialog");
  const okBtn = byId("confirm-ok");
  const cancelBtn = byId("confirm-cancel");
  byId("confirm-message").textContent = message;
  okBtn.textContent = confirmLabel;
  okBtn.className = danger ? "danger-btn" : "primary-btn";
  overlay.classList.remove("hidden");

  return new Promise((resolve) => {
    function cleanup(result) {
      overlay.classList.add("hidden");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKeydown);
      resolve(result);
    }
    function onOk() {
      cleanup(true);
    }
    function onCancel() {
      cleanup(false);
    }
    function onBackdrop(e) {
      if (e.target === overlay) cleanup(false);
    }
    function onKeydown(e) {
      if (e.key === "Escape") cleanup(false);
    }
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKeydown);
  });
}

// Formats a US phone number as (XXX) XXX-XXXX. A leading "1" country code
// is dropped. Anything that isn't 10 digits after that (extensions,
// international numbers, partial input) is returned unchanged rather than
// forced into a shape that would misrepresent it.
export function formatPhoneNumber(raw = "") {
  let digits = String(raw).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return raw;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
