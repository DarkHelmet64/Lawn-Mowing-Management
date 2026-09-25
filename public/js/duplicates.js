import { batchWrite } from "./db.js";
import { getVisits, loadVisits } from "./mowLog.js";
import { getSprays, loadSprays } from "./sprayLog.js";

// Before visits stored an areaIds array, Log Event saved a separate copy of
// each record per checked area - identical except for areaId, and written
// back-to-back within a second or two of each other. This finds those sets
// and merges each into its first record, carrying every area over.

// Copies from one submission were written in a quick loop, so consecutive
// copies land well inside this gap. Two separate submissions that happen to
// match (logged again by hand) are further apart and stay separate - which
// matters for sprays, where merging two real applications would undercount
// the product used.
const SAME_SUBMISSION_MS = 15000;

function createdMs(record) {
  return record.createdAt?.toMillis?.() ?? 0;
}

// Everything except identity, timestamps and the area itself.
function contentKey(record) {
  const { id, createdAt, areaId, areaIds, ...rest } = record;
  return JSON.stringify(
    Object.keys(rest)
      .sort()
      .map((k) => [k, rest[k] ?? null])
  );
}

function findDuplicateSets(records) {
  const byContent = new Map();
  for (const r of records) {
    if (Array.isArray(r.areaIds) || !r.areaId || !createdMs(r)) continue;
    const key = contentKey(r);
    if (!byContent.has(key)) byContent.set(key, []);
    byContent.get(key).push(r);
  }
  const sets = [];
  for (const group of byContent.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => createdMs(a) - createdMs(b));
    let run = [group[0]];
    for (const r of group.slice(1)) {
      if (createdMs(r) - createdMs(run[run.length - 1]) <= SAME_SUBMISSION_MS) {
        run.push(r);
      } else {
        if (run.length > 1) sets.push(run);
        run = [r];
      }
    }
    if (run.length > 1) sets.push(run);
  }
  return sets;
}

function allDuplicateSets() {
  return [
    ...findDuplicateSets(getVisits()).map((records) => ({ collection: "mowVisits", records })),
    ...findDuplicateSets(getSprays()).map((records) => ({ collection: "sprayApplications", records })),
  ];
}

// { sets, records }: how many combined records would result, and how many
// records they're made from today.
export function countDuplicates() {
  const sets = allDuplicateSets();
  return { sets: sets.length, records: sets.reduce((n, s) => n + s.records.length, 0) };
}

export async function combineDuplicates() {
  const sets = allDuplicateSets();
  const groups = sets.map(({ collection, records }) => {
    const [keep, ...rest] = records;
    return [
      { type: "update", collection, id: keep.id, data: { areaIds: [...new Set(records.map((r) => r.areaId))], areaId: null } },
      ...rest.map((r) => ({ type: "delete", collection, id: r.id })),
    ];
  });
  if (groups.length) await batchWrite(groups);
  await Promise.all([loadVisits(), loadSprays()]);
  return { sets: sets.length, records: sets.reduce((n, s) => n + s.records.length, 0) };
}
