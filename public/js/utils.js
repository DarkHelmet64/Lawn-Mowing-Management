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
