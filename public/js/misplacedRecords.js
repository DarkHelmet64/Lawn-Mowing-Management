import { batchWrite } from "./db.js";
import { getVisits, loadVisits } from "./mowLog.js";
import { getSprays, loadSprays } from "./sprayLog.js";
import { getLocations } from "./locations.js";
import { recordAreaIds } from "./areas.js";
import { visitCuts, cutFields, cutsMoved } from "./cuts.js";
import { ownLocationFor, sameAreasAt } from "./visitDefaults.js";

// Logging one entry for several customers at once used to save every
// customer's copy at the first customer's location, with that yard's areas.
// This finds records whose location belongs to another customer and moves
// each to its own customer's location, with the areas of the same name
// there - the way Log Event saves such entries now.

const YARD_TASKS = ["mowed", "trimmed", "edged"];
const EXTRA_TASKS = ["pruned", "trimmedBushes", "mulched"];

function isMisplaced(record) {
  const location = getLocations().find((l) => l.id === record.locationId);
  return !!location && location.customerId !== record.customerId;
}

// A plant/object is one particular thing in the other yard, so it's dropped.
function visitFix(v) {
  const locationId = ownLocationFor(v.customerId, v.locationId);
  const types = [YARD_TASKS.some((t) => v[t]) && "yardwork", EXTRA_TASKS.some((t) => v[t]) && "extra_yardwork"].filter(Boolean);
  const move = (ids) => sameAreasAt(ids, locationId, types.length ? types : ["yardwork", "extra_yardwork"]);
  const base = { locationId, areaId: null, featureId: null };
  if (Array.isArray(v.cuts) && v.cuts.length > 1) return { ...base, ...cutFields(cutsMoved(visitCuts(v), move)) };
  return { ...base, areaIds: move(recordAreaIds(v)) };
}

function sprayFix(s) {
  const locationId = ownLocationFor(s.customerId, s.locationId);
  return { locationId, areaIds: sameAreasAt(recordAreaIds(s), locationId, ["chemical"]), areaId: null, featureId: null };
}

function misplaced() {
  return [
    ...getVisits().filter(isMisplaced).map((r) => ({ collection: "mowVisits", id: r.id, data: visitFix(r) })),
    ...getSprays().filter(isMisplaced).map((r) => ({ collection: "sprayApplications", id: r.id, data: sprayFix(r) })),
  ];
}

// How many records are saved at another customer's location.
export function countMisplaced() {
  return misplaced().length;
}

// Moves them all; resolves to how many were moved.
export async function fixMisplaced() {
  const fixes = misplaced();
  if (fixes.length) await batchWrite(fixes.map((f) => [{ type: "update", ...f }]));
  await Promise.all([loadVisits(), loadSprays()]);
  return fixes.length;
}
