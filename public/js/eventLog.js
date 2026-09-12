import { createDoc } from "./db.js";
import { byId, todayStr } from "./utils.js";
import { getCustomers, populateCustomerSelect } from "./customers.js";
import { loadVisits } from "./mowLog.js";
import { loadSprays } from "./sprayLog.js";

function updateCategoryVisibility() {
  const category = byId("event-category").value;
  byId("event-yardwork-fields").classList.toggle("hidden", category !== "yardwork");
  byId("event-spray-fields").classList.toggle("hidden", category !== "spray");
}

function openForm() {
  byId("log-event-form-card").classList.remove("hidden");
  populateCustomerSelect(byId("event-customer"));
  byId("event-customer").value = getCustomers()[0]?.id || "";
  byId("event-date").value = todayStr();
  byId("event-category").value = "yardwork";
  byId("event-mowed").checked = true;
  byId("event-trimmed").checked = true;
  byId("event-edged").checked = false;
  byId("event-pruned").checked = false;
  byId("event-trimmed-bushes").checked = false;
  byId("event-pattern").value = "parallel";
  byId("event-height").value = "";
  byId("event-spray-location").value = "driveway";
  byId("event-spray-target").value = "weeds";
  byId("event-spray-product").value = "";
  byId("event-notes").value = "";
  updateCategoryVisibility();
}

function closeForm() {
  byId("log-event-form-card").classList.add("hidden");
  byId("log-event-form").reset();
}

async function handleSubmit(e) {
  e.preventDefault();
  const customerId = byId("event-customer").value;
  const date = byId("event-date").value;
  const category = byId("event-category").value;
  const notes = byId("event-notes").value.trim();

  if (category === "yardwork") {
    const data = {
      customerId,
      date,
      mowed: byId("event-mowed").checked,
      trimmed: byId("event-trimmed").checked,
      edged: byId("event-edged").checked,
      pruned: byId("event-pruned").checked,
      trimmedBushes: byId("event-trimmed-bushes").checked,
      pattern: byId("event-pattern").value,
      deckHeight: byId("event-height").value ? Number(byId("event-height").value) : null,
      notes,
    };
    if (!data.mowed && !data.trimmed && !data.edged && !data.pruned && !data.trimmedBushes) {
      alert("Select at least one thing that was done.");
      return;
    }
    await createDoc("mowVisits", data);
    await loadVisits();
  } else {
    const product = byId("event-spray-product").value.trim();
    if (!product) {
      alert("Enter the product used.");
      return;
    }
    await createDoc("sprayApplications", {
      customerId,
      date,
      location: byId("event-spray-location").value,
      target: byId("event-spray-target").value,
      product,
      notes,
    });
    await loadSprays();
  }

  closeForm();
  document.dispatchEvent(new CustomEvent("event:logged"));
}

export function initEventLogView() {
  byId("log-event-btn").addEventListener("click", () => {
    if (!getCustomers().length) {
      alert("Add a customer first.");
      return;
    }
    openForm();
  });
  byId("cancel-event-btn").addEventListener("click", closeForm);
  byId("event-category").addEventListener("change", updateCategoryVisibility);
  byId("log-event-form").addEventListener("submit", handleSubmit);
}
