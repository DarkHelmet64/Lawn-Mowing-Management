import { getDocById, setDocById } from "./db.js";

const DOC_ID = "growthPotential";
const DEFAULTS = { grassType: "cool", mowThresholdGPDays: 5 };

let cached = null;

export async function getSettings() {
  if (cached) return cached;
  const doc = await getDocById("settings", DOC_ID);
  cached = { ...DEFAULTS, ...(doc || {}) };
  return cached;
}

export async function saveSettings(data) {
  cached = { ...(cached || DEFAULTS), ...data };
  await setDocById("settings", DOC_ID, cached);
  return cached;
}
