import { escapeHtml } from "./utils.js";
import { recordAreaIds, getAreaName } from "./areas.js";
import { populateDeckHeightSelect, populateGroundSpeedSelect, populateBladeSpeedSelect } from "./equipment.js";
import { PATTERN_LABELS, nextPattern, patternStripes } from "./patterns.js";

// A mow can be a double or triple cut: the lawn cut again, possibly at a
// different height, speed, pattern or over different areas. A visit keeps
// every cut in `cuts`; its top-level pattern/deck/speed fields mirror the
// final cut (the stripes that show, and what the pattern rotation follows),
// and its areaIds cover every area cut. A single cut stores no `cuts` list.

export const MAX_CUTS = 3;

export function visitCuts(v) {
  if (Array.isArray(v?.cuts) && v.cuts.length) return v.cuts;
  if (!v?.mowed) return [];
  return [
    {
      pattern: v.pattern ?? null,
      deckHeight: v.deckHeight ?? null,
      groundSpeed: v.groundSpeed ?? null,
      bladeSpeed: v.bladeSpeed ?? null,
      areaIds: recordAreaIds(v),
    },
  ];
}

export function cutCount(v) {
  return visitCuts(v).length;
}

export function cutLabel(n) {
  if (n === 2) return "Double cut";
  if (n === 3) return "Triple cut";
  return n > 3 ? `${n} cuts` : "";
}

// What a mowed visit saves for a list of cuts (see the note at the top).
export function cutFields(cuts) {
  const last = cuts[cuts.length - 1];
  return {
    pattern: last.pattern ?? null,
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

// The 2nd and 3rd cuts of a mow, as an editable list. The 1st cut is always
// the form's own pattern/mower/area fields (getFirstCut reads them), so a
// single cut looks exactly as it did before. Each added cut starts from the
// previous one - same settings and areas, next pattern in the rotation.
// withAreas: false leaves areas off (the run sheet cuts each house's areas).
export function createCutEditor({ container, addButton, namePrefix, getMowerId, getAreas = () => [], getFirstCut, withAreas = true, onChange = () => {} }) {
  let cuts = [];

  function readCut(block) {
    const value = (field) => block.querySelector(`[data-cut-field="${field}"]`)?.value || "";
    return {
      pattern: block.querySelector('input[type="radio"]:checked')?.value || null,
      deckHeight: value("deckHeight") ? Number(value("deckHeight")) : null,
      groundSpeed: value("groundSpeed") || null,
      bladeSpeed: value("bladeSpeed") || null,
      areaIds: withAreas ? [...block.querySelectorAll(".cut-area-checkbox:checked")].map((cb) => cb.value) : null,
    };
  }

  function sync() {
    cuts = [...container.querySelectorAll(".cut-block")].map(readCut);
  }

  function render() {
    const mowerId = getMowerId();
    const areas = withAreas ? getAreas() : [];
    container.innerHTML = cuts
      .map((c, i) => {
        const n = i + 2;
        const areaChips = areas
          .map(
            (a) =>
              `<label class="chip-toggle"><input type="checkbox" class="cut-area-checkbox" value="${escapeHtml(a.id)}" ${c.areaIds?.includes(a.id) ? "checked" : ""} /><span>${escapeHtml(a.name)}</span></label>`
          )
          .join("");
        return `
        <div class="cut-block">
          <div class="cut-block-head">
            <span class="cut-block-title">Cut ${n}</span>
            <button type="button" class="link-btn" data-remove-cut="${i}" aria-label="Remove cut ${n}">Remove</button>
          </div>
          <div class="pattern-options" role="radiogroup" aria-label="Cut ${n} pattern">${patternOptions(`${namePrefix}-${i}`, c.pattern)}</div>
          <div class="cut-settings">
            <label>Deck Height <select data-cut-field="deckHeight"></select></label>
            <label>Ground Speed <select data-cut-field="groundSpeed"></select></label>
            <label>Blade Speed <select data-cut-field="bladeSpeed"></select></label>
          </div>
          ${
            withAreas
              ? `<div class="field-block"><span class="field-label">Areas</span><div class="chip-group">${areaChips || `<p class="hint-text">No areas set up at this location.</p>`}</div></div>`
              : ""
          }
        </div>`;
      })
      .join("");
    container.querySelectorAll(".cut-block").forEach((block, i) => {
      populateDeckHeightSelect(block.querySelector('[data-cut-field="deckHeight"]'), mowerId, cuts[i].deckHeight);
      populateGroundSpeedSelect(block.querySelector('[data-cut-field="groundSpeed"]'), mowerId, cuts[i].groundSpeed);
      populateBladeSpeedSelect(block.querySelector('[data-cut-field="bladeSpeed"]'), mowerId, cuts[i].bladeSpeed);
    });
    container.classList.toggle("hidden", !cuts.length);
    const total = cuts.length + 1;
    addButton.classList.toggle("hidden", total >= MAX_CUTS);
    addButton.textContent = total === 1 ? "+ Add a second cut" : "+ Add a third cut";
  }

  function add() {
    sync();
    const prev = cuts[cuts.length - 1] || getFirstCut();
    cuts.push({
      pattern: nextPattern(prev.pattern) || prev.pattern || "parallel",
      deckHeight: prev.deckHeight ?? null,
      groundSpeed: prev.groundSpeed ?? null,
      bladeSpeed: prev.bladeSpeed ?? null,
      areaIds: withAreas ? [...(prev.areaIds || [])] : null,
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
  addButton.addEventListener("click", add);

  return {
    get() {
      sync();
      return cuts.map((c) => ({ ...c }));
    },
    set(list) {
      cuts = list.map((c) => ({ ...c, areaIds: withAreas ? [...(c.areaIds || [])] : null }));
      render();
      onChange();
    },
    clear() {
      cuts = [];
      render();
      onChange();
    },
    // Re-renders for a new mower or location. Settings carry over; areas
    // carry over by name ("Front Yard" at the new location), since area ids
    // belong to one location.
    refresh() {
      sync();
      if (withAreas) {
        const areas = getAreas();
        for (const c of cuts) {
          const names = new Set(c.areaIds.map((id) => getAreaName(id)).filter(Boolean));
          c.areaIds = areas.filter((a) => c.areaIds.includes(a.id) || names.has(a.name)).map((a) => a.id);
        }
      }
      render();
    },
    count() {
      return cuts.length;
    },
  };
}
