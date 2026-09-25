import { createDoc, batchWrite } from "./db.js";
import { todayStr } from "./utils.js";
import { loadVisits } from "./mowLog.js";
import { repeatVisitFor, suggestedPattern, mowerSettings, suggestedTimeOfDay, grassDefault, repeatCuts } from "./visitDefaults.js";
import { cutFields } from "./cuts.js";

// Ready to Mow's one-tap "Log mow": a mow for each customer in the row,
// today, with the next pattern in the rotation (shared by a group, since
// they're mowed together), the same mower and settings as last time, and
// each customer's own usual location, areas and trim/edge choices.

// What a quick log would save, for showing on the row before it's tapped.
// cuts is set when last time was a double/triple cut, to repeat it.
export function quickLogPlan(customerIds) {
  const pattern = suggestedPattern(customerIds);
  return {
    pattern,
    cuts: repeatCuts(customerIds, pattern),
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
        ...cutFields(
          (plan.cuts || [{ pattern: plan.pattern, deckHeight: plan.mower.deckHeight, groundSpeed: plan.mower.groundSpeed, bladeSpeed: plan.mower.bladeSpeed }]).map((c) => ({
            ...c,
            areaIds: repeat.areaIds,
          }))
        ),
        grassCondition: grassDefault(timeOfDay),
        equipmentId: plan.mower.equipmentId,
        pruned: false,
        trimmedBushes: false,
        mulched: false,
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
