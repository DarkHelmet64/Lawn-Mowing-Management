import { escapeHtml } from "./utils.js";
import { recordAreaIds, getAreaName } from "./areas.js";
import {
  populateEquipmentSelect,
  populateDeckHeightSelect,
  populateGroundSpeedSelect,
  populateBladeSpeedSelect,
  getEquipmentById,
} from "./equipment.js";
import { PATTERN_LABELS, nextPattern, patternStripes } from "./patterns.js";

// A mow is one or more cuts. Each cut covers some areas with its own mower,
// pattern, deck height and speeds - so the front yard can be cut twice with
// one mower while the back yard gets a single pass with another. A visit
// keeps every cut in `cuts`; its top-level pattern/mower/deck/speed fields
// mirror the final cut (the stripes that show, and what the pattern
// rotation follows), and its areaIds cover every area cut. A single cut
// stores no `cuts` list.
//
// Cuts are numbered per area: the first cut of the front yard is its cut 1
// and the next one over it cut 2 - a double cut - while the back yard's
// only cut is its cut 1 (see cutNumbers). A "double cut" means some area
// was cut twice (a triple, three times), not simply that there were two cuts.

export const MAX_CUTS = 6;

export function visitCuts(v) {
  if (Array.isArray(v?.cuts) && v.cuts.length) {
    // Cuts saved before each had its own mower used the visit's mower.
    return v.cuts.map((c) => ({ ...c, equipmentId: c.equipmentId ?? v.equipmentId ?? null }));
  }
  if (!v?.mowed) return [];
  return [
    {
      pattern: v.pattern ?? null,
      equipmentId: v.equipmentId ?? null,
      deckHeight: v.deckHeight ?? null,
      groundSpeed: v.groundSpeed ?? null,
      bladeSpeed: v.bladeSpeed ?? null,
      areaIds: recordAreaIds(v),
    },
  ];
}

// Passes over each area. A cut with no areas picked counts as covering the
// whole lawn, so it adds a pass to every area. areaKey lets cuts that name
// their areas differently (e.g. by area name) be counted the same way.
function passesByArea(cuts, areaKey = "areaIds") {
  let everywhere = 0;
  const counts = new Map();
  for (const c of cuts) {
    const areas = c[areaKey] || [];
    if (!areas.length) everywhere++;
    for (const a of areas) counts.set(a, (counts.get(a) || 0) + 1);
  }
  return { everywhere, counts };
}

// Each cut's number for its own areas: 1 the first time an area is cut, 2
// the next time (the double cut), and so on. A cut over areas cut different
// numbers of times takes the highest.
export function cutNumbers(cuts, areaKey = "areaIds") {
  let everywhere = 0;
  const counts = new Map();
  return cuts.map((c) => {
    const areas = c[areaKey] || [];
    if (!areas.length) {
      everywhere++;
      return (counts.size ? Math.max(...counts.values()) : 0) + everywhere;
    }
    for (const a of areas) counts.set(a, (counts.get(a) || 0) + 1);
    return Math.max(...areas.map((a) => counts.get(a))) + everywhere;
  });
}

// How many times the most-cut area was cut: 1 for a normal mow, 2 for a
// double cut, 3 for a triple. Takes a visit, or a list of cuts.
export function passCount(visitOrCuts, areaKey = "areaIds") {
  const cuts = Array.isArray(visitOrCuts) ? visitOrCuts : visitCuts(visitOrCuts);
  return cuts.length ? Math.max(...cutNumbers(cuts, areaKey)) : 0;
}

// The areas that were cut more than once.
export function multiCutAreaIds(v) {
  const { everywhere, counts } = passesByArea(visitCuts(v));
  return [...counts].filter(([, n]) => n + everywhere >= 2).map(([id]) => id);
}

export function cutLabel(n) {
  if (n === 2) return "Double cut";
  if (n === 3) return "Triple cut";
  return n > 3 ? `${n}× cut` : "";
}

// What a mowed visit saves for a list of cuts (see the note at the top).
export function cutFields(cuts) {
  const last = cuts[cuts.length - 1];
  return {
    pattern: last.pattern ?? null,
    equipmentId: last.equipmentId ?? null,
    deckHeight: last.deckHeight ?? null,
    groundSpeed: last.groundSpeed ?? null,
    bladeSpeed: last.bladeSpeed ?? null,
    areaIds: [...new Set(cuts.flatMap((c) => c.areaIds || []))],
    cuts: cuts.length > 1 ? cuts : null,
  };
}

