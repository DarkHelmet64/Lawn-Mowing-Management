import { createDoc, batchWrite } from "./db.js";
import { todayStr } from "./utils.js";
import { loadVisits } from "./mowLog.js";
import { repeatVisitFor, suggestedPattern, mowerSettings, suggestedTimeOfDay, grassDefault } from "./visitDefaults.js";

// Ready to Mow's one-tap "Log mow": a mow for each customer in the row,
// today, with the next pattern in the rotation (shared by a group, since
// they're mowed together), the same mower and settings as last time, and
// each customer's own usual location, areas and trim/edge choices.

// What a quick log would save, for showing on the row before it's tapped.
export function quickLogPlan(customerIds) {
  return {
    pattern: suggestedPattern(customerIds),
    mower: mowerSettings(customerIds),
    tasks: repeatVisitFor(customerIds[0]).tasks,
  };
}

// Saves the mows and returns their ids, so the caller can offer Undo.
export async function logQuickMow(customerIds) {
  const plan = quickLogPlan(customerIds);
  const timeOfDay = suggestedTimeOfDay();
  const ids = [];
  for (const customerId of customerIds) {
    const repeat = repeatVisitFor(customerId);
    ids.push(
      await createDoc("mowVisits", {
        customerId,
        date: todayStr(),
        timeOfDay,
        locationId: repeat.locationId,
        notes: "",
        ...repeat.tasks,
        pattern: plan.pattern,
        deckHeight: plan.mower.deckHeight,
        groundSpeed: plan.mower.groundSpeed,
        bladeSpeed: plan.mower.bladeSpeed,
        grassCondition: grassDefault(timeOfDay),
        equipmentId: plan.mower.equipmentId,
        pruned: false,
        trimmedBushes: false,
        mulched: false,
        areaIds: repeat.areaIds,
        featureId: null,
      })
    );
  }
  await loadVisits();
  return { ids, plan };
}

export async function undoVisits(ids) {
  await batchWrite([ids.map((id) => ({ type: "delete", collection: "mowVisits", id }))]);
  await loadVisits();
}
