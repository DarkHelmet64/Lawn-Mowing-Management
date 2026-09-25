import { getVisits } from "./mowLog.js";
import { getEquipment, getEquipmentById, getEquipmentName } from "./equipment.js";
import { getLocationsForCustomer } from "./locations.js";
import { getAreasForLocation, areaAppliesToEventTypes, recordAreaIds } from "./areas.js";

// What a new visit should start out as, worked out from each customer's own
// history. The Log Event form, Ready to Mow's one-tap button and the run
// sheet all pre-fill from here, so they agree on "the next pattern" and
// "the same settings as last time".

export const PATTERN_ROTATION = ["parallel", "perpendicular", "diagonal_left", "diagonal_right"];

// Areas with these exact names are the default pick for yard work.
export const DEFAULT_YARDWORK_AREA_NAMES = new Set(["Front Yard", "Back Yard"]);

const YARD_TASKS = ["mowed", "trimmed", "edged"];

export function createdMs(record) {
  return record?.createdAt?.toMillis?.() ?? 0;
}

function newestFirst(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return createdMs(b) - createdMs(a);
}

// One mow per distinct date, newest first. Neighbors in a group are mowed
// together, so a day with three mows counts once, taking the pattern of
// whichever was logged last.
export function mowHistory(customerIds) {
  const ids = new Set(customerIds);
  const latestByDate = new Map();
  for (const v of getVisits()) {
    if (!ids.has(v.customerId) || !v.mowed || !v.pattern) continue;
    const best = latestByDate.get(v.date);
    if (!best || createdMs(v) > createdMs(best)) latestByDate.set(v.date, v);
  }
  return [...latestByDate.values()].sort(newestFirst);
}

// null after "other" (or an unknown value): there's no rotation to continue.
export function nextPattern(pattern) {
  const i = PATTERN_ROTATION.indexOf(pattern);
  return i === -1 ? null : PATTERN_ROTATION[(i + 1) % PATTERN_ROTATION.length];
}

export function patternSuggestion(customerIds) {
  const last = mowHistory(customerIds)[0] || null;
  return { last, next: last ? nextPattern(last.pattern) : null };
}

// The pattern to use when nobody picks one: next in the rotation, else
// whatever was used last, else Parallel for a customer never mowed before.
export function suggestedPattern(customerIds) {
  const { last, next } = patternSuggestion(customerIds);
  return next || last?.pattern || "parallel";
}

export function lastYardVisit(customerId) {
  return getVisits()
    .filter((v) => v.customerId === customerId && YARD_TASKS.some((t) => v[t]))
    .sort(newestFirst)[0] || null;
}

// Guesses Time of Day from the clock so it's rarely left blank.
export function suggestedTimeOfDay(now = new Date()) {
  const hour = now.getHours();
  if (hour < 11) return "morning";
  if (hour < 14) return "midday";
  if (hour < 18) return "afternoon";
  return "evening";
}

// Morning grass is usually still damp; any other time, dry.
export function grassDefault(timeOfDay) {
  return timeOfDay === "morning" ? "damp" : "dry";
}

const NO_MOWER = { equipmentId: null, deckHeight: null, groundSpeed: null, bladeSpeed: null };

// The mower and its settings from the most recent mow of any of these
// customers (if that mower is still in service). Otherwise, when there's
// only one active mower, that mower with its own configured defaults.
export function mowerSettings(customerIds) {
  const ids = new Set(customerIds);
  const last = getVisits()
    .filter((v) => ids.has(v.customerId) && v.mowed && v.equipmentId)
    .sort(newestFirst)
    .find((v) => {
      const eq = getEquipmentById(v.equipmentId);
      return eq?.type === "mower" && eq.active !== false;
    });
  if (last) {
    return {
      equipmentId: last.equipmentId,
      deckHeight: last.deckHeight ?? null,
      groundSpeed: last.groundSpeed ?? null,
      bladeSpeed: last.bladeSpeed ?? null,
    };
  }
  const mowers = getEquipment().filter((e) => e.type === "mower" && e.active !== false);
  if (mowers.length !== 1) return { ...NO_MOWER };
  const [m] = mowers;
  return {
    equipmentId: m.id,
    deckHeight: m.defaultDeckHeight ?? null,
    groundSpeed: m.defaultGroundSpeed ?? null,
    bladeSpeed: m.defaultBladeSpeed ?? null,
  };
}

export function mowerSummary({ equipmentId, deckHeight, groundSpeed, bladeSpeed }) {
  const name = getEquipmentName(equipmentId);
  if (!name) return "No mower selected";
  return [name, deckHeight != null && deckHeight !== "" ? `${deckHeight}"` : "", groundSpeed ? `speed ${groundSpeed}` : "", bladeSpeed || ""]
    .filter(Boolean)
    .join(" · ");
}

export function defaultAreaIds(locationId, type = "yardwork") {
  return getAreasForLocation(locationId)
    .filter((a) => areaAppliesToEventTypes(a, [type]) && DEFAULT_YARDWORK_AREA_NAMES.has(a.name))
    .map((a) => a.id);
}

// Where and what a repeat mow for this customer records: their last yard
// visit's location, areas and trim/edge choices - or, for someone never
// visited, their first location's Front/Back Yard with mow, trim and edge.
export function repeatVisitFor(customerId) {
  const last = lastYardVisit(customerId);
  const locations = getLocationsForCustomer(customerId);
  const locationId = last?.locationId && locations.some((l) => l.id === last.locationId) ? last.locationId : locations[0]?.id || null;
  const lastAreas = last && last.locationId === locationId ? recordAreaIds(last) : [];
  return {
    locationId,
    areaIds: lastAreas.length ? lastAreas : defaultAreaIds(locationId),
    tasks: last ? { mowed: true, trimmed: !!last.trimmed, edged: !!last.edged } : { mowed: true, trimmed: true, edged: true },
  };
}

const PATTERN_STRIPES = {
  parallel: "M4.5 5h7M4.5 8h7M4.5 11h7",
  perpendicular: "M5 4.5v7M8 4.5v7M11 4.5v7",
  diagonal_left: "M4.5 4.5l7 7M4.5 8l3.5 3.5M8 4.5l3.5 3.5",
  diagonal_right: "M4.5 11.5l7-7M4.5 8L8 4.5M8 11.5L11.5 8",
};

// A small square drawn with the pattern's stripe direction.
export function patternGlyph(pattern, size = 16) {
  const stripes = PATTERN_STRIPES[pattern];
  const inner = stripes ? `<path d="${stripes}"></path>` : `<circle cx="8" cy="8" r="1.5"></circle>`;
  return `<svg class="pattern-glyph" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="13" rx="3"></rect>${inner}</svg>`;
}