const PATTERN_SHORT = {
  parallel: "Parallel",
  perpendicular: "Perpend.",
  diagonal_left: "Diag. Left",
  diagonal_right: "Diag. Right",
  other: "Other",
};

function patternOptions(name, selected) {
  return Object.keys(PATTERN_LABELS)
    .map((p) => {
      const stripes = patternStripes(p);
      const inner = stripes ? `<path d="${stripes}"></path>` : `<circle cx="8" cy="8" r="1.5"></circle>`;
      return `<label class="pattern-option"><input type="radio" name="${name}" value="${p}" aria-label="${PATTERN_LABELS[p]}" ${p === selected ? "checked" : ""} /><span><svg width="26" height="26" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="13" rx="3"></rect>${inner}</svg>${PATTERN_SHORT[p]}</span></label>`;
    })
    .join("");
}

// The 2nd and later cuts of a mow, as an editable list. The 1st cut is
// always the form's own pattern/mower/area fields (getFirstCut reads them),
// so a single cut looks exactly as it did before. Each added cut starts from
// the previous one - same mower, settings and areas, next pattern in the
// rotation - and can then be pointed at other areas or another mower.
// getAreas returns [{id, name}] for the area chips. Each cut's heading
// carries its number for its areas, so call relabel() when the form's own
// areas change.
export function createCutEditor({ container, addButton, namePrefix, getAreas, getFirstCut, onChange = () => {} }) {
  let cuts = [];

  function readCut(block) {
    const value = (field) => block.querySelector(`[data-cut-field="${field}"]`)?.value || "";
    return {
      pattern: block.querySelector('input[type="radio"]:checked')?.value || null,
      equipmentId: value("equipmentId") || null,
      deckHeight: value("deckHeight") ? Number(value("deckHeight")) : null,
      groundSpeed: value("groundSpeed") || null,
      bladeSpeed: value("bladeSpeed") || null,
      areaIds: [...block.querySelectorAll(".cut-area-checkbox:checked")].map((cb) => cb.value),
    };
  }

  function sync() {
    cuts = [...container.querySelectorAll(".cut-block")].map(readCut);
  }

  function render() {
    const areas = getAreas();
    container.innerHTML = cuts
      .map((c, i) => {
        const areaChips = areas
          .map(
            (a) =>
              `<label class="chip-toggle"><input type="checkbox" class="cut-area-checkbox" value="${escapeHtml(a.id)}" ${c.areaIds?.includes(a.id) ? "checked" : ""} /><span>${escapeHtml(a.name)}</span></label>`
          )
          .join("");
        return `
        <div class="cut-block">
          <div class="cut-block-head">
            <span class="cut-block-title"></span>
            <button type="button" class="link-btn" data-remove-cut="${i}">Remove</button>
          </div>
          <div class="field-block"><span class="field-label">Areas</span><div class="chip-group">${areaChips || `<p class="hint-text">No areas set up at this location.</p>`}</div></div>
          <div class="pattern-options" role="radiogroup">${patternOptions(`${namePrefix}-${i}`, c.pattern)}</div>
          <div class="cut-settings">
            <label>Mower <select data-cut-field="equipmentId" data-cut-index="${i}"></select></label>
            <label>Deck Height <select data-cut-field="deckHeight"></select></label>
            <label>Ground Speed <select data-cut-field="groundSpeed"></select></label>
            <label>Blade Speed <select data-cut-field="bladeSpeed"></select></label>
          </div>
        </div>`;
      })
      .join("");
    container.querySelectorAll(".cut-block").forEach((block, i) => {
      const c = cuts[i];
      const mowerSelect = block.querySelector('[data-cut-field="equipmentId"]');
      populateEquipmentSelect(mowerSelect, { typeFilter: "mower" });
      mowerSelect.value = c.equipmentId || "";
      populateDeckHeightSelect(block.querySelector('[data-cut-field="deckHeight"]'), mowerSelect.value, c.deckHeight);
      populateGroundSpeedSelect(block.querySelector('[data-cut-field="groundSpeed"]'), mowerSelect.value, c.groundSpeed);
      populateBladeSpeedSelect(block.querySelector('[data-cut-field="bladeSpeed"]'), mowerSelect.value, c.bladeSpeed);
    });
    relabel();
    container.classList.toggle("hidden", !cuts.length);
    const total = cuts.length + 1;
    addButton.classList.toggle("hidden", total >= MAX_CUTS);
    addButton.textContent = total === 1 ? "+ Add a second cut" : "+ Add another cut";
  }

  // "Cut 2 · Front Yard": the cut's number for its areas (see cutNumbers),
  // which changes as areas are picked here or in cut 1.
  function relabel() {
    const blocks = [...container.querySelectorAll(".cut-block")];
    const areaIds = blocks.map((block) => [...block.querySelectorAll(".cut-area-checkbox:checked")].map((cb) => cb.value));
    const numbers = cutNumbers([getFirstCut(), ...areaIds.map((ids) => ({ areaIds: ids }))]).slice(1);
    const names = new Map(getAreas().map((a) => [a.id, a.name]));
    blocks.forEach((block, i) => {
      const areaText = areaIds[i].map((id) => names.get(id)).filter(Boolean).join(", ");
      const label = `Cut ${numbers[i]}${areaText ? ` · ${areaText}` : ""}`;
      block.querySelector(".cut-block-title").innerHTML = `Cut ${numbers[i]}${areaText ? ` <span class="cut-area-tag">· ${escapeHtml(areaText)}</span>` : ""}`;
      block.querySelector("[data-remove-cut]").setAttribute("aria-label", `Remove ${label}`);
      block.querySelector(".pattern-options").setAttribute("aria-label", `${label} pattern`);
    });
  }

  function add() {
    sync();
    const prev = cuts[cuts.length - 1] || getFirstCut();
    cuts.push({
      pattern: nextPattern(prev.pattern) || prev.pattern || "parallel",
      equipmentId: prev.equipmentId ?? null,
      deckHeight: prev.deckHeight ?? null,
      groundSpeed: prev.groundSpeed ?? null,
      bladeSpeed: prev.bladeSpeed ?? null,
      areaIds: [...(prev.areaIds || [])],
    });
    render();
    onChange();
    container.querySelector(".cut-block:last-child input[type='radio']:checked")?.focus();
  }

  container.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove-cut]");
    if (!btn) return;
    sync();
    cuts.splice(Number(btn.dataset.removeCut), 1);
    render();
    onChange();
    addButton.focus();
  });
  // A different mower for a cut starts from that mower's own defaults.
  container.addEventListener("change", (e) => {
    const select = e.target.closest('[data-cut-field="equipmentId"]');
    if (select) {
      sync();
      const i = Number(select.dataset.cutIndex);
      const eq = getEquipmentById(cuts[i].equipmentId);
      cuts[i] = { ...cuts[i], deckHeight: eq?.defaultDeckHeight ?? null, groundSpeed: eq?.defaultGroundSpeed ?? null, bladeSpeed: eq?.defaultBladeSpeed ?? null };
      render();
      container.querySelector(`[data-cut-field="equipmentId"][data-cut-index="${i}"]`)?.focus();
    } else if (e.target.closest(".cut-area-checkbox")) {
      relabel();
    }
    onChange();
  });
  addButton.addEventListener("click", add);

  return {
    get() {
      sync();
      return cuts.map((c) => ({ ...c }));
    },
    set(list) {
      cuts = list.map((c) => ({ ...c, areaIds: [...(c.areaIds || [])] }));
      render();
      onChange();
    },
    clear() {
      cuts = [];
      render();
      onChange();
    },
    // Re-renders for a new location. Areas carry over by name ("Front Yard"
    // at the new location), since area ids belong to one location.
    refresh() {
      sync();
      const areas = getAreas();
      for (const c of cuts) {
        const names = new Set(c.areaIds.map((id) => getAreaName(id) || id));
        c.areaIds = areas.filter((a) => c.areaIds.includes(a.id) || names.has(a.name)).map((a) => a.id);
      }
      render();
    },
    relabel,
    count() {
      return cuts.length;
    },
  };
}
