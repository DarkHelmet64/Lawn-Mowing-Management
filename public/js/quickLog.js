import { batchWrite } from "./db.js";
import { loadVisits } from "./mowLog.js";
import { repeatVisitFor, suggestedPattern, mowerSettings, repeatCuts } from "./visitDefaults.js";

// What Ready to Mow's "Log mow" fills the Log Event form in with: the next
// pattern in the rotation (shared by a group, since they're mowed together),
// the same mower and settings as last time, the first customer's usual
// location, areas and trim/edge choices, and - when last time was a double
// or triple cut - the same cuts again. Also shown on the row as a preview.
export function quickLogPlan(customerIds) {
  const pattern = suggestedPattern(customerIds);
  const repeat = repeatVisitFor(customerIds[0]);
  return {
    pattern,
    cuts: repeatCuts(customerIds, pattern),
    mower: mowerSettings(customerIds),
    tasks: repeat.tasks,
    locationId: repeat.locationId,
    areaIds: repeat.areaIds,
  };
}

// Removes visits just saved (the run sheet's Undo).
export async function undoVisits(ids) {
  await batchWrite([ids.map((id) => ({ type: "delete", collection: "mowVisits", id }))]);
  await loadVisits();
}
